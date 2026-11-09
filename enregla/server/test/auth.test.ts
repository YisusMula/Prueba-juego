import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'kysely';
import { Client, PASSWORD, closeTestApp, createTestApp, createUser, json, login, resetDb, setupOwner, tokenFromMail, type TestCtx } from './helpers.js';
import { sha256 } from '../src/lib/crypto.js';

let ctx: TestCtx;
beforeAll(async () => {
  ctx = await createTestApp();
});
afterAll(async () => closeTestApp(ctx));
beforeEach(async () => resetDb(ctx));

describe('registro y verificación de email', () => {
  it('registra, envía verificación y permite iniciar sesión tras verificar', async () => {
    const c = new Client(ctx.app);
    const res = await c.post('/api/auth/register', { email: 'Nueva@Example.com ', password: PASSWORD, name: 'Ana' });
    expect(res.statusCode).toBe(202);
    expect(ctx.mailer.outbox).toHaveLength(1);
    expect(ctx.mailer.outbox[0]!.to).toBe('nueva@example.com');
    expect(ctx.mailer.outbox[0]!.subject).toContain('EnRegla');

    const before = await c.post('/api/auth/login', { email: 'nueva@example.com', password: PASSWORD });
    expect(before.statusCode).toBe(403);
    expect(json(before).error.code).toBe('EMAIL_NOT_VERIFIED');

    const token = tokenFromMail(ctx.mailer);
    const v = await c.post('/api/auth/verify-email', { token });
    expect(v.statusCode).toBe(200);
    // Un solo uso
    expect((await c.post('/api/auth/verify-email', { token })).statusCode).toBe(400);

    const ok = await c.post('/api/auth/login', { email: 'nueva@example.com', password: PASSWORD });
    expect(ok.statusCode).toBe(200);
    expect(json(ok).user).toMatchObject({ email: 'nueva@example.com', name: 'Ana', emailVerified: true });
    const me = await c.get('/api/account');
    expect(me.statusCode).toBe(200);
  });

  it('guarda la contraseña con argon2id y los tokens hasheados', async () => {
    const c = new Client(ctx.app);
    await c.post('/api/auth/register', { email: 'hash@example.com', password: PASSWORD, name: 'H' });
    const u = await ctx.deps.db.selectFrom('users').selectAll().where('email', '=', 'hash@example.com').executeTakeFirstOrThrow();
    expect(u.password_hash.startsWith('$argon2id$')).toBe(true);
    expect(u.password_hash).toContain('m=19456,t=2,p=1');
    const token = tokenFromMail(ctx.mailer);
    const rows = await ctx.deps.db.selectFrom('email_tokens').selectAll().execute();
    expect(rows[0]!.token_hash).toBe(sha256(token));
    expect(JSON.stringify(rows)).not.toContain(token);
    expect(token.length).toBeGreaterThanOrEqual(43);
  });

  it('responde igual si el email ya existe (no revela cuentas)', async () => {
    await createUser(ctx, 'existe@example.com');
    const c = new Client(ctx.app);
    const a = await c.post('/api/auth/register', { email: 'existe@example.com', password: PASSWORD, name: 'X' });
    const b = await c.post('/api/auth/register', { email: 'noexiste@example.com', password: PASSWORD, name: 'X' });
    expect(a.statusCode).toBe(202);
    expect(b.statusCode).toBe(202);
    expect(a.body).toBe(b.body);
    // Al dueño real se le avisa, sin token de verificación
    const toExisting = ctx.mailer.outbox.find((m) => m.to === 'existe@example.com')!;
    expect(toExisting.text).not.toContain('#token=');
  });

  it('rechaza contraseñas cortas, largas o comunes', async () => {
    const c = new Client(ctx.app);
    for (const password of ['corta', 'a'.repeat(129), 'contraseña123', '1234567890', 'qwertyuiop']) {
      const res = await c.post('/api/auth/register', { email: 'p@example.com', password, name: 'P' });
      expect(res.statusCode).toBe(400);
      expect(json(res).error.code).toBe('VALIDATION_ERROR');
    }
  });

  it('valida el cuerpo con zod y devuelve el formato de error uniforme', async () => {
    const c = new Client(ctx.app);
    const res = await c.post('/api/auth/register', { email: 'no-es-email', password: PASSWORD });
    expect(res.statusCode).toBe(400);
    const body = json(res);
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.message).toBeTypeOf('string');
    expect(body.error.details.map((d: { path: string }) => d.path)).toEqual(expect.arrayContaining(['email', 'name']));
  });

  it('reenvía verificación sin revelar si existe', async () => {
    await createUser(ctx, 'pend@example.com', { verified: false });
    const c = new Client(ctx.app);
    const a = await c.post('/api/auth/resend-verification', { email: 'pend@example.com' });
    const b = await c.post('/api/auth/resend-verification', { email: 'nadie@example.com' });
    expect(a.statusCode).toBe(202);
    expect(b.statusCode).toBe(202);
    expect(ctx.mailer.outbox).toHaveLength(1);
  });
});

describe('login y sesiones', () => {
  it('establece cookie __Host- httpOnly, SameSite=Lax, Secure, y guarda solo el hash', async () => {
    await createUser(ctx, 'u@example.com');
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { origin: 'http://localhost:5173', 'x-requested-with': 'XMLHttpRequest' },
      payload: { email: 'u@example.com', password: PASSWORD },
    });
    expect(res.statusCode).toBe(200);
    const cookie = res.cookies.find((c) => c.name === '__Host-enregla_session')!;
    expect(cookie).toBeDefined();
    expect(cookie.httpOnly).toBe(true);
    expect(cookie.secure).toBe(true);
    expect(cookie.sameSite).toBe('Lax');
    expect(cookie.path).toBe('/');
    expect(cookie.domain).toBeUndefined();
    const sessions = await ctx.deps.db.selectFrom('sessions').selectAll().execute();
    expect(sessions).toHaveLength(1);
    expect(sessions[0]!.token_hash).toBe(sha256(cookie.value));
  });

  it('mismo error para email inexistente y contraseña incorrecta, y queda auditado', async () => {
    await createUser(ctx, 'u@example.com');
    const c = new Client(ctx.app);
    const a = await c.post('/api/auth/login', { email: 'u@example.com', password: 'incorrecta-123' });
    const b = await c.post('/api/auth/login', { email: 'otro@example.com', password: 'incorrecta-123' });
    expect(a.statusCode).toBe(401);
    expect(b.statusCode).toBe(401);
    expect(a.body).toBe(b.body);
    const audits = await ctx.deps.db.selectFrom('audit_events').selectAll().where('event', '=', 'auth.login_failed').execute();
    expect(audits).toHaveLength(2);
  });

  it('rota la sesión al iniciar sesión de nuevo', async () => {
    await createUser(ctx, 'u@example.com');
    const c = await login(ctx, 'u@example.com');
    const first = c.cookies.get('__Host-enregla_session');
    await c.post('/api/auth/login', { email: 'u@example.com', password: PASSWORD });
    const second = c.cookies.get('__Host-enregla_session');
    expect(second).not.toBe(first);
    const sessions = await ctx.deps.db.selectFrom('sessions').selectAll().execute();
    expect(sessions).toHaveLength(1);
  });

  it('logout invalida la sesión en servidor', async () => {
    await createUser(ctx, 'u@example.com');
    const c = await login(ctx, 'u@example.com');
    const token = c.cookies.get('__Host-enregla_session')!;
    expect((await c.post('/api/auth/logout')).statusCode).toBe(204);
    const replay = new Client(ctx.app);
    replay.cookies.set('__Host-enregla_session', token);
    expect((await replay.get('/api/account')).statusCode).toBe(401);
  });

  it('logout-all cierra todas las sesiones', async () => {
    await createUser(ctx, 'u@example.com');
    const a = await login(ctx, 'u@example.com');
    const b = await login(ctx, 'u@example.com');
    expect((await a.post('/api/auth/logout-all')).statusCode).toBe(204);
    expect((await b.get('/api/account')).statusCode).toBe(401);
    expect((await new Client(ctx.app).post('/api/auth/logout-all')).statusCode).toBe(401);
  });

  it('caduca por inactividad y por expiración absoluta', async () => {
    await createUser(ctx, 'u@example.com');
    const c = await login(ctx, 'u@example.com');
    await sql`UPDATE sessions SET last_seen_at = now() - interval '30 days'`.execute(ctx.deps.db);
    expect((await c.get('/api/account')).statusCode).toBe(401);
    const d = await login(ctx, 'u@example.com');
    await sql`UPDATE sessions SET expires_at = now() - interval '1 second'`.execute(ctx.deps.db);
    expect((await d.get('/api/account')).statusCode).toBe(401);
  });

  it('rechaza cookies malformadas o inventadas', async () => {
    const c = new Client(ctx.app);
    c.cookies.set('__Host-enregla_session', 'x'.repeat(43));
    expect((await c.get('/api/account')).statusCode).toBe(401);
    c.cookies.set('__Host-enregla_session', "' OR 1=1 --");
    expect((await c.get('/api/account')).statusCode).toBe(401);
  });
});

describe('recuperación y cambio de contraseña', () => {
  it('flujo completo de restablecimiento, un solo uso, cierra sesiones', async () => {
    await createUser(ctx, 'u@example.com');
    const existing = await login(ctx, 'u@example.com');
    const c = new Client(ctx.app);
    const r1 = await c.post('/api/auth/password-reset/request', { email: 'u@example.com' });
    const r2 = await c.post('/api/auth/password-reset/request', { email: 'nadie@example.com' });
    expect(r1.statusCode).toBe(202);
    expect(r1.body).toBe(r2.body);
    const token = tokenFromMail(ctx.mailer, 'u@example.com');
    expect((await c.post('/api/auth/password-reset/confirm', { token, password: '1234567890' })).statusCode).toBe(400);
    const ok = await c.post('/api/auth/password-reset/confirm', { token, password: 'Nueva-Clave-Segura-1' });
    expect(ok.statusCode).toBe(200);
    expect((await c.post('/api/auth/password-reset/confirm', { token, password: 'Otra-Clave-Segura-2' })).statusCode).toBe(400);
    expect((await existing.get('/api/account')).statusCode).toBe(401);
    expect((await c.post('/api/auth/login', { email: 'u@example.com', password: PASSWORD })).statusCode).toBe(401);
    expect((await c.post('/api/auth/login', { email: 'u@example.com', password: 'Nueva-Clave-Segura-1' })).statusCode).toBe(200);
  });

  it('token de reset caducado no sirve', async () => {
    await createUser(ctx, 'u@example.com');
    const c = new Client(ctx.app);
    await c.post('/api/auth/password-reset/request', { email: 'u@example.com' });
    const token = tokenFromMail(ctx.mailer);
    await sql`UPDATE email_tokens SET expires_at = now() - interval '1 minute'`.execute(ctx.deps.db);
    const res = await c.post('/api/auth/password-reset/confirm', { token, password: 'Nueva-Clave-Segura-1' });
    expect(res.statusCode).toBe(400);
    expect(json(res).error.code).toBe('INVALID_TOKEN');
  });

  it('cambio de contraseña exige la actual e invalida las demás sesiones', async () => {
    await createUser(ctx, 'u@example.com');
    const a = await login(ctx, 'u@example.com');
    const b = await login(ctx, 'u@example.com');
    expect((await a.post('/api/account/password', { currentPassword: 'mala-mala-1', newPassword: 'Nueva-Clave-Segura-1' })).statusCode).toBe(401);
    expect((await a.post('/api/account/password', { currentPassword: PASSWORD, newPassword: 'Nueva-Clave-Segura-1' })).statusCode).toBe(204);
    expect((await a.get('/api/account')).statusCode).toBe(200);
    expect((await b.get('/api/account')).statusCode).toBe(401);
    expect(ctx.mailer.outbox.some((m) => m.subject.includes('contraseña ha cambiado'))).toBe(true);
  });
});

describe('cambio de email', () => {
  it('requiere contraseña y confirmación en el nuevo email', async () => {
    await createUser(ctx, 'u@example.com');
    const c = await login(ctx, 'u@example.com');
    expect((await c.post('/api/account/email', { password: 'incorrecta-1', newEmail: 'nuevo@example.com' })).statusCode).toBe(401);
    const res = await c.post('/api/account/email', { password: PASSWORD, newEmail: 'nuevo@example.com' });
    expect(res.statusCode).toBe(202);
    const token = tokenFromMail(ctx.mailer, 'nuevo@example.com');
    expect((await c.get('/api/account')).json().user.email).toBe('u@example.com');
    const conf = await new Client(ctx.app).post('/api/auth/email-change/confirm', { token });
    expect(conf.statusCode).toBe(200);
    expect((await c.get('/api/account')).json().user.email).toBe('nuevo@example.com');
    expect(ctx.mailer.outbox.some((m) => m.to === 'u@example.com' && m.subject.includes('email ha cambiado'))).toBe(true);
  });

  it('no envía nada si el email ya está en uso, pero responde igual', async () => {
    await createUser(ctx, 'u@example.com');
    await createUser(ctx, 'ocupado@example.com');
    const c = await login(ctx, 'u@example.com');
    const res = await c.post('/api/account/email', { password: PASSWORD, newEmail: 'ocupado@example.com' });
    expect(res.statusCode).toBe(202);
    expect(ctx.mailer.outbox.filter((m) => m.to === 'ocupado@example.com')).toHaveLength(0);
  });
});

describe('cuenta', () => {
  it('PATCH /api/account cambia el nombre', async () => {
    await createUser(ctx, 'u@example.com');
    const c = await login(ctx, 'u@example.com');
    const res = await c.patch('/api/account', { name: 'Nuevo Nombre' });
    expect(res.statusCode).toBe(200);
    expect(json(res).user.name).toBe('Nuevo Nombre');
  });

  it('borrar cuenta exige contraseña y no deja locales sin propietario', async () => {
    const { client, base } = await setupOwner(ctx);
    expect((await client.delete('/api/account', { password: 'incorrecta-1' })).statusCode).toBe(401);
    const blocked = await client.delete('/api/account', { password: PASSWORD });
    expect(blocked.statusCode).toBe(409);
    expect((await client.delete(base, { password: PASSWORD })).statusCode).toBe(204);
    const ok = await client.delete('/api/account', { password: PASSWORD });
    expect(ok.statusCode).toBe(204);
    expect(await ctx.deps.db.selectFrom('users').selectAll().execute()).toHaveLength(0);
    expect((await client.get('/api/account')).statusCode).toBe(401);
  });

  it('las rutas protegidas exigen sesión', async () => {
    const c = new Client(ctx.app);
    for (const url of ['/api/account', '/api/orgs']) {
      const res = await c.get(url);
      expect(res.statusCode).toBe(401);
      expect(json(res).error.code).toBe('UNAUTHENTICATED');
    }
  });
});
