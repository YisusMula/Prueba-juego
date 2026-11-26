import type pg from 'pg';

/** Nombre de rol de PostgreSQL seguro para interpolar (solo minúsculas, cifras y «_»). */
const ROLE_RE = /^[a-z_][a-z0-9_]{0,62}$/;

/**
 * Permisos del ROL DE EJECUCIÓN de la app (1.8). Lo ejecuta el rol propietario del esquema tras
 * aplicar las migraciones (`npm run migrate:prod` con APP_DB_ROLE), así que cubre también las
 * tablas nuevas. Idempotente.
 *  - Puede leer y escribir las tablas normales, pero en `records` solo SELECT e INSERT: ni UPDATE,
 *    ni DELETE, ni TRUNCATE, ni crear triggers. No es propietario de nada, así que tampoco puede
 *    `ALTER TABLE records DISABLE TRIGGER` ni cambiar el esquema.
 *  - El borrado en cascada al eliminar un local lo ejecuta PostgreSQL con los permisos del
 *    propietario de la tabla (acciones referenciales), y el trigger de inmutabilidad solo lo
 *    permite cuando el local ya no existe.
 */
export async function applyAppRolePrivileges(pool: pg.Pool, role: string): Promise<void> {
  if (!ROLE_RE.test(role)) throw new Error(`APP_DB_ROLE no es un nombre de rol válido: ${role}`);
  const client = await pool.connect();
  try {
    const r = await client.query<{ rolsuper: boolean; rolbypassrls: boolean }>('SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = $1', [role]);
    if (r.rowCount === 0) throw new Error(`El rol ${role} no existe: créalo antes (deploy/postgres-init/10-enregla-roles.sh)`);
    if (r.rows[0]!.rolsuper) throw new Error(`El rol de la app (${role}) no puede ser superusuario`);
    const me = (await client.query<{ u: string }>('SELECT current_user AS u')).rows[0]!.u;
    if (me === role) throw new Error('Las migraciones deben ejecutarse con el rol propietario, no con el rol de la app');
    await client.query('BEGIN');
    const q = (sql: string) => client.query(sql.replaceAll('%ROLE%', `"${role}"`));
    await client.query(`DO $do$ BEGIN EXECUTE format('GRANT CONNECT ON DATABASE %I TO %I', current_database(), '${role}'); END $do$`);
    await q('GRANT USAGE ON SCHEMA public TO %ROLE%');
    await q('REVOKE CREATE ON SCHEMA public FROM %ROLE%');
    await q('GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO %ROLE%');
    await q('REVOKE TRUNCATE, REFERENCES, TRIGGER ON ALL TABLES IN SCHEMA public FROM %ROLE%');
    await q('GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO %ROLE%');
    // Registros APPCC: solo leer y añadir (la hora y el orden los fija un trigger, 0007).
    await q('REVOKE UPDATE, DELETE ON records FROM %ROLE%');
    // Tablas desde las que un DELETE borraría registros en cascada: la app no las borra (desactiva).
    // Los locales se purgan con enregla_purge_organization (solo si el plazo venció o el titular lo pidió).
    await q('REVOKE DELETE ON organizations, devices, staff, equipment, cleaning_plans FROM %ROLE%');
    // Auditoría: solo añadir y leer (purga y seudonimización por funciones acotadas del propietario).
    await q('REVOKE UPDATE, DELETE ON audit_events FROM %ROLE%');
    // Historial de configuración: lo escriben triggers del propietario; la app solo lo lee.
    await q('REVOKE INSERT, UPDATE, DELETE ON equipment_config_history, cleaning_plan_config_history FROM %ROLE%');
    await q('GRANT EXECUTE ON FUNCTION enregla_purge_organization(uuid), enregla_purge_audit_events(int), enregla_pseudonymize_audit(uuid, text) TO %ROLE%');
    // Control de migraciones: solo lectura.
    await q('REVOKE INSERT, UPDATE, DELETE ON schema_migrations FROM %ROLE%');
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

export interface HardeningStatus {
  role: string;
  hardened: boolean;
  problems: string[];
  /** Superusuario o propietario de `records`: puede desactivar el trigger de inmutabilidad. */
  privileged: boolean;
}

/**
 * ¿Puede el rol con el que conecta la app alterar el historial de registros? (1.8) Si es superusuario,
 * propietario de `records` o tiene UPDATE/DELETE/TRUNCATE sobre ella, no está endurecido.
 */
export async function recordsHardeningStatus(pool: pg.Pool): Promise<HardeningStatus> {
  const r = await pool.query<{ role: string; superuser: boolean; owner: boolean; upd: boolean; del: boolean; trunc: boolean; orgdel: boolean }>(`
    SELECT current_user AS role,
      (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) AS superuser,
      (SELECT tableowner = current_user FROM pg_tables WHERE schemaname = 'public' AND tablename = 'records') AS owner,
      has_table_privilege(current_user, 'public.records', 'UPDATE') AS upd,
      has_table_privilege(current_user, 'public.records', 'DELETE') AS del,
      has_table_privilege(current_user, 'public.records', 'TRUNCATE') AS trunc,
      has_table_privilege(current_user, 'public.organizations', 'DELETE') AS orgdel`);
  const s = r.rows[0]!;
  const problems: string[] = [];
  if (s.superuser) problems.push('es superusuario');
  if (s.owner) problems.push('es propietario de la tabla records (puede desactivar su trigger)');
  if (s.upd) problems.push('puede hacer UPDATE en records');
  if (s.del) problems.push('puede hacer DELETE en records');
  if (s.trunc) problems.push('puede hacer TRUNCATE en records');
  if (s.orgdel) problems.push('puede borrar locales (y sus registros en cascada) sin esperar al plazo de conservación');
  return { role: s.role, hardened: problems.length === 0, problems, privileged: s.superuser || s.owner };
}

/**
 * En producción la app no arranca si su rol es superusuario o propietario de `records` (podría
 * desactivar el trigger de inmutabilidad), salvo que se acepte expresamente con
 * ALLOW_PRIVILEGED_DB_ROLE=true (despliegues sin separación de roles, bajo responsabilidad del operador).
 */
export function refuseToStart(h: HardeningStatus, isProduction: boolean, allowPrivileged: boolean): string | null {
  if (!isProduction || allowPrivileged || !h.privileged) return null;
  return `El rol de base de datos de la app (${h.role}) ${h.problems.join(', ')}. En producción la app debe conectarse con el rol de ejecución (enregla_app): ver docs/OPERACIONES.md, apartado 13. Si de verdad quieres arrancar así, define ALLOW_PRIVILEGED_DB_ROLE=true.`;
}
