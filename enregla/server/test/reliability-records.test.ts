import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'kysely';
import { closeTestApp, createStaff, createTestApp, FIXED_NOW, FIXED_TODAY, json, resetDb, setupOwner, type TestCtx } from './helpers.js';
import { addDays } from '../src/lib/dates.js';
import { json as toJson } from '../src/db/index.js';
import { hashSecret } from '../src/lib/password.js';
import { randomToken, sha256 } from '../src/lib/crypto.js';

// Reloj fijo: martes 10/11/2026 11:00 (Madrid). "Ayer" = 09/11/2026.
let ctx: TestCtx;
beforeAll(async () => {
  ctx = await createTestApp({ now: () => FIXED_NOW });
});
afterAll(async () => closeTestApp(ctx));
beforeEach(async () => resetDb(ctx));

const TZ = 'Europe/Madrid';
const TODAY = FIXED_TODAY;
const YESTERDAY = addDays(TODAY, -1);
/** Instante local (Madrid) de un día y hora. */
const at = (d: string, h: string) => sql<Date>`((${d}::date + ${h}::time) AT TIME ZONE ${TZ})`;
const daysAgo = (n: number) => new Date(FIXED_NOW.getTime() - n * 86_400_000);

async function makeEquipment(orgId: string, name: string, checks = 1, createdDaysAgo = 10) {
  return ctx.deps.db
    .insertInto('equipment')
    .values({ organization_id: orgId, name, type: 'camara', max_temp: 4, checks_per_day: checks, created_at: daysAgo(createdDaysAgo) })
    .returningAll()
    .executeTakeFirstOrThrow();
}
async function makePlan(orgId: string, createdDaysAgo = 10) {
  return ctx.deps.db
    .insertInto('cleaning_plans')
    .values({
      organization_id: orgId,
      name: 'Diaria test',
      frequency: 'daily',
      items: toJson([{ id: crypto.randomUUID(), area: 'Mesa', product: null, method: null }]),
      created_at: daysAgo(createdDaysAgo),
    })
    .returningAll()
    .executeTakeFirstOrThrow();
}
async function insertRecord(orgId: string, staffId: string, type: string, when: ReturnType<typeof at>, extra: Record<string, unknown>, data: Record<string, unknown> = {}) {
  return ctx.deps.db
    .insertInto('records')
    .values({ organization_id: orgId, type, data: toJson(data), staff_id: staffId, staff_name: 'S', created_at: when, ...extra })
    .returningAll()
    .executeTakeFirstOrThrow();
}
async function compliance(client: Awaited<ReturnType<typeof setupOwner>>['client'], base: string, from: string, to = TODAY) {
  const body = json(await client.get(`${base}/tasks/compliance?from=${from}&to=${to}`));
  return Object.fromEntries(body.days.map((d: { date: string }) => [d.date, d])) as Record<string, { expected: number; done: number; percent: number | null }>;
}

describe('1. enmiendas: fecha del hecho (effective_at)', () => {
  it('enmendar hoy un registro de ayer no cambia el cumplimiento de ayer ni el de hoy', async () => {
    const { client, base, org } = await setupOwner(ctx);
    const eq = await makeEquipment(org.id, 'Cámara 1');
    const st = await createStaff(ctx, org.id, 'S');
    const orig = await insertRecord(org.id, st.id, 'temperatura', at(YESTERDAY, '09:00'), { equipment_id: eq.id }, { equipmentId: eq.id, value: 9 });
    const before = await compliance(client, base, YESTERDAY);
    expect(before[YESTERDAY]).toMatchObject({ expected: 1, done: 1 });
    expect(before[TODAY]).toMatchObject({ expected: 1, done: 0 });

    const res = await client.post(`${base}/records/${orig.id}/amendments`, { reason: 'Error de tecleo', data: { equipmentId: eq.id, value: 3 } });
    expect(res.statusCode).toBe(201);
    const amend = json(res).record;
    // createdAt = hora real de la enmienda; effectiveAt = la del original.
    expect(amend.createdAt).toBe(FIXED_NOW.toISOString());
    expect(amend.effectiveAt).toBe(orig.created_at.toISOString());

    const after = await compliance(client, base, YESTERDAY);
    expect(after[YESTERDAY]).toMatchObject({ expected: 1, done: 1, percent: 100 });
    expect(after[TODAY]).toMatchObject({ expected: 1, done: 0 });
    const today = json(await client.get(`${base}/tasks/today`));
    expect(today.temperatures.find((t: { equipmentId: string }) => t.equipmentId === eq.id).done).toBe(0);

    // Enmienda de la enmienda: sigue siendo del día del original.
    const amend2 = json(await client.post(`${base}/records/${amend.id}/amendments`, { reason: 'Otra vez', data: { equipmentId: eq.id, value: 2 } })).record;
    expect(amend2.effectiveAt).toBe(orig.created_at.toISOString());
    expect((await compliance(client, base, YESTERDAY))[YESTERDAY]).toMatchObject({ done: 1 });

    // El historial filtra y ordena por la fecha del hecho: la cadena aparece en "ayer".
    const hist = json(await client.get(`${base}/records?from=${YESTERDAY}&to=${YESTERDAY}`)).items as { id: string }[];
    expect(hist.map((r) => r.id).sort()).toEqual([orig.id, amend.id, amend2.id].sort());
    expect(json(await client.get(`${base}/records?from=${TODAY}&to=${TODAY}`)).items).toHaveLength(0);
  });

  it('una enmienda que cambia de equipo mueve el hecho al nuevo equipo en el mismo día', async () => {
    const { client, base, org } = await setupOwner(ctx);
    const a = await makeEquipment(org.id, 'A');
    const b = await makeEquipment(org.id, 'B');
    const st = await createStaff(ctx, org.id, 'S');
    const orig = await insertRecord(org.id, st.id, 'temperatura', at(YESTERDAY, '10:00'), { equipment_id: a.id }, { equipmentId: a.id, value: 3 });
    expect((await compliance(client, base, YESTERDAY))[YESTERDAY]).toMatchObject({ expected: 2, done: 1 });
    await client.post(`${base}/records/${orig.id}/amendments`, { reason: 'Era la cámara B', data: { equipmentId: b.id, value: 3 } });
    const c = await compliance(client, base, YESTERDAY);
    expect(c[YESTERDAY]).toMatchObject({ expected: 2, done: 1 });
    expect(c[TODAY]).toMatchObject({ expected: 2, done: 0 });
    const rows = await ctx.deps.db
      .selectFrom('records')
      .select(['equipment_id', sql<string>`((effective_at AT TIME ZONE ${TZ})::date)::text`.as('day')])
      .where('organization_id', '=', org.id)
      .where('amends_record_id', 'is not', null)
      .execute();
    expect(rows).toEqual([{ equipment_id: b.id, day: YESTERDAY }]);
  });

  it('limpieza: enmendar hoy la limpieza de ayer la mantiene hecha ayer y no marca hoy', async () => {
    const { client, base, org } = await setupOwner(ctx);
    const plan = await makePlan(org.id);
    const st = await createStaff(ctx, org.id, 'S');
    const itemId = plan.items[0]!.id;
    const orig = await insertRecord(org.id, st.id, 'limpieza', at(YESTERDAY, '20:00'), { cleaning_plan_id: plan.id }, { cleaningPlanId: plan.id });
    await client.post(`${base}/records/${orig.id}/amendments`, { reason: 'Faltaba un ítem', data: { cleaningPlanId: plan.id, items: [{ itemId, done: true }] } });
    const c = await compliance(client, base, YESTERDAY);
    expect(c[YESTERDAY]).toMatchObject({ expected: 1, done: 1 });
    expect(c[TODAY]).toMatchObject({ expected: 1, done: 0 });
    const t = json(await client.get(`${base}/tasks/today`));
    expect(t.cleaning.find((x: { cleaningPlanId: string }) => x.cleaningPlanId === plan.id).status).toBe('pending');
  });

  it('informes: fecha del hecho y, aparte, cuándo y quién enmendó; paginación por cursor estable', async () => {
    const { client, base, org } = await setupOwner(ctx);
    const eq = await makeEquipment(org.id, 'Cámara 1');
    const st = await createStaff(ctx, org.id, 'S');
    const orig = await insertRecord(org.id, st.id, 'temperatura', at(YESTERDAY, '09:00'), { equipment_id: eq.id }, { equipmentId: eq.id, value: 9 });
    await client.post(`${base}/records/${orig.id}/amendments`, { reason: 'Error', data: { equipmentId: eq.id, value: 3 } });
    const csv = (await client.get(`${base}/reports/csv?from=${YESTERDAY}&to=${YESTERDAY}`)).body;
    const lines = csv.trim().split('\r\n');
    expect(lines).toHaveLength(3);
    const header = lines[0]!.replace('﻿', '').split(';');
    const amendLine = lines.find((l) => l.includes('"Error"'))!.split(';');
    const col = (name: string) => amendLine[header.indexOf(`"${name}"`)];
    expect(col('fecha_hora')).toBe('"09/11/2026 09:00"');
    expect(col('fecha_registro')).toBe('"10/11/2026 11:00"');
    expect(col('enmendado_por')).toBe('"owner"');
    // Cursor: 3 registros de ayer + 2 de hoy, en páginas de 2, sin repetidos ni huecos.
    for (const h of ['12:00', '13:00']) await insertRecord(org.id, st.id, 'plagas', at(YESTERDAY, h), {}, { result: 'sin_indicios' });
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const page: { items: { id: string }[]; nextCursor: string | null } = json(await client.get(`${base}/records?limit=2${cursor ? `&cursor=${cursor}` : ''}`));
      seen.push(...page.items.map((r) => r.id));
      cursor = page.nextCursor;
    } while (cursor);
    expect(seen).toHaveLength(4);
    expect(new Set(seen).size).toBe(4);
  });

  it('la migración rellena effective_at y el trigger de inmutabilidad sigue bloqueando cambios', async () => {
    const { org } = await setupOwner(ctx);
    const st = await createStaff(ctx, org.id, 'S');
    const r = await insertRecord(org.id, st.id, 'plagas', at(YESTERDAY, '08:00'), {}, { result: 'sin_indicios' });
    expect(r.effective_at.toISOString()).toBe(r.created_at.toISOString());
    await expect(sql`UPDATE records SET effective_at = now() WHERE id = ${r.id}`.execute(ctx.deps.db)).rejects.toThrow(/append-only/);
  });
});

describe('6. vigencia histórica de la configuración', () => {
  async function addHistory(orgId: string, equipmentId: string, valid_from: ReturnType<typeof at>, checks: number, active: boolean) {
    await ctx.deps.db.insertInto('equipment_config_history').values({ organization_id: orgId, equipment_id: equipmentId, valid_from, checks_per_day: checks, active }).execute();
  }

  it('desactivar, reactivar o cambiar la frecuencia no reescribe el pasado', async () => {
    const { client, base, org } = await setupOwner(ctx);
    const eq = await makeEquipment(org.id, 'Cámara', 2, 10);
    const d = (n: number) => addDays(TODAY, -n);
    await addHistory(org.id, eq.id, at(d(5), '12:00'), 2, false); // desactivado a mediodía
    await addHistory(org.id, eq.id, at(d(3), '15:00'), 2, true); // reactivado por la tarde
    await addHistory(org.id, eq.id, at(d(1), '10:00'), 1, true); // pasa a 1 control/día
    const c = await compliance(client, base, d(6));
    expect(c[d(6)]).toMatchObject({ expected: 2 });
    expect(c[d(5)]).toMatchObject({ expected: 0, percent: null }); // día de desactivación: no exigible
    expect(c[d(4)]).toMatchObject({ expected: 0 });
    expect(c[d(3)]).toMatchObject({ expected: 0 }); // día de reactivación: no exigible
    expect(c[d(2)]).toMatchObject({ expected: 2 });
    expect(c[d(1)]).toMatchObject({ expected: 1 });
    expect(c[TODAY]).toMatchObject({ expected: 1 });
  });

  it('desactivar un equipo hoy (por la API) no borra lo exigido en días pasados', async () => {
    const { client, base, org } = await setupOwner(ctx);
    const eq = await makeEquipment(org.id, 'Cámara', 1, 10);
    const before = await compliance(client, base, addDays(TODAY, -3), YESTERDAY);
    expect(before[YESTERDAY]).toMatchObject({ expected: 1 });
    expect((await client.patch(`${base}/equipment/${eq.id}`, { active: false })).statusCode).toBe(200);
    expect((await client.patch(`${base}/equipment/${eq.id}`, { checksPerDay: 3 })).statusCode).toBe(200);
    const after = await compliance(client, base, addDays(TODAY, -3), YESTERDAY);
    expect(after[YESTERDAY]).toMatchObject({ expected: 1 });
    expect(after[addDays(TODAY, -3)]).toMatchObject({ expected: 1 });
    const hist = await ctx.deps.db.selectFrom('equipment_config_history').selectAll().where('equipment_id', '=', eq.id).orderBy('id').execute();
    expect(hist.map((h) => [h.checks_per_day, h.active])).toEqual([
      [1, true],
      [1, false],
      [3, false],
    ]);
  });

  it('planes: cambio de frecuencia y desactivación a mitad de periodo', async () => {
    const { client, base, org } = await setupOwner(ctx);
    const plan = await makePlan(org.id, 10);
    const d = (n: number) => addDays(TODAY, -n);
    // Hace 4 días a las 08:00 pasa a semanal (lunes); hace 2 días se desactiva.
    await ctx.deps.db
      .insertInto('cleaning_plan_config_history')
      .values([
        { organization_id: org.id, cleaning_plan_id: plan.id, valid_from: at(d(4), '08:00'), frequency: 'weekly', weekday: 1, month_day: null, active: true },
        { organization_id: org.id, cleaning_plan_id: plan.id, valid_from: at(d(2), '08:00'), frequency: 'weekly', weekday: 1, month_day: null, active: false },
      ])
      .execute();
    const c = await compliance(client, base, d(6));
    expect(c[d(6)]).toMatchObject({ expected: 1 }); // diaria
    expect(c[d(5)]).toMatchObject({ expected: 1 });
    expect(c[d(4)]).toMatchObject({ expected: 0 }); // 06/11 viernes, ya semanal (lunes)
    expect(c[d(1)]).toMatchObject({ expected: 0 }); // 09/11 lunes, pero desactivado
  });

  it('el día de alta no es exigible, aunque lo registrado ese día figura como hecho', async () => {
    const { client, base, org } = await setupOwner(ctx);
    // Alta ayer a las 20:00 y alta hoy a las 10:30.
    const late = await ctx.deps.db
      .insertInto('equipment')
      .values({ organization_id: org.id, name: 'Nueva', type: 'camara', max_temp: 4, checks_per_day: 1, created_at: at(YESTERDAY, '20:00') })
      .returningAll()
      .executeTakeFirstOrThrow();
    const todayEq = await ctx.deps.db
      .insertInto('equipment')
      .values({ organization_id: org.id, name: 'De hoy', type: 'camara', max_temp: 4, checks_per_day: 1, created_at: at(TODAY, '10:30') })
      .returningAll()
      .executeTakeFirstOrThrow();
    const c = await compliance(client, base, YESTERDAY);
    expect(c[YESTERDAY]).toMatchObject({ expected: 0 });
    expect(c[TODAY]).toMatchObject({ expected: 1 }); // solo "Nueva"
    const r = await client.post(`${base}/records`, { type: 'temperatura', data: { equipmentId: todayEq.id, value: 2 } });
    expect(r.statusCode).toBe(201);
    const t = json(await client.get(`${base}/tasks/today`));
    const mine = t.temperatures.find((x: { equipmentId: string }) => x.equipmentId === todayEq.id);
    expect(mine).toMatchObject({ status: 'done', done: 1, countsToday: false });
    expect(t.temperatures.find((x: { equipmentId: string }) => x.equipmentId === late.id)).toMatchObject({ countsToday: true, status: 'pending' });
    expect(t.summary).toMatchObject({ total: 1, done: 0 });
  });
});

describe('8. idempotencia al crear registros', () => {
  const body = { type: 'plagas', data: { result: 'sin_indicios' } };

  it('misma clave y mismo cuerpo → mismo registro, sin duplicar (también en paralelo)', async () => {
    const { client, base, org } = await setupOwner(ctx);
    const key = crypto.randomUUID();
    const r1 = await client.post(`${base}/records`, body, { 'idempotency-key': key });
    expect(r1.statusCode).toBe(201);
    const r2 = await client.post(`${base}/records`, body, { 'idempotency-key': key });
    expect(r2.statusCode).toBe(200);
    expect(r2.headers['idempotent-replayed']).toBe('true');
    expect(json(r2).record.id).toBe(json(r1).record.id);

    const key2 = crypto.randomUUID();
    const many = await Promise.all(Array.from({ length: 6 }, () => client.post(`${base}/records`, body, { 'idempotency-key': key2 })));
    expect(new Set(many.map((r) => json(r).record.id)).size).toBe(1);
    expect(many.map((r) => r.statusCode).sort()).toEqual([200, 200, 200, 200, 200, 201]);
    const n = await ctx.deps.db.selectFrom('records').select(sql<number>`count(*)::int`.as('n')).where('organization_id', '=', org.id).executeTakeFirstOrThrow();
    expect(n.n).toBe(2);
  });

  it('misma clave con otro cuerpo → 409; clave mal formada → 400; claves por local', async () => {
    const { client, base } = await setupOwner(ctx);
    const other = await setupOwner(ctx, 'otro@example.com');
    const key = crypto.randomUUID();
    expect((await client.post(`${base}/records`, body, { 'idempotency-key': key })).statusCode).toBe(201);
    const conflict = await client.post(`${base}/records`, { type: 'plagas', data: { result: 'con_indicios', description: 'x', action: 'y' } }, { 'idempotency-key': key });
    expect(conflict.statusCode).toBe(409);
    expect((await client.post(`${base}/records`, body, { 'idempotency-key': 'no-es-uuid' })).statusCode).toBe(400);
    // La misma clave en otro local es independiente.
    expect((await other.client.post(`${other.base}/records`, body, { 'idempotency-key': key })).statusCode).toBe(201);
    // Una petición fallida no consume la clave.
    const k3 = crypto.randomUUID();
    expect((await client.post(`${base}/records`, { type: 'plagas', data: { result: 'con_indicios' } }, { 'idempotency-key': k3 })).statusCode).toBe(400);
    expect((await client.post(`${base}/records`, body, { 'idempotency-key': k3 })).statusCode).toBe(201);
  });

  it('enmiendas y kiosko también son idempotentes', async () => {
    const { client, base, org } = await setupOwner(ctx);
    const rec = json(await client.post(`${base}/records`, { type: 'incidencia', data: { description: 'X', closed: false } })).record;
    const key = crypto.randomUUID();
    const am = { reason: 'Cerrada', data: { description: 'X', closed: true } };
    const a1 = await client.post(`${base}/records/${rec.id}/amendments`, am, { 'idempotency-key': key });
    const a2 = await client.post(`${base}/records/${rec.id}/amendments`, am, { 'idempotency-key': key });
    expect([a1.statusCode, a2.statusCode]).toEqual([201, 200]);
    expect(json(a2).record.id).toBe(json(a1).record.id);

    const token = `kd_${randomToken()}`;
    await ctx.deps.db.insertInto('devices').values({ organization_id: org.id, name: 'Tablet', token_hash: sha256(token) }).execute();
    const st = await ctx.deps.db
      .insertInto('staff')
      .values({ organization_id: org.id, name: 'Ana', pin_hash: await hashSecret('1234') })
      .returningAll()
      .executeTakeFirstOrThrow();
    const kKey = crypto.randomUUID();
    const send = () =>
      ctx.app.inject({
        method: 'POST',
        url: '/api/kiosk/records',
        headers: { authorization: `Bearer ${token}`, 'idempotency-key': kKey },
        payload: { staffId: st.id, pin: '1234', type: 'plagas', data: { result: 'sin_indicios' } },
      });
    const [k1, k2] = await Promise.all([send(), send()]);
    expect([k1.statusCode, k2.statusCode].sort()).toEqual([200, 201]);
    expect(json(k1).record.id).toBe(json(k2).record.id);
  });
});
