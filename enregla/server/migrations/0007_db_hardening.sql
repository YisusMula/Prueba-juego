-- EnRegla: endurecimiento de la base de datos tras la evaluación de la fase 1 (1.8).
-- Migración ADITIVA: añade una columna nula, funciones y un trigger. El código anterior sigue
-- funcionando: si conecta como propietario (despliegue sin separación de roles) nada cambia, y las
-- funciones nuevas solo las usa el código nuevo.
--
-- Objetivo: que el ROL DE EJECUCIÓN de la app (sin ser propietario de nada) no pueda
--  * fijar la hora ni el orden de un registro (created_at / seq): los pone el servidor de BD;
--  * borrar registros al instante borrando su local (la cascada): solo se purga un local cuyo plazo
--    de conservación venció o cuya eliminación inmediata pidió su titular, mediante una función del
--    propietario;
--  * reescribir la auditoría ni el historial de configuración: la purga por antigüedad y la
--    seudonimización van por funciones acotadas del propietario.
-- Los permisos del rol de la app los fija `migrate` (server/src/db/privileges.ts).

-- 1. Hora y orden de inserción de los registros, puestos por PostgreSQL ------------------------
-- Solo el propietario de la tabla (migraciones, scripts de mantenimiento, tests) puede fijarlos.
-- Se ejecuta antes que records_effective_at_trg (los BEFORE se disparan por orden de nombre), así
-- que la fecha del hecho de un registro (y de sus correcciones) sale de la hora real.
CREATE OR REPLACE FUNCTION records_server_clock() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF current_user <> (SELECT pg_get_userbyid(relowner) FROM pg_class WHERE oid = TG_RELID) THEN
    NEW.created_at := now();
    NEW.seq := nextval('records_seq_seq');
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS records_clock_trg ON records;
CREATE TRIGGER records_clock_trg
  BEFORE INSERT ON records
  FOR EACH ROW EXECUTE FUNCTION records_server_clock();

-- 2. Purga de locales ------------------------------------------------------------------------------
-- Momento en que el titular pidió la eliminación inmediata (DELETE /orgs/{id}/permanent).
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS purge_requested_at timestamptz;

-- Borra un local (y en cascada sus registros) SOLO si está pendiente de eliminación y además su
-- plazo venció, su titular pidió la eliminación inmediata o ya no tiene ningún miembro (nadie
-- puede verlo ni restaurarlo). Devuelve true si lo ha borrado.
CREATE OR REPLACE FUNCTION enregla_purge_organization(org_id uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE n int;
BEGIN
  DELETE FROM organizations o
   WHERE o.id = org_id
     AND o.deletion_scheduled_at IS NOT NULL
     AND (o.deletion_scheduled_at <= now()
          OR o.purge_requested_at IS NOT NULL
          OR NOT EXISTS (SELECT 1 FROM memberships m WHERE m.organization_id = o.id));
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n > 0;
END;
$$;

-- 3. Auditoría: purga por antigüedad (mínimo 1 mes) y seudonimización al borrar una cuenta ------------
CREATE OR REPLACE FUNCTION enregla_purge_audit_events(months int) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE n bigint;
BEGIN
  IF months IS NULL OR months < 1 THEN
    RAISE EXCEPTION 'La retención de la auditoría es de al menos 1 mes';
  END IF;
  DELETE FROM audit_events WHERE created_at < now() - make_interval(months => months);
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;

-- Solo quita datos personales (IP y emails); no borra eventos ni cambia otros campos.
CREATE OR REPLACE FUNCTION enregla_pseudonymize_audit(uid uuid, mail text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  UPDATE audit_events SET ip = NULL, metadata = metadata - 'email' - 'from' - 'to' WHERE user_id = uid;
  UPDATE audit_events SET metadata = metadata - 'email' WHERE metadata->>'email' = mail;
END;
$$;

-- 4. El historial de configuración lo mantienen los triggers con los permisos del propietario: el rol
--    de la app solo lo lee.
ALTER FUNCTION equipment_config_history_trg() SECURITY DEFINER SET search_path = public, pg_temp;
ALTER FUNCTION cleaning_plan_config_history_trg() SECURITY DEFINER SET search_path = public, pg_temp;

-- Las funciones nuevas no se pueden ejecutar por defecto: `migrate` concede EXECUTE al rol de la app.
REVOKE EXECUTE ON FUNCTION enregla_purge_organization(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION enregla_purge_audit_events(int) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION enregla_pseudonymize_audit(uuid, text) FROM PUBLIC;
