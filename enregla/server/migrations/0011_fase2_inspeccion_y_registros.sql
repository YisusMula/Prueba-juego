-- EnRegla: fase 2, bloques A1–A3 (PDF de inspección, registros de las guías oficiales y restos de la
-- fase 1). Migración ADITIVA: columnas nulas o con valor por defecto, tablas nuevas, índices,
-- funciones y triggers. El código anterior sigue funcionando sobre este esquema (no lee las columnas
-- nuevas y los tipos de registro antiguos siguen admitidos). Todas las funciones fijan
-- search_path = pg_catalog, public, pg_temp y usan nombres calificados.
--
-- Permisos del rol de la app (los fija `migrate`, server/src/db/privileges.ts):
--   responsible_verifications       → solo SELECT e INSERT (hecho inmutable, hora del reloj)
--   custom_record_templates         → SELECT, INSERT y UPDATE de las columnas editables; sin DELETE
--   custom_template_config_history  → solo SELECT (lo escribe un trigger del propietario)

-- ---------------------------------------------------------------------------------------------------
-- A3.1 Eventos de auditoría reservados: sin distinguir mayúsculas ni espacios (también duros) ------
-- ---------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enregla_reserved_audit_event(ev text) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT n LIKE 'db.%' OR n LIKE 'maintenance.%' OR n = 'org.purged'
  FROM (SELECT pg_catalog.lower(pg_catalog.regexp_replace(normalize(coalesce(ev, ''), NFKC),
          '[[:space:]  ᠎ -‍    ⁠　﻿]+', '', 'g')) AS n) s
$$;

-- ---------------------------------------------------------------------------------------------------
-- A3.3 Altas y cambios de rol en memberships, auditados por la base de datos -----------------------
-- ---------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.memberships_change_audit() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF TG_OP = 'INSERT'
     OR NEW.role IS DISTINCT FROM OLD.role
     OR NEW.user_id IS DISTINCT FROM OLD.user_id
     OR NEW.organization_id IS DISTINCT FROM OLD.organization_id THEN
    INSERT INTO public.audit_events (organization_id, user_id, event, metadata)
    VALUES (NEW.organization_id, NEW.user_id, 'db.membership_changed', pg_catalog.jsonb_build_object(
      'op', TG_OP,
      'old_role', CASE WHEN TG_OP = 'UPDATE' THEN OLD.role END,
      'new_role', NEW.role,
      'old_user_id', CASE WHEN TG_OP = 'UPDATE' AND NEW.user_id IS DISTINCT FROM OLD.user_id THEN OLD.user_id END,
      'old_organization_id', CASE WHEN TG_OP = 'UPDATE' AND NEW.organization_id IS DISTINCT FROM OLD.organization_id THEN OLD.organization_id END,
      'session_user', session_user::text,
      'client_addr', pg_catalog.inet_client_addr()::text));
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS memberships_change_audit_trg ON public.memberships;
CREATE TRIGGER memberships_change_audit_trg AFTER INSERT OR UPDATE ON public.memberships
  FOR EACH ROW EXECUTE FUNCTION public.memberships_change_audit();

-- ---------------------------------------------------------------------------------------------------
-- A1.1 Datos del establecimiento y valores de referencia del local ---------------------------------
-- ---------------------------------------------------------------------------------------------------
ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS legal_name text CHECK (legal_name IS NULL OR pg_catalog.char_length(legal_name) <= 200);
ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS tax_id text CHECK (tax_id IS NULL OR pg_catalog.char_length(tax_id) <= 20);
ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS address text CHECK (address IS NULL OR pg_catalog.char_length(address) <= 300);
ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS postal_code text CHECK (postal_code IS NULL OR pg_catalog.char_length(postal_code) <= 10);
ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS city text CHECK (city IS NULL OR pg_catalog.char_length(city) <= 100);
ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS province text CHECK (province IS NULL OR pg_catalog.char_length(province) <= 100);
ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS sanitary_registry text CHECK (sanitary_registry IS NULL OR pg_catalog.char_length(sanitary_registry) <= 60);
-- Valores de referencia propios (cocinado, regeneración, enfriamiento); NULL = los de referencia.
ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS reference_values jsonb
  CHECK (reference_values IS NULL OR pg_catalog.jsonb_typeof(reference_values) = 'object');

-- Aviso semanal (en el email existente) si la semana anterior no está revisada. Preferencia por persona.
ALTER TABLE public.memberships ADD COLUMN IF NOT EXISTS weekly_review_reminder boolean NOT NULL DEFAULT true;

-- ---------------------------------------------------------------------------------------------------
-- A1.8 Verificación del responsable: hecho inmutable, hora del reloj -------------------------------
-- ---------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.responsible_verifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  period_from date NOT NULL,
  period_to date NOT NULL,
  period_kind text NOT NULL DEFAULT 'custom' CHECK (period_kind IN ('week', 'month', 'custom')),
  comment text CHECK (comment IS NULL OR pg_catalog.char_length(comment) <= 1000),
  -- Sin FK: la verificación conserva quién la hizo aunque la cuenta se elimine (como los registros).
  user_id uuid NOT NULL,
  user_name text NOT NULL,
  user_role text NOT NULL CHECK (user_role IN ('owner', 'manager')),
  created_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  CHECK (period_from <= period_to),
  CHECK (period_to - period_from <= 366)
);
CREATE INDEX IF NOT EXISTS responsible_verifications_org_idx ON public.responsible_verifications (organization_id, period_from, period_to);
CREATE UNIQUE INDEX IF NOT EXISTS responsible_verifications_org_id_uidx ON public.responsible_verifications (organization_id, id);

-- Alta: la hora la pone el reloj (salvo el propietario: datos de demostración y restauraciones), quien
-- verifica debe ser propietario o encargado del local con ese rol, y el periodo no puede ser futuro.
CREATE OR REPLACE FUNCTION public.responsible_verifications_insert() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE tz text;
BEGIN
  IF NOT public.enregla_session_is_owner() THEN
    NEW.created_at := pg_catalog.clock_timestamp();
    SELECT o.timezone INTO tz FROM public.organizations o WHERE o.id = NEW.organization_id;
    IF NEW.period_to > (pg_catalog.clock_timestamp() AT TIME ZONE coalesce(tz, 'UTC'))::date THEN
      RAISE EXCEPTION 'No se puede verificar un periodo con fechas futuras' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.memberships m
                  WHERE m.organization_id = NEW.organization_id AND m.user_id = NEW.user_id AND m.role = NEW.user_role) THEN
    RAISE EXCEPTION 'La verificación solo la puede registrar un propietario o encargado del local' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS responsible_verifications_insert_trg ON public.responsible_verifications;
CREATE TRIGGER responsible_verifications_insert_trg BEFORE INSERT ON public.responsible_verifications
  FOR EACH ROW EXECUTE FUNCTION public.responsible_verifications_insert();

-- Inmutable: ni UPDATE ni DELETE, salvo el borrado en cascada al purgar el local.
CREATE OR REPLACE FUNCTION public.responsible_verifications_immutable() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF TG_OP = 'DELETE' AND NOT EXISTS (SELECT 1 FROM public.organizations o WHERE o.id = OLD.organization_id) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'Las verificaciones no se pueden modificar ni borrar: añade una nueva' USING ERRCODE = 'restrict_violation';
END;
$$;
DROP TRIGGER IF EXISTS responsible_verifications_immutable_trg ON public.responsible_verifications;
CREATE TRIGGER responsible_verifications_immutable_trg BEFORE UPDATE OR DELETE ON public.responsible_verifications
  FOR EACH ROW EXECUTE FUNCTION public.responsible_verifications_immutable();

-- ---------------------------------------------------------------------------------------------------
-- A2.3 Plantillas de registros personalizados y su historial de configuración ----------------------
-- ---------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.custom_record_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (pg_catalog.char_length(name) BETWEEN 1 AND 120),
  kind text NOT NULL CHECK (kind IN ('checklist', 'numeric', 'yesno')),
  items jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (pg_catalog.jsonb_typeof(items) = 'array'),
  unit text CHECK (unit IS NULL OR pg_catalog.char_length(unit) <= 20),
  min_value double precision,
  max_value double precision,
  frequency text NOT NULL CHECK (frequency IN ('daily', 'weekly', 'monthly', 'on_demand')),
  times_per_day smallint NOT NULL DEFAULT 1 CHECK (times_per_day BETWEEN 1 AND 12),
  weekday smallint CHECK (weekday BETWEEN 1 AND 7),
  month_day smallint CHECK (month_day BETWEEN 1 AND 28),
  instructions text CHECK (instructions IS NULL OR pg_catalog.char_length(instructions) <= 1000),
  -- Plantilla sugerida de la que sale (si la hay) y su fuente.
  suggestion_key text,
  source text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  CHECK (frequency <> 'weekly' OR weekday IS NOT NULL),
  CHECK (frequency <> 'monthly' OR month_day IS NOT NULL),
  CHECK (min_value IS NULL OR max_value IS NULL OR min_value <= max_value)
);
CREATE UNIQUE INDEX IF NOT EXISTS custom_record_templates_org_id_uidx ON public.custom_record_templates (organization_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS custom_record_templates_suggestion_uidx ON public.custom_record_templates (organization_id, suggestion_key) WHERE suggestion_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS custom_record_templates_org_idx ON public.custom_record_templates (organization_id, created_at, id);

DROP TRIGGER IF EXISTS custom_record_templates_clock_trg ON public.custom_record_templates;
CREATE TRIGGER custom_record_templates_clock_trg BEFORE INSERT ON public.custom_record_templates
  FOR EACH ROW EXECUTE FUNCTION public.config_server_clock();

CREATE TABLE IF NOT EXISTS public.custom_template_config_history (
  id bigserial PRIMARY KEY,
  template_id uuid NOT NULL,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  valid_from timestamptz NOT NULL,
  frequency text NOT NULL CHECK (frequency IN ('daily', 'weekly', 'monthly', 'on_demand')),
  times_per_day smallint NOT NULL,
  weekday smallint,
  month_day smallint,
  active boolean NOT NULL,
  CONSTRAINT custom_template_history_org_fk FOREIGN KEY (organization_id, template_id)
    REFERENCES public.custom_record_templates (organization_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS custom_template_config_history_idx ON public.custom_template_config_history (organization_id, template_id, valid_from, id);

CREATE OR REPLACE FUNCTION public.custom_template_config_history_trg() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.custom_template_config_history (template_id, organization_id, valid_from, frequency, times_per_day, weekday, month_day, active)
    VALUES (NEW.id, NEW.organization_id, NEW.created_at, NEW.frequency, NEW.times_per_day, NEW.weekday, NEW.month_day, NEW.active);
    RETURN NEW;
  END IF;
  IF NEW.created_at IS DISTINCT FROM OLD.created_at AND public.enregla_session_is_owner() THEN
    UPDATE public.custom_template_config_history SET valid_from = NEW.created_at
    WHERE template_id = NEW.id AND valid_from = OLD.created_at;
  END IF;
  IF NEW.frequency IS DISTINCT FROM OLD.frequency OR NEW.times_per_day IS DISTINCT FROM OLD.times_per_day
     OR NEW.weekday IS DISTINCT FROM OLD.weekday OR NEW.month_day IS DISTINCT FROM OLD.month_day
     OR NEW.active IS DISTINCT FROM OLD.active THEN
    INSERT INTO public.custom_template_config_history (template_id, organization_id, valid_from, frequency, times_per_day, weekday, month_day, active)
    VALUES (NEW.id, NEW.organization_id, pg_catalog.clock_timestamp(), NEW.frequency, NEW.times_per_day, NEW.weekday, NEW.month_day, NEW.active);
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS custom_template_config_history_trg ON public.custom_record_templates;
CREATE TRIGGER custom_template_config_history_trg AFTER INSERT OR UPDATE ON public.custom_record_templates
  FOR EACH ROW EXECUTE FUNCTION public.custom_template_config_history_trg();

-- ---------------------------------------------------------------------------------------------------
-- A2 Tipos de registro nuevos y sus referencias (FK compuestas por local) ------------------------
-- ---------------------------------------------------------------------------------------------------
ALTER TABLE public.records DROP CONSTRAINT IF EXISTS records_type_check;
ALTER TABLE public.records ADD CONSTRAINT records_type_check CHECK (type IN (
  'temperatura', 'limpieza', 'recepcion', 'aceite', 'plagas', 'incidencia', 'formacion',
  'cocinado', 'enfriamiento', 'personalizado'));

-- Plantilla de un registro personalizado.
ALTER TABLE public.records ADD COLUMN IF NOT EXISTS custom_template_id uuid;
-- Cierre de un enfriamiento: el registro de inicio (raíz) al que cierra.
ALTER TABLE public.records ADD COLUMN IF NOT EXISTS related_record_id uuid;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint WHERE conname = 'records_org_custom_template_fk') THEN
    ALTER TABLE public.records ADD CONSTRAINT records_org_custom_template_fk FOREIGN KEY (organization_id, custom_template_id)
      REFERENCES public.custom_record_templates (organization_id, id) ON DELETE CASCADE;
    ALTER TABLE public.records ADD CONSTRAINT records_org_related_fk FOREIGN KEY (organization_id, related_record_id)
      REFERENCES public.records (organization_id, id) ON DELETE CASCADE;
  END IF;
END $$;
-- Un enfriamiento se cierra una sola vez (las correcciones del cierre no cuentan).
CREATE UNIQUE INDEX IF NOT EXISTS records_single_close_idx ON public.records (related_record_id)
  WHERE related_record_id IS NOT NULL AND amends_record_id IS NULL;
CREATE INDEX IF NOT EXISTS records_org_template_effective_idx ON public.records (organization_id, custom_template_id, effective_at DESC)
  WHERE custom_template_id IS NOT NULL;

-- Comprobaciones del JSON del registro (R3 de la fase 1, ampliadas):
--  * las claves de referencia van exactamente con su nombre (sin otra capitalización: A3.4);
--  * supplierId, si está, es null o un UUID en texto de un proveedor del local (A3.4);
--  * equipo, plan, plantilla y enfriamiento del JSON coinciden con sus columnas (FK compuestas);
--  * el cierre de un enfriamiento apunta al inicio (raíz) de un enfriamiento del mismo local.
CREATE OR REPLACE FUNCTION public.records_set_effective_at() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE o_org uuid; o_type text; o_eff timestamptz; bad_key text; s_type text; s_phase text; s_amends uuid;
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

REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC;
