#!/bin/sh
# =============================================================================
# EnRegla — separación de roles de PostgreSQL (se aplica POR DEFECTO en los compose).
#
# La imagen oficial de postgres ejecuta este script UNA vez, al crear la base de datos (volumen
# vacío), como el superusuario POSTGRES_USER. Para un despliegue que ya existía, ejecútalo a mano
# (docs/OPERACIONES.md, «Roles de la base de datos»):
#   docker compose exec -T db sh /docker-entrypoint-initdb.d/10-enregla-roles.sh
#
# Crea (o actualiza la contraseña de) tres roles:
#   enregla_owner → propietario del esquema y de todas las tablas. Solo lo usa el servicio
#                   `migrate` (migraciones y permisos), nunca la app.
#   enregla_app   → rol de EJECUCIÓN de la app: sin DDL y sin ser propietario de nada. Los
#                   permisos sobre las tablas los fija `migrate` tras cada migración
#                   (APP_DB_ROLE): en `records` solo SELECT e INSERT.
#   enregla_backup → solo LECTURA para pg_dump (SELECT tabla a tabla, lo fija `migrate` con
#                   BACKUP_DB_ROLE), sin ver las tablas que no se copian (bandeja de emails, sesiones,
#                   tokens…). Sin escritura, sin DDL: quien robe su clave no puede modificar ni borrar nada.
# El superusuario POSTGRES_USER queda solo para administración (no lo usa ningún servicio).
# Idempotente: se puede ejecutar varias veces.
# =============================================================================
set -eu
: "${DB_OWNER_PASSWORD:?Define DB_OWNER_PASSWORD (contraseña del rol de migraciones)}"
: "${DB_APP_PASSWORD:?Define DB_APP_PASSWORD (contraseña del rol de ejecución de la app)}"
: "${DB_BACKUP_PASSWORD:?Define DB_BACKUP_PASSWORD (contraseña del rol de solo lectura de las copias)}"
DB="${POSTGRES_DB:-enregla}"
ADMIN="${POSTGRES_USER:-postgres}"

psql -v ON_ERROR_STOP=1 --username "$ADMIN" --dbname "$DB" \
  -v owner_pw="$DB_OWNER_PASSWORD" -v app_pw="$DB_APP_PASSWORD" -v backup_pw="$DB_BACKUP_PASSWORD" -v db="$DB" <<'SQL'
-- 1. Roles (la contraseña se pasa como variable de psql: nunca aparece en el SQL ni en los logs).
SELECT NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'enregla_owner') AS create_owner \gset
\if :create_owner
  CREATE ROLE enregla_owner LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;
\endif
SELECT NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'enregla_app') AS create_app \gset
\if :create_app
  CREATE ROLE enregla_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
\endif
SELECT NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'enregla_backup') AS create_backup \gset
\if :create_backup
  CREATE ROLE enregla_backup LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
\endif
ALTER ROLE enregla_owner WITH LOGIN NOSUPERUSER PASSWORD :'owner_pw';
ALTER ROLE enregla_app WITH LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD :'app_pw';
ALTER ROLE enregla_backup WITH LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD :'backup_pw';
-- Solo lectura tabla a tabla (la fija `migrate`); nada de roles predefinidos que lo leen todo.
REVOKE pg_read_all_data FROM enregla_backup;
-- Defensa adicional contra transacciones abiertas indefinidamente con el rol de la app (la hora de
-- los registros ya la pone el reloj, no el inicio de la transacción).
ALTER ROLE enregla_app SET idle_in_transaction_session_timeout = '60s';

-- 2. La base de datos y el esquema son del rol propietario. Nadie más puede crear objetos.
ALTER DATABASE :"db" OWNER TO enregla_owner;
ALTER SCHEMA public OWNER TO enregla_owner;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT CONNECT ON DATABASE :"db" TO enregla_app;
GRANT USAGE ON SCHEMA public TO enregla_app;
GRANT CONNECT ON DATABASE :"db" TO enregla_backup;
-- Sin tablas temporales para nadie salvo el propietario (0009 también lo aplica).
REVOKE TEMPORARY ON DATABASE :"db" FROM PUBLIC;

-- 3. Despliegue existente: lo que creó el usuario anterior (tablas, secuencias, funciones) pasa
--    al rol propietario. En una base nueva no hay nada que transferir todavía.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
    EXECUTE format('ALTER TABLE public.%I OWNER TO enregla_owner', r.tablename);
  END LOOP;
  FOR r IN SELECT sequencename FROM pg_sequences WHERE schemaname = 'public'
           AND NOT EXISTS (SELECT 1 FROM pg_depend d JOIN pg_class c ON c.oid = d.objid
                           WHERE c.relname = sequencename AND d.deptype IN ('a', 'i')) LOOP
    EXECUTE format('ALTER SEQUENCE public.%I OWNER TO enregla_owner', r.sequencename);
  END LOOP;
  FOR r IN SELECT p.oid::regprocedure AS fn FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
           WHERE n.nspname = 'public' AND p.prokind IN ('f', 'p') LOOP
    EXECUTE format('ALTER FUNCTION %s OWNER TO enregla_owner', r.fn);
  END LOOP;
END $$;

-- 4. Por si el rol de la app tenía permisos de antes: se quitan los peligrosos sobre `records`
--    (el servicio `migrate` vuelve a aplicar los permisos completos en cada despliegue).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'records') THEN
    EXECUTE 'REVOKE UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.records FROM enregla_app';
  END IF;
END $$;
SQL
echo "Roles de EnRegla listos: enregla_owner (migraciones y mantenimiento), enregla_app (ejecución) y enregla_backup (copias, solo lectura)."
