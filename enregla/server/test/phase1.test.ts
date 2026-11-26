/**
 * Fase 1 del plan de comercialización: integridad de registros y seguridad alimentaria.
 * Cada bloque reproduce un hallazgo de las evaluaciones (docs/evaluaciones) y falla sin su corrección.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { LightMyRequestResponse } from 'fastify';
import { sql } from 'kysely';
import { addMember, backdateConfig, closeTestApp, createStaff, createTestApp, firstEquipment, json, resetDb, setupOwner, FIXED_NOW, FIXED_TODAY, type TestCtx } from './helpers.js';
import { CSV_HEADERS } from '../src/modules/reports/format.js';
import { PDF_INTEGRITY_NOTE } from '../src/modules/reports/pdf.js';

let ctx: TestCtx;
// Reloj controlable: fijo por defecto (los tests no dependen de la hora real), se puede adelantar.
let nowMs = FIXED_NOW.getTime();
beforeAll(async () => {
  ctx = await createTestApp({ now: () => new Date(nowMs) });
});
afterAll(async () => closeTestApp(ctx));
beforeEach(async () => {
  nowMs = FIXED_NOW.getTime();
  await resetDb(ctx);
});

/** Texto de un PDF (pdftotext en orden de dibujo), con los espacios normalizados. */
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

/** Filas de un CSV del informe como objetos (cabecera → valor). */
function csvObjects(text: string): Record<string, string>[] {
  const lines = text.replace(/^\uFEFF/, '').trim().split('\r\n');
  const cells = (l: string) => l.slice(1, -1).split('";"').map((c) => c.replace(/""/g, '"'));
  const header = cells(lines[0]!);
  return lines.slice(1).map((l) => Object.fromEntries(cells(l).map((v, i) => [header[i]!, v])));
}

async function setupKiosk() {
  const owner = await setupOwner(ctx, 'laura@example.com');
  await ctx.deps.db.updateTable('users').set({ name: 'Laura Gil' }).where('id', '=', owner.user.id).execute();
  const res = json(await owner.client.post(`${owner.base}/devices`, { name: 'Tablet cocina' }));
  const k = (method: 'GET' | 'POST', url: string, payload?: unknown, token: string = res.token): Promise<LightMyRequestResponse> =>
    ctx.app.inject({ method, url, headers: { authorization: `Bearer ${token}` }, ...(payload !== undefined ? { payload: payload as object } : {}) });
  return { ...owner, token: res.token as string, deviceId: res.device.id as string, k };
}

const report = (base: string, kind: 'pdf' | 'csv', types?: string) => `${base}/reports/${kind}?from=${FIXED_TODAY}&to=${FIXED_TODAY}${types ? `&types=${types}` : ''}`;

// ---------------------------------------------------------------------------
// 1.1 Alta desde la web para un empleado: firma «Y (anotado por X)»
// ---------------------------------------------------------------------------
describe('1.1 registro web a nombre de un empleado', () => {
  it('el autor es el usuario con sesión y se muestra «Ana (anotado por Laura)» en la API, el PDF y el CSV', async () => {
    const { client, base, org } = await setupKiosk();
    const ana = await createStaff(ctx, org.id, 'Ana Martín', '1234');
    const fridge = await firstEquipment(ctx, org.id, 'camara');
    // Sin PIN: la web no lo pide, pero el usuario con sesión queda siempre como autor.
    const res = await client.post(`${base}/records`, { type: 'temperatura', staffId: ana.id, data: { equipmentId: fridge.id, value: 3 } });
    expect(res.statusCode).toBe(201);
    const rec = json(res).record;
    expect(rec.user).toMatchObject({ name: 'Laura Gil' });
    expect(rec.staff).toMatchObject({ name: 'Ana Martín' });
    expect(rec.signature).toBe('Ana Martín (anotado por Laura Gil)');
    // Solo el usuario: su nombre.
    const own = json(await client.post(`${base}/records`, { type: 'plagas', data: { result: 'sin_indicios' } })).record;
    expect(own.signature).toBe('Laura Gil');

    const pdf = pdfToText((await client.get(report(base, 'pdf', 'temperatura'))).rawPayload);
    expect(pdf).toContain('Ana Martín (anotado por Laura Gil)');
    const csv = csvObjects((await client.get(report(base, 'csv'))).body);
    const row = csv.find((r) => r.id === rec.id)!;
    expect(row.firma).toBe('Ana Martín (anotado por Laura Gil)');
    expect(row.firmado_por_personal).toBe('Ana Martín');
    expect(row.firmado_por_usuario).toBe('Laura Gil');
  });

  it('el kiosko sigue exigiendo el PIN del empleado y su firma no lleva «anotado por»', async () => {
    const { k, org } = await setupKiosk();
    const ana = await createStaff(ctx, org.id, 'Ana Martín', '1234');
    const fridge = await firstEquipment(ctx, org.id, 'camara');
    expect((await k('POST', '/api/kiosk/records', { staffId: ana.id, type: 'temperatura', data: { equipmentId: fridge.id, value: 3 } })).statusCode).toBe(401);
    const r = await k('POST', '/api/kiosk/records', { staffId: ana.id, pin: '1234', type: 'temperatura', data: { equipmentId: fridge.id, value: 3 } });
    expect(r.statusCode).toBe(201);
    expect(json(r).record.signature).toBe('Ana Martín');
  });
});

// ---------------------------------------------------------------------------
// 1.2 Autor de la corrección = quien la hizo
// ---------------------------------------------------------------------------
describe('1.2 autoría de las correcciones', () => {
  it('una corrección web de un registro de la tablet se atribuye al usuario que corrige (API, PDF, CSV)', async () => {
    const { client, base, org, k } = await setupKiosk();
    const luis = await createStaff(ctx, org.id, 'Luis Pérez');
    const fridge = await firstEquipment(ctx, org.id, 'camara');
    const orig = json(await k('POST', '/api/kiosk/records', { staffId: luis.id, type: 'temperatura', data: { equipmentId: fridge.id, value: 9, correctiveAction: 'Revisada la puerta' } })).record;
    // La web conserva el firmante (Luis) y corrige Laura.
    const am = await client.post(`${base}/records/${orig.id}/amendments`, { reason: 'Se tecleó 9 en vez de 0,9', data: { equipmentId: fridge.id, value: 0.9 } });
    expect(am.statusCode).toBe(201);
    const amend = json(am).record;
    expect(amend.staff).toMatchObject({ name: 'Luis Pérez' });
    expect(amend.correctedBy).toBe('Laura Gil');
    expect(amend.signature).toBe('Luis Pérez');

    const pdf = pdfToText((await client.get(report(base, 'pdf', 'temperatura'))).rawPayload);
    expect(pdf).toMatch(/Firmó: Luis Pérez · Corrigió: Laura Gil el \d/);
    expect(pdf).toContain('Motivo: Se tecleó 9 en vez de 0,9');
    expect(pdf).toMatch(/Corregido el .* por Laura Gil/);
    expect(pdf).not.toMatch(/por Luis Pérez/);

    const csv = csvObjects((await client.get(report(base, 'csv'))).body);
    expect(csv.find((r) => r.id === amend.id)!.enmendado_por).toBe('Laura Gil');
    expect(csv.find((r) => r.id === orig.id)!.corregido_por_nombre).toBe('Laura Gil');
  });
});

// ---------------------------------------------------------------------------
// 1.3 Orden original → corrección, también a la misma hora y en cadenas
// ---------------------------------------------------------------------------
describe('1.3 orden estable original → corrección', () => {
  it('en el PDF, el CSV y el historial el original va antes que su corrección (reloj fijo: misma hora exacta)', async () => {
    const { client, base, org } = await setupOwner(ctx);
    const fridge = await firstEquipment(ctx, org.id, 'camara');
    const chains: string[][] = [];
    for (let i = 0; i < 8; i++) {
      const a = json(await client.post(`${base}/records`, { type: 'temperatura', data: { equipmentId: fridge.id, value: 1 } })).record;
      const b = json(await client.post(`${base}/records/${a.id}/amendments`, { reason: `primera ${i}`, data: { equipmentId: fridge.id, value: 2 } })).record;
      const c = json(await client.post(`${base}/records/${b.id}/amendments`, { reason: `segunda ${i}`, data: { equipmentId: fridge.id, value: 3 } })).record;
      chains.push([a.id, b.id, c.id]);
    }
    const isOrdered = (ids: string[]) => chains.every(([a, b, c]) => ids.indexOf(a!) < ids.indexOf(b!) && ids.indexOf(b!) < ids.indexOf(c!));

    const csv = csvObjects((await client.get(report(base, 'csv'))).body).map((r) => r.id!);
    expect(isOrdered(csv)).toBe(true);

    const hist: string[] = [];
    let cursor: string | null = null;
    do {
      const page: { items: { id: string }[]; nextCursor: string | null } = json(await client.get(`${base}/records?limit=5${cursor ? `&cursor=${cursor}` : ''}`));
      hist.push(...page.items.map((r: { id: string }) => r.id));
      cursor = page.nextCursor;
    } while (cursor);
    expect(hist).toHaveLength(24);
    expect(new Set(hist).size).toBe(24);
    expect(isOrdered(hist)).toBe(true);

    const pdf = pdfToText((await client.get(report(base, 'pdf', 'temperatura'))).rawPayload);
    for (let i = 0; i < 8; i++) {
      const p1 = pdf.indexOf(`Motivo: primera ${i}`);
      const p2 = pdf.indexOf(`Motivo: segunda ${i}`);
      expect(p1).toBeGreaterThan(-1);
      expect(p2).toBeGreaterThan(p1);
    }
  });
});

// ---------------------------------------------------------------------------
// 1.5 Corregir en la tablet (2 minutos) y cambiar el firmante en la web
// ---------------------------------------------------------------------------
describe('1.5 correcciones en la tablet', () => {
  async function kioskRecord(value = 9) {
    const s = await setupKiosk();
    const ana = await createStaff(ctx, s.org.id, 'Ana Martín', '1234');
    const luis = await createStaff(ctx, s.org.id, 'Luis Pérez');
    const marta = await createStaff(ctx, s.org.id, 'Marta Gil', '5678');
    const fridge = await firstEquipment(ctx, s.org.id, 'camara');
    const orig = json(
      await s.k('POST', '/api/kiosk/records', { staffId: luis.id, type: 'temperatura', data: { equipmentId: fridge.id, value, correctiveAction: value > 4 ? 'Revisada la puerta' : null } }),
    ).record;
    return { ...s, ana, luis, marta, fridge, orig };
  }

  it('«Me equivoqué de número»: crea una corrección (no borra) con la misma persona y el mismo dispositivo', async () => {
    const { k, orig, luis, fridge, client, base, deviceId } = await kioskRecord(9);
    const res = await k('POST', `/api/kiosk/records/${orig.id}/amendments`, { staffId: luis.id, reason: 'wrong_value', data: { equipmentId: fridge.id, value: 0.9 } });
    expect(res.statusCode).toBe(201);
    const am = json(res).record;
    expect(am).toMatchObject({ amendsRecordId: orig.id, amendmentReason: 'Me equivoqué de número', staff: { id: luis.id }, user: null, deviceId, alert: false, correctedBy: 'Luis Pérez' });
    expect(am.data.value).toBe(0.9);
    // El original sigue existiendo y queda enlazado.
    const detail = json(await client.get(`${base}/records/${orig.id}`));
    expect(detail.record.data.value).toBe(9);
    expect(detail.amendedBy.id).toBe(am.id);
    // Una segunda corrección desde la tablet no se permite (ya tiene corrección).
    expect((await k('POST', `/api/kiosk/records/${orig.id}/amendments`, { staffId: luis.id, reason: 'wrong_value', data: { equipmentId: fridge.id, value: 1 } })).statusCode).toBe(409);
  });

  it('«Me equivoqué de persona»: cambia el firmante pidiendo el PIN de la persona correcta', async () => {
    const { k, orig, luis, marta } = await kioskRecord(3);
    const noPin = await k('POST', `/api/kiosk/records/${orig.id}/amendments`, { staffId: luis.id, reason: 'wrong_person', newStaffId: marta.id });
    expect(noPin.statusCode).toBe(401);
    expect(json(noPin).error.code).toBe('PIN_REQUIRED');
    const bad = await k('POST', `/api/kiosk/records/${orig.id}/amendments`, { staffId: luis.id, reason: 'wrong_person', newStaffId: marta.id, newStaffPin: '0000' });
    expect(bad.statusCode).toBe(401);
    expect(json(bad).error.code).toBe('INVALID_PIN');
    // La tablet sabe qué PIN ha fallado (el de la persona correcta).
    expect(json(bad).error.details[0].path).toBe('newStaffPin');
    const ok = await k('POST', `/api/kiosk/records/${orig.id}/amendments`, { staffId: luis.id, reason: 'wrong_person', newStaffId: marta.id, newStaffPin: '5678' });
    expect(ok.statusCode).toBe(201);
    const am = json(ok).record;
    expect(am.staff).toMatchObject({ id: marta.id, name: 'Marta Gil' });
    expect(am.amendmentReason).toBe('Me equivoqué de persona (figuraba Luis Pérez)');
    expect(am.data.value).toBe(3);
    expect(am.correctedBy).toBe('Marta Gil');
    // «Otro» exige el texto.
    const { k: k2, orig: o2, luis: l2, fridge: f2 } = await (async () => {
      await resetDb(ctx);
      return kioskRecord(2);
    })();
    expect((await k2('POST', `/api/kiosk/records/${o2.id}/amendments`, { staffId: l2.id, reason: 'other', data: { equipmentId: f2.id, value: 2.5 } })).statusCode).toBe(400);
    const other = await k2('POST', `/api/kiosk/records/${o2.id}/amendments`, { staffId: l2.id, reason: 'other', reasonText: 'Medí la cámara equivocada', data: { equipmentId: f2.id, value: 2.5 } });
    expect(other.statusCode).toBe(201);
    expect(json(other).record.amendmentReason).toBe('Medí la cámara equivocada');
  });

  it('solo la misma persona (con su PIN), en el mismo dispositivo, dentro de los 2 minutos y en el mismo local', async () => {
    const { k, orig, ana, luis, fridge, client, base } = await kioskRecord(9);
    const body = { staffId: luis.id, reason: 'wrong_value', data: { equipmentId: fridge.id, value: 1 } };
    // Otra persona: no.
    const other = await k('POST', `/api/kiosk/records/${orig.id}/amendments`, { ...body, staffId: ana.id, pin: '1234' });
    expect(other.statusCode).toBe(403);
    expect(json(other).error.code).toBe('CORRECTION_NOT_ALLOWED');
    // Otro dispositivo del mismo local: no.
    const second = json(await client.post(`${base}/devices`, { name: 'Tablet barra' }));
    const other2 = await k('POST', `/api/kiosk/records/${orig.id}/amendments`, body, second.token);
    expect(other2.statusCode).toBe(403);
    // Otro local: 404 (no se revela nada).
    const otherOrg = await setupOwner(ctx, 'otro@example.com');
    const dev = json(await otherOrg.client.post(`${otherOrg.base}/devices`, { name: 'Tablet' }));
    expect((await k('POST', `/api/kiosk/records/${orig.id}/amendments`, body, dev.token)).statusCode).toBe(404);
    // Fuera de plazo (más de 2 minutos y el margen): no.
    nowMs += 3 * 60_000;
    const late = await k('POST', `/api/kiosk/records/${orig.id}/amendments`, body);
    expect(late.statusCode).toBe(403);
    expect(json(late).error.message).toMatch(/2 minutos/);
    nowMs -= 3 * 60_000;
    // Dentro de plazo, la misma persona: sí.
    expect((await k('POST', `/api/kiosk/records/${orig.id}/amendments`, body)).statusCode).toBe(201);
  });

  it('pide el PIN de la persona que registró si lo tiene y no corrige correcciones ni registros web', async () => {
    const s = await setupKiosk();
    const ana = await createStaff(ctx, s.org.id, 'Ana Martín', '1234');
    const fridge = await firstEquipment(ctx, s.org.id, 'camara');
    const orig = json(await s.k('POST', '/api/kiosk/records', { staffId: ana.id, pin: '1234', type: 'temperatura', data: { equipmentId: fridge.id, value: 2 } })).record;
    const body = { staffId: ana.id, reason: 'wrong_value', data: { equipmentId: fridge.id, value: 3 } };
    expect(json(await s.k('POST', `/api/kiosk/records/${orig.id}/amendments`, body)).error.code).toBe('PIN_REQUIRED');
    expect(json(await s.k('POST', `/api/kiosk/records/${orig.id}/amendments`, { ...body, pin: '9999' })).error.code).toBe('INVALID_PIN');
    const ok = await s.k('POST', `/api/kiosk/records/${orig.id}/amendments`, { ...body, pin: '1234' });
    expect(ok.statusCode).toBe(201);
    // La corrección no se puede corregir desde la tablet.
    expect((await s.k('POST', `/api/kiosk/records/${json(ok).record.id}/amendments`, { ...body, pin: '1234' })).statusCode).toBe(403);
    // Un registro hecho desde la web tampoco.
    const web = json(await s.client.post(`${s.base}/records`, { type: 'temperatura', staffId: ana.id, data: { equipmentId: fridge.id, value: 2 } })).record;
    expect((await s.k('POST', `/api/kiosk/records/${web.id}/amendments`, { ...body, pin: '1234' })).statusCode).toBe(403);
  });

  it('web: la corrección puede cambiar el firmante (con motivo) y, si no se indica, conserva el del original', async () => {
    const { client, base, orig, ana, luis, fridge } = await kioskRecord(3);
    const keep = json(await client.post(`${base}/records/${orig.id}/amendments`, { reason: 'Ajuste', data: { equipmentId: fridge.id, value: 2 } })).record;
    expect(keep.staff).toMatchObject({ id: luis.id });
    const changed = await client.post(`${base}/records/${keep.id}/amendments`, { reason: 'Lo hizo Ana, no Luis', staffId: ana.id, data: { equipmentId: fridge.id, value: 2 } });
    expect(changed.statusCode).toBe(201);
    expect(json(changed).record).toMatchObject({ staff: { id: ana.id }, user: { name: 'Laura Gil' }, correctedBy: 'Laura Gil' });
    // El motivo sigue siendo obligatorio.
    expect((await client.post(`${base}/records/${json(changed).record.id}/amendments`, { reason: '', staffId: luis.id, data: { equipmentId: fridge.id, value: 2 } })).statusCode).toBe(400);
    // El firmante original desactivado se conserva al corregir otro dato.
    await ctx.deps.db.updateTable('staff').set({ active: false }).where('id', '=', ana.id).execute();
    const again = await client.post(`${base}/records/${json(changed).record.id}/amendments`, { reason: 'Otro ajuste', data: { equipmentId: fridge.id, value: 2.5 } });
    expect(again.statusCode).toBe(201);
    expect(json(again).record.staff).toMatchObject({ id: ana.id });
    // El PDF indica el cambio de firmante.
    const pdf = pdfToText((await client.get(report(base, 'pdf', 'temperatura'))).rawPayload);
    expect(pdf).toContain('Firmante anterior: Luis Pérez');
  });
});

// ---------------------------------------------------------------------------
// 1.6 Recepción: categoría y límite por defecto, alerta y acción correctora en el servidor
// ---------------------------------------------------------------------------
describe('1.6 recepción con categoría de producto', () => {
  const rec = (data: Record<string, unknown>) => ({ type: 'recepcion', data: { supplierName: 'Pescados del Puerto', product: 'Merluza', accepted: true, ...data } });

  it('refrigerado a 6 °C: exige acción correctora y queda con alerta (máx. 4 °C por defecto)', async () => {
    const { client, base } = await setupOwner(ctx);
    const noAction = await client.post(`${base}/records`, rec({ category: 'refrigerado', temperature: 6 }));
    expect(noAction.statusCode).toBe(400);
    expect(json(noAction).error.details[0].path).toBe('data.correctiveAction');
    const res = await client.post(`${base}/records`, rec({ category: 'refrigerado', temperature: 6, correctiveAction: 'Se usa de inmediato' }));
    expect(res.statusCode).toBe(201);
    expect(json(res).record).toMatchObject({ alert: true, data: { category: 'refrigerado', maxTemperature: 4, minTemperature: null, temperatureOutOfRange: true } });
  });

  it('límites por categoría coherentes con las plantillas (congelado −18, caliente ≥ 63, ambiente sin límite) y editables', async () => {
    const { client, base } = await setupOwner(ctx);
    const frozen = await client.post(`${base}/records`, rec({ category: 'congelado', temperature: -15 }));
    expect(frozen.statusCode).toBe(400);
    const hot = json(await client.post(`${base}/records`, rec({ category: 'caliente', temperature: 60, correctiveAction: 'Regenerado a 75 °C' }))).record;
    expect(hot).toMatchObject({ alert: true, data: { minTemperature: 63, maxTemperature: null, temperatureOutOfRange: true } });
    const ambient = json(await client.post(`${base}/records`, rec({ category: 'ambiente', temperature: 25 }))).record;
    expect(ambient).toMatchObject({ alert: false, data: { category: 'ambiente', maxTemperature: null, minTemperature: null, temperatureOutOfRange: false } });
    // Límite editado: refrigerado con máx. 7 °C → 6 °C correcto.
    const edited = json(await client.post(`${base}/records`, rec({ category: 'refrigerado', temperature: 6, maxTemperature: 7 }))).record;
    expect(edited).toMatchObject({ alert: false, data: { maxTemperature: 7 } });
  });

  it('cliente antiguo sin categoría ni máxima: se aplica refrigerado (≤ 4 °C) y una lectura de 6 °C queda con alerta', async () => {
    const { client, base } = await setupOwner(ctx);
    const res = await client.post(`${base}/records`, rec({ temperature: 6 }));
    expect(res.statusCode).toBe(201);
    expect(json(res).record).toMatchObject({ alert: true, data: { category: 'refrigerado', categoryAssumed: true, maxTemperature: 4, temperatureOutOfRange: true } });
    // Con máxima explícita (cliente antiguo con atajo) se respeta y exige motivo como antes.
    expect((await client.post(`${base}/records`, rec({ temperature: 6, maxTemperature: 4 }))).statusCode).toBe(400);
    // Sin temperatura no se presupone nada.
    const noTemp = json(await client.post(`${base}/records`, rec({}))).record;
    expect(noTemp).toMatchObject({ alert: false, data: { category: null, maxTemperature: null } });
  });

  it('el kiosko aplica las mismas reglas y el proveedor guarda una categoría por defecto', async () => {
    const { client, base, k, org } = await setupKiosk();
    const sup = await client.post(`${base}/suppliers`, { name: 'Congelados Norte', defaultCategory: 'congelado' });
    expect(sup.statusCode).toBe(201);
    expect(json(sup).supplier.defaultCategory).toBe('congelado');
    expect(json(await client.patch(`${base}/suppliers/${json(sup).supplier.id}`, { defaultCategory: 'refrigerado' })).supplier.defaultCategory).toBe('refrigerado');
    expect((await client.post(`${base}/suppliers`, { name: 'X', defaultCategory: 'tibio' })).statusCode).toBe(400);
    const ctxRes = json(await k('GET', '/api/kiosk/context'));
    expect(ctxRes.suppliers.find((s: { name: string }) => s.name === 'Congelados Norte').defaultCategory).toBe('refrigerado');
    const st = await createStaff(ctx, org.id, 'Jonathan');
    const r = await k('POST', '/api/kiosk/records', { staffId: st.id, ...rec({ category: 'refrigerado', temperature: 6 }) });
    expect(r.statusCode).toBe(400);
    expect(json(r).error.details[0].path).toBe('data.correctiveAction');
  });

  it('PDF y CSV muestran la categoría, el límite y la alerta', async () => {
    const { client, base } = await setupOwner(ctx);
    await client.post(`${base}/records`, rec({ category: 'refrigerado', temperature: 6, correctiveAction: 'Se usa de inmediato' }));
    const pdf = pdfToText((await client.get(report(base, 'pdf', 'recepcion'))).rawPayload);
    expect(pdf).toContain('6 °C (Refrigerado, máx. 4 °C)');
    expect(pdf).toContain('Aceptada con alerta: supera el límite');
    const csv = csvObjects((await client.get(report(base, 'csv'))).body);
    expect(csv[0]).toMatchObject({ categoria_producto: 'refrigerado', temperatura_maxima_c: '4', temperatura_c: '6', alerta: 'sí' });
  });
});

// ---------------------------------------------------------------------------
// 1.8 Frase exacta del PDF sobre la inmutabilidad
// ---------------------------------------------------------------------------
describe('1.8 texto del PDF sobre la conservación de los registros', () => {
  it('no promete lo que no se cumple y explica correcciones y eliminación del local', async () => {
    const { client, base } = await setupOwner(ctx);
    const pdf = pdfToText((await client.get(report(base, 'pdf'))).rawPayload);
    expect(pdf).not.toMatch(/Los registros no se pueden modificar ni borrar/);
    expect(pdf).toContain('La aplicación no permite modificar ni borrar registros');
    expect(pdf).toMatch(/autor, fecha y motivo/);
    expect(pdf).toMatch(/30 días/);
    expect(PDF_INTEGRITY_NOTE).toMatch(/30 días/);
  });
});

// ---------------------------------------------------------------------------
// 1.10 Salir del modo cocina y desvincular con la contraseña de un responsable
// ---------------------------------------------------------------------------
describe('1.10 salir y desvincular la tablet', () => {
  it('exige email y contraseña de un propietario o encargado de ESTE local, verificados en el servidor', async () => {
    const { k, org, base, client } = await setupKiosk();
    const { user: mgr } = await addMember(ctx, org.id, 'encargada@example.com', 'manager');
    const outsider = await setupOwner(ctx, 'ajeno@example.com');
    expect((await k('POST', '/api/kiosk/exit', {})).statusCode).toBe(400);
    const wrong = await k('POST', '/api/kiosk/exit', { email: 'laura@example.com', password: 'mal-mal-mal' });
    expect(wrong.statusCode).toBe(401);
    expect(json(wrong).error.code).toBe('INVALID_CREDENTIALS');
    // Propietario de otro local: no sirve.
    expect((await k('POST', '/api/kiosk/exit', { email: 'ajeno@example.com', password: 'Cocina-Segura-2026' })).statusCode).toBe(401);
    expect(outsider.org.id).not.toBe(org.id);
    // Encargada del local: sí.
    const ok = await k('POST', '/api/kiosk/exit', { email: mgr.email, password: 'Cocina-Segura-2026' });
    expect(ok.statusCode).toBe(200);
    expect(json(ok)).toMatchObject({ ok: true, by: { name: mgr.name } });
    // Salir no desvincula: la tablet sigue funcionando.
    expect((await k('GET', '/api/kiosk/context')).statusCode).toBe(200);
    // Desvincular revoca el dispositivo en el servidor.
    const un = await k('POST', '/api/kiosk/unpair', { email: 'laura@example.com', password: 'Cocina-Segura-2026' });
    expect(un.statusCode).toBe(200);
    expect((await k('GET', '/api/kiosk/context')).statusCode).toBe(401);
    const devices = json(await client.get(`${base}/devices`)).items;
    expect(devices[0].active).toBe(false);
    const events = (await ctx.deps.db.selectFrom('audit_events').select(['event', 'metadata']).where('organization_id', '=', org.id).execute()).map((e) => e.event);
    expect(events).toEqual(expect.arrayContaining(['device.kiosk_exit', 'device.revoked']));
  });

  it('limita los intentos por dispositivo', async () => {
    const { k } = await setupKiosk();
    let last: LightMyRequestResponse | null = null;
    for (let i = 0; i < 11; i++) last = await k('POST', '/api/kiosk/exit', { email: 'laura@example.com', password: `incorrecta-${i}` });
    expect(last!.statusCode).toBe(429);
    // Ni con la contraseña correcta mientras dura el bloqueo.
    expect((await k('POST', '/api/kiosk/exit', { email: 'laura@example.com', password: 'Cocina-Segura-2026' })).statusCode).toBe(429);
  });
});

// ---------------------------------------------------------------------------
// 1.12 «Hecho con alerta» y «Volver a medir»
// ---------------------------------------------------------------------------
describe('1.12 lecturas fuera de rango en Hoy', () => {
  it('marca el equipo como hecho con alerta y pide volver a medir hasta una lectura correcta posterior', async () => {
    const { client, base, org } = await setupOwner(ctx);
    await backdateConfig(ctx, org.id);
    const freezer = await firstEquipment(ctx, org.id, 'congelador'); // 1 control al día, máx. −18 °C
    await client.post(`${base}/records`, { type: 'temperatura', data: { equipmentId: freezer.id, value: -10, correctiveAction: 'Puerta cerrada y revisada; Repetiré la medición en 30 min' } });
    let t = json(await client.get(`${base}/tasks/today`));
    let f = t.temperatures.find((x: { equipmentId: string }) => x.equipmentId === freezer.id);
    expect(f).toMatchObject({ status: 'done', withAlert: true, remeasure: true });
    expect(t.summary.remeasure).toBe(1);
    expect(t.summary.doneWithAlert).toBe(1);
    // Cuenta como hecho en el porcentaje (decisión documentada).
    const doneBefore = t.summary.done;
    expect(doneBefore).toBeGreaterThanOrEqual(1);
    // Una lectura correcta POSTERIOR quita «volver a medir», pero el día sigue «con alerta».
    nowMs += 30 * 60_000;
    await client.post(`${base}/records`, { type: 'temperatura', data: { equipmentId: freezer.id, value: -19 } });
    t = json(await client.get(`${base}/tasks/today`));
    f = t.temperatures.find((x: { equipmentId: string }) => x.equipmentId === freezer.id);
    expect(f).toMatchObject({ status: 'done', withAlert: true, remeasure: false, lastReading: { value: -19, outOfRange: false } });
    expect(t.summary.remeasure).toBe(0);
    expect(t.summary.done).toBe(doneBefore);
  });

  it('una lectura fuera de rango corregida a un valor correcto no deja «volver a medir»', async () => {
    const { client, base, org } = await setupOwner(ctx);
    await backdateConfig(ctx, org.id);
    const freezer = await firstEquipment(ctx, org.id, 'congelador');
    const r = json(await client.post(`${base}/records`, { type: 'temperatura', data: { equipmentId: freezer.id, value: -10, correctiveAction: 'Revisado' } })).record;
    await client.post(`${base}/records/${r.id}/amendments`, { reason: 'Error al teclear', data: { equipmentId: freezer.id, value: -20 } });
    const f = json(await client.get(`${base}/tasks/today`)).temperatures.find((x: { equipmentId: string }) => x.equipmentId === freezer.id);
    expect(f).toMatchObject({ withAlert: false, remeasure: false });
  });
});

describe('CSV: columnas nuevas al final', () => {
  it('conserva el orden anterior y añade firma, corregido_por_nombre, firmante_anterior, categoria_producto y temperatura_minima_c al final', () => {
    const prev = ['estado_limpieza', 'temperatura_maxima_c', 'caducada'];
    const idx = CSV_HEADERS.indexOf('caducada');
    expect(CSV_HEADERS.slice(idx - 2, idx + 1)).toEqual(prev);
    expect(CSV_HEADERS.slice(idx + 1)).toEqual(['firma', 'corregido_por_nombre', 'firmante_anterior', 'categoria_producto', 'temperatura_minima_c']);
  });
});

// Garantía de la migración: el orden de inserción se conserva en una columna propia.
describe('migración 0006', () => {
  it('records.seq existe y crece con cada alta', async () => {
    const { client, base } = await setupOwner(ctx);
    await client.post(`${base}/records`, { type: 'plagas', data: { result: 'sin_indicios' } });
    await client.post(`${base}/records`, { type: 'plagas', data: { result: 'sin_indicios' } });
    const rows = await sql<{ seq: number }>`SELECT seq FROM records ORDER BY seq`.execute(ctx.deps.db);
    expect(rows.rows).toHaveLength(2);
    expect(Number(rows.rows[1]!.seq)).toBeGreaterThan(Number(rows.rows[0]!.seq));
  });
});
