import { sql } from 'kysely';
import type { DB } from '../../db/index.js';
import type { BillingProvider } from '../billing/provider.js';
import { TERMINATED_SUBSCRIPTION_STATUSES } from '../billing/status.js';

export interface MaintenanceResult {
  organizations: { due: number; purged: number; skipped: number; blocked: boolean; eligible?: number; purged_last_24h?: number; max_per_day?: number };
  /** Suscripciones de locales a purgar comprobadas en Stripe: terminadas, vivas o sin poder comprobar. */
  subscriptions: { verified: number; live: number; unverifiable: number };
  auditEvents: number;
}

type Log = { info: (o: object, m: string) => void; error: (o: object, m: string) => void };

/** Tiempos máximos del mantenimiento (R4 e): un bloqueo ajeno no lo deja colgado. */
export const MAINTENANCE_LOCK_TIMEOUT = '10s';
export const MAINTENANCE_STATEMENT_TIMEOUT = '5min';

/**
 * Mantenimiento con el ROL PROPIETARIO (nunca la app; lo ejecuta `src/scripts/maintenance.ts`):
 *  1. Comprueba EN STRIPE cada suscripción que hayan tenido los locales que toca purgar (la base de
 *     datos guarda todas las que ha visto; vaciar `stripe_subscription_id` no basta para esquivarlo).
 *     Solo las que Stripe da por terminadas (o no conoce) se marcan como verificadas. Sin Stripe
 *     configurado en el mantenimiento, esos locales no se purgan y queda un error en el log.
 *  2. Purga los locales vencidos o con eliminación inmediata pedida, con la salvaguarda diaria.
 *  3. Purga la auditoría más antigua que la retención (mínimo 12 meses, lo fija la base de datos).
 * Todo con lock_timeout y statement_timeout.
 */
export async function runMaintenance(db: DB, opts: { auditMonths: number; log?: Log; billing?: BillingProvider | null }): Promise<MaintenanceResult> {
  const subscriptions = { verified: 0, live: 0, unverifiable: 0 };
  const pending = await sql<{ organization_id: string; subscription_id: string }>`
    SELECT s.organization_id, s.subscription_id FROM public.enregla_org_subscriptions s
      JOIN public.organizations o ON o.id = s.organization_id
     WHERE s.verified_terminal_at IS NULL AND o.deletion_scheduled_at IS NOT NULL
       AND (o.deletion_scheduled_at <= clock_timestamp() OR o.purge_requested_at IS NOT NULL)`.execute(db);
  for (const p of pending.rows) {
    if (!opts.billing) {
      subscriptions.unverifiable += 1;
      opts.log?.error(
        { organizationId: p.organization_id, subscriptionId: p.subscription_id },
        'Local pendiente de purga con una suscripción de Stripe que el mantenimiento no puede comprobar (falta STRIPE_SECRET_KEY): no se purga',
      );
      continue;
    }
    try {
      const state = await opts.billing.retrieveSubscription(p.subscription_id);
      if (!state || TERMINATED_SUBSCRIPTION_STATUSES.includes(state.status)) {
        await sql`UPDATE public.enregla_org_subscriptions SET verified_terminal_at = clock_timestamp()
                   WHERE organization_id = ${p.organization_id}::uuid AND subscription_id = ${p.subscription_id}`.execute(db);
        subscriptions.verified += 1;
      } else {
        subscriptions.live += 1;
        opts.log?.error(
          { organizationId: p.organization_id, subscriptionId: p.subscription_id, status: state.status },
          'Local pendiente de purga con una suscripción VIVA en Stripe: no se purga (revisa la facturación; la app la cancela al pedir la eliminación)',
        );
      }
    } catch (err) {
      subscriptions.unverifiable += 1;
      opts.log?.error({ organizationId: p.organization_id, err: (err as Error).message }, 'No se pudo comprobar la suscripción en Stripe: no se purga en esta pasada');
    }
  }
  return db.transaction().execute(async (trx) => {
    await sql`SELECT set_config('lock_timeout', ${MAINTENANCE_LOCK_TIMEOUT}, true), set_config('statement_timeout', ${MAINTENANCE_STATEMENT_TIMEOUT}, true)`.execute(trx);
    const orgs = (await sql<{ r: MaintenanceResult['organizations'] }>`SELECT public.enregla_purge_due_organizations() AS r`.execute(trx)).rows[0]!.r;
    if (orgs.blocked) {
      opts.log?.error(
        { ...orgs },
        `PURGA BLOQUEADA: habría que eliminar ${orgs.eligible ?? orgs.due} local(es) y en las últimas 24 h ya se han eliminado ${orgs.purged_last_24h ?? 0} (máximo ${orgs.max_per_day ?? '?'}). No se ha eliminado ninguno. Revisa la auditoría (db.org_deletion_changed) por si son eliminaciones no autorizadas; para continuar, sube max_purges_per_day en enregla_owner_settings.`,
      );
    } else if (orgs.purged > 0 || orgs.skipped > 0) {
      opts.log?.info({ ...orgs }, 'Purga de locales');
    }
    const auditEvents = Number((await sql<{ n: string }>`SELECT public.enregla_purge_audit_events(${opts.auditMonths}::int) AS n`.execute(trx)).rows[0]?.n ?? 0);
    return { organizations: orgs, subscriptions, auditEvents };
  });
}
