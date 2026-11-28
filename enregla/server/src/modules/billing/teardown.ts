import type { Organization } from '../../db/types.js';
import type { BillingProvider } from './provider.js';
import { TERMINATED_SUBSCRIPTION_STATUSES, hasLiveStripeSubscription } from './status.js';

export class BillingTeardownError extends Error {
  constructor(
    message: string,
    /** true si no se pudo ni intentar porque Stripe no está configurado en el servidor. */
    readonly notConfigured: boolean,
    options?: { cause?: unknown },
  ) {
    super(message, options);
  }
}

type TeardownOrg = Pick<Organization, 'id' | 'stripe_subscription_id' | 'subscription_status' | 'stripe_checkout_session_id'>;

/**
 * M-1: antes de BORRAR definitivamente un local (eliminación inmediata o purga), se asegura de que
 * nada en Stripe sigue cobrando: expira la sesión de Checkout abierta y, si Stripe dice que la
 * suscripción sigue viva (el estado local puede estar desfasado si un webhook no ha llegado), la
 * cancela (sin reembolso). Lanza BillingTeardownError si no se puede asegurar: entonces NO se borra.
 */
export async function stopOrgBilling(
  billing: BillingProvider | null,
  org: TeardownOrg,
): Promise<{ subscriptionCanceled: string | null; checkoutExpired: string | null }> {
  const out = { subscriptionCanceled: null as string | null, checkoutExpired: null as string | null };
  if (!billing) {
    if (hasLiveStripeSubscription(org)) {
      throw new BillingTeardownError('El local tiene una suscripción viva y Stripe no está configurado en el servidor', true);
    }
    return out;
  }
  try {
    if (org.stripe_checkout_session_id) {
      await billing.expireCheckoutSession(org.stripe_checkout_session_id);
      out.checkoutExpired = org.stripe_checkout_session_id;
    }
    if (org.stripe_subscription_id) {
      const state = await billing.retrieveSubscription(org.stripe_subscription_id);
      if (state && !TERMINATED_SUBSCRIPTION_STATUSES.includes(state.status)) {
        await billing.cancelSubscription(org.stripe_subscription_id);
        out.subscriptionCanceled = org.stripe_subscription_id;
      }
    }
  } catch (err) {
    throw new BillingTeardownError(`No se pudo cancelar en Stripe: ${(err as Error).message}`, false, { cause: err });
  }
  return out;
}
