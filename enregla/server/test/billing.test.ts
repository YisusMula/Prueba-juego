import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import Stripe from 'stripe';
import { addMember, closeTestApp, createTestApp, json, resetDb, setupOwner, type TestCtx } from './helpers.js';
import { StripeBillingProvider, type CheckoutParams } from '../src/modules/billing/provider.js';

const WEBHOOK_SECRET = 'whsec_test_c2VjcmV0LWRlLXBydWViYXMtZW5yZWdsYQ';
const STRIPE_CFG = {
  secretKey: 'sk_test_51EnReglaDummyKeyForTests000',
  webhookSecret: WEBHOOK_SECRET,
  priceMonthly: 'price_monthly_test',
  priceAnnual: 'price_annual_test',
};

/** Proveedor real (verificación de firma real) con las llamadas de red sustituidas. */
class FakeStripeProvider extends StripeBillingProvider {
  checkoutCalls: CheckoutParams[] = [];
  portalCalls: { customerId: string; returnUrl: string }[] = [];
  override createCheckoutSession(p: CheckoutParams) {
    this.checkoutCalls.push(p);
    return Promise.resolve({ url: 'https://checkout.stripe.com/c/pay/cs_test_123' });
  }
  override createPortalSession(p: { customerId: string; returnUrl: string }) {
    this.portalCalls.push(p);
    return Promise.resolve({ url: 'https://billing.stripe.com/p/session/test_123' });
  }
}

const signer = new Stripe('sk_test_signer');
function signed(event: object, secret = WEBHOOK_SECRET) {
  const payload = JSON.stringify(event);
  const header = signer.webhooks.generateTestHeaderString({ payload, secret });
  return { payload, header };
}

let ctx: TestCtx;
let noBilling: TestCtx;
let provider: FakeStripeProvider;
beforeAll(async () => {
  provider = new FakeStripeProvider(STRIPE_CFG);
  ctx = await createTestApp({ billing: provider });
  noBilling = await createTestApp({ billing: null });
});
afterAll(async () => {
  await closeTestApp(ctx);
  await closeTestApp(noBilling);
});
beforeEach(async () => {
  await resetDb(ctx);
  provider.checkoutCalls = [];
  provider.portalCalls = [];
});

let evtSeq = 0;
function subscriptionEvent(type: string, orgId: string, status: string, opts: { created?: number; subId?: string; price?: string; cancelAtPeriodEnd?: boolean } = {}) {
  evtSeq += 1;
  return {
    id: `evt_test_${evtSeq}_${Date.now()}`,
    object: 'event',
    type,
    created: opts.created ?? Math.floor(Date.now() / 1000),
    data: {
      object: {
        id: opts.subId ?? 'sub_test_1',
        object: 'subscription',
        customer: 'cus_test_1',
        status,
        cancel_at_period_end: opts.cancelAtPeriodEnd ?? false,
        metadata: { organization_id: orgId },
        items: { data: [{ current_period_end: Math.floor(Date.now() / 1000) + 30 * 86400, price: { id: opts.price ?? 'price_monthly_test' } }] },
      },
    },
  };
}

async function postWebhook(c: TestCtx, event: object, header?: string) {
  const s = signed(event);
  return c.app.inject({
    method: 'POST',
    url: '/api/billing/webhook',
    headers: { 'content-type': 'application/json', ...(header !== '' ? { 'stripe-signature': header ?? s.header } : {}) },
    payload: s.payload,
  });
}

describe('sin Stripe configurado', () => {
  it('los endpoints de facturación responden 503 y el resto funciona', async () => {
    await resetDb(noBilling);
    const { client, base } = await setupOwner(noBilling);
    const info = json(await client.get(`${base}/billing`));
    expect(info.billingEnabled).toBe(false);
    expect(info.prices.monthly.amount).toBe(12);
    expect(info.prices.annual.amount).toBe(120);
    const co = await client.post(`${base}/billing/checkout`, { plan: 'monthly' });
    expect(co.statusCode).toBe(503);
    expect(json(co).error.code).toBe('BILLING_NOT_CONFIGURED');
    expect((await client.post(`${base}/billing/portal`)).statusCode).toBe(503);
    const wh = await noBilling.app.inject({ method: 'POST', url: '/api/billing/webhook', headers: { 'content-type': 'application/json' }, payload: '{}' });
    expect(wh.statusCode).toBe(503);
    expect((await client.post(`${base}/records`, { type: 'plagas', data: { result: 'sin_indicios' } })).statusCode).toBe(201);
  });
});

describe('Checkout y portal', () => {
  it('el owner inicia Checkout con el price correcto y la prueba restante', async () => {
    const { client, base, org, user } = await setupOwner(ctx);
    const res = await client.post(`${base}/billing/checkout`, { plan: 'annual' });
    expect(res.statusCode).toBe(200);
    expect(json(res).url).toContain('checkout.stripe.com');
    const call = provider.checkoutCalls[0]!;
    expect(call).toMatchObject({ organizationId: org.id, priceId: 'price_annual_test', plan: 'annual', customerId: null, customerEmail: user.email });
    expect(call.trialEnd).toBe(Math.floor(org.trial_ends_at.getTime() / 1000));
    expect(call.successUrl.startsWith('http://localhost:5173/')).toBe(true);
    expect((await client.post(`${base}/billing/checkout`, { plan: 'semanal' })).statusCode).toBe(400);
  });

  it('el manager no gestiona la facturación', async () => {
    const { base, org } = await setupOwner(ctx);
    const { client: mgr } = await addMember(ctx, org.id, 'm@example.com', 'manager');
    expect((await mgr.get(`${base}/billing`)).statusCode).toBe(200);
    expect((await mgr.post(`${base}/billing/checkout`, { plan: 'monthly' })).statusCode).toBe(403);
    expect((await mgr.post(`${base}/billing/portal`)).statusCode).toBe(403);
  });

  it('portal: requiere cliente de Stripe (vinculado por el webhook de Checkout)', async () => {
    const { client, base, org } = await setupOwner(ctx);
    expect((await client.post(`${base}/billing/portal`)).statusCode).toBe(409);
    const completed = {
      id: 'evt_checkout_1',
      object: 'event',
      type: 'checkout.session.completed',
      created: Math.floor(Date.now() / 1000),
      data: { object: { id: 'cs_test_1', object: 'checkout.session', client_reference_id: org.id, customer: 'cus_test_1', subscription: 'sub_test_1', metadata: { organization_id: org.id, plan: 'monthly' } } },
    };
    expect((await postWebhook(ctx, completed)).statusCode).toBe(200);
    const res = await client.post(`${base}/billing/portal`);
    expect(res.statusCode).toBe(200);
    expect(provider.portalCalls[0]!.customerId).toBe('cus_test_1');
  });
});

describe('webhook', () => {
  it('rechaza firmas ausentes, inválidas o con otro secreto', async () => {
    const { org } = await setupOwner(ctx);
    const ev = subscriptionEvent('customer.subscription.updated', org.id, 'active');
    expect((await postWebhook(ctx, ev, '')).statusCode).toBe(400);
    expect((await postWebhook(ctx, ev, 't=1,v1=deadbeef')).statusCode).toBe(400);
    const other = signed(ev, 'whsec_otro_secreto_distinto_123456');
    const res = await ctx.app.inject({ method: 'POST', url: '/api/billing/webhook', headers: { 'content-type': 'application/json', 'stripe-signature': other.header }, payload: other.payload });
    expect(res.statusCode).toBe(400);
    // cuerpo alterado tras firmar
    const s = signed(ev);
    const tampered = await ctx.app.inject({
      method: 'POST',
      url: '/api/billing/webhook',
      headers: { 'content-type': 'application/json', 'stripe-signature': s.header },
      payload: s.payload.replace('active', 'trialing'),
    });
    expect(tampered.statusCode).toBe(400);
    const o = await ctx.deps.db.selectFrom('organizations').selectAll().where('id', '=', org.id).executeTakeFirstOrThrow();
    expect(o.subscription_status).toBe('trialing');
  });

  it('activa la suscripción y es idempotente', async () => {
    const { client, base, org } = await setupOwner(ctx);
    const ev = subscriptionEvent('customer.subscription.created', org.id, 'active', { price: 'price_annual_test' });
    const r1 = await postWebhook(ctx, ev);
    expect(r1.statusCode).toBe(200);
    expect(json(r1)).toEqual({ received: true, duplicate: false });
    const r2 = await postWebhook(ctx, ev);
    expect(json(r2)).toEqual({ received: true, duplicate: true });
    const sub = json(await client.get(`${base}/billing`)).subscription;
    expect(sub).toMatchObject({ status: 'active', readOnly: false, plan: 'annual', cancelAtPeriodEnd: false, hasBillingAccount: true });
    expect(sub.currentPeriodEnd).not.toBeNull();
    const events = await ctx.deps.db.selectFrom('stripe_events').selectAll().execute();
    expect(events).toHaveLength(1);
    const audits = await ctx.deps.db.selectFrom('audit_events').selectAll().where('event', '=', 'billing.subscription_updated').execute();
    expect(audits).toHaveLength(1);
    // con suscripción ya existente no se abre otro Checkout
    expect((await client.post(`${base}/billing/checkout`, { plan: 'monthly' })).statusCode).toBe(409);
  });

  it('ignora eventos desordenados más antiguos', async () => {
    const { client, base, org } = await setupOwner(ctx);
    const now = Math.floor(Date.now() / 1000);
    await postWebhook(ctx, subscriptionEvent('customer.subscription.updated', org.id, 'active', { created: now }));
    await postWebhook(ctx, subscriptionEvent('customer.subscription.updated', org.id, 'incomplete', { created: now - 100 }));
    expect(json(await client.get(`${base}/billing`)).subscription.status).toBe('active');
  });

  it('eventos de organizaciones desconocidas se aceptan sin efecto', async () => {
    const res = await postWebhook(ctx, subscriptionEvent('customer.subscription.updated', '00000000-0000-4000-8000-000000000000', 'active'));
    expect(res.statusCode).toBe(200);
  });
});

describe('solo lectura por suscripción', () => {
  async function expectReadOnly(client: Awaited<ReturnType<typeof setupOwner>>['client'], base: string) {
    const create = await client.post(`${base}/records`, { type: 'plagas', data: { result: 'sin_indicios' } });
    expect(create.statusCode).toBe(402);
    expect(json(create).error.code).toBe('READ_ONLY');
    expect((await client.patch(base, { name: 'X' })).statusCode).toBe(402);
    expect((await client.post(`${base}/staff`, { name: 'X' })).statusCode).toBe(402);
    expect((await client.post(`${base}/equipment`, { name: 'X', type: 'camara', maxTemp: 4 })).statusCode).toBe(402);
    expect((await client.post(`${base}/devices`, { name: 'X' })).statusCode).toBe(402);
    expect((await client.patch(`${base}/public-menu`, { enabled: true })).statusCode).toBe(402);
    // lectura y exportación siguen funcionando
    expect((await client.get(`${base}/records`)).statusCode).toBe(200);
    expect((await client.get(`${base}/tasks/today`)).statusCode).toBe(200);
    expect((await client.get(`${base}/export`)).statusCode).toBe(200);
    expect((await client.get(`${base}/reports/csv?from=2026-01-01&to=2026-01-31`)).statusCode).toBe(200);
    expect((await client.get(`${base}/reports/pdf?from=2026-01-01&to=2026-01-31`)).statusCode).toBe(200);
    expect(json(await client.get(base)).organization.subscription.readOnly).toBe(true);
  }

  it('prueba caducada → solo lectura; Checkout sigue disponible', async () => {
    const { client, base, org } = await setupOwner(ctx);
    await client.post(`${base}/records`, { type: 'plagas', data: { result: 'sin_indicios' } });
    await ctx.deps.db.updateTable('organizations').set({ trial_ends_at: new Date(Date.now() - 1000) }).where('id', '=', org.id).execute();
    await expectReadOnly(client, base);
    expect(json(await client.get(`${base}/billing`)).subscription.status).toBe('trial_expired');
    const co = await client.post(`${base}/billing/checkout`, { plan: 'monthly' });
    expect(co.statusCode).toBe(200);
    expect(provider.checkoutCalls[0]!.trialEnd).toBeNull();
  });

  it.each(['past_due', 'unpaid', 'canceled'])('suscripción %s → solo lectura; activa → vuelve a escritura', async (status) => {
    const { client, base, org } = await setupOwner(ctx);
    const type = status === 'canceled' ? 'customer.subscription.deleted' : 'customer.subscription.updated';
    await postWebhook(ctx, subscriptionEvent(type, org.id, status, { created: Math.floor(Date.now() / 1000) - 10 }));
    await expectReadOnly(client, base);
    await postWebhook(ctx, subscriptionEvent('customer.subscription.updated', org.id, 'active'));
    expect((await client.post(`${base}/records`, { type: 'plagas', data: { result: 'sin_indicios' } })).statusCode).toBe(201);
  });

  it('revocar dispositivos y salir del local siguen permitidos en solo lectura', async () => {
    const { client, base, org } = await setupOwner(ctx);
    const dev = json(await client.post(`${base}/devices`, { name: 'T' })).device;
    await ctx.deps.db.updateTable('organizations').set({ trial_ends_at: new Date(Date.now() - 1000) }).where('id', '=', org.id).execute();
    expect((await client.delete(`${base}/devices/${dev.id}`)).statusCode).toBe(204);
  });
});
