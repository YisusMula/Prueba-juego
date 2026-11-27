-- EnRegla: correcciones de la evaluación independiente del bloque A de la fase 2.
-- Migración ADITIVA: columnas nulas, funciones y triggers reescritos (CREATE OR REPLACE). El código
-- anterior sigue funcionando (no lee las columnas nuevas; los triggers las rellenan).
--
--  H-M2  el historial de configuración guarda también el NOMBRE (y el rango) vigente: los huecos y el
--        cumplimiento de días pasados usan el nombre de ese día, no el actual;
--  H-M1  la verificación del responsable guarda una foto inmutable de lo que había al verificar
--        (`snapshot`) y el periodo verificado termina como muy tarde ayer;
--  H-M5  el nombre del verificador y el de quien firma un registro los pone la base de datos;
--  H-M4  una corrección de un enfriamiento conserva su fase y, si es un cierre, su inicio;
--  bajo  recordatorio «cada N meses» de un registro personalizado (verificación de termómetros).

-- 1. Historial de configuración con nombre y rango (H-M2) ---------------------------------------------
ALTER TABLE public.equipment_config_history ADD COLUMN IF NOT EXISTS name text;
ALTER TABLE public.equipment_config_history ADD COLUMN IF NOT EXISTS min_temp double precision;
ALTER TABLE public.equipment_config_history ADD COLUMN IF NOT EXISTS max_temp double precision;
ALTER TABLE public.cleaning_plan_config_history ADD COLUMN IF NOT EXISTS name text;
ALTER TABLE public.custom_template_config_history ADD COLUMN IF NOT EXISTS name text;
ALTER TABLE public.custom_template_config_history ADD COLUMN IF NOT EXISTS unit text;
ALTER TABLE public.custom_template_config_history ADD COLUMN IF NOT EXISTS min_value double precision;
ALTER TABLE public.custom_template_config_history ADD COLUMN IF NOT EXISTS max_value double precision;

-- Los tramos anteriores no guardaban el nombre: se rellenan con el actual (el mejor dato disponible;
-- los renombres anteriores a esta migración no se pueden reconstruir).
UPDATE public.equipment_config_history h SET name = e.name, min_temp = e.min_temp, max_temp = e.max_temp
  FROM public.equipment e WHERE e.id = h.equipment_id AND h.name IS NULL;
UPDATE public.cleaning_plan_config_history h SET name = p.name
  FROM public.cleaning_plans p WHERE p.id = h.cleaning_plan_id AND h.name IS NULL;
UPDATE public.custom_template_config_history h SET name = t.name, unit = t.unit, min_value = t.min_value, max_value = t.max_value
  FROM public.custom_record_templates t WHERE t.id = h.template_id AND h.name IS NULL;

CREATE OR REPLACE FUNCTION public.equipment_config_history_trg() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.equipment_config_history (equipment_id, organization_id, valid_from, checks_per_day, active, name, min_temp, max_temp)
    VALUES (NEW.id, NEW.organization_id, NEW.created_at, NEW.checks_per_day, NEW.active, NEW.name, NEW.min_temp, NEW.max_temp);
    RETURN NEW;
  END IF;
  IF NEW.created_at IS DISTINCT FROM OLD.created_at AND public.enregla_session_is_owner() THEN
    UPDATE public.equipment_config_history SET valid_from = NEW.created_at
    WHERE equipment_id = NEW.id AND valid_from = OLD.created_at;
  END IF;
  IF NEW.checks_per_day IS DISTINCT FROM OLD.checks_per_day OR NEW.active IS DISTINCT FROM OLD.active
     OR NEW.name IS DISTINCT FROM OLD.name OR NEW.min_temp IS DISTINCT FROM OLD.min_temp OR NEW.max_temp IS DISTINCT FROM OLD.max_temp THEN
    INSERT INTO public.equipment_config_history (equipment_id, organization_id, valid_from, checks_per_day, active, name, min_temp, max_temp)
    VALUES (NEW.id, NEW.organization_id, pg_catalog.clock_timestamp(), NEW.checks_per_day, NEW.active, NEW.name, NEW.min_temp, NEW.max_temp);
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.cleaning_plan_config_history_trg() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.cleaning_plan_config_history (cleaning_plan_id, organization_id, valid_from, frequency, weekday, month_day, active, name)
    VALUES (NEW.id, NEW.organization_id, NEW.created_at, NEW.frequency, NEW.weekday, NEW.month_day, NEW.active, NEW.name);
    RETURN NEW;
  END IF;
  IF NEW.created_at IS DISTINCT FROM OLD.created_at AND public.enregla_session_is_owner() THEN
    UPDATE public.cleaning_plan_config_history SET valid_from = NEW.created_at
    WHERE cleaning_plan_id = NEW.id AND valid_from = OLD.created_at;
  END IF;
  IF NEW.frequency IS DISTINCT FROM OLD.frequency OR NEW.weekday IS DISTINCT FROM OLD.weekday
     OR NEW.month_day IS DISTINCT FROM OLD.month_day OR NEW.active IS DISTINCT FROM OLD.active OR NEW.name IS DISTINCT FROM OLD.name THEN
    INSERT INTO public.cleaning_plan_config_history (cleaning_plan_id, organization_id, valid_from, frequency, weekday, month_day, active, name)
    VALUES (NEW.id, NEW.organization_id, pg_catalog.clock_timestamp(), NEW.frequency, NEW.weekday, NEW.month_day, NEW.active, NEW.name);
  END IF;
  RETURN NEW;
END;
$$;

-- 2. Registros personalizados: «avisar si pasan N meses sin registrarlo» (bajo) ---------------------
ALTER TABLE public.custom_record_templates ADD COLUMN IF NOT EXISTS reminder_months smallint
  CHECK (reminder_months IS NULL OR reminder_months BETWEEN 1 AND 36);

CREATE OR REPLACE FUNCTION public.custom_template_config_history_trg() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.custom_template_config_history (template_id, organization_id, valid_from, frequency, times_per_day, weekday, month_day, active, name, unit, min_value, max_value)
    VALUES (NEW.id, NEW.organization_id, NEW.created_at, NEW.frequency, NEW.times_per_day, NEW.weekday, NEW.month_day, NEW.active, NEW.name, NEW.unit, NEW.min_value, NEW.max_value);
    RETURN NEW;
  END IF;
  IF NEW.created_at IS DISTINCT FROM OLD.created_at AND public.enregla_session_is_owner() THEN
    UPDATE public.custom_template_config_history SET valid_from = NEW.created_at
    WHERE template_id = NEW.id AND valid_from = OLD.created_at;
  END IF;
  IF NEW.frequency IS DISTINCT FROM OLD.frequency OR NEW.times_per_day IS DISTINCT FROM OLD.times_per_day
     OR NEW.weekday IS DISTINCT FROM OLD.weekday OR NEW.month_day IS DISTINCT FROM OLD.month_day
     OR NEW.active IS DISTINCT FROM OLD.active OR NEW.name IS DISTINCT FROM OLD.name OR NEW.unit IS DISTINCT FROM OLD.unit
     OR NEW.min_value IS DISTINCT FROM OLD.min_value OR NEW.max_value IS DISTINCT FROM OLD.max_value THEN
    INSERT INTO public.custom_template_config_history (template_id, organization_id, valid_from, frequency, times_per_day, weekday, month_day, active, name, unit, min_value, max_value)
    VALUES (NEW.id, NEW.organization_id, pg_catalog.clock_timestamp(), NEW.frequency, NEW.times_per_day, NEW.weekday, NEW.month_day, NEW.active, NEW.name, NEW.unit, NEW.min_value, NEW.max_value);
  END IF;
  RETURN NEW;
END;
$$;

-- 3. Verificación del responsable: foto del momento, periodo terminado y nombre real (H-M1, H-M5) --
ALTER TABLE public.responsible_verifications ADD COLUMN IF NOT EXISTS snapshot jsonb
  CHECK (snapshot IS NULL OR pg_catalog.jsonb_typeof(snapshot) = 'object');

CREATE OR REPLACE FUNCTION public.responsible_verifications_insert() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE tz text; uname text;
BEGIN
  IF NOT public.enregla_session_is_owner() THEN
    NEW.created_at := pg_catalog.clock_timestamp();
    SELECT o.timezone INTO tz FROM public.organizations o WHERE o.id = NEW.organization_id;
    -- El periodo verificado debe haber terminado: como muy tarde, ayer (fecha local del local).
    IF NEW.period_to >= (pg_catalog.clock_timestamp() AT TIME ZONE coalesce(tz, 'UTC'))::date THEN
      RAISE EXCEPTION 'Solo se puede verificar un periodo ya terminado (como muy tarde, hasta ayer)' USING ERRCODE = 'check_violation';
    END IF;
    -- El nombre que se imprime es el de la cuenta, no el que envíe quien inserta.
    SELECT u.name INTO uname FROM public.users u WHERE u.id = NEW.user_id;
    IF uname IS NULL THEN
      RAISE EXCEPTION 'La verificación solo la puede registrar un propietario o encargado del local' USING ERRCODE = 'check_violation';
    END IF;
    NEW.user_name := uname;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.memberships m
                  WHERE m.organization_id = NEW.organization_id AND m.user_id = NEW.user_id AND m.role = NEW.user_role) THEN
    RAISE EXCEPTION 'La verificación solo la puede registrar un propietario o encargado del local' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

-- 4. Registros: firma real y enfriamientos coherentes (H-M4, H-M5) -----------------------------------
-- Se reescribe la función BEFORE INSERT de 0011 añadiendo, al final:
--  * correcciones de un enfriamiento: misma fase y, si es un cierre, el mismo inicio;
--  * para quien no es el propietario: `user_name` sale de `users` (y el usuario debe ser miembro del
--    local) y `staff_name` de `staff` (o del original si la corrección conserva al mismo empleado).
CREATE OR REPLACE FUNCTION public.records_set_effective_at() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE o_org uuid; o_type text; o_eff timestamptz; bad_key text; s_type text; s_phase text; s_amends uuid;
        o_related uuid; o_phase text; o_staff uuid; o_staff_name text; uname text;
BEGIN
  IF pg_catalog.jsonb_typeof(NEW.data) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'Los datos del registro deben ser un objeto' USING ERRCODE = 'check_violation';
  END IF;
  SELECT k INTO bad_key FROM pg_catalog.jsonb_object_keys(NEW.data) AS k
   WHERE pg_catalog.lower(k) IN ('supplierid', 'equipmentid', 'cleaningplanid', 'templateid', 'startrecordid')
     AND k NOT IN ('supplierId', 'equipmentId', 'cleaningPlanId', 'templateId', 'startRecordId')
   LIMIT 1;
  IF bad_key IS NOT NULL THEN
    RAISE EXCEPTION 'Clave de referencia con otra capitalización en los datos del registro: %', bad_key USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.data ? 'equipmentId' AND (NEW.data->>'equipmentId') IS DISTINCT FROM NEW.equipment_id::text THEN
    RAISE EXCEPTION 'El equipo del registro no coincide' USING ERRCODE = 'foreign_key_violation';
  END IF;
  IF NEW.data ? 'cleaningPlanId' AND (NEW.data->>'cleaningPlanId') IS DISTINCT FROM NEW.cleaning_plan_id::text THEN
    RAISE EXCEPTION 'El plan de limpieza del registro no coincide' USING ERRCODE = 'foreign_key_violation';
  END IF;
  IF (NEW.data ? 'templateId' OR NEW.custom_template_id IS NOT NULL) AND (NEW.data->>'templateId') IS DISTINCT FROM NEW.custom_template_id::text THEN
    RAISE EXCEPTION 'La plantilla del registro no coincide' USING ERRCODE = 'foreign_key_violation';
  END IF;
  IF NEW.data ? 'supplierId' AND pg_catalog.jsonb_typeof(NEW.data->'supplierId') <> 'null' THEN
    IF pg_catalog.jsonb_typeof(NEW.data->'supplierId') <> 'string'
       OR (NEW.data->>'supplierId') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       OR NOT EXISTS (SELECT 1 FROM public.suppliers s WHERE s.organization_id = NEW.organization_id AND s.id = (NEW.data->>'supplierId')::uuid) THEN
      RAISE EXCEPTION 'El proveedor del registro no es de este local' USING ERRCODE = 'foreign_key_violation';
    END IF;
  END IF;
  IF (NEW.data ? 'startRecordId' OR NEW.related_record_id IS NOT NULL) THEN
    IF (NEW.data->>'startRecordId') IS DISTINCT FROM NEW.related_record_id::text OR NEW.type <> 'enfriamiento' OR (NEW.data->>'phase') IS DISTINCT FROM 'fin' THEN
      RAISE EXCEPTION 'El enfriamiento al que cierra el registro no coincide' USING ERRCODE = 'foreign_key_violation';
    END IF;
    SELECT r.type::text, r.data->>'phase', r.amends_record_id INTO s_type, s_phase, s_amends
      FROM public.records r WHERE r.id = NEW.related_record_id AND r.organization_id = NEW.organization_id;
    IF s_type IS DISTINCT FROM 'enfriamiento' OR s_phase IS DISTINCT FROM 'inicio' OR s_amends IS NOT NULL THEN
      RAISE EXCEPTION 'Un cierre solo puede enlazar con el inicio de un enfriamiento del mismo local' USING ERRCODE = 'foreign_key_violation';
    END IF;
  END IF;
  IF NEW.amends_record_id IS NULL THEN
    NEW.effective_at := NEW.created_at;
  ELSE
    SELECT r.organization_id, r.type::text, coalesce(r.effective_at, r.created_at), r.related_record_id, r.data->>'phase', r.staff_id, r.staff_name
      INTO o_org, o_type, o_eff, o_related, o_phase, o_staff, o_staff_name
      FROM public.records r WHERE r.id = NEW.amends_record_id;
    IF o_org IS DISTINCT FROM NEW.organization_id OR o_type IS DISTINCT FROM NEW.type::text THEN
      RAISE EXCEPTION 'Una enmienda solo puede corregir un registro del mismo local y tipo' USING ERRCODE = 'foreign_key_violation';
    END IF;
    -- H-M4: la corrección de un enfriamiento sigue siendo el mismo enfriamiento.
    IF NEW.type = 'enfriamiento' AND ((NEW.data->>'phase') IS DISTINCT FROM o_phase OR NEW.related_record_id IS DISTINCT FROM o_related) THEN
      RAISE EXCEPTION 'Una corrección de un enfriamiento debe ser del mismo enfriamiento y la misma fase' USING ERRCODE = 'foreign_key_violation';
    END IF;
    NEW.effective_at := coalesce(o_eff, NEW.created_at);
  END IF;
  -- H-M5: los nombres que se imprimen salen de la base de datos (salvo para el propietario: datos de
  -- demostración, restauraciones).
  IF NOT public.enregla_caller_is_owner() THEN
    IF NEW.user_id IS NOT NULL THEN
      SELECT u.name INTO uname FROM public.users u
        JOIN public.memberships m ON m.user_id = u.id AND m.organization_id = NEW.organization_id
       WHERE u.id = NEW.user_id;
      IF uname IS NULL THEN
        RAISE EXCEPTION 'El usuario del registro no es miembro del local' USING ERRCODE = 'check_violation';
      END IF;
      NEW.user_name := uname;
    END IF;
    IF NEW.staff_id IS NOT NULL THEN
      IF NEW.amends_record_id IS NOT NULL AND NEW.staff_id = o_staff THEN
        NEW.staff_name := o_staff_name;
      ELSE
        SELECT s.name INTO NEW.staff_name FROM public.staff s WHERE s.id = NEW.staff_id AND s.organization_id = NEW.organization_id;
      END IF;
    ELSE
      NEW.staff_name := NULL;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC;
