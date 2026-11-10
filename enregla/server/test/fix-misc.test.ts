import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'kysely';
import { ORIGIN, PASSWORD, closeTestApp, createStaff, createTestApp, createUser, json, login, resetDb, setupOwner, testConfig, type TestCtx } from './helpers.js';
import { loadConfig } from '../src/config.js';
import { runRetention } from '../src/modules/reminders/scheduler.js';

let ctx: TestCtx;
beforeAll(async () => {
  ctx = await createTestApp();
});
afterAll(async () => closeTestApp(ctx));
beforeEach(async () => resetDb(ctx));

async function setupKiosk(c: TestCtx) {
  const owner = await setupOwner(c);
  const res = json(await owner.client.post(`${owner.base}/devices`, { name: 'Tablet' }));
  const post = (payload: object) => c.app.inject({ method: 'POST', url: '/api/kiosk/records', headers: { authorization: `Bearer ${res.token}` }, payload });
  return { ...owner, post };
}
const plagas = (staffId: string, pin: string) => ({ staffId, pin, type: 'plagas', data: { result: 'sin_indicios' } });

describe('H3 bloqueo de PIN con ráfagas concurrentes', () => {
  it('30 PIN erróneos en ráfaga → como mucho 5 verificaciones; el resto 429', async () => {
    const { post, org } = await setupKiosk(ctx);
    const st = await createStaff(ctx, org.id, 'Ana', '4321');
    const res = await Promise.all(Array.from({ length: 30 }, (_, i) => post(plagas(st.id, String(1000 + i)))));
    const verified = await ctx.deps.db.selectFrom('audit_events').select('id').where('event', '=', 'staff.pin_failed').execute();
    expect(verified.length).toBe(5);
    const codes = res.map((r) => json(r).error.code as string);
    expect(codes.filter((c) => c === 'INVALID_PIN')).toHaveLength(4);
    // El resto: PIN_LOCKED (persona bloqueada) o RATE_LIMITED (límite de fallos del dispositivo), siempre 429.
    expect(codes.filter((c) => c === 'PIN_LOCKED').length).toBeGreaterThanOrEqual(1);
    expect(res.filter((r) => json(r).error.code !== 'INVALID_PIN').every((r) => r.statusCode === 429)).toBe(true);
    expect(res.filter((r) => r.statusCode === 429).every((r) => r.headers['retry-after'])).toBe(true);
    // Durante el bloqueo ni el PIN correcto entra (aquí además se agotó el límite general del dispositivo, 30).
    expect((await post(plagas(st.id, '4321'))).statusCode).toBe(429);
    const row = await ctx.deps.db.selectFrom('staff').selectAll().where('id', '=', st.id).executeTakeFirstOrThrow();
    expect(row.pin_locked_until!.getTime()).toBeGreaterThan(Date.now() + 14 * 60_000);
  });

  it('un acierto antes del máximo reinicia el contador; tras caducar el bloqueo hay ventana nueva', async () => {
    const { post, org } = await setupKiosk(ctx);
    const st = await createStaff(ctx, org.id, 'Ana', '4321');
    for (let i = 0; i < 4; i++) expect(json(await post(plagas(st.id, '0000'))).error.code).toBe('INVALID_PIN');
    expect((await post(plagas(st.id, '4321'))).statusCode).toBe(201);
    for (let i = 0; i < 4; i++) expect(json(await post(plagas(st.id, '0000'))).error.code).toBe('INVALID_PIN');
    expect(json(await post(plagas(st.id, '0000'))).error.code).toBe('PIN_LOCKED');
    await ctx.deps.db.updateTable('staff').set({ pin_locked_until: new Date(Date.now() - 1000) }).where('id', '=', st.id).execute();
    expect(json(await post(plagas(st.id, '0000'))).error.code).toBe('INVALID_PIN');
    expect((await post(plagas(st.id, '4321'))).statusCode).toBe(201);
  });

  it('límite por dispositivo de PIN fallidos (todas las personas)', async () => {
    expect(testConfig().rateLimits.pinFailDevice).toEqual({ limit: 20, windowSeconds: 900 });
    const tight = await createTestApp({ config: { rateLimits: { ...testConfig().rateLimits, pinFailDevice: { limit: 6, windowSeconds: 900 } } } });
    try {
      await resetDb(tight);
      const { post, org } = await setupKiosk(tight);
      const staff = await Promise.all(['A', 'B', 'C', 'D'].map((n) => createStaff(tight, org.id, n, '4321')));
      // Un acierto no consume cupo de fallos.
      expect((await post(plagas(staff[0]!.id, '4321'))).statusCode).toBe(201);
      for (const s of staff.slice(0, 3)) {
        for (let i = 0; i < 2; i++) expect(json(await post(plagas(s.id, '0000'))).error.code).toBe('INVALID_PIN');
      }
      const blocked = await post(plagas(staff[3]!.id, '0000'));
      expect(blocked.statusCode).toBe(429);
      expect(json(blocked).error.code).toBe('RATE_LIMITED');
      // La persona D no llegó a verificarse ni a acumular fallos.
      const d = await tight.deps.db.selectFrom('staff').select('pin_failed_count').where('id', '=', staff[3]!.id).executeTakeFirstOrThrow();
      expect(d.pin_failed_count).toBe(0);
    } finally {
      await closeTestApp(tight);
    }
  });
});

describe('H6 IP falsificable con X-Forwarded-For', () => {
  const prod = { NODE_ENV: 'production', DATABASE_URL: 'postgres://app:Muy-Segura-Clave-2026@db:5432/enregla', APP_URL: 'https://app.example.com', SMTP_HOST: 'smtp.example.com', MAIL_FROM: 'no-reply@example.com' };

  it('en producción se rechaza TRUST_PROXY=true con un mensaje claro; se aceptan saltos o IP/CIDR', () => {
    expect(() => loadConfig({ ...prod, TRUST_PROXY: 'true' })).toThrow(/TRUST_PROXY=true no se permite en producción.*saltos|TRUST_PROXY=1/);
    expect(loadConfig({ ...prod, TRUST_PROXY: '1' }).trustProxy).toBe(1);
    expect(loadConfig({ ...prod, TRUST_PROXY: '172.18.0.0/16, 10.0.0.2' }).trustProxy).toEqual(['172.18.0.0/16', '10.0.0.2']);
    expect(() => loadConfig({ ...prod, TRUST_PROXY: 'si' })).toThrow(/IP\/CIDR/);
    expect(() => loadConfig({ ...prod, TRUST_PROXY: '10.0.0.0/99' })).toThrow(/IP\/CIDR/);
  });

  it('docker-compose publica el puerto solo en 127.0.0.1 y hay despliegue de ejemplo con Caddy', () => {
    const compose = readFileSync(new URL('../../docker-compose.yml', import.meta.url), 'utf8');
    const ports = [...compose.matchAll(/^\s*-\s*"?([^"\n]*:3000)"?\s*$/gm)].map((m) => m[1]);
    expect(ports).toEqual(['127.0.0.1:3000:3000']);
    const prodCompose = readFileSync(new URL('../../docker-compose.prod.yml', import.meta.url), 'utf8');
    expect(prodCompose).toContain('caddy');
    expect(prodCompose).not.toMatch(/TRUST_PROXY:\s*"?true/);
  });
});

describe('H14 retención de datos', () => {
  it('purga auditoría > 12 meses, cuentas sin verificar > 7 días, sesiones/tokens caducados y rate limits viejos', async () => {
    const owner = await setupOwner(ctx);
    const db = ctx.deps.db;
    await sql`INSERT INTO audit_events (event, created_at) VALUES ('auth.login', now() - interval '13 months'), ('auth.login', now() - interval '11 months')`.execute(db);
    const old = await createUser(ctx, 'viejo@example.com', { verified: false });
    await createUser(ctx, 'reciente@example.com', { verified: false });
    await sql`UPDATE users SET created_at = now() - interval '8 days' WHERE id = ${old.id}`.execute(db);
    await sql`INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ('h1', ${owner.user.id}, now() - interval '1 day')`.execute(db);
    await sql`INSERT INTO email_tokens (user_id, purpose, token_hash, expires_at) VALUES (${owner.user.id}, 'password_reset', 'h2', now() - interval '8 days')`.execute(db);
    await sql`INSERT INTO rate_limits (key, count, reset_at) VALUES ('viejo', 1, now() - interval '2 hours'), ('vivo', 1, now() + interval '1 hour')`.execute(db);

    const r = await runRetention(ctx.deps);
    expect(r).toMatchObject({ ran: true, auditEvents: 1, unverifiedUsers: 1, sessions: 1, emailTokens: 1, rateLimits: 1 });
    const emails = (await db.selectFrom('users').select('email').execute()).map((u) => u.email).sort();
    expect(emails).toEqual(['owner@example.com', 'reciente@example.com']);
    expect((await db.selectFrom('rate_limits').select('key').where('key', 'in', ['viejo', 'vivo']).execute()).map((x) => x.key)).toEqual(['vivo']);
    // La sesión vigente del owner sigue funcionando.
    expect((await owner.client.get('/api/account')).statusCode).toBe(200);
    // Una vez al día: una segunda pasada no hace nada.
    expect((await runRetention(ctx.deps)).ran).toBe(false);
  });

  it('el plazo de auditoría es configurable y la tarea es segura con varias instancias', async () => {
    expect(testConfig().retention).toEqual({ auditMonths: 12, unverifiedAccountDays: 7 });
    expect(testConfig({}, { AUDIT_RETENTION_MONTHS: '24' }).retention.auditMonths).toBe(24);
    const results = await Promise.all([runRetention(ctx.deps), runRetention(ctx.deps), runRetention(ctx.deps)]);
    expect(results.filter((r) => r.ran)).toHaveLength(1);
  });

  it('al borrar una cuenta se seudonimizan sus eventos de auditoría (sin email ni IP)', async () => {
    const owner = await setupOwner(ctx);
    await createUser(ctx, 'u@example.com');
    const c = await login(ctx, 'u@example.com');
    await c.post('/api/account/email', { password: PASSWORD, newEmail: 'nuevo@example.com' });
    await owner.client.post(`${owner.base}/invitations`, { email: 'u@example.com' });
    const u = await ctx.deps.db.selectFrom('users').select('id').where('email', '=', 'u@example.com').executeTakeFirstOrThrow();
    await sql`INSERT INTO audit_events (user_id, event, ip, metadata) VALUES (${u.id}, 'auth.email_changed', '203.0.113.5', '{"from":"u@example.com","to":"nuevo@example.com"}')`.execute(ctx.deps.db);
    expect((await c.delete('/api/account', { password: PASSWORD })).statusCode).toBe(204);
    const rows = await ctx.deps.db.selectFrom('audit_events').selectAll().execute();
    const dump = JSON.stringify(rows);
    expect(dump).not.toContain('u@example.com');
    expect(dump).not.toContain('nuevo@example.com');
    expect(rows.filter((r) => r.user_id === u.id).every((r) => r.ip === null)).toBe(true);
    expect(rows.some((r) => r.user_id === u.id && r.event === 'account.deleted')).toBe(true);
  });
});

describe('H15 entradas raras → 400 (nunca 500)', () => {
  it('fechas fuera de 2000–2100, NUL, ids no UUID, enteros gigantes y cursores corruptos', async () => {
    const { client, base } = await setupOwner(ctx);
    const gets = [
      `${base}/reports/pdf?from=0000-01-01&to=0000-01-02`,
      `${base}/reports/csv?from=1999-12-31&to=2000-01-01`,
      `${base}/records?from=0000-01-01`,
      `${base}/records?to=2101-01-01`,
      `${base}/tasks/compliance?from=0000-01-01&to=0000-01-31`,
      `${base}/records?limit=999999999999999999999999`,
      `${base}/records?cursor=no-es-un-uuid`,
      `${base}/records?cursor=00000000-0000-0000-0000-000000000000%00`,
      `${base}/suppliers?q=a%00b`,
      `${base}/dishes?category=%00`,
      `${base}/audit?cursor=99999999999999999999999`,
      `${base}/audit?cursor=-1`,
      `${base}/records/not-a-uuid`,
      `/api/orgs/not-a-uuid/records`,
      `${base}/records?type=temperatura&type=limpieza`,
    ];
    for (const url of gets) {
      const r = await client.get(url);
      expect(r.statusCode, url).toBeGreaterThanOrEqual(400);
      expect(r.statusCode, url).toBeLessThan(500);
    }
    const posts: [string, object][] = [
      [`${base}/records`, { type: 'incidencia', data: { description: 'a\u0000b', closed: false } }],
      [`${base}/records`, { type: 'recepcion', data: { supplierName: 'X', product: 'P', accepted: true, expiryDate: '0000-01-01' } }],
      [`${base}/records`, { type: 'temperatura', data: { equipmentId: '00000000-0000-0000-0000-000000000000', value: 1e308 } }],
      [`${base}/suppliers`, { name: 'Prov\u0000' }],
      [`${base}/staff`, { name: 'N\u0000' }],
      ['/api/auth/login', { email: 'a\u0000@example.com', password: 'x\u0000' }],
    ];
    for (const [url, body] of posts) {
      const r = await client.post(url, body);
      expect(r.statusCode, `${url} ${JSON.stringify(body)}`).toBe(400);
    }
    expect(json(await client.get(`${base}/reports/pdf?from=0000-01-01&to=0000-01-02`)).error.code).toBe('VALIDATION_ERROR');
  });

  it('el JSON con \\u0000 en una clave también se rechaza', async () => {
    const { base } = await setupOwner(ctx);
    const c = await login(ctx, 'owner@example.com');
    const r = await ctx.app.inject({
      method: 'POST',
      url: `${base}/records`,
      headers: { origin: ORIGIN, 'x-requested-with': 'XMLHttpRequest', 'content-type': 'application/json', cookie: [...c.cookies].map(([k, v]) => `${k}=${v}`).join('; ') },
      payload: '{"type":"incidencia","data":{"description":"x","closed":false,"a\\u0000":1}}',
    });
    expect(r.statusCode).toBe(400);
  });
});

describe('H17 zonas horarias solo IANA', () => {
  it('rechaza desplazamientos tipo +01:00 y acepta nombres IANA y UTC', async () => {
    await createUser(ctx, 'u@example.com');
    const c = await login(ctx, 'u@example.com');
    for (const tz of ['+01:00', '-05:00', 'GMT+1', 'Etc/GMT-1x', 'europe/madrid']) {
      expect((await c.post('/api/orgs', { name: 'L', businessType: 'bar', timezone: tz })).statusCode, tz).toBe(400);
    }
    for (const tz of ['Europe/Madrid', 'Atlantic/Canary', 'UTC']) {
      expect((await c.post('/api/orgs', { name: 'L', businessType: 'bar', timezone: tz })).statusCode, tz).toBe(201);
    }
    const org = json(await c.post('/api/orgs', { name: 'L', businessType: 'bar' })).organization;
    expect((await c.patch(`/api/orgs/${org.id}`, { timezone: '+01:00' })).statusCode).toBe(400);
  });
});

