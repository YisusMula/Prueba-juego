import type { FastifyInstance } from 'fastify';
import { sql } from 'kysely';
import * as S from '../../schemas/index.js';
import { parse } from '../../http/validation.js';
import { orgCtx, requireRole, requireUser } from '../../http/guards.js';
import { AppError, conflict } from '../../lib/errors.js';
import { audit } from '../../lib/audit.js';
import type { DB } from '../../db/index.js';
import type { BillingEvent, BillingProvider, SubscriptionState } from './provider.js';
import { LIVE_SUBSCRIPTION_STATUSES, TERMINATED_SUBSCRIPTION_STATUSES, effectiveStatus, subscriptionView } from './status.js';

const notConfigured = () =>
  new AppError(503, 'BILLING_NOT_CONFIGURED', 'La facturación no está configurada en este servidor. El resto de la aplicación funciona con normalidad.');

export const PRICES = {
  monthly: { amount: 12, currency: 'EUR', interval: 'month' },
  annual: { amount: 120, currency: 'EUR', interval: 'year' },
} as const;

/** /api/orgs/:orgId/billing */
export async function billingRoutes(app: FastifyInstance): Promise<void> {
  const { db, config } = app.deps;

  app.get('/', async (req) => {
    const ctx = orgCtx(req);
    return { billingEnabled: app.deps.billing != null, prices: PRICES, subscription: subscriptionView(ctx.org) };
  });

  // Checkout y portal se permiten aunque la organización esté en solo lectura (es la forma de reactivarla).
  app.post('/checkout', async (req) => {
    const ctx = requireRole(req, 'owner');
    const billing = app.deps.billing;
    if (!billing) throw notConfigured();
    const body = parse(S.checkoutBody, req.body);
    if (ctx.org.deletion_scheduled_at) throw conflict('Este local está pendiente de eliminación. Restáuralo antes de contratar una suscripción.');
    const status = effectiveStatus(ctx.org);
    if (ctx.org.stripe_subscription_id && ['active', 'past_due', 'unpaid', 'trialing', 'paused'].includes(status)) {
      throw conflict('Este local ya tiene una suscripción. Gestiónala desde el portal de cliente.');
    }
    // M-2: un primer pago a medias (`incomplete`) se anula ANTES de abrir otro Checkout; si no,
    // podrían quedar dos suscripciones y la buena ser ignorada (o cobrarse dos veces).
    if (ctx.org.stripe_subscription_id && status === 'incomplete') {
      const subId = ctx.org.stripe_subscription_id;
      try {
        const current = await billing.retrieveSubscription(subId);
        if (current && LIVE_SUBSCRIPTION_STATUSES.includes(current.status)) {
          throw conflict('El pago anterior de este local ya se ha completado. Espera unos segundos y recarga la página.');
        }
        if (current && !TERMINATED_SUBSCRIPTION_STATUSES.includes(current.status)) await billing.cancelSubscription(subId);
      } catch (err) {
        if (err instanceof AppError) throw err;
        req.log.error({ err: (err as Error).message }, 'Error anulando la suscripción incompleta antes de un nuevo Checkout');
        throw new AppError(502, 'BILLING_ERROR', 'No se ha podido anular el intento de pago anterior, así que no se ha iniciado otro. Inténtalo de nuevo en unos minutos.');
      }
      await audit(db, { event: 'billing.subscription_canceled', organizationId: ctx.org.id, userId: ctx.userId, ip: req.ip, metadata: { reason: 'incomplete_replaced_by_checkout', subscriptionId: subId } });
    }
    // Una sola sesión de Checkout abierta por local: la anterior se expira (si falla, no se abre otra).
    const previousSessionId = ctx.org.stripe_checkout_session_id;
    if (previousSessionId) {
      try {
        await billing.expireCheckoutSession(previousSessionId);
      } catch (err) {
        req.log.error({ err: (err as Error).message }, 'Error expirando la sesión de Checkout anterior');
        throw new AppError(502, 'BILLING_ERROR', 'No se ha podido iniciar el pago. Inténtalo de nuevo en unos minutos.');
      }
    }
    const now = Date.now();
    const trialMs = ctx.org.trial_ends_at.getTime() - now;
    const trialEnd = !ctx.org.stripe_subscription_id && trialMs > 48 * 3600 * 1000 ? Math.floor(ctx.org.trial_ends_at.getTime() / 1000) : null;
    const base = `${config.appOrigin}/locales/${ctx.org.id}/facturacion`;
    let session: { url: string; id?: string };
    try {
      session = await billing.createCheckoutSession({
        organizationId: ctx.org.id,
        customerId: ctx.org.stripe_customer_id,
        customerEmail: requireUser(req).user.email,
        priceId: body.plan === 'monthly' ? billing.priceMonthly : billing.priceAnnual,
        plan: body.plan,
        trialEnd,
        previousSessionId,
        successUrl: `${base}?checkout=ok`,
        cancelUrl: `${base}?checkout=cancelado`,
      });
    } catch (err) {
      req.log.error({ err: (err as Error).message }, 'Error creando sesión de Checkout');
      throw new AppError(502, 'BILLING_ERROR', 'No se ha podido iniciar el pago. Inténtalo de nuevo en unos minutos.');
    }
    // Se guarda para poder expirarla si se pide el borrado del local (M-1). Si el local pasó a
    // pendiente de eliminación mientras tanto, se expira enseguida.
    const saved = await db
      .updateTable('organizations')
      .set({ stripe_checkout_session_id: session.id ?? null, updated_at: sql<Date>`now()` })
      .where('id', '=', ctx.org.id)
      .where('deletion_scheduled_at', 'is', null)
      .executeTakeFirst();
    if (Number(saved.numUpdatedRows) === 0) {
      if (session.id) await billing.expireCheckoutSession(session.id).catch(() => undefined);
      throw conflict('Este local está pendiente de eliminación. Restáuralo antes de contratar una suscripción.');
    }
    await audit(db, { event: 'billing.checkout_started', organizationId: ctx.org.id, userId: ctx.userId, ip: req.ip, metadata: { plan: body.plan } });
    return { url: session.url };
  });

  app.post('/portal', async (req) => {
    const ctx = requireRole(req, 'owner');
    const billing = app.deps.billing;
    if (!billing) throw notConfigured();
    if (!ctx.org.stripe_customer_id) throw conflict('Este local todavía no tiene datos de facturación. Suscríbete primero.');
    try {
      const session = await billing.createPortalSession({
        customerId: ctx.org.stripe_customer_id,
        returnUrl: `${config.appOrigin}/locales/${ctx.org.id}/facturacion`,
      });
      return { url: session.url };
    } catch (err) {
      req.log.error({ err: (err as Error).message }, 'Error creando sesión del portal');
      throw new AppError(502, 'BILLING_ERROR', 'No se ha podido abrir el portal de facturación. Inténtalo de nuevo en unos minutos.');
    }
  });
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const asString = (v: unknown): string | null => (typeof v === 'string' ? v : v && typeof v === 'object' && typeof (v as { id?: unknown }).id === 'string' ? (v as { id: string }).id : null);
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {});

/** Estados en los que una suscripción ha terminado (ya no puede cobrar). */
const TERMINATED = TERMINATED_SUBSCRIPTION_STATUSES;
/** Estados "vivos" a efectos de sustituir la suscripción actual del local (M-2). */
const LIVE = LIVE_SUBSCRIPTION_STATUSES;

export interface BillingEventResult {
  duplicate: boolean;
  organizationId: string | null;
  /** Motivo si el evento se aceptó sin aplicar nada. */
  ignored?: string;
}

/** Suscripción y pistas de organización/cliente que trae cada tipo de evento. */
function extractRefs(event: BillingEvent): { relevant: boolean; subscriptionId: string | null; orgHint: unknown; customerId: string | null } {
  const o = event.data.object;
  const metadata = obj(o.metadata);
  const customerId = asString(o.customer);
  if (event.type.startsWith('customer.subscription.')) {
    return { relevant: true, subscriptionId: asString(o.id), orgHint: metadata.organization_id, customerId };
  }
  if (event.type === 'checkout.session.completed') {
    return { relevant: true, subscriptionId: asString(o.subscription), orgHint: o.client_reference_id ?? metadata.organization_id, customerId };
  }
  if (event.type.startsWith('invoice.')) {
    // API reciente: invoice.parent.subscription_details; antigua: invoice.subscription(_details).
    const details = obj(obj(o.parent).subscription_details);
    const legacy = obj(o.subscription_details);
    return {
      relevant: true,
      subscriptionId: asString(o.subscription) ?? asString(details.subscription),
      orgHint: obj(details.metadata).organization_id ?? obj(legacy.metadata).organization_id,
      customerId,
    };
  }
  return { relevant: false, subscriptionId: null, orgHint: null, customerId };
}

const retryLater = (message: string) => new AppError(503, 'BILLING_ERROR', message);

type WebhookLog = { warn: (o: object, msg: string) => void };

/**
 * Procesa un evento de Stripe. En todo evento de suscripción, Checkout o factura se recupera la
 * suscripción ACTUAL desde Stripe y se aplica ese estado (fuente de verdad), así que el orden de
 * llegada de los eventos no importa. El evento solo se marca como procesado si se ha podido
 * resolver: si Stripe falla o no se encuentra la organización se lanza un 5xx para que Stripe
 * reintente.
 *
 * Nunca deja una suscripción cobrando sin servicio (M-1, M-2):
 *  - de un local que ya no existe o pendiente de eliminación → se CANCELA en Stripe (sin
 *    reembolso automático: queda en el log y en la auditoría para revisarlo a mano);
 *  - dos suscripciones vivas para el mismo local → se conserva la más reciente y se cancela la otra;
 *  - una suscripción viva sustituye a la actual si esta no está viva (p. ej. `incomplete`), y la
 *    anterior, si aún no ha terminado, se cancela.
 * Si una cancelación falla, 503 sin marcar el evento: Stripe lo reintenta.
 */
export async function processBillingEvent(db: DB, billing: BillingProvider, event: BillingEvent, log?: WebhookLog): Promise<BillingEventResult> {
  const seen = await db.selectFrom('stripe_events').select('id').where('id', '=', event.id).executeTakeFirst();
  if (seen) return { duplicate: true, organizationId: null };

  const markProcessed = async (ignored: string, organizationId: string | null = null): Promise<BillingEventResult> => {
    const ins = await db.insertInto('stripe_events').values({ id: event.id, type: event.type }).onConflict((oc) => oc.column('id').doNothing()).returning('id').executeTakeFirst();
    return { duplicate: !ins, organizationId, ignored };
  };

  /** Cancela en Stripe una suscripción que no debe seguir cobrando (log + auditoría). */
  const cancelUnwanted = async (subscriptionId: string, organizationId: string, reason: string): Promise<void> => {
    try {
      await billing.cancelSubscription(subscriptionId);
    } catch (err) {
      log?.warn({ err: (err as Error).message, eventId: event.id, subscriptionId, reason }, 'No se pudo cancelar en Stripe una suscripción sobrante; Stripe reintentará el evento');
      throw retryLater('No se ha podido cancelar una suscripción sobrante en Stripe. Reintentar más tarde.');
    }
    log?.warn(
      { eventId: event.id, organizationId, subscriptionId, reason },
      'Suscripción de Stripe cancelada automáticamente (sin reembolso automático): revisa en Stripe si procede reembolsar algún cobro',
    );
    await audit(db, { event: 'billing.subscription_canceled', organizationId, metadata: { reason, subscriptionId, eventId: event.id, refund: 'manual_review' } });
  };

  const refs = extractRefs(event);
  if (!refs.relevant) return markProcessed('event_type_not_used');
  if (!refs.subscriptionId) {
    // Checkout sin suscripción o factura suelta: solo se vincula el cliente si se conoce el local.
    return markProcessed('no_subscription');
  }

  let state: SubscriptionState | null;
  try {
    state = await billing.retrieveSubscription(refs.subscriptionId);
  } catch (err) {
    log?.warn({ err: (err as Error).message, eventId: event.id }, 'No se pudo recuperar la suscripción de Stripe; Stripe reintentará');
    throw retryLater('No se ha podido consultar la suscripción en Stripe. Reintentar más tarde.');
  }
  if (!state) {
    log?.warn({ eventId: event.id }, 'Stripe no conoce la suscripción del evento: se ignora');
    return markProcessed('subscription_not_found');
  }
  const sub = state;
  const subAlive = !TERMINATED.includes(sub.status);

  // Organización: metadatos de la suscripción (fijados al crear el Checkout) → pista del evento → cliente.
  const orgRef = sub.metadata.organization_id ?? refs.orgHint;
  let orgId: string | null = null;
  if (typeof orgRef === 'string' && UUID_RE.test(orgRef)) {
    const o = await db.selectFrom('organizations').select('id').where('id', '=', orgRef).executeTakeFirst();
    if (!o) {
      // M-1 (b): suscripción viva de un local que ya no existe → se cancela, no se ignora.
      if (subAlive) {
        await cancelUnwanted(sub.id, orgRef, 'organization_deleted');
        return markProcessed('orphan_subscription_canceled', orgRef);
      }
      log?.warn({ eventId: event.id, organizationId: orgRef }, 'Evento de Stripe de un local que ya no existe: se acepta sin efecto');
      return markProcessed('organization_deleted');
    }
    orgId = o.id;
  }
  const customerId = sub.customerId ?? refs.customerId;
  if (!orgId && customerId) {
    const o = await db.selectFrom('organizations').select('id').where('stripe_customer_id', '=', customerId).executeTakeFirst();
    orgId = o?.id ?? null;
  }
  if (!orgId) {
    log?.warn({ eventId: event.id, type: event.type }, 'Evento de Stripe sin local asociable: se responde 503 para que Stripe reintente');
    throw retryLater('No se ha podido asociar el evento a ningún local todavía. Reintentar más tarde.');
  }

  // Decisión con una lectura sin bloqueo: las llamadas a Stripe van FUERA de la transacción.
  const snap = await db.selectFrom('organizations').selectAll().where('id', '=', orgId).executeTakeFirst();
  if (!snap) {
    if (subAlive) {
      await cancelUnwanted(sub.id, orgId, 'organization_deleted');
      return markProcessed('orphan_subscription_canceled', orgId);
    }
    return markProcessed('organization_deleted');
  }

  if (snap.deletion_scheduled_at) {
    // M-1 (b): local pendiente de eliminación. Una suscripción viva (p. ej. de un Checkout que se
    // completó después de pedir el borrado) se CANCELA en vez de activarse.
    if (subAlive) {
      await cancelUnwanted(sub.id, snap.id, 'organization_pending_deletion');
      return markProcessed('pending_deletion_subscription_canceled', snap.id);
    }
    // Ya terminada: solo se aplica si es la suya (las demás no deben cambiar el estado del local).
    if (sub.id !== snap.stripe_subscription_id) return markProcessed('organization_pending_deletion', snap.id);
  }

  // Solo cuenta la suscripción actual del local; ver reglas de sustitución arriba.
  const current = snap.stripe_subscription_id;
  if (current && current !== sub.id) {
    if (LIVE.includes(sub.status)) {
      let cur: SubscriptionState | null;
      try {
        cur = await billing.retrieveSubscription(current);
      } catch (err) {
        log?.warn({ err: (err as Error).message, eventId: event.id }, 'No se pudo recuperar la suscripción actual del local; Stripe reintentará');
        throw retryLater('No se ha podido consultar la suscripción en Stripe. Reintentar más tarde.');
      }
      if (cur && LIVE.includes(cur.status)) {
        // Dos suscripciones vivas para el mismo local: nunca se cobra dos veces. Se conserva la más reciente.
        if ((sub.created ?? 0) < (cur.created ?? 0)) {
          await cancelUnwanted(sub.id, snap.id, 'duplicate_subscription');
          return markProcessed('duplicate_subscription_canceled', snap.id);
        }
        await cancelUnwanted(current, snap.id, 'duplicate_subscription');
      } else if (cur && !TERMINATED.includes(cur.status)) {
        // La actual no está viva (p. ej. `incomplete` o `unpaid`) y llega otra viva: la sustituye
        // y la anterior se cancela para que no se cobre más adelante.
        await cancelUnwanted(current, snap.id, 'replaced_by_live_subscription');
      }
    } else if (!(TERMINATED.includes(snap.subscription_status) && subAlive)) {
      return markProcessed('not_current_subscription', snap.id);
    }
  }

  const checkoutSessionId = event.type.startsWith('checkout.session.') ? asString(event.data.object.id) : null;
  try {
    return await db.transaction().execute(async (trx) => {
      const inserted = await trx.insertInto('stripe_events').values({ id: event.id, type: event.type }).onConflict((oc) => oc.column('id').doNothing()).returning('id').executeTakeFirst();
      if (!inserted) return { duplicate: true, organizationId: null };
      const org = await trx.selectFrom('organizations').selectAll().where('id', '=', snap.id).forUpdate().executeTakeFirst();
      if (!org) return { duplicate: false, organizationId: null, ignored: 'organization_deleted' };
      // Otra petición cambió la suscripción actual mientras tanto: no se pisa.
      if (org.stripe_subscription_id !== current && org.stripe_subscription_id !== sub.id) {
        return { duplicate: false, organizationId: org.id, ignored: 'not_current_subscription' };
      }

      const metaPlan = sub.metadata.plan;
      const plan =
        sub.priceId === billing.priceMonthly ? 'monthly' : sub.priceId === billing.priceAnnual ? 'annual' : metaPlan === 'monthly' || metaPlan === 'annual' ? metaPlan : org.plan;
      const eventAt = new Date(event.created * 1000);
      const wasPastDue = org.subscription_status === 'past_due' && org.stripe_subscription_id === sub.id && org.past_due_since;
      await trx
        .updateTable('organizations')
        .set({
          subscription_status: sub.status,
          stripe_subscription_id: sub.id,
          stripe_customer_id: customerId ?? org.stripe_customer_id,
          current_period_end: sub.currentPeriodEnd ? new Date(sub.currentPeriodEnd * 1000) : null,
          cancel_at_period_end: sub.cancelAtPeriodEnd,
          plan: plan === 'monthly' || plan === 'annual' ? plan : null,
          stripe_event_at: org.stripe_event_at && org.stripe_event_at > eventAt ? org.stripe_event_at : eventAt,
          // I-3: desde cuándo falla el cobro (se conserva mientras siga en past_due).
          past_due_since: sub.status === 'past_due' ? (wasPastDue ? org.past_due_since : eventAt) : null,
          ...(checkoutSessionId && checkoutSessionId === org.stripe_checkout_session_id ? { stripe_checkout_session_id: null } : {}),
          updated_at: sql<Date>`now()`,
        })
        .where('id', '=', org.id)
        .execute();
      await audit(trx, { event: 'billing.subscription_updated', organizationId: org.id, metadata: { status: sub.status, eventType: event.type, eventId: event.id } });
      return { duplicate: false, organizationId: org.id };
    });
  } catch (err) {
    // B-6: el cliente de Stripe ya está vinculado a OTRO local (único en BD): no es reintentable.
    if ((err as { code?: string }).code === '23505') {
      log?.warn({ eventId: event.id, organizationId: snap.id, type: event.type }, 'Evento de Stripe con un cliente que ya pertenece a otro local: se acepta sin efecto (revisar en Stripe)');
      return markProcessed('customer_belongs_to_other_organization', snap.id);
    }
    throw err;
  }
}

/** POST /api/billing/webhook — firma verificada sobre el cuerpo crudo; idempotente. */
export async function billingWebhookRoutes(app: FastifyInstance): Promise<void> {
  const { db } = app.deps;
  app.removeContentTypeParser('application/json');
  app.addContentTypeParser('application/json', { parseAs: 'buffer', bodyLimit: 1024 * 1024 }, (_req, body, done) => done(null, body));

  app.post('/webhook', { bodyLimit: 1024 * 1024 }, async (req, reply) => {
    const billing = app.deps.billing;
    if (!billing) throw notConfigured();
    const signature = req.headers['stripe-signature'];
    if (typeof signature !== 'string' || !Buffer.isBuffer(req.body)) {
      throw new AppError(400, 'BAD_REQUEST', 'Firma de webhook ausente');
    }
    let event: BillingEvent;
    try {
      event = billing.constructEvent(req.body, signature);
    } catch {
      throw new AppError(400, 'BAD_REQUEST', 'Firma de webhook no válida');
    }
    const result = await processBillingEvent(db, billing, event, req.log);
    return reply.send({ received: true, duplicate: result.duplicate });
  });
}
