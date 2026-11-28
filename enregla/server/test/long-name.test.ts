import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { closeTestApp, createTestApp, FIXED_NOW, FIXED_TODAY, resetDb, setupOwner, type TestCtx } from './helpers.js';

let ctx: TestCtx;
beforeAll(async () => {
  ctx = await createTestApp({ now: () => FIXED_NOW });
});
afterAll(async () => closeTestApp(ctx));
beforeEach(async () => resetDb(ctx));

/** Nombre de local de 100 caracteres sin espacios (el máximo permitido): no debe romper el PDF ni los emails. */
const LONG = `Local${'W'.repeat(95)}`;

describe('nombre de local larguísimo', () => {
  it('el informe PDF se genera y contiene el nombre completo, repartido en varias líneas', async () => {
    const { client, base, org } = await setupOwner(ctx);
    await ctx.deps.db.updateTable('organizations').set({ name: LONG }).where('id', '=', org.id).execute();
    await client.post(`${base}/records`, { type: 'incidencia', data: { description: 'Prueba', closed: false } });
    const res = await client.get(`${base}/reports/pdf?from=${FIXED_TODAY}&to=${FIXED_TODAY}&types=incidencia`);
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.rawPayload.subarray(0, 5).toString()).toBe('%PDF-');
    expect(res.rawPayload.subarray(-6).toString()).toContain('%%EOF');
  });

  it('los emails con el nombre del local se envían (acotado) sin romper la plantilla', async () => {
    const { client, base, org } = await setupOwner(ctx);
    await ctx.deps.db.updateTable('organizations').set({ name: LONG }).where('id', '=', org.id).execute();
    expect((await client.post(`${base}/invitations`, { email: 'largo@example.com' })).statusCode).toBe(201);
    const m = ctx.mailer.outbox.find((x) => x.to === 'largo@example.com')!;
    expect(m).toBeDefined();
    expect(m.html).toContain('<html');
    expect(m.html).toContain('</html>');
    expect(m.text).toContain('Local');
    expect(m.subject).not.toContain('WWWW');
  });
});
