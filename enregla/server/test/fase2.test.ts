/**
 * Fase 2, bloques A1 (PDF de inspección) y A2 (registros de las guías oficiales).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pg from 'pg';
import { sql } from 'kysely';
import type { LightMyRequestResponse } from 'fastify';
import { addMember, backdateConfig, closeTestApp, createStaff, createTestApp, FIXED_NOW, FIXED_TODAY, firstEquipment, json, resetDb, setupOwner, type TestCtx } from './helpers.js';
import { TEST_DATABASE_URL } from './global-setup.js';
import { applyAppRolePrivileges } from '../src/db/privileges.js';
import { taxIdError, normalizeTaxId, REFERENCE_DEFAULTS } from '../src/schemas/index.js';
import { runReminderTick } from '../src/modules/reminders/scheduler.js';

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
function pdfPages(buf: Buffer): number {
  const dir = mkdtempSync(join(tmpdir(), 'enregla-pdf-'));
  try {
    const file = join(dir, 'r.pdf');
    writeFileSync(file, buf);
    return Number(/Pages:\s+(\d+)/.exec(execFileSync('pdfinfo', [file], { encoding: 'utf8' }))![1]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
function csvObjects(text: string): Record<string, string>[] {
  const lines = text.replace(/^\uFEFF/, '').trim().split('\r\n');
  const cells = (l: string) => l.slice(1, -1).split('";"').map((c) => c.replace(/""/g, '"'));
  const header = cells(lines[0]!);
  return lines.slice(1).map((l) => Object.fromEntries(cells(l).map((v, i) => [header[i]!, v])));
}
async function withKiosk(email: string) {
  const o = await setupOwner(ctx, email);
  const dev = json(await o.client.post(`${o.base}/devices`, { name: 'Tablet' }));
  const k = (method: 'GET' | 'POST', url: string, payload?: object): Promise<LightMyRequestResponse> =>
    ctx.app.inject({ method, url, headers: { authorization: `Bearer ${dev.token}` }, ...(payload ? { payload } : {}) });
  return { ...o, k };
}
const audits = async (event: string) => ctx.deps.db.selectFrom('audit_events').selectAll().where('event', '=', event).orderBy('id').execute();

// ---------------------------------------------------------------------------
// A1.1 Datos del establecimiento
// ---------------------------------------------------------------------------
describe('datos del establecimiento', () => {
  it('NIF/CIF con carácter de control, código postal y RGSEAA con aviso', () => {
    expect(taxIdError('12345678Z')).toBeNull();
    expect(taxIdError('12345678A')).toMatch(/letra/);
    expect(taxIdError('X1234567L')).toBeNull();
    expect(taxIdError('B12345674')).toBeNull();
    expect(taxIdError('B12345675')).toMatch(/control/);
    expect(taxIdError('Q2826000H')).toBeNull();
    expect(taxIdError(normalizeTaxId('b-1234567.4'))).toBeNull();
    expect(taxIdError('HOLA')).toMatch(/válido/);
  });

  it('el propietario los guarda (opcionales), se auditan con valor anterior y nuevo, y el encargado no puede', async () => {
    const o = await setupOwner(ctx, 'est@example.com');
    const bad = await o.client.patch(o.base, { taxId: 'B12345675' });
    expect(bad.statusCode).toBe(400);
    expect(json(bad).error.details[0]).toMatchObject({ path: 'taxId', message: expect.stringMatching(/control/) });
    expect((await o.client.patch(o.base, { postalCode: '99999' })).statusCode).toBe(400);
    const ok = json(
      await o.client.patch(o.base, { legalName: 'Hostelería La Demo S.L.', taxId: 'b-12345674', address: 'Calle Mayor 1', postalCode: '28013', city: 'Madrid', province: 'Madrid', sanitaryRegistry: 'Autorización 123/AB' }),
    ).organization;
    expect(ok.establishment).toMatchObject({ legalName: 'Hostelería La Demo S.L.', taxId: 'B12345674', postalCode: '28013', sanitaryRegistry: 'Autorización 123/AB', sanitaryRegistryFormatOk: false });
    const fixed = json(await o.client.patch(o.base, { sanitaryRegistry: '26.012345/M' })).organization;
    expect(fixed.establishment.sanitaryRegistryFormatOk).toBe(true);
    const cleared = json(await o.client.patch(o.base, { legalName: '' })).organization;
    expect(cleared.establishment.legalName).toBeNull();
    const ev = await audits('org.updated');
    expect(ev.at(-2)!.metadata).toMatchObject({ changes: { sanitary_registry: { from: 'Autorización 123/AB', to: '26.012345/M' } } });
    expect(ev.at(-1)!.metadata).toMatchObject({ changes: { legal_name: { from: 'Hostelería La Demo S.L.', to: null } } });
    const m = await addMember(ctx, o.org.id, 'enc@example.com', 'manager');
    expect((await m.client.patch(o.base, { legalName: 'X' })).statusCode).toBe(403);
  });

  it('valores de referencia: por defecto los orientativos, configurables dentro de márgenes y `null` vuelve al de referencia', async () => {
    const o = await setupOwner(ctx, 'ref@example.com');
    expect(json(await o.client.get(o.base)).organization.referenceValues).toEqual(REFERENCE_DEFAULTS);
    expect((await o.client.patch(o.base, { referenceValues: { reheatMinTemp: 30 } })).statusCode).toBe(400);
    const r = json(await o.client.patch(o.base, { referenceValues: { reheatMinTemp: 70, coolingMaxMinutes: 90 } })).organization;
    expect(r.referenceValues).toMatchObject({ reheatMinTemp: 70, coolingMaxMinutes: 90, cookingMinTemp: 70 });
    const r2 = json(await o.client.patch(o.base, { referenceValues: { reheatMinTemp: null } })).organization;
    expect(r2.referenceValues).toMatchObject({ reheatMinTemp: 74, coolingMaxMinutes: 90 });
  });
});

// ---------------------------------------------------------------------------
// A2.1 Cocinado y regeneración
// ---------------------------------------------------------------------------
describe('cocinado y regeneración', () => {
  it('por debajo de la referencia exige acción correctora y deja alerta; la regeneración usa su propia referencia', async () => {
    const o = await setupOwner(ctx, 'coc@example.com');
    const low = await o.client.post(`${o.base}/records`, { type: 'cocinado', data: { product: 'Pollo asado', process: 'cocinado', coreTemp: 60 } });
    expect(low.statusCode).toBe(400);
    expect(json(low).error.details[0]).toMatchObject({ path: 'data.correctiveAction', message: expect.stringMatching(/70 °C/) });
    const ok = json(await o.client.post(`${o.base}/records`, { type: 'cocinado', data: { product: 'Pollo asado', process: 'cocinado', coreTemp: 72, minutes: 45 } })).record;
    expect(ok).toMatchObject({ alert: false, data: { referenceTemp: 70, outOfRange: false, minutes: 45 } });
    // Regeneración a 70 °C: por debajo de 74 °C (RD 1086/2020, art. 30.7).
    const reg = await o.client.post(`${o.base}/records`, { type: 'cocinado', data: { product: 'Lentejas', process: 'regeneracion', coreTemp: 70 } });
    expect(reg.statusCode).toBe(400);
    const reg2 = json(await o.client.post(`${o.base}/records`, { type: 'cocinado', data: { product: 'Lentejas', process: 'regeneracion', coreTemp: 70, correctiveAction: 'Se calentó más' } })).record;
    expect(reg2).toMatchObject({ alert: true, data: { referenceTemp: 74, outOfRange: true } });
    // El local baja la referencia de regeneración a 70 (plan vasco): ya no hay alerta.
    await o.client.patch(o.base, { referenceValues: { reheatMinTemp: 70 } });
    const reg3 = json(await o.client.post(`${o.base}/records`, { type: 'cocinado', data: { product: 'Lentejas', process: 'regeneracion', coreTemp: 70 } })).record;
    expect(reg3).toMatchObject({ alert: false, data: { referenceTemp: 70 } });
    const today = json(await o.client.get(`${o.base}/tasks/today`));
    expect(today.alerts.map((a: { kind: string }) => a.kind)).toContain('cocinado_por_debajo');
  });
});

// ---------------------------------------------------------------------------
// A2.2 Enfriamiento rápido en dos registros
// ---------------------------------------------------------------------------
describe('enfriamiento rápido', () => {
  it('inicio → en curso en Hoy y en la tablet → cierre enlazado; fuera de tiempo exige acción; un solo cierre', async () => {
    const o = await withKiosk('enf@example.com');
    const ana = await createStaff(ctx, o.org.id, 'Ana');
    const start = json(await o.k('POST', '/api/kiosk/records', { staffId: ana.id, type: 'enfriamiento', data: { phase: 'inicio', product: 'Caldo', startTemp: 75 } })).record;
    expect(start.data).toMatchObject({ phase: 'inicio', product: 'Caldo', startTemp: 75 });
    let today = json(await o.client.get(`${o.base}/tasks/today`));
    expect(today.coolings).toEqual([expect.objectContaining({ recordId: start.id, product: 'Caldo', overdue: false, maxMinutes: 120, targetTemp: 10 })]);
    expect(json(await o.k('GET', '/api/kiosk/tasks/today')).coolings).toHaveLength(1);
    // Sin temperatura final no se puede cerrar.
    const noTemp = await o.client.post(`${o.base}/records`, { type: 'enfriamiento', data: { phase: 'fin', startRecordId: start.id } });
    expect(json(noTemp).error.details[0].path).toBe('data.endTemp');
    // 150 minutos después: fuera de tiempo (criterio ≤ 120 min).
    nowMs += 150 * 60_000;
    today = json(await o.client.get(`${o.base}/tasks/today`));
    expect(today.coolings[0].overdue).toBe(true);
    expect(today.alerts[0]).toMatchObject({ kind: 'enfriamiento_sin_cerrar', recordId: start.id });
    // Como propietario (tests), el cierre toma la hora del reloj inyectado.
    const late = await o.client.post(`${o.base}/records`, { type: 'enfriamiento', data: { phase: 'fin', startRecordId: start.id, endTemp: 8 } });
    expect(json(late).error.details[0]).toMatchObject({ path: 'data.correctiveAction', message: expect.stringMatching(/120 minutos/) });
    const close = json(
      await o.client.post(`${o.base}/records`, { type: 'enfriamiento', data: { phase: 'fin', startRecordId: start.id, endTemp: 8, correctiveAction: 'Se regeneró antes de servir' } }),
    ).record;
    expect(close).toMatchObject({ alert: true, data: { phase: 'fin', startRecordId: start.id, product: 'Caldo', startTemp: 75, endTemp: 8, overTime: true, overTemp: false } });
    expect(close.data.minutes).toBeGreaterThanOrEqual(150);
    expect(json(await o.client.get(`${o.base}/tasks/today`)).coolings).toEqual([]);
    // Segundo cierre: rechazado.
    const again = await o.client.post(`${o.base}/records`, { type: 'enfriamiento', data: { phase: 'fin', startRecordId: start.id, endTemp: 5 } });
    expect(again.statusCode).toBe(409);
    // El inicio no se modifica: sigue igual y su cierre es otro registro.
    const st = json(await o.client.get(`${o.base}/records/${start.id}`)).record;
    expect(st.data).toEqual(start.data);
    // Una corrección del cierre conserva los minutos y el criterio aplicados.
    const fix = json(await o.client.post(`${o.base}/records/${close.id}/amendments`, { reason: 'Temperatura mal anotada', data: { phase: 'fin', startRecordId: start.id, endTemp: 9, correctiveAction: 'Se regeneró antes de servir' } })).record;
    expect(fix.data.minutes).toBe(close.data.minutes);
    expect(fix.data.endTemp).toBe(9);
  });

  it('dentro de criterio no hay alerta; desechar sin medir exige motivo; la base de datos no deja enlazar un cierre con otra cosa', async () => {
    const o = await setupOwner(ctx, 'enf2@example.com');
    const start = json(await o.client.post(`${o.base}/records`, { type: 'enfriamiento', data: { phase: 'inicio', product: 'Arroz', startTemp: 70 } })).record;
    nowMs += 90 * 60_000;
    const close = json(await o.client.post(`${o.base}/records`, { type: 'enfriamiento', data: { phase: 'fin', startRecordId: start.id, endTemp: 6 } })).record;
    expect(close).toMatchObject({ alert: false, data: { minutes: 90, overTime: false, overTemp: false } });
    const s2 = json(await o.client.post(`${o.base}/records`, { type: 'enfriamiento', data: { phase: 'inicio', product: 'Crema', startTemp: 80 } })).record;
    const disc = await o.client.post(`${o.base}/records`, { type: 'enfriamiento', data: { phase: 'fin', startRecordId: s2.id, discarded: true } });
    expect(json(disc).error.details[0].path).toBe('data.correctiveAction');
    expect(json(await o.client.post(`${o.base}/records`, { type: 'enfriamiento', data: { phase: 'fin', startRecordId: s2.id, discarded: true, correctiveAction: 'Desechado' } })).record.alert).toBe(true);
    // Cierre que apunta a un cierre (no a un inicio): rechazado en la base de datos.
    await expect(
      sql`INSERT INTO records (organization_id, type, data, user_id, user_name, related_record_id)
          VALUES (${o.org.id}, 'enfriamiento', ${JSON.stringify({ phase: 'fin', startRecordId: close.id })}::jsonb, ${o.user.id}, 'x', ${close.id})`.execute(ctx.deps.db),
    ).rejects.toThrow(/inicio de un enfriamiento/);
    // Y un cierre de otro local tampoco (FK compuesta).
    const b = await setupOwner(ctx, 'enf3@example.com');
    await expect(
      sql`INSERT INTO records (organization_id, type, data, user_id, user_name, related_record_id)
          VALUES (${b.org.id}, 'enfriamiento', ${JSON.stringify({ phase: 'fin', startRecordId: start.id })}::jsonb, ${b.user.id}, 'x', ${start.id})`.execute(ctx.deps.db),
    ).rejects.toThrow(/foreign key|inicio de un enfriamiento/);
  });
});

// ---------------------------------------------------------------------------
// A2.3 Registros personalizados
// ---------------------------------------------------------------------------
describe('registros personalizados', () => {
  it('crear (lista, valor, sí/no), registrar con alertas, y desactivar no borra sus registros', async () => {
    const o = await setupOwner(ctx, 'tpl@example.com');
    const badTpl = await o.client.post(`${o.base}/custom-templates`, { name: 'Vacía', kind: 'checklist', items: [], frequency: 'daily' });
    expect(json(badTpl).error.details[0].path).toBe('items');
    const list = json(
      await o.client.post(`${o.base}/custom-templates`, { name: 'Apertura', kind: 'checklist', items: [{ label: 'Luces' }, { label: 'Mosquiteras' }], frequency: 'daily', timesPerDay: 1, instructions: 'Al abrir' }),
    ).template;
    expect(list.items).toHaveLength(2);
    const numT = json(await o.client.post(`${o.base}/custom-templates`, { name: 'Cloro', kind: 'numeric', unit: 'mg/l', min: 0.2, max: 1, frequency: 'weekly', weekday: 2 })).template;
    const yes = json(await o.client.post(`${o.base}/custom-templates`, { name: '¿Lavamanos con jabón?', kind: 'yesno', frequency: 'on_demand' })).template;
    // Lista: hay que contestar todos los puntos; uno que no se cumple → alerta y acción.
    const partial = await o.client.post(`${o.base}/records`, { type: 'personalizado', data: { templateId: list.id, items: [{ itemId: list.items[0].id, ok: true }] } });
    expect(json(partial).error.details[0].path).toBe('data.items');
    const noOk = await o.client.post(`${o.base}/records`, { type: 'personalizado', data: { templateId: list.id, items: [{ itemId: list.items[0].id, ok: true }, { itemId: list.items[1].id, ok: false }] } });
    expect(json(noOk).error.details[0].path).toBe('data.correctiveAction');
    const r1 = json(
      await o.client.post(`${o.base}/records`, { type: 'personalizado', data: { templateId: list.id, items: [{ itemId: list.items[0].id, ok: true }, { itemId: list.items[1].id, ok: false }], correctiveAction: 'Avisado el técnico' } }),
    ).record;
    expect(r1).toMatchObject({ alert: true, data: { templateName: 'Apertura', failed: 1 } });
    const r2 = json(await o.client.post(`${o.base}/records`, { type: 'personalizado', data: { templateId: numT.id, reading: 0.5 } })).record;
    expect(r2).toMatchObject({ alert: false, data: { reading: 0.5, unit: 'mg/l', outOfRange: false } });
    expect(json(await o.client.post(`${o.base}/records`, { type: 'personalizado', data: { templateId: numT.id, reading: 0.1 } })).error.details[0].path).toBe('data.correctiveAction');
    const r3 = json(await o.client.post(`${o.base}/records`, { type: 'personalizado', data: { templateId: yes.id, answer: false, correctiveAction: 'Repuesto' } })).record;
    expect(r3.alert).toBe(true);
    // Desactivar: no se borran sus registros, ni se puede registrar ya.
    json(await o.client.patch(`${o.base}/custom-templates/${list.id}`, { active: false }));
    expect((await o.client.get(`${o.base}/records/${r1.id}`)).statusCode).toBe(200);
    expect((await o.client.post(`${o.base}/records`, { type: 'personalizado', data: { templateId: list.id, items: [] } })).statusCode).toBe(400);
    // No hay forma de borrar una plantilla.
    expect((await o.client.delete(`${o.base}/custom-templates/${list.id}`)).statusCode).toBe(404);
    // El tipo no se cambia.
    const kindChange = await o.client.patch(`${o.base}/custom-templates/${numT.id}`, { kind: 'yesno', name: 'Cloro libre' });
    expect(json(kindChange).template).toMatchObject({ kind: 'numeric', name: 'Cloro libre' });
    // Historial y CSV.
    const hist = json(await o.client.get(`${o.base}/records?type=personalizado`)).items;
    expect(hist).toHaveLength(3);
    const csv = await o.client.get(`${o.base}/reports/csv?from=${FIXED_TODAY}&to=${FIXED_TODAY}&types=personalizado`);
    const rows = csvObjects(csv.body);
    expect(rows.find((r) => r.registro_personalizado === 'Apertura')).toMatchObject({ resultado_personalizado: 'No conforme (1 de 2 correctos)', detalle_personalizado: 'No cumple: Mosquiteras' });
    expect(await audits('custom_template.created')).toHaveLength(3);
  });

  it('cuentan en Hoy y en el cumplimiento con vigencia histórica; las sugeridas se activan con un toque', async () => {
    const o = await withKiosk('tpl2@example.com');
    const sug = json(await o.client.get(`${o.base}/custom-templates`)).suggestions;
    expect(sug.map((s: { key: string }) => s.key)).toEqual(['agua_cloro', 'termometros', 'mantenimiento', 'buenas_practicas']);
    expect(sug[0].source).toMatch(/RD 3\/2023/);
    const t = json(await o.client.post(`${o.base}/custom-templates/suggestions`, { key: 'agua_cloro' }));
    expect(t.template).toMatchObject({ name: 'Cloro libre del agua', kind: 'numeric', min: 0.2, max: 1, unit: 'mg/l', suggestionKey: 'agua_cloro' });
    // Un segundo toque no la duplica.
    expect(json(await o.client.post(`${o.base}/custom-templates/suggestions`, { key: 'agua_cloro' })).template.id).toBe(t.template.id);
    // Hoy: se acaba de crear, no cuenta hasta mañana (como equipos y planes).
    let today = json(await o.client.get(`${o.base}/tasks/today`));
    expect(today.custom).toEqual([expect.objectContaining({ templateId: t.template.id, required: 1, done: 0, countsToday: false })]);
    // Con la configuración vigente desde hace 30 días, cuenta y falta.
    await backdateConfig(ctx, o.org.id);
    await sql`UPDATE custom_record_templates SET created_at = ${new Date(FIXED_NOW.getTime() - 30 * 86_400_000)} WHERE organization_id = ${o.org.id}`.execute(ctx.deps.db);
    today = json(await o.client.get(`${o.base}/tasks/today`));
    expect(today.custom[0]).toMatchObject({ countsToday: true, status: 'pending' });
    const ctxK = json(await o.k('GET', '/api/kiosk/context'));
    expect(ctxK.customTemplates.map((x: { name: string }) => x.name)).toEqual(['Cloro libre del agua']);
    expect(ctxK.referenceValues).toEqual(REFERENCE_DEFAULTS);
    const ana = await createStaff(ctx, o.org.id, 'Ana');
    expect((await o.k('POST', '/api/kiosk/records', { staffId: ana.id, type: 'personalizado', data: { templateId: t.template.id, reading: 0.6 } })).statusCode).toBe(201);
    today = json(await o.client.get(`${o.base}/tasks/today`));
    expect(today.custom[0]).toMatchObject({ status: 'done', done: 1 });
    // Cumplimiento: el día anterior falta el cloro; hoy está.
    const yesterday = '2026-11-09';
    const comp = json(await o.client.get(`${o.base}/tasks/compliance?from=${yesterday}&to=${FIXED_TODAY}`));
    const y = comp.days.find((d: { date: string }) => d.date === yesterday);
    expect(y.missing).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'personalizado', name: 'Cloro libre del agua', expected: 1, done: 0 })]));
    const td = comp.days.find((d: { date: string }) => d.date === FIXED_TODAY);
    expect(td.missing.find((m: { kind: string }) => m.kind === 'personalizado')).toBeUndefined();
    // Desactivarla hoy no reescribe el pasado: ayer sigue faltando.
    await o.client.patch(`${o.base}/custom-templates/${t.template.id}`, { active: false });
    const comp2 = json(await o.client.get(`${o.base}/tasks/compliance?from=${yesterday}&to=${yesterday}`));
    expect(comp2.days[0].missing.some((m: { kind: string }) => m.kind === 'personalizado')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// A1.4 Huecos por día y tarea
// ---------------------------------------------------------------------------
describe('tareas sin registrar', () => {
  it('equipos con controles incompletos y limpiezas que no se hicieron o se hicieron a medias', async () => {
    const o = await setupOwner(ctx, 'gaps@example.com', 'bar');
    await backdateConfig(ctx, o.org.id);
    const fridge = await firstEquipment(ctx, o.org.id, 'camara');
    const plan = await ctx.deps.db.selectFrom('cleaning_plans').selectAll().where('organization_id', '=', o.org.id).where('frequency', '=', 'daily').orderBy('created_at').executeTakeFirstOrThrow();
    // Ayer: un control de dos en la cámara y una limpieza parcial.
    nowMs = FIXED_NOW.getTime() - 86_400_000;
    await o.client.post(`${o.base}/records`, { type: 'temperatura', data: { equipmentId: fridge.id, value: 3 } });
    await o.client.post(`${o.base}/records`, { type: 'limpieza', data: { cleaningPlanId: plan.id, items: [{ itemId: plan.items[0]!.id, done: true }] } });
    nowMs = FIXED_NOW.getTime();
    const comp = json(await o.client.get(`${o.base}/tasks/compliance?from=2026-11-09&to=2026-11-09`));
    const missing = comp.days[0].missing;
    expect(missing).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'temperatura', id: fridge.id, name: fridge.name, expected: 2, done: 1 }),
        expect.objectContaining({ kind: 'limpieza', id: plan.id, partial: true }),
      ]),
    );
    expect(comp.overall.daysWithGaps).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// A1.8 Verificación del responsable
// ---------------------------------------------------------------------------
describe('verificación del responsable', () => {
  it('se añade (no sustituye), se audita, no admite periodos futuros y aparece en Hoy', async () => {
    const o = await setupOwner(ctx, 'ver@example.com');
    await ctx.deps.db.updateTable('users').set({ name: 'Laura Gil' }).where('id', '=', o.user.id).execute();
    // El local existe desde hace un mes: la semana pasada (2–8 nov) se puede revisar.
    await sql`UPDATE organizations SET created_at = now() - interval '40 days' WHERE id = ${o.org.id}`.execute(ctx.deps.db);
    let today = json(await o.client.get(`${o.base}/tasks/today`));
    expect(today.review).toEqual({ from: '2026-11-02', to: '2026-11-08', due: true, verified: false });
    expect((await o.client.post(`${o.base}/verifications`, { from: '2026-11-09', to: '2026-11-15', kind: 'week' })).statusCode).toBe(400);
    expect((await o.client.post(`${o.base}/verifications`, { from: '2026-11-03', to: '2026-11-09', kind: 'week' })).statusCode).toBe(400);
    const v1 = json(await o.client.post(`${o.base}/verifications`, { from: '2026-11-02', to: '2026-11-08', kind: 'week', comment: 'Todo correcto' }));
    expect(v1.verification).toMatchObject({ from: '2026-11-02', to: '2026-11-08', kind: 'week', comment: 'Todo correcto', user: { name: 'Laura Gil', role: 'owner' } });
    const m = await addMember(ctx, o.org.id, 'enc2@example.com', 'manager');
    const v2 = json(await m.client.post(`${o.base}/verifications`, { from: '2026-11-01', to: '2026-11-08', kind: 'custom' }));
    expect(v2.verification.user.role).toBe('manager');
    const list = json(await o.client.get(`${o.base}/verifications?from=2026-11-02&to=2026-11-08`)).items;
    expect(list).toHaveLength(2);
    expect(await audits('report.verified')).toHaveLength(2);
    today = json(await o.client.get(`${o.base}/tasks/today`));
    expect(today.review.verified).toBe(true);
    // Mes completo.
    expect((await o.client.post(`${o.base}/verifications`, { from: '2026-10-01', to: '2026-10-31', kind: 'month' })).statusCode).toBe(201);
    expect((await o.client.post(`${o.base}/verifications`, { from: '2026-10-01', to: '2026-10-30', kind: 'month' })).statusCode).toBe(400);
    // Inmutable incluso para el propietario de la base de datos.
    await expect(sql`UPDATE responsible_verifications SET comment = 'x'`.execute(ctx.deps.db)).rejects.toThrow(/no se pueden modificar/);
    await expect(sql`DELETE FROM responsible_verifications`.execute(ctx.deps.db)).rejects.toThrow(/no se pueden modificar/);
    // Alguien que no es del local no puede figurar como verificador.
    const other = await setupOwner(ctx, 'otro@example.com');
    await expect(
      sql`INSERT INTO responsible_verifications (organization_id, period_from, period_to, user_id, user_name, user_role)
          VALUES (${o.org.id}, '2026-11-02', '2026-11-08', ${other.user.id}, 'X', 'owner')`.execute(ctx.deps.db),
    ).rejects.toThrow(/propietario o encargado/);
  });

  it.skipIf(!APP_URL)('con el rol real de la app: hora del reloj, sin UPDATE ni DELETE, y sin fechas futuras', async () => {
    const o = await setupOwner(ctx, 'ver2@example.com');
    const c = new pg.Client({ connectionString: APP_URL });
    await c.connect();
    try {
      const r = (
        await c.query(
          `INSERT INTO responsible_verifications (organization_id, period_from, period_to, user_id, user_name, user_role, created_at)
           VALUES ($1, current_date - 7, current_date - 1, $2, 'X', 'owner', now() - interval '30 days') RETURNING created_at`,
          [o.org.id, o.user.id],
        )
      ).rows[0] as { created_at: Date };
      expect(Date.now() - r.created_at.getTime()).toBeLessThan(60_000);
      await expect(c.query('UPDATE responsible_verifications SET comment = $1', ['x'])).rejects.toThrow(/permission denied/);
      await expect(c.query('DELETE FROM responsible_verifications')).rejects.toThrow(/permission denied/);
      await expect(
        c.query(`INSERT INTO responsible_verifications (organization_id, period_from, period_to, user_id, user_name, user_role) VALUES ($1, current_date, current_date + 3, $2, 'X', 'owner')`, [o.org.id, o.user.id]),
      ).rejects.toThrow(/fechas futuras|periodo ya terminado/);
      // Plantillas: no se borran ni se atrasa su alta; el historial no se escribe a mano.
      const t = (await c.query(`INSERT INTO custom_record_templates (organization_id, name, kind, frequency, created_at) VALUES ($1, 'T', 'yesno', 'daily', now() - interval '60 days') RETURNING id, created_at`, [o.org.id])).rows[0] as { id: string; created_at: Date };
      expect(Date.now() - t.created_at.getTime()).toBeLessThan(60_000);
      await expect(c.query('DELETE FROM custom_record_templates WHERE id = $1', [t.id])).rejects.toThrow(/permission denied/);
      await expect(c.query("UPDATE custom_record_templates SET created_at = now() - interval '9 days' WHERE id = $1", [t.id])).rejects.toThrow(/permission denied/);
      await expect(c.query("INSERT INTO custom_template_config_history (template_id, organization_id, valid_from, frequency, times_per_day, active) VALUES ($1, $2, now() - interval '9 days', 'daily', 1, true)", [t.id, o.org.id])).rejects.toThrow(/permission denied/);
      await c.query('UPDATE custom_record_templates SET active = false WHERE id = $1', [t.id]);
    } finally {
      await c.end();
    }
  });
});

// ---------------------------------------------------------------------------
// A1 El PDF como documento de inspección
// ---------------------------------------------------------------------------
describe('PDF de inspección', () => {
  it('local sin datos: «No indicado», resumen, sin verificación, firma y «Página X de Y»', async () => {
    const o = await setupOwner(ctx, 'pdf0@example.com');
    const res = await o.client.get(`${o.base}/reports/pdf?from=${FIXED_TODAY}&to=${FIXED_TODAY}`);
    expect(res.statusCode).toBe(200);
    const text = pdfToText(res.rawPayload);
    const pages = pdfPages(res.rawPayload);
    expect(text).toContain('Razón social No indicado');
    expect(text).toContain('NIF / CIF No indicado');
    expect(text).toContain('Resumen del periodo');
    expect(text).toContain('Ningún responsable ha marcado como revisado este periodo');
    expect(text).toContain('Revisión y firma del responsable');
    expect(text).toContain(`Página 1 de ${pages}`);
    expect(text).toContain(`Página ${pages} de ${pages}`);
    expect(text).toMatch(/Generado El \d\d\/\d\d\/2026/);
  });

  it('con datos, huecos, alertas, parcial, grupos por equipo y plan, personalizados y verificación', async () => {
    const o = await setupOwner(ctx, 'pdf1@example.com', 'bar');
    await ctx.deps.db.updateTable('users').set({ name: 'Laura Gil' }).where('id', '=', o.user.id).execute();
    await o.client.patch(o.base, { legalName: 'Bar La Prueba S.L.', taxId: 'B12345674', address: 'Calle Mayor 1', postalCode: '28013', city: 'Madrid', province: 'Madrid', sanitaryRegistry: '26.012345/M' });
    await backdateConfig(ctx, o.org.id);
    // Orden determinista (backdateConfig deja la misma fecha de alta a todos): cámaras primero, por nombre.
    const equipment = await ctx.deps.db.selectFrom('equipment').selectAll().where('organization_id', '=', o.org.id).where('type', 'in', ['camara', 'vitrina']).orderBy('name').execute();
    const plan = await ctx.deps.db.selectFrom('cleaning_plans').selectAll().where('organization_id', '=', o.org.id).where('frequency', '=', 'daily').orderBy('created_at').executeTakeFirstOrThrow();
    const tpl = json(await o.client.post(`${o.base}/custom-templates`, { name: 'Apertura', kind: 'yesno', frequency: 'on_demand' })).template;
    nowMs = FIXED_NOW.getTime() - 86_400_000;
    await o.client.post(`${o.base}/records`, { type: 'temperatura', data: { equipmentId: equipment[0]!.id, value: 9, correctiveAction: 'Ajustado el termostato' } });
    await o.client.post(`${o.base}/records`, { type: 'temperatura', data: { equipmentId: equipment[1]!.id, value: 3 } });
    await o.client.post(`${o.base}/records`, { type: 'limpieza', data: { cleaningPlanId: plan.id, items: [{ itemId: plan.items[0]!.id, done: true }] } });
    await o.client.post(`${o.base}/records`, { type: 'personalizado', data: { templateId: tpl.id, answer: true } });
    await o.client.post(`${o.base}/records`, { type: 'cocinado', data: { product: 'Croquetas', process: 'cocinado', coreTemp: 80 } });
    nowMs = FIXED_NOW.getTime();
    await sql`UPDATE organizations SET created_at = now() - interval '40 days' WHERE id = ${o.org.id}`.execute(ctx.deps.db);
    json(await o.client.post(`${o.base}/verifications`, { from: '2026-11-09', to: '2026-11-09', kind: 'custom', comment: 'Revisado con el equipo' }));
    const res = await o.client.get(`${o.base}/reports/pdf?from=2026-11-09&to=2026-11-09`);
    const text = pdfToText(res.rawPayload);
    if (process.env.DEBUG_PDF) console.log(text);
    expect(text).toContain('Razón social Bar La Prueba S.L.');
    expect(text).toContain('NIF / CIF B12345674');
    expect(text).toContain('Calle Mayor 1, 28013 Madrid');
    expect(text).toContain('26.012345/M');
    expect(text).toMatch(/Alertas .*1, con acción correctora/);
    expect(text).toContain('Días con tareas sin registrar 1 de 1');
    expect(text).toMatch(/Verificado por Laura Gil \(propietario\/a\) el .* periodo del 9 de noviembre de 2026 al 9 de noviembre de 2026 \(cubre todo el periodo del informe\) · en ese momento: \d+ tareas sin registrar, 0 alertas sin acción, 0 enfriamientos sin cerrar · Comentario: «Revisado con el equipo»/);
    // Agrupación: subtítulo por equipo con su rango, por plan, y sección de personalizados.
    expect(text).toContain(`${equipment[0]!.name} Rango configurado: máx. 4 °C`);
    expect(text).toContain(plan.name);
    expect(text).toContain('Parcial (1 de');
    expect(text).toContain('Registros personalizados Apertura Sí / No');
    expect(text).toContain('Cocinado y regeneración');
    // Huecos por día y tarea.
    expect(text).toContain('Tareas sin registrar');
    expect(text).toMatch(/9 de noviembre de 2026 Limpieza: .* Solo limpieza parcial: falta completarla/);
    expect(text).toMatch(/9 de noviembre de 2026 Temperatura: .* 1 de 2 controles/);
    const pages = pdfPages(res.rawPayload);
    expect(text).toContain(`Página ${pages} de ${pages}`);
  });

  it('nombres muy largos no rompen la portada ni el pie', async () => {
    const o = await setupOwner(ctx, 'pdf2@example.com');
    const long = 'Restaurante de cocina tradicional y de mercado con nombre larguísimo '.repeat(1).trim();
    await ctx.deps.db.updateTable('organizations').set({ name: long }).where('id', '=', o.org.id).execute();
    await o.client.patch(o.base, { legalName: 'Sociedad Limitada de Hostelería y Restauración del Norte y del Sur '.repeat(2).trim().slice(0, 200), address: 'Avenida '.repeat(30).trim() });
    const res = await o.client.get(`${o.base}/reports/pdf?from=${FIXED_TODAY}&to=${FIXED_TODAY}`);
    expect(res.statusCode).toBe(200);
    const text = pdfToText(res.rawPayload);
    expect(text).toContain('Sociedad Limitada de Hostelería');
    expect(text).toContain('Página 1 de');
  });
});

// ---------------------------------------------------------------------------
// Recordatorio semanal en el email existente
// ---------------------------------------------------------------------------
describe('aviso semanal de revisión', () => {
  it('el lunes, si la semana anterior no está revisada, el email lo dice (y se puede desactivar)', async () => {
    const o = await setupOwner(ctx, 'rem@example.com');
    await sql`UPDATE organizations SET created_at = now() - interval '40 days', reminder_hour = 9 WHERE id = ${o.org.id}`.execute(ctx.deps.db);
    // Lunes 16/11/2026 a las 19:00 en Madrid. Sin tareas pendientes (no hay nada configurado que cuente hoy).
    await ctx.deps.db.updateTable('equipment').set({ active: false }).where('organization_id', '=', o.org.id).execute();
    await ctx.deps.db.updateTable('cleaning_plans').set({ active: false }).where('organization_id', '=', o.org.id).execute();
    const monday = new Date('2026-11-16T18:00:00Z');
    await runReminderTick(ctx.deps, monday);
    const mail = ctx.mailer.outbox.find((m) => m.to === 'rem@example.com');
    expect(mail?.subject).toMatch(/Revisión semanal pendiente/);
    expect(mail?.text).toContain('del 9 de noviembre de 2026 al 15 de noviembre de 2026');
    // Desactivado: no llega.
    ctx.mailer.clear();
    await o.client.patch(`${o.base}/membership`, { weeklyReviewReminder: false });
    await sql`UPDATE organizations SET last_reminder_on = NULL WHERE id = ${o.org.id}`.execute(ctx.deps.db);
    await runReminderTick(ctx.deps, monday);
    expect(ctx.mailer.outbox.filter((m) => m.to === 'rem@example.com')).toHaveLength(0);
    expect(json(await o.client.get(`${o.base}/membership`))).toMatchObject({ weeklyReviewReminder: false });
  });
});
