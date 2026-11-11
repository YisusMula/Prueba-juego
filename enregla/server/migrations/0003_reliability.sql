-- EnRegla: correcciones de fiabilidad ("listo para producción").
-- Migración ADITIVA: solo añade columnas, tablas, triggers e índices. El código anterior sigue
-- funcionando sobre este esquema (los triggers rellenan las columnas nuevas).
--
-- Nota operativa: el relleno de records.effective_at reescribe la tabla de registros (bloqueo
-- exclusivo mientras dura). En bases grandes, aplicar en una ventana de mantenimiento.

-- ---------------------------------------------------------------------------
-- 1. Fecha del hecho (effective_at) de cada registro
--    Registro normal: effective_at = created_at.
--    Enmienda: effective_at = effective_at del registro raíz de la cadena.
--    created_at sigue siendo la hora real de inserción.
-- ---------------------------------------------------------------------------
ALTER TABLE records ADD COLUMN IF NOT EXISTS effective_at timestamptz;

-- El trigger de inmutabilidad impide UPDATE: se desactiva solo durante el relleno inicial.
ALTER TABLE records DISABLE TRIGGER records_immutable_trg;
WITH RECURSIVE chain AS (
  SELECT id, created_at AS root_at FROM records WHERE amends_record_id IS NULL
  UNION ALL
  SELECT r.id, c.root_at FROM records r JOIN chain c ON r.amends_record_id = c.id
)
UPDATE records r SET effective_at = c.root_at FROM chain c WHERE c.id = r.id AND r.effective_at IS NULL;
UPDATE records SET effective_at = created_at WHERE effective_at IS NULL;
ALTER TABLE records ENABLE TRIGGER records_immutable_trg;

CREATE OR REPLACE FUNCTION records_set_effective_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.amends_record_id IS NULL THEN
    NEW.effective_at := NEW.created_at;
  ELSE
    SELECT coalesce(effective_at, created_at) INTO NEW.effective_at FROM records WHERE id = NEW.amends_record_id;
    NEW.effective_at := coalesce(NEW.effective_at, NEW.created_at);
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS records_effective_at_trg ON records;
CREATE TRIGGER records_effective_at_trg
  BEFORE INSERT ON records
  FOR EACH ROW EXECUTE FUNCTION records_set_effective_at();

ALTER TABLE records ALTER COLUMN effective_at SET NOT NULL;

-- Historial (orden y filtros), tareas/cumplimiento por tipo y por equipo/plan/personal.
CREATE INDEX IF NOT EXISTS records_org_effective_idx ON records(organization_id, effective_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS records_org_type_effective_idx ON records(organization_id, type, effective_at);
CREATE INDEX IF NOT EXISTS records_org_equipment_effective_idx ON records(organization_id, equipment_id, effective_at DESC) WHERE equipment_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS records_org_plan_effective_idx ON records(organization_id, cleaning_plan_id, effective_at DESC) WHERE cleaning_plan_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS records_org_staff_effective_idx ON records(organization_id, staff_id, effective_at DESC) WHERE staff_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 6. Vigencia histórica de la configuración de equipos y planes de limpieza
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS equipment_config_history (
  id bigserial PRIMARY KEY,
  equipment_id uuid NOT NULL REFERENCES equipment(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  valid_from timestamptz NOT NULL,
  checks_per_day smallint NOT NULL,
  active boolean NOT NULL
);
CREATE INDEX IF NOT EXISTS equipment_config_history_idx ON equipment_config_history(organization_id, equipment_id, valid_from, id);

CREATE TABLE IF NOT EXISTS cleaning_plan_config_history (
  id bigserial PRIMARY KEY,
  cleaning_plan_id uuid NOT NULL REFERENCES cleaning_plans(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  valid_from timestamptz NOT NULL,
  frequency text NOT NULL CHECK (frequency IN ('daily', 'weekly', 'monthly')),
  weekday smallint,
  month_day smallint,
  active boolean NOT NULL
);
CREATE INDEX IF NOT EXISTS cleaning_plan_config_history_idx ON cleaning_plan_config_history(organization_id, cleaning_plan_id, valid_from, id);

-- Relleno inicial: la configuración actual, vigente desde la creación (equivale al cálculo anterior).
INSERT INTO equipment_config_history (equipment_id, organization_id, valid_from, checks_per_day, active)
SELECT e.id, e.organization_id, e.created_at, e.checks_per_day, e.active FROM equipment e
WHERE NOT EXISTS (SELECT 1 FROM equipment_config_history h WHERE h.equipment_id = e.id);
INSERT INTO cleaning_plan_config_history (cleaning_plan_id, organization_id, valid_from, frequency, weekday, month_day, active)
SELECT p.id, p.organization_id, p.created_at, p.frequency, p.weekday, p.month_day, p.active FROM cleaning_plans p
WHERE NOT EXISTS (SELECT 1 FROM cleaning_plan_config_history h WHERE h.cleaning_plan_id = p.id);

-- Mantenimiento automático en cada alta/edición/desactivación (también desde código antiguo).
CREATE OR REPLACE FUNCTION equipment_config_history_trg() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO equipment_config_history (equipment_id, organization_id, valid_from, checks_per_day, active)
    VALUES (NEW.id, NEW.organization_id, NEW.created_at, NEW.checks_per_day, NEW.active);
    RETURN NEW;
  END IF;
  -- Corrección de la fecha de alta (p. ej. datos de demostración): se mueve el primer tramo.
  IF NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    UPDATE equipment_config_history SET valid_from = NEW.created_at
    WHERE equipment_id = NEW.id AND valid_from = OLD.created_at;
  END IF;
  IF NEW.checks_per_day IS DISTINCT FROM OLD.checks_per_day OR NEW.active IS DISTINCT FROM OLD.active THEN
    INSERT INTO equipment_config_history (equipment_id, organization_id, valid_from, checks_per_day, active)
    VALUES (NEW.id, NEW.organization_id, now(), NEW.checks_per_day, NEW.active);
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS equipment_config_history_trg ON equipment;
CREATE TRIGGER equipment_config_history_trg
  AFTER INSERT OR UPDATE ON equipment
  FOR EACH ROW EXECUTE FUNCTION equipment_config_history_trg();

CREATE OR REPLACE FUNCTION cleaning_plan_config_history_trg() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO cleaning_plan_config_history (cleaning_plan_id, organization_id, valid_from, frequency, weekday, month_day, active)
    VALUES (NEW.id, NEW.organization_id, NEW.created_at, NEW.frequency, NEW.weekday, NEW.month_day, NEW.active);
    RETURN NEW;
  END IF;
  IF NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    UPDATE cleaning_plan_config_history SET valid_from = NEW.created_at
    WHERE cleaning_plan_id = NEW.id AND valid_from = OLD.created_at;
  END IF;
  IF NEW.frequency IS DISTINCT FROM OLD.frequency OR NEW.weekday IS DISTINCT FROM OLD.weekday
     OR NEW.month_day IS DISTINCT FROM OLD.month_day OR NEW.active IS DISTINCT FROM OLD.active THEN
    INSERT INTO cleaning_plan_config_history (cleaning_plan_id, organization_id, valid_from, frequency, weekday, month_day, active)
    VALUES (NEW.id, NEW.organization_id, now(), NEW.frequency, NEW.weekday, NEW.month_day, NEW.active);
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS cleaning_plan_config_history_trg ON cleaning_plans;
CREATE TRIGGER cleaning_plan_config_history_trg
  AFTER INSERT OR UPDATE ON cleaning_plans
  FOR EACH ROW EXECUTE FUNCTION cleaning_plan_config_history_trg();

-- ---------------------------------------------------------------------------
-- 8. Idempotencia de altas de registros (cabecera Idempotency-Key)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS idempotency_keys (
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  key uuid NOT NULL,
  request_hash text NOT NULL,
  record_id uuid REFERENCES records(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, key)
);
CREATE INDEX IF NOT EXISTS idempotency_keys_created_idx ON idempotency_keys(created_at);

-- ---------------------------------------------------------------------------
-- 5. Bandeja de salida de emails (reintentos con backoff)
-- Almacenamiento TEMPORAL: los cuerpos pueden llevar enlaces con token. Las filas enviadas se
-- purgan a las pocas horas y las fallidas definitivamente a los pocos días.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS email_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  to_address text NOT NULL,
  subject text NOT NULL,
  text_body text NOT NULL,
  html_body text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed')),
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz
);
CREATE INDEX IF NOT EXISTS email_outbox_due_idx ON email_outbox(next_attempt_at) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS email_outbox_status_idx ON email_outbox(status, created_at);

-- Avisos de fin de prueba (una sola vez cada uno).
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS trial_notice_soon_sent_at timestamptz;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS trial_notice_end_sent_at timestamptz;

-- ---------------------------------------------------------------------------
-- 10. Borrado diferido de locales (30 días)
-- ---------------------------------------------------------------------------
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS deletion_requested_at timestamptz;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS deletion_scheduled_at timestamptz;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS deletion_requested_by uuid;
CREATE INDEX IF NOT EXISTS organizations_deletion_idx ON organizations(deletion_scheduled_at) WHERE deletion_scheduled_at IS NOT NULL;
