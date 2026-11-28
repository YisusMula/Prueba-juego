-- EnRegla: esquema inicial
-- gen_random_uuid() es nativo desde PostgreSQL 13.

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE CHECK (email = lower(email)),
  email_verified_at timestamptz,
  password_hash text NOT NULL,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash text NOT NULL UNIQUE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  ip text,
  user_agent text
);
CREATE INDEX sessions_user_idx ON sessions(user_id);
CREATE INDEX sessions_expires_idx ON sessions(expires_at);

CREATE TABLE email_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose text NOT NULL CHECK (purpose IN ('verify_email', 'password_reset', 'email_change')),
  token_hash text NOT NULL UNIQUE,
  new_email text,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX email_tokens_user_idx ON email_tokens(user_id, purpose);

CREATE TABLE organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  business_type text NOT NULL CHECK (business_type IN ('bar', 'restaurante', 'cafeteria', 'obrador', 'catering', 'tienda')),
  timezone text NOT NULL DEFAULT 'Europe/Madrid',
  reminder_enabled boolean NOT NULL DEFAULT true,
  reminder_hour smallint NOT NULL DEFAULT 18 CHECK (reminder_hour BETWEEN 0 AND 23),
  last_reminder_on date,
  public_menu_enabled boolean NOT NULL DEFAULT false,
  public_menu_slug text NOT NULL UNIQUE,
  subscription_status text NOT NULL DEFAULT 'trialing',
  trial_ends_at timestamptz NOT NULL,
  plan text CHECK (plan IN ('monthly', 'annual')),
  stripe_customer_id text UNIQUE,
  stripe_subscription_id text,
  current_period_end timestamptz,
  cancel_at_period_end boolean NOT NULL DEFAULT false,
  stripe_event_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE memberships (
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('owner', 'manager')),
  daily_reminder boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, user_id)
);
CREATE INDEX memberships_user_idx ON memberships(user_id);

CREATE TABLE invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  email text NOT NULL CHECK (email = lower(email)),
  role text NOT NULL CHECK (role IN ('owner', 'manager')),
  token_hash text NOT NULL UNIQUE,
  invited_by uuid REFERENCES users(id) ON DELETE SET NULL,
  expires_at timestamptz NOT NULL,
  accepted_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX invitations_org_idx ON invitations(organization_id, created_at);

CREATE TABLE staff (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  pin_hash text,
  pin_failed_count integer NOT NULL DEFAULT 0,
  pin_locked_until timestamptz,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX staff_org_idx ON staff(organization_id, created_at, id);

CREATE TABLE devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  token_hash text NOT NULL UNIQUE,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);
CREATE INDEX devices_org_idx ON devices(organization_id, created_at, id);

CREATE TABLE equipment (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  type text NOT NULL CHECK (type IN ('camara', 'congelador', 'vitrina', 'mesa_caliente', 'abatidor', 'freidora', 'otro')),
  min_temp double precision,
  max_temp double precision,
  checks_per_day smallint NOT NULL DEFAULT 1 CHECK (checks_per_day BETWEEN 0 AND 12),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (min_temp IS NULL OR max_temp IS NULL OR min_temp <= max_temp)
);
CREATE INDEX equipment_org_idx ON equipment(organization_id, created_at, id);

CREATE TABLE cleaning_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  frequency text NOT NULL CHECK (frequency IN ('daily', 'weekly', 'monthly')),
  weekday smallint CHECK (weekday BETWEEN 1 AND 7),
  month_day smallint CHECK (month_day BETWEEN 1 AND 28),
  items jsonb NOT NULL DEFAULT '[]'::jsonb,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (frequency <> 'weekly' OR weekday IS NOT NULL),
  CHECK (frequency <> 'monthly' OR month_day IS NOT NULL)
);
CREATE INDEX cleaning_plans_org_idx ON cleaning_plans(organization_id, created_at, id);

CREATE TABLE suppliers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  contact_name text,
  phone text,
  email text,
  products jsonb NOT NULL DEFAULT '[]'::jsonb,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX suppliers_org_idx ON suppliers(organization_id, created_at, id);

CREATE TABLE records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  type text NOT NULL CHECK (type IN ('temperatura', 'limpieza', 'recepcion', 'aceite', 'plagas', 'incidencia', 'formacion')),
  data jsonb NOT NULL,
  staff_id uuid REFERENCES staff(id) ON DELETE CASCADE,
  staff_name text,
  -- Sin FK: el registro conserva quién lo firmó aunque la cuenta se elimine.
  user_id uuid,
  user_name text,
  device_id uuid REFERENCES devices(id) ON DELETE CASCADE,
  equipment_id uuid REFERENCES equipment(id) ON DELETE CASCADE,
  cleaning_plan_id uuid REFERENCES cleaning_plans(id) ON DELETE CASCADE,
  amends_record_id uuid REFERENCES records(id) ON DELETE CASCADE,
  amendment_reason text,
  alert boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (staff_id IS NOT NULL OR user_id IS NOT NULL),
  CHECK ((amends_record_id IS NULL) = (amendment_reason IS NULL))
);
CREATE INDEX records_org_created_idx ON records(organization_id, created_at DESC, id DESC);
CREATE INDEX records_org_type_created_idx ON records(organization_id, type, created_at);
CREATE UNIQUE INDEX records_single_amendment_idx ON records(amends_record_id) WHERE amends_record_id IS NOT NULL;

-- Inmutabilidad de los registros: no se permite UPDATE ni DELETE,
-- salvo el borrado en cascada cuando se elimina la organización completa.
CREATE FUNCTION records_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND NOT EXISTS (SELECT 1 FROM organizations WHERE id = OLD.organization_id) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'records are append-only' USING ERRCODE = 'restrict_violation';
END;
$$;
CREATE TRIGGER records_immutable_trg
  BEFORE UPDATE OR DELETE ON records
  FOR EACH ROW EXECUTE FUNCTION records_immutable();

CREATE TABLE dishes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  category text,
  description text,
  allergens jsonb NOT NULL,
  visible boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX dishes_org_idx ON dishes(organization_id, created_at, id);

-- Auditoría de seguridad. Sin FK para conservar el rastro tras borrados.
CREATE TABLE audit_events (
  id bigserial PRIMARY KEY,
  organization_id uuid,
  user_id uuid,
  event text NOT NULL,
  ip text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_events_org_idx ON audit_events(organization_id, created_at DESC);
CREATE INDEX audit_events_user_idx ON audit_events(user_id, created_at DESC);

CREATE TABLE rate_limits (
  key text PRIMARY KEY,
  count integer NOT NULL,
  reset_at timestamptz NOT NULL
);
CREATE INDEX rate_limits_reset_idx ON rate_limits(reset_at);

CREATE TABLE stripe_events (
  id text PRIMARY KEY,
  type text NOT NULL,
  processed_at timestamptz NOT NULL DEFAULT now()
);
