import type { Organization } from '../../db/types.js';

export type EffectiveStatus =
  | 'trialing'
  | 'trial_expired'
  | 'active'
  | 'past_due'
  | 'unpaid'
  | 'canceled'
  | 'incomplete'
  | 'incomplete_expired'
  | 'paused';

export function effectiveStatus(org: Pick<Organization, 'subscription_status' | 'trial_ends_at' | 'stripe_subscription_id'>, now = new Date()): EffectiveStatus {
  const s = org.subscription_status;
  if (s === 'trialing') {
    // Prueba local (sin suscripción de Stripe): caduca en trial_ends_at.
    if (!org.stripe_subscription_id && org.trial_ends_at.getTime() <= now.getTime()) return 'trial_expired';
    return 'trialing';
  }
  const known: EffectiveStatus[] = ['active', 'past_due', 'unpaid', 'canceled', 'incomplete', 'incomplete_expired', 'paused'];
  return (known as string[]).includes(s) ? (s as EffectiveStatus) : 'canceled';
}

/**
 * Estados de solo lectura: prueba caducada, impago definitivo (`unpaid`), cancelada,
 * `incomplete_expired` y `paused` (prueba de Stripe terminada sin método de pago).
 * `past_due` es ESCRIBIBLE: periodo de gracia mientras Stripe reintenta el cobro (la API expone
 * `paymentFailed` para avisar). `incomplete` (primer pago en curso, ≤ 23 h) también.
 * Un local pendiente de eliminación es siempre de solo lectura.
 */
const READ_ONLY_STATUSES: EffectiveStatus[] = ['trial_expired', 'unpaid', 'canceled', 'incomplete_expired', 'paused'];

/** Estados en los que la suscripción de Stripe está viva y cobrando (o a punto). */
export const LIVE_SUBSCRIPTION_STATUSES = ['active', 'trialing', 'past_due'];
/** Estados en los que una suscripción de Stripe ha terminado. */
export const TERMINATED_SUBSCRIPTION_STATUSES = ['canceled', 'incomplete_expired'];

/**
 * Salvaguarda (I-3): días máximos en `past_due` antes de pasar a solo lectura, por si Stripe no
 * está configurado para cancelar o marcar `unpaid` al agotar los reintentos. Se fija al construir
 * la app desde PAST_DUE_READ_ONLY_DAYS (por defecto 21).
 */
export const DEFAULT_PAST_DUE_READ_ONLY_DAYS = 21;
let pastDueReadOnlyDays = DEFAULT_PAST_DUE_READ_ONLY_DAYS;
export function configureBillingStatus(opts: { pastDueReadOnlyDays: number }): void {
  pastDueReadOnlyDays = opts.pastDueReadOnlyDays;
}

type WritableInput = Pick<Organization, 'subscription_status' | 'trial_ends_at' | 'stripe_subscription_id'> & {
  deletion_scheduled_at?: Date | null;
  past_due_since?: Date | null;
};

/** `past_due` durante más de N días: la gracia ha terminado aunque Stripe siga reintentando. */
export function pastDueExpired(org: Pick<WritableInput, 'subscription_status' | 'past_due_since'>, now = new Date()): boolean {
  if (org.subscription_status !== 'past_due' || !org.past_due_since) return false;
  return now.getTime() - org.past_due_since.getTime() > pastDueReadOnlyDays * 86_400_000;
}

export function isWritable(org: WritableInput, now = new Date()): boolean {
  if (org.deletion_scheduled_at) return false;
  if (pastDueExpired(org, now)) return false;
  return !READ_ONLY_STATUSES.includes(effectiveStatus(org, now));
}

export function subscriptionView(org: Organization, now = new Date()) {
  const status = effectiveStatus(org, now);
  return {
    status,
    readOnly: !isWritable(org, now),
    /** Cobro fallido con reintentos en curso: se puede seguir trabajando, pero hay que avisar. */
    paymentFailed: status === 'past_due',
    /** Desde cuándo el cobro está fallando (`past_due`); pasados PAST_DUE_READ_ONLY_DAYS días, solo lectura. */
    pastDueSince: org.past_due_since?.toISOString() ?? null,
    trialEndsAt: org.trial_ends_at.toISOString(),
    plan: org.plan as 'monthly' | 'annual' | null,
    currentPeriodEnd: org.current_period_end?.toISOString() ?? null,
    cancelAtPeriodEnd: org.cancel_at_period_end,
    hasBillingAccount: org.stripe_customer_id != null,
  };
}

/** Estados de Stripe en los que la suscripción sigue viva (y habría que cancelarla al borrar el local). */
export function hasLiveStripeSubscription(org: Pick<Organization, 'subscription_status' | 'stripe_subscription_id'>): boolean {
  if (!org.stripe_subscription_id) return false;
  return !TERMINATED_SUBSCRIPTION_STATUSES.includes(org.subscription_status);
}
