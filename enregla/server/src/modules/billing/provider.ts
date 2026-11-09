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

/** Abstracción sobre Stripe para poder sustituir las llamadas de red en tests. */
export interface BillingProvider {
  readonly priceMonthly: string;
  readonly priceAnnual: string;
  createCheckoutSession(params: CheckoutParams): Promise<{ url: string }>;
  createPortalSession(params: { customerId: string; returnUrl: string }): Promise<{ url: string }>;
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

  constructEvent(rawBody: Buffer, signature: string): BillingEvent {
    const event = this.stripe.webhooks.constructEvent(rawBody, signature, this.webhookSecret);
    return event as unknown as BillingEvent;
  }
}
