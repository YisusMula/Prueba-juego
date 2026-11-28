import { sql } from 'kysely';
import type { DB } from '../../db/index.js';
import type { Organization, VerificationSnapshot } from '../../db/types.js';
import { computeCompliance } from '../tasks/service.js';

/**
 * Alertas vigentes del periodo (sobre TODOS los tipos) y cuántas tienen acción correctora, e
 * incidencias del periodo que siguen abiertas. Un registro sustituido por una corrección no cuenta
 * (cuenta su corrección). Los enfriamientos sin cerrar se cuentan aparte (`computeCompliance`).
 */
export async function periodAlertSummary(db: DB, org: Organization, from: string, to: string) {
  const tz = org.timezone;
  const r = await sql<{ alerts: number; with_action: number; open_incidents: number }>`
    SELECT
      count(*) FILTER (WHERE r.alert AND r.type <> 'incidencia')::int AS alerts,
      count(*) FILTER (WHERE r.alert AND r.type <> 'incidencia' AND (
        coalesce(btrim(r.data->>'correctiveAction'), '') <> ''
        OR (r.type = 'recepcion' AND r.data->>'accepted' = 'false' AND coalesce(btrim(r.data->>'rejectionReason'), '') <> '')
        OR (r.type = 'plagas' AND coalesce(btrim(r.data->>'action'), '') <> '')))::int AS with_action,
      count(*) FILTER (WHERE r.type = 'incidencia' AND (r.data->>'closed')::boolean IS NOT TRUE)::int AS open_incidents
    FROM records r
    WHERE r.organization_id = ${org.id}
      AND r.effective_at >= (${from}::date)::timestamp AT TIME ZONE ${tz}
      AND r.effective_at < (${to}::date + 1)::timestamp AT TIME ZONE ${tz}
      AND NOT EXISTS (SELECT 1 FROM records a WHERE a.amends_record_id = r.id)`.execute(db);
  return r.rows[0] ?? { alerts: 0, with_action: 0, open_incidents: 0 };
}

/** Registros (y correcciones) del periodo cuyo hecho cae en [from, to] e insertados después de `after`. */
export async function recordsAddedAfter(db: DB, org: Organization, from: string, to: string, after: Date): Promise<number> {
  const tz = org.timezone;
  const r = await sql<{ n: number }>`
    SELECT count(*)::int AS n FROM records r
    WHERE r.organization_id = ${org.id}
      AND r.effective_at >= (${from}::date)::timestamp AT TIME ZONE ${tz}
      AND r.effective_at < (${to}::date + 1)::timestamp AT TIME ZONE ${tz}
      AND r.created_at > ${after}`.execute(db);
  return r.rows[0]?.n ?? 0;
}

/**
 * Foto de un periodo (H-M1): tareas sin registrar (periodos ya terminados), pendientes, alertas y
 * cuántas sin acción correctora, enfriamientos sin cerrar y nº de registros. Se enseña antes de
 * verificar y se guarda con la verificación.
 */
export async function periodSnapshot(db: DB, org: Organization, from: string, to: string, now: Date): Promise<VerificationSnapshot> {
  const c = await computeCompliance(db, org, from, to, now);
  const a = await periodAlertSummary(db, org, from, to);
  const tz = org.timezone;
  const gaps = c.days.flatMap((d) => d.missing.filter((m) => m.kind !== 'enfriamiento' && !m.pending).map(() => d.date));
  const rec = await sql<{ n: number }>`
    SELECT count(*)::int AS n FROM records r
    WHERE r.organization_id = ${org.id}
      AND r.effective_at >= (${from}::date)::timestamp AT TIME ZONE ${tz}
      AND r.effective_at < (${to}::date + 1)::timestamp AT TIME ZONE ${tz}`.execute(db);
  return {
    gapTasks: gaps.length,
    gapDays: new Set(gaps).size,
    pendingTasks: c.days.reduce((n, d) => n + d.missing.filter((m) => m.pending).length, 0),
    alerts: a.alerts,
    alertsWithoutAction: a.alerts - a.with_action,
    openCoolings: c.days.reduce((n, d) => n + d.missing.filter((m) => m.kind === 'enfriamiento').length, 0),
    records: rec.rows[0]?.n ?? 0,
  };
}
