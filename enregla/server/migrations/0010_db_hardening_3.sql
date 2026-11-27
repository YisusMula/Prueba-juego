-- EnRegla: tercera ronda de endurecimiento de la base de datos (tercera evaluación de la fase 1).
-- Migración ADITIVA (columnas, tabla, índices únicos, FK compuestas y funciones/triggers). Todas las
-- funciones fijan search_path = pg_catalog, public, pg_temp y usan nombres calificados.
--
--  R2  la hora de registros, auditoría e historial la pone el RELOJ (clock_timestamp), no la hora de
--      inicio de la transacción (now()): una transacción abierta no sirve para atrasar nada;
--  R3  nada de un local puede apuntar a otro local: FK compuestas (organization_id, X) y
--      comprobaciones del JSON de los registros (proveedor, equipo, plan) y de las enmiendas;
--  R4  eventos de auditoría reservados (db.*, org.purged, maintenance.*) solo los escribe el
--      propietario; cambios de facturación auditados; ninguna purga sin verificar en Stripe las
--      suscripciones que el local haya tenido; quien pide una eliminación debe ser propietario real;
--  R9  el alta de equipos y planes toma la hora del reloj (el historial no nace atrasado);
--  R7  bloqueo progresivo del PIN (nivel de bloqueo por persona).

-- 1. Reloj del servidor (R2, R9) ----------------------------------------------------------------------
ALTER TABLE public.records ALTER COLUMN created_at SET DEFAULT pg_catalog.clock_timestamp();
ALTER TABLE public.audit_events ALTER COLUMN created_at SET DEFAULT pg_catalog.clock_timestamp();
ALTER TABLE public.equipment ALTER COLUMN created_at SET DEFAULT pg_catalog.clock_timestamp();
ALTER TABLE public.cleaning_plans ALTER COLUMN created_at SET DEFAULT pg_catalog.clock_timestamp();

CREATE OR REPLACE FUNCTION public.records_server_clock() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF NOT public.enregla_caller_is_owner() THEN
    -- clock_timestamp(): la hora REAL del INSERT (now() sería la del BEGIN de la transacción).
    NEW.created_at := pg_catalog.clock_timestamp();
    NEW.seq := pg_catalog.nextval('public.records_seq_seq'::pg_catalog.regclass);
  END IF;
  RETURN NEW;
END;
$$;

-- Eventos que solo puede escribir el propietario (triggers SECURITY DEFINER, purga, mantenimiento).
CREATE OR REPLACE FUNCTION public.enregla_reserved_audit_event(ev text) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT ev LIKE 'db.%' OR ev LIKE 'maintenance.%' OR ev IN ('org.purged')
$$;

CREATE OR REPLACE FUNCTION public.audit_events_server_clock() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF NOT public.enregla_caller_is_owner() THEN
    IF public.enregla_reserved_audit_event(NEW.event) THEN
      RAISE EXCEPTION 'El evento de auditoría % solo lo registra la base de datos', NEW.event USING ERRCODE = 'insufficient_privilege';
    END IF;
    NEW.created_at := pg_catalog.clock_timestamp();
  END IF;
  RETURN NEW;
END;
$$;

-- Alta de equipos y planes: para quien no es el propietario, la hora del reloj (R9).
CREATE OR REPLACE FUNCTION public.config_server_clock() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF NOT public.enregla_caller_is_owner() THEN
    NEW.created_at := pg_catalog.clock_timestamp();
    NEW.updated_at := NEW.created_at;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS equipment_clock_trg ON public.equipment;
CREATE TRIGGER equipment_clock_trg BEFORE INSERT ON public.equipment
  FOR EACH ROW EXECUTE FUNCTION public.config_server_clock();
DROP TRIGGER IF EXISTS cleaning_plans_clock_trg ON public.cleaning_plans;
CREATE TRIGGER cleaning_plans_clock_trg BEFORE INSERT ON public.cleaning_plans
  FOR EACH ROW EXECUTE FUNCTION public.config_server_clock();

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
    VALUES (NEW.id, NEW.organization_id, pg_catalog.clock_timestamp(), NEW.checks_per_day, NEW.active);
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
    VALUES (NEW.id, NEW.organization_id, pg_catalog.clock_timestamp(), NEW.frequency, NEW.weekday, NEW.month_day, NEW.active);
  END IF;
  RETURN NEW;
END;
$$;

-- 2. Nada de un local apunta a otro local (R3) -----------------------------------------------------
-- La migración comprueba antes los datos existentes y se detiene con un mensaje claro si algo no cuadra.
DO $$
DECLARE n bigint;
BEGIN
  SELECT
    (SELECT pg_catalog.count(*) FROM public.records r JOIN public.records o ON o.id = r.amends_record_id WHERE o.organization_id <> r.organization_id OR o.type <> r.type)
  + (SELECT pg_catalog.count(*) FROM public.records r JOIN public.equipment e ON e.id = r.equipment_id WHERE e.organization_id <> r.organization_id)
  + (SELECT pg_catalog.count(*) FROM public.records r JOIN public.cleaning_plans p ON p.id = r.cleaning_plan_id WHERE p.organization_id <> r.organization_id)
  + (SELECT pg_catalog.count(*) FROM public.records r JOIN public.staff s ON s.id = r.staff_id WHERE s.organization_id <> r.organization_id)
  + (SELECT pg_catalog.count(*) FROM public.records r JOIN public.devices d ON d.id = r.device_id WHERE d.organization_id <> r.organization_id)
  + (SELECT pg_catalog.count(*) FROM public.equipment_config_history h JOIN public.equipment e ON e.id = h.equipment_id WHERE e.organization_id <> h.organization_id)
  + (SELECT pg_catalog.count(*) FROM public.cleaning_plan_config_history h JOIN public.cleaning_plans p ON p.id = h.cleaning_plan_id WHERE p.organization_id <> h.organization_id)
  + (SELECT pg_catalog.count(*) FROM public.idempotency_keys k JOIN public.records r ON r.id = k.record_id WHERE r.organization_id <> k.organization_id)
  INTO n;
  IF n > 0 THEN
    RAISE EXCEPTION 'Hay % referencias entre locales distintos (o enmiendas de otro tipo): revísalas antes de aplicar 0010', n;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS records_org_id_uidx ON public.records (organization_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS equipment_org_id_uidx ON public.equipment (organization_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS cleaning_plans_org_id_uidx ON public.cleaning_plans (organization_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS staff_org_id_uidx ON public.staff (organization_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS devices_org_id_uidx ON public.devices (organization_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS suppliers_org_id_uidx ON public.suppliers (organization_id, id);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint WHERE conname = 'records_org_amends_fk') THEN
    ALTER TABLE public.records ADD CONSTRAINT records_org_amends_fk FOREIGN KEY (organization_id, amends_record_id)
      REFERENCES public.records (organization_id, id) ON DELETE CASCADE;
    ALTER TABLE public.records ADD CONSTRAINT records_org_equipment_fk FOREIGN KEY (organization_id, equipment_id)
      REFERENCES public.equipment (organization_id, id) ON DELETE CASCADE;
    ALTER TABLE public.records ADD CONSTRAINT records_org_cleaning_plan_fk FOREIGN KEY (organization_id, cleaning_plan_id)
      REFERENCES public.cleaning_plans (organization_id, id) ON DELETE CASCADE;
    ALTER TABLE public.records ADD CONSTRAINT records_org_staff_fk FOREIGN KEY (organization_id, staff_id)
      REFERENCES public.staff (organization_id, id) ON DELETE CASCADE;
    ALTER TABLE public.records ADD CONSTRAINT records_org_device_fk FOREIGN KEY (organization_id, device_id)
      REFERENCES public.devices (organization_id, id) ON DELETE CASCADE;
    ALTER TABLE public.equipment_config_history ADD CONSTRAINT equipment_history_org_fk FOREIGN KEY (organization_id, equipment_id)
      REFERENCES public.equipment (organization_id, id) ON DELETE CASCADE;
    ALTER TABLE public.cleaning_plan_config_history ADD CONSTRAINT cleaning_plan_history_org_fk FOREIGN KEY (organization_id, cleaning_plan_id)
      REFERENCES public.cleaning_plans (organization_id, id) ON DELETE CASCADE;
    ALTER TABLE public.idempotency_keys ADD CONSTRAINT idempotency_keys_org_record_fk FOREIGN KEY (organization_id, record_id)
      REFERENCES public.records (organization_id, id) ON DELETE CASCADE;
  END IF;
END $$;

-- Lo que va dentro del JSON del registro también debe ser del mismo local, y una enmienda solo puede
-- corregir un registro del mismo local y tipo (su fecha es la del original).
CREATE OR REPLACE FUNCTION public.records_set_effective_at() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE o_org uuid; o_type text; o_eff timestamptz;
BEGIN
  IF NEW.data ? 'equipmentId' AND (NEW.data->>'equipmentId') IS DISTINCT FROM NEW.equipment_id::text THEN
    RAISE EXCEPTION 'El equipo del registro no coincide' USING ERRCODE = 'foreign_key_violation';
  END IF;
  IF NEW.data ? 'cleaningPlanId' AND (NEW.data->>'cleaningPlanId') IS DISTINCT FROM NEW.cleaning_plan_id::text THEN
    RAISE EXCEPTION 'El plan de limpieza del registro no coincide' USING ERRCODE = 'foreign_key_violation';
  END IF;
  IF pg_catalog.jsonb_typeof(NEW.data->'supplierId') = 'string' AND NOT EXISTS (
       SELECT 1 FROM public.suppliers s WHERE s.organization_id = NEW.organization_id AND s.id::text = NEW.data->>'supplierId') THEN
    RAISE EXCEPTION 'El proveedor del registro no es de este local' USING ERRCODE = 'foreign_key_violation';
  END IF;
  IF NEW.amends_record_id IS NULL THEN
    NEW.effective_at := NEW.created_at;
  ELSE
    SELECT r.organization_id, r.type::text, coalesce(r.effective_at, r.created_at) INTO o_org, o_type, o_eff
      FROM public.records r WHERE r.id = NEW.amends_record_id;
    IF o_org IS DISTINCT FROM NEW.organization_id OR o_type IS DISTINCT FROM NEW.type::text THEN
      RAISE EXCEPTION 'Una enmienda solo puede corregir un registro del mismo local y tipo' USING ERRCODE = 'foreign_key_violation';
    END IF;
    NEW.effective_at := coalesce(o_eff, NEW.created_at);
  END IF;
  RETURN NEW;
END;
$$;

-- 3. Eliminación de locales: quién la pide y por qué (R4 c, d) -------------------------------------
ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS purge_requested_by uuid;

CREATE OR REPLACE FUNCTION public.enregla_is_org_owner(org uuid, uid uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT uid IS NOT NULL AND EXISTS (SELECT 1 FROM public.memberships m WHERE m.organization_id = org AND m.user_id = uid AND m.role = 'owner')
$$;

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
    IF NEW.purge_blocked_reason IS NOT NULL THEN
      RAISE EXCEPTION 'purge_blocked_reason solo lo cambia el mantenimiento' USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.deletion_requested_at IS DISTINCT FROM OLD.deletion_requested_at AND NEW.deletion_requested_at IS NOT NULL
     AND abs(extract(epoch FROM (NEW.deletion_requested_at - pg_catalog.clock_timestamp()))) > 300 THEN
    RAISE EXCEPTION 'La fecha de la solicitud de eliminación debe ser la actual' USING ERRCODE = 'check_violation';
  END IF;
  -- Quien pide la eliminación (o figura como tal) debe ser propietario real del local.
  IF NEW.deletion_requested_at IS NOT NULL
     AND (NEW.deletion_requested_at IS DISTINCT FROM OLD.deletion_requested_at OR NEW.deletion_requested_by IS DISTINCT FROM OLD.deletion_requested_by)
     AND NOT public.enregla_is_org_owner(NEW.id, NEW.deletion_requested_by) THEN
    RAISE EXCEPTION 'La eliminación solo la puede pedir un propietario del local' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.deletion_scheduled_at IS NOT NULL AND NEW.deletion_scheduled_at IS DISTINCT FROM OLD.deletion_scheduled_at
     AND (NEW.deletion_requested_at IS NULL
          OR NEW.deletion_scheduled_at < NEW.deletion_requested_at + pg_catalog.make_interval(days => grace) - interval '1 minute') THEN
    RAISE EXCEPTION 'La eliminación no puede programarse antes de % días desde la solicitud', grace USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.purge_requested_at IS NOT NULL AND (NEW.purge_requested_at IS DISTINCT FROM OLD.purge_requested_at OR NEW.purge_requested_by IS DISTINCT FROM OLD.purge_requested_by) THEN
    IF NEW.deletion_scheduled_at IS NULL OR abs(extract(epoch FROM (NEW.purge_requested_at - pg_catalog.clock_timestamp()))) > 300 THEN
      RAISE EXCEPTION 'Solo se puede pedir la eliminación inmediata de un local pendiente de eliminación, con la hora actual' USING ERRCODE = 'check_violation';
    END IF;
    IF NOT public.enregla_is_org_owner(NEW.id, NEW.purge_requested_by) THEN
      RAISE EXCEPTION 'La eliminación inmediata solo la puede pedir un propietario del local' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF NEW.purge_blocked_reason IS DISTINCT FROM OLD.purge_blocked_reason THEN
    RAISE EXCEPTION 'purge_blocked_reason solo lo cambia el mantenimiento' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.organizations_deletion_audit() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF NEW.deletion_requested_at IS DISTINCT FROM OLD.deletion_requested_at
     OR NEW.deletion_scheduled_at IS DISTINCT FROM OLD.deletion_scheduled_at
     OR NEW.purge_requested_at IS DISTINCT FROM OLD.purge_requested_at THEN
    INSERT INTO public.audit_events (organization_id, user_id, event, metadata)
    VALUES (NEW.id, coalesce(NEW.purge_requested_by, NEW.deletion_requested_by), 'db.org_deletion_changed', pg_catalog.jsonb_build_object(
      'old', pg_catalog.jsonb_build_object('deletion_requested_at', OLD.deletion_requested_at, 'deletion_scheduled_at', OLD.deletion_scheduled_at, 'purge_requested_at', OLD.purge_requested_at),
      'new', pg_catalog.jsonb_build_object('deletion_requested_at', NEW.deletion_requested_at, 'deletion_scheduled_at', NEW.deletion_scheduled_at, 'purge_requested_at', NEW.purge_requested_at,
                                           'deletion_requested_by', NEW.deletion_requested_by, 'purge_requested_by', NEW.purge_requested_by),
      'session_user', session_user::text,
      'client_addr', pg_catalog.inet_client_addr()::text));
  END IF;
  RETURN NEW;
END;
$$;

-- 4. Facturación: cambios auditados y suscripciones que el local ha tenido (R4 b) ------------------
-- Tabla solo del propietario: cada suscripción de Stripe que un local ha tenido. La purga no borra un
-- local mientras alguna no esté verificada como terminada EN STRIPE por el mantenimiento (vaciar
-- stripe_subscription_id en la base de datos ya no basta para esquivar la comprobación).
CREATE TABLE IF NOT EXISTS public.enregla_org_subscriptions (
  organization_id uuid NOT NULL,
  subscription_id text NOT NULL,
  first_seen_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  verified_terminal_at timestamptz,
  PRIMARY KEY (organization_id, subscription_id)
);
REVOKE ALL ON public.enregla_org_subscriptions FROM PUBLIC;
INSERT INTO public.enregla_org_subscriptions (organization_id, subscription_id)
  SELECT o.id, o.stripe_subscription_id FROM public.organizations o WHERE o.stripe_subscription_id IS NOT NULL
ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION public.organizations_billing_audit() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF NEW.stripe_subscription_id IS NOT NULL AND (TG_OP = 'INSERT' OR NEW.stripe_subscription_id IS DISTINCT FROM OLD.stripe_subscription_id) THEN
    INSERT INTO public.enregla_org_subscriptions (organization_id, subscription_id) VALUES (NEW.id, NEW.stripe_subscription_id)
    ON CONFLICT (organization_id, subscription_id) DO UPDATE SET verified_terminal_at = NULL;
  END IF;
  IF TG_OP = 'UPDATE' AND (NEW.stripe_subscription_id IS DISTINCT FROM OLD.stripe_subscription_id OR NEW.subscription_status IS DISTINCT FROM OLD.subscription_status) THEN
    INSERT INTO public.audit_events (organization_id, event, metadata)
    VALUES (NEW.id, 'db.org_billing_changed', pg_catalog.jsonb_build_object(
      'old', pg_catalog.jsonb_build_object('stripe_subscription_id', OLD.stripe_subscription_id, 'subscription_status', OLD.subscription_status),
      'new', pg_catalog.jsonb_build_object('stripe_subscription_id', NEW.stripe_subscription_id, 'subscription_status', NEW.subscription_status),
      'session_user', session_user::text,
      'client_addr', pg_catalog.inet_client_addr()::text));
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS organizations_billing_audit_trg ON public.organizations;
CREATE TRIGGER organizations_billing_audit_trg AFTER INSERT OR UPDATE ON public.organizations
  FOR EACH ROW EXECUTE FUNCTION public.organizations_billing_audit();

-- 5. Purga: elegibilidad, motivo neutro y salvaguarda que cuenta solo lo que se va a purgar ----------
-- NULL si se puede purgar; si no, el motivo (y lo deja en purge_blocked_reason cuando es un bloqueo).
CREATE OR REPLACE FUNCTION public.enregla_purge_blocker(org_id uuid) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE o public.organizations%ROWTYPE; why text;
BEGIN
  SELECT * INTO o FROM public.organizations WHERE id = org_id;
  IF NOT FOUND OR o.deletion_scheduled_at IS NULL THEN RETURN 'no_pendiente'; END IF;
  IF o.deletion_scheduled_at > pg_catalog.clock_timestamp() AND o.purge_requested_at IS NULL THEN RETURN 'dentro_del_plazo'; END IF;
  IF o.stripe_subscription_id IS NOT NULL AND o.subscription_status IN ('active', 'trialing', 'past_due', 'incomplete', 'unpaid', 'paused') THEN
    why := 'suscripcion_viva';
  ELSIF EXISTS (SELECT 1 FROM public.enregla_org_subscriptions s WHERE s.organization_id = org_id AND s.verified_terminal_at IS NULL) THEN
    why := 'suscripcion_sin_verificar_en_stripe';
  END IF;
  IF why IS NOT NULL AND o.purge_blocked_reason IS DISTINCT FROM why THEN
    UPDATE public.organizations SET purge_blocked_reason = why WHERE id = org_id;
  END IF;
  RETURN why;
END;
$$;

CREATE OR REPLACE FUNCTION public.enregla_purge_organization(org_id uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE o public.organizations%ROWTYPE; n_records bigint; reason text;
BEGIN
  SELECT * INTO o FROM public.organizations WHERE id = org_id FOR UPDATE;
  IF NOT FOUND OR o.deletion_scheduled_at IS NULL THEN RETURN false; END IF;
  IF public.enregla_purge_blocker(org_id) IS NOT NULL THEN RETURN false; END IF;
  -- Motivo neutro: la base de datos sabe que lo pidió un propietario del local (lo comprueba el
  -- trigger), no que fuera él en persona (podría ser alguien con las credenciales de la app).
  reason := CASE WHEN o.deletion_scheduled_at <= pg_catalog.clock_timestamp() THEN 'plazo_vencido' ELSE 'eliminacion_inmediata_solicitada' END;
  SELECT pg_catalog.count(*) INTO n_records FROM public.records r WHERE r.organization_id = org_id;
  DELETE FROM public.organizations WHERE id = org_id;
  DELETE FROM public.enregla_org_subscriptions WHERE organization_id = org_id;
  INSERT INTO public.audit_events (organization_id, user_id, event, metadata)
  VALUES (org_id, coalesce(o.purge_requested_by, o.deletion_requested_by), 'org.purged', pg_catalog.jsonb_build_object(
    'name', o.name, 'reason', reason, 'records', n_records,
    'deletion_requested_at', o.deletion_requested_at, 'deletion_requested_by', o.deletion_requested_by,
    'deletion_scheduled_at', o.deletion_scheduled_at,
    'purge_requested_at', o.purge_requested_at, 'purge_requested_by', o.purge_requested_by,
    'session_user', session_user::text, 'client_addr', pg_catalog.inet_client_addr()::text));
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.enregla_purge_due_organizations() RETURNS pg_catalog.jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  maxn int := public.enregla_setting_int('max_purges_per_day', 3);
  due uuid[];
  eligible uuid[] := '{}';
  recent int;
  purged int := 0;
  skipped int := 0;
  id uuid;
BEGIN
  SELECT pg_catalog.array_agg(o.id ORDER BY o.deletion_scheduled_at) INTO due FROM public.organizations o
   WHERE o.deletion_scheduled_at IS NOT NULL AND (o.deletion_scheduled_at <= pg_catalog.clock_timestamp() OR o.purge_requested_at IS NOT NULL);
  IF due IS NULL THEN RETURN pg_catalog.jsonb_build_object('due', 0, 'purged', 0, 'skipped', 0, 'blocked', false); END IF;
  -- Los que no se pueden purgar (facturación sin verificar) no cuentan para la salvaguarda.
  FOREACH id IN ARRAY due LOOP
    IF public.enregla_purge_blocker(id) IS NULL THEN eligible := eligible || id; ELSE skipped := skipped + 1; END IF;
  END LOOP;
  IF pg_catalog.cardinality(eligible) = 0 THEN
    RETURN pg_catalog.jsonb_build_object('due', pg_catalog.cardinality(due), 'purged', 0, 'skipped', skipped, 'blocked', false);
  END IF;
  -- org.purged solo lo puede escribir el propietario (evento reservado): el recuento es fiable.
  SELECT pg_catalog.count(*) INTO recent FROM public.audit_events a WHERE a.event = 'org.purged' AND a.created_at > pg_catalog.clock_timestamp() - interval '24 hours';
  IF recent + pg_catalog.cardinality(eligible) > maxn THEN
    INSERT INTO public.audit_events (event, metadata) VALUES ('maintenance.purge_blocked', pg_catalog.jsonb_build_object(
      'due', pg_catalog.cardinality(eligible), 'purged_last_24h', recent, 'max_per_day', maxn, 'organizations', pg_catalog.to_jsonb(eligible)));
    RETURN pg_catalog.jsonb_build_object('due', pg_catalog.cardinality(due), 'eligible', pg_catalog.cardinality(eligible), 'purged', 0, 'skipped', skipped,
                                         'blocked', true, 'purged_last_24h', recent, 'max_per_day', maxn);
  END IF;
  FOREACH id IN ARRAY eligible LOOP
    IF public.enregla_purge_organization(id) THEN purged := purged + 1; ELSE skipped := skipped + 1; END IF;
  END LOOP;
  RETURN pg_catalog.jsonb_build_object('due', pg_catalog.cardinality(due), 'purged', purged, 'skipped', skipped, 'blocked', false);
END;
$$;

CREATE OR REPLACE FUNCTION public.enregla_purge_audit_events(months int) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE n bigint; m int := GREATEST(coalesce(months, 0), public.enregla_setting_int('audit_min_months', 12));
BEGIN
  DELETE FROM public.audit_events WHERE created_at < pg_catalog.clock_timestamp() - pg_catalog.make_interval(months => m);
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;

-- 6. PIN: bloqueo progresivo (R7) -----------------------------------------------------------------
ALTER TABLE public.staff ADD COLUMN IF NOT EXISTS pin_lock_level integer NOT NULL DEFAULT 0;

-- 7. Nadie más que el propietario ejecuta funciones por defecto (R1). `migrate` lo vuelve a aplicar
--    en cada despliegue (también tras restaurar una copia sin permisos) y concede lo justo a cada rol.
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC;
ALTER DEFAULT PRIVILEGES REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
