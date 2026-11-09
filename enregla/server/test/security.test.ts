import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Client, ORIGIN, PASSWORD, closeTestApp, createTestApp, createUser, json, login, resetDb, setupOwner, type TestCtx } from './helpers.js';
import { REDACT_PATHS } from '../src/app.js';
import { loadConfig } from '../src/config.js';

let ctx: TestCtx;
beforeAll(async () => {
  ctx = await createTestApp({
    config: {
      rateLimits: {
        ...(await import('./helpers.js')).testConfig().rateLimits,
        loginIp: { limit: 8, windowSeconds: 900 },
        loginAccount: { limit: 4, windowSeconds: 900 },
        registerIp: { limit: 3, windowSeconds: 3600 },
        passwordResetAccount: { limit: 2, windowSeconds: 3600 },
        publicIp: { limit: 3, windowSeconds: 60 },
      },
    },
  });
});
afterAll(async () => closeTestApp(ctx));
beforeEach(async () => resetDb(ctx));

describe('CSRF', () => {
  it('rechaza peticiones mutantes sin la cabecera X-Requested-With', async () => {
    await createUser(ctx, 'u@example.com');
    const res = await ctx.app.inject({ method: 'POST', url: '/api/auth/login', headers: { origin: ORIGIN }, payload: { email: 'u@example.com', password: PASSWORD } });
    expect(res.statusCode).toBe(403);
    expect(json(res).error.code).toBe('CSRF_FAILED');
  });

  it('rechaza un Origin ajeno aunque lleve la cabecera', async () => {
    const { client, base } = await setupOwner(ctx);
    const res = await client.patch(base, { name: 'Hackeado' }, { origin: 'https://evil.example' });
    expect(res.statusCode).toBe(403);
    expect(json(res).error.code).toBe('CSRF_FAILED');
  });

  it('sin Origin exige Sec-Fetch-Site: same-origin', async () => {
    const { client, base } = await setupOwner(ctx);
    client.csrf = false;
    const noOrigin = await client.patch(base, { name: 'X' }, { 'x-requested-with': 'XMLHttpRequest' });
    expect(noOrigin.statusCode).toBe(403);
    const crossSite = await client.patch(base, { name: 'X' }, { 'x-requested-with': 'XMLHttpRequest', 'sec-fetch-site': 'cross-site' });
    expect(crossSite.statusCode).toBe(403);
    const same = await client.patch(base, { name: 'Mismo origen' }, { 'x-requested-with': 'XMLHttpRequest', 'sec-fetch-site': 'same-origin' });
    expect(same.statusCode).toBe(200);
  });

  it('las peticiones GET no requieren cabeceras CSRF', async () => {
    const { client } = await setupOwner(ctx);
    client.csrf = false;
    expect((await client.get('/api/account')).statusCode).toBe(200);
  });

  it('el webhook y la API de kiosko están exentos (no usan cookie)', async () => {
    const res = await ctx.app.inject({ method: 'POST', url: '/api/kiosk/records', payload: {} });
    expect(res.statusCode).toBe(401);
    expect(json(res).error.code).toBe('UNAUTHENTICATED');
  });
});

describe('cabeceras de seguridad y CORS', () => {
  it('incluye CSP estricta, no-referrer, frame-ancestors y nosniff', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/healthz' });
    const csp = String(res.headers['content-security-policy']);
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("script-src 'self'");
    expect(csp).not.toContain('unsafe-inline');
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(res.headers['referrer-policy']).toBe('no-referrer');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBe('DENY');
    // HSTS solo en producción
    expect(res.headers['strict-transport-security']).toBeUndefined();
  });

  it('las respuestas de la API no se cachean', async () => {
    const { client } = await setupOwner(ctx);
    const res = await client.get('/api/account');
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('CORS cerrado: no se devuelve Access-Control-Allow-Origin a otros orígenes', async () => {
    const res = await ctx.app.inject({
      method: 'OPTIONS',
      url: '/api/auth/login',
      headers: { origin: 'https://evil.example', 'access-control-request-method': 'POST', 'access-control-request-headers': 'x-requested-with,content-type' },
    });
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('CORS permite orígenes de desarrollo configurados', async () => {
    const dev = await createTestApp({ env: { DEV_ORIGINS: 'http://localhost:5174' } });
    try {
      const res = await dev.app.inject({
        method: 'OPTIONS',
        url: '/api/auth/login',
        headers: { origin: 'http://localhost:5174', 'access-control-request-method': 'POST' },
      });
      expect(res.headers['access-control-allow-origin']).toBe('http://localhost:5174');
      expect(res.headers['access-control-allow-credentials']).toBe('true');
    } finally {
      await closeTestApp(dev);
    }
  });
});

describe('rate limiting', () => {
  it('limita intentos de login por cuenta', async () => {
    await createUser(ctx, 'u@example.com');
    const c = new Client(ctx.app);
    const codes: number[] = [];
    for (let i = 0; i < 6; i++) codes.push((await c.post('/api/auth/login', { email: 'u@example.com', password: 'incorrecta-1' })).statusCode);
    expect(codes.slice(0, 4)).toEqual([401, 401, 401, 401]);
    expect(codes[4]).toBe(429);
    const last = await c.post('/api/auth/login', { email: 'u@example.com', password: PASSWORD });
    expect(last.statusCode).toBe(429);
    expect(last.headers['retry-after']).toBeDefined();
    expect(json(last).error.code).toBe('RATE_LIMITED');
  });

  it('limita intentos de login por IP', async () => {
    const c = new Client(ctx.app);
    const codes: number[] = [];
    for (let i = 0; i < 10; i++) codes.push((await c.post('/api/auth/login', { email: `x${i}@example.com`, password: 'incorrecta-1' })).statusCode);
    expect(codes.filter((s) => s === 429).length).toBeGreaterThanOrEqual(2);
  });

  it('limita registros por IP', async () => {
    const c = new Client(ctx.app);
    const codes: number[] = [];
    for (let i = 0; i < 5; i++) codes.push((await c.post('/api/auth/register', { email: `r${i}@example.com`, password: PASSWORD, name: 'R' })).statusCode);
    expect(codes).toEqual([202, 202, 202, 429, 429]);
  });

  it('limita los emails de recuperación por cuenta sin revelarlo', async () => {
    await createUser(ctx, 'u@example.com');
    const c = new Client(ctx.app);
    for (let i = 0; i < 4; i++) expect((await c.post('/api/auth/password-reset/request', { email: 'u@example.com' })).statusCode).toBe(202);
    expect(ctx.mailer.outbox).toHaveLength(2);
  });

  it('limita el endpoint público de la carta', async () => {
    const codes: number[] = [];
    for (let i = 0; i < 5; i++) codes.push((await ctx.app.inject({ method: 'GET', url: '/api/public/menu/aaaaaaaaaaaaaaaaaaaaaa' })).statusCode);
    expect(codes).toEqual([404, 404, 404, 429, 429]);
  });

  it('respeta X-Forwarded-For solo si trustProxy está activado', async () => {
    const proxied = await createTestApp({ env: { TRUST_PROXY: '1' }, config: { rateLimits: { ...ctx.config.rateLimits, loginIp: { limit: 2, windowSeconds: 900 } } } });
    try {
      const c = new Client(proxied.app);
      const a = await c.post('/api/auth/login', { email: 'a@example.com', password: 'incorrecta-1' }, { 'x-forwarded-for': '203.0.113.1' });
      const b = await c.post('/api/auth/login', { email: 'b@example.com', password: 'incorrecta-1' }, { 'x-forwarded-for': '203.0.113.1' });
      const d = await c.post('/api/auth/login', { email: 'c@example.com', password: 'incorrecta-1' }, { 'x-forwarded-for': '203.0.113.1' });
      const other = await c.post('/api/auth/login', { email: 'd@example.com', password: 'incorrecta-1' }, { 'x-forwarded-for': '203.0.113.2' });
      expect([a.statusCode, b.statusCode, d.statusCode, other.statusCode]).toEqual([401, 401, 429, 401]);
    } finally {
      await closeTestApp(proxied);
    }
  });
});

describe('límites y errores', () => {
  it('rechaza cuerpos demasiado grandes con 413', async () => {
    const c = new Client(ctx.app);
    const res = await c.post('/api/auth/register', { email: 'a@example.com', password: PASSWORD, name: 'x'.repeat(300 * 1024) });
    expect(res.statusCode).toBe(413);
    expect(json(res).error.code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('JSON malformado devuelve 400 uniforme', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { origin: ORIGIN, 'x-requested-with': 'XMLHttpRequest', 'content-type': 'application/json' },
      payload: '{"email":',
    });
    expect(res.statusCode).toBe(400);
    expect(json(res).error.code).toBe('BAD_REQUEST');
  });

  it('Content-Type no admitido → 415; JSON vacío → 400', async () => {
    const h = { origin: ORIGIN, 'x-requested-with': 'XMLHttpRequest' };
    const r1 = await ctx.app.inject({ method: 'POST', url: '/api/auth/login', headers: { ...h, 'content-type': 'text/plain' }, payload: 'hola' });
    expect(r1.statusCode).toBe(415);
    expect(json(r1).error.code).toBe('BAD_REQUEST');
    const r2 = await ctx.app.inject({ method: 'POST', url: '/api/auth/logout', headers: { ...h, 'content-type': 'application/json' }, payload: '' });
    expect(r2.statusCode).toBe(400);
    const r3 = await ctx.app.inject({ method: 'POST', url: '/api/auth/logout', headers: h });
    expect(r3.statusCode).toBe(204);
  });

  it('rutas desconocidas devuelven 404 JSON', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/api/no-existe' });
    expect(res.statusCode).toBe(404);
    expect(json(res).error.code).toBe('NOT_FOUND');
  });

  it('healthz y readyz', async () => {
    expect(json(await ctx.app.inject({ method: 'GET', url: '/healthz' }))).toEqual({ status: 'ok' });
    expect(json(await ctx.app.inject({ method: 'GET', url: '/readyz' }))).toEqual({ status: 'ok' });
  });

  it('la redacción de logs cubre cookies, autorización y secretos', () => {
    expect(REDACT_PATHS).toEqual(expect.arrayContaining(['req.headers.cookie', 'req.headers.authorization', 'res.headers["set-cookie"]', '*.password', '*.token', '*.pin']));
  });

  it('los logs no contienen contraseñas, cookies ni tokens', async () => {
    const lines: string[] = [];
    const { Writable } = await import('node:stream');
    const stream = new Writable({
      write(chunk: Buffer, _enc, cb) {
        lines.push(chunk.toString());
        cb();
      },
    });
    const { buildApp } = await import('../src/app.js');
    const app = await buildApp(ctx.deps, { logger: { level: 'trace', stream, redact: { paths: REDACT_PATHS, censor: '[REDACTED]' } } });
    await createUser(ctx, 'log@example.com');
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { origin: ORIGIN, 'x-requested-with': 'XMLHttpRequest', cookie: 'otra=secreto-cookie' },
      payload: { email: 'log@example.com', password: PASSWORD },
    });
    const sessionToken = res.cookies[0]!.value;
    await app.inject({ method: 'GET', url: '/api/kiosk/context', headers: { authorization: 'Bearer kd_secretisimo' } });
    await app.close();
    const all = lines.join('\n');
    expect(lines.length).toBeGreaterThan(0);
    expect(all).toContain('/api/auth/login');
    expect(all).not.toContain(PASSWORD);
    expect(all).not.toContain(sessionToken);
    expect(all).not.toContain('secreto-cookie');
    expect(all).not.toContain('kd_secretisimo');
  });
});

describe('configuración', () => {
  const base = { NODE_ENV: 'production', DATABASE_URL: 'postgres://app:Muy-Segura-Clave-2026@db:5432/enregla', APP_URL: 'https://app.example.com', SMTP_HOST: 'smtp.example.com', MAIL_FROM: 'no-reply@example.com' };

  it('acepta una configuración de producción completa', () => {
    const cfg = loadConfig(base);
    expect(cfg.cookieSecure).toBe(true);
    expect(cfg.cookieName).toBe('__Host-enregla_session');
    expect(cfg.stripe).toBeNull();
    expect(loadConfig({ ...base, APP_NAME: 'Marca' }).mail.from).toBe('"Marca" <no-reply@example.com>');
  });

  it('falla en producción con secretos débiles o ausentes', () => {
    expect(() => loadConfig({ ...base, DATABASE_URL: 'postgres://app:postgres@db/enregla' })).toThrow(/débil/);
    expect(() => loadConfig({ ...base, APP_URL: 'http://app.example.com' })).toThrow(/https/);
    expect(() => loadConfig({ ...base, SMTP_HOST: '' })).toThrow();
    expect(() => loadConfig({ ...base, STRIPE_SECRET_KEY: 'sk_test_abcdefghijklmnop' })).toThrow(/incompleta/);
    expect(() => loadConfig({ ...base, COOKIE_SECURE: 'false' })).toThrow();
    expect(() => loadConfig({ NODE_ENV: 'production' })).toThrow(/DATABASE_URL/);
  });

  it('APP_NAME controla el nombre visible', async () => {
    const branded = await createTestApp({ env: { APP_NAME: 'MarcaNueva' } });
    try {
      const c = new Client(branded.app);
      await c.post('/api/auth/register', { email: 'brand@example.com', password: PASSWORD, name: 'B' });
      expect(branded.mailer.outbox[0]!.subject).toContain('MarcaNueva');
      expect(branded.mailer.outbox[0]!.text).toContain('MarcaNueva');
      expect(branded.mailer.outbox[0]!.text).not.toContain('EnRegla');
    } finally {
      await closeTestApp(branded);
    }
  });
});

describe('sesión requerida en rutas de organización', () => {
  it('un usuario sin sesión recibe 401 y uno autenticado sin membresía 404', async () => {
    const { base } = await setupOwner(ctx);
    expect((await new Client(ctx.app).get(base)).statusCode).toBe(401);
    await createUser(ctx, 'otro@example.com');
    const other = await login(ctx, 'otro@example.com');
    expect((await other.get(base)).statusCode).toBe(404);
  });
});

describe('servidor de la SPA (web/dist)', () => {
  it('sirve estáticos, fallback a index.html y mantiene 404 JSON en /api', async () => {
    const { mkdtemp, mkdir, writeFile, rm } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const path = await import('node:path');
    const dir = await mkdtemp(path.join(tmpdir(), 'enregla-web-'));
    await mkdir(path.join(dir, 'assets'));
    await writeFile(path.join(dir, 'index.html'), '<!doctype html><html><body><div id="root"></div><script type="module" src="/assets/app.js"></script></body></html>');
    await writeFile(path.join(dir, 'assets', 'app.js'), 'console.log(1)');
    const web = await createTestApp({ env: { WEB_DIST_DIR: dir } });
    try {
      const root = await web.app.inject({ method: 'GET', url: '/', headers: { accept: 'text/html' } });
      expect(root.statusCode).toBe(200);
      expect(root.body).toContain('id="root"');
      const deep = await web.app.inject({ method: 'GET', url: '/locales/123/facturacion', headers: { accept: 'text/html' } });
      expect(deep.statusCode).toBe(200);
      expect(deep.body).toContain('id="root"');
      expect(String(deep.headers['content-security-policy'])).toContain("script-src 'self'");
      const asset = await web.app.inject({ method: 'GET', url: '/assets/app.js' });
      expect(asset.statusCode).toBe(200);
      expect(asset.headers['cache-control']).toContain('immutable');
      const api = await web.app.inject({ method: 'GET', url: '/api/nada', headers: { accept: 'text/html' } });
      expect(api.statusCode).toBe(404);
      expect(json(api).error.code).toBe('NOT_FOUND');
      expect((await web.app.inject({ method: 'GET', url: '/assets/missing.js' })).statusCode).toBe(404);
    } finally {
      await closeTestApp(web);
      await rm(dir, { recursive: true, force: true });
    }
  });
});
