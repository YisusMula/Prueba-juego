import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'kysely';
import { closeTestApp, createStaff, createTestApp, firstEquipment, json, resetDb, setupOwner, type TestCtx } from './helpers.js';

let ctx: TestCtx;
beforeAll(async () => {
  ctx = await createTestApp();
});
afterAll(async () => closeTestApp(ctx));
beforeEach(async () => resetDb(ctx));

describe('creación de registros por tipo', () => {
  it('temperatura en rango y fuera de rango (exige acción correctora)', async () => {
    const { client, base, org, user } = await setupOwner(ctx);
    const fridge = await firstEquipment(ctx, org.id, 'camara');
    const ok = await client.post(`${base}/records`, { type: 'temperatura', data: { equipmentId: fridge.id, value: 3.5 } });
    expect(ok.statusCode).toBe(201);
    const rec = json(ok).record;
    expect(rec).toMatchObject({ type: 'temperatura', alert: false, staff: null, user: { id: user.id }, amendsRecordId: null });
    expect(rec.data).toMatchObject({ equipmentId: fridge.id, equipmentName: fridge.name, value: 3.5, maxTemp: 4, outOfRange: false });
    expect(Date.now() - new Date(rec.createdAt).getTime()).toBeLessThan(10_000);

    const bad = await client.post(`${base}/records`, { type: 'temperatura', data: { equipmentId: fridge.id, value: 9 } });
    expect(bad.statusCode).toBe(400);
    expect(json(bad).error.details[0].path).toBe('data.correctiveAction');
    const fixed = await client.post(`${base}/records`, { type: 'temperatura', data: { equipmentId: fridge.id, value: 9, correctiveAction: 'Producto trasladado a otra cámara y avisado el técnico' } });
    expect(fixed.statusCode).toBe(201);
    expect(json(fixed).record).toMatchObject({ alert: true, data: { outOfRange: true } });

    const hot = await firstEquipment(ctx, org.id, 'mesa_caliente');
    expect((await client.post(`${base}/records`, { type: 'temperatura', data: { equipmentId: hot.id, value: 60 } })).statusCode).toBe(400);
    expect((await client.post(`${base}/records`, { type: 'temperatura', data: { equipmentId: hot.id, value: 70 } })).statusCode).toBe(201);
  });

  it('no permite fijar la fecha desde el cliente', async () => {
    const { client, base, org } = await setupOwner(ctx);
    const fridge = await firstEquipment(ctx, org.id, 'camara');
    const res = await client.post(`${base}/records`, { type: 'temperatura', createdAt: '2020-01-01T00:00:00Z', data: { equipmentId: fridge.id, value: 2 } });
    expect(res.statusCode).toBe(201);
    expect(json(res).record.createdAt.startsWith('2020')).toBe(false);
  });

  it('limpieza con ítems hechos / no hechos', async () => {
    const { client, base, org } = await setupOwner(ctx);
    const plan = await ctx.deps.db.selectFrom('cleaning_plans').selectAll().where('organization_id', '=', org.id).where('frequency', '=', 'daily').executeTakeFirstOrThrow();
    const items = plan.items.map((i, idx) => ({ itemId: i.id, done: idx !== 0 }));
    const res = await client.post(`${base}/records`, { type: 'limpieza', data: { cleaningPlanId: plan.id, items, observations: 'Falta producto' } });
    expect(res.statusCode).toBe(201);
    const d = json(res).record.data;
    expect(d.planName).toBe(plan.name);
    expect(d.completed).toBe(false);
    expect(d.items[0]).toMatchObject({ itemId: plan.items[0]!.id, area: plan.items[0]!.area, done: false });
    const bogus = await client.post(`${base}/records`, { type: 'limpieza', data: { cleaningPlanId: plan.id, items: [{ itemId: 'otro', done: true }] } });
    expect(bogus.statusCode).toBe(400);
    const dup = await client.post(`${base}/records`, { type: 'limpieza', data: { cleaningPlanId: plan.id, items: [{ itemId: plan.items[0]!.id, done: true }, { itemId: plan.items[0]!.id, done: false }] } });
    expect(dup.statusCode).toBe(400);
  });

  it('recepción aceptada y rechazada (motivo obligatorio)', async () => {
    const { client, base } = await setupOwner(ctx);
    const sup = json(await client.post(`${base}/suppliers`, { name: 'Pescados Mar' })).supplier;
    const ok = await client.post(`${base}/records`, { type: 'recepcion', data: { supplierId: sup.id, product: 'Merluza', lot: 'L-22', temperature: 1.5, expiryDate: '2026-12-01', accepted: true } });
    expect(ok.statusCode).toBe(201);
    expect(json(ok).record.data).toMatchObject({ supplierName: 'Pescados Mar', product: 'Merluza', accepted: true, rejectionReason: null });
    expect((await client.post(`${base}/records`, { type: 'recepcion', data: { supplierName: 'X', product: 'Pollo', accepted: false } })).statusCode).toBe(400);
    expect((await client.post(`${base}/records`, { type: 'recepcion', data: { product: 'Pollo', accepted: true } })).statusCode).toBe(400);
    const rej = await client.post(`${base}/records`, { type: 'recepcion', data: { supplierName: 'Ocasional', product: 'Pollo', accepted: false, rejectionReason: 'Llegó a 9 °C' } });
    expect(json(rej).record.alert).toBe(true);
    expect((await client.post(`${base}/records`, { type: 'recepcion', data: { supplierName: 'X', product: 'Y', accepted: true, expiryDate: '31/12/2026' } })).statusCode).toBe(400);
  });

  it('aceite: > 25 % de compuestos polares exige acción correctora', async () => {
    const { client, base, org } = await setupOwner(ctx);
    const fryer = await firstEquipment(ctx, org.id, 'freidora');
    const fridge = await firstEquipment(ctx, org.id, 'camara');
    expect((await client.post(`${base}/records`, { type: 'aceite', data: { equipmentId: fryer.id, action: 'revisado', polarCompounds: 18 } })).statusCode).toBe(201);
    expect((await client.post(`${base}/records`, { type: 'aceite', data: { equipmentId: fryer.id, action: 'revisado', polarCompounds: 25 } })).statusCode).toBe(201);
    const over = await client.post(`${base}/records`, { type: 'aceite', data: { equipmentId: fryer.id, action: 'revisado', polarCompounds: 27 } });
    expect(over.statusCode).toBe(400);
    expect(json(over).error.details[0].path).toBe('data.correctiveAction');
    const fixed = await client.post(`${base}/records`, { type: 'aceite', data: { equipmentId: fryer.id, action: 'cambiado', polarCompounds: 27, correctiveAction: 'Aceite sustituido' } });
    expect(json(fixed).record).toMatchObject({ alert: true, data: { overLimit: true, fryerName: fryer.name } });
    expect((await client.post(`${base}/records`, { type: 'aceite', data: { equipmentId: fridge.id, action: 'revisado' } })).statusCode).toBe(400);
  });

  it('plagas e incidencias', async () => {
    const { client, base } = await setupOwner(ctx);
    expect((await client.post(`${base}/records`, { type: 'plagas', data: { result: 'sin_indicios' } })).statusCode).toBe(201);
    expect((await client.post(`${base}/records`, { type: 'plagas', data: { result: 'con_indicios' } })).statusCode).toBe(400);
    const p = await client.post(`${base}/records`, { type: 'plagas', data: { result: 'con_indicios', description: 'Excrementos en almacén', action: 'Aviso a empresa DDD' } });
    expect(json(p).record.alert).toBe(true);
    const inc = await client.post(`${base}/records`, { type: 'incidencia', data: { description: 'Corte de luz 2 h', correctiveAction: 'Revisión de temperaturas', closed: false } });
    expect(json(inc).record.alert).toBe(true);
    expect((await client.post(`${base}/records`, { type: 'incidencia', data: { closed: false } })).statusCode).toBe(400);
  });

  it('formación de manipuladores', async () => {
    const { client, base, org } = await setupOwner(ctx);
    const st = await createStaff(ctx, org.id, 'Marta');
    const res = await client.post(`${base}/records`, { type: 'formacion', data: { traineeStaffId: st.id, course: 'Manipulador de alimentos - alérgenos', trainingDate: '2026-10-15', trainer: 'Academia X', hours: 4 } });
    expect(res.statusCode).toBe(201);
    expect(json(res).record.data).toMatchObject({ traineeName: 'Marta', trainingDate: '2026-10-15', hours: 4 });
    expect((await client.post(`${base}/records`, { type: 'formacion', data: { traineeStaffId: st.id, trainingDate: '2026-10-15' } })).statusCode).toBe(400);
  });

  it('firma por personal: debe ser del local y estar activo', async () => {
    const { client, base, org } = await setupOwner(ctx);
    const st = await createStaff(ctx, org.id, 'Juan');
    const res = await client.post(`${base}/records`, { type: 'plagas', staffId: st.id, data: { result: 'sin_indicios' } });
    expect(json(res).record.staff).toEqual({ id: st.id, name: 'Juan' });
    await ctx.deps.db.updateTable('staff').set({ active: false }).where('id', '=', st.id).execute();
    expect((await client.post(`${base}/records`, { type: 'plagas', staffId: st.id, data: { result: 'sin_indicios' } })).statusCode).toBe(400);
  });

  it('tipo desconocido → 400', async () => {
    const { client, base } = await setupOwner(ctx);
    expect((await client.post(`${base}/records`, { type: 'otro', data: {} })).statusCode).toBe(400);
  });
});

describe('listado y detalle', () => {
  it('filtra por tipo, alerta, fechas y pagina por cursor (más recientes primero)', async () => {
    const { client, base, org } = await setupOwner(ctx);
    const fridge = await firstEquipment(ctx, org.id, 'camara');
    for (let i = 0; i < 5; i++) await client.post(`${base}/records`, { type: 'temperatura', data: { equipmentId: fridge.id, value: i } });
    await client.post(`${base}/records`, { type: 'incidencia', data: { description: 'X', closed: false } });
    const p1 = json(await client.get(`${base}/records?type=temperatura&limit=3`));
    expect(p1.items.map((r: { data: { value: number } }) => r.data.value)).toEqual([4, 3, 2]);
    const p2 = json(await client.get(`${base}/records?type=temperatura&limit=3&cursor=${p1.nextCursor}`));
    expect(p2.items.map((r: { data: { value: number } }) => r.data.value)).toEqual([1, 0]);
    expect(p2.nextCursor).toBeNull();
    expect(json(await client.get(`${base}/records?alert=true`)).items).toHaveLength(1);
    expect(json(await client.get(`${base}/records?equipmentId=${fridge.id}`)).items).toHaveLength(5);
    expect(json(await client.get(`${base}/records?from=2000-01-01&to=2000-01-31`)).items).toHaveLength(0);
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid' }).format(new Date());
    expect(json(await client.get(`${base}/records?from=${today}&to=${today}`)).items).toHaveLength(6);
    expect((await client.get(`${base}/records?type=nada`)).statusCode).toBe(400);
    expect((await client.get(`${base}/records?from=hoy`)).statusCode).toBe(400);
  });
});

describe('inmutabilidad y enmiendas', () => {
  it('no existen rutas de edición ni borrado', async () => {
    const { client, base } = await setupOwner(ctx);
    const r = json(await client.post(`${base}/records`, { type: 'incidencia', data: { description: 'X', closed: false } })).record;
    expect((await client.patch(`${base}/records/${r.id}`, { data: {} })).statusCode).toBe(404);
    expect((await client.delete(`${base}/records/${r.id}`)).statusCode).toBe(404);
    expect((await client.req('PUT', `${base}/records/${r.id}`, {})).statusCode).toBe(404);
  });

  it('la base de datos rechaza UPDATE y DELETE en registros', async () => {
    const { client, base } = await setupOwner(ctx);
    const r = json(await client.post(`${base}/records`, { type: 'incidencia', data: { description: 'X', closed: false } })).record;
    await expect(sql`UPDATE records SET alert = false WHERE id = ${r.id}`.execute(ctx.deps.db)).rejects.toThrow(/append-only/);
    await expect(sql`DELETE FROM records WHERE id = ${r.id}`.execute(ctx.deps.db)).rejects.toThrow(/append-only/);
    await expect(sql`DELETE FROM staff`.execute(ctx.deps.db)).resolves.toBeDefined();
    const st = json(await client.post(`${base}/staff`, { name: 'S' })).staff;
    await client.post(`${base}/records`, { type: 'incidencia', staffId: st.id, data: { description: 'Y', closed: true } });
    await expect(sql`DELETE FROM staff WHERE id = ${st.id}`.execute(ctx.deps.db)).rejects.toThrow(/append-only/);
  });

  it('una enmienda referencia al original con motivo; solo una por registro', async () => {
    const { client, base, org } = await setupOwner(ctx);
    const fridge = await firstEquipment(ctx, org.id, 'camara');
    const orig = json(await client.post(`${base}/records`, { type: 'temperatura', data: { equipmentId: fridge.id, value: 30, correctiveAction: 'Error' } })).record;
    expect((await client.post(`${base}/records/${orig.id}/amendments`, { data: { equipmentId: fridge.id, value: 3 } })).statusCode).toBe(400);
    const am = await client.post(`${base}/records/${orig.id}/amendments`, { reason: 'Error al teclear: eran 3,0 °C', data: { equipmentId: fridge.id, value: 3 } });
    expect(am.statusCode).toBe(201);
    const amended = json(am).record;
    expect(amended).toMatchObject({ type: 'temperatura', amendsRecordId: orig.id, amendmentReason: 'Error al teclear: eran 3,0 °C', alert: false });
    const again = await client.post(`${base}/records/${orig.id}/amendments`, { reason: 'Otra vez', data: { equipmentId: fridge.id, value: 2 } });
    expect(again.statusCode).toBe(409);
    // se puede enmendar la enmienda (cadena)
    expect((await client.post(`${base}/records/${amended.id}/amendments`, { reason: 'Precisión', data: { equipmentId: fridge.id, value: 3.2 } })).statusCode).toBe(201);
    // el original sigue intacto
    const detail = json(await client.get(`${base}/records/${orig.id}`));
    expect(detail.record.data.value).toBe(30);
    expect(detail.record.amendedByRecordId).toBe(amended.id);
    expect(detail.amendedBy.id).toBe(amended.id);
    expect(detail.amends).toBeNull();
    // la enmienda valida con el esquema del tipo original
    const inc = json(await client.post(`${base}/records`, { type: 'incidencia', data: { description: 'Abierta', closed: false } })).record;
    expect((await client.post(`${base}/records/${inc.id}/amendments`, { reason: 'Cierre', data: { equipmentId: fridge.id, value: 3 } })).statusCode).toBe(400);
    const closed = await client.post(`${base}/records/${inc.id}/amendments`, { reason: 'Incidencia resuelta', data: { description: 'Abierta', correctiveAction: 'Reparado', closed: true } });
    expect(json(closed).record.alert).toBe(false);
  });
});
