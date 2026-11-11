import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PASSWORD, addMember, closeTestApp, createTestApp, createUser, json, login, resetDb, setupOwner, testConfig, tokenFromMail, type TestCtx } from './helpers.js';
import { StripeBillingProvider } from '../src/modules/billing/provider.js';

const STRIPE_CFG = {
  secretKey: 'sk_test_51EnReglaDummyKeyForTests000',
  webhookSecret: 'whsec_test_c2VjcmV0LWRlLXBydWViYXMtZW5yZWdsYQ',
  priceMonthly: 'price_monthly_test',
  priceAnnual: 'price_annual_test',
};

/** Proveedor de Stripe con las llamadas de red sustituidas. */
class FakeStripeProvider extends StripeBillingProvider {
  cancelCalls: string[] = [];
  failCancel = false;
  override cancelSubscription(id: string): Promise<void> {
    this.cancelCalls.push(id);
    return this.failCancel ? Promise.reject(new Error('Stripe no responde')) : Promise.resolve();
  }
}

let ctx: TestCtx;
let provider: FakeStripeProvider;
beforeAll(async () => {
  provider = new FakeStripeProvider(STRIPE_CFG);
  ctx = await createTestApp({ billing: provider });
});
afterAll(async () => closeTestApp(ctx));
beforeEach(async () => {
  await resetDb(ctx);
  provider.cancelCalls = [];
  provider.failCancel = false;
});

const kiosk = (c: TestCtx, token: string) => c.app.inject({ method: 'GET', url: '/api/kiosk/context', headers: { authorization: `Bearer ${token}` } });

describe('H2 los tokens de kiosko de un miembro expulsado dejan de funcionar', () => {
  it('al expulsar a un encargado se revocan sus dispositivos (con auditoría); los demás siguen', async () => {
    const { client, base, org } = await setupOwner(ctx);
    const { client: mgr, user: mgrUser } = await addMember(ctx, org.id, 'm@example.com', 'manager');
    const mine = json(await mgr.post(`${base}/devices`, { name: 'Tablet del encargado' }));
    const owners = json(await client.post(`${base}/devices`, { name: 'Tablet del owner' }));
    expect(mine.device.createdByName).toBe('m');
    const list = json(await client.get(`${base}/devices`)).items;
    expect(list.map((d: { createdByName: string }) => d.createdByName).sort()).toEqual(['m', 'owner']);
    expect((await kiosk(ctx, mine.token)).statusCode).toBe(200);

    expect((await client.delete(`${base}/members/${mgrUser.id}`)).statusCode).toBe(204);
    expect((await kiosk(ctx, mine.token)).statusCode).toBe(401);
    expect((await kiosk(ctx, owners.token)).statusCode).toBe(200);
    const revoked = json(await client.get(`${base}/devices`)).items.find((d: { id: string }) => d.id === mine.device.id);
    expect(revoked.active).toBe(false);
    const audit = await ctx.deps.db.selectFrom('audit_events').selectAll().where('event', '=', 'device.revoked_with_member').execute();
    expect(audit).toHaveLength(1);
    expect(audit[0]!.metadata).toMatchObject({ deviceId: mine.device.id, createdBy: mgrUser.id, reason: 'member_removed' });
  });

  it('también cuando el miembro sale por su cuenta o borra su cuenta', async () => {
    const { base, org } = await setupOwner(ctx);
    const a = await addMember(ctx, org.id, 'a@example.com', 'manager');
    const b = await addMember(ctx, org.id, 'b@example.com', 'manager');
    const ta = json(await a.client.post(`${base}/devices`, { name: 'A' })).token as string;
    const tb = json(await b.client.post(`${base}/devices`, { name: 'B' })).token as string;
    expect((await a.client.delete(`${base}/members/${a.user.id}`)).statusCode).toBe(204);
    expect((await kiosk(ctx, ta)).statusCode).toBe(401);
    expect((await b.client.delete('/api/account', { password: PASSWORD })).statusCode).toBe(204);
    expect((await kiosk(ctx, tb)).statusCode).toBe(401);
  });
});

describe('H5 invitaciones: límites y emails sin texto libre en el asunto', () => {
  it('máx. 3 invitaciones/día al mismo destinatario por local', async () => {
    const { client, base } = await setupOwner(ctx);
    const codes: number[] = [];
    for (let i = 0; i < 5; i++) codes.push((await client.post(`${base}/invitations`, { email: 'spam@example.com' })).statusCode);
    expect(codes).toEqual([201, 201, 201, 429, 429]);
    expect(ctx.mailer.outbox.filter((m) => m.to === 'spam@example.com')).toHaveLength(3);
  });

  it('límites diarios por local (20) y por usuario (30)', async () => {
    const rl = testConfig().rateLimits;
    expect(rl.inviteRecipient).toEqual({ limit: 3, windowSeconds: 86400 });
    expect(rl.inviteOrg).toEqual({ limit: 20, windowSeconds: 86400 });
    expect(rl.inviteUser).toEqual({ limit: 30, windowSeconds: 86400 });
    const tight = await createTestApp({ config: { rateLimits: { ...rl, inviteOrg: { limit: 2, windowSeconds: 86400 }, inviteUser: { limit: 3, windowSeconds: 86400 } } } });
    try {
      await resetDb(tight);
      const { client, base } = await setupOwner(tight);
      const codes: number[] = [];
      for (let i = 0; i < 3; i++) codes.push((await client.post(`${base}/invitations`, { email: `p${i}@example.com` })).statusCode);
      expect(codes).toEqual([201, 201, 429]);
      // Mismo usuario en otro local: lleva 2 contadas como usuario (la 3.ª la cortó el límite del local), le queda 1.
      const other = json(await client.post('/api/orgs', { name: 'Otro', businessType: 'bar' })).organization.id;
      expect((await client.post(`/api/orgs/${other}/invitations`, { email: 'q1@example.com' })).statusCode).toBe(201);
      expect((await client.post(`/api/orgs/${other}/invitations`, { email: 'q2@example.com' })).statusCode).toBe(429);
    } finally {
      await closeTestApp(tight);
    }
  });

  it('el asunto no lleva texto libre; en el cuerpo va acotado, entre comillas y sin URLs enlazables', async () => {
    const { client, base, org } = await setupOwner(ctx);
    const evilOrg = 'Premio! Reclama en http://evil.example.com/premio ' + 'x'.repeat(200);
    await ctx.deps.db.updateTable('organizations').set({ name: evilOrg }).where('id', '=', org.id).execute();
    await client.patch('/api/account', { name: 'Soporte <b>www.phish.example</b>' });
    expect((await client.post(`${base}/invitations`, { email: 'i@example.com' })).statusCode).toBe(201);
    const m = ctx.mailer.outbox.find((x) => x.to === 'i@example.com')!;
    expect(m.subject).toBe('Invitación para colaborar en un local · EnRegla');
    for (const part of [m.text, m.html]) {
      expect(part).not.toContain('http://evil.example.com');
      expect(part).not.toContain('www.phish.example');
      expect(part).not.toContain('x'.repeat(100));
    }
    expect(m.text).toContain('«Premio! Reclama en http:​/​/​evil.​example.​com/​premio');
    expect(m.html).not.toContain('<b>');
    expect(m.html).toContain('&lt;b&gt;');
    // El único enlace del email es el de la aplicación.
    expect([...m.html.matchAll(/href="([^"]+)"/g)].map((x) => x[1]!.split('#')[0])).toEqual(['http://localhost:5173/invitacion']);
    expect(tokenFromMail(ctx.mailer, 'i@example.com')).toBeTypeOf('string');
  });
});

describe('H7 la prueba gratuita es una por cuenta', () => {
  it('la primera organización inicia 14 días; las siguientes heredan la misma fecha', async () => {
    await createUser(ctx, 'u@example.com');
    const c = await login(ctx, 'u@example.com');
    const a = json(await c.post('/api/orgs', { name: 'A', businessType: 'bar' })).organization;
    await new Promise((r) => setTimeout(r, 30));
    const b = json(await c.post('/api/orgs', { name: 'B', businessType: 'bar' })).organization;
    expect(b.subscription.trialEndsAt).toBe(a.subscription.trialEndsAt);
    const u = await ctx.deps.db.selectFrom('users').select('trial_ends_at').where('email', '=', 'u@example.com').executeTakeFirstOrThrow();
    expect(u.trial_ends_at!.toISOString()).toBe(a.subscription.trialEndsAt);
  });

  it('si la prueba de la cuenta ya caducó, el local nace en solo lectura pero con la plantilla', async () => {
    const user = await createUser(ctx, 'u@example.com');
    await ctx.deps.db.updateTable('users').set({ trial_ends_at: new Date(Date.now() - 1000) }).where('id', '=', user.id).execute();
    const c = await login(ctx, 'u@example.com');
    const res = await c.post('/api/orgs', { name: 'Nuevo', businessType: 'restaurante' });
    expect(res.statusCode).toBe(201);
    const org = json(res).organization;
    expect(org.subscription).toMatchObject({ status: 'trial_expired', readOnly: true });
    expect(json(await c.get(`/api/orgs/${org.id}/equipment`)).items.length).toBeGreaterThan(0);
    expect((await c.post(`/api/orgs/${org.id}/records`, { type: 'plagas', data: { result: 'sin_indicios' } })).statusCode).toBe(402);
  });

  it('borrar y recrear locales (o crearlos en paralelo) no reinicia la prueba', async () => {
    const user = await createUser(ctx, 'u@example.com');
    const c = await login(ctx, 'u@example.com');
    const created = await Promise.all([1, 2, 3].map((i) => c.post('/api/orgs', { name: `L${i}`, businessType: 'bar' })));
    const ends = new Set(created.map((r) => json(r).organization.subscription.trialEndsAt));
    expect(ends.size).toBe(1);
    await ctx.deps.db.updateTable('users').set({ trial_ends_at: new Date(Date.now() - 1000) }).where('id', '=', user.id).execute();
    for (const r of created) await c.delete(`/api/orgs/${json(r).organization.id}`, { password: PASSWORD });
    const again = json(await c.post('/api/orgs', { name: 'Otra vez', businessType: 'bar' })).organization;
    expect(again.subscription.readOnly).toBe(true);
  });
});

describe('H8 borrar un local cancela su suscripción de Stripe', () => {
  async function withSubscription(status: string) {
    const owner = await setupOwner(ctx);
    await ctx.deps.db
      .updateTable('organizations')
      .set({ subscription_status: status, stripe_subscription_id: 'sub_live_1', stripe_customer_id: 'cus_1' })
      .where('id', '=', owner.org.id)
      .execute();
    return owner;
  }

  it.each(['active', 'trialing', 'past_due'])('suscripción %s: se cancela en Stripe y después queda pendiente de eliminación', async (status) => {
    const { client, base, org } = await withSubscription(status);
    expect((await client.delete(base, { password: PASSWORD })).statusCode).toBe(204);
    expect(provider.cancelCalls).toEqual(['sub_live_1']);
    const o = await ctx.deps.db.selectFrom('organizations').selectAll().where('id', '=', org.id).executeTakeFirstOrThrow();
    expect(o.deletion_scheduled_at).not.toBeNull();
    expect(o.subscription_status).toBe('canceled');
  });

  it('si la cancelación falla NO se borra y se devuelve un error claro', async () => {
    const { client, base, org } = await withSubscription('active');
    provider.failCancel = true;
    const res = await client.delete(base, { password: PASSWORD });
    expect(res.statusCode).toBe(502);
    expect(json(res).error.code).toBe('BILLING_ERROR');
    expect(json(res).error.message).toMatch(/NO se ha eliminado/);
    expect(await ctx.deps.db.selectFrom('organizations').select('id').where('id', '=', org.id).executeTakeFirst()).toBeDefined();
  });

  it('una suscripción ya cancelada no se vuelve a cancelar; sin suscripción no se llama a Stripe', async () => {
    const { client, base } = await withSubscription('canceled');
    expect((await client.delete(base, { password: PASSWORD })).statusCode).toBe(204);
    const other = await setupOwner(ctx, 'otro@example.com');
    expect((await other.client.delete(other.base, { password: PASSWORD })).statusCode).toBe(204);
    expect(provider.cancelCalls).toEqual([]);
  });

  it('sin Stripe configurado y con suscripción viva, no se borra', async () => {
    const nb = await createTestApp({ billing: null });
    try {
      const { client, base, org } = await setupOwner(nb, 'nb@example.com');
      await nb.deps.db.updateTable('organizations').set({ subscription_status: 'active', stripe_subscription_id: 'sub_x' }).where('id', '=', org.id).execute();
      const res = await client.delete(base, { password: PASSWORD });
      expect(res.statusCode).toBe(503);
      expect(await nb.deps.db.selectFrom('organizations').select('id').where('id', '=', org.id).executeTakeFirst()).toBeDefined();
    } finally {
      await closeTestApp(nb);
    }
  });

  it('borrar la cuenta nunca arrastra locales: si es el único propietario, 409', async () => {
    const { client } = await withSubscription('active');
    expect((await client.delete('/api/account', { password: PASSWORD })).statusCode).toBe(409);
    expect(provider.cancelCalls).toEqual([]);
  });
});

describe('H12 carrera del último propietario', () => {
  async function twoOwners() {
    const a = await setupOwner(ctx, 'a@example.com');
    const b = await addMember(ctx, a.org.id, 'b@example.com', 'owner');
    return { a, b };
  }
  const ownerCount = async (orgId: string) =>
    (await ctx.deps.db.selectFrom('memberships').select('user_id').where('organization_id', '=', orgId).where('role', '=', 'owner').execute()).length;

  it('dos owners saliendo a la vez: siempre queda uno (repetido)', async () => {
    for (let i = 0; i < 12; i++) {
      await resetDb(ctx);
      const { a, b } = await twoOwners();
      const [r1, r2] = await Promise.all([a.client.delete(`${a.base}/members/${a.user.id}`), b.client.delete(`${a.base}/members/${b.user.id}`)]);
      expect([r1.statusCode, r2.statusCode].sort()).toEqual([204, 409]);
      expect(await ownerCount(a.org.id)).toBe(1);
    }
  });

  it('degradarse mutuamente a la vez: siempre queda uno (repetido)', async () => {
    for (let i = 0; i < 12; i++) {
      await resetDb(ctx);
      const { a, b } = await twoOwners();
      const [r1, r2] = await Promise.all([
        a.client.patch(`${a.base}/members/${b.user.id}`, { role: 'manager' }),
        b.client.patch(`${a.base}/members/${a.user.id}`, { role: 'manager' }),
      ]);
      expect([r1.statusCode, r2.statusCode].sort()).toEqual([200, 409]);
      expect(await ownerCount(a.org.id)).toBe(1);
    }
  });

  it('los dos owners borran su cuenta a la vez: siempre queda uno (repetido)', async () => {
    for (let i = 0; i < 12; i++) {
      await resetDb(ctx);
      const { a, b } = await twoOwners();
      const [r1, r2] = await Promise.all([a.client.delete('/api/account', { password: PASSWORD }), b.client.delete('/api/account', { password: PASSWORD })]);
      expect([r1.statusCode, r2.statusCode].sort()).toEqual([204, 409]);
      expect(await ownerCount(a.org.id)).toBe(1);
    }
  });
});

describe('H13 carta pública en solo lectura', () => {
  it('se puede desactivar siempre y no se sirve mientras el local esté en solo lectura', async () => {
    const { client, base, org } = await setupOwner(ctx);
    const slug = json(await client.patch(`${base}/public-menu`, { enabled: true })).publicMenu.slug as string;
    const pub = () => ctx.app.inject({ method: 'GET', url: `/api/public/menu/${slug}` });
    expect((await pub()).statusCode).toBe(200);
    await ctx.deps.db.updateTable('organizations').set({ trial_ends_at: new Date(Date.now() - 1000) }).where('id', '=', org.id).execute();
    expect((await pub()).statusCode).toBe(404);
    // Reactivar la suscripción vuelve a servirla.
    await ctx.deps.db.updateTable('organizations').set({ subscription_status: 'active', stripe_subscription_id: 'sub_1' }).where('id', '=', org.id).execute();
    expect((await pub()).statusCode).toBe(200);
    await ctx.deps.db.updateTable('organizations').set({ subscription_status: 'canceled' }).where('id', '=', org.id).execute();
    expect((await client.patch(`${base}/public-menu`, { enabled: true })).statusCode).toBe(402);
    const off = await client.patch(`${base}/public-menu`, { enabled: false });
    expect(off.statusCode).toBe(200);
    expect(json(off).publicMenu.enabled).toBe(false);
    await ctx.deps.db.updateTable('organizations').set({ subscription_status: 'active' }).where('id', '=', org.id).execute();
    expect((await pub()).statusCode).toBe(404);
  });
});
