import type { FastifyInstance } from 'fastify';
import { sql } from 'kysely';
import * as S from '../../schemas/index.js';
import { parse } from '../../http/validation.js';
import { orgCtx, requireRole, requireUser } from '../../http/guards.js';
import { AppError, conflict } from '../../lib/errors.js';
import { audit } from '../../lib/audit.js';
import type { DB } from '../../db/index.js';
import type { BillingEvent, BillingProvider } from './provider.js';
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

async function findOrgId(db: DB, metadataOrgId: unknown, customerId: string | null): Promise<string | null> {
  if (typeof metadataOrgId === 'string' && UUID_RE.test(metadataOrgId)) {
    const o = await db.selectFrom('organizations').select('id').where('id', '=', metadataOrgId).executeTakeFirst();
    if (o) return o.id;
  }
  if (customerId) {
    const o = await db.selectFrom('organizations').select('id').where('stripe_customer_id', '=', customerId).executeTakeFirst();
    if (o) return o.id;
  }
  return null;
}

export async function processBillingEvent(db: DB, billing: BillingProvider, event: BillingEvent): Promise<{ duplicate: boolean; organizationId: string | null }> {
  return db.transaction().execute(async (trx) => {
    const inserted = await trx
      .insertInto('stripe_events')
      .values({ id: event.id, type: event.type })
      .onConflict((oc) => oc.column('id').doNothing())
      .returning('id')
      .executeTakeFirst();
    if (!inserted) return { duplicate: true, organizationId: null };
    const obj = event.data.object;
    const metadata = (obj.metadata ?? {}) as Record<string, unknown>;

    if (event.type === 'checkout.session.completed') {
      const customer = asString(obj.customer);
      const orgId = await findOrgId(trx, obj.client_reference_id ?? metadata.organization_id, customer);
      if (!orgId) return { duplicate: false, organizationId: null };
      const plan = metadata.plan === 'monthly' || metadata.plan === 'annual' ? metadata.plan : null;
      await trx
        .updateTable('organizations')
        .set({
          stripe_customer_id: customer,
          stripe_subscription_id: asString(obj.subscription),
          ...(plan ? { plan } : {}),
          updated_at: sql<Date>`now()`,
        })
        .where('id', '=', orgId)
        .execute();
      return { duplicate: false, organizationId: orgId };
    }

    if (event.type.startsWith('customer.subscription.')) {
      const customer = asString(obj.customer);
      const subId = asString(obj.id);
      const orgId = await findOrgId(trx, metadata.organization_id, customer);
      if (!orgId || !subId) return { duplicate: false, organizationId: null };
      const org = await trx.selectFrom('organizations').selectAll().where('id', '=', orgId).forUpdate().executeTakeFirstOrThrow();
      const eventAt = new Date(event.created * 1000);
      // Eventos desordenados: se ignora uno más antiguo que el último aplicado.
      if (org.stripe_event_at && org.stripe_event_at.getTime() > eventAt.getTime()) return { duplicate: false, organizationId: orgId };
      // Una suscripción antigua (ya sustituida) no debe pisar el estado de la actual.
      if (org.stripe_subscription_id && org.stripe_subscription_id !== subId && event.type === 'customer.subscription.deleted') {
        return { duplicate: false, organizationId: orgId };
      }
      const items = (obj.items as { data?: { current_period_end?: number; price?: { id?: string } }[] } | undefined)?.data ?? [];
      const periodEnd = items[0]?.current_period_end ?? (typeof obj.current_period_end === 'number' ? obj.current_period_end : null);
      const priceId = items[0]?.price?.id;
      const plan = priceId === billing.priceMonthly ? 'monthly' : priceId === billing.priceAnnual ? 'annual' : (metadata.plan as string | undefined) ?? org.plan;
      const status = event.type === 'customer.subscription.deleted' ? 'canceled' : typeof obj.status === 'string' ? obj.status : 'canceled';
      await trx
        .updateTable('organizations')
        .set({
          subscription_status: status,
          stripe_subscription_id: subId,
          stripe_customer_id: customer ?? org.stripe_customer_id,
          current_period_end: periodEnd ? new Date(periodEnd * 1000) : null,
          cancel_at_period_end: obj.cancel_at_period_end === true,
          plan: plan === 'monthly' || plan === 'annual' ? plan : null,
          stripe_event_at: eventAt,
          updated_at: sql<Date>`now()`,
        })
        .where('id', '=', orgId)
        .execute();
      await audit(trx, { event: 'billing.subscription_updated', organizationId: orgId, metadata: { status, eventType: event.type, eventId: event.id } });
      return { duplicate: false, organizationId: orgId };
    }
    return { duplicate: false, organizationId: null };
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
    const result = await processBillingEvent(db, billing, event);
    return reply.send({ received: true, duplicate: result.duplicate });
  });
}
