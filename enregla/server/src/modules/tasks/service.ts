import { sql } from 'kysely';
import type { DB } from '../../db/index.js';
import type { CleaningPlan, Organization } from '../../db/types.js';
import { addDays, dayOfMonth, eachDay, isoWeekday, localDate, startOfIsoWeek, startOfMonth } from '../../lib/dates.js';

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

interface EquipmentState {
  valid_from: Date;
  checks_per_day: number;
  active: boolean;
}
interface PlanState {
  valid_from: Date;
  frequency: 'daily' | 'weekly' | 'monthly';
  weekday: number | null;
  month_day: number | null;
  active: boolean;
}

/** Configuración vigente en `instant` (último tramo con valid_from ≤ instant, o < si `strict`). */
export function stateAt<T extends { valid_from: Date }>(list: T[], instant: Date, strict = false): T | null {
  let found: T | null = null;
  for (const row of list) {
    const t = row.valid_from.getTime();
    if (strict ? t < instant.getTime() : t <= instant.getTime()) found = row;
    else break;
  }
  return found;
}

function groupBy<T>(rows: T[], key: (r: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const r of rows) {
    const k = key(r);
    const list = m.get(k);
    if (list) list.push(r);
    else m.set(k, [r]);
  }
  return m;
}

async function equipmentHistory(db: DB, orgId: string): Promise<Map<string, EquipmentState[]>> {
  const rows = await db
    .selectFrom('equipment_config_history')
    .select(['equipment_id', 'valid_from', 'checks_per_day', 'active'])
    .where('organization_id', '=', orgId)
    .orderBy('equipment_id')
    .orderBy('valid_from')
    .orderBy('id')
    .execute();
  return groupBy(rows, (r) => r.equipment_id);
}

async function planHistory(db: DB, orgId: string): Promise<Map<string, PlanState[]>> {
  const rows = await db
    .selectFrom('cleaning_plan_config_history')
    .select(['cleaning_plan_id', 'valid_from', 'frequency', 'weekday', 'month_day', 'active'])
    .where('organization_id', '=', orgId)
    .orderBy('cleaning_plan_id')
    .orderBy('valid_from')
    .orderBy('id')
    .execute();
  return groupBy(rows, (r) => r.cleaning_plan_id);
}

/** Instante de inicio (00:00 local) de cada día de [from, to] en la zona del local. */
async function dayStarts(db: DB, from: string, to: string, tz: string): Promise<Map<string, Date>> {
  const r = await sql<{ day: string; start: Date }>`
    SELECT d::date::text AS day, (d::date::timestamp AT TIME ZONE ${tz}) AS start
    FROM generate_series(${from}::date, ${to}::date, interval '1 day') AS d`.execute(db);
  return new Map(r.rows.map((x) => [x.day, x.start]));
}

/**
 * ¿Se exige el elemento el día que empieza en `start` y termina en `end`? Solo si estaba activo
 * al empezar el día y sigue activo al terminar (o ahora, si es hoy): el día de alta o de
 * reactivación no es exigible, ni el de desactivación. Devuelve la configuración del final del día.
 */
function requiredState<T extends { valid_from: Date; active: boolean }>(list: T[] | undefined, start: Date, end: Date, endInclusive: boolean): T | null {
  if (!list) return null;
  const s = stateAt(list, start);
  const e = stateAt(list, end, !endInclusive);
  return s?.active && e?.active ? e : null;
}

export async function computeToday(db: DB, org: Organization, now = new Date()) {
  const tz = org.timezone;
  const today = localDate(now, tz);
  const starts = await dayStarts(db, today, today, tz);
  const startToday = starts.get(today)!;

  const equipment = await db
    .selectFrom('equipment')
    .selectAll()
    .where('organization_id', '=', org.id)
    .where('active', '=', true)
    .where('checks_per_day', '>', 0)
    .orderBy('created_at')
    .execute();
  const eqHist = await equipmentHistory(db, org.id);

  // Lecturas vigentes cuya fecha del HECHO es hoy (una enmienda cuenta en el día del original).
  const readings = await db
    .selectFrom('records as r')
    .select(['r.equipment_id', 'r.data', 'r.effective_at', 'r.alert'])
    .where('r.organization_id', '=', org.id)
    .where('r.type', '=', 'temperatura')
    .where('r.effective_at', '>=', startOf(today, tz))
    .where('r.effective_at', '<', endOf(today, tz))
    .where(NOT_SUPERSEDED)
    .orderBy('r.effective_at')
    .execute();

  const temperatures = equipment.map((e) => {
    const mine = readings.filter((r) => r.equipment_id === e.id);
    const last = mine[mine.length - 1];
    const done = Math.min(mine.length, e.checks_per_day);
    const hist = eqHist.get(e.id);
    // Sin historial (no debería ocurrir tras la migración 0003): se usa la fecha de alta.
    const countsToday = hist ? stateAt(hist, startToday)?.active === true : e.created_at.getTime() <= startToday.getTime();
    return {
      equipmentId: e.id,
      name: e.name,
      type: e.type,
      minTemp: e.min_temp,
      maxTemp: e.max_temp,
      required: e.checks_per_day,
      done,
      status: done >= e.checks_per_day ? ('done' as const) : ('pending' as const),
      /** false si el equipo se dio de alta (o se reactivó) hoy: hoy no es exigible ni cuenta en el resumen. */
      countsToday,
      lastReading: last
        ? { value: last.data.value as number, outOfRange: last.alert, at: last.effective_at.toISOString() }
        : null,
    };
  });

  const plans = (
    await db.selectFrom('cleaning_plans').selectAll().where('organization_id', '=', org.id).where('active', '=', true).orderBy('created_at').execute()
  ).filter((p) => isDue(p, today));
  const plHist = await planHistory(db, org.id);

  const cleaning = [] as {
    cleaningPlanId: string;
    name: string;
    frequency: string;
    status: 'done' | 'pending';
    countsToday: boolean;
    completedAt: string | null;
  }[];
  for (const p of plans) {
    const rec = await db
      .selectFrom('records as r')
      .select(['r.effective_at'])
      .where('r.organization_id', '=', org.id)
      .where('r.type', '=', 'limpieza')
      .where('r.cleaning_plan_id', '=', p.id)
      .where('r.effective_at', '>=', startOf(periodStart(p, today), tz))
      .where('r.effective_at', '<', endOf(today, tz))
      .where(NOT_SUPERSEDED)
      .orderBy('r.effective_at', 'desc')
      .executeTakeFirst();
    const hist = plHist.get(p.id);
    cleaning.push({
      cleaningPlanId: p.id,
      name: p.name,
      frequency: p.frequency,
      status: rec ? 'done' : 'pending',
      countsToday: hist ? stateAt(hist, startToday)?.active === true : p.created_at.getTime() <= startToday.getTime(),
      completedAt: rec?.effective_at.toISOString() ?? null,
    });
  }

  const alerts = await computeAlerts(db, org, today);

  const counted = temperatures.filter((t) => t.countsToday);
  const countedCleaning = cleaning.filter((c) => c.countsToday);
  const total = counted.reduce((a, t) => a + t.required, 0) + countedCleaning.length;
  const done = counted.reduce((a, t) => a + t.done, 0) + countedCleaning.filter((c) => c.status === 'done').length;
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
    .select(['r.id', 'r.type', 'r.data', 'r.effective_at'])
    .where('r.organization_id', '=', org.id)
    .where('r.alert', '=', true)
    .where('r.type', '!=', 'incidencia')
    .where('r.effective_at', '>=', startOf(today, tz))
    .where('r.effective_at', '<', endOf(today, tz))
    .where(NOT_SUPERSEDED)
    .orderBy('r.effective_at', 'desc')
    .limit(50)
    .execute();
  const openIncidents = await db
    .selectFrom('records as r')
    .select(['r.id', 'r.type', 'r.data', 'r.effective_at'])
    .where('r.organization_id', '=', org.id)
    .where('r.type', '=', 'incidencia')
    .where('r.alert', '=', true)
    .where(NOT_SUPERSEDED)
    .orderBy('r.effective_at', 'desc')
    .limit(50)
    .execute();
  const out: AlertItem[] = [];
  for (const r of todays) {
    const d = r.data;
    const at = r.effective_at.toISOString();
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
      createdAt: r.effective_at.toISOString(),
      message: `Incidencia abierta: ${desc.length > 80 ? `${desc.slice(0, 80)}…` : desc}`,
    });
  }
  return out;
}

/** Textos de tareas pendientes (para el recordatorio por email). */
export function pendingLabels(t: Awaited<ReturnType<typeof computeToday>>): string[] {
  return [
    ...t.temperatures.filter((x) => x.countsToday && x.status === 'pending').map((x) => `Temperatura de ${x.name} (${x.done}/${x.required})`),
    ...t.cleaning.filter((x) => x.countsToday && x.status === 'pending').map((x) => `Limpieza: ${x.name}`),
  ];
}

/**
 * % de cumplimiento por día entre from y to (fechas locales, inclusive). Los días futuros se omiten.
 * Lo esperado de cada día sale de la configuración vigente ESE día (historial de equipos y planes):
 * desactivar, reactivar o cambiar la frecuencia no reescribe el pasado. Los registros cuentan por la
 * fecha del hecho (effective_at), así que una enmienda no mueve el cumplimiento de día.
 */
export async function computeCompliance(db: DB, org: Organization, from: string, to: string, now = new Date()) {
  const tz = org.timezone;
  const today = localDate(now, tz);
  const last = to > today ? today : to;
  const days: { date: string; expected: number; done: number; percent: number | null }[] = [];
  let totalExpected = 0;
  let totalDone = 0;
  if (from <= last) {
    const [eqHist, plHist, starts] = await Promise.all([equipmentHistory(db, org.id), planHistory(db, org.id), dayStarts(db, from, addDays(last, 1), tz)]);

    const tempCounts = await db
      .selectFrom('records as r')
      .select([sql<string>`((r.effective_at AT TIME ZONE ${tz})::date)::text`.as('day'), 'r.equipment_id', sql<number>`count(*)::int`.as('n')])
      .where('r.organization_id', '=', org.id)
      .where('r.type', '=', 'temperatura')
      .where('r.effective_at', '>=', startOf(from, tz))
      .where('r.effective_at', '<', endOf(last, tz))
      .where(NOT_SUPERSEDED)
      .groupBy(['day', 'r.equipment_id'])
      .execute();
    const tempMap = new Map(tempCounts.map((r) => [`${r.day}|${r.equipment_id}`, r.n]));

    const cleanFrom = startOfMonth(from) < startOfIsoWeek(from) ? startOfMonth(from) : startOfIsoWeek(from);
    const cleanDays = await db
      .selectFrom('records as r')
      .select([sql<string>`((r.effective_at AT TIME ZONE ${tz})::date)::text`.as('day'), 'r.cleaning_plan_id'])
      .distinct()
      .where('r.organization_id', '=', org.id)
      .where('r.type', '=', 'limpieza')
      .where('r.effective_at', '>=', startOf(cleanFrom, tz))
      .where('r.effective_at', '<', endOf(last, tz))
      .where(NOT_SUPERSEDED)
      .execute();
    const cleanByPlan = new Map<string, string[]>();
    for (const r of cleanDays) {
      if (!r.cleaning_plan_id) continue;
      const list = cleanByPlan.get(r.cleaning_plan_id) ?? [];
      list.push(r.day);
      cleanByPlan.set(r.cleaning_plan_id, list);
    }

    for (const day of eachDay(from, last)) {
      const start = starts.get(day)!;
      const isToday = day === today;
      const end = isToday ? now : starts.get(addDays(day, 1))!;
      let expected = 0;
      let done = 0;
      for (const [equipmentId, hist] of eqHist) {
        const st = requiredState(hist, start, end, isToday);
        if (!st || st.checks_per_day <= 0) continue;
        expected += st.checks_per_day;
        done += Math.min(tempMap.get(`${day}|${equipmentId}`) ?? 0, st.checks_per_day);
      }
      for (const [planId, hist] of plHist) {
        const st = requiredState(hist, start, end, isToday);
        if (!st || !isDue(st, day)) continue;
        expected += 1;
        const pStart = periodStart(st, day);
        if ((cleanByPlan.get(planId) ?? []).some((d) => d >= pStart && d <= day)) done += 1;
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
