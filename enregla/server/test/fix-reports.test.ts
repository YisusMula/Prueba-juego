import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { sql } from 'kysely';
import { addMember, closeTestApp, createStaff, createTestApp, firstEquipment, json, resetDb, setupOwner, testConfig, type TestCtx } from './helpers.js';
import { localDate } from '../src/lib/dates.js';
import { computeCompliance } from '../src/modules/tasks/service.js';

let ctx: TestCtx;
beforeAll(async () => {
  ctx = await createTestApp();
});
afterAll(async () => closeTestApp(ctx));
beforeEach(async () => resetDb(ctx));

const today = () => localDate(new Date(), 'Europe/Madrid');

async function seedTemperatures(c: TestCtx, orgId: string, n: number) {
  const fridge = await firstEquipment(c, orgId, 'camara');
  const st = await createStaff(c, orgId, 'Ana');
  await sql`
    INSERT INTO records (organization_id, type, data, staff_id, staff_name, equipment_id, alert, created_at)
    SELECT ${orgId}, 'temperatura',
      jsonb_build_object('equipmentId', ${fridge.id}::text, 'equipmentName', 'Cámara frigorífica principal', 'value', (g % 9)::float, 'minTemp', null, 'maxTemp', 4, 'outOfRange', g % 9 > 4, 'correctiveAction', CASE WHEN g % 9 > 4 THEN 'Se revisa la puerta y se traslada el género a otra cámara' END),
      ${st.id}, 'Ana', ${fridge.id}, g % 9 > 4, now() - (g || ' seconds')::interval
    FROM generate_series(1, ${n}) g`.execute(c.deps.db);
}

describe('H1 DoS con informes PDF', () => {
  it('H1a: el tope de filas del PDF es 5000 y por encima responde 400 REPORT_TOO_LARGE sugiriendo acotar o CSV', async () => {
    expect(testConfig().reports.maxPdfRows).toBe(5000);
    const small = await createTestApp({ config: { reports: { ...testConfig().reports, maxPdfRows: 50 } } });
    try {
      await resetDb(small);
      const { client, base, org } = await setupOwner(small);
      await seedTemperatures(small, org.id, 51);
      const res = await client.get(`${base}/reports/pdf?from=${today()}&to=${today()}`);
      expect(res.statusCode).toBe(400);
      expect(json(res).error.code).toBe('REPORT_TOO_LARGE');
      expect(json(res).error.message).toMatch(/periodo|tipos/);
      expect(json(res).error.message).toMatch(/CSV/);
      // Acotando por tipo (no hay incidencias) sí se genera; el CSV no tiene ese tope.
      expect((await client.get(`${base}/reports/pdf?from=${today()}&to=${today()}&types=incidencia`)).statusCode).toBe(200);
      expect((await client.get(`${base}/reports/csv?from=${today()}&to=${today()}`)).statusCode).toBe(200);
    } finally {
      await closeTestApp(small);
    }
  });

  it('H1b: semáforo global de PDF: con los huecos ocupados responde 429 con Retry-After (sin cola)', async () => {
    const { client, base } = await setupOwner(ctx);
    expect(ctx.config.reports.pdfConcurrency).toBe(2);
    const a = ctx.app.pdfSlots.tryAcquire()!;
    const b = ctx.app.pdfSlots.tryAcquire()!;
    try {
      const busy = await client.get(`${base}/reports/pdf?from=${today()}&to=${today()}`);
      expect(busy.statusCode).toBe(429);
      expect(json(busy).error.code).toBe('RATE_LIMITED');
      expect(Number(busy.headers['retry-after'])).toBeGreaterThan(0);
    } finally {
      a();
    }
    const ok = await client.get(`${base}/reports/pdf?from=${today()}&to=${today()}`);
    expect(ok.statusCode).toBe(200);
    b();
    // El hueco se libera al terminar cada PDF.
    expect(ctx.app.pdfSlots.inUse).toBe(0);
  });

  it('H1b: concurrencia real: 6 PDF a la vez → como mucho 2 se generan, el resto 429', async () => {
    const { client, base, org } = await setupOwner(ctx);
    await seedTemperatures(ctx, org.id, 600);
    const url = `${base}/reports/pdf?from=${today()}&to=${today()}`;
    const results = await Promise.all(Array.from({ length: 6 }, () => client.get(url)));
    const codes = results.map((r) => r.statusCode);
    expect(codes.filter((c) => c === 200).length).toBeGreaterThanOrEqual(1);
    expect(codes.filter((c) => c === 200).length).toBeLessThanOrEqual(2);
    expect(codes.every((c) => c === 200 || c === 429)).toBe(true);
    expect(ctx.app.pdfSlots.inUse).toBe(0);
  });

  it('H1c: rate limit de PDF, CSV y exportación por organización y por usuario', async () => {
    const rl = testConfig().rateLimits;
    expect(rl.reportPdf).toEqual({ limit: 10, windowSeconds: 600 });
    expect(rl.reportCsv).toEqual({ limit: 20, windowSeconds: 600 });
    expect(rl.orgExport).toEqual({ limit: 5, windowSeconds: 3600 });
    const tight = await createTestApp({
      config: { rateLimits: { ...rl, reportPdf: { limit: 2, windowSeconds: 600 }, reportCsv: { limit: 2, windowSeconds: 600 }, orgExport: { limit: 1, windowSeconds: 3600 } } },
    });
    try {
      await resetDb(tight);
      const { client, base, org } = await setupOwner(tight);
      const { client: mgr } = await addMember(tight, org.id, 'm@example.com', 'manager');
      const q = `from=${today()}&to=${today()}`;
      expect((await client.get(`${base}/reports/pdf?${q}`)).statusCode).toBe(200);
      expect((await mgr.get(`${base}/reports/pdf?${q}`)).statusCode).toBe(200);
      // El límite por organización alcanza a cualquier usuario del local.
      const pdf3 = await client.get(`${base}/reports/pdf?${q}`);
      expect(pdf3.statusCode).toBe(429);
      expect(pdf3.headers['retry-after']).toBeDefined();
      expect((await client.get(`${base}/reports/csv?${q}`)).statusCode).toBe(200);
      expect((await client.get(`${base}/reports/csv?${q}`)).statusCode).toBe(200);
      expect((await mgr.get(`${base}/reports/csv?${q}`)).statusCode).toBe(429);
      expect((await client.get(`${base}/export`)).statusCode).toBe(200);
      expect((await client.get(`${base}/export`)).statusCode).toBe(429);
      // Por usuario: el mismo usuario en otro local también está limitado.
      const other = json(await client.post('/api/orgs', { name: 'Otro', businessType: 'bar' })).organization.id;
      // (lleva 1 PDF contado como usuario; el 3.º del local se cortó por el límite del local)
      expect((await client.get(`/api/orgs/${other}/reports/pdf?${q}`)).statusCode).toBe(200);
      expect((await client.get(`/api/orgs/${other}/reports/pdf?${q}`)).statusCode).toBe(429);
    } finally {
      await closeTestApp(tight);
    }
  });

  it('H1d: /healthz responde con rapidez mientras se genera un PDF grande', async () => {
    const { client, base, org } = await setupOwner(ctx);
    await seedTemperatures(ctx, org.id, 5000);
    let done = false;
    const pdf = client.get(`${base}/reports/pdf?from=${today()}&to=${today()}`).finally(() => {
      done = true;
    });
    // Se mide cada iteración completa (espera de 20 ms + petición): si la generación
    // acapara el event loop, el temporizador y la petición se retrasan y se nota aquí.
    const latencies: number[] = [];
    await new Promise((r) => setTimeout(r, 100));
    while (!done) {
      const t0 = performance.now();
      await new Promise((r) => setTimeout(r, 20));
      const h = await ctx.app.inject({ method: 'GET', url: '/healthz' });
      latencies.push(performance.now() - t0 - 20);
      expect(h.statusCode).toBe(200);
    }
    const res = await pdf;
    expect(res.statusCode).toBe(200);
    expect(res.rawPayload.subarray(0, 5).toString()).toBe('%PDF-');
    const sorted = [...latencies].sort((x, y) => x - y);
    const median = sorted[Math.floor(sorted.length / 2)]!;
    expect(latencies.length).toBeGreaterThan(5);
    // Sin ceder el event loop, cada iteración espera a que termine un lote completo (~100 ms+).
    expect(median).toBeLessThan(30);
    expect(Math.max(...latencies)).toBeLessThan(150);
  });

  it('H1e: límite de creación de registros por usuario+local (web) y por dispositivo (kiosko)', async () => {
    const rl = testConfig().rateLimits;
    expect(rl.recordCreateUser).toEqual({ limit: 120, windowSeconds: 60 });
    expect(rl.recordCreateDevice).toEqual({ limit: 120, windowSeconds: 60 });
    const tight = await createTestApp({ config: { rateLimits: { ...rl, recordCreateUser: { limit: 3, windowSeconds: 60 }, recordCreateDevice: { limit: 2, windowSeconds: 60 } } } });
    try {
      await resetDb(tight);
      const { client, base, org } = await setupOwner(tight);
      const body = { type: 'plagas', data: { result: 'sin_indicios' } };
      const codes = [];
      for (let i = 0; i < 4; i++) codes.push((await client.post(`${base}/records`, body)).statusCode);
      expect(codes).toEqual([201, 201, 201, 429]);
      const dev = json(await client.post(`${base}/devices`, { name: 'Tablet' }));
      const st = await createStaff(tight, org.id, 'Pedro');
      const k = () =>
        tight.app.inject({ method: 'POST', url: '/api/kiosk/records', headers: { authorization: `Bearer ${dev.token}` }, payload: { staffId: st.id, ...body } });
      expect([(await k()).statusCode, (await k()).statusCode, (await k()).statusCode]).toEqual([201, 201, 429]);
    } finally {
      await closeTestApp(tight);
    }
  });

  it('H1e: /tasks/compliance no crea un Intl.DateTimeFormat por iteración', async () => {
    const { org } = await setupOwner(ctx);
    const fresh = await ctx.deps.db.selectFrom('organizations').selectAll().where('id', '=', org.id).executeTakeFirstOrThrow();
    // Zona no usada antes en este proceso: la primera pasada crea sus formateadores (cacheados).
    const tz = 'Pacific/Chatham';
    const spy = vi.spyOn(Intl, 'DateTimeFormat');
    try {
      await computeCompliance(ctx.deps.db, { ...fresh, timezone: tz }, '2026-01-01', '2026-03-31');
      const first = spy.mock.calls.length;
      expect(first).toBeLessThanOrEqual(3);
      await computeCompliance(ctx.deps.db, { ...fresh, timezone: tz }, '2026-01-01', '2026-03-31');
      expect(spy.mock.calls.length).toBe(first);
    } finally {
      spy.mockRestore();
    }
  });
});
