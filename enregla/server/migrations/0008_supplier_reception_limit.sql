-- EnRegla: límite de temperatura de recepción propio de cada proveedor (evaluación de la fase 1, 1.6).
-- Migración ADITIVA: una columna nula. El límite ya no se edita al recibir la mercancía: es el de
-- referencia de la categoría o este, configurado en Ajustes → Proveedores dentro de un margen.
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS reception_limit double precision
  CHECK (reception_limit IS NULL OR reception_limit BETWEEN -60 AND 100);
