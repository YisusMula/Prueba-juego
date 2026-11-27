/**
 * Evaluación independiente del bloque A de la fase 2: un test por hallazgo (H-A1…H-A3, H-M1…H-M5 y
 * bajos). Cada uno falla sin su corrección (migración 0012 y código asociado).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pg from 'pg';
import { sql } from 'kysely';
import { addMember, backdateConfig, closeTestApp, createTestApp, FIXED_NOW, json, resetDb, setupOwner, type TestCtx } from './helpers.js';
import { TEST_DATABASE_URL } from './global-setup.js';
import { applyAppRolePrivileges } from '../src/db/privileges.js';

let ctx: TestCtx;
let nowMs = FIXED_NOW.getTime();
const APP_URL = process.env.TEST_APP_DATABASE_URL;
beforeAll(async () => {
  ctx = await createTestApp({ now: () => new Date(nowMs) });
  if (APP_URL) {
    const owner = new pg.Pool({ connectionString: TEST_DATABASE_URL, max: 1 });
    await applyAppRolePrivileges(owner, new URL(APP_URL).username);
    await owner.end();
  }
});
afterAll(async () => closeTestApp(ctx));
beforeEach(async () => {
  nowMs = FIXED_NOW.getTime();
  await resetDb(ctx);
});

const DAY = 86_400_000;
/** 11:00 en Madrid del día `date` (noviembre de 2026: UTC+1). */
const at = (date: string, hour = 11) => new Date(`${date}T${String(hour - 1).padStart(2, '0')}:00:00Z`).getTime();
function pdfToText(buf: Buffer): string {
  const dir = mkdtempSync(join(tmpdir(), 'enregla-pdf-'));
  try {
    const file = join(dir, 'r.pdf');
    writeFileSync(file, buf);
    return execFileSync('pdftotext', ['-raw', '-enc', 'UTF-8', file, '-'], { encoding: 'utf8' }).replace(/\s+/g, ' ');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
const backdateAll = async (orgId: string) => {
  await backdateConfig(ctx, orgId);
  const old = new Date(FIXED_NOW.getTime() - 40 * DAY);
  await ctx.deps.db.updateTable('custom_record_templates').set({ created_at: old }).where('organization_id', '=', orgId).execute();
  await sql`UPDATE organizations SET created_at = ${old} WHERE id = ${orgId}`.execute(ctx.deps.db);
};

// ---------------------------------------------------------------------------
describe('H-A1 cocinado', () => {
  it('70 °C por defecto (75 °C con huevo fresco); 66 °C ya no es correcto; mínimo configurable 65 °C', async () => {
    const o = await setupOwner(ctx, 'a1@example.com');
    const low = await o.client.post(`${o.base}/records`, { type: 'cocinado', data: { product: 'Pechuga de pollo', process: 'cocinado', coreTemp: 66 } });
    expect(low.statusCode).toBe(400);
    expect(json(low).error.details[0]).toMatchObject({ path: 'data.correctiveAction', message: expect.stringMatching(/70 °C/) });
    const egg = await o.client.post(`${o.base}/records`, { type: 'cocinado', data: { product: 'Tortilla', process: 'cocinado', coreTemp: 72, freshEgg: true } });
    expect(json(egg).error.details[0].message).toMatch(/75 °C/);
    const ok = json(await o.client.post(`${o.base}/records`, { type: 'cocinado', data: { product: 'Tortilla', process: 'cocinado', coreTemp: 76, freshEgg: true } })).record;
    expect(ok.data).toMatchObject({ referenceTemp: 75, freshEgg: true, outOfRange: false });
    expect((await o.client.patch(o.base, { referenceValues: { cookingMinTemp: 60 } })).statusCode).toBe(400);
    expect(json(await o.client.patch(o.base, { referenceValues: { cookingMinTemp: 65 } })).organization.referenceValues.cookingMinTemp).toBe(65);
    const pdf = pdfToText((await o.client.get(`${o.base}/reports/pdf?from=2026-11-10&to=2026-11-10&types=cocinado`)).rawPayload);
    expect(pdf).toContain('Referencia orientativa del local');
    expect(pdf).toContain('≥ 75 °C (huevo fresco)');
  });
});

// ---------------------------------------------------------------------------
describe('H-A2 tareas semanales y mensuales', () => {
  it('se cumplen con un registro en cualquier día de su semana o mes; mientras el periodo no termina, «pendiente»', async () => {
    const o = await setupOwner(ctx, 'a2@example.com');
    // Semanal de los jueves; mensual del día 1; semanal del lunes.
    const thu = json(await o.client.post(`${o.base}/custom-templates`, { name: 'Semanal jueves', kind: 'yesno', frequency: 'weekly', weekday: 4 })).template;
    const mon = json(await o.client.post(`${o.base}/custom-templates`, { name: 'Semanal lunes', kind: 'yesno', frequency: 'weekly', weekday: 1 })).template;
    const day1 = json(await o.client.post(`${o.base}/custom-templates`, { name: 'Mensual día 1', kind: 'yesno', frequency: 'monthly', monthDay: 1 })).template;
    await backdateAll(o.org.id);
    // Jueves 5/11 tocaba; se hace el viernes 6/11. El mensual del 1/11 se hace el 15/10… no: el 2/11.
    nowMs = at('2026-11-06');
    await o.client.post(`${o.base}/records`, { type: 'personalizado', data: { templateId: thu.id, answer: true } });
    nowMs = at('2026-11-02');
    await o.client.post(`${o.base}/records`, { type: 'personalizado', data: { templateId: day1.id, answer: true } });
    nowMs = FIXED_NOW.getTime(); // martes 10/11
    const comp = json(await o.client.get(`${o.base}/tasks/compliance?from=2026-11-01&to=2026-11-10`));
    const day = (d: string) => comp.days.find((x: { date: string }) => x.date === d);
    expect(day('2026-11-05').missing.filter((m: { id: string }) => m.id === thu.id)).toEqual([]);
    expect(day('2026-11-01').missing.filter((m: { id: string }) => m.id === day1.id)).toEqual([]);
    // Lunes 9/11 (semana en curso): pendiente, no «no consta».
    const m9 = day('2026-11-09').missing.find((m: { id: string }) => m.id === mon.id);
    expect(m9).toMatchObject({ pending: true });
    // Lunes 2/11 (semana terminada sin registro): no consta.
    expect(day('2026-11-02').missing.find((m: { id: string }) => m.id === mon.id)).toMatchObject({ pending: false });
    // Hoy (martes) se ve la del lunes como pendiente de esta semana, y la del jueves también.
    const today = json(await o.client.get(`${o.base}/tasks/today`));
    const t = (id: string) => today.custom.find((c: { templateId: string }) => c.templateId === id);
    expect(t(mon.id)).toMatchObject({ status: 'pending', dueToday: false, dueDate: '2026-11-09' });
    expect(t(thu.id)).toMatchObject({ status: 'pending', dueToday: false, dueDate: '2026-11-12' });
    // PDF: nunca «no consta» mientras la semana no ha terminado.
    const pdf = pdfToText((await o.client.get(`${o.base}/reports/pdf?from=2026-11-02&to=2026-11-10&types=personalizado`)).rawPayload);
    expect(pdf).toMatch(/9 de noviembre de 2026.*Registro: Semanal lunes Pendiente esta semana/);
    expect(pdf).toMatch(/2 de noviembre de 2026.*Registro: Semanal lunes No consta en toda la semana/);
    expect(pdf).not.toMatch(/Semanal jueves No consta/);
  });
});

// ---------------------------------------------------------------------------
describe('H-A3 enfriamiento sin cerrar', () => {
  it('cuenta como alerta sin acción en el resumen, sale resaltado y en «Tareas sin registrar»', async () => {
    const o = await setupOwner(ctx, 'a3@example.com');
    nowMs = at('2026-11-05', 16);
    const s = json(await o.client.post(`${o.base}/records`, { type: 'enfriamiento', data: { phase: 'inicio', product: 'Arroz cocido', startTemp: 70 } })).record;
    nowMs = FIXED_NOW.getTime();
    const comp = json(await o.client.get(`${o.base}/tasks/compliance?from=2026-11-05&to=2026-11-05`));
    expect(comp.days[0].missing).toEqual([expect.objectContaining({ kind: 'enfriamiento', id: s.id, name: 'Arroz cocido' })]);
    const pdf = pdfToText((await o.client.get(`${o.base}/reports/pdf?from=2026-11-02&to=2026-11-08`)).rawPayload);
    expect(pdf).toMatch(/Alertas \(fuera de límite, rechazos o indicios\) 1: 0 con acción correctora y 1 sin acción indicada/);
    expect(pdf).toContain('Enfriamientos sin cerrar (pasado el tiempo máximo) 1');
    expect(pdf).toMatch(/Enfriamiento: Arroz cocido Sin cerrar: no consta el final/);
  });
});

// ---------------------------------------------------------------------------
describe('H-M1 verificación con foto del momento', () => {
  it('no admite el día en curso, guarda los recuentos y el PDF los muestra con lo añadido después', async () => {
    const o = await setupOwner(ctx, 'm1@example.com', 'bar');
    await ctx.deps.db.updateTable('users').set({ name: 'Elena Encargada' }).where('id', '=', o.user.id).execute();
    await backdateAll(o.org.id);
    nowMs = at('2026-11-05', 16);
    await o.client.post(`${o.base}/records`, { type: 'enfriamiento', data: { phase: 'inicio', product: 'Arroz', startTemp: 70 } });
    const fridge = await ctx.deps.db.selectFrom('equipment').selectAll().where('organization_id', '=', o.org.id).where('type', '=', 'camara').executeTakeFirstOrThrow();
    const r = json(await o.client.post(`${o.base}/records`, { type: 'temperatura', data: { equipmentId: fridge.id, value: 3 } })).record;
    nowMs = FIXED_NOW.getTime();
    expect((await o.client.post(`${o.base}/verifications`, { from: '2026-11-04', to: '2026-11-10' })).statusCode).toBe(400);
    const prev = json(await o.client.get(`${o.base}/verifications/preview?from=2026-11-02&to=2026-11-08`));
    expect(prev).toMatchObject({ openCoolings: 1 });
    expect(prev.gapTasks).toBeGreaterThan(0);
    const v = json(await o.client.post(`${o.base}/verifications`, { from: '2026-11-02', to: '2026-11-08', kind: 'week' })).verification;
    expect(v.snapshot).toEqual(prev);
    // Corrección posterior de un registro del periodo.
    nowMs = FIXED_NOW.getTime() + 60_000;
    await o.client.post(`${o.base}/records/${r.id}/amendments`, { reason: 'Valor mal anotado', data: { equipmentId: fridge.id, value: 2 } });
    const pdf = pdfToText((await o.client.get(`${o.base}/reports/pdf?from=2026-11-02&to=2026-11-08`)).rawPayload);
    expect(pdf).toMatch(new RegExp(`en ese momento: ${prev.gapTasks} tareas? sin registrar, 0 alertas sin acción, 1 enfriamiento sin cerrar`));
    expect(pdf).toContain('registros o correcciones añadidos después de la verificación: 1');
    // La foto no se puede cambiar.
    await expect(sql`UPDATE responsible_verifications SET snapshot = '{}'`.execute(ctx.deps.db)).rejects.toThrow(/no se pueden modificar/);
  });
});

// ---------------------------------------------------------------------------
describe('H-M2 nombres vigentes cada día', () => {
  it('renombrar una plantilla, un equipo o un plan no reescribe los huecos pasados', async () => {
    const o = await setupOwner(ctx, 'm2@example.com', 'bar');
    const t = json(await o.client.post(`${o.base}/custom-templates`, { name: 'Cloro libre del agua', kind: 'yesno', frequency: 'daily' })).template;
    await backdateAll(o.org.id);
    // El historial de las tablas antiguas no tenía nombre: se rellenó con el actual al migrar.
    const fridge = await ctx.deps.db.selectFrom('equipment').selectAll().where('organization_id', '=', o.org.id).where('type', '=', 'camara').executeTakeFirstOrThrow();
    const plan = await ctx.deps.db.selectFrom('cleaning_plans').selectAll().where('organization_id', '=', o.org.id).where('frequency', '=', 'daily').orderBy('name').executeTakeFirstOrThrow();
    await o.client.patch(`${o.base}/custom-templates/${t.id}`, { name: 'Revisión de extintores' });
    await o.client.patch(`${o.base}/equipment/${fridge.id}`, { name: 'Nevera nueva' });
    await o.client.patch(`${o.base}/cleaning-plans/${plan.id}`, { name: 'Plan renombrado' });
    const comp = json(await o.client.get(`${o.base}/tasks/compliance?from=2026-11-08&to=2026-11-08`));
    const names = comp.days[0].missing.map((m: { name: string }) => m.name);
    expect(names).toEqual(expect.arrayContaining(['Cloro libre del agua', fridge.name, plan.name]));
    expect(names).not.toContain('Revisión de extintores');
    expect(names).not.toContain('Nevera nueva');
  });
});

// ---------------------------------------------------------------------------
describe('H-M3 enfriamiento que empieza por debajo de 60 °C', () => {
  it('pide motivo, lo guarda y el PDF lo marca', async () => {
    const o = await setupOwner(ctx, 'm3@example.com');
    const bad = await o.client.post(`${o.base}/records`, { type: 'enfriamiento', data: { phase: 'inicio', product: 'Caldo', startTemp: 45 } });
    expect(bad.statusCode).toBe(400);
    expect(json(bad).error.details[0]).toMatchObject({ path: 'data.startReason', message: expect.stringMatching(/60 °C/) });
    const s = json(await o.client.post(`${o.base}/records`, { type: 'enfriamiento', data: { phase: 'inicio', product: 'Caldo', startTemp: 45, startReason: 'Ya venía templado' } })).record;
    expect(s.data).toMatchObject({ belowStartReference: true, startReferenceTemp: 60, startReason: 'Ya venía templado' });
    const pdf = pdfToText((await o.client.get(`${o.base}/reports/pdf?from=2026-11-10&to=2026-11-10&types=enfriamiento`)).rawPayload);
    expect(pdf).toContain('por debajo de 60 °C (referencia orientativa); motivo: Ya venía templado');
  });
});

// ---------------------------------------------------------------------------
describe('H-M4 una corrección de un cierre no puede cambiar de enfriamiento', () => {
  it('la base de datos exige el mismo inicio y la misma fase', async () => {
    const o = await setupOwner(ctx, 'm4@example.com');
    const a = json(await o.client.post(`${o.base}/records`, { type: 'enfriamiento', data: { phase: 'inicio', product: 'A', startTemp: 70 } })).record;
    const b = json(await o.client.post(`${o.base}/records`, { type: 'enfriamiento', data: { phase: 'inicio', product: 'B', startTemp: 70 } })).record;
    const close = json(await o.client.post(`${o.base}/records`, { type: 'enfriamiento', data: { phase: 'fin', startRecordId: a.id, endTemp: 5 } })).record;
    const db = new pg.Client({ connectionString: APP_URL ?? TEST_DATABASE_URL });
    await db.connect();
    try {
      await expect(
        db.query(
          `INSERT INTO records (organization_id, type, data, user_id, user_name, related_record_id, amends_record_id, amendment_reason)
           VALUES ($1, 'enfriamiento', $2, $3, 'x', $4, $5, 'x')`,
          [o.org.id, JSON.stringify({ phase: 'fin', startRecordId: b.id }), o.user.id, b.id, close.id],
        ),
      ).rejects.toThrow(/mismo enfriamiento/);
      // Una corrección del inicio no puede convertirlo en cierre.
      await expect(
        db.query(
          `INSERT INTO records (organization_id, type, data, user_id, user_name, related_record_id, amends_record_id, amendment_reason)
           VALUES ($1, 'enfriamiento', $2, $3, 'x', $4, $5, 'x')`,
          [o.org.id, JSON.stringify({ phase: 'fin', startRecordId: b.id }), o.user.id, b.id, a.id],
        ),
      ).rejects.toThrow(/mismo enfriamiento|fase/);
    } finally {
      await db.end();
    }
    expect(json(await o.client.get(`${o.base}/tasks/today`)).coolings.map((c: { product: string }) => c.product)).toEqual(['B']);
  });
});

// ---------------------------------------------------------------------------
describe.skipIf(!APP_URL)('H-M5 nombres desnormalizados (rol real de la app)', () => {
  it('el nombre del verificador y el del autor de un registro salen de la base de datos', async () => {
    const o = await setupOwner(ctx, 'm5@example.com');
    await ctx.deps.db.updateTable('users').set({ name: 'Propietaria Real' }).where('id', '=', o.user.id).execute();
    const staff = await ctx.deps.db.insertInto('staff').values({ organization_id: o.org.id, name: 'Ana Real' }).returningAll().executeTakeFirstOrThrow();
    const fridge = await ctx.deps.db.selectFrom('equipment').selectAll().where('organization_id', '=', o.org.id).where('type', '=', 'camara').executeTakeFirstOrThrow();
    const c = new pg.Client({ connectionString: APP_URL });
    await c.connect();
    try {
      const v = (
        await c.query(
          `INSERT INTO responsible_verifications (organization_id, period_from, period_to, user_id, user_name, user_role)
           VALUES ($1, current_date - 8, current_date - 2, $2, 'Inspector Sanidad', 'owner') RETURNING user_name`,
          [o.org.id, o.user.id],
        )
      ).rows[0];
      expect(v.user_name).toBe('Propietaria Real');
      const r = (
        await c.query(
          `INSERT INTO records (organization_id, type, data, user_id, user_name, staff_id, staff_name, equipment_id)
           VALUES ($1, 'temperatura', $2, $3, 'Otro Nombre', $4, 'Firma Falsa', $5) RETURNING user_name, staff_name`,
          [o.org.id, JSON.stringify({ equipmentId: fridge.id, value: 3 }), o.user.id, staff.id, fridge.id],
        )
      ).rows[0];
      expect(r).toEqual({ user_name: 'Propietaria Real', staff_name: 'Ana Real' });
      // Un usuario que no es del local no puede figurar como autor.
      const other = await setupOwner(ctx, 'otro-m5@example.com');
      await expect(
        c.query(`INSERT INTO records (organization_id, type, data, user_id, user_name, equipment_id) VALUES ($1, 'temperatura', $2, $3, 'x', $4)`, [
          o.org.id,
          JSON.stringify({ equipmentId: fridge.id, value: 3 }),
          other.user.id,
          fridge.id,
        ]),
      ).rejects.toThrow(/no es miembro/);
    } finally {
      await c.end();
    }
  });
});

// ---------------------------------------------------------------------------
describe('bajos', () => {
  it('días evaluados: solo desde el alta del local', async () => {
    const o = await setupOwner(ctx, 'b1@example.com');
    await sql`UPDATE organizations SET created_at = ${new Date(at('2026-11-08'))} WHERE id = ${o.org.id}`.execute(ctx.deps.db);
    const pdf = pdfToText((await o.client.get(`${o.base}/reports/pdf?from=2026-11-01&to=2026-11-10`)).rawPayload);
    expect(pdf).toMatch(/de 3 día\(s\) evaluados/);
  });

  it('valores de referencia: dos cambios a la vez no se pisan', async () => {
    const o = await setupOwner(ctx, 'b2@example.com');
    for (let i = 0; i < 5; i++) {
      await Promise.all([o.client.patch(o.base, { referenceValues: { cookingMinTemp: 71 + i } }), o.client.patch(o.base, { referenceValues: { coolingMaxMinutes: 90 + i } })]);
      const rv = json(await o.client.get(o.base)).organization.referenceValuesCustom;
      expect(rv).toEqual({ cookingMinTemp: 71 + i, coolingMaxMinutes: 90 + i });
    }
  });

  it('verificación de termómetros: aviso en Hoy si pasan 6 meses sin registrarla', async () => {
    const o = await setupOwner(ctx, 'b3@example.com');
    const t = json(await o.client.post(`${o.base}/custom-templates/suggestions`, { key: 'termometros' })).template;
    expect(t).toMatchObject({ frequency: 'on_demand', reminderMonths: 6 });
    await ctx.deps.db.updateTable('custom_record_templates').set({ created_at: new Date(FIXED_NOW.getTime() - 200 * DAY) }).where('id', '=', t.id).execute();
    const today = json(await o.client.get(`${o.base}/tasks/today`));
    expect(today.alerts).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'registro_personalizado_vencido', message: expect.stringMatching(/Verificación de termómetros: .*6 meses/) })]));
    nowMs = FIXED_NOW.getTime();
    await o.client.post(`${o.base}/records`, { type: 'personalizado', data: { templateId: t.id, items: t.items.map((i: { id: string }) => ({ itemId: i.id, ok: true })) } });
    expect(json(await o.client.get(`${o.base}/tasks/today`)).alerts.some((a: { kind: string }) => a.kind === 'registro_personalizado_vencido')).toBe(false);
  });

  it('un encargado puede verificar; el periodo debe terminar como muy tarde ayer', async () => {
    const o = await setupOwner(ctx, 'b4@example.com');
    const m = await addMember(ctx, o.org.id, 'enc-b4@example.com', 'manager');
    expect((await m.client.post(`${o.base}/verifications`, { from: '2026-11-09', to: '2026-11-09' })).statusCode).toBe(201);
    expect((await m.client.post(`${o.base}/verifications`, { from: '2026-11-10', to: '2026-11-10' })).statusCode).toBe(400);
  });
});
