import { sql } from 'kysely';
import type { DB } from '../../db/index.js';

export interface MaintenanceResult {
  organizations: { due: number; purged: number; skipped: number; blocked: boolean; purged_last_24h?: number; max_per_day?: number };
  auditEvents: number;
}

/**
 * Mantenimiento con el ROL PROPIETARIO (nunca la app): purga los locales cuyo plazo de conservación
 * venció o cuyo titular pidió la eliminación inmediata (con tope diario: si se superaría, no purga
 * ninguno y queda `maintenance.purge_blocked` en la auditoría), y la auditoría más antigua que la
 * retención (mínimo 12 meses, lo fija la base de datos). Lo ejecuta `src/scripts/maintenance.ts`.
 */
export async function runMaintenance(
  db: DB,
  opts: { auditMonths: number; log?: { info: (o: object, m: string) => void; error: (o: object, m: string) => void } },
): Promise<MaintenanceResult> {
  const orgs = (await sql<{ r: MaintenanceResult['organizations'] }>`SELECT public.enregla_purge_due_organizations() AS r`.execute(db)).rows[0]!.r;
  if (orgs.blocked) {
    opts.log?.error(
      { ...orgs },
      `PURGA BLOQUEADA: habría que eliminar ${orgs.due} local(es) y en las últimas 24 h ya se han eliminado ${orgs.purged_last_24h ?? 0} (máximo ${orgs.max_per_day ?? '?'}). No se ha eliminado ninguno. Revisa la auditoría (db.org_deletion_changed) por si son eliminaciones no autorizadas; para continuar, sube max_purges_per_day en enregla_owner_settings.`,
    );
  } else if (orgs.purged > 0 || orgs.skipped > 0) {
    opts.log?.info({ ...orgs }, 'Purga de locales');
  }
  const auditEvents = Number((await sql<{ n: string }>`SELECT public.enregla_purge_audit_events(${opts.auditMonths}::int) AS n`.execute(db)).rows[0]?.n ?? 0);
  return { organizations: orgs, auditEvents };
}
