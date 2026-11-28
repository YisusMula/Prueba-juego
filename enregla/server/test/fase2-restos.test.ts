/**
 * Fase 2, bloque A3: restos bajos de la evaluación de la fase 1. Cada prueba falla sin su corrección
 * (migración 0011 y `records/service.ts`). Las de eventos reservados necesitan el rol real de la app
 * (`TEST_APP_DATABASE_URL`): el propietario sí puede escribirlos.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import pg from 'pg';
import { sql } from 'kysely';
import { closeTestApp, createTestApp, createUser, json, resetDb, setupOwner, type TestCtx } from './helpers.js';
import { TEST_DATABASE_URL } from './global-setup.js';
import { applyAppRolePrivileges } from '../src/db/privileges.js';

let ctx: TestCtx;
const APP_URL = process.env.TEST_APP_DATABASE_URL;
beforeAll(async () => {
  ctx = await createTestApp();
  if (APP_URL) {
    const owner = new pg.Pool({ connectionString: TEST_DATABASE_URL, max: 1 });
    await applyAppRolePrivileges(owner, new URL(APP_URL).username);
    await owner.end();
  }
});
afterAll(async () => closeTestApp(ctx));
beforeEach(async () => resetDb(ctx));

const audits = async (event: string) => ctx.deps.db.selectFrom('audit_events').selectAll().where('event', '=', event).orderBy('id').execute();

describe.skipIf(!APP_URL)('eventos de auditoría reservados (rol real de la app)', () => {
  it('se rechazan sin distinguir mayúsculas, espacios ni espacios duros', async () => {
    const c = new pg.Client({ connectionString: APP_URL });
    await c.connect();
    try {
      for (const ev of ['DB.membership_deleted', ' db.org_deletion_changed', 'Org.Purged', 'org.purged ', 'MAINTENANCE.purge_blocked', 'db .membership_changed', 'org .purged', 'Db.Org_Billing_Changed\t']) {
        await expect(c.query('INSERT INTO audit_events (event, metadata) VALUES ($1, $2)', [ev, '{}']), JSON.stringify(ev)).rejects.toThrow(/solo lo registra la base de datos/);
      }
      // Los eventos normales de la app siguen funcionando.
      await c.query("INSERT INTO audit_events (event, metadata) VALUES ('auth.login', '{}')");
    } finally {
      await c.end();
    }
  });
});

describe('recepción: el proveedor escrito a mano se reconoce aunque cambie la forma', () => {
  it('tildes, mayúsculas, espacios múltiples, espacio duro y puntuación final', async () => {
    const o = await setupOwner(ctx, 'prov@example.com');
    const sup = json(await o.client.post(`${o.base}/suppliers`, { name: 'Frío Norte', defaultCategory: 'refrigerado' })).supplier;
    for (const name of ['FRIO  NORTE.', 'frío norte', '  Frio Norte ; ', 'frío norte!!']) {
      const bad = await o.client.post(`${o.base}/records`, { type: 'recepcion', data: { supplierName: name, product: 'Pollo', category: 'ambiente', accepted: true } });
      expect(bad.statusCode, name).toBe(400);
      expect(json(bad).error.details[0].path).toBe('data.categoryReason');
      const ok = json(
        await o.client.post(`${o.base}/records`, { type: 'recepcion', data: { supplierName: name, product: 'Pollo', category: 'refrigerado', temperature: 2, accepted: true } }),
      ).record;
      expect(ok.data).toMatchObject({ supplierId: sup.id, supplierName: 'Frío Norte' });
    }
    // Un nombre distinto no se confunde.
    const other = json(await o.client.post(`${o.base}/records`, { type: 'recepcion', data: { supplierName: 'Frío Norteño', product: 'Pollo', category: 'ambiente', accepted: true } })).record;
    expect(other.data.supplierId).toBeNull();
  });
});

describe('altas y cambios de rol en memberships auditados por la base de datos', () => {
  it('db.membership_changed con el rol anterior y el nuevo, el usuario de PostgreSQL y la IP', async () => {
    const o = await setupOwner(ctx, 'm@example.com');
    const u = await createUser(ctx, 'nuevo@example.com');
    // Directamente en la base de datos (como haría quien tenga las credenciales de la app).
    const c = new pg.Client({ connectionString: APP_URL ?? TEST_DATABASE_URL });
    await c.connect();
    try {
      await c.query("INSERT INTO memberships (organization_id, user_id, role) VALUES ($1, $2, 'manager')", [o.org.id, u.id]);
      await c.query("UPDATE memberships SET role = 'owner' WHERE organization_id = $1 AND user_id = $2", [o.org.id, u.id]);
      // Cambiar otra columna (preferencia del recordatorio) no es un cambio de rol.
      await c.query('UPDATE memberships SET daily_reminder = false WHERE organization_id = $1 AND user_id = $2', [o.org.id, u.id]);
    } finally {
      await c.end();
    }
    const ev = (await audits('db.membership_changed')).filter((e) => e.user_id === u.id);
    expect(ev).toHaveLength(2);
    expect(ev[0]!.organization_id).toBe(o.org.id);
    expect(ev[0]!.metadata).toMatchObject({ op: 'INSERT', old_role: null, new_role: 'manager' });
    expect(ev[1]!.metadata).toMatchObject({ op: 'UPDATE', old_role: 'manager', new_role: 'owner' });
    expect(String(ev[1]!.metadata.session_user)).toBe(new URL(APP_URL ?? TEST_DATABASE_URL).username);
    // La creación de un local (alta del propietario) también queda registrada.
    const own = (await audits('db.membership_changed')).filter((e) => e.user_id === o.user.id);
    expect(own[0]!.metadata).toMatchObject({ op: 'INSERT', new_role: 'owner' });
  });
});

describe('trigger del proveedor en los datos del registro', () => {
  it('rechaza supplierId que no sea un UUID en texto y claves con otra capitalización', async () => {
    const o = await setupOwner(ctx, 'trg@example.com');
    const sup = json(await o.client.post(`${o.base}/suppliers`, { name: 'Prov' })).supplier;
    const ins = (data: unknown) =>
      sql`INSERT INTO records (organization_id, type, data, user_id, user_name)
          VALUES (${o.org.id}, 'recepcion', ${JSON.stringify(data)}::jsonb, ${o.user.id}, 'x')`.execute(ctx.deps.db);
    const base = { supplierName: 'Prov', product: 'x', category: 'ambiente', accepted: true };
    await expect(ins({ ...base, supplierId: 12345 })).rejects.toThrow(/proveedor/);
    await expect(ins({ ...base, supplierId: { id: sup.id } })).rejects.toThrow(/proveedor/);
    await expect(ins({ ...base, supplierId: [sup.id] })).rejects.toThrow(/proveedor/);
    await expect(ins({ ...base, supplierId: true })).rejects.toThrow(/proveedor/);
    await expect(ins({ ...base, supplierId: 'no-es-un-uuid' })).rejects.toThrow(/proveedor/);
    await expect(ins({ ...base, SupplierId: sup.id })).rejects.toThrow(/capitalización|proveedor/);
    await expect(ins({ ...base, supplierID: '00000000-0000-0000-0000-000000000000' })).rejects.toThrow(/capitalización|proveedor/);
    await expect(ins({ ...base, EquipmentId: '00000000-0000-0000-0000-000000000000' })).rejects.toThrow(/capitalización/);
    // Lo correcto sigue funcionando: UUID del local o null.
    await ins({ ...base, supplierId: sup.id });
    await ins({ ...base, supplierId: null });
  });
});
