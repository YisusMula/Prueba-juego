-- EnRegla: fase 1 del plan de comercialización (integridad de registros y seguridad alimentaria).
-- Migración ADITIVA: añade una columna con valor por defecto, una columna nula y un índice.
-- El código anterior sigue funcionando sobre este esquema (no envía `seq` y lo rellena el valor
-- por defecto; no lee `default_category`).

-- 1.3: orden de inserción estable de los registros. Una corrección (enmienda) comparte la fecha
-- del hecho (`effective_at`) con su original; `seq` permite ordenar siempre original → corrección,
-- también cuando las dos tienen exactamente la misma hora o en cadenas de correcciones.
CREATE SEQUENCE IF NOT EXISTS records_seq_seq;
ALTER TABLE records ADD COLUMN IF NOT EXISTS seq bigint;

-- Relleno de los registros existentes por orden de inserción (y, a igual hora, el original antes
-- que sus correcciones). El trigger de inmutabilidad impide UPDATE: se desactiva solo durante el
-- relleno, dentro de esta misma transacción (como en 0003).
ALTER TABLE records DISABLE TRIGGER records_immutable_trg;
WITH RECURSIVE chain AS (
  SELECT id, 0 AS depth FROM records WHERE amends_record_id IS NULL
  UNION ALL
  SELECT r.id, c.depth + 1 FROM records r JOIN chain c ON r.amends_record_id = c.id
), ordered AS (
  SELECT r.id, row_number() OVER (ORDER BY r.created_at, coalesce(c.depth, 0), r.id) AS n
  FROM records r LEFT JOIN chain c ON c.id = r.id
)
UPDATE records r SET seq = o.n FROM ordered o WHERE o.id = r.id AND r.seq IS NULL;
ALTER TABLE records ENABLE TRIGGER records_immutable_trg;

SELECT setval('records_seq_seq', coalesce((SELECT max(seq) FROM records), 0) + 1, false);
ALTER TABLE records ALTER COLUMN seq SET DEFAULT nextval('records_seq_seq');
ALTER SEQUENCE records_seq_seq OWNED BY records.seq;
ALTER TABLE records ALTER COLUMN seq SET NOT NULL;
CREATE INDEX IF NOT EXISTS records_org_effective_seq_idx ON records(organization_id, effective_at, seq);

-- 1.6: categoría de producto por defecto del proveedor (preselección en la recepción).
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS default_category text
  CHECK (default_category IS NULL OR default_category IN ('refrigerado', 'congelado', 'ambiente', 'caliente'));
