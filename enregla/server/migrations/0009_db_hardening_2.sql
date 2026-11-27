-- EnRegla: segunda ronda de endurecimiento de la base de datos (reevaluación de la fase 1).
-- Migración ADITIVA: una tabla de ajustes del propietario, triggers y funciones. Todas las funciones
-- de trigger y SECURITY DEFINER fijan search_path = pg_catalog, public, pg_temp y usan nombres
-- calificados (una tabla temporal llamada pg_class o records no puede suplantarlas).
--
-- Objetivos frente al rol de ejecución de la app:
--  * no puede purgar locales (ni ejecutar la función de purga): la purga la hace el MANTENIMIENTO,
--    con el rol propietario, solo de locales cuyo plazo venció o cuyo titular pidió la eliminación
--    inmediata, con un tope diario y dejando constancia en la auditoría;
--  * cualquier cambio de los campos de eliminación de un local y cualquier baja de un miembro queda
--    auditado por la base de datos (no por la app), con session_user;
--  * no puede programar una eliminación antes del plazo ni con fechas falsas;
--  * no puede fijar la hora de un evento de auditoría, ni purgarla, ni seudonimizar a usuarios vivos;
--  * no puede crear tablas temporales.

-- 0. Ajustes que solo cambia el propietario ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.enregla_owner_settings (
  key text PRIMARY KEY,
  value text NOT NULL
);
INSERT INTO public.enregla_owner_settings (key, value) VALUES
  ('org_deletion_grace_days', '30'),
  ('max_purges_per_day', '3'),
  ('audit_min_months', '12')
ON CONFLICT (key) DO NOTHING;

-- ¿Quien llama es (o pertenece a) el propietario del esquema? (sin SECURITY DEFINER: mira current_user)
CREATE OR REPLACE FUNCTION public.enregla_caller_is_owner() RETURNS boolean
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT pg_catalog.pg_has_role(current_user, c.relowner, 'MEMBER')
  FROM pg_catalog.pg_class c WHERE c.oid = 'public.records'::pg_catalog.regclass
$$;
-- Lo mismo para usar dentro de funciones SECURITY DEFINER (ahí current_user es el propietario).
CREATE OR REPLACE FUNCTION public.enregla_session_is_owner() RETURNS boolean
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT pg_catalog.pg_has_role(session_user, c.relowner, 'MEMBER')
  FROM pg_catalog.pg_class c WHERE c.oid = 'public.records'::pg_catalog.regclass
$$;

CREATE OR REPLACE FUNCTION public.enregla_setting_int(k text, dflt int) RETURNS int
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT coalesce((SELECT s.value::int FROM public.enregla_owner_settings s WHERE s.key = k), dflt)
$$;

-- 1. Triggers de registros, reescritos con nombres calificados -------------------------------------
CREATE OR REPLACE FUNCTION public.records_immutable() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF TG_OP = 'DELETE' AND NOT EXISTS (SELECT 1 FROM public.organizations o WHERE o.id = OLD.organization_id) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'records are append-only' USING ERRCODE = 'restrict_violation';
END;
$$;

CREATE OR REPLACE FUNCTION public.records_set_effective_at() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF NEW.amends_record_id IS NULL THEN
    NEW.effective_at := NEW.created_at;
  ELSE
    SELECT coalesce(r.effective_at, r.created_at) INTO NEW.effective_at FROM public.records r WHERE r.id = NEW.amends_record_id;
    NEW.effective_at := coalesce(NEW.effective_at, NEW.created_at);
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.records_server_clock() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF NOT public.enregla_caller_is_owner() THEN
    NEW.created_at := pg_catalog.now();
    NEW.seq := pg_catalog.nextval('public.records_seq_seq'::pg_catalog.regclass);
  END IF;
  RETURN NEW;
END;
$$;

-- 2. Historial de configuración: el primer tramo solo lo mueve el propietario (datos de demostración)
CREATE OR REPLACE FUNCTION public.equipment_config_history_trg() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.equipment_config_history (equipment_id, organization_id, valid_from, checks_per_day, active)
    VALUES (NEW.id, NEW.organization_id, NEW.created_at, NEW.checks_per_day, NEW.active);
    RETURN NEW;
  END IF;
  IF NEW.created_at IS DISTINCT FROM OLD.created_at AND public.enregla_session_is_owner() THEN
    UPDATE public.equipment_config_history SET valid_from = NEW.created_at
    WHERE equipment_id = NEW.id AND valid_from = OLD.created_at;
  END IF;
  IF NEW.checks_per_day IS DISTINCT FROM OLD.checks_per_day OR NEW.active IS DISTINCT FROM OLD.active THEN
    INSERT INTO public.equipment_config_history (equipment_id, organization_id, valid_from, checks_per_day, active)
    VALUES (NEW.id, NEW.organization_id, pg_catalog.now(), NEW.checks_per_day, NEW.active);
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.cleaning_plan_config_history_trg() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.cleaning_plan_config_history (cleaning_plan_id, organization_id, valid_from, frequency, weekday, month_day, active)
    VALUES (NEW.id, NEW.organization_id, NEW.created_at, NEW.frequency, NEW.weekday, NEW.month_day, NEW.active);
    RETURN NEW;
  END IF;
  IF NEW.created_at IS DISTINCT FROM OLD.created_at AND public.enregla_session_is_owner() THEN
    UPDATE public.cleaning_plan_config_history SET valid_from = NEW.created_at
    WHERE cleaning_plan_id = NEW.id AND valid_from = OLD.created_at;
  END IF;
  IF NEW.frequency IS DISTINCT FROM OLD.frequency OR NEW.weekday IS DISTINCT FROM OLD.weekday
     OR NEW.month_day IS DISTINCT FROM OLD.month_day OR NEW.active IS DISTINCT FROM OLD.active THEN
    INSERT INTO public.cleaning_plan_config_history (cleaning_plan_id, organization_id, valid_from, frequency, weekday, month_day, active)
    VALUES (NEW.id, NEW.organization_id, pg_catalog.now(), NEW.frequency, NEW.weekday, NEW.month_day, NEW.active);
  END IF;
  RETURN NEW;
END;
$$;

-- 3. Auditoría: la hora la pone PostgreSQL para quien no es el propietario --------------------------
CREATE OR REPLACE FUNCTION public.audit_events_server_clock() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF NOT public.enregla_caller_is_owner() THEN
    NEW.created_at := pg_catalog.now();
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS audit_events_clock_trg ON public.audit_events;
CREATE TRIGGER audit_events_clock_trg BEFORE INSERT ON public.audit_events
  FOR EACH ROW EXECUTE FUNCTION public.audit_events_server_clock();

-- 4. Eliminación de locales: reglas y auditoría de la base de datos ---------------------------------
ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS purge_blocked_reason text;

-- Quien no es el propietario no puede programar la eliminación antes del plazo, ni con fechas
-- falsas, ni pedir la eliminación inmediata de un local que no está pendiente.
CREATE OR REPLACE FUNCTION public.organizations_deletion_rules() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE grace int := public.enregla_setting_int('org_deletion_grace_days', 30);
BEGIN
  IF public.enregla_caller_is_owner() THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.deletion_requested_at IS NOT NULL OR NEW.deletion_scheduled_at IS NOT NULL OR NEW.purge_requested_at IS NOT NULL THEN
      RAISE EXCEPTION 'Un local nuevo no puede nacer pendiente de eliminación' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.deletion_requested_at IS DISTINCT FROM OLD.deletion_requested_at AND NEW.deletion_requested_at IS NOT NULL
     AND abs(extract(epoch FROM (NEW.deletion_requested_at - pg_catalog.now()))) > 300 THEN
    RAISE EXCEPTION 'La fecha de la solicitud de eliminación debe ser la actual' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.deletion_scheduled_at IS NOT NULL AND NEW.deletion_scheduled_at IS DISTINCT FROM OLD.deletion_scheduled_at
     AND (NEW.deletion_requested_at IS NULL
          OR NEW.deletion_scheduled_at < NEW.deletion_requested_at + pg_catalog.make_interval(days => grace) - interval '1 minute') THEN
    RAISE EXCEPTION 'La eliminación no puede programarse antes de % días desde la solicitud', grace USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.purge_requested_at IS NOT NULL AND NEW.purge_requested_at IS DISTINCT FROM OLD.purge_requested_at
     AND (NEW.deletion_scheduled_at IS NULL OR abs(extract(epoch FROM (NEW.purge_requested_at - pg_catalog.now()))) > 300) THEN
    RAISE EXCEPTION 'Solo se puede pedir la eliminación inmediata de un local pendiente de eliminación, con la hora actual' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.purge_blocked_reason IS DISTINCT FROM OLD.purge_blocked_reason THEN
    RAISE EXCEPTION 'purge_blocked_reason solo lo cambia el mantenimiento' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS organizations_deletion_rules_trg ON public.organizations;
CREATE TRIGGER organizations_deletion_rules_trg BEFORE INSERT OR UPDATE ON public.organizations
  FOR EACH ROW EXECUTE FUNCTION public.organizations_deletion_rules();

-- Auditoría hecha por la base de datos (la app no puede omitirla ni borrarla).
CREATE OR REPLACE FUNCTION public.organizations_deletion_audit() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF NEW.deletion_requested_at IS DISTINCT FROM OLD.deletion_requested_at
     OR NEW.deletion_scheduled_at IS DISTINCT FROM OLD.deletion_scheduled_at
     OR NEW.purge_requested_at IS DISTINCT FROM OLD.purge_requested_at THEN
    INSERT INTO public.audit_events (organization_id, user_id, event, metadata)
    VALUES (NEW.id, NEW.deletion_requested_by, 'db.org_deletion_changed', pg_catalog.jsonb_build_object(
      'old', pg_catalog.jsonb_build_object('deletion_requested_at', OLD.deletion_requested_at, 'deletion_scheduled_at', OLD.deletion_scheduled_at, 'purge_requested_at', OLD.purge_requested_at),
      'new', pg_catalog.jsonb_build_object('deletion_requested_at', NEW.deletion_requested_at, 'deletion_scheduled_at', NEW.deletion_scheduled_at, 'purge_requested_at', NEW.purge_requested_at),
      'session_user', session_user::text,
      'client_addr', pg_catalog.inet_client_addr()::text));
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS organizations_deletion_audit_trg ON public.organizations;
CREATE TRIGGER organizations_deletion_audit_trg AFTER UPDATE ON public.organizations
  FOR EACH ROW EXECUTE FUNCTION public.organizations_deletion_audit();

CREATE OR REPLACE FUNCTION public.memberships_delete_audit() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  -- En la purga de un local se borran sus miembros en cascada: eso ya lo audita la purga.
  IF EXISTS (SELECT 1 FROM public.organizations o WHERE o.id = OLD.organization_id) THEN
    INSERT INTO public.audit_events (organization_id, user_id, event, metadata)
    VALUES (OLD.organization_id, OLD.user_id, 'db.membership_deleted',
            pg_catalog.jsonb_build_object('role', OLD.role, 'session_user', session_user::text, 'client_addr', pg_catalog.inet_client_addr()::text));
  END IF;
  RETURN OLD;
END;
$$;
DROP TRIGGER IF EXISTS memberships_delete_audit_trg ON public.memberships;
CREATE TRIGGER memberships_delete_audit_trg AFTER DELETE ON public.memberships
  FOR EACH ROW EXECUTE FUNCTION public.memberships_delete_audit();

-- 5. Purga de locales: solo el mantenimiento (rol propietario) ---------------------------------------
-- Ya no hay purga por «sin miembros»: un local pendiente sin miembros espera a su plazo.
CREATE OR REPLACE FUNCTION public.enregla_purge_organization(org_id uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE o public.organizations%ROWTYPE; n_records bigint; reason text;
BEGIN
  SELECT * INTO o FROM public.organizations WHERE id = org_id FOR UPDATE;
  IF NOT FOUND OR o.deletion_scheduled_at IS NULL THEN RETURN false; END IF;
  IF o.deletion_scheduled_at <= pg_catalog.now() THEN reason := 'plazo_vencido';
  ELSIF o.purge_requested_at IS NOT NULL THEN reason := 'eliminacion_inmediata_del_titular';
  ELSE RETURN false;
  END IF;
  -- Nada puede seguir cobrando: con una suscripción viva no se purga (la app la cancela antes).
  IF o.stripe_subscription_id IS NOT NULL AND o.subscription_status IN ('active', 'trialing', 'past_due', 'incomplete', 'unpaid', 'paused') THEN
    UPDATE public.organizations SET purge_blocked_reason = 'suscripcion_viva' WHERE id = org_id;
    RETURN false;
  END IF;
  SELECT pg_catalog.count(*) INTO n_records FROM public.records r WHERE r.organization_id = org_id;
  DELETE FROM public.organizations WHERE id = org_id;
  INSERT INTO public.audit_events (organization_id, user_id, event, metadata)
  VALUES (org_id, o.deletion_requested_by, 'org.purged', pg_catalog.jsonb_build_object(
    'name', o.name, 'reason', reason, 'records', n_records,
    'deletion_requested_at', o.deletion_requested_at, 'deletion_scheduled_at', o.deletion_scheduled_at, 'purge_requested_at', o.purge_requested_at,
    'session_user', session_user::text, 'client_addr', pg_catalog.inet_client_addr()::text));
  RETURN true;
END;
$$;

-- Una pasada de purga con salvaguarda: si en 24 h habría que purgar más locales de los permitidos,
-- no purga ninguno y lo deja registrado (el mantenimiento lo notifica).
CREATE OR REPLACE FUNCTION public.enregla_purge_due_organizations() RETURNS pg_catalog.jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  maxn int := public.enregla_setting_int('max_purges_per_day', 3);
  due uuid[];
  recent int;
  purged int := 0;
  skipped int := 0;
  id uuid;
BEGIN
  SELECT pg_catalog.array_agg(o.id ORDER BY o.deletion_scheduled_at) INTO due FROM public.organizations o
   WHERE o.deletion_scheduled_at IS NOT NULL AND (o.deletion_scheduled_at <= pg_catalog.now() OR o.purge_requested_at IS NOT NULL);
  IF due IS NULL THEN RETURN pg_catalog.jsonb_build_object('due', 0, 'purged', 0, 'skipped', 0, 'blocked', false); END IF;
  SELECT pg_catalog.count(*) INTO recent FROM public.audit_events a WHERE a.event = 'org.purged' AND a.created_at > pg_catalog.now() - interval '24 hours';
  IF recent + pg_catalog.cardinality(due) > maxn THEN
    INSERT INTO public.audit_events (event, metadata) VALUES ('maintenance.purge_blocked', pg_catalog.jsonb_build_object(
      'due', pg_catalog.cardinality(due), 'purged_last_24h', recent, 'max_per_day', maxn, 'organizations', pg_catalog.to_jsonb(due)));
    RETURN pg_catalog.jsonb_build_object('due', pg_catalog.cardinality(due), 'purged', 0, 'skipped', 0, 'blocked', true, 'purged_last_24h', recent, 'max_per_day', maxn);
  END IF;
  FOREACH id IN ARRAY due LOOP
    IF public.enregla_purge_organization(id) THEN purged := purged + 1; ELSE skipped := skipped + 1; END IF;
  END LOOP;
  RETURN pg_catalog.jsonb_build_object('due', pg_catalog.cardinality(due), 'purged', purged, 'skipped', skipped, 'blocked', false);
END;
$$;

-- 6. Auditoría: retención mínima fijada por el propietario y seudonimización solo de cuentas borradas
CREATE OR REPLACE FUNCTION public.enregla_purge_audit_events(months int) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE n bigint; m int := GREATEST(coalesce(months, 0), public.enregla_setting_int('audit_min_months', 12));
BEGIN
  DELETE FROM public.audit_events WHERE created_at < pg_catalog.now() - pg_catalog.make_interval(months => m);
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;

CREATE OR REPLACE FUNCTION public.enregla_pseudonymize_audit(uid uuid, mail text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.users u WHERE u.id = uid) THEN
    RAISE EXCEPTION 'Solo se seudonimiza la auditoría de una cuenta ya borrada' USING ERRCODE = 'insufficient_privilege';
  END IF;
  UPDATE public.audit_events SET ip = NULL, metadata = metadata - 'email' - 'from' - 'to' WHERE user_id = uid;
  -- El email solo se quita de eventos de terceros si ya no pertenece a ninguna cuenta.
  IF NOT EXISTS (SELECT 1 FROM public.users u WHERE u.email = mail) THEN
    UPDATE public.audit_events SET metadata = metadata - 'email' WHERE metadata->>'email' = mail;
  END IF;
END;
$$;

-- 7. Sin tablas temporales para nadie más que el propietario --------------------------------------
DO $$
BEGIN
  EXECUTE pg_catalog.format('REVOKE TEMPORARY ON DATABASE %I FROM PUBLIC', pg_catalog.current_database());
END $$;

REVOKE EXECUTE ON FUNCTION public.enregla_purge_organization(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.enregla_purge_due_organizations() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.enregla_purge_audit_events(int) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.enregla_pseudonymize_audit(uuid, text) FROM PUBLIC;
