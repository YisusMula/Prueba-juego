import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ALL_NO, PASSWORD, closeTestApp, createStaff, createTestApp, firstEquipment, json, resetDb, setupOwner, type TestCtx } from './helpers.js';

let ctx: TestCtx;
beforeAll(async () => {
  ctx = await createTestApp();
});
afterAll(async () => closeTestApp(ctx));
beforeEach(async () => resetDb(ctx));

/**
 * Aislamiento multi-tenant: el usuario de la org A no puede leer ni modificar
 * nada de la org B. IDs ajenos → 404, tanto en la ruta de B como "colados" en A.
 */
describe('aislamiento entre organizaciones', () => {
  it('A no puede acceder a ningún recurso de B', async () => {
    const A = await setupOwner(ctx, 'a@example.com');
    const B = await setupOwner(ctx, 'b@example.com');
    const bFridge = await firstEquipment(ctx, B.org.id, 'camara');
    const bFryer = await firstEquipment(ctx, B.org.id, 'freidora');
    const bPlan = await ctx.deps.db.selectFrom('cleaning_plans').selectAll().where('organization_id', '=', B.org.id).executeTakeFirstOrThrow();
    const bStaff = await createStaff(ctx, B.org.id, 'Staff B', '1234');
    const bSupplier = json(await B.client.post(`${B.base}/suppliers`, { name: 'Prov B' })).supplier;
    const bDish = json(await B.client.post(`${B.base}/dishes`, { name: 'Plato B', allergens: ALL_NO })).dish;
    const bDevice = json(await B.client.post(`${B.base}/devices`, { name: 'Tablet B' })).device;
    const bRecord = json(await B.client.post(`${B.base}/records`, { type: 'incidencia', data: { description: 'Secreto B', closed: false } })).record;
    const bInv = json(await B.client.post(`${B.base}/invitations`, { email: 'x@example.com' })).invitation;

    // 1) Rutas de la org B con la sesión de A → 404 en todo
    const bUrls: [string, string, unknown?][] = [
      ['GET', B.base],
      ['PATCH', B.base, { name: 'X' }],
      ['DELETE', B.base, { password: PASSWORD }],
      ['GET', `${B.base}/export`],
      ['GET', `${B.base}/audit`],
      ['GET', `${B.base}/members`],
      ['GET', `${B.base}/membership`],
      ['PATCH', `${B.base}/membership`, { dailyReminder: false }],
      ['PATCH', `${B.base}/members/${B.user.id}`, { role: 'manager' }],
      ['DELETE', `${B.base}/members/${B.user.id}`],
      ['GET', `${B.base}/invitations`],
      ['POST', `${B.base}/invitations`, { email: 'z@example.com' }],
      ['DELETE', `${B.base}/invitations/${bInv.id}`],
      ['GET', `${B.base}/staff`],
      ['POST', `${B.base}/staff`, { name: 'X' }],
      ['PATCH', `${B.base}/staff/${bStaff.id}`, { name: 'X' }],
      ['POST', `${B.base}/staff/${bStaff.id}/unlock`],
      ['GET', `${B.base}/devices`],
      ['POST', `${B.base}/devices`, { name: 'X' }],
      ['DELETE', `${B.base}/devices/${bDevice.id}`],
      ['GET', `${B.base}/equipment`],
      ['GET', `${B.base}/equipment/${bFridge.id}`],
      ['POST', `${B.base}/equipment`, { name: 'X', type: 'camara' }],
      ['PATCH', `${B.base}/equipment/${bFridge.id}`, { name: 'X' }],
      ['GET', `${B.base}/cleaning-plans`],
      ['GET', `${B.base}/cleaning-plans/${bPlan.id}`],
      ['PATCH', `${B.base}/cleaning-plans/${bPlan.id}`, { name: 'X' }],
      ['GET', `${B.base}/suppliers`],
      ['GET', `${B.base}/suppliers/${bSupplier.id}`],
      ['PATCH', `${B.base}/suppliers/${bSupplier.id}`, { name: 'X' }],
      ['DELETE', `${B.base}/suppliers/${bSupplier.id}`],
      ['GET', `${B.base}/records`],
      ['GET', `${B.base}/records/${bRecord.id}`],
      ['POST', `${B.base}/records`, { type: 'incidencia', data: { description: 'X', closed: true } }],
      ['POST', `${B.base}/records/${bRecord.id}/amendments`, { reason: 'X', data: { description: 'X', closed: true } }],
      ['GET', `${B.base}/dishes`],
      ['GET', `${B.base}/dishes/${bDish.id}`],
      ['PATCH', `${B.base}/dishes/${bDish.id}`, { name: 'X' }],
      ['DELETE', `${B.base}/dishes/${bDish.id}`],
      ['GET', `${B.base}/public-menu`],
      ['PATCH', `${B.base}/public-menu`, { enabled: true }],
      ['POST', `${B.base}/public-menu/regenerate`],
      ['GET', `${B.base}/tasks/today`],
      ['GET', `${B.base}/tasks/compliance?from=2026-01-01&to=2026-01-31`],
      ['GET', `${B.base}/reports/pdf?from=2026-01-01&to=2026-01-31`],
      ['GET', `${B.base}/reports/csv?from=2026-01-01&to=2026-01-31`],
      ['GET', `${B.base}/billing`],
      ['POST', `${B.base}/billing/checkout`, { plan: 'monthly' }],
      ['POST', `${B.base}/billing/portal`],
    ];
    for (const [method, url, body] of bUrls) {
      const res = await A.client.req(method as 'GET', url, body);
      expect(res.statusCode, `${method} ${url}`).toBe(404);
      expect(res.body).not.toContain('Secreto B');
    }

    // 2) IDs de B usados dentro de la org A → 404
    const aUrls: [string, string, unknown?][] = [
      ['PATCH', `${A.base}/staff/${bStaff.id}`, { name: 'X' }],
      ['POST', `${A.base}/staff/${bStaff.id}/unlock`],
      ['DELETE', `${A.base}/devices/${bDevice.id}`],
      ['GET', `${A.base}/equipment/${bFridge.id}`],
      ['PATCH', `${A.base}/equipment/${bFridge.id}`, { name: 'X' }],
      ['GET', `${A.base}/cleaning-plans/${bPlan.id}`],
      ['PATCH', `${A.base}/cleaning-plans/${bPlan.id}`, { name: 'X' }],
      ['GET', `${A.base}/suppliers/${bSupplier.id}`],
      ['PATCH', `${A.base}/suppliers/${bSupplier.id}`, { name: 'X' }],
      ['DELETE', `${A.base}/suppliers/${bSupplier.id}`],
      ['GET', `${A.base}/records/${bRecord.id}`],
      ['POST', `${A.base}/records/${bRecord.id}/amendments`, { reason: 'X', data: { description: 'X', closed: true } }],
      ['GET', `${A.base}/dishes/${bDish.id}`],
      ['PATCH', `${A.base}/dishes/${bDish.id}`, { name: 'X' }],
      ['DELETE', `${A.base}/dishes/${bDish.id}`],
      ['DELETE', `${A.base}/invitations/${bInv.id}`],
      ['PATCH', `${A.base}/members/${B.user.id}`, { role: 'manager' }],
      ['DELETE', `${A.base}/members/${B.user.id}`],
      // referencias ajenas dentro del cuerpo
      ['POST', `${A.base}/records`, { type: 'temperatura', data: { equipmentId: bFridge.id, value: 2 } }],
      ['POST', `${A.base}/records`, { type: 'aceite', data: { equipmentId: bFryer.id, action: 'revisado' } }],
      ['POST', `${A.base}/records`, { type: 'limpieza', data: { cleaningPlanId: bPlan.id, items: [{ itemId: 'x', done: true }] } }],
      ['POST', `${A.base}/records`, { type: 'recepcion', data: { supplierId: bSupplier.id, product: 'X', accepted: true } }],
      ['POST', `${A.base}/records`, { type: 'formacion', data: { traineeStaffId: bStaff.id, course: 'X', trainingDate: '2026-01-01' } }],
      ['POST', `${A.base}/records`, { type: 'incidencia', staffId: bStaff.id, data: { description: 'X', closed: true } }],
    ];
    for (const [method, url, body] of aUrls) {
      const res = await A.client.req(method as 'GET', url, body);
      expect(res.statusCode, `${method} ${url}`).toBe(404);
    }

    // 3) Listados de A no contienen nada de B; cursores de B no filtran datos
    const aRecords = await A.client.get(`${A.base}/records`);
    expect(json(aRecords).items).toHaveLength(0);
    const viaCursor = await A.client.get(`${A.base}/records?cursor=${bRecord.id}`);
    expect(json(viaCursor).items).toHaveLength(0);
    expect((await A.client.get(`${A.base}/export`)).body).not.toContain('Secreto B');
    expect((await A.client.get('/api/orgs')).body).not.toContain(B.org.id);

    // 4) Nada de B ha cambiado
    const bAfter = json(await B.client.get(`${B.base}/records/${bRecord.id}`));
    expect(bAfter.record.data.description).toBe('Secreto B');
    expect(bAfter.amendedBy).toBeNull();
    expect(json(await B.client.get(`${B.base}/suppliers`)).items).toHaveLength(1);
    expect(json(await B.client.get(`${B.base}/dishes`)).items).toHaveLength(1);
    expect(json(await B.client.get(`${B.base}/devices`)).items[0].active).toBe(true);
    expect(json(await B.client.get(`${B.base}/members`)).items).toHaveLength(1);
    expect(json(await B.client.get(B.base)).organization.name).toBe(B.org.name);
  });

  it('el token de kiosko de A no da acceso a datos de B', async () => {
    const A = await setupOwner(ctx, 'a@example.com');
    const B = await setupOwner(ctx, 'b@example.com');
    const bStaff = await createStaff(ctx, B.org.id, 'Staff B');
    const bFridge = await firstEquipment(ctx, B.org.id, 'camara');
    const token = json(await A.client.post(`${A.base}/devices`, { name: 'Tablet A' })).token;
    const k = { authorization: `Bearer ${token}` };
    const ctxRes = json(await ctx.app.inject({ method: 'GET', url: '/api/kiosk/context', headers: k }));
    expect(JSON.stringify(ctxRes)).not.toContain('Staff B');
    const aStaff = await createStaff(ctx, A.org.id, 'Staff A');
    const r1 = await ctx.app.inject({ method: 'POST', url: '/api/kiosk/records', headers: k, payload: { staffId: bStaff.id, type: 'plagas', data: { result: 'sin_indicios' } } });
    expect(r1.statusCode).toBe(404);
    const r2 = await ctx.app.inject({ method: 'POST', url: '/api/kiosk/records', headers: k, payload: { staffId: aStaff.id, type: 'temperatura', data: { equipmentId: bFridge.id, value: 2 } } });
    expect(r2.statusCode).toBe(404);
  });
});
