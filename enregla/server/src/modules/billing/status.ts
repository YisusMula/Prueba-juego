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

type WritableInput = Pick<Organization, 'subscription_status' | 'trial_ends_at' | 'stripe_subscription_id'> & { deletion_scheduled_at?: Date | null };

export function isWritable(org: WritableInput, now = new Date()): boolean {
  if (org.deletion_scheduled_at) return false;
  return !READ_ONLY_STATUSES.includes(effectiveStatus(org, now));
}

export function subscriptionView(org: Organization, now = new Date()) {
  const status = effectiveStatus(org, now);
  return {
    status,
    readOnly: !isWritable(org, now),
    /** Cobro fallido con reintentos en curso: se puede seguir trabajando, pero hay que avisar. */
    paymentFailed: status === 'past_due',
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
  return !['canceled', 'incomplete_expired'].includes(org.subscription_status);
}
