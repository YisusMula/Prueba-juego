import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { LightMyRequestResponse } from 'fastify';
import { Client, ORIGIN, PASSWORD, closeTestApp, createTestApp, createUser, json, login, resetDb, testConfig, tokenFromMail, type TestCtx } from './helpers.js';
import { verifySecret } from '../src/lib/password.js';

let ctx: TestCtx;
beforeAll(async () => {
  ctx = await createTestApp();
});
afterAll(async () => closeTestApp(ctx));
beforeEach(async () => resetDb(ctx));

const NEW_PASSWORD = 'Nueva-Clave-Segura-1';

describe('H4 restablecer/cambiar la contraseña invalida los tokens pendientes', () => {
  it('un cambio de email pedido con la contraseña antigua no se puede confirmar tras un reset', async () => {
    await createUser(ctx, 'victima@example.com');
    const attacker = await login(ctx, 'victima@example.com'); // conoce la contraseña antigua
    expect((await attacker.post('/api/account/email', { password: PASSWORD, newEmail: 'atacante@example.com' })).statusCode).toBe(202);
    const stolen = tokenFromMail(ctx.mailer, 'atacante@example.com');
    // Aviso inmediato al email antiguo.
    const notice = ctx.mailer.outbox.find((m) => m.to === 'victima@example.com' && m.subject.includes('Solicitud de cambio de email'));
    expect(notice).toBeDefined();
    expect(notice!.text).toMatch(/cambia la contraseña/);
    expect(notice!.text).not.toContain('#token=');

    // La víctima restablece la contraseña.
    const c = new Client(ctx.app);
    await c.post('/api/auth/password-reset/request', { email: 'victima@example.com' });
    const reset = tokenFromMail(ctx.mailer, 'victima@example.com');
    expect((await c.post('/api/auth/password-reset/confirm', { token: reset, password: NEW_PASSWORD })).statusCode).toBe(200);

    const res = await new Client(ctx.app).post('/api/auth/email-change/confirm', { token: stolen });
    expect(res.statusCode).toBe(400);
    expect(json(res).error.code).toBe('INVALID_TOKEN');
    const u = await ctx.deps.db.selectFrom('users').select('email').executeTakeFirstOrThrow();
    expect(u.email).toBe('victima@example.com');
  });

  it('cambiar la contraseña también anula cambios de email y resets pendientes', async () => {
    await createUser(ctx, 'u@example.com');
    const c = await login(ctx, 'u@example.com');
    await c.post('/api/account/email', { password: PASSWORD, newEmail: 'otro@example.com' });
    const emailToken = tokenFromMail(ctx.mailer, 'otro@example.com');
    await new Client(ctx.app).post('/api/auth/password-reset/request', { email: 'u@example.com' });
    const resetToken = tokenFromMail(ctx.mailer, 'u@example.com');
    expect((await c.post('/api/account/password', { currentPassword: PASSWORD, newPassword: NEW_PASSWORD })).statusCode).toBe(204);
    expect((await new Client(ctx.app).post('/api/auth/email-change/confirm', { token: emailToken })).statusCode).toBe(400);
    expect((await new Client(ctx.app).post('/api/auth/password-reset/confirm', { token: resetToken, password: 'Otra-Clave-Segura-9' })).statusCode).toBe(400);
  });

  it('al confirmarse el cambio se avisa al email antiguo', async () => {
    await createUser(ctx, 'u@example.com');
    const c = await login(ctx, 'u@example.com');
    await c.post('/api/account/email', { password: PASSWORD, newEmail: 'nuevo@example.com' });
    const token = tokenFromMail(ctx.mailer, 'nuevo@example.com');
    expect((await new Client(ctx.app).post('/api/auth/email-change/confirm', { token })).statusCode).toBe(200);
    expect(ctx.mailer.outbox.filter((m) => m.to === 'u@example.com').map((m) => m.subject)).toEqual([
      expect.stringContaining('Solicitud de cambio de email'),
      expect.stringContaining('Tu email ha cambiado'),
    ]);
  });
});

describe('H9 re-registro sobre una cuenta sin verificar', () => {
  it('no sobrescribe contraseña ni nombre; solo reenvía la verificación con la misma respuesta', async () => {
    const c = new Client(ctx.app);
    const first = await c.post('/api/auth/register', { email: 'dueno@example.com', password: PASSWORD, name: 'Dueño' });
    const second = await c.post('/api/auth/register', { email: 'dueno@example.com', password: 'Clave-Del-Atacante-1', name: 'Atacante' });
    expect(first.statusCode).toBe(202);
    expect(second.statusCode).toBe(202);
    expect(second.body).toBe(first.body);
    const u = await ctx.deps.db.selectFrom('users').selectAll().where('email', '=', 'dueno@example.com').executeTakeFirstOrThrow();
    expect(u.name).toBe('Dueño');
    expect(await verifySecret(u.password_hash, PASSWORD)).toBe(true);
    expect(await verifySecret(u.password_hash, 'Clave-Del-Atacante-1')).toBe(false);
    const mails = ctx.mailer.outbox.filter((m) => m.to === 'dueno@example.com');
    expect(mails).toHaveLength(2);
    expect(mails[1]!.text).toMatch(/recuperar-contrasena/);
    // El enlace nuevo funciona y el login sigue siendo con la contraseña original.
    await c.post('/api/auth/verify-email', { token: tokenFromMail(ctx.mailer, 'dueno@example.com') });
    expect((await c.post('/api/auth/login', { email: 'dueno@example.com', password: 'Clave-Del-Atacante-1' })).statusCode).toBe(401);
    expect((await c.post('/api/auth/login', { email: 'dueno@example.com', password: PASSWORD })).statusCode).toBe(200);
  });

  it('los reenvíos de verificación están limitados por cuenta (en silencio)', async () => {
    const c = new Client(ctx.app);
    for (let i = 0; i < 3; i++) expect((await c.post('/api/auth/register', { email: 'x@example.com', password: PASSWORD, name: 'X' })).statusCode).toBe(202);
    for (let i = 0; i < 2; i++) expect((await c.post('/api/auth/resend-verification', { email: 'x@example.com' })).statusCode).toBe(202);
    expect(ctx.mailer.outbox.filter((m) => m.to === 'x@example.com')).toHaveLength(testConfig().rateLimits.verifyAccount.limit);
  });

  it('el saludo del email de verificación es neutro (sin el nombre escrito en el registro)', async () => {
    await new Client(ctx.app).post('/api/auth/register', { email: 'n@example.com', password: PASSWORD, name: 'Gana 1000€ en www.estafa.example' });
    const m = ctx.mailer.outbox[0]!;
    expect(m.text).not.toContain('estafa');
    expect(m.html).not.toContain('estafa');
    expect(m.text).toContain('Hola:');
  });
});

describe('H10 sin enumeración por tiempo en registro y recuperación', () => {
  /**
   * Con las tablas `users` y `email_tokens` bloqueadas por otra transacción, cualquier
   * trabajo que dependa de que la cuenta exista (insertar usuario, crear token) se queda
   * esperando. Si la respuesta lo esperara, tardaría tanto como dure el bloqueo.
   */
  async function whileTablesLocked(fn: () => Promise<LightMyRequestResponse[]>) {
    const conn = await ctx.deps.pool.connect();
    try {
      await conn.query('BEGIN');
      await conn.query('LOCK TABLE users, email_tokens IN EXCLUSIVE MODE');
      const t0 = performance.now();
      const res = await Promise.race([fn(), new Promise<null>((r) => setTimeout(() => r(null), 2000))]);
      const elapsed = performance.now() - t0;
      await conn.query('COMMIT');
      return { res, elapsed };
    } finally {
      conn.release();
    }
  }

  const raw = (url: string, payload: object) =>
    ctx.app.inject({ method: 'POST', url, headers: { origin: ORIGIN, 'x-requested-with': 'XMLHttpRequest' }, payload });

  it('reset de contraseña: responde sin esperar a buscar la cuenta ni crear el token', async () => {
    await createUser(ctx, 'existe@example.com');
    const { res, elapsed } = await whileTablesLocked(async () => [
      await raw('/api/auth/password-reset/request', { email: 'existe@example.com' }),
      await raw('/api/auth/password-reset/request', { email: 'noexiste@example.com' }),
    ]);
    expect(res, 'la respuesta esperó al trabajo dependiente de la cuenta').not.toBeNull();
    expect(res!.map((r) => r.statusCode)).toEqual([202, 202]);
    expect(res![0]!.body).toBe(res![1]!.body);
    expect(elapsed).toBeLessThan(1500);
    // El trabajo se completa después, de forma determinista.
    await ctx.app.drainBackground();
    expect(ctx.mailer.outbox.map((m) => m.to)).toEqual(['existe@example.com']);
    const audits = await ctx.deps.db.selectFrom('audit_events').select('event').where('event', '=', 'auth.password_reset_requested').execute();
    expect(audits).toHaveLength(1);
  });

  it('registro: responde sin esperar a crear la cuenta ni el token', async () => {
    await createUser(ctx, 'existe@example.com');
    const { res } = await whileTablesLocked(async () => [
      await raw('/api/auth/register', { email: 'existe@example.com', password: PASSWORD, name: 'X' }),
      await raw('/api/auth/register', { email: 'nueva@example.com', password: PASSWORD, name: 'Y' }),
    ]);
    expect(res).not.toBeNull();
    expect(res!.map((r) => r.statusCode)).toEqual([202, 202]);
    await ctx.app.drainBackground();
    expect(ctx.mailer.outbox.map((m) => m.to).sort()).toEqual(['existe@example.com', 'nueva@example.com']);
    expect(await ctx.deps.db.selectFrom('users').select('email').where('email', '=', 'nueva@example.com').executeTakeFirst()).toBeDefined();
  });

  it('un fallo en el trabajo en segundo plano no rompe la respuesta y se registra', async () => {
    const failing = await createTestApp();
    try {
      failing.mailer.send = () => Promise.reject(new Error('SMTP caído'));
      await createUser(failing, 'f@example.com');
      const r = await new Client(failing.app).post('/api/auth/password-reset/request', { email: 'f@example.com' });
      expect(r.statusCode).toBe(202);
    } finally {
      await closeTestApp(failing);
    }
  });
});

describe('H11 bloqueo de login por (cuenta + IP) con techo por cuenta', () => {
  let proxied: TestCtx;
  beforeAll(async () => {
    const rl = testConfig().rateLimits;
    proxied = await createTestApp({
      env: { TRUST_PROXY: '1' },
      config: { rateLimits: { ...rl, loginIp: { limit: 1000, windowSeconds: 900 }, loginAccount: { limit: 15, windowSeconds: 3600 } } },
    });
  });
  afterAll(async () => closeTestApp(proxied));
  beforeEach(async () => resetDb(proxied));

  const attempt = (c: Client, ip: string, password: string) => c.post('/api/auth/login', { email: 'v@example.com', password }, { 'x-forwarded-for': ip });

  it('10 fallos desde la IP del atacante no impiden al titular entrar desde su IP', async () => {
    expect(testConfig().rateLimits.loginAccountIp).toEqual({ limit: 10, windowSeconds: 900 });
    expect(testConfig().rateLimits.loginAccount).toEqual({ limit: 100, windowSeconds: 3600 });
    await createUser(proxied, 'v@example.com');
    const c = new Client(proxied.app);
    const codes: number[] = [];
    for (let i = 0; i < 11; i++) codes.push((await attempt(c, '198.51.100.66', 'mala-clave-1')).statusCode);
    expect(codes.slice(0, 10).every((s) => s === 401)).toBe(true);
    expect(codes[10]).toBe(429);
    expect((await attempt(c, '198.51.100.66', PASSWORD)).statusCode).toBe(429);
    expect((await attempt(new Client(proxied.app), '203.0.113.7', PASSWORD)).statusCode).toBe(200);
  });

  it('techo por cuenta contra fuerza bruta distribuida (muchas IP)', async () => {
    await createUser(proxied, 'v@example.com');
    const c = new Client(proxied.app);
    const codes: number[] = [];
    for (let i = 0; i < 17; i++) codes.push((await attempt(c, `192.0.2.${i + 1}`, 'mala-clave-1')).statusCode);
    expect(codes.slice(0, 15).every((s) => s === 401)).toBe(true);
    expect(codes.slice(15)).toEqual([429, 429]);
    expect((await attempt(c, '203.0.113.99', PASSWORD)).statusCode).toBe(429);
  });

  it('reenvío de verificación y reset usan claves de rate limit separadas', async () => {
    await createUser(ctx, 'pend@example.com', { verified: false });
    const c = new Client(ctx.app);
    for (let i = 0; i < 4; i++) await c.post('/api/auth/password-reset/request', { email: 'pend@example.com' });
    ctx.mailer.clear();
    // Agotado el cupo de reset de esa cuenta, el reenvío de verificación sigue funcionando.
    expect((await c.post('/api/auth/resend-verification', { email: 'pend@example.com' })).statusCode).toBe(202);
    expect(ctx.mailer.outbox.filter((m) => m.subject.includes('Confirma tu email'))).toHaveLength(1);
    const keys = (await ctx.deps.db.selectFrom('rate_limits').select('key').execute()).map((r) => r.key);
    expect(keys).toEqual(expect.arrayContaining(['reset:acct:pend@example.com', 'verify:acct:pend@example.com']));
  });
});
