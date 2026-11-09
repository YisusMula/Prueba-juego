import { sql } from 'kysely';
import type { DB } from '../../db/index.js';
import type { CleaningPlan, Organization } from '../../db/types.js';
import { dayOfMonth, eachDay, isoWeekday, localDate, startOfIsoWeek, startOfMonth } from '../../lib/dates.js';

/** Registros vigentes: los que no han sido sustituidos por una enmienda. */
const NOT_SUPERSEDED = sql<boolean>`NOT EXISTS (SELECT 1 FROM records a WHERE a.amends_record_id = r.id)`;

export function isDue(plan: Pick<CleaningPlan, 'frequency' | 'weekday' | 'month_day'>, date: string): boolean {
  if (plan.frequency === 'daily') return true;
  if (plan.frequency === 'weekly') return plan.weekday === isoWeekday(date);
  return plan.month_day === dayOfMonth(date);
}

export function periodStart(plan: Pick<CleaningPlan, 'frequency'>, date: string): string {
  if (plan.frequency === 'weekly') return startOfIsoWeek(date);
  if (plan.frequency === 'monthly') return startOfMonth(date);
  return date;
}

const startOf = (date: string, tz: string) => sql<Date>`(${date}::date)::timestamp AT TIME ZONE ${tz}`;
const endOf = (date: string, tz: string) => sql<Date>`(${date}::date + 1)::timestamp AT TIME ZONE ${tz}`;

export interface AlertItem {
  kind: 'temperatura_fuera_de_rango' | 'aceite_fuera_de_limite' | 'recepcion_rechazada' | 'plagas_con_indicios' | 'incidencia_abierta';
  recordId: string;
  message: string;
  createdAt: string;
}

export async function computeToday(db: DB, org: Organization, now = new Date()) {
  const tz = org.timezone;
  const today = localDate(now, tz);

  const equipment = await db
    .selectFrom('equipment')
    .selectAll()
    .where('organization_id', '=', org.id)
    .where('active', '=', true)
    .where('checks_per_day', '>', 0)
    .orderBy('created_at')
    .execute();

  const readings = await db
    .selectFrom('records as r')
    .select(['r.equipment_id', 'r.data', 'r.created_at', 'r.alert'])
    .where('r.organization_id', '=', org.id)
    .where('r.type', '=', 'temperatura')
    .where('r.created_at', '>=', startOf(today, tz))
    .where('r.created_at', '<', endOf(today, tz))
    .where(NOT_SUPERSEDED)
    .orderBy('r.created_at')
    .execute();

  const temperatures = equipment.map((e) => {
    const mine = readings.filter((r) => r.equipment_id === e.id);
    const last = mine[mine.length - 1];
    const done = Math.min(mine.length, e.checks_per_day);
    return {
      equipmentId: e.id,
      name: e.name,
      type: e.type,
      minTemp: e.min_temp,
      maxTemp: e.max_temp,
      required: e.checks_per_day,
      done,
      status: done >= e.checks_per_day ? ('done' as const) : ('pending' as const),
      lastReading: last
        ? { value: last.data.value as number, outOfRange: last.alert, at: last.created_at.toISOString() }
        : null,
    };
  });

  const plans = (
    await db.selectFrom('cleaning_plans').selectAll().where('organization_id', '=', org.id).where('active', '=', true).orderBy('created_at').execute()
  ).filter((p) => isDue(p, today));

  const cleaning = [] as {
    cleaningPlanId: string;
    name: string;
    frequency: string;
    status: 'done' | 'pending';
    completedAt: string | null;
  }[];
  for (const p of plans) {
    const rec = await db
      .selectFrom('records as r')
      .select(['r.created_at'])
      .where('r.organization_id', '=', org.id)
      .where('r.type', '=', 'limpieza')
      .where('r.cleaning_plan_id', '=', p.id)
      .where('r.created_at', '>=', startOf(periodStart(p, today), tz))
      .where('r.created_at', '<', endOf(today, tz))
      .where(NOT_SUPERSEDED)
      .orderBy('r.created_at', 'desc')
      .executeTakeFirst();
    cleaning.push({
      cleaningPlanId: p.id,
      name: p.name,
      frequency: p.frequency,
      status: rec ? 'done' : 'pending',
      completedAt: rec?.created_at.toISOString() ?? null,
    });
  }

  const alerts = await computeAlerts(db, org, today);

  const total = temperatures.reduce((a, t) => a + t.required, 0) + cleaning.length;
  const done = temperatures.reduce((a, t) => a + t.done, 0) + cleaning.filter((c) => c.status === 'done').length;
  return {
    date: today,
    timezone: tz,
    temperatures,
    cleaning,
    summary: { total, done, pending: total - done, percent: total === 0 ? 100 : Math.round((done / total) * 100) },
    alerts,
  };
}

async function computeAlerts(db: DB, org: Organization, today: string): Promise<AlertItem[]> {
  const tz = org.timezone;
  const todays = await db
    .selectFrom('records as r')
    .select(['r.id', 'r.type', 'r.data', 'r.created_at'])
    .where('r.organization_id', '=', org.id)
    .where('r.alert', '=', true)
    .where('r.type', '!=', 'incidencia')
    .where('r.created_at', '>=', startOf(today, tz))
    .where('r.created_at', '<', endOf(today, tz))
    .where(NOT_SUPERSEDED)
    .orderBy('r.created_at', 'desc')
    .limit(50)
    .execute();
  const openIncidents = await db
    .selectFrom('records as r')
    .select(['r.id', 'r.type', 'r.data', 'r.created_at'])
    .where('r.organization_id', '=', org.id)
    .where('r.type', '=', 'incidencia')
    .where('r.alert', '=', true)
    .where(NOT_SUPERSEDED)
    .orderBy('r.created_at', 'desc')
    .limit(50)
    .execute();
  const out: AlertItem[] = [];
  for (const r of todays) {
    const d = r.data;
    const at = r.created_at.toISOString();
    if (r.type === 'temperatura') {
      out.push({ kind: 'temperatura_fuera_de_rango', recordId: r.id, createdAt: at, message: `${String(d.equipmentName)}: ${String(d.value)} °C fuera de rango` });
    } else if (r.type === 'aceite') {
      out.push({ kind: 'aceite_fuera_de_limite', recordId: r.id, createdAt: at, message: `${String(d.fryerName)}: compuestos polares ${String(d.polarCompounds)} %` });
    } else if (r.type === 'recepcion') {
      out.push({ kind: 'recepcion_rechazada', recordId: r.id, createdAt: at, message: `Mercancía rechazada: ${String(d.product)} (${String(d.supplierName)})` });
    } else if (r.type === 'plagas') {
      out.push({ kind: 'plagas_con_indicios', recordId: r.id, createdAt: at, message: 'Revisión de plagas con indicios' });
    }
  }
  for (const r of openIncidents) {
    const desc = String(r.data.description);
    out.push({
      kind: 'incidencia_abierta',
      recordId: r.id,
      createdAt: r.created_at.toISOString(),
      message: `Incidencia abierta: ${desc.length > 80 ? `${desc.slice(0, 80)}…` : desc}`,
    });
  }
  return out;
}

/** Textos de tareas pendientes (para el recordatorio por email). */
export function pendingLabels(t: Awaited<ReturnType<typeof computeToday>>): string[] {
  return [
    ...t.temperatures.filter((x) => x.status === 'pending').map((x) => `Temperatura de ${x.name} (${x.done}/${x.required})`),
    ...t.cleaning.filter((x) => x.status === 'pending').map((x) => `Limpieza: ${x.name}`),
  ];
}

/** % de cumplimiento por día entre from y to (fechas locales, inclusive). Los días futuros se omiten. */
export async function computeCompliance(db: DB, org: Organization, from: string, to: string, now = new Date()) {
  const tz = org.timezone;
  const today = localDate(now, tz);
  const last = to > today ? today : to;
  const equipment = await db.selectFrom('equipment').selectAll().where('organization_id', '=', org.id).where('active', '=', true).where('checks_per_day', '>', 0).execute();
  const plans = await db.selectFrom('cleaning_plans').selectAll().where('organization_id', '=', org.id).where('active', '=', true).execute();

  const tempCounts = await db
    .selectFrom('records as r')
    .select([sql<string>`((r.created_at AT TIME ZONE ${tz})::date)::text`.as('day'), 'r.equipment_id', sql<number>`count(*)::int`.as('n')])
    .where('r.organization_id', '=', org.id)
    .where('r.type', '=', 'temperatura')
    .where('r.created_at', '>=', startOf(from, tz))
    .where('r.created_at', '<', endOf(last, tz))
    .where(NOT_SUPERSEDED)
    .groupBy(['day', 'r.equipment_id'])
    .execute();
  const tempMap = new Map(tempCounts.map((r) => [`${r.day}|${r.equipment_id}`, r.n]));

  const cleanFrom = startOfMonth(from) < startOfIsoWeek(from) ? startOfMonth(from) : startOfIsoWeek(from);
  const cleanDays = await db
    .selectFrom('records as r')
    .select([sql<string>`((r.created_at AT TIME ZONE ${tz})::date)::text`.as('day'), 'r.cleaning_plan_id'])
    .distinct()
    .where('r.organization_id', '=', org.id)
    .where('r.type', '=', 'limpieza')
    .where('r.created_at', '>=', startOf(cleanFrom, tz))
    .where('r.created_at', '<', endOf(last, tz))
    .where(NOT_SUPERSEDED)
    .execute();
  const cleanByPlan = new Map<string, string[]>();
  for (const r of cleanDays) {
    if (!r.cleaning_plan_id) continue;
    const list = cleanByPlan.get(r.cleaning_plan_id) ?? [];
    list.push(r.day);
    cleanByPlan.set(r.cleaning_plan_id, list);
  }

  const days: { date: string; expected: number; done: number; percent: number | null }[] = [];
  let totalExpected = 0;
  let totalDone = 0;
  if (from <= last) {
    for (const day of eachDay(from, last)) {
      let expected = 0;
      let done = 0;
      for (const e of equipment) {
        if (localDate(e.created_at, tz) > day) continue;
        expected += e.checks_per_day;
        done += Math.min(tempMap.get(`${day}|${e.id}`) ?? 0, e.checks_per_day);
      }
      for (const p of plans) {
        if (localDate(p.created_at, tz) > day || !isDue(p, day)) continue;
        expected += 1;
        const start = periodStart(p, day);
        if ((cleanByPlan.get(p.id) ?? []).some((d) => d >= start && d <= day)) done += 1;
      }
      totalExpected += expected;
      totalDone += done;
      days.push({ date: day, expected, done, percent: expected === 0 ? null : Math.round((done / expected) * 100) });
    }
  }
  return {
    from,
    to,
    days,
    overall: {
      expected: totalExpected,
      done: totalDone,
      percent: totalExpected === 0 ? null : Math.round((totalDone / totalExpected) * 100),
    },
  };
}

