-- EnRegla: correcciones de la auditoría de seguridad.
-- Migración ADITIVA: solo añade columnas/tablas/índices nulos o con valor por defecto,
-- de modo que una instancia con el código anterior sigue funcionando sobre este esquema.

-- H7: la prueba gratuita es una por cuenta de usuario. La primera organización que crea
-- el usuario fija esta fecha; las siguientes la heredan.
ALTER TABLE users ADD COLUMN IF NOT EXISTS trial_ends_at timestamptz;

-- Usuarios que ya crearon locales antes de esta migración: su prueba es la del primer
-- local que crearon (según la auditoría `org.created`).
UPDATE users u
SET trial_ends_at = s.trial_ends_at
FROM (
  SELECT a.user_id, min(o.trial_ends_at) AS trial_ends_at
  FROM audit_events a
  JOIN organizations o ON o.id = a.organization_id
  WHERE a.event = 'org.created' AND a.user_id IS NOT NULL
  GROUP BY a.user_id
) s
WHERE s.user_id = u.id AND u.trial_ends_at IS NULL;

-- H14: control de ejecución de tareas periódicas (una vez al día entre todas las instancias).
CREATE TABLE IF NOT EXISTS job_runs (
  name text PRIMARY KEY,
  last_run_at timestamptz NOT NULL
);

-- H14: purgas por antigüedad.
CREATE INDEX IF NOT EXISTS audit_events_created_idx ON audit_events(created_at);
CREATE INDEX IF NOT EXISTS users_unverified_created_idx ON users(created_at) WHERE email_verified_at IS NULL;

-- H2: revocar los dispositivos creados por un miembro al expulsarlo.
CREATE INDEX IF NOT EXISTS devices_created_by_idx ON devices(organization_id, created_by) WHERE revoked_at IS NULL;
