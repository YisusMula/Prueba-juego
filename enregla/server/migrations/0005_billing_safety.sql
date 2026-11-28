-- EnRegla: correcciones de la auditoría de seguridad final (facturación y operación).
-- Migración ADITIVA: solo añade columnas nulas. El código anterior sigue funcionando sobre este esquema.

-- M-1: sesión de Checkout abierta del local (para expirarla al pedir el borrado del local y
-- no dejar una suscripción huérfana que siga cobrando).
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS stripe_checkout_session_id text;

-- I-3: desde cuándo la suscripción está en `past_due`. Pasados PAST_DUE_READ_ONLY_DAYS (21) días
-- el local pasa a solo lectura aunque Stripe siga reintentando el cobro.
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS past_due_since timestamptz;

-- Locales que ya estaban en past_due: se cuenta desde el último evento de Stripe aplicado
-- (o desde ahora si no se conoce).
UPDATE organizations
   SET past_due_since = coalesce(stripe_event_at, now())
 WHERE subscription_status = 'past_due' AND past_due_since IS NULL;
