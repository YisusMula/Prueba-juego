/**
 * Tercera evaluación de la fase 1 (R1–R10). Las pruebas con roles reales necesitan
 * `TEST_APP_DATABASE_URL` (rol de la app) y, para la prueba de restauración y los roles creados al
 * vuelo, `TEST_ADMIN_DATABASE_URL` (superusuario del mismo cluster) y `pg_dump`/`pg_restore`/`psql`.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { sql } from 'kysely';
import type { LightMyRequestResponse } from 'fastify';
import { closeTestApp, createStaff, createTestApp, firstEquipment, json, PASSWORD, resetDb, setupOwner, type TestCtx } from './helpers.js';
import { TEST_DATABASE_URL } from './global-setup.js';
import { runMigrations } from '../src/db/migrate.js';
import { APP_FUNCTIONS, BACKUP_HIDDEN_TABLES, OWNER_ONLY_FUNCTIONS, applyAppRolePrivileges, recordsHardeningStatus, refuseToStart } from '../src/db/privileges.js';
import { runMaintenance } from '../src/modules/maintenance/run.js';
import type { BillingProvider } from '../src/modules/billing/provider.js';
import { formatRow, type ReportRecord } from '../src/modules/reports/format.js';

let ctx: TestCtx;
beforeAll(async () => {
  ctx = await createTestApp();
  // Con roles reales, los permisos de la app (los que fija migrate) antes de cualquier prueba.
  if (process.env.TEST_APP_DATABASE_URL) {
    const owner = new pg.Pool({ connectionString: TEST_DATABASE_URL, max: 1 });
    await applyAppRolePrivileges(owner, new URL(process.env.TEST_APP_DATABASE_URL).username);
    await owner.end();
  }
});
afterAll(async () => closeTestApp(ctx));
beforeEach(async () => resetDb(ctx));

const APP_URL = process.env.TEST_APP_DATABASE_URL;
const ADMIN_URL = process.env.TEST_ADMIN_DATABASE_URL;
const audits = async (event: string) => ctx.deps.db.selectFrom('audit_events').selectAll().where('event', '=', event).orderBy('id').execute();
const orgExists = async (id: string) => !!(await ctx.deps.db.selectFrom('organizations').select('id').where('id', '=', id).executeTakeFirst());

async function withKiosk(email: string) {
  const o = await setupOwner(ctx, email);
  const dev = json(await o.client.post(`${o.base}/devices`, { name: 'Tablet' }));
  const k = (method: 'GET' | 'POST', url: string, payload?: object): Promise<LightMyRequestResponse> =>
    ctx.app.inject({ method, url, headers: { authorization: `Bearer ${dev.token}` }, ...(payload ? { payload } : {}) });
  return { ...o, k };
}

// ---------------------------------------------------------------------------
// R2 La hora la pone el reloj, no el inicio de la transacción
// ---------------------------------------------------------------------------
describe('R2 reloj del servidor', () => {
  it('un registro y un evento insertados al final de una transacción larga llevan la hora del INSERT', async () => {
    const o = await setupOwner(ctx, 'r2@example.com');
    const fridge = await firstEquipment(ctx, o.org.id, 'camara');
    const c = new pg.Client({ connectionString: APP_URL ?? TEST_DATABASE_URL });
    await c.connect();
    try {
      await c.query('BEGIN');
      const t0 = (await c.query('SELECT now() AS t')).rows[0].t as Date;
      await new Promise((r) => setTimeout(r, 2_500));
      const rec = (
        await c.query(
          `INSERT INTO records (organization_id, type, data, user_id, user_name, equipment_id)
           VALUES ($1, 'temperatura', $2, gen_random_uuid(), 'x', $3) RETURNING created_at, effective_at`,
          [o.org.id, JSON.stringify({ equipmentId: fridge.id, value: 2 }), fridge.id],
        )
      ).rows[0] as { created_at: Date; effective_at: Date };
      const ev = (await c.query("INSERT INTO audit_events (event) VALUES ('auth.login') RETURNING created_at")).rows[0] as { created_at: Date };
      await c.query('COMMIT');
      expect(rec.created_at.getTime() - t0.getTime()).toBeGreaterThan(2_000);
      expect(rec.effective_at.getTime()).toBe(rec.created_at.getTime());
      expect(ev.created_at.getTime() - t0.getTime()).toBeGreaterThan(2_000);
    } finally {
      await c.end();
    }
  });
});

// ---------------------------------------------------------------------------
// R3 Nada de un local apunta a otro local
// ---------------------------------------------------------------------------
describe('R3 referencias entre locales', () => {
  it('una enmienda, un equipo, un plan, una persona, una tablet o un proveedor de otro local se rechazan en la base de datos', async () => {
    const a = await withKiosk('a3@example.com');
    const b = await setupOwner(ctx, 'b3@example.com');
    const fa = await firstEquipment(ctx, a.org.id, 'camara');
    const fb = await firstEquipment(ctx, b.org.id, 'camara');
    const ra = json(await a.client.post(`${a.base}/records`, { type: 'temperatura', data: { equipmentId: fa.id, value: 2 } })).record;
    // Con el rol de la app si está disponible; si no, con el de las pruebas (las FK valen para todos).
    const db = new pg.Pool({ connectionString: APP_URL ?? TEST_DATABASE_URL, max: 1 });
    const q = (text: string, params: unknown[]) => db.query(text, params);
    const ins = (cols: Record<string, unknown>) => {
      const keys = Object.keys(cols);
      return q(`INSERT INTO records (${keys.join(', ')}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(', ')})`, Object.values(cols));
    };
    const base = { organization_id: b.org.id, type: 'temperatura', user_id: b.user.id, user_name: 'B' };
    try {
      // Enmienda de un registro de A desde B (antes: fecha del 28/10 en B, firmante de A en su CSV y A bloqueado).
      await expect(ins({ ...base, data: JSON.stringify({ equipmentId: fb.id, value: 3 }), equipment_id: fb.id, amends_record_id: ra.id, amendment_reason: 'x' })).rejects.toThrow(/foreign key|mismo local/);
      // Equipo de A en un registro de B.
      await expect(ins({ ...base, data: JSON.stringify({ equipmentId: fa.id, value: 3 }), equipment_id: fa.id })).rejects.toThrow(/foreign key/);
      // JSON que no coincide con la columna.
      await expect(ins({ ...base, data: JSON.stringify({ equipmentId: fa.id, value: 3 }), equipment_id: fb.id })).rejects.toThrow(/no coincide/);
      // Persona y tablet de A.
      const st = await createStaff(ctx, a.org.id, 'Ana A');
      await expect(ins({ ...base, data: JSON.stringify({ equipmentId: fb.id, value: 3 }), equipment_id: fb.id, staff_id: st.id, staff_name: 'Ana A' })).rejects.toThrow(/foreign key/);
      const devA = await ctx.deps.db.selectFrom('devices').select('id').where('organization_id', '=', a.org.id).executeTakeFirstOrThrow();
      await expect(ins({ ...base, data: JSON.stringify({ equipmentId: fb.id, value: 3 }), equipment_id: fb.id, device_id: devA.id })).rejects.toThrow(/foreign key/);
      // Proveedor de A en una recepción de B.
      const supA = json(await a.client.post(`${a.base}/suppliers`, { name: 'Prov A' })).supplier;
      await expect(
        ins({ ...base, type: 'recepcion', data: JSON.stringify({ supplierId: supA.id, supplierName: 'Prov A', product: 'x', category: 'ambiente', accepted: true }) }),
      ).rejects.toThrow(/proveedor/);
      // A sigue pudiendo corregir su registro.
      expect((await a.client.post(`${a.base}/records/${ra.id}/amendments`, { reason: 'Me equivoqué', data: { equipmentId: fa.id, value: 3 } })).statusCode).toBe(201);
    } finally {
      await db.end();
    }
  });
});

// ---------------------------------------------------------------------------
// R4 Purga con credenciales de la app: lo que ya no se puede falsear
// ---------------------------------------------------------------------------
describe('R4 purga y auditoría', () => {
  async function pending(email: string) {
    const o = await setupOwner(ctx, email);
    expect((await o.client.delete(o.base, { password: PASSWORD })).statusCode).toBe(204);
    return o;
  }
  const fakeStripe = (states: Record<string, string | null>) =>
    ({ retrieveSubscription: async (id: string) => (states[id] === undefined || states[id] === null ? null : { status: states[id] }) }) as unknown as BillingProvider;

  it('(b) vaciar stripe_subscription_id no basta: la purga espera a que el mantenimiento compruebe la suscripción en Stripe; y queda auditado', async () => {
    const o = await pending('b4@example.com');
    await sql`UPDATE organizations SET stripe_subscription_id = 'sub_viva', subscription_status = 'active' WHERE id = ${o.org.id}`.execute(ctx.deps.db);
    // «Ataque»: se vacía la suscripción y se pide la eliminación inmediata.
    await sql`UPDATE organizations SET stripe_subscription_id = NULL, subscription_status = 'canceled', purge_requested_at = now(), purge_requested_by = ${o.user.id} WHERE id = ${o.org.id}`.execute(ctx.deps.db);
    const billing = await audits('db.org_billing_changed');
    expect(billing.at(-1)!.metadata).toMatchObject({ old: { stripe_subscription_id: 'sub_viva' }, new: { stripe_subscription_id: null } });
    const errors: string[] = [];
    const log = { info: () => undefined, error: (_o: object, m: string) => void errors.push(m) };
    // Sin Stripe en el mantenimiento: no se purga.
    expect((await runMaintenance(ctx.deps.db, { auditMonths: 12, log })).organizations).toMatchObject({ purged: 0, skipped: 1 });
    expect(errors.join()).toMatch(/no puede comprobar/);
    // Stripe dice que sigue viva: no se purga.
    expect((await runMaintenance(ctx.deps.db, { auditMonths: 12, log, billing: fakeStripe({ sub_viva: 'active' }) })).subscriptions).toMatchObject({ live: 1 });
    expect(await orgExists(o.org.id)).toBe(true);
    const row = await ctx.deps.db.selectFrom('organizations').select('purge_blocked_reason').where('id', '=', o.org.id).executeTakeFirstOrThrow();
    expect(row.purge_blocked_reason).toBe('suscripcion_sin_verificar_en_stripe');
    // Cancelada de verdad en Stripe: se purga.
    const m = await runMaintenance(ctx.deps.db, { auditMonths: 12, log, billing: fakeStripe({ sub_viva: 'canceled' }) });
    expect(m.subscriptions).toMatchObject({ verified: 1 });
    expect(m.organizations).toMatchObject({ purged: 1 });
    expect(await orgExists(o.org.id)).toBe(false);
  });

  it('(c, d) quien pide la eliminación debe ser propietario real; el motivo es neutro y nombra a quien la pidió', async () => {
    const o = await pending('c4@example.com');
    const other = await setupOwner(ctx, 'otro4@example.com');
    const c = new pg.Client({ connectionString: APP_URL ?? TEST_DATABASE_URL });
    await c.connect();
    try {
      if (APP_URL) {
        await expect(c.query('UPDATE organizations SET purge_requested_at = now(), purge_requested_by = $2 WHERE id = $1', [o.org.id, other.user.id])).rejects.toThrow(/propietario/);
        await expect(c.query('UPDATE organizations SET deletion_requested_by = $2 WHERE id = $1', [o.org.id, other.user.id])).rejects.toThrow(/propietario/);
      }
    } finally {
      await c.end();
    }
    expect((await o.client.delete(`${o.base}/permanent`, { password: PASSWORD })).statusCode).toBe(202);
    await runMaintenance(ctx.deps.db, { auditMonths: 12 });
    const [p] = await audits('org.purged');
    expect(p!.metadata).toMatchObject({ reason: 'eliminacion_inmediata_solicitada', purge_requested_by: o.user.id, deletion_requested_by: o.user.id });
    expect(JSON.stringify(p!.metadata)).not.toMatch(/titular/);
  });

  it('(a) la salvaguarda no se puede bloquear con eventos org.purged falsos (eventos reservados)', async () => {
    const c = new pg.Client({ connectionString: APP_URL ?? TEST_DATABASE_URL });
    await c.connect();
    try {
      if (APP_URL) {
        for (const ev of ['org.purged', 'db.org_deletion_changed', 'maintenance.purge_blocked', 'db.membership_deleted']) {
          await expect(c.query('INSERT INTO audit_events (event, metadata) VALUES ($1, $2)', [ev, '{"session_user":"enregla_owner"}'])).rejects.toThrow(/solo lo registra la base de datos/);
        }
      }
    } finally {
      await c.end();
    }
    const o = await pending('d4@example.com');
    expect((await o.client.delete(`${o.base}/permanent`, { password: PASSWORD })).statusCode).toBe(202);
    expect((await runMaintenance(ctx.deps.db, { auditMonths: 12 })).organizations).toMatchObject({ purged: 1, blocked: false });
  });

  it('(e) el mantenimiento no se queda colgado por un bloqueo ajeno (lock_timeout)', async () => {
    const o = await pending('e4@example.com');
    expect((await o.client.delete(`${o.base}/permanent`, { password: PASSWORD })).statusCode).toBe(202);
    const c = new pg.Client({ connectionString: APP_URL ?? TEST_DATABASE_URL });
    await c.connect();
    try {
      await c.query('BEGIN');
      await c.query('SELECT id FROM organizations WHERE id = $1 FOR UPDATE', [o.org.id]);
      const t = Date.now();
      await expect(runMaintenance(ctx.deps.db, { auditMonths: 12 })).rejects.toThrow(/lock timeout|bloqueo/);
      expect(Date.now() - t).toBeLessThan(20_000);
      await c.query('ROLLBACK');
    } finally {
      await c.end();
    }
    expect((await runMaintenance(ctx.deps.db, { auditMonths: 12 })).organizations).toMatchObject({ purged: 1 });
  }, 30_000);
});

// ---------------------------------------------------------------------------
// R6 «ambiente» sin motivo: proveedor escrito a mano y enmiendas
// ---------------------------------------------------------------------------
describe('R6 recepción en ambiente', () => {
  it('el proveedor escrito a mano con el nombre de uno de frío exige motivo, y una corrección de refrigerado a ambiente también', async () => {
    const o = await setupOwner(ctx, 'r6@example.com');
    json(await o.client.post(`${o.base}/suppliers`, { name: 'Frío Norte', defaultCategory: 'refrigerado' }));
    const base = { supplierName: '  frío norte ', product: 'Pollo fresco', category: 'ambiente', temperature: 15, accepted: true };
    const bad = await o.client.post(`${o.base}/records`, { type: 'recepcion', data: base });
    expect(bad.statusCode).toBe(400);
    expect(json(bad).error.details[0].path).toBe('data.categoryReason');
    const ok = json(await o.client.post(`${o.base}/records`, { type: 'recepcion', data: { ...base, categoryReason: 'Producto envasado' } })).record;
    expect(ok.data).toMatchObject({ supplierName: 'Frío Norte', categoryDiffersFromSupplier: true });
    expect(ok.data.supplierId).toBeTypeOf('string');
    // Enmienda: de refrigerado (2 °C) a ambiente.
    const orig = json(await o.client.post(`${o.base}/records`, { type: 'recepcion', data: { supplierName: 'Ocasional', product: 'Pollo', category: 'refrigerado', temperature: 2, accepted: true } })).record;
    const am = await o.client.post(`${o.base}/records/${orig.id}/amendments`, { reason: 'Error', data: { supplierName: 'Ocasional', product: 'Pollo', category: 'ambiente', temperature: 15, accepted: true } });
    expect(am.statusCode).toBe(400);
    expect(json(am).error.details[0]).toMatchObject({ path: 'data.categoryReason', message: expect.stringMatching(/original era producto refrigerado/) });
    const am2 = json(
      await o.client.post(`${o.base}/records/${orig.id}/amendments`, { reason: 'Error', data: { supplierName: 'Ocasional', product: 'Pollo', category: 'ambiente', temperature: 15, accepted: true, categoryReason: 'Era pollo asado frío, no fresco' } }),
    ).record;
    expect(am2.data).toMatchObject({ categoryChangedFrom: 'refrigerado', categoryReason: 'Era pollo asado frío, no fresco' });
    const row = formatRow('recepcion', { ...am2, effective_at: new Date(), created_at: new Date() } as unknown as ReportRecord, 'Europe/Madrid');
    expect(row[4]).toContain('antes refrigerado; motivo: Era pollo asado frío, no fresco');
  });
});

// ---------------------------------------------------------------------------
// R7 Bloqueo progresivo del PIN y desbloqueo en la tablet
// ---------------------------------------------------------------------------
describe('R7 PIN', () => {
  it('bloqueo de 1 min, luego 5 y luego 15; un encargado lo desbloquea en la tablet con su contraseña', async () => {
    const o = await withKiosk('r7@example.com');
    const marta = await createStaff(ctx, o.org.id, 'Marta', '5678');
    const fail5 = async () => {
      let last: LightMyRequestResponse | undefined;
      for (let i = 0; i < 5; i++) last = await o.k('POST', '/api/kiosk/verify-pin', { staffId: marta.id, pin: '0000' });
      return last!;
    };
    const lockSecs = async () => {
      const r = await ctx.deps.db.selectFrom('staff').select('pin_locked_until').where('id', '=', marta.id).executeTakeFirstOrThrow();
      return Math.round((r.pin_locked_until!.getTime() - Date.now()) / 1000);
    };
    const expire = () => sql`UPDATE staff SET pin_locked_until = now() - interval '1 second' WHERE id = ${marta.id}`.execute(ctx.deps.db);
    expect(json(await fail5()).error.code).toBe('PIN_LOCKED');
    expect(await lockSecs()).toBeLessThanOrEqual(60);
    await expire();
    await fail5();
    expect(await lockSecs()).toBeGreaterThan(200);
    expect(await lockSecs()).toBeLessThanOrEqual(300);
    await expire();
    await fail5();
    expect(await lockSecs()).toBeGreaterThan(800);
    // Desbloqueo por un responsable desde la tablet.
    expect((await o.k('POST', `/api/kiosk/staff/${marta.id}/unlock`, { email: 'r7@example.com', password: 'mala-clave-1' })).statusCode).toBe(401);
    const un = await o.k('POST', `/api/kiosk/staff/${marta.id}/unlock`, { email: 'r7@example.com', password: PASSWORD });
    expect(un.statusCode).toBe(200);
    expect(json(un)).toMatchObject({ ok: true, staff: { name: 'Marta' } });
    expect((await o.k('POST', '/api/kiosk/verify-pin', { staffId: marta.id, pin: '5678' })).statusCode).toBe(200);
    expect(await audits('staff.pin_unlocked')).toHaveLength(1);
    // Tras un acierto, el siguiente bloqueo vuelve a ser de 1 minuto.
    await fail5();
    expect(await lockSecs()).toBeLessThanOrEqual(60);
  });
});

// ---------------------------------------------------------------------------
// R8 Roles predefinidos y atributos peligrosos (necesita un superusuario del cluster)
// ---------------------------------------------------------------------------
describe.skipIf(!ADMIN_URL || !APP_URL)('R8 la regla de arranque detecta roles que dan control del servidor', () => {
  it('pg_execute_server_program, pg_write_server_files, pg_read_server_files (indirecto), CREATEROLE, CREATEDB, BYPASSRLS, REPLICATION', async () => {
    const admin = new pg.Client({ connectionString: ADMIN_URL });
    await admin.connect();
    const url = new URL(APP_URL!);
    const cases: [string, string, RegExp][] = [
      ['r8_exec', 'GRANT pg_execute_server_program TO r8_exec', /pg_execute_server_program/],
      ['r8_write', 'GRANT pg_write_server_files TO r8_write', /pg_write_server_files/],
      ['r8_read', 'CREATE ROLE r8_mid NOLOGIN; GRANT pg_read_server_files TO r8_mid; GRANT r8_mid TO r8_read', /pg_read_server_files/],
      ['r8_cr', 'ALTER ROLE r8_cr CREATEROLE', /CREATEROLE/],
      ['r8_cdb', 'ALTER ROLE r8_cdb CREATEDB', /CREATEDB/],
      ['r8_rls', 'ALTER ROLE r8_rls BYPASSRLS', /BYPASSRLS/],
      ['r8_repl', 'ALTER ROLE r8_repl REPLICATION', /REPLICATION/],
    ];
    try {
      for (const [role, grant, re] of cases) {
        await admin.query(`DROP ROLE IF EXISTS ${role}; DROP ROLE IF EXISTS r8_mid`);
        await admin.query(`CREATE ROLE ${role} LOGIN PASSWORD 'x' IN ROLE ${url.username}`);
        await admin.query(grant);
        const u = new URL(APP_URL!);
        u.username = role;
        u.password = 'x';
        const p = new pg.Pool({ connectionString: u.toString(), max: 1 });
        try {
          const h = await recordsHardeningStatus(p);
          expect(h.privileged).toBe(true);
          expect(h.problems.join()).toMatch(re);
          expect(refuseToStart(h, true)).toMatch(/enregla_app/);
        } finally {
          await p.end();
          await admin.query(`DROP ROLE ${role}; DROP ROLE IF EXISTS r8_mid`);
        }
      }
    } finally {
      await admin.end();
    }
  });
});

// ---------------------------------------------------------------------------
// Con el rol REAL de la app (R1 parcial, R9, R10)
// ---------------------------------------------------------------------------
describe.skipIf(!APP_URL)('rol real de la app (tercera evaluación)', () => {
  let app: pg.Pool;
  beforeAll(async () => {
    const owner = new pg.Pool({ connectionString: TEST_DATABASE_URL, max: 1 });
    await applyAppRolePrivileges(owner, new URL(APP_URL!).username);
    await owner.end();
    app = new pg.Pool({ connectionString: APP_URL, max: 2 });
  });
  afterAll(async () => app?.end());

  it('R9: dar de alta un equipo o un plan con fecha pasada no atrasa su historial', async () => {
    const o = await setupOwner(ctx, 'r9@example.com');
    const e = (
      await app.query(
        "INSERT INTO equipment (organization_id, name, type, max_temp, checks_per_day, created_at) VALUES ($1, 'Cámara 9', 'camara', 4, 1, now() - interval '60 days') RETURNING id, created_at",
        [o.org.id],
      )
    ).rows[0] as { id: string; created_at: Date };
    expect(Date.now() - e.created_at.getTime()).toBeLessThan(60_000);
    const h = await sql<{ v: Date }>`SELECT min(valid_from) AS v FROM equipment_config_history WHERE equipment_id = ${e.id}`.execute(ctx.deps.db);
    expect(Date.now() - h.rows[0]!.v.getTime()).toBeLessThan(60_000);
    const p = (
      await app.query(
        "INSERT INTO cleaning_plans (organization_id, name, frequency, items, created_at) VALUES ($1, 'Plan 9', 'daily', '[]', now() - interval '60 days') RETURNING created_at",
        [o.org.id],
      )
    ).rows[0] as { created_at: Date };
    expect(Date.now() - p.created_at.getTime()).toBeLessThan(60_000);
  });

  it('R1: el rol de la app no ejecuta ninguna función salvo las suyas; PUBLIC, ninguna', async () => {
    const r = await sql<{ f: string; app: boolean; pub: boolean }>`
      SELECT p.oid::regprocedure::text AS f,
             has_function_privilege(${new URL(APP_URL!).username}, p.oid, 'EXECUTE') AS app,
             coalesce(p.proacl::text LIKE '%{=X%' OR p.proacl::text LIKE '%,=X%' OR p.proacl IS NULL, false) AS pub
        FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace`.execute(ctx.deps.db);
    const appFns = r.rows.filter((x) => x.app).map((x) => x.f.replace(/^public\./, '')).sort();
    expect(appFns).toEqual([...APP_FUNCTIONS].map((f) => f.replace(', ', ',')).sort());
    expect(r.rows.filter((x) => x.pub).map((x) => x.f)).toEqual([]);
    expect((await recordsHardeningStatus(app)).hardened).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// R1 + R10 Prueba de restauración completa con los roles reales
// ---------------------------------------------------------------------------
const PG_TOOLS = (() => {
  try {
    execFileSync('pg_dump', ['--version']);
    execFileSync('pg_restore', ['--version']);
    execFileSync('psql', ['--version']);
    return true;
  } catch {
    return false;
  }
})();
describe.skipIf(!ADMIN_URL || !APP_URL || !PG_TOOLS)('R1 / R10 restauración (backup.sh → pg_restore --no-privileges → roles → migrate)', () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const deploy = path.resolve(here, '../../deploy');
  const appRole = new URL(APP_URL ?? 'postgres://x@x/x').username;
  const backupRole = process.env.TEST_BACKUP_ROLE ?? 'enregla_backup';
  const SRC = 'enregla_restore_src';
  const DST = 'enregla_restore_dst';
  const dbUrl = (u: string, db: string, user?: string) => {
    const x = new URL(u);
    x.pathname = `/${db}`;
    if (user) {
      x.username = user;
      x.password = 'x';
    }
    return x.toString();
  };
  /** Entorno libpq para los scripts (deploy/*.sh), a partir de la URL del administrador. */
  const libpq = (db: string) => {
    const a = new URL(ADMIN_URL!);
    const host = a.searchParams.get('host') ?? a.hostname;
    return { ...process.env, PGHOST: host, PGPORT: a.searchParams.get('port') ?? (a.port || '5432'), PGDATABASE: db };
  };
  async function admin<T>(fn: (c: pg.Client) => Promise<T>): Promise<T> {
    const c = new pg.Client({ connectionString: ADMIN_URL });
    await c.connect();
    try {
      return await fn(c);
    } finally {
      await c.end();
    }
  }
  const rolesScript = (db: string) =>
    execFileSync('sh', [path.join(deploy, 'postgres-init/10-enregla-roles.sh')], {
      env: { ...libpq(db), POSTGRES_DB: db, POSTGRES_USER: new URL(ADMIN_URL!).username, DB_OWNER_PASSWORD: 'x', DB_APP_PASSWORD: 'x', DB_BACKUP_PASSWORD: 'x' },
      encoding: 'utf8',
    });
  async function migrate(db: string) {
    const pool = new pg.Pool({ connectionString: dbUrl(TEST_DATABASE_URL, db), max: 1 });
    try {
      await runMigrations(pool);
      await applyAppRolePrivileges(pool, appRole, { backupRole });
    } finally {
      await pool.end();
    }
  }

  it('tras restaurar como indica OPERACIONES §4, migrate deja TODOS los permisos como deben estar', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'enregla-restore-'));
    try {
      await admin(async (c) => {
        for (const d of [SRC, DST]) await c.query(`DROP DATABASE IF EXISTS ${d}`);
        await c.query(`CREATE DATABASE ${SRC}`);
      });
      // Base de origen: roles (script real), migraciones y permisos, y unos datos.
      rolesScript(SRC);
      await migrate(SRC);
      const src = new pg.Client({ connectionString: dbUrl(TEST_DATABASE_URL, SRC) });
      await src.connect();
      await src.query(
        "WITH u AS (INSERT INTO users (email, name, password_hash, email_verified_at) VALUES ('r@example.com', 'R', 'hash', now()) RETURNING id), o AS (INSERT INTO organizations (name, business_type, timezone, trial_ends_at, public_menu_slug) VALUES ('Local R', 'bar', 'Europe/Madrid', now() + interval '14 days', 'local-r-restaurado') RETURNING id) INSERT INTO memberships (organization_id, user_id, role) SELECT o.id, u.id, 'owner' FROM o, u",
      );
      await src.query("INSERT INTO email_outbox (to_address, subject, body_text) VALUES ('x@example.com', 'Enlace', 'https://app/#token=secreto')").catch(() => undefined);
      await src.end();
      // Copia con el script real y el rol de copias (solo lectura).
      execFileSync('sh', [path.join(deploy, 'backup.sh')], { env: { ...libpq(SRC), PGUSER: backupRole, PGPASSWORD: 'x', BACKUP_DIR: dir, BACKUP_RETENTION_DAYS: '1' }, encoding: 'utf8' });
      const dump = readdirSync(dir).find((f) => f.endsWith('.dump'))!;
      expect(dump).toBeTruthy();
      // R10: el rol de copias no lee las tablas que no se copian.
      const bk = new pg.Client({ connectionString: dbUrl(TEST_DATABASE_URL, SRC, backupRole) });
      await bk.connect();
      try {
        for (const t of BACKUP_HIDDEN_TABLES) expect(Number((await bk.query(`SELECT count(*) AS n FROM ${t}`)).rows[0].n)).toBe(0);
        expect(Number((await bk.query('SELECT count(*) AS n FROM organizations')).rows[0].n)).toBe(1);
        await expect(bk.query('UPDATE organizations SET name = name')).rejects.toThrow(/permission denied/);
        await expect(bk.query('SELECT enregla_purge_due_organizations()')).rejects.toThrow(/permission denied/);
      } finally {
        await bk.end();
      }
      // Restauración como en OPERACIONES §4: el administrador crea la base y restaura sin dueños ni permisos.
      await admin((c) => c.query(`CREATE DATABASE ${DST}`));
      execFileSync('pg_restore', ['--no-owner', '--no-privileges', '--exit-on-error', '-U', new URL(ADMIN_URL!).username, '-d', DST, path.join(dir, dump)], { env: libpq(DST) });
      // Paso 4: roles (pasa todo a enregla_owner) y migrate.
      rolesScript(DST);
      // Antes de migrate, las funciones de purga son ejecutables por PUBLIC (el fallo de R1).
      const x = new pg.Client({ connectionString: dbUrl(ADMIN_URL!, DST) });
      await x.connect();
      const before = (await x.query("SELECT has_function_privilege($1, 'public.enregla_purge_organization(uuid)', 'EXECUTE') AS ok", [appRole])).rows[0].ok as boolean;
      await x.end();
      expect(before).toBe(true);
      await migrate(DST);
      // Permisos resultantes, comprobados contra lo esperado.
      const chk = new pg.Client({ connectionString: dbUrl(ADMIN_URL!, DST) });
      await chk.connect();
      try {
        const fns = (
          await chk.query<{ f: string; app: boolean; backup: boolean; pub: boolean }>(
            `SELECT regexp_replace(p.oid::regprocedure::text, '^public\\.', '') AS f,
                    has_function_privilege($1, p.oid, 'EXECUTE') AS app,
                    has_function_privilege($2, p.oid, 'EXECUTE') AS backup,
                    coalesce(p.proacl IS NULL OR EXISTS (SELECT 1 FROM aclexplode(p.proacl) a WHERE a.grantee = 0), true) AS pub
               FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace`,
            [appRole, backupRole],
          )
        ).rows;
        expect(fns.length).toBeGreaterThan(15);
        expect(fns.filter((f) => f.pub).map((f) => f.f)).toEqual([]);
        expect(fns.filter((f) => f.backup).map((f) => f.f)).toEqual([]);
        expect(fns.filter((f) => f.app).map((f) => f.f).sort()).toEqual([...APP_FUNCTIONS].map((f) => f.replace(', ', ',')).sort());
        for (const f of OWNER_ONLY_FUNCTIONS) expect(fns.find((x) => x.f === f.replace(', ', ','))?.app).toBe(false);
        // Tablas: lo que puede hacer cada rol.
        const tables = (await chk.query<{ t: string }>("SELECT tablename AS t FROM pg_tables WHERE schemaname = 'public'")).rows.map((r) => r.t);
        const priv = async (role: string, t: string, p: string) => (await chk.query(`SELECT has_table_privilege($1, $2, $3) AS ok`, [role, `public.${t}`, p])).rows[0].ok as boolean;
        const appNoDelete = ['records', 'organizations', 'devices', 'staff', 'equipment', 'cleaning_plans', 'audit_events', 'equipment_config_history', 'cleaning_plan_config_history', 'schema_migrations', 'enregla_owner_settings', 'enregla_org_subscriptions'];
        for (const t of tables) {
          expect(await priv(backupRole, t, 'INSERT'), `${backupRole} INSERT ${t}`).toBe(false);
          expect(await priv(backupRole, t, 'SELECT'), `${backupRole} SELECT ${t}`).toBe(true);
          expect(await priv(appRole, t, 'TRUNCATE'), `${appRole} TRUNCATE ${t}`).toBe(false);
          expect(await priv(appRole, t, 'DELETE'), `${appRole} DELETE ${t}`).toBe(!appNoDelete.includes(t));
          expect(await priv(appRole, t, 'SELECT'), `${appRole} SELECT ${t}`).toBe(t !== 'enregla_org_subscriptions');
          expect(await priv('public', t, 'SELECT'), `PUBLIC SELECT ${t}`).toBe(false);
        }
        expect(await priv(appRole, 'records', 'UPDATE')).toBe(false);
        expect(await priv(appRole, 'audit_events', 'UPDATE')).toBe(false);
        const db = (await chk.query<{ tmp: boolean; create: boolean }>(
          "SELECT has_database_privilege('public', current_database(), 'TEMPORARY') AS tmp, has_database_privilege('public', current_database(), 'CREATE') AS create",
        )).rows[0]!;
        expect(db).toEqual({ tmp: false, create: false });
      } finally {
        await chk.end();
      }
      // Y la app arranca con su rol: endurecido.
      const appPool = new pg.Pool({ connectionString: dbUrl(APP_URL!, DST), max: 1 });
      try {
        const h = await recordsHardeningStatus(appPool);
        expect(h.problems).toEqual([]);
        expect(refuseToStart(h, true)).toBeNull();
        await expect(appPool.query("SELECT enregla_purge_organization(gen_random_uuid())")).rejects.toThrow(/permission denied/);
      } finally {
        await appPool.end();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
      await admin(async (c) => {
        for (const d of [SRC, DST]) await c.query(`DROP DATABASE IF EXISTS ${d} WITH (FORCE)`);
      });
    }
  }, 120_000);
});

