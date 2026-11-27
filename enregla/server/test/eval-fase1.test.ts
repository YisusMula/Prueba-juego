/**
 * Hallazgos de la evaluación independiente de la fase 1 (docs: informe de evaluación). Cada bloque
 * reproduce un hallazgo y falla sin su corrección.
 *
 * Los tests de permisos (#2, #3) se conectan con el ROL DE EJECUCIÓN real de la app
 * (`TEST_APP_DATABASE_URL`, p. ej. postgres://enregla_app:…@localhost/enregla_test); el rol debe existir
 * en el cluster (deploy/postgres-init/10-enregla-roles.sh). Sin esa variable se omiten.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import pg from 'pg';
import { sql } from 'kysely';
import type { LightMyRequestResponse } from 'fastify';
import { closeTestApp, createStaff, createTestApp, firstEquipment, json, resetDb, setupOwner, addMember, FIXED_NOW, FIXED_TODAY, testConfig, type TestCtx } from './helpers.js';
import { TEST_DATABASE_URL } from './global-setup.js';
import { ConfigError, loadConfig } from '../src/config.js';
import { applyAppRolePrivileges, refuseToStart } from '../src/db/privileges.js';
import { pdfIntegrityNote } from '../src/modules/reports/pdf.js';
import { runRetention } from '../src/modules/reminders/scheduler.js';
import { pseudonymizeUserAudit } from '../src/lib/audit.js';
import { runMaintenance } from '../src/modules/maintenance/run.js';

let ctx: TestCtx;
let nowMs = FIXED_NOW.getTime();
beforeAll(async () => {
  ctx = await createTestApp({ now: () => new Date(nowMs) });
});
afterAll(async () => closeTestApp(ctx));
beforeEach(async () => {
  nowMs = FIXED_NOW.getTime();
  await resetDb(ctx);
});

async function setupKiosk() {
  const owner = await setupOwner(ctx, 'laura@example.com');
  await ctx.deps.db.updateTable('users').set({ name: 'Laura Gil' }).where('id', '=', owner.user.id).execute();
  const res = json(await owner.client.post(`${owner.base}/devices`, { name: 'Tablet' }));
  const k = (method: 'GET' | 'POST', url: string, payload?: unknown, headers: Record<string, string> = {}): Promise<LightMyRequestResponse> =>
    ctx.app.inject({ method, url, headers: { authorization: `Bearer ${res.token}`, ...headers }, ...(payload !== undefined ? { payload: payload as object } : {}) });
  return { ...owner, token: res.token as string, k };
}
const rec = (data: Record<string, unknown>) => ({ type: 'recepcion', data: { supplierName: 'Pescados del Puerto', product: 'Merluza', accepted: true, ...data } });

// ---------------------------------------------------------------------------
// #1 La app no puede recibir las claves del administrador ni del propietario
// ---------------------------------------------------------------------------
describe('#1 secretos de la base de datos fuera del entorno de la app', () => {
  const prodEnv = {
    NODE_ENV: 'production',
    APP_URL: 'https://app.example.es',
    DATABASE_URL: 'postgres://enregla_app:una-clave-muy-larga-1234@db:5432/enregla',
    MAIL_TRANSPORT: 'smtp',
    SMTP_HOST: 'smtp.example.es',
    MAIL_FROM: 'no-reply@example.es',
    TRUST_PROXY: '1',
  };
  it('en producción la configuración no es válida si la app ve POSTGRES_PASSWORD o DB_*_PASSWORD', () => {
    expect(() => loadConfig(prodEnv)).not.toThrow();
    for (const k of ['POSTGRES_PASSWORD', 'DB_OWNER_PASSWORD', 'DB_APP_PASSWORD']) {
      expect(() => loadConfig({ ...prodEnv, [k]: 'otra-clave-muy-larga-5678' })).toThrow(ConfigError);
      expect(() => loadConfig({ ...prodEnv, [k]: 'otra-clave-muy-larga-5678' })).toThrow(new RegExp(k));
    }
  });
  it('en producción no arranca si su rol es superusuario o propietario (y ya no hay forma de saltárselo)', () => {
    const owner = { role: 'enregla', hardened: false, problems: ['es propietario de la tabla records'], privileged: true };
    expect(refuseToStart(owner, true)).toMatch(/enregla_app/);
    expect(refuseToStart(owner, true)).not.toMatch(/ALLOW_PRIVILEGED_DB_ROLE/);
    expect(refuseToStart(owner, false)).toBeNull();
    expect(refuseToStart({ ...owner, privileged: false, hardened: true, problems: [] }, true)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// #2 y #3 Permisos del rol de ejecución (con el rol real)
// ---------------------------------------------------------------------------
const APP_URL = process.env.TEST_APP_DATABASE_URL;
describe.skipIf(!APP_URL)('#2 / #3 rol de ejecución de la app', () => {
  let app: pg.Pool;
  beforeAll(async () => {
    const owner = new pg.Pool({ connectionString: TEST_DATABASE_URL, max: 1 });
    await applyAppRolePrivileges(owner, new URL(APP_URL!).username);
    await owner.end();
    app = new pg.Pool({ connectionString: APP_URL, max: 2 });
  });
  afterAll(async () => app?.end());

  async function orgWithRecords() {
    const { client, base, org, user } = await setupOwner(ctx);
    const fridge = await firstEquipment(ctx, org.id, 'camara');
    for (let i = 0; i < 3; i++) await client.post(`${base}/records`, { type: 'temperatura', data: { equipmentId: fridge.id, value: 2 } });
    return { client, base, org, user, fridge };
  }
  const count = async (orgId: string) => Number((await sql<{ n: string }>`SELECT count(*) AS n FROM records WHERE organization_id = ${orgId}`.execute(ctx.deps.db)).rows[0]!.n);

  it('#2 no puede borrar un local (ni sus registros en cascada) ni ejecutar la purga (N1: solo el mantenimiento)', async () => {
    const { org } = await orgWithRecords();
    await expect(app.query('DELETE FROM organizations WHERE id = $1', [org.id])).rejects.toThrow(/permission denied/);
    for (const t of ['devices', 'staff', 'equipment', 'cleaning_plans']) {
      await expect(app.query(`DELETE FROM ${t} WHERE organization_id = $1`, [org.id])).rejects.toThrow(/permission denied/);
    }
    await expect(app.query('SELECT enregla_purge_organization($1) AS ok', [org.id])).rejects.toThrow(/permission denied/);
    await expect(app.query('SELECT enregla_purge_due_organizations()')).rejects.toThrow(/permission denied/);
    // Ni adelantar el plazo (N1 c).
    await expect(app.query("UPDATE organizations SET deletion_requested_at = now(), deletion_scheduled_at = now() - interval '1 minute' WHERE id = $1", [org.id])).rejects.toThrow();
    expect(await count(org.id)).toBe(3);
  });

  it('#3 la hora y el orden de un registro los pone PostgreSQL; auditoría e historial no se reescriben', async () => {
    const { org, fridge, user } = await orgWithRecords();
    // 0012: el autor tiene que ser un miembro real del local.
    const r = await app.query(
      `INSERT INTO records (organization_id, type, data, user_id, user_name, equipment_id, created_at, seq)
       VALUES ($1, 'temperatura', '{"value": 2}', $3, 'x', $2, now() - interval '10 days', 1) RETURNING created_at, effective_at, seq`,
      [org.id, fridge.id, user.id],
    ).catch((e: Error) => e);
    if (r instanceof Error) {
      // Sin permiso sobre seq también vale: no puede fijar el orden.
      expect(r.message).toMatch(/permission denied|cannot insert/);
    } else {
      const row = r.rows[0] as { created_at: Date; effective_at: Date; seq: string };
      expect(Date.now() - row.created_at.getTime()).toBeLessThan(60_000);
      expect(row.effective_at.getTime()).toBe(row.created_at.getTime());
      expect(Number(row.seq)).toBeGreaterThan(3);
    }
    await expect(app.query("UPDATE audit_events SET event = 'x'")).rejects.toThrow(/permission denied/);
    await expect(app.query('DELETE FROM audit_events')).rejects.toThrow(/permission denied/);
    for (const t of ['equipment_config_history', 'cleaning_plan_config_history']) {
      await expect(app.query(`UPDATE ${t} SET active = active`)).rejects.toThrow(/permission denied/);
      await expect(app.query(`DELETE FROM ${t}`)).rejects.toThrow(/permission denied/);
    }
    // Pero la app sigue manteniendo el historial (trigger del propietario) y sus funciones acotadas.
    await app.query('UPDATE equipment SET checks_per_day = 3 WHERE id = $1', [fridge.id]);
    const hist = await sql<{ n: string }>`SELECT count(*) AS n FROM equipment_config_history WHERE equipment_id = ${fridge.id}`.execute(ctx.deps.db);
    expect(Number(hist.rows[0]!.n)).toBeGreaterThan(1);
    await app.query('SELECT enregla_pseudonymize_audit(gen_random_uuid(), $1)', ['nadie@example.com']);
    // N3: la purga de auditoría es del mantenimiento.
    await expect(app.query('SELECT enregla_purge_audit_events(12) AS n')).rejects.toThrow(/permission denied/);
  });
});

describe('#2 purga del local por la API: solo con el plazo vencido o la petición del titular', () => {
  it('eliminación inmediata del titular y purga diaria siguen funcionando (mediante la función)', async () => {
    const { client, base, org } = await setupOwner(ctx);
    const fridge = await firstEquipment(ctx, org.id, 'camara');
    await client.post(`${base}/records`, { type: 'temperatura', data: { equipmentId: fridge.id, value: 2 } });
    expect((await client.delete(`${base}`, { password: 'Cocina-Segura-2026' })).statusCode).toBe(204);
    // N1: la app solo marca la petición (202); purga el mantenimiento con el rol propietario.
    expect((await client.delete(`${base}/permanent`, { password: 'Cocina-Segura-2026' })).statusCode).toBe(202);
    expect(await ctx.deps.db.selectFrom('organizations').select('id').where('id', '=', org.id).executeTakeFirst()).toBeDefined();
    expect((await runMaintenance(ctx.deps.db, { auditMonths: 12 })).organizations).toMatchObject({ purged: 1 });
    expect(await ctx.deps.db.selectFrom('organizations').select('id').where('id', '=', org.id).executeTakeFirst()).toBeUndefined();
    // Plazo vencido: la tarea de la app deja la facturación lista y el mantenimiento purga.
    const other = await setupOwner(ctx, 'otro@example.com');
    await ctx.deps.db.updateTable('organizations').set({ deletion_scheduled_at: new Date(Date.now() - 60_000) }).where('id', '=', other.org.id).execute();
    const r = await runRetention(ctx.deps, { force: true });
    expect(r.organizations).toBe(1);
    expect((await runMaintenance(ctx.deps.db, { auditMonths: 12 })).organizations).toMatchObject({ purged: 1 });
    // Restaurar borra la petición de eliminación inmediata anterior.
    const third = await setupOwner(ctx, 'tercero@example.com');
    await ctx.deps.db.updateTable('organizations').set({ purge_requested_at: new Date(), deletion_scheduled_at: new Date(Date.now() + 86_400_000) }).where('id', '=', third.org.id).execute();
    expect((await third.client.post(`${third.base}/restore`)).statusCode).toBe(200);
    const row = await ctx.deps.db.selectFrom('organizations').select('purge_requested_at').where('id', '=', third.org.id).executeTakeFirstOrThrow();
    expect(row.purge_requested_at).toBeNull();
  });
  it('la seudonimización de la auditoría sigue funcionando por la función acotada', async () => {
    const { user, org } = await setupOwner(ctx);
    await ctx.deps.db.insertInto('audit_events').values({ event: 'auth.login', user_id: user.id, organization_id: org.id, ip: '1.2.3.4', metadata: JSON.stringify({ email: 'owner@example.com' }) }).execute();
    // N3: solo de cuentas YA borradas.
    await expect(pseudonymizeUserAudit(ctx.deps.db, user.id, 'owner@example.com')).rejects.toThrow(/ya borrada/);
    await ctx.deps.db.deleteFrom('users').where('id', '=', user.id).execute();
    await pseudonymizeUserAudit(ctx.deps.db, user.id, 'owner@example.com');
    const ev = await ctx.deps.db.selectFrom('audit_events').select(['ip', 'metadata']).where('user_id', '=', user.id).where('event', '=', 'auth.login').executeTakeFirstOrThrow();
    expect(ev.ip).toBeNull();
    expect(ev.metadata).not.toHaveProperty('email');
  });
});

// ---------------------------------------------------------------------------
// #4 / #5 / #6 Recepción
// ---------------------------------------------------------------------------
describe('#4 / #5 / #6 recepción', () => {
  it('#4 / N9 sin categoría no se acepta (web y tablet), aunque traiga una máxima o la acción correctora', async () => {
    const { client, base, k, org } = await setupKiosk();
    const st = await createStaff(ctx, org.id, 'Jonathan');
    for (const data of [{ temperature: 9 }, { temperature: 9, correctiveAction: 'x' }, { temperature: 15, maxTemperature: 50 }, {}]) {
      const web = await client.post(`${base}/records`, rec(data));
      expect(web.statusCode).toBe(400);
      expect(json(web).error.details.map((d: { path: string }) => d.path)).toContain('data.category');
    }
    const kiosk = await k('POST', '/api/kiosk/records', { staffId: st.id, ...rec({ temperature: 6 }) });
    expect(kiosk.statusCode).toBe(400);
    expect(json(kiosk).error.details.map((d: { path: string }) => d.path)).toContain('data.category');
  });

  it('#5 el límite no se edita al recibir: el de la petición se ignora; el propio del proveedor sí cuenta (dentro de un margen) y se marca', async () => {
    const { client, base } = await setupOwner(ctx);
    expect((await client.post(`${base}/records`, rec({ category: 'refrigerado', maxTemperature: 50, temperature: 15 }))).statusCode).toBe(400);
    expect((await client.post(`${base}/records`, rec({ category: 'congelado', maxTemperature: 10, temperature: -2 }))).statusCode).toBe(400);
    // Proveedor con un límite propio dentro del margen (refrigerado: 0–8 °C).
    expect((await client.post(`${base}/suppliers`, { name: 'Laxo', defaultCategory: 'refrigerado', receptionLimit: 50 })).statusCode).toBe(400);
    expect((await client.post(`${base}/suppliers`, { name: 'Sin tipo', receptionLimit: 5 })).statusCode).toBe(400);
    const sup = json(await client.post(`${base}/suppliers`, { name: 'Lácteos', defaultCategory: 'refrigerado', receptionLimit: 6 })).supplier;
    expect(sup).toMatchObject({ defaultCategory: 'refrigerado', receptionLimit: 6 });
    const ok = json(await client.post(`${base}/records`, { type: 'recepcion', data: { supplierId: sup.id, product: 'Nata', accepted: true, category: 'refrigerado', temperature: 5 } })).record;
    expect(ok).toMatchObject({ alert: false, data: { maxTemperature: 6, limitSource: 'proveedor', limitDiffersFromReference: true } });
    // Si cambia la categoría del proveedor, su límite propio anterior deja de valer.
    expect(json(await client.patch(`${base}/suppliers/${sup.id}`, { defaultCategory: 'congelado' })).supplier.receptionLimit).toBeNull();
    const csv = (await client.get(`${base}/reports/csv?from=${FIXED_TODAY}&to=${FIXED_TODAY}`)).body;
    expect(csv).toContain('"limite_del_proveedor"');
  });

  it('#6 refrigerado, congelado o caliente no se aceptan sin temperatura (ambiente sí)', async () => {
    const { client, base } = await setupOwner(ctx);
    for (const category of ['refrigerado', 'congelado', 'caliente']) {
      const r = await client.post(`${base}/records`, rec({ category }));
      expect(r.statusCode, category).toBe(400);
      expect(json(r).error.details[0].path).toBe('data.temperature');
    }
    expect((await client.post(`${base}/records`, rec({ category: 'ambiente' }))).statusCode).toBe(201);
    // Rechazada sin medir: se permite (el motivo es obligatorio).
    expect((await client.post(`${base}/records`, rec({ category: 'refrigerado', accepted: false, rejectionReason: 'Envase roto' }))).statusCode).toBe(201);
  });
});

// ---------------------------------------------------------------------------
// #7 Reintento idempotente de una corrección en la tablet
// ---------------------------------------------------------------------------
describe('#7 idempotencia de la corrección en la tablet', () => {
  it('el reintento con la misma clave devuelve 200 con la misma corrección (también pasado el plazo)', async () => {
    const { k, org } = await setupKiosk();
    const luis = await createStaff(ctx, org.id, 'Luis Pérez');
    const fridge = await firstEquipment(ctx, org.id, 'camara');
    const orig = json(await k('POST', '/api/kiosk/records', { staffId: luis.id, type: 'temperatura', data: { equipmentId: fridge.id, value: 2 } })).record;
    const key = { 'idempotency-key': '0b6c3c1e-7d9b-4c1e-9f6a-2a1b3c4d5e6f' };
    const body = { staffId: luis.id, reason: 'wrong_value', data: { equipmentId: fridge.id, value: 3 } };
    const first = await k('POST', `/api/kiosk/records/${orig.id}/amendments`, body, key);
    expect(first.statusCode).toBe(201);
    const again = await k('POST', `/api/kiosk/records/${orig.id}/amendments`, body, key);
    expect(again.statusCode).toBe(200);
    expect(json(again).record.id).toBe(json(first).record.id);
    nowMs += 10 * 60_000;
    expect((await k('POST', `/api/kiosk/records/${orig.id}/amendments`, body, key)).statusCode).toBe(200);
    // Sin la clave sigue siendo 409 (ya corregido).
    nowMs -= 10 * 60_000;
    expect((await k('POST', `/api/kiosk/records/${orig.id}/amendments`, body)).statusCode).toBe(409);
  });
});

// ---------------------------------------------------------------------------
// #8 «anotado por» también en las correcciones web
// ---------------------------------------------------------------------------
describe('#8 firma de las correcciones web', () => {
  it('una corrección web con una empleada sale «Marta Gil (anotado por Laura Gil)» y corrige Laura', async () => {
    const { client, base, org, k } = await setupKiosk();
    const ana = await createStaff(ctx, org.id, 'Ana Martín', '1234');
    const marta = await createStaff(ctx, org.id, 'Marta Gil', '5678');
    const fridge = await firstEquipment(ctx, org.id, 'camara');
    const orig = json(await k('POST', '/api/kiosk/records', { staffId: ana.id, pin: '1234', type: 'temperatura', data: { equipmentId: fridge.id, value: 2 } })).record;
    const keep = json(await client.post(`${base}/records/${orig.id}/amendments`, { reason: 'Ajuste', data: { equipmentId: fridge.id, value: 2.5 } })).record;
    expect(keep.signature).toBe('Ana Martín (anotado por Laura Gil)');
    const changed = json(await client.post(`${base}/records/${keep.id}/amendments`, { reason: 'Lo hizo Marta', staffId: marta.id, data: { equipmentId: fridge.id, value: 2.5 } })).record;
    expect(changed).toMatchObject({ signature: 'Marta Gil (anotado por Laura Gil)', correctedBy: 'Laura Gil' });
    // Desde la tablet (con su PIN) sigue sin «anotado por».
    expect(orig.signature).toBe('Ana Martín');
  });
});

// ---------------------------------------------------------------------------
// #10 Salir / desvincular: un tercero no bloquea al encargado
// ---------------------------------------------------------------------------
describe('#10 límites de salir / desvincular', () => {
  it('los fallos con un email no bloquean a otra cuenta, y los aciertos no cuentan', async () => {
    const { k, org } = await setupKiosk();
    const { user: mgr } = await addMember(ctx, org.id, 'encargada@example.com', 'manager');
    for (let i = 0; i < 10; i++) expect((await k('POST', '/api/kiosk/exit', { email: 'laura@example.com', password: `mal-${i}` })).statusCode).toBe(401);
    // Esa cuenta en esta tablet queda bloqueada…
    expect((await k('POST', '/api/kiosk/exit', { email: 'laura@example.com', password: 'Cocina-Segura-2026' })).statusCode).toBe(429);
    // …pero la encargada sigue pudiendo salir, muchas veces (los aciertos no cuentan).
    for (let i = 0; i < 12; i++) expect((await k('POST', '/api/kiosk/exit', { email: mgr.email, password: 'Cocina-Segura-2026' })).statusCode).toBe(200);
    // Límite por tablet (muchos emails distintos).
    let last = 0;
    for (let i = 0; i < 25; i++) last = (await k('POST', '/api/kiosk/exit', { email: `x${i}@example.com`, password: 'mal' })).statusCode;
    expect(last).toBe(429);
  });
});

// ---------------------------------------------------------------------------
// #12 y #14
// ---------------------------------------------------------------------------
describe('#12 / #14 PDF y remedición', () => {
  it('#12 la frase del PDF describe la eliminación inmediata tal como la hace el titular', () => {
    expect(pdfIntegrityNote(30)).toContain('su titular también puede pedir su eliminación inmediata tras marcarlo para eliminación, y entonces se eliminará en la próxima hora');
    expect(pdfIntegrityNote(30)).not.toContain('pedir la eliminación inmediata');
  });

  it('#14 «Repetiré la medición en 30 min» fija desde cuándo toca volver a medir; el PDF marca «Hecho con alerta»', async () => {
    const { client, base, org } = await setupOwner(ctx);
    const freezer = await firstEquipment(ctx, org.id, 'congelador');
    const r = json(await client.post(`${base}/records`, { type: 'temperatura', data: { equipmentId: freezer.id, value: -10, correctiveAction: 'Puerta cerrada y revisada; Repetiré la medición en 30 min' } })).record;
    const t = json(await client.get(`${base}/tasks/today`)).temperatures.find((x: { equipmentId: string }) => x.equipmentId === freezer.id);
    expect(t.remeasure).toBe(true);
    expect(new Date(t.remeasureFrom).getTime()).toBe(new Date(r.effectiveAt).getTime() + 30 * 60_000);
    // Sin esa acción no hay hora: se puede volver a medir ya.
    await client.post(`${base}/records`, { type: 'temperatura', data: { equipmentId: freezer.id, value: -9, correctiveAction: 'Avisado el servicio técnico' } });
    expect(json(await client.get(`${base}/tasks/today`)).temperatures.find((x: { equipmentId: string }) => x.equipmentId === freezer.id).remeasureFrom).toBeNull();
    const { formatRow } = await import('../src/modules/reports/format.js');
    const row = await ctx.deps.db.selectFrom('records').selectAll().where('id', '=', r.id).executeTakeFirstOrThrow();
    expect(formatRow('temperatura', { ...row, amended_by: null }, 'Europe/Madrid').join(' ')).toContain('Hecho con alerta');
    expect(testConfig()).toBeTruthy();
  });
});
