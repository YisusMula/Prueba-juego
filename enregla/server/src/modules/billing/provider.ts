import Stripe from 'stripe';
import type { Config } from '../../config.js';

export interface CheckoutParams {
  organizationId: string;
  customerId: string | null;
  customerEmail: string;
  priceId: string;
  plan: 'monthly' | 'annual';
  /** Fin de la prueba (segundos UNIX) si quedan ≥ 48 h de prueba local. */
  trialEnd: number | null;
  successUrl: string;
  cancelUrl: string;
}

/** Evento de Stripe ya verificado (subconjunto que usamos). */
export interface BillingEvent {
  id: string;
  type: string;
  created: number;
  data: { object: Record<string, unknown> };
}

/** Estado actual de una suscripción según Stripe (fuente de verdad para el webhook). */
export interface SubscriptionState {
  id: string;
  status: string;
  customerId: string | null;
  metadata: Record<string, string>;
  cancelAtPeriodEnd: boolean;
  /** Segundos UNIX. */
  currentPeriodEnd: number | null;
  priceId: string | null;
}

/** Abstracción sobre Stripe para poder sustituir las llamadas de red en tests. */
export interface BillingProvider {
  readonly priceMonthly: string;
  readonly priceAnnual: string;
  createCheckoutSession(params: CheckoutParams): Promise<{ url: string }>;
  createPortalSession(params: { customerId: string; returnUrl: string }): Promise<{ url: string }>;
  /** Cancela de inmediato una suscripción (al eliminar el local). Una suscripción que ya no existe cuenta como cancelada. */
  cancelSubscription(subscriptionId: string): Promise<void>;
  /**
   * Recupera el estado ACTUAL de una suscripción. `null` si Stripe no la conoce (resource_missing).
   * Lanza ante errores de red/servidor (el webhook responde 5xx para que Stripe reintente).
   */
  retrieveSubscription(subscriptionId: string): Promise<SubscriptionState | null>;
  /** Verifica la firma sobre el cuerpo crudo. Lanza si la firma no es válida. */
  constructEvent(rawBody: Buffer, signature: string): BillingEvent;
}

export class StripeBillingProvider implements BillingProvider {
  protected readonly stripe: Stripe;
  readonly priceMonthly: string;
  readonly priceAnnual: string;
  private readonly webhookSecret: string;

  constructor(cfg: NonNullable<Config['stripe']>) {
    this.stripe = new Stripe(cfg.secretKey, { maxNetworkRetries: 2, timeout: 20_000 });
    this.webhookSecret = cfg.webhookSecret;
    this.priceMonthly = cfg.priceMonthly;
    this.priceAnnual = cfg.priceAnnual;
  }

  async createCheckoutSession(p: CheckoutParams): Promise<{ url: string }> {
    const session = await this.stripe.checkout.sessions.create(
      {
        mode: 'subscription',
        line_items: [{ price: p.priceId, quantity: 1 }],
        client_reference_id: p.organizationId,
        ...(p.customerId ? { customer: p.customerId } : { customer_email: p.customerEmail }),
        subscription_data: {
          metadata: { organization_id: p.organizationId, plan: p.plan },
          ...(p.trialEnd ? { trial_end: p.trialEnd } : {}),
        },
        metadata: { organization_id: p.organizationId, plan: p.plan },
        locale: 'es',
        allow_promotion_codes: true,
        billing_address_collection: 'required',
        tax_id_collection: { enabled: true },
        success_url: p.successUrl,
        cancel_url: p.cancelUrl,
      },
      { idempotencyKey: `checkout-${p.organizationId}-${p.plan}-${Math.floor(Date.now() / 60_000)}` },
    );
    if (!session.url) throw new Error('Stripe no devolvió URL de Checkout');
    return { url: session.url };
  }

  async createPortalSession(p: { customerId: string; returnUrl: string }): Promise<{ url: string }> {
    const session = await this.stripe.billingPortal.sessions.create({ customer: p.customerId, return_url: p.returnUrl, locale: 'es' });
    return { url: session.url };
  }

  async cancelSubscription(subscriptionId: string): Promise<void> {
    try {
      await this.stripe.subscriptions.cancel(subscriptionId, undefined, { idempotencyKey: `cancel-${subscriptionId}` });
    } catch (err) {
      const e = err as { code?: string; statusCode?: number };
      if (e.code === 'resource_missing' || e.statusCode === 404) return;
      throw err;
    }
  }

  async retrieveSubscription(subscriptionId: string): Promise<SubscriptionState | null> {
    try {
      const sub = await this.stripe.subscriptions.retrieve(subscriptionId);
      const item = sub.items.data[0] as (Stripe.SubscriptionItem & { current_period_end?: number }) | undefined;
      const legacyEnd = (sub as unknown as { current_period_end?: number }).current_period_end;
      return {
        id: sub.id,
        status: sub.status,
        customerId: typeof sub.customer === 'string' ? sub.customer : (sub.customer?.id ?? null),
        metadata: { ...(sub.metadata ?? {}) },
        cancelAtPeriodEnd: sub.cancel_at_period_end === true,
        currentPeriodEnd: item?.current_period_end ?? legacyEnd ?? null,
        priceId: item?.price?.id ?? null,
      };
    } catch (err) {
      const e = err as { code?: string; statusCode?: number };
      if (e.code === 'resource_missing' || e.statusCode === 404) return null;
      throw err;
    }
  }

  constructEvent(rawBody: Buffer, signature: string): BillingEvent {
    const event = this.stripe.webhooks.constructEvent(rawBody, signature, this.webhookSecret);
    return event as unknown as BillingEvent;
  }
}
