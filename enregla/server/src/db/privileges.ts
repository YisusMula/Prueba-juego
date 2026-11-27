import type pg from 'pg';

/** Nombre de rol de PostgreSQL seguro para interpolar (solo minúsculas, cifras y «_»). */
const ROLE_RE = /^[a-z_][a-z0-9_]{0,62}$/;

/**
 * Funciones que el rol de la app necesita poder ejecutar: las auxiliares que llaman sus triggers
 * (que se ejecutan con sus permisos) y la seudonimización de cuentas ya borradas. Ninguna otra: en
 * particular, ni las de purga ni las de mantenimiento (solo el propietario).
 */
export const APP_FUNCTIONS = [
  'enregla_caller_is_owner()',
  'enregla_session_is_owner()',
  'enregla_setting_int(text, integer)',
  'enregla_reserved_audit_event(text)',
  'enregla_is_org_owner(uuid, uuid)',
  'enregla_pseudonymize_audit(uuid, text)',
] as const;

/** Funciones de purga y mantenimiento: SOLO el propietario (servicio `maintenance`). */
export const OWNER_ONLY_FUNCTIONS = [
  'enregla_purge_organization(uuid)',
  'enregla_purge_due_organizations()',
  'enregla_purge_audit_events(integer)',
  'enregla_purge_blocker(uuid)',
] as const;

/**
 * Tablas cuyo CONTENIDO no entra en las copias (deploy/backup.sh, --exclude-table-data) y que el rol
 * de copias no debe poder leer: enlaces y tokens en claro, sesiones, contadores, respuestas guardadas.
 */
export const BACKUP_HIDDEN_TABLES = ['email_outbox', 'sessions', 'email_tokens', 'rate_limits', 'idempotency_keys'] as const;

/**
 * Deja TODOS los permisos de la base de datos en su estado correcto (R1), de forma idempotente. Lo
 * ejecuta el rol propietario en cada `migrate` (APP_DB_ROLE, BACKUP_DB_ROLE), así que también repara
 * una base restaurada con `pg_restore --no-privileges` (que deja las funciones ejecutables por PUBLIC)
 * y cubre las tablas nuevas.
 *  - PUBLIC: sin EXECUTE en ninguna función del esquema, sin TEMPORARY ni CREATE en la base, sin CREATE
 *    en `public`; y lo mismo para las funciones que se creen en el futuro (ALTER DEFAULT PRIVILEGES).
 *  - App: leer y escribir las tablas normales, en `records` solo SELECT e INSERT, sin DELETE en tablas
 *    que arrastran registros, auditoría solo añadir, historial solo leer, UPDATE por columnas en
 *    equipos y planes, EXECUTE solo en APP_FUNCTIONS. No es propietario de nada.
 *  - Copias (opcional): solo SELECT, y nada de BACKUP_HIDDEN_TABLES (una política RLS se lo oculta,
 *    pero `pg_dump` puede bloquearlas y volcar su estructura).
 */
export async function applyAppRolePrivileges(pool: pg.Pool, role: string, opts: { backupRole?: string } = {}): Promise<void> {
  if (!ROLE_RE.test(role)) throw new Error(`APP_DB_ROLE no es un nombre de rol válido: ${role}`);
  const backup = opts.backupRole?.trim() || undefined;
  if (backup !== undefined && !ROLE_RE.test(backup)) throw new Error(`BACKUP_DB_ROLE no es un nombre de rol válido: ${backup}`);
  if (backup === role) throw new Error('El rol de copias no puede ser el de la app');
  const client = await pool.connect();
  try {
    for (const r of [role, ...(backup ? [backup] : [])]) {
      const q = await client.query<{ rolsuper: boolean }>('SELECT rolsuper FROM pg_roles WHERE rolname = $1', [r]);
      if (q.rowCount === 0) throw new Error(`El rol ${r} no existe: créalo antes (deploy/postgres-init/10-enregla-roles.sh)`);
      if (q.rows[0]!.rolsuper) throw new Error(`El rol ${r} no puede ser superusuario`);
    }
    const me = (await client.query<{ u: string }>('SELECT current_user AS u')).rows[0]!.u;
    if (me === role || me === backup) throw new Error('Las migraciones deben ejecutarse con el rol propietario, no con el de la app ni el de copias');
    await client.query('BEGIN');
    const q = (sql: string, r = role) => client.query(sql.replaceAll('%ROLE%', `"${r}"`));
    const onDb = (stmt: string) => client.query(`DO $do$ BEGIN EXECUTE format('${stmt}', current_database()); END $do$`);
    const existing = async (sigs: readonly string[]) =>
      (await client.query<{ s: string }>('SELECT s FROM unnest($1::text[]) AS s WHERE to_regprocedure($2 || s) IS NOT NULL', [sigs, 'public.'])).rows.map((x) => `public.${x.s}`);

    // --- PUBLIC (todos los roles) ----------------------------------------------------------------
    await client.query('REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC');
    await client.query('ALTER DEFAULT PRIVILEGES REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC');
    await onDb('REVOKE TEMPORARY, CREATE ON DATABASE %I FROM PUBLIC');
    await client.query('REVOKE CREATE ON SCHEMA public FROM PUBLIC');
    await client.query('REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC');

    // --- Rol de la app -----------------------------------------------------------------------------
    await onDb(`GRANT CONNECT ON DATABASE %I TO ${role}`);
    await onDb(`REVOKE TEMPORARY, CREATE ON DATABASE %I FROM ${role}`);
    await q('GRANT USAGE ON SCHEMA public TO %ROLE%');
    await q('REVOKE CREATE ON SCHEMA public FROM %ROLE%');
    await q('REVOKE ALL ON ALL TABLES IN SCHEMA public FROM %ROLE%');
    await q('GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO %ROLE%');
    await q('REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM %ROLE%');
    await q('GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO %ROLE%');
    // Registros APPCC: solo leer y añadir (la hora y el orden los fija un trigger, 0007/0010).
    await q('REVOKE UPDATE, DELETE ON records FROM %ROLE%');
    // Tablas desde las que un DELETE borraría registros en cascada: la app no las borra (desactiva).
    // Los locales los purga el MANTENIMIENTO con el rol propietario (0009), nunca la app.
    await q('REVOKE DELETE ON organizations, devices, staff, equipment, cleaning_plans FROM %ROLE%');
    // Auditoría: solo añadir (la hora la pone la base de datos; los eventos db.* son del propietario) y leer.
    await q('REVOKE UPDATE, DELETE ON audit_events FROM %ROLE%');
    // Historial de configuración: lo escriben triggers del propietario; la app solo lo lee.
    await q('REVOKE INSERT, UPDATE, DELETE ON equipment_config_history, cleaning_plan_config_history FROM %ROLE%');
    // Equipos y planes: solo las columnas que edita la app (no created_at, que movería el historial).
    await q('REVOKE UPDATE ON equipment, cleaning_plans FROM %ROLE%');
    await q('GRANT UPDATE (name, type, min_temp, max_temp, checks_per_day, active, updated_at) ON equipment TO %ROLE%');
    await q('GRANT UPDATE (name, frequency, weekday, month_day, items, active, updated_at) ON cleaning_plans TO %ROLE%');
    // Ajustes del propietario (plazo mínimo, topes): solo lectura. Suscripciones vistas: nada.
    await q('REVOKE INSERT, UPDATE, DELETE ON enregla_owner_settings FROM %ROLE%');
    if ((await client.query("SELECT to_regclass('public.enregla_org_subscriptions') AS t")).rows[0].t) {
      await q('REVOKE ALL ON enregla_org_subscriptions FROM %ROLE%');
    }
    // Control de migraciones: solo lectura.
    await q('REVOKE INSERT, UPDATE, DELETE ON schema_migrations FROM %ROLE%');
    // Funciones: ninguna salvo las que necesita (las de purga, nunca).
    await q('REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM %ROLE%');
    for (const f of await existing(APP_FUNCTIONS)) await q(`GRANT EXECUTE ON FUNCTION ${f} TO %ROLE%`);

    // --- Rol de copias -----------------------------------------------------------------------------
    if (backup) {
      await onDb(`GRANT CONNECT ON DATABASE %I TO ${backup}`);
      await onDb(`REVOKE TEMPORARY, CREATE ON DATABASE %I FROM ${backup}`);
      await q('GRANT USAGE ON SCHEMA public TO %ROLE%', backup);
      await q('REVOKE CREATE ON SCHEMA public FROM %ROLE%', backup);
      await q('REVOKE ALL ON ALL TABLES IN SCHEMA public FROM %ROLE%', backup);
      await q('GRANT SELECT ON ALL TABLES IN SCHEMA public TO %ROLE%', backup);
      await q('REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM %ROLE%', backup);
      await q('GRANT SELECT ON ALL SEQUENCES IN SCHEMA public TO %ROLE%', backup);
      await q('REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM %ROLE%', backup);
    }
    // Tablas que no se copian: el rol de copias no ve ninguna fila (RLS). El resto de roles, todas
    // (el propietario y los superusuarios no están sujetos a RLS).
    for (const t of BACKUP_HIDDEN_TABLES) {
      if (!(await client.query('SELECT to_regclass($1) AS t', [`public.${t}`])).rows[0].t) continue;
      await client.query(`ALTER TABLE public.${t} ENABLE ROW LEVEL SECURITY`);
      await client.query(`DROP POLICY IF EXISTS enregla_all ON public.${t}`);
      await client.query(`CREATE POLICY enregla_all ON public.${t} USING (true) WITH CHECK (true)`);
      await client.query(`DROP POLICY IF EXISTS enregla_hidden_from_backup ON public.${t}`);
      if (backup) await client.query(`CREATE POLICY enregla_hidden_from_backup ON public.${t} AS RESTRICTIVE FOR SELECT TO "${backup}" USING (false)`);
    }
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
  /**
   * El ROL es el equivocado (superusuario, propietario, miembro de ellos o de roles predefinidos que
   * dan control del servidor, o con atributos de administración): hay que conectar con enregla_app.
   * Si es false pero hay problemas, son PERMISOS que `migrate` repara.
   */
  privileged: boolean;
}

/** Roles predefinidos de PostgreSQL que dan control del servidor o de todos los datos (R8). */
const DANGEROUS_BUILTIN_ROLES = ['pg_execute_server_program', 'pg_read_server_files', 'pg_write_server_files', 'pg_write_all_data'];

/**
 * ¿Puede el rol con el que conecta la app alterar el historial, purgar locales o hacerse con el
 * servidor? Comprueba la pertenencia (directa o indirecta, `pg_has_role … MEMBER`) a superusuarios, al
 * propietario y a roles predefinidos peligrosos, los atributos de administración de cualquier rol del
 * que sea miembro, y los permisos concretos.
 */
export async function recordsHardeningStatus(pool: pg.Pool): Promise<HardeningStatus> {
  const r = await pool.query<{
    role: string;
    superuser: boolean;
    owner: boolean;
    builtin: string[] | null;
    attrs: string[] | null;
    upd: boolean;
    del: boolean;
    trunc: boolean;
    orgdel: boolean;
    purge: string[] | null;
    tmp: boolean;
  }>(
    `
    SELECT current_user AS role,
      EXISTS (SELECT 1 FROM pg_catalog.pg_roles r WHERE r.rolsuper AND pg_catalog.pg_has_role(current_user, r.oid, 'MEMBER')) AS superuser,
      (SELECT pg_catalog.pg_has_role(current_user, c.relowner, 'MEMBER') FROM pg_catalog.pg_class c WHERE c.oid = 'public.records'::pg_catalog.regclass) AS owner,
      (SELECT pg_catalog.array_agg(r.rolname::text ORDER BY r.rolname) FROM pg_catalog.pg_roles r
        WHERE r.rolname = ANY($1::text[]) AND pg_catalog.pg_has_role(current_user, r.oid, 'MEMBER')) AS builtin,
      (SELECT pg_catalog.array_agg(DISTINCT a ORDER BY a) FROM pg_catalog.pg_roles r,
         LATERAL (VALUES (CASE WHEN r.rolcreaterole THEN 'CREATEROLE' END), (CASE WHEN r.rolcreatedb THEN 'CREATEDB' END),
                         (CASE WHEN r.rolbypassrls THEN 'BYPASSRLS' END), (CASE WHEN r.rolreplication THEN 'REPLICATION' END)) v(a)
        WHERE a IS NOT NULL AND pg_catalog.pg_has_role(current_user, r.oid, 'MEMBER')) AS attrs,
      pg_catalog.has_table_privilege(current_user, 'public.records', 'UPDATE') AS upd,
      pg_catalog.has_table_privilege(current_user, 'public.records', 'DELETE') AS del,
      pg_catalog.has_table_privilege(current_user, 'public.records', 'TRUNCATE') AS trunc,
      pg_catalog.has_table_privilege(current_user, 'public.organizations', 'DELETE') AS orgdel,
      (SELECT pg_catalog.array_agg(f ORDER BY f) FROM pg_catalog.unnest($2::text[]) AS f
        WHERE pg_catalog.to_regprocedure('public.' || f) IS NOT NULL
          AND pg_catalog.has_function_privilege(current_user, pg_catalog.to_regprocedure('public.' || f), 'EXECUTE')) AS purge,
      pg_catalog.has_database_privilege(current_user, pg_catalog.current_database(), 'TEMPORARY') AS tmp`,
    [DANGEROUS_BUILTIN_ROLES, [...OWNER_ONLY_FUNCTIONS]],
  );
  const s = r.rows[0]!;
  const identity: string[] = [];
  const perms: string[] = [];
  if (s.superuser) identity.push('es (o pertenece a) un superusuario');
  if (s.owner) identity.push('es (o pertenece a) el propietario de la tabla records (puede desactivar su trigger)');
  if (s.builtin?.length) identity.push(`pertenece a roles que dan control del servidor o de todos los datos (${s.builtin.join(', ')})`);
  if (s.attrs?.length) identity.push(`tiene (directamente o por pertenencia) atributos de administración (${s.attrs.join(', ')})`);
  if (s.upd) perms.push('puede hacer UPDATE en records');
  if (s.del) perms.push('puede hacer DELETE en records');
  if (s.trunc) perms.push('puede hacer TRUNCATE en records');
  if (s.orgdel) perms.push('puede borrar locales (y sus registros en cascada) sin esperar al plazo de conservación');
  if (s.purge?.length) perms.push(`puede ejecutar funciones de purga (${s.purge.join(', ')}), que solo debe ejecutar el mantenimiento`);
  if (s.tmp) perms.push('puede crear tablas temporales');
  const problems = [...identity, ...perms];
  return { role: s.role, hardened: problems.length === 0, problems, privileged: identity.length > 0 };
}

/**
 * En producción la app no arranca si su rol tiene CUALQUIER problema. No hay forma de saltárselo
 * (ALLOW_PRIVILEGED_DB_ROLE ya no existe): con un rol privilegiado o con la purga ejecutable volvería
 * a poder borrar locales al instante. El mensaje dice qué hacer: conectar con el rol de ejecución o,
 * si solo son permisos (p. ej. tras restaurar una copia), ejecutar `migrate`.
 */
export function refuseToStart(h: HardeningStatus, isProduction: boolean): string | null {
  if (!isProduction || h.hardened) return null;
  const fix = h.privileged
    ? 'La app debe conectarse con el rol de ejecución (enregla_app, PGUSER en el compose), que no puede ser superusuario, propietario ni miembro de ellos: ver docs/OPERACIONES.md, apartado 13.'
    : 'Son permisos que repara el servicio migrate (por ejemplo, tras restaurar una copia): ejecuta «docker compose … run --rm migrate» y vuelve a arrancar la app (docs/OPERACIONES.md, apartado 4).';
  return `El rol de base de datos de la app (${h.role}) ${h.problems.join(', ')}. ${fix}`;
}
