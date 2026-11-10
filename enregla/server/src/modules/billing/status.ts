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
 * Solo 'active' y 'trialing' permiten escribir. Cualquier otro estado (prueba caducada,
 * impago, cancelada…) deja la organización en solo lectura.
 */
export function isWritable(org: Pick<Organization, 'subscription_status' | 'trial_ends_at' | 'stripe_subscription_id'>, now = new Date()): boolean {
  const s = effectiveStatus(org, now);
  return s === 'active' || s === 'trialing';
}

export function subscriptionView(org: Organization, now = new Date()) {
  return {
    status: effectiveStatus(org, now),
    readOnly: !isWritable(org, now),
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
