import type { FastifyInstance } from 'fastify';
import { sql } from 'kysely';
import * as S from '../../schemas/index.js';
import { parse } from '../../http/validation.js';
import { orgCtx, requireRole, requireUser } from '../../http/guards.js';
import { AppError, conflict } from '../../lib/errors.js';
import { audit } from '../../lib/audit.js';
import type { DB } from '../../db/index.js';
import type { BillingEvent, BillingProvider, SubscriptionState } from './provider.js';
import { effectiveStatus, subscriptionView } from './status.js';

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
    const now = Date.now();
    const trialMs = ctx.org.trial_ends_at.getTime() - now;
    const trialEnd = !ctx.org.stripe_subscription_id && trialMs > 48 * 3600 * 1000 ? Math.floor(ctx.org.trial_ends_at.getTime() / 1000) : null;
    const base = `${config.appOrigin}/locales/${ctx.org.id}/facturacion`;
    try {
      const session = await billing.createCheckoutSession({
        organizationId: ctx.org.id,
        customerId: ctx.org.stripe_customer_id,
        customerEmail: requireUser(req).user.email,
        priceId: body.plan === 'monthly' ? billing.priceMonthly : billing.priceAnnual,
        plan: body.plan,
        trialEnd,
        successUrl: `${base}?checkout=ok`,
        cancelUrl: `${base}?checkout=cancelado`,
      });
      await audit(db, { event: 'billing.checkout_started', organizationId: ctx.org.id, userId: ctx.userId, ip: req.ip, metadata: { plan: body.plan } });
      return { url: session.url };
    } catch (err) {
      req.log.error({ err: (err as Error).message }, 'Error creando sesión de Checkout');
      throw new AppError(502, 'BILLING_ERROR', 'No se ha podido iniciar el pago. Inténtalo de nuevo en unos minutos.');
    }
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

/** Estados en los que una suscripción ha terminado. */
const TERMINATED = ['canceled', 'incomplete_expired'];

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

/**
 * Procesa un evento de Stripe. En todo evento de suscripción, Checkout o factura se recupera la
 * suscripción ACTUAL desde Stripe y se aplica ese estado (fuente de verdad), así que el orden de
 * llegada de los eventos no importa. El evento solo se marca como procesado si se ha podido
 * resolver: si Stripe falla o no se encuentra la organización se lanza un 5xx para que Stripe
 * reintente (salvo si la organización ya no existe: se acepta y se registra).
 */
export async function processBillingEvent(
  db: DB,
  billing: BillingProvider,
  event: BillingEvent,
  log?: { warn: (o: object, msg: string) => void },
): Promise<BillingEventResult> {
  const seen = await db.selectFrom('stripe_events').select('id').where('id', '=', event.id).executeTakeFirst();
  if (seen) return { duplicate: true, organizationId: null };

  const markProcessed = async (ignored: string, organizationId: string | null = null): Promise<BillingEventResult> => {
    const ins = await db.insertInto('stripe_events').values({ id: event.id, type: event.type }).onConflict((oc) => oc.column('id').doNothing()).returning('id').executeTakeFirst();
    return { duplicate: !ins, organizationId, ignored };
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

  // Organización: metadatos de la suscripción (fijados al crear el Checkout) → pista del evento → cliente.
  const orgRef = state.metadata.organization_id ?? refs.orgHint;
  let orgId: string | null = null;
  if (typeof orgRef === 'string' && UUID_RE.test(orgRef)) {
    const o = await db.selectFrom('organizations').select('id').where('id', '=', orgRef).executeTakeFirst();
    if (!o) {
      log?.warn({ eventId: event.id, organizationId: orgRef }, 'Evento de Stripe de un local que ya no existe: se acepta sin efecto');
      return markProcessed('organization_deleted');
    }
    orgId = o.id;
  }
  const customerId = state.customerId ?? refs.customerId;
  if (!orgId && customerId) {
    const o = await db.selectFrom('organizations').select('id').where('stripe_customer_id', '=', customerId).executeTakeFirst();
    orgId = o?.id ?? null;
  }
  if (!orgId) {
    log?.warn({ eventId: event.id, type: event.type }, 'Evento de Stripe sin local asociable: se responde 503 para que Stripe reintente');
    throw retryLater('No se ha podido asociar el evento a ningún local todavía. Reintentar más tarde.');
  }
  const resolvedOrgId = orgId;

  return db.transaction().execute(async (trx) => {
    const inserted = await trx.insertInto('stripe_events').values({ id: event.id, type: event.type }).onConflict((oc) => oc.column('id').doNothing()).returning('id').executeTakeFirst();
    if (!inserted) return { duplicate: true, organizationId: null };
    const org = await trx.selectFrom('organizations').selectAll().where('id', '=', resolvedOrgId).forUpdate().executeTakeFirst();
    if (!org) return { duplicate: false, organizationId: null, ignored: 'organization_deleted' };

    // Solo cuenta la suscripción actual del local. Otra suscripción solo la sustituye si la
    // actual ha terminado y la nueva está viva (p. ej. nueva contratación tras cancelar).
    const current = org.stripe_subscription_id;
    if (current && current !== state.id) {
      const replace = TERMINATED.includes(org.subscription_status) && !TERMINATED.includes(state.status);
      if (!replace) return { duplicate: false, organizationId: org.id, ignored: 'not_current_subscription' };
    }

    const metaPlan = state.metadata.plan;
    const plan =
      state.priceId === billing.priceMonthly ? 'monthly' : state.priceId === billing.priceAnnual ? 'annual' : metaPlan === 'monthly' || metaPlan === 'annual' ? metaPlan : org.plan;
    const eventAt = new Date(event.created * 1000);
    await trx
      .updateTable('organizations')
      .set({
        subscription_status: state.status,
        stripe_subscription_id: state.id,
        stripe_customer_id: customerId ?? org.stripe_customer_id,
        current_period_end: state.currentPeriodEnd ? new Date(state.currentPeriodEnd * 1000) : null,
        cancel_at_period_end: state.cancelAtPeriodEnd,
        plan: plan === 'monthly' || plan === 'annual' ? plan : null,
        stripe_event_at: org.stripe_event_at && org.stripe_event_at > eventAt ? org.stripe_event_at : eventAt,
        updated_at: sql<Date>`now()`,
      })
      .where('id', '=', org.id)
      .execute();
    await audit(trx, { event: 'billing.subscription_updated', organizationId: org.id, metadata: { status: state.status, eventType: event.type, eventId: event.id } });
    return { duplicate: false, organizationId: org.id };
  });
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
