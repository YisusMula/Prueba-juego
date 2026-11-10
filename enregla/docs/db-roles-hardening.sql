-- =============================================================================
-- EnRegla — endurecimiento recomendado de roles de PostgreSQL (EJEMPLO, no se aplica solo)
--
-- Objetivo: que las credenciales con las que corre la app NO puedan reescribir ni borrar
-- el historial de registros APPCC (tabla `records`) ni desactivar su trigger de
-- inmutabilidad. Se separan:
--   * enregla_owner    → dueño del esquema; solo para migraciones (paso de despliegue).
--   * enregla_app      → rol de ejecución de la app; sin DDL; en `records` solo SELECT/INSERT.
--
-- Uso (como superusuario, sustituyendo las contraseñas):
--   psql -v ON_ERROR_STOP=1 -d enregla -f docs/db-roles-hardening.sql
-- Después:
--   * Migraciones:  DATABASE_URL=postgres://enregla_owner:...@db/enregla npm run migrate:prod
--   * App:          DATABASE_URL=postgres://enregla_app:...@db/enregla  MIGRATE_ON_START=false
-- Tras cada migración nueva, vuelve a ejecutar la sección 3 (permisos) por si hay tablas nuevas
-- (los ALTER DEFAULT PRIVILEGES de la sección 4 ya cubren las que cree enregla_owner).
-- =============================================================================

-- 1. Roles ---------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'enregla_owner') THEN
    CREATE ROLE enregla_owner LOGIN PASSWORD 'CAMBIA-ESTA-CLAVE-DE-MIGRACIONES';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'enregla_app') THEN
    CREATE ROLE enregla_app LOGIN PASSWORD 'CAMBIA-ESTA-CLAVE-DE-LA-APP'
      NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;
  END IF;
END $$;

-- 2. Propiedad: el esquema y todas sus tablas/secuencias/funciones pasan a enregla_owner.
--    (Si la base la creó otro rol, p. ej. `enregla`, se transfiere todo lo suyo.)
ALTER SCHEMA public OWNER TO enregla_owner;
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
    EXECUTE format('ALTER TABLE public.%I OWNER TO enregla_owner', r.tablename);
  END LOOP;
  FOR r IN SELECT sequencename FROM pg_sequences WHERE schemaname = 'public' LOOP
    EXECUTE format('ALTER SEQUENCE public.%I OWNER TO enregla_owner', r.sequencename);
  END LOOP;
  FOR r IN SELECT p.oid::regprocedure AS fn FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' LOOP
    EXECUTE format('ALTER FUNCTION %s OWNER TO enregla_owner', r.fn);
  END LOOP;
END $$;

-- 3. Permisos del rol de ejecución ------------------------------------------------
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO enregla_app;            -- sin CREATE: no puede hacer DDL

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO enregla_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO enregla_app;

-- Registros APPCC: solo leer y añadir. Ni UPDATE, ni DELETE, ni TRUNCATE.
-- El borrado en cascada al eliminar un local lo ejecuta PostgreSQL con los permisos del
-- dueño de la tabla (las acciones referenciales no requieren DELETE al rol de la app), y el
-- trigger `records_immutable` solo lo deja pasar cuando la organización ya no existe.
REVOKE UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON records FROM enregla_app;

-- La tabla de control de migraciones solo la toca el rol de migraciones.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON schema_migrations FROM enregla_app;

-- 4. Tablas futuras creadas por enregla_owner (migraciones) ------------------------
ALTER DEFAULT PRIVILEGES FOR ROLE enregla_owner IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO enregla_app;
ALTER DEFAULT PRIVILEGES FOR ROLE enregla_owner IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO enregla_app;

-- 5. Comprobación rápida (debe fallar con "permission denied"):
--   SET ROLE enregla_app;
--   UPDATE records SET alert = alert;      -- ERROR: permission denied for table records
--   ALTER TABLE records DISABLE TRIGGER ALL; -- ERROR: must be owner of table records
--   RESET ROLE;
