-- EnRegla: revisión explícita de alérgenos de cada plato (seguridad alimentaria).
-- Migración ADITIVA. Un plato nuevo nace SIN REVISAR y no se publica en la carta pública hasta
-- que alguien confirma que ha decidido sus 14 alérgenos.
--
-- Platos existentes: se consideran revisados SOLO si tienen algún alérgeno marcado (contiene o
-- trazas); los que tienen los 14 en "no contiene" pasan a pendientes de revisar, porque ese era
-- precisamente el valor por defecto con el que nacían (no se puede saber si alguien lo revisó).
ALTER TABLE dishes ADD COLUMN IF NOT EXISTS allergens_reviewed boolean NOT NULL DEFAULT false;
ALTER TABLE dishes ADD COLUMN IF NOT EXISTS allergens_reviewed_at timestamptz;

UPDATE dishes d
   SET allergens_reviewed = true,
       allergens_reviewed_at = coalesce(d.allergens_reviewed_at, d.updated_at)
 WHERE d.allergens_reviewed = false
   AND EXISTS (SELECT 1 FROM jsonb_each_text(d.allergens) a WHERE a.value <> 'no');

CREATE INDEX IF NOT EXISTS dishes_public_menu_idx ON dishes(organization_id) WHERE visible AND allergens_reviewed;
