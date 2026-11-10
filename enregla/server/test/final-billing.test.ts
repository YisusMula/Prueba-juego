/**
 * Auditoría de seguridad final — facturación: M-1 (suscripción huérfana), M-2 (cliente que paga en
 * solo lectura / cobro doble), B-6 (23505 en el webhook) e I-3 (past_due prolongado).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import Stripe from 'stripe';
import { PASSWORD, addMember, closeTestApp, createTestApp, json, resetDb, setupOwner, type TestCtx } from './helpers.js';
import { StripeBillingProvider, type CheckoutParams, type SubscriptionState } from '../src/modules/billing/provider.js';
import { runRetention } from '../src/modules/reminders/scheduler.js';

const WEBHOOK_SECRET = 'whsec_test_c2VjcmV0LWRlLXBydWViYXMtZW5yZWdsYQ';
const STRIPE_CFG = {
  secretKey: 'sk_test_51EnReglaDummyKeyForTests000',
  webhookSecret: WEBHOOK_SECRET,
  priceMonthly: 'price_monthly_test',
  priceAnnual: 'price_annual_test',
};

/** Stripe falso: verificación de firma real; suscripciones, Checkout y cancelaciones en memoria. */
class FakeStripe extends StripeBillingProvider {
  subs = new Map<string, SubscriptionState>();
  checkoutCalls: CheckoutParams[] = [];
  cancelCalls: string[] = [];
  expireCalls: string[] = [];
  failCancel = false;
  failExpire = false;
  private seq = 0;
  setSub(id: string, status: string, orgId: string | null, opts: Partial<SubscriptionState> = {}) {
    this.subs.set(id, {
      id,
      status,
      customerId: 'cus_final_1',
      metadata: orgId ? { organization_id: orgId } : {},
      cancelAtPeriodEnd: false,
      currentPeriodEnd: Math.floor(Date.now() / 1000) + 30 * 86400,
      priceId: 'price_monthly_test',
      created: Math.floor(Date.now() / 1000),
      ...opts,
    });
  }
  override retrieveSubscription(id: string) {
    return Promise.resolve(this.subs.get(id) ?? null);
  }
  override cancelSubscription(id: string) {
    this.cancelCalls.push(id);
    if (this.failCancel) return Promise.reject(new Error('Stripe no responde'));
    const cur = this.subs.get(id);
    if (cur) this.subs.set(id, { ...cur, status: 'canceled' });
    return Promise.resolve();
  }
  override createCheckoutSession(p: CheckoutParams) {
    this.checkoutCalls.push(p);
    this.seq += 1;
    return Promise.resolve({ url: `https://checkout.stripe.com/c/pay/cs_final_${this.seq}`, id: `cs_final_${this.seq}` });
  }
  override expireCheckoutSession(id: string) {
    this.expireCalls.push(id);
    return this.failExpire ? Promise.reject(new Error('Stripe no responde')) : Promise.resolve();
  }
  reset() {
    this.subs.clear();
    this.checkoutCalls = [];
    this.cancelCalls = [];
    this.expireCalls = [];
    this.failCancel = false;
    this.failExpire = false;
  }
}

const signer = new Stripe('sk_test_signer');
let ctx: TestCtx;
let stripe: FakeStripe;
beforeAll(async () => {
  stripe = new FakeStripe(STRIPE_CFG);
  ctx = await createTestApp({ billing: stripe });
});
afterAll(async () => closeTestApp(ctx));
beforeEach(async () => {
  await resetDb(ctx);
  stripe.reset();
});

let seq = 0;
/** Evento de Stripe firmado; el webhook recupera el estado ACTUAL del Stripe falso. */
async function webhook(type: string, object: Record<string, unknown>) {
  seq += 1;
  const payload = JSON.stringify({ id: `evt_final_${seq}_${Date.now()}`, object: 'event', type, created: Math.floor(Date.now() / 1000), data: { object } });
  const header = signer.webhooks.generateTestHeaderString({ payload, secret: WEBHOOK_SECRET });
  return ctx.app.inject({ method: 'POST', url: '/api/billing/webhook', headers: { 'content-type': 'application/json', 'stripe-signature': header }, payload });
}
const subEvent = (type: string, subId: string, orgId: string) => webhook(type, { id: subId, object: 'subscription', customer: 'cus_final_1', metadata: { organization_id: orgId } });
const invoiceEvent = (type: string, subId: string, orgId: string) =>
  webhook(type, { id: `in_${subId}`, object: 'invoice', customer: 'cus_final_1', parent: { subscription_details: { subscription: subId, metadata: { organization_id: orgId } } } });
const checkoutCompleted = (sessionId: string, subId: string, orgId: string) =>
  webhook('checkout.session.completed', { id: sessionId, object: 'checkout.session', client_reference_id: orgId, customer: 'cus_final_1', subscription: subId, metadata: { organization_id: orgId } });
const orgRow = (id: string) => ctx.deps.db.selectFrom('organizations').selectAll().where('id', '=', id).executeTakeFirst();
const auditOf = (event: string) => ctx.deps.db.selectFrom('audit_events').selectAll().where('event', '=', event).orderBy('id').execute();

describe('M-1 suscripción de Stripe huérfana tras eliminar el local', () => {
  it('escenario completo: checkout abierto → borrado → el checkout se completa → la suscripción se CANCELA, no se activa', async () => {
    const { client, base, org } = await setupOwner(ctx);
    // (1) Checkout abierto: se guarda su id.
    expect((await client.post(`${base}/billing/checkout`, { plan: 'monthly' })).statusCode).toBe(200);
    expect((await orgRow(org.id))!.stripe_checkout_session_id).toBe('cs_final_1');
    // (2) Borrado: (c) la sesión abierta se expira en Stripe y se olvida.
    expect((await client.delete(base, { password: PASSWORD })).statusCode).toBe(204);
    expect(stripe.expireCalls).toEqual(['cs_final_1']);
    expect((await orgRow(org.id))!.stripe_checkout_session_id).toBeNull();
    // (3) Aun así llega la suscripción viva (p. ej. el pago se completó justo antes de expirar).
    stripe.setSub('sub_orphan', 'active', org.id);
    const res = await checkoutCompleted('cs_final_1', 'sub_orphan', org.id);
    expect(res.statusCode).toBe(200);
    // (b) Se cancela en Stripe (sin reembolso automático), con auditoría, y el local NO se activa.
    expect(stripe.cancelCalls).toEqual(['sub_orphan']);
    const o = (await orgRow(org.id))!;
    expect(o.subscription_status).toBe('trialing');
    expect(o.stripe_subscription_id).toBeNull();
    const a = await auditOf('billing.subscription_canceled');
    expect(a.at(-1)!.metadata).toMatchObject({ reason: 'organization_pending_deletion', subscriptionId: 'sub_orphan', refund: 'manual_review' });
    expect(await ctx.deps.db.selectFrom('stripe_events').selectAll().execute()).toHaveLength(1);
    // El evento de cancelación posterior no cambia el local (no es su suscripción).
    expect((await subEvent('customer.subscription.deleted', 'sub_orphan', org.id)).statusCode).toBe(200);
    expect((await orgRow(org.id))!.subscription_status).toBe('trialing');
    // (d) Restaurar no revive nada: ni suscripción ni Checkout.
    const restored = json(await client.post(`${base}/restore`)).organization;
    expect(restored.subscription.status).toBe('trialing');
    expect((await orgRow(org.id))!).toMatchObject({ stripe_subscription_id: null, stripe_checkout_session_id: null });
  });

  it('(b) una suscripción viva de un local que ya no existe se cancela (si falla, 503 y Stripe reintenta)', async () => {
    const gone = '00000000-0000-4000-8000-0000000000aa';
    stripe.setSub('sub_gone', 'active', gone);
    stripe.failCancel = true;
    expect((await subEvent('customer.subscription.created', 'sub_gone', gone)).statusCode).toBe(503);
    expect(await ctx.deps.db.selectFrom('stripe_events').selectAll().execute()).toHaveLength(0);
    stripe.failCancel = false;
    expect((await subEvent('customer.subscription.created', 'sub_gone', gone)).statusCode).toBe(200);
    expect(stripe.subs.get('sub_gone')!.status).toBe('canceled');
    expect((await auditOf('billing.subscription_canceled'))[0]).toMatchObject({ organization_id: gone });
  });

  it('(c) si no se puede expirar el Checkout abierto, el local NO pasa a pendiente', async () => {
    const { client, base, org } = await setupOwner(ctx);
    await client.post(`${base}/billing/checkout`, { plan: 'annual' });
    stripe.failExpire = true;
    const res = await client.delete(base, { password: PASSWORD });
    expect(res.statusCode).toBe(502);
    expect(json(res).error.message).toMatch(/NO se ha eliminado/);
    expect((await orgRow(org.id))!.deletion_scheduled_at).toBeNull();
  });

  it('(a) DELETE /permanent cancela en Stripe una suscripción viva antes de borrar; si falla, NO se borra', async () => {
    const { client, base, org } = await setupOwner(ctx);
    expect((await client.delete(base, { password: PASSWORD })).statusCode).toBe(204);
    // El webhook antiguo la activó en el local pendiente (o el estado local está desfasado).
    await ctx.deps.db.updateTable('organizations').set({ stripe_subscription_id: 'sub_live', subscription_status: 'canceled' }).where('id', '=', org.id).execute();
    stripe.setSub('sub_live', 'active', org.id);
    stripe.failCancel = true;
    const fail = await client.delete(`${base}/permanent`, { password: PASSWORD });
    expect(fail.statusCode).toBe(502);
    expect(json(fail).error.code).toBe('BILLING_ERROR');
    expect(await orgRow(org.id)).toBeDefined();
    stripe.failCancel = false;
    expect((await client.delete(`${base}/permanent`, { password: PASSWORD })).statusCode).toBe(204);
    expect(stripe.cancelCalls).toEqual(['sub_live', 'sub_live']);
    expect(stripe.subs.get('sub_live')!.status).toBe('canceled');
    expect(await orgRow(org.id)).toBeUndefined();
  });

  it('(a) la purga diaria cancela antes de borrar; si la cancelación falla, lo deja para el día siguiente', async () => {
    const { client, base, org } = await setupOwner(ctx);
    expect((await client.delete(base, { password: PASSWORD })).statusCode).toBe(204);
    await ctx.deps.db
      .updateTable('organizations')
      .set({ stripe_subscription_id: 'sub_live', subscription_status: 'active', deletion_scheduled_at: new Date(Date.now() - 1000) })
      .where('id', '=', org.id)
      .execute();
    stripe.setSub('sub_live', 'active', org.id);
    stripe.failCancel = true;
    const errors: string[] = [];
    const log = { warn: () => undefined, error: (_o: object, msg: string) => void errors.push(msg) };
    const r1 = await runRetention(ctx.deps, { force: true, log });
    expect(r1).toMatchObject({ organizations: 0, organizationsDeferred: 1 });
    expect(errors.join()).toMatch(/aplazada/);
    expect(await orgRow(org.id)).toBeDefined();
    stripe.failCancel = false;
    const r2 = await runRetention(ctx.deps, { force: true, log });
    expect(r2).toMatchObject({ organizations: 1, organizationsDeferred: 0 });
    expect(stripe.subs.get('sub_live')!.status).toBe('canceled');
    expect(await orgRow(org.id)).toBeUndefined();
  });
});

describe('M-2 un cliente que paga no queda en solo lectura (y nunca dos suscripciones vivas)', () => {
  async function incompleteA() {
    const owner = await setupOwner(ctx);
    stripe.setSub('sub_A', 'incomplete', owner.org.id, { created: 1_000 });
    expect((await subEvent('customer.subscription.created', 'sub_A', owner.org.id)).statusCode).toBe(200);
    expect((await orgRow(owner.org.id))!.subscription_status).toBe('incomplete');
    return owner;
  }

  it('orden 1: Checkout nuevo anula A; B (active) llega antes que la cancelación de A → activo con B', async () => {
    const { client, base, org } = await incompleteA();
    expect((await client.post(`${base}/billing/checkout`, { plan: 'monthly' })).statusCode).toBe(200);
    // Al crear el Checkout se anula antes la suscripción incompleta.
    expect(stripe.cancelCalls).toEqual(['sub_A']);
    stripe.setSub('sub_B', 'active', org.id, { created: 2_000 });
    expect((await subEvent('customer.subscription.created', 'sub_B', org.id)).statusCode).toBe(200);
    expect((await orgRow(org.id))!).toMatchObject({ stripe_subscription_id: 'sub_B', subscription_status: 'active' });
    // Llega tarde la cancelación de A: no pisa a B.
    expect((await subEvent('customer.subscription.deleted', 'sub_A', org.id)).statusCode).toBe(200);
    const sub = json(await client.get(`${base}/billing`)).subscription;
    expect(sub).toMatchObject({ status: 'active', readOnly: false });
  });

  it('orden 2: A pasa a incomplete_expired antes de que llegue B → B la sustituye', async () => {
    const { client, base, org } = await incompleteA();
    expect((await client.post(`${base}/billing/checkout`, { plan: 'monthly' })).statusCode).toBe(200);
    stripe.setSub('sub_A', 'incomplete_expired', org.id, { created: 1_000 });
    await subEvent('customer.subscription.updated', 'sub_A', org.id);
    expect(json(await client.get(`${base}/billing`)).subscription.readOnly).toBe(true);
    stripe.setSub('sub_B', 'active', org.id, { created: 2_000 });
    await subEvent('customer.subscription.created', 'sub_B', org.id);
    expect(json(await client.get(`${base}/billing`)).subscription).toMatchObject({ status: 'active', readOnly: false });
  });

  it('B viva sustituye a una A incompleta aunque A no se anulara (y A se cancela para que no cobre)', async () => {
    const { client, base, org } = await incompleteA();
    stripe.setSub('sub_B', 'active', org.id, { created: 2_000 });
    expect((await subEvent('customer.subscription.created', 'sub_B', org.id)).statusCode).toBe(200);
    expect((await orgRow(org.id))!).toMatchObject({ stripe_subscription_id: 'sub_B', subscription_status: 'active' });
    expect(stripe.cancelCalls).toEqual(['sub_A']);
    // Y si A expira después, no cambia nada.
    stripe.setSub('sub_A', 'incomplete_expired', org.id, { created: 1_000 });
    await subEvent('customer.subscription.updated', 'sub_A', org.id);
    expect(json(await client.get(`${base}/billing`)).subscription).toMatchObject({ status: 'active', readOnly: false });
  });

  it('dos suscripciones vivas: se conserva la más reciente y se cancela la otra (en ambos órdenes)', async () => {
    const { org } = await setupOwner(ctx);
    stripe.setSub('sub_old', 'active', org.id, { created: 1_000 });
    await subEvent('customer.subscription.created', 'sub_old', org.id);
    stripe.setSub('sub_new', 'active', org.id, { created: 2_000 });
    await subEvent('customer.subscription.created', 'sub_new', org.id);
    expect((await orgRow(org.id))!).toMatchObject({ stripe_subscription_id: 'sub_new', subscription_status: 'active' });
    expect(stripe.cancelCalls).toEqual(['sub_old']);

    const other = await setupOwner(ctx, 'otra@example.com');
    stripe.setSub('sub_x2', 'active', other.org.id, { created: 5_000, customerId: 'cus_other' });
    await subEvent('customer.subscription.created', 'sub_x2', other.org.id);
    // Llega después una MÁS ANTIGUA y viva: se cancela ella, la actual se conserva.
    stripe.setSub('sub_x1', 'active', other.org.id, { created: 4_000, customerId: 'cus_other' });
    await subEvent('customer.subscription.created', 'sub_x1', other.org.id);
    expect((await orgRow(other.org.id))!.stripe_subscription_id).toBe('sub_x2');
    expect(stripe.cancelCalls).toEqual(['sub_old', 'sub_x1']);
    const reasons = (await auditOf('billing.subscription_canceled')).map((a) => (a.metadata as { reason: string }).reason);
    expect(reasons).toEqual(['duplicate_subscription', 'duplicate_subscription']);
  });

  it('si no se puede anular la suscripción incompleta, no se abre otro Checkout (502 claro)', async () => {
    const { client, base } = await incompleteA();
    stripe.failCancel = true;
    const res = await client.post(`${base}/billing/checkout`, { plan: 'monthly' });
    expect(res.statusCode).toBe(502);
    expect(json(res).error.message).toMatch(/intento de pago anterior/);
    expect(stripe.checkoutCalls).toHaveLength(0);
  });
});

describe('B-6 webhook con la pista de un local y el cliente de otro', () => {
  it('la violación de único (23505) se registra y el evento se marca procesado con 200', async () => {
    const a = await setupOwner(ctx);
    const b = await setupOwner(ctx, 'b@example.com');
    await ctx.deps.db.updateTable('organizations').set({ stripe_customer_id: 'cus_de_a' }).where('id', '=', a.org.id).execute();
    stripe.setSub('sub_b', 'active', b.org.id, { customerId: 'cus_de_a' });
    const res = await subEvent('customer.subscription.created', 'sub_b', b.org.id);
    expect(res.statusCode).toBe(200);
    expect(await ctx.deps.db.selectFrom('stripe_events').selectAll().execute()).toHaveLength(1);
    expect((await orgRow(b.org.id))!.stripe_customer_id).toBeNull();
  });
});

describe('I-3 past_due prolongado pasa a solo lectura', () => {
  it('el webhook anota desde cuándo; más de 21 días en past_due → solo lectura', async () => {
    const { client, base, org } = await setupOwner(ctx);
    stripe.setSub('sub_pd', 'past_due', org.id);
    await subEvent('customer.subscription.updated', 'sub_pd', org.id);
    const since = (await orgRow(org.id))!.past_due_since;
    expect(since).not.toBeNull();
    // Otro evento en past_due conserva la fecha original.
    expect((await invoiceEvent('invoice.payment_failed', 'sub_pd', org.id)).statusCode).toBe(200);
    expect((await orgRow(org.id))!.past_due_since!.getTime()).toBe(since!.getTime());
    let sub = json(await client.get(`${base}/billing`)).subscription;
    expect(sub).toMatchObject({ status: 'past_due', readOnly: false, paymentFailed: true });
    expect((await client.post(`${base}/records`, { type: 'plagas', data: { result: 'sin_indicios' } })).statusCode).toBe(201);

    await ctx.deps.db.updateTable('organizations').set({ past_due_since: new Date(Date.now() - 22 * 86_400_000) }).where('id', '=', org.id).execute();
    sub = json(await client.get(`${base}/billing`)).subscription;
    expect(sub).toMatchObject({ status: 'past_due', readOnly: true, paymentFailed: true });
    expect((await client.post(`${base}/records`, { type: 'plagas', data: { result: 'sin_indicios' } })).statusCode).toBe(402);
    // Se paga: vuelve a escritura y se borra la marca.
    stripe.setSub('sub_pd', 'active', org.id);
    expect((await invoiceEvent('invoice.paid', 'sub_pd', org.id)).statusCode).toBe(200);
    expect((await orgRow(org.id))!.past_due_since).toBeNull();
    expect((await client.post(`${base}/records`, { type: 'plagas', data: { result: 'sin_indicios' } })).statusCode).toBe(201);
  });

  it('el plazo es configurable (PAST_DUE_READ_ONLY_DAYS)', async () => {
    const short = await createTestApp({ billing: stripe, env: { PAST_DUE_READ_ONLY_DAYS: '3' } });
    try {
      expect(short.config.billing.pastDueReadOnlyDays).toBe(3);
      const { client, base, org } = await setupOwner(short, 'corto@example.com');
      await short.deps.db
        .updateTable('organizations')
        .set({ subscription_status: 'past_due', stripe_subscription_id: 'sub_c', past_due_since: new Date(Date.now() - 4 * 86_400_000) })
        .where('id', '=', org.id)
        .execute();
      expect(json(await client.get(base)).organization.subscription.readOnly).toBe(true);
    } finally {
      await closeTestApp(short);
      // Restaura el valor por defecto para el resto de ficheros (se fija al construir la app).
      await closeTestApp(await createTestApp({ billing: stripe }));
    }
  });
});

describe('miembros sin permiso', () => {
  it('un manager no puede pedir la eliminación definitiva', async () => {
    const { client, base, org } = await setupOwner(ctx);
    const { client: mgr } = await addMember(ctx, org.id, 'm@example.com', 'manager');
    expect((await client.delete(base, { password: PASSWORD })).statusCode).toBe(204);
    expect((await mgr.delete(`${base}/permanent`, { password: PASSWORD })).statusCode).toBe(403);
  });
});
