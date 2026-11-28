import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Writable } from 'node:stream';
import pg from 'pg';
import { sql } from 'kysely';
import { buildApp, HTTP_TIMEOUTS, loggerOptions } from '../src/app.js';
import { loadConfig, resolveDatabaseUrl } from '../src/config.js';
import { createDeps } from '../src/deps.js';
import { MemoryMailer } from '../src/lib/mailer.js';
import { closeTestApp, createStaff, createTestApp, FIXED_NOW, FIXED_TODAY, firstEquipment, json, resetDb, setupOwner, testConfig, type TestCtx } from './helpers.js';
import { TEST_DATABASE_URL } from './global-setup.js';

let ctx: TestCtx;
beforeAll(async () => {
  ctx = await createTestApp({ now: () => FIXED_NOW });
});
afterAll(async () => closeTestApp(ctx));
beforeEach(async () => resetDb(ctx));

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('2. resiliencia ante PostgreSQL', () => {
  it('un corte de las conexiones del pool no mata el proceso y la siguiente petición funciona', async () => {
    const appName = `enregla-test-${process.pid}`;
    const config = testConfig();
    const { createPool } = await import('../src/db/index.js');
    const pool = createPool(config.databaseUrl, 3, { applicationName: appName });
    const deps = createDeps(config, { pool, mailer: new MemoryMailer() });
    const app = await buildApp(deps, { logger: false });
    await app.ready();
    const errors: unknown[] = [];
    const onUncaught = (e: unknown) => errors.push(e);
    process.on('uncaughtException', onUncaught);
    try {
      // Calienta el pool: varias conexiones quedan inactivas en él.
      await Promise.all([1, 2, 3].map(() => app.inject({ method: 'GET', url: '/readyz' })));
      expect(pool.idleCount).toBeGreaterThan(0);
      const admin = new pg.Client({ connectionString: TEST_DATABASE_URL });
      await admin.connect();
      const killed = await admin.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE application_name = $1', [appName]);
      await admin.end();
      expect(killed.rowCount).toBeGreaterThan(0);
      await sleep(300);
      expect(errors).toEqual([]);
      let status = 0;
      for (let i = 0; i < 20 && status !== 200; i++) {
        status = (await app.inject({ method: 'GET', url: '/readyz' })).statusCode;
        if (status !== 200) await sleep(100);
      }
      expect(status).toBe(200);
      expect((await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'x@example.com', password: 'Cocina-Segura-2026' }, headers: { origin: 'http://localhost:5173', 'x-requested-with': 'XMLHttpRequest' } })).statusCode).toBe(401);
    } finally {
      process.off('uncaughtException', onUncaught);
      await app.close();
      await deps.db.destroy();
    }
  });

  it('las conexiones llevan statement_timeout e idle_in_transaction_session_timeout', async () => {
    const r = await sql<{ s: string; i: string }>`SELECT current_setting('statement_timeout') AS s, current_setting('idle_in_transaction_session_timeout') AS i`.execute(ctx.deps.db);
    expect(r.rows[0]).toEqual({ s: '30s', i: '1min' });
  });

  it('/readyz responde 503 si la BD no responde y durante el apagado', async () => {
    const bad = await createTestApp({ config: { databaseUrl: 'postgres://enregla:enregla@127.0.0.1:1/nada' } });
    try {
      const r = await bad.app.inject({ method: 'GET', url: '/readyz' });
      expect(r.statusCode).toBe(503);
      expect((await bad.app.inject({ method: 'GET', url: '/healthz' })).statusCode).toBe(200);
    } finally {
      await bad.app.close();
      await bad.deps.db.destroy();
    }
    const tmp = await createTestApp();
    try {
      expect((await tmp.app.inject({ method: 'GET', url: '/readyz' })).statusCode).toBe(200);
      tmp.app.markShuttingDown();
      const r = await tmp.app.inject({ method: 'GET', url: '/readyz' });
      expect(r.statusCode).toBe(503);
      expect(json(r).reason).toBe('shutting_down');
    } finally {
      await closeTestApp(tmp);
    }
  });

  it('keep-alive > 120 s con headersTimeout coherente', () => {
    expect(ctx.app.server.keepAliveTimeout).toBe(HTTP_TIMEOUTS.keepAliveMs);
    expect(ctx.app.server.keepAliveTimeout).toBeGreaterThan(120_000);
    expect(ctx.app.server.headersTimeout).toBeGreaterThan(ctx.app.server.keepAliveTimeout);
    expect(ctx.app.server.requestTimeout).toBeGreaterThanOrEqual(ctx.app.server.headersTimeout);
    expect(ctx.app.server.timeout).toBe(HTTP_TIMEOUTS.connectionMs);
  });

  it('las sondas /healthz y /readyz no se registran a nivel info', async () => {
    const lines: string[] = [];
    const stream = new Writable({
      write(chunk: Buffer, _enc, cb) {
        lines.push(chunk.toString());
        cb();
      },
    });
    const deps = createDeps(testConfig(), { mailer: new MemoryMailer() });
    const app = await buildApp(deps, { logger: { level: 'info', stream } });
    try {
      await app.inject({ method: 'GET', url: '/healthz' });
      await app.inject({ method: 'GET', url: '/readyz' });
      expect(lines.filter((l) => l.includes('/healthz') || l.includes('/readyz'))).toEqual([]);
      await app.inject({ method: 'GET', url: '/api/account' });
      expect(lines.some((l) => l.includes('/api/account'))).toBe(true);
    } finally {
      await app.close();
      await deps.db.destroy();
    }
  });
});

describe('3. arranque y configuración', () => {
  it('sin pino-pretty instalado el logger usa JSON plano en vez de caerse', () => {
    const cfg = { env: 'development' as const, logLevel: 'info' };
    const missing = () => {
      throw new Error('Cannot find module pino-pretty');
    };
    expect(loggerOptions(cfg, missing)).not.toHaveProperty('transport');
    expect(loggerOptions(cfg, () => '/x/pino-pretty')).toHaveProperty('transport');
    expect(loggerOptions({ env: 'production', logLevel: 'info' }, () => '/x')).not.toHaveProperty('transport');
  });

  it('acepta PGHOST/PGUSER/PGPASSWORD/PGDATABASE con caracteres especiales en la contraseña', () => {
    const url = resolveDatabaseUrl({ DATABASE_URL: '', PGHOST: 'db', PGUSER: 'enregla', PGPASSWORD: 'p@ss:w/rd#?%larga', PGDATABASE: 'enregla' })!;
    expect(decodeURIComponent(new URL(url).password)).toBe('p@ss:w/rd#?%larga');
    expect(new URL(url).hostname).toBe('db');
    const cfg = loadConfig({
      NODE_ENV: 'production',
      DATABASE_URL: '',
      PGHOST: 'db',
      PGUSER: 'enregla',
      PGPASSWORD: 'p@ss:w/rd#?%larga',
      PGDATABASE: 'enregla',
      APP_URL: 'https://app.example.com',
      SMTP_HOST: 'smtp.example.com',
      MAIL_FROM: 'no-reply@example.com',
    });
    expect(cfg.databaseUrl).toBe(url);
    expect(() => loadConfig({ NODE_ENV: 'test' })).toThrow(/DATABASE_URL/);
  });
});

describe('7. PDF Unicode sin recortes y CSV con tope explícito', () => {
  it('un texto de 1.000 caracteres y nombres con ș, ł, ő y cirílico salen completos en el PDF', async () => {
    const { client, base, org } = await setupOwner(ctx);
    await ctx.deps.db.updateTable('organizations').set({ name: 'Bistró Ștefan Łódź' }).where('id', '=', org.id).execute();
    const words = Array.from({ length: 200 }, (_, i) => `pal${String(i).padStart(3, '0')}`).join(' ');
    const long = `INICIO ${words} FIN`.slice(0, 1000);
    expect(long.length).toBe(1000);
    const st = await createStaff(ctx, org.id, 'Ősz Борис');
    const r = await client.post(`${base}/records`, { type: 'incidencia', staffId: st.id, data: { description: `${long.slice(0, -3)}FIN`, correctiveAction: 'Llamar a Ștefan 🥑', closed: false } });
    expect(r.statusCode).toBe(201);
    const res = await client.get(`${base}/reports/pdf?from=${FIXED_TODAY}&to=${FIXED_TODAY}&types=incidencia`);
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-length']).toBe(String(res.rawPayload.length));
    const pdf = res.rawPayload;
    // Fuente Unicode embebida (no Helvetica estándar).
    expect(pdf.toString('latin1')).toMatch(/\/FontName \/[A-Z]{6}\+DejaVuSans/);
    expect(pdf.toString('latin1')).not.toContain('/Helvetica');
    let hasPdftotext = true;
    try {
      execFileSync('pdftotext', ['-v'], { stdio: 'ignore' });
    } catch {
      hasPdftotext = false;
    }
    if (hasPdftotext) {
      const dir = mkdtempSync(path.join(tmpdir(), 'enregla-pdf-'));
      try {
        writeFileSync(path.join(dir, 'r.pdf'), pdf);
        const text = execFileSync('pdftotext', ['-raw', path.join(dir, 'r.pdf'), '-'], { encoding: 'utf8' }).replace(/\s+/g, ' ');
        for (const w of ['INICIO', 'pal000', 'pal070', 'pal130', 'FIN', 'Ștefan', 'Łódź', 'Ősz', 'Борис', '□']) expect(text).toContain(w);
        expect(text).not.toContain('…');
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  });

  it('una celda más alta que una página continúa en la siguiente sin perder texto', async () => {
    const { client, base, org } = await setupOwner(ctx);
    const huge = Array.from({ length: 2000 }, (_, i) => `w${i}`).join(' ');
    const st = await createStaff(ctx, org.id, 'S');
    await ctx.deps.db
      .insertInto('records')
      .values({ organization_id: org.id, type: 'incidencia', data: JSON.stringify({ description: huge, closed: true }), staff_id: st.id, staff_name: 'S', created_at: FIXED_NOW })
      .execute();
    const res = await client.get(`${base}/reports/pdf?from=${FIXED_TODAY}&to=${FIXED_TODAY}&types=incidencia`);
    expect(res.statusCode).toBe(200);
    const pages = (res.rawPayload.toString('latin1').match(/\/Type \/Page\b/g) ?? []).length;
    expect(pages).toBeGreaterThan(1);
    const dir = mkdtempSync(path.join(tmpdir(), 'enregla-pdf-'));
    try {
      writeFileSync(path.join(dir, 'r.pdf'), res.rawPayload);
      const text = execFileSync('pdftotext', ['-raw', path.join(dir, 'r.pdf'), '-'], { encoding: 'utf8' });
      for (const w of ['w0', 'w1000', 'w1999']) expect(text).toMatch(new RegExp(`\\b${w}\\b`));
    } catch (err) {
      if ((err as { code?: string }).code !== 'ENOENT') throw err;
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('CSV: si se supera el tope se rechaza con REPORT_TOO_LARGE en vez de cortar en silencio', async () => {
    const small = await createTestApp({ now: () => FIXED_NOW, config: { reports: { ...testConfig().reports, maxCsvRows: 2 } } });
    try {
      const { client, base, org } = await setupOwner(small);
      const st = await createStaff(small, org.id, 'S');
      const fridge = await firstEquipment(small, org.id, 'camara');
      for (let i = 0; i < 3; i++) {
        await small.deps.db
          .insertInto('records')
          .values({ organization_id: org.id, type: 'temperatura', data: JSON.stringify({ value: i }), staff_id: st.id, staff_name: 'S', equipment_id: fridge.id, created_at: FIXED_NOW })
          .execute();
      }
      const res = await client.get(`${base}/reports/csv?from=${FIXED_TODAY}&to=${FIXED_TODAY}`);
      expect(res.statusCode).toBe(400);
      expect(json(res).error.code).toBe('REPORT_TOO_LARGE');
      expect((await client.get(`${base}/reports/csv?from=${FIXED_TODAY}&to=${FIXED_TODAY}&types=incidencia`)).statusCode).toBe(200);
    } finally {
      await closeTestApp(small);
    }
  });
});

describe('11. SPA, X-Robots-Tag', () => {
  it('index.html con cualquier Accept; /api y ficheros inexistentes siguen en 404; noindex en lo privado', async () => {
    const dist = mkdtempSync(path.join(tmpdir(), 'enregla-dist-'));
    mkdirSync(path.join(dist, 'assets'));
    writeFileSync(path.join(dist, 'index.html'), '<!doctype html><title>EnRegla</title>');
    writeFileSync(path.join(dist, 'assets', 'app.js'), 'console.log(1)');
    const spa = await createTestApp({ config: { webDistDir: dist } });
    try {
      const get = (url: string, accept?: string) => spa.app.inject({ method: 'GET', url, headers: accept ? { accept } : {} });
      for (const accept of ['*/*', undefined, 'application/json', 'text/html']) {
        const r = await get('/', accept);
        expect(r.statusCode).toBe(200);
        expect(r.body).toContain('<title>EnRegla</title>');
      }
      expect((await get('/locales/x/hoy', '*/*')).statusCode).toBe(200);
      expect((await get('/assets/app.js')).statusCode).toBe(200);
      expect((await get('/assets/nada.js', '*/*')).statusCode).toBe(404);
      expect((await get('/favicon-inexistente.png', 'text/html')).statusCode).toBe(404);
      const api = await get('/api/nada', 'text/html');
      expect(api.statusCode).toBe(404);
      expect(json(api).error.code).toBe('NOT_FOUND');
      // noindex: API, carta pública y app privada; la portada y las páginas legales se indexan.
      expect(api.headers['x-robots-tag']).toBe('noindex, nofollow');
      expect((await get('/locales/x/hoy')).headers['x-robots-tag']).toBe('noindex, nofollow');
      expect((await get('/carta/abc')).headers['x-robots-tag']).toBe('noindex, nofollow');
      expect((await get('/cocina')).headers['x-robots-tag']).toBe('noindex, nofollow');
      expect((await get('/')).headers['x-robots-tag']).toBeUndefined();
      expect((await get('/privacidad')).headers['x-robots-tag']).toBeUndefined();
    } finally {
      await closeTestApp(spa);
      rmSync(dist, { recursive: true, force: true });
    }
  });
});

describe('12. el semáforo de PDF no lo retienen clientes lentos', () => {
  it('con los 2 huecos usados por clientes que no leen la respuesta, otra organización obtiene su PDF', async () => {
    const app = await createTestApp({ now: () => FIXED_NOW });
    try {
      // Dos locales distintos (B-2: como mucho un PDF a la vez por local y por usuario).
      const slows = [await setupOwner(app, 'lento@example.com'), await setupOwner(app, 'lento2@example.com')];
      for (const slow of slows) {
        const st = await createStaff(app, slow.org.id, 'S');
        // Texto aleatorio (poco comprimible): un PDF muy por encima del búfer de la respuesta.
        await sql`
          INSERT INTO records (organization_id, type, data, staff_id, staff_name, alert, created_at)
          SELECT ${slow.org.id}, 'incidencia',
            jsonb_build_object('description', (SELECT string_agg(md5(random()::text || g || x), ' ') FROM generate_series(1, 10) x), 'closed', true),
            ${st.id}, 'S', false, ${FIXED_NOW.toISOString()}::timestamptz - (g || ' seconds')::interval
          FROM generate_series(1, 300) g`.execute(app.deps.db);
      }
      // Dos clientes que piden el PDF y NO leen la respuesta (contrapresión: el flujo no avanza).
      const slowResponses = await Promise.all(
        slows.map((slow) => {
          const cookie = [...slow.client.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
          const url = `${slow.base}/reports/pdf?from=${FIXED_TODAY}&to=${FIXED_TODAY}`;
          return app.app.inject({ method: 'GET', url, headers: { cookie }, payloadAsStream: true });
        }),
      );
      for (const r of slowResponses) expect(r.statusCode).toBe(200);
      // Con el arreglo, los huecos se liberan al terminar la GENERACIÓN, no la descarga.
      for (let i = 0; i < 100 && app.app.pdfSlots.inUse > 0; i++) await sleep(50);
      expect(app.app.pdfSlots.inUse).toBe(0);
      const other = await setupOwner(app, 'otro@example.com');
      const res = await other.client.get(`${other.base}/reports/pdf?from=${FIXED_TODAY}&to=${FIXED_TODAY}`);
      expect(res.statusCode).toBe(200);
      // Y los clientes lentos reciben el PDF completo cuando por fin leen, con Content-Length.
      const len = Number(slowResponses[0]!.headers['content-length']);
      expect(len).toBeGreaterThan(64 * 1024);
      const chunks: Buffer[] = [];
      for await (const c of slowResponses[0]!.stream()) chunks.push(c as Buffer);
      expect(Buffer.concat(chunks).length).toBe(len);
      for await (const _ of slowResponses[1]!.stream()) void _;
    } finally {
      await closeTestApp(app);
    }
  }, 60_000);

  it('una descarga que no progresa se aborta (timeout de inactividad de escritura)', async () => {
    const { guardSlowDownload, DOWNLOAD_IDLE_TIMEOUT_MS } = await import('../src/http/slow-download.js');
    expect(DOWNLOAD_IDLE_TIMEOUT_MS).toBeLessThanOrEqual(120_000);
    let destroyed = false;
    let timeoutMs = 0;
    let onTimeout: (() => void) | undefined;
    const reply = {
      raw: {
        setTimeout: (ms: number, cb: () => void) => {
          timeoutMs = ms;
          onTimeout = cb;
        },
        destroy: () => {
          destroyed = true;
        },
      },
      request: { log: { warn: () => undefined } },
    };
    guardSlowDownload(reply as never);
    expect(timeoutMs).toBe(DOWNLOAD_IDLE_TIMEOUT_MS);
    onTimeout!();
    expect(destroyed).toBe(true);
  });
});
