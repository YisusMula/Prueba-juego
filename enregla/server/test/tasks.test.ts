import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'kysely';
import { closeTestApp, createStaff, createTestApp, firstEquipment, json, resetDb, setupOwner, type TestCtx, FIXED_NOW, FIXED_TODAY, backdateConfig } from './helpers.js';
import { addDays, localDate, isoWeekday, localHour } from '../src/lib/dates.js';
import { isDue, periodStart } from '../src/modules/tasks/service.js';
import { json as toJson } from '../src/db/index.js';

let ctx: TestCtx;
beforeAll(async () => {
  ctx = await createTestApp({ now: () => FIXED_NOW });
});
afterAll(async () => closeTestApp(ctx));
beforeEach(async () => resetDb(ctx));

const TZ = 'Europe/Madrid';

describe('utilidades de fechas y frecuencias', () => {
  it('calcula fecha y hora local con zona horaria', () => {
    const instant = new Date('2026-03-29T22:30:00Z'); // ya es 30/03 en Madrid (CEST)
    expect(localDate(instant, TZ)).toBe('2026-03-30');
    expect(localHour(instant, TZ)).toBe(0);
    expect(localDate(instant, 'Atlantic/Canary')).toBe('2026-03-29');
    expect(isoWeekday('2026-11-09')).toBe(1);
    expect(isoWeekday('2026-11-15')).toBe(7);
  });

  it('frecuencias diaria, semanal y mensual', () => {
    expect(isDue({ frequency: 'daily', weekday: null, month_day: null }, '2026-11-11')).toBe(true);
    expect(isDue({ frequency: 'weekly', weekday: 3, month_day: null }, '2026-11-11')).toBe(true);
    expect(isDue({ frequency: 'weekly', weekday: 3, month_day: null }, '2026-11-12')).toBe(false);
    expect(isDue({ frequency: 'monthly', weekday: null, month_day: 11 }, '2026-11-11')).toBe(true);
    expect(periodStart({ frequency: 'weekly' }, '2026-11-11')).toBe('2026-11-09');
    expect(periodStart({ frequency: 'monthly' }, '2026-11-11')).toBe('2026-11-01');
    expect(periodStart({ frequency: 'daily' }, '2026-11-11')).toBe('2026-11-11');
  });
});

describe('tareas de hoy', () => {
  it('calcula pendientes y hechas según equipos, frecuencias y planes', async () => {
    const { client, base, org } = await setupOwner(ctx);
    await backdateConfig(ctx, org.id);
    const t0 = json(await client.get(`${base}/tasks/today`));
    expect(t0.date).toBe(FIXED_TODAY);
    expect(t0.timezone).toBe(TZ);
    // restaurante: 2 cámaras x2, congelador x1, mesa caliente x3 (la freidora no tiene controles de temperatura)
    expect(t0.temperatures.map((t: { required: number }) => t.required).sort()).toEqual([1, 2, 2, 3]);
    expect(t0.summary.done).toBe(0);
    expect(t0.cleaning.find((c: { frequency: string }) => c.frequency === 'daily').status).toBe('pending');

    const fridge = await firstEquipment(ctx, org.id, 'camara');
    await client.post(`${base}/records`, { type: 'temperatura', data: { equipmentId: fridge.id, value: 2 } });
    await client.post(`${base}/records`, { type: 'temperatura', data: { equipmentId: fridge.id, value: 3 } });
    await client.post(`${base}/records`, { type: 'temperatura', data: { equipmentId: fridge.id, value: 3 } });
    const plan = await ctx.deps.db.selectFrom('cleaning_plans').selectAll().where('organization_id', '=', org.id).where('frequency', '=', 'daily').executeTakeFirstOrThrow();
    await client.post(`${base}/records`, { type: 'limpieza', data: { cleaningPlanId: plan.id, items: plan.items.map((i) => ({ itemId: i.id, done: true })) } });

    const t1 = json(await client.get(`${base}/tasks/today`));
    const f = t1.temperatures.find((t: { equipmentId: string }) => t.equipmentId === fridge.id);
    expect(f).toMatchObject({ required: 2, done: 2, status: 'done', lastReading: { value: 3, outOfRange: false } });
    expect(t1.cleaning.find((c: { cleaningPlanId: string }) => c.cleaningPlanId === plan.id)).toMatchObject({ status: 'done' });
    expect(t1.summary.done).toBe(3);
    expect(t1.summary.total).toBe(t0.summary.total);
    expect(t1.summary.pending).toBe(t1.summary.total - 3);
  });

  it('alertas: fuera de rango, aceite, recepción rechazada, plagas e incidencias abiertas', async () => {
    const { client, base, org } = await setupOwner(ctx);
    const fridge = await firstEquipment(ctx, org.id, 'camara');
    const fryer = await firstEquipment(ctx, org.id, 'freidora');
    await client.post(`${base}/records`, { type: 'temperatura', data: { equipmentId: fridge.id, value: 9, correctiveAction: 'Revisión' } });
    await client.post(`${base}/records`, { type: 'aceite', data: { equipmentId: fryer.id, action: 'revisado', polarCompounds: 30, correctiveAction: 'Cambio' } });
    await client.post(`${base}/records`, { type: 'recepcion', data: { supplierName: 'P', product: 'Pollo', accepted: false, rejectionReason: 'Temperatura' } });
    await client.post(`${base}/records`, { type: 'plagas', data: { result: 'con_indicios', description: 'X', action: 'Y' } });
    const inc = json(await client.post(`${base}/records`, { type: 'incidencia', data: { description: 'Avería lavavajillas', closed: false } })).record;
    const t = json(await client.get(`${base}/tasks/today`));
    expect(t.alerts.map((a: { kind: string }) => a.kind).sort()).toEqual([
      'aceite_fuera_de_limite',
      'incidencia_abierta',
      'plagas_con_indicios',
      'recepcion_rechazada',
      'temperatura_fuera_de_rango',
    ]);
    // cerrar la incidencia mediante enmienda elimina la alerta
    await client.post(`${base}/records/${inc.id}/amendments`, { reason: 'Reparada', data: { description: 'Avería lavavajillas', correctiveAction: 'Técnico', closed: true } });
    const t2 = json(await client.get(`${base}/tasks/today`));
    expect(t2.alerts.some((a: { kind: string }) => a.kind === 'incidencia_abierta')).toBe(false);
  });

  it('una enmienda sustituye al original al contar y en alertas', async () => {
    const { client, base, org } = await setupOwner(ctx);
    const fridge = await firstEquipment(ctx, org.id, 'camara');
    const r = json(await client.post(`${base}/records`, { type: 'temperatura', data: { equipmentId: fridge.id, value: 40, correctiveAction: 'x' } })).record;
    await client.post(`${base}/records/${r.id}/amendments`, { reason: 'Error de tecleo', data: { equipmentId: fridge.id, value: 4 } });
    const t = json(await client.get(`${base}/tasks/today`));
    expect(t.temperatures.find((x: { equipmentId: string }) => x.equipmentId === fridge.id).done).toBe(1);
    expect(t.alerts).toHaveLength(0);
  });
});

describe('resumen de cumplimiento', () => {
  it('% completado por día', async () => {
    const { client, base, org } = await setupOwner(ctx);
    const db = ctx.deps.db;
    await db.updateTable('equipment').set({ active: false }).where('organization_id', '=', org.id).execute();
    await db.updateTable('cleaning_plans').set({ active: false }).where('organization_id', '=', org.id).execute();
    const today = FIXED_TODAY;
    const d2 = addDays(today, -2);
    const d1 = addDays(today, -1);
    const created = sql<Date>`((${addDays(today, -3)}::date)::timestamp AT TIME ZONE ${TZ})`;
    const eq = await db
      .insertInto('equipment')
      .values({ organization_id: org.id, name: 'Cámara test', type: 'camara', max_temp: 4, checks_per_day: 2, created_at: created })
      .returningAll()
      .executeTakeFirstOrThrow();
    const itemId = crypto.randomUUID();
    const plan = await db
      .insertInto('cleaning_plans')
      .values({ organization_id: org.id, name: 'Diaria', frequency: 'daily', items: toJson([{ id: itemId, area: 'Mesa', product: null, method: null }]), created_at: created })
      .returningAll()
      .executeTakeFirstOrThrow();
    const st = await createStaff(ctx, org.id, 'S');
    const at = (d: string, h: string) => sql<Date>`((${d}::date + ${h}::time) AT TIME ZONE ${TZ})`;
    const ins = (d: string, h: string, type: string, extra: Record<string, unknown>) =>
      db
        .insertInto('records')
        .values({ organization_id: org.id, type, data: toJson({}), staff_id: st.id, staff_name: 'S', created_at: at(d, h), ...extra })
        .execute();
    await ins(d2, '09:00', 'temperatura', { equipment_id: eq.id });
    await ins(d2, '18:00', 'temperatura', { equipment_id: eq.id });
    await ins(d2, '19:00', 'temperatura', { equipment_id: eq.id }); // exceso: no cuenta más de lo requerido
    await ins(d2, '20:00', 'limpieza', { cleaning_plan_id: plan.id });
    await ins(d1, '09:00', 'temperatura', { equipment_id: eq.id });

    const res = await client.get(`${base}/tasks/compliance?from=${addDays(today, -4)}&to=${addDays(today, 5)}`);
    expect(res.statusCode).toBe(200);
    const body = json(res);
    const byDate = Object.fromEntries(body.days.map((d: { date: string }) => [d.date, d]));
    expect(byDate[addDays(today, -4)]).toMatchObject({ expected: 0, done: 0, percent: null });
    expect(byDate[d2]).toMatchObject({ expected: 3, done: 3, percent: 100 });
    expect(byDate[d1]).toMatchObject({ expected: 3, done: 1, percent: 33 });
    expect(body.days.at(-1).date).toBe(today); // los días futuros se omiten
    expect((await client.get(`${base}/tasks/compliance?from=2026-01-01&to=2026-12-31`)).statusCode).toBe(400);
    expect((await client.get(`${base}/tasks/compliance?from=2026-02-01&to=2026-01-01`)).statusCode).toBe(400);
  });
});
