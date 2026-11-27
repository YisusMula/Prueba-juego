/**
 * Segunda evaluación de la fase 1 (N1–N9). Las comprobaciones de permisos usan el ROL REAL de la app
 * si se define `TEST_APP_DATABASE_URL` (p. ej. postgres://enregla_app:…@localhost:5499/enregla_test, con
 * `TEST_DATABASE_URL` apuntando al propietario de esa misma base); sin ella se saltan.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import pg from 'pg';
import { sql } from 'kysely';
import type { LightMyRequestResponse } from 'fastify';
import { addMember, closeTestApp, createStaff, createTestApp, firstEquipment, json, PASSWORD, resetDb, setupOwner, testConfig, type TestCtx } from './helpers.js';
import { TEST_DATABASE_URL } from './global-setup.js';
import { applyAppRolePrivileges, recordsHardeningStatus, refuseToStart } from '../src/db/privileges.js';
import { runMaintenance } from '../src/modules/maintenance/run.js';
import { formatRow, type ReportRecord } from '../src/modules/reports/format.js';
import { pdfIntegrityNote } from '../src/modules/reports/pdf.js';

let ctx: TestCtx;
beforeAll(async () => {
  ctx = await createTestApp();
});
afterAll(async () => closeTestApp(ctx));
beforeEach(async () => resetDb(ctx));

const audits = async (event: string) => ctx.deps.db.selectFrom('audit_events').selectAll().where('event', '=', event).orderBy('id').execute();
const orgExists = async (id: string) => !!(await ctx.deps.db.selectFrom('organizations').select('id').where('id', '=', id).executeTakeFirst());
const recordCount = async (id: string) => Number((await sql<{ n: string }>`SELECT count(*) AS n FROM records WHERE organization_id = ${id}`.execute(ctx.deps.db)).rows[0]!.n);

async function pendingOrg(email: string) {
  const o = await setupOwner(ctx, email);
  const fridge = await firstEquipment(ctx, o.org.id, 'camara');
  for (let i = 0; i < 2; i++) await o.client.post(`${o.base}/records`, { type: 'temperatura', data: { equipmentId: fridge.id, value: 2 } });
  expect((await o.client.delete(o.base, { password: PASSWORD })).statusCode).toBe(204);
  return o;
}

// ---------------------------------------------------------------------------
// N1 La eliminación inmediata la ejecuta el mantenimiento; todo queda auditado; salvaguarda diaria
// ---------------------------------------------------------------------------
describe('N1 eliminación inmediata y purga por el mantenimiento', () => {
  it('(a) la app solo marca la petición (202, «en la próxima hora»); la purga la hace el mantenimiento y la audita', async () => {
    const o = await pendingOrg('a@example.com');
    const r = await o.client.delete(`${o.base}/permanent`, { password: PASSWORD });
    expect(r.statusCode).toBe(202);
    expect(json(r).message).toBe('Eliminación confirmada: el local y todos sus registros se borrarán definitivamente en la próxima hora.');
    expect(await orgExists(o.org.id)).toBe(true);
    expect(await recordCount(o.org.id)).toBe(2);
    expect(json(await o.client.get(o.base)).organization.purgeRequestedAt).toBe(json(r).purgeRequestedAt);
    expect(await audits('org.purge_requested')).toHaveLength(1);
    const m = await runMaintenance(ctx.deps.db, { auditMonths: 12 });
    expect(m.organizations).toMatchObject({ due: 1, purged: 1, skipped: 0, blocked: false });
    expect(await orgExists(o.org.id)).toBe(false);
    expect(await recordCount(o.org.id)).toBe(0);
    const [purged] = await audits('org.purged');
    expect(purged).toMatchObject({ organization_id: o.org.id, user_id: o.user.id });
    expect(purged!.metadata).toMatchObject({ reason: 'eliminacion_inmediata_del_titular', records: 2, name: o.org.name });
  });

  it('(b) la base de datos audita cada cambio de deletion_* / purge_requested_at y cada acceso retirado, con session_user', async () => {
    const o = await pendingOrg('b@example.com');
    const { user: m } = await addMember(ctx, o.org.id, 'm@example.com', 'manager');
    // Un cambio hecho directamente en SQL (sin pasar por la app) también queda registrado.
    await sql`UPDATE organizations SET purge_requested_at = now() WHERE id = ${o.org.id}`.execute(ctx.deps.db);
    const changes = await audits('db.org_deletion_changed');
    expect(changes.length).toBeGreaterThanOrEqual(2);
    const last = changes[changes.length - 1]!.metadata as Record<string, unknown>;
    expect(last.session_user).toBeTypeOf('string');
    expect(last).toHaveProperty('old');
    expect(last).toHaveProperty('new');
    await sql`DELETE FROM memberships WHERE organization_id = ${o.org.id} AND user_id = ${m.id}`.execute(ctx.deps.db);
    const del = await audits('db.membership_deleted');
    expect(del).toHaveLength(1);
    expect(del[0]).toMatchObject({ organization_id: o.org.id, user_id: m.id });
    expect(del[0]!.metadata).toMatchObject({ role: 'manager' });
  });

  it('(d) salvaguarda: si en 24 h se purgarían más de max_purges_per_day, no purga NINGUNO, lo audita y avisa en el log', async () => {
    const orgs = [];
    for (const e of ['1', '2', '3', '4']) orgs.push(await pendingOrg(`s${e}@example.com`));
    for (const o of orgs) expect((await o.client.delete(`${o.base}/permanent`, { password: PASSWORD })).statusCode).toBe(202);
    const errors: string[] = [];
    const log = { info: () => undefined, error: (_o: object, msg: string) => void errors.push(msg) };
    const m = await runMaintenance(ctx.deps.db, { auditMonths: 12, log });
    expect(m.organizations).toMatchObject({ due: 4, purged: 0, blocked: true, max_per_day: 3 });
    for (const o of orgs) expect(await orgExists(o.org.id)).toBe(true);
    expect(await audits('maintenance.purge_blocked')).toHaveLength(1);
    expect(errors.join()).toMatch(/PURGA BLOQUEADA/);
    // Con tres sí (y la cuarta espera: ya van tres en 24 h).
    await sql`UPDATE organizations SET purge_requested_at = NULL WHERE id = ${orgs[3]!.org.id}`.execute(ctx.deps.db);
    expect((await runMaintenance(ctx.deps.db, { auditMonths: 12, log })).organizations).toMatchObject({ purged: 3, blocked: false });
    await sql`UPDATE organizations SET purge_requested_at = now() WHERE id = ${orgs[3]!.org.id}`.execute(ctx.deps.db);
    expect((await runMaintenance(ctx.deps.db, { auditMonths: 12, log })).organizations).toMatchObject({ purged: 0, blocked: true, purged_last_24h: 3 });
    expect(await orgExists(orgs[3]!.org.id)).toBe(true);
  });

  it('el PDF dice exactamente cuándo se elimina tras la petición inmediata', () => {
    expect(pdfIntegrityNote(30)).toContain('su titular también puede pedir su eliminación inmediata tras marcarlo para eliminación, y entonces se eliminará en la próxima hora');
  });
});

// ---------------------------------------------------------------------------
// N2 search_path fijo en las funciones de triggers y SECURITY DEFINER
// ---------------------------------------------------------------------------
describe('N2 funciones con search_path fijo', () => {
  it('todas las funciones SECURITY DEFINER y de trigger de public fijan search_path = pg_catalog, public, pg_temp', async () => {
    const r = await sql<{ name: string; config: string[] | null }>`
      SELECT p.proname AS name, p.proconfig AS config FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND (p.prosecdef OR p.prorettype = 'pg_catalog.trigger'::pg_catalog.regtype)`.execute(ctx.deps.db);
    expect(r.rows.length).toBeGreaterThan(8);
    const bad = r.rows.filter((f) => !(f.config ?? []).includes('search_path=pg_catalog, public, pg_temp')).map((f) => f.name);
    expect(bad).toEqual([]);
  });
  it('PUBLIC no puede crear tablas temporales en la base de datos', async () => {
    const r = await sql<{ ok: boolean }>`SELECT pg_catalog.has_database_privilege('public', pg_catalog.current_database(), 'TEMPORARY') AS ok`.execute(ctx.deps.db).catch(() => null);
    // has_database_privilege('public', …) consulta el rol PUBLIC.
    if (r) expect(r.rows[0]!.ok).toBe(false);
    const acl = await sql<{ acl: string | null }>`SELECT datacl::text AS acl FROM pg_database WHERE datname = current_database()`.execute(ctx.deps.db);
    expect(acl.rows[0]!.acl ?? '').not.toMatch(/(^|[{,])=[^,}]*T/);
  });
});

// ---------------------------------------------------------------------------
// N3 Auditoría: mínimo de 12 meses y seudonimización solo de cuentas borradas
// ---------------------------------------------------------------------------
describe('N3 retención mínima de la auditoría', () => {
  it('aunque se pida 1 mes, la base de datos conserva 12; solo se seudonimiza a quien ya no existe', async () => {
    await sql`INSERT INTO audit_events (event, created_at) VALUES ('auth.login', now() - interval '6 months'), ('auth.login', now() - interval '13 months')`.execute(ctx.deps.db);
    expect((await runMaintenance(ctx.deps.db, { auditMonths: 1 })).auditEvents).toBe(1);
    expect(await audits('auth.login')).toHaveLength(1);
    const o = await setupOwner(ctx, 'vivo@example.com');
    await expect(sql`SELECT enregla_pseudonymize_audit(${o.user.id}::uuid, 'vivo@example.com')`.execute(ctx.deps.db)).rejects.toThrow(/ya borrada/);
  });
});

// ---------------------------------------------------------------------------
// N5 Límite de PIN por tablet: solo cuentan los fallos
// ---------------------------------------------------------------------------
describe('N5 PIN en la tablet', () => {
  it('muchas operaciones con el PIN correcto no bloquean la tablet', async () => {
    const tight = await createTestApp({ config: { rateLimits: { ...testConfig().rateLimits, pinFailDevice: { limit: 3, windowSeconds: 900 } } } });
    try {
      await resetDb(tight);
      const owner = await setupOwner(tight, 'k@example.com');
      const dev = json(await owner.client.post(`${owner.base}/devices`, { name: 'Tablet' }));
      const k = (url: string, payload: object): Promise<LightMyRequestResponse> =>
        tight.app.inject({ method: 'POST', url, headers: { authorization: `Bearer ${dev.token}` }, payload });
      const ana = await createStaff(tight, owner.org.id, 'Ana', '1234');
      for (let i = 0; i < 40; i++) {
        const r = i % 2 ? await k('/api/kiosk/verify-pin', { staffId: ana.id, pin: '1234' }) : await k('/api/kiosk/records', { staffId: ana.id, pin: '1234', type: 'plagas', data: { result: 'sin_indicios' } });
        expect(r.statusCode).toBeLessThan(300);
      }
      // Tres fallos (de cualquiera) agotan el cupo de fallos de la tablet: el siguiente fallo es 429...
      const luis = await createStaff(tight, owner.org.id, 'Luis', '5555');
      for (let i = 0; i < 3; i++) expect(json(await k('/api/kiosk/verify-pin', { staffId: luis.id, pin: '0000' })).error.code).toBe('INVALID_PIN');
      expect((await k('/api/kiosk/verify-pin', { staffId: ana.id, pin: '0000' })).statusCode).toBe(429);
      // ...pero quien acierta sigue entrando.
      expect((await k('/api/kiosk/verify-pin', { staffId: ana.id, pin: '1234' })).statusCode).toBe(200);
    } finally {
      await closeTestApp(tight);
    }
  });
});

// ---------------------------------------------------------------------------
// N6 Arranque en producción
// ---------------------------------------------------------------------------
describe('N6 la app no arranca en producción con cualquier problema de permisos', () => {
  it('basta un problema (no solo superusuario o propietario) para negarse', () => {
    const h = { role: 'evil_app', hardened: false, problems: ['puede ejecutar la purga de locales'], privileged: false };
    expect(refuseToStart(h, true, false)).toMatch(/purga/);
    expect(refuseToStart(h, true, true)).toBeNull();
    expect(refuseToStart(h, false, false)).toBeNull();
    expect(refuseToStart({ ...h, hardened: true, problems: [] }, true, false)).toBeNull();
  });
  it('el propietario (o un superusuario) se detecta como privilegiado', async () => {
    const h = await recordsHardeningStatus(new pg.Pool({ connectionString: TEST_DATABASE_URL, max: 1 }));
    expect(h.privileged).toBe(true);
    expect(h.hardened).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// N9 Recepción: «ambiente» frente a la categoría habitual del proveedor
// ---------------------------------------------------------------------------
describe('N9 recepción', () => {
  it('«ambiente» para un proveedor de refrigerado exige motivo, se guarda y el PDF lo señala', async () => {
    const o = await setupOwner(ctx, 'r@example.com');
    const sup = json(await o.client.post(`${o.base}/suppliers`, { name: 'Frío SL', defaultCategory: 'refrigerado' })).supplier;
    const base = { supplierId: sup.id, product: 'Conservas', accepted: true, category: 'ambiente' };
    const bad = await o.client.post(`${o.base}/records`, { type: 'recepcion', data: base });
    expect(bad.statusCode).toBe(400);
    expect(json(bad).error.details[0]).toMatchObject({ path: 'data.categoryReason', message: expect.stringMatching(/suele traer producto refrigerado/) });
    const ok = json(await o.client.post(`${o.base}/records`, { type: 'recepcion', data: { ...base, categoryReason: 'Hoy trae latas' } })).record;
    expect(ok.data).toMatchObject({ category: 'ambiente', categoryDiffersFromSupplier: true, categoryReason: 'Hoy trae latas' });
    const row = formatRow('recepcion', { ...ok, data: ok.data, effective_at: new Date(), created_at: new Date() } as unknown as ReportRecord, 'Europe/Madrid');
    expect(row[4]).toContain('el proveedor suele ser otro tipo; motivo: Hoy trae latas');
    expect(row[4]).toMatch(/^Sin medir/);
    // Con un proveedor de ambiente (o sin categoría habitual) no hace falta motivo.
    const amb = json(await o.client.post(`${o.base}/suppliers`, { name: 'Secos', defaultCategory: 'ambiente' })).supplier;
    expect((await o.client.post(`${o.base}/records`, { type: 'recepcion', data: { ...base, supplierId: amb.id } })).statusCode).toBe(201);
  });
});

// ---------------------------------------------------------------------------
// Con el rol REAL de la app (N1 c, N2, N3, N6, N7)
// ---------------------------------------------------------------------------
const APP_URL = process.env.TEST_APP_DATABASE_URL;
describe.skipIf(!APP_URL)('rol real de la app (segunda evaluación)', () => {
  let app: pg.Pool;
  beforeAll(async () => {
    const owner = new pg.Pool({ connectionString: TEST_DATABASE_URL, max: 1 });
    await applyAppRolePrivileges(owner, new URL(APP_URL!).username);
    await owner.end();
    app = new pg.Pool({ connectionString: APP_URL, max: 2 });
  });
  afterAll(async () => app?.end());

  it('N1 (a/c): no puede purgar ni adelantar el plazo; la petición legítima del titular sí se acepta y queda auditada', async () => {
    const o = await setupOwner(ctx, 'c@example.com');
    const fridge = await firstEquipment(ctx, o.org.id, 'camara');
    await o.client.post(`${o.base}/records`, { type: 'temperatura', data: { equipmentId: fridge.id, value: 2 } });
    await expect(app.query('SELECT enregla_purge_organization($1)', [o.org.id])).rejects.toThrow(/permission denied/);
    await expect(app.query('SELECT enregla_purge_due_organizations()')).rejects.toThrow(/permission denied/);
    // Plazo en el pasado, petición con fecha atrasada o plazo más corto que el mínimo: rechazados.
    await expect(app.query("UPDATE organizations SET deletion_requested_at = now(), deletion_scheduled_at = now() - interval '1 second' WHERE id = $1", [o.org.id])).rejects.toThrow();
    await expect(app.query("UPDATE organizations SET deletion_requested_at = now() - interval '40 days', deletion_scheduled_at = now() - interval '10 days' WHERE id = $1", [o.org.id])).rejects.toThrow();
    await expect(app.query("UPDATE organizations SET deletion_requested_at = now(), deletion_scheduled_at = now() + interval '1 day' WHERE id = $1", [o.org.id])).rejects.toThrow();
    // Ni marcar el motivo de bloqueo de la purga.
    await expect(app.query("UPDATE organizations SET purge_blocked_reason = 'x' WHERE id = $1", [o.org.id])).rejects.toThrow();
    // Ni borrar miembros o cuentas directamente para provocar purgas.
    await expect(app.query('DELETE FROM organizations WHERE id = $1', [o.org.id])).rejects.toThrow(/permission denied/);
    // Lo legítimo (lo que hace la app): pendiente con el plazo completo y petición inmediata ahora.
    await app.query("UPDATE organizations SET deletion_requested_at = now(), deletion_scheduled_at = now() + interval '30 days', purge_requested_at = now() WHERE id = $1", [o.org.id]);
    const ch = await audits('db.org_deletion_changed');
    expect(ch[ch.length - 1]!.metadata).toMatchObject({ session_user: new URL(APP_URL!).username });
    expect(await recordCount(o.org.id)).toBe(1);
  });

  it('N2: no puede crear tablas temporales (no puede suplantar funciones con pg_temp)', async () => {
    await expect(app.query('CREATE TEMP TABLE t (x int)')).rejects.toThrow(/permission denied/);
  });

  it('N3: la hora de la auditoría la pone la base de datos; no purga la auditoría', async () => {
    const r = await app.query("INSERT INTO audit_events (event, created_at) VALUES ('auth.login', now() - interval '3 years') RETURNING created_at");
    expect(Date.now() - (r.rows[0].created_at as Date).getTime()).toBeLessThan(60_000);
    await expect(app.query('SELECT enregla_purge_audit_events(12)')).rejects.toThrow(/permission denied/);
    await expect(app.query("UPDATE enregla_owner_settings SET value = '0' WHERE key = 'audit_min_months'")).rejects.toThrow(/permission denied/);
  });

  it('N6: el rol de la app está endurecido (sin purga ni temporales)', async () => {
    const h = await recordsHardeningStatus(app);
    expect(h).toMatchObject({ hardened: true, privileged: false, problems: [] });
  });

  it.skipIf(!process.env.TEST_ADMIN_DATABASE_URL)('N6: un rol MIEMBRO del propietario se detecta (pg_has_role) y en producción no arranca', async () => {
    const admin = new pg.Client({ connectionString: process.env.TEST_ADMIN_DATABASE_URL });
    await admin.connect();
    const owner = (await admin.query("SELECT tableowner FROM pg_tables WHERE schemaname = 'public' AND tablename = 'records'")).rows[0].tableowner as string;
    await admin.query('DROP ROLE IF EXISTS enregla_evil_test');
    await admin.query(`CREATE ROLE enregla_evil_test LOGIN PASSWORD 'x' IN ROLE ${owner}`);
    const url = new URL(APP_URL!);
    url.username = 'enregla_evil_test';
    url.password = 'x';
    const evil = new pg.Pool({ connectionString: url.toString(), max: 1 });
    try {
      const h = await recordsHardeningStatus(evil);
      expect(h).toMatchObject({ privileged: true, hardened: false });
      expect(h.problems.join()).toMatch(/propietario/);
      expect(refuseToStart(h, true, false)).not.toBeNull();
    } finally {
      await evil.end();
      await admin.query('DROP ROLE enregla_evil_test');
      await admin.end();
    }
  });

  it('N7: no puede reescribir created_at de equipos ni planes (movería el historial)', async () => {
    const o = await setupOwner(ctx, 'h@example.com');
    const fridge = await firstEquipment(ctx, o.org.id, 'camara');
    const before = await sql<{ v: Date }>`SELECT min(valid_from) AS v FROM equipment_config_history WHERE equipment_id = ${fridge.id}`.execute(ctx.deps.db);
    await expect(app.query('UPDATE equipment SET created_at = now() WHERE id = $1', [fridge.id])).rejects.toThrow(/permission denied/);
    await expect(app.query('UPDATE cleaning_plans SET created_at = now() WHERE organization_id = $1', [o.org.id])).rejects.toThrow(/permission denied/);
    // Lo que sí edita la app sigue funcionando.
    await app.query('UPDATE equipment SET checks_per_day = 3, updated_at = now() WHERE id = $1', [fridge.id]);
    const after = await sql<{ v: Date }>`SELECT min(valid_from) AS v FROM equipment_config_history WHERE equipment_id = ${fridge.id}`.execute(ctx.deps.db);
    expect(after.rows[0]!.v.getTime()).toBe(before.rows[0]!.v.getTime());
  });
});
