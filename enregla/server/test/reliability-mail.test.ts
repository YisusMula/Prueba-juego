import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'kysely';
import { addMember, backdateConfig, closeTestApp, createTestApp, FIXED_NOW, FIXED_TODAY, json, PASSWORD, resetDb, setupOwner, type TestCtx } from './helpers.js';
import type { Mailer, MailMessage } from '../src/lib/mailer.js';
import { MAX_ATTEMPTS, processOutbox, purgeOutbox } from '../src/lib/outbox.js';
import { runReminderTick, runRetention, runTrialNotices } from '../src/modules/reminders/scheduler.js';
import { randomToken, sha256 } from '../src/lib/crypto.js';

/** SMTP que se puede "caer": mientras `down`, falla como un servidor que rechaza la conexión. */
class FlakyMailer implements Mailer {
  down = false;
  sent: MailMessage[] = [];
  attempts = 0;
  send(message: MailMessage): Promise<void> {
    this.attempts += 1;
    if (this.down) {
      return Promise.reject(Object.assign(new Error(`connect ECONNREFUSED 10.0.0.1:587 para ${message.to} https://x/#token=abc`), { code: 'ECONNREFUSED' }));
    }
    this.sent.push(message);
    return Promise.resolve();
  }
}

let ctx: TestCtx;
let mailer: FlakyMailer;
beforeAll(async () => {
  mailer = new FlakyMailer();
  ctx = await createTestApp({ now: () => FIXED_NOW, mailer });
});
afterAll(async () => closeTestApp(ctx));
beforeEach(async () => {
  await resetDb(ctx);
  mailer.down = false;
  mailer.sent = [];
  mailer.attempts = 0;
});

const makeDue = () => sql`UPDATE email_outbox SET next_attempt_at = now() - interval '1 second' WHERE status = 'pending'`.execute(ctx.deps.db);
const outbox = () => ctx.deps.db.selectFrom('email_outbox').selectAll().orderBy('created_at').execute();

describe('5. bandeja de salida de emails', () => {
  it('recordatorio: con el SMTP caído queda encolado (y marcado) sin SMTP en la transacción, y se reintenta', async () => {
    const owner = await setupOwner(ctx);
    await addMember(ctx, owner.org.id, 'm@example.com', 'manager');
    await ctx.deps.db.updateTable('organizations').set({ reminder_hour: 0 }).where('id', '=', owner.org.id).execute();
    await backdateConfig(ctx, owner.org.id);
    mailer.down = true;
    const r = await runReminderTick(ctx.deps);
    expect(r).toMatchObject({ ran: true, emailsQueued: 2, emailsSent: 0 });
    const o = await ctx.deps.db.selectFrom('organizations').select('last_reminder_on').where('id', '=', owner.org.id).executeTakeFirstOrThrow();
    expect(o.last_reminder_on).toBe(FIXED_TODAY);
    const rows = await outbox();
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row).toMatchObject({ status: 'pending', attempts: 1 });
      expect(row.next_attempt_at.getTime()).toBeGreaterThan(Date.now() + 20_000);
      // Error resumido sin datos sensibles.
      expect(row.last_error).toContain('ECONNREFUSED');
      expect(row.last_error).not.toMatch(/@|token=abc|https?:/);
    }
    // Un segundo tick el mismo día no duplica.
    expect((await runReminderTick(ctx.deps)).emailsQueued).toBe(0);
    // Vuelve el SMTP: hasta que vence el backoff no se reintenta; después, sí.
    mailer.down = false;
    expect((await processOutbox(ctx.deps.db, mailer)).sent).toBe(0);
    await makeDue();
    expect((await processOutbox(ctx.deps.db, mailer)).sent).toBe(2);
    expect(mailer.sent.map((m) => m.to).sort()).toEqual(['m@example.com', 'owner@example.com']);
    expect((await outbox()).every((x) => x.status === 'sent' && x.sent_at)).toBe(true);
  });

  it('emails transaccionales: con el SMTP caído no se pierden', async () => {
    await setupOwner(ctx);
    mailer.down = true;
    const c = await setupOwner(ctx, 'otro@example.com');
    const res = await c.client.post('/api/auth/password-reset/request', { email: 'otro@example.com' });
    expect(res.statusCode).toBe(202);
    expect(mailer.sent).toHaveLength(0);
    const rows = await outbox();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: 'pending', attempts: 1, to_address: 'otro@example.com' });
    mailer.down = false;
    await makeDue();
    await processOutbox(ctx.deps.db, mailer);
    expect(mailer.sent).toHaveLength(1);
    const token = /#token=([A-Za-z0-9_-]+)/.exec(mailer.sent[0]!.text)![1]!;
    expect((await c.client.post('/api/auth/password-reset/confirm', { token, password: 'Otra-Clave-Segura-99' })).statusCode).toBe(200);
  });

  it('con el SMTP en marcha el primer envío es inmediato (los tests pueden esperar el email)', async () => {
    const { client, base } = await setupOwner(ctx);
    const res = await client.post(`${base}/invitations`, { email: 'nuevo@example.com' });
    expect(res.statusCode).toBe(201);
    expect(mailer.sent.map((m) => m.to)).toEqual(['nuevo@example.com']);
    expect((await outbox())[0]).toMatchObject({ status: 'sent', attempts: 1 });
  });

  it('seguro con varias instancias: cada email se envía una sola vez', async () => {
    await ctx.deps.db
      .insertInto('email_outbox')
      .values(Array.from({ length: 30 }, (_, i) => ({ to_address: `u${i}@example.com`, subject: 's', text_body: 't', html_body: 'h', next_attempt_at: new Date(Date.now() - 1000) })))
      .execute();
    await Promise.all([1, 2, 3, 4].map(() => processOutbox(ctx.deps.db, mailer, { limit: 30 })));
    expect(mailer.sent).toHaveLength(30);
    expect(new Set(mailer.sent.map((m) => m.to)).size).toBe(30);
  });

  it('backoff creciente y descarte tras agotar los reintentos; purga del almacenamiento temporal', async () => {
    mailer.down = true;
    await ctx.deps.db.insertInto('email_outbox').values({ to_address: 'a@example.com', subject: 's', text_body: 't', html_body: 'h', next_attempt_at: new Date(Date.now() - 1000) }).execute();
    const waits: number[] = [];
    for (let i = 0; i < 3; i++) {
      await processOutbox(ctx.deps.db, mailer);
      const row = (await outbox())[0]!;
      waits.push(Math.round((row.next_attempt_at.getTime() - Date.now()) / 1000));
      await makeDue();
    }
    expect(waits[0]).toBeGreaterThanOrEqual(25); // ~30 s
    expect(waits[1]!).toBeGreaterThan(waits[0]!); // ~2 min
    expect(waits[2]!).toBeGreaterThan(waits[1]!); // ~10 min
    await ctx.deps.db.updateTable('email_outbox').set({ attempts: MAX_ATTEMPTS - 1 }).execute();
    await processOutbox(ctx.deps.db, mailer);
    expect((await outbox())[0]).toMatchObject({ status: 'failed', attempts: MAX_ATTEMPTS });

    // Purga: enviados > 6 h y fallidos > 3 días; los pendientes se conservan.
    await ctx.deps.db
      .insertInto('email_outbox')
      .values([
        { to_address: 'old-sent@example.com', subject: 's', text_body: 't', html_body: 'h', status: 'sent', sent_at: new Date(Date.now() - 7 * 3600_000) },
        { to_address: 'new-sent@example.com', subject: 's', text_body: 't', html_body: 'h', status: 'sent', sent_at: new Date(Date.now() - 3600_000) },
        { to_address: 'pending@example.com', subject: 's', text_body: 't', html_body: 'h', created_at: new Date(Date.now() - 10 * 86_400_000) },
      ])
      .execute();
    await ctx.deps.db.updateTable('email_outbox').set({ created_at: new Date(Date.now() - 4 * 86_400_000) }).where('status', '=', 'failed').execute();
    expect(await purgeOutbox(ctx.deps.db)).toBe(2);
    expect((await outbox()).map((r) => r.to_address).sort()).toEqual(['new-sent@example.com', 'pending@example.com']);
  });

  it('avisos de fin de prueba: 3 días antes y el día que caduca, una vez cada uno, solo a los owners', async () => {
    const { org } = await setupOwner(ctx);
    await addMember(ctx, org.id, 'm@example.com', 'manager');
    // La prueba termina el 12/11 a las 18:00 (Madrid).
    await ctx.deps.db.updateTable('organizations').set({ trial_ends_at: new Date('2026-11-12T17:00:00Z') }).where('id', '=', org.id).execute();
    mailer.sent = [];
    // Antes de las 9:00 locales no se envía nada.
    expect((await runTrialNotices(ctx.deps, new Date('2026-11-10T06:00:00Z'))).emailsQueued).toBe(0);
    const r1 = await runTrialNotices(ctx.deps, FIXED_NOW);
    expect(r1).toMatchObject({ soon: 1, ended: 0, emailsQueued: 1 });
    expect(mailer.sent.map((m) => m.to)).toEqual(['owner@example.com']);
    expect(mailer.sent[0]!.subject).toContain('termina pronto');
    expect(mailer.sent[0]!.text).toContain('12 de noviembre de 2026');
    expect(mailer.sent[0]!.text).toContain(`/locales/${org.id}/facturacion`);
    expect((await runTrialNotices(ctx.deps, new Date('2026-11-11T10:00:00Z'))).emailsQueued).toBe(0);
    // El día que caduca (por la mañana: aún no ha terminado).
    const r2 = await runTrialNotices(ctx.deps, new Date('2026-11-12T09:00:00Z'));
    expect(r2).toMatchObject({ ended: 1, emailsQueued: 1 });
    expect(mailer.sent[1]!.subject).toContain('termina hoy');
    expect((await runTrialNotices(ctx.deps, new Date('2026-11-12T20:00:00Z'))).emailsQueued).toBe(0);
    expect((await runTrialNotices(ctx.deps, new Date('2026-11-13T10:00:00Z'))).emailsQueued).toBe(0);
    // Con suscripción contratada no hay avisos.
    const other = await setupOwner(ctx, 'pagado@example.com');
    await ctx.deps.db
      .updateTable('organizations')
      .set({ trial_ends_at: new Date('2026-11-12T17:00:00Z'), subscription_status: 'active', stripe_subscription_id: 'sub_1' })
      .where('id', '=', other.org.id)
      .execute();
    expect((await runTrialNotices(ctx.deps, new Date('2026-11-12T10:00:00Z'))).emailsQueued).toBe(0);
  });
});

describe('10. borrado diferido de locales', () => {
  it('DELETE deja el local pendiente: solo lectura, sin carta ni cocina ni recordatorios; se puede restaurar', async () => {
    const { client, base, org } = await setupOwner(ctx);
    const { client: mgr } = await addMember(ctx, org.id, 'm@example.com', 'manager');
    await client.patch(`${base}/public-menu`, { enabled: true });
    const slug = json(await client.get(`${base}/public-menu`)).publicMenu.slug;
    const token = `kd_${randomToken()}`;
    await ctx.deps.db.insertInto('devices').values({ organization_id: org.id, name: 'Tablet', token_hash: sha256(token) }).execute();
    expect((await ctx.app.inject({ method: 'GET', url: '/api/kiosk/context', headers: { authorization: `Bearer ${token}` } })).statusCode).toBe(200);
    await client.post(`${base}/records`, { type: 'plagas', data: { result: 'sin_indicios' } });
    mailer.sent = [];

    expect((await client.delete(base, { password: 'incorrecta-1' })).statusCode).toBe(401);
    expect((await client.delete(base, { password: PASSWORD })).statusCode).toBe(204);
    expect((await client.delete(base, { password: PASSWORD })).statusCode).toBe(409);
    const o = json(await client.get(base)).organization;
    expect(o.deletionScheduledAt).not.toBeNull();
    const days = (new Date(o.deletionScheduledAt).getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(29.9);
    expect(days).toBeLessThan(30.1);
    expect(o.subscription.readOnly).toBe(true);
    // Email de confirmación a los owners (no al manager) con la fecha definitiva.
    expect(mailer.sent.map((m) => m.to)).toEqual(['owner@example.com']);
    expect(mailer.sent[0]!.text).toMatch(/eliminado definitivamente.* el \d+ de \w+ de \d{4}/);
    // Solo lectura, pero datos e informes disponibles.
    expect((await client.post(`${base}/records`, { type: 'plagas', data: { result: 'sin_indicios' } })).statusCode).toBe(402);
    expect((await client.get(`${base}/records`)).statusCode).toBe(200);
    expect((await client.get(`${base}/export`)).statusCode).toBe(200);
    expect((await client.get(`${base}/reports/csv?from=${FIXED_TODAY}&to=${FIXED_TODAY}`)).statusCode).toBe(200);
    expect((await client.post(`${base}/billing/checkout`, { plan: 'monthly' })).statusCode).toBeGreaterThanOrEqual(409);
    // Sin carta pública ni cocina.
    expect((await ctx.app.inject({ method: 'GET', url: `/api/public/menu/${slug}` })).statusCode).toBe(404);
    expect((await ctx.app.inject({ method: 'GET', url: '/api/kiosk/context', headers: { authorization: `Bearer ${token}` } })).statusCode).toBe(401);
    // Sin recordatorios.
    await ctx.deps.db.updateTable('organizations').set({ reminder_hour: 0, last_reminder_on: null }).where('id', '=', org.id).execute();
    expect((await runReminderTick(ctx.deps)).organizationsChecked).toBe(0);

    // Restaurar: solo el owner.
    expect((await mgr.post(`${base}/restore`)).statusCode).toBe(403);
    const restored = await client.post(`${base}/restore`);
    expect(restored.statusCode).toBe(200);
    expect(json(restored).organization.deletionScheduledAt).toBeNull();
    expect((await client.post(`${base}/restore`)).statusCode).toBe(409);
    expect((await client.post(`${base}/records`, { type: 'plagas', data: { result: 'sin_indicios' } })).statusCode).toBe(201);
    expect((await ctx.app.inject({ method: 'GET', url: `/api/public/menu/${slug}` })).statusCode).toBe(200);
    // Los dispositivos siguen revocados (hay que volver a vincularlos).
    expect((await ctx.app.inject({ method: 'GET', url: '/api/kiosk/context', headers: { authorization: `Bearer ${token}` } })).statusCode).toBe(401);
  });

  it('la tarea diaria purga al vencer el plazo; la eliminación inmediata exige estar pendiente y contraseña', async () => {
    const a = await setupOwner(ctx);
    await a.client.post(`${a.base}/records`, { type: 'plagas', data: { result: 'sin_indicios' } });
    expect((await a.client.delete(a.base, { password: PASSWORD })).statusCode).toBe(204);
    // Aún dentro del plazo: la purga no lo toca.
    await runRetention(ctx.deps, { force: true });
    expect(await ctx.deps.db.selectFrom('organizations').select('id').where('id', '=', a.org.id).executeTakeFirst()).toBeDefined();
    await ctx.deps.db.updateTable('organizations').set({ deletion_scheduled_at: new Date(Date.now() - 1000) }).where('id', '=', a.org.id).execute();
    const r = await runRetention(ctx.deps, { force: true });
    expect(r.organizations).toBe(1);
    expect(await ctx.deps.db.selectFrom('organizations').select('id').where('id', '=', a.org.id).executeTakeFirst()).toBeUndefined();
    expect(await ctx.deps.db.selectFrom('records').select('id').where('organization_id', '=', a.org.id).execute()).toHaveLength(0);

    const b = await setupOwner(ctx, 'b@example.com');
    expect((await b.client.delete(`${b.base}/permanent`, { password: PASSWORD })).statusCode).toBe(409);
    expect((await b.client.delete(b.base, { password: PASSWORD })).statusCode).toBe(204);
    expect((await b.client.delete(`${b.base}/permanent`, { password: 'incorrecta-1' })).statusCode).toBe(401);
    expect((await b.client.delete(`${b.base}/permanent`, { password: PASSWORD })).statusCode).toBe(204);
    expect(await ctx.deps.db.selectFrom('organizations').select('id').where('id', '=', b.org.id).executeTakeFirst()).toBeUndefined();
  });
});

