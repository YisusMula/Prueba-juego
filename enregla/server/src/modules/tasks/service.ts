import { sql } from 'kysely';
import type { DB } from '../../db/index.js';
import type { CleaningPlan, Organization } from '../../db/types.js';
import { effectiveReferenceValues, esNumber, REMEASURE_ACTION, REMEASURE_MINUTES } from '../../schemas/index.js';
import { latestVersion } from '../records/service.js';
import { addDays, dayOfMonth, eachDay, isoWeekday, localDate, startOfIsoWeek, startOfMonth } from '../../lib/dates.js';

/** Último día del periodo (semana ISO o mes) que contiene `date`; el propio día si es diario. */
export function periodEnd(plan: { frequency: Freq }, date: string): string {
  if (plan.frequency === 'weekly') return addDays(startOfIsoWeek(date), 6);
  if (plan.frequency === 'monthly') {
    const [y, m] = date.split('-').map(Number) as [number, number];
    return addDays(m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`, -1);
  }
  return date;
}

/** Día que toca una tarea semanal o mensual dentro del periodo de `date` (null si es diaria o «cuando ocurra»). */
export function dueDateInPeriod(plan: { frequency: Freq; weekday: number | null; month_day: number | null }, date: string): string | null {
  if (plan.frequency === 'weekly' && plan.weekday) return addDays(startOfIsoWeek(date), plan.weekday - 1);
  if (plan.frequency === 'monthly' && plan.month_day) return addDays(startOfMonth(date), plan.month_day - 1);
  return null;
}

/** Registros vigentes: los que no han sido sustituidos por una enmienda. */
const NOT_SUPERSEDED = sql<boolean>`NOT EXISTS (SELECT 1 FROM records a WHERE a.amends_record_id = r.id)`;

type Freq = CleaningPlan['frequency'] | 'on_demand';
export function isDue(plan: { frequency: Freq; weekday: number | null; month_day: number | null }, date: string): boolean {
  if (plan.frequency === 'on_demand') return false;
  if (plan.frequency === 'daily') return true;
  if (plan.frequency === 'weekly') return plan.weekday === isoWeekday(date);
  return plan.month_day === dayOfMonth(date);
}

export function periodStart(plan: { frequency: Freq }, date: string): string {
  if (plan.frequency === 'weekly') return startOfIsoWeek(date);
  if (plan.frequency === 'monthly') return startOfMonth(date);
  return date;
}

/**
 * El registro es una corrección (enmienda) hecha en un día local POSTERIOR al del hecho: cuenta en
 * el día del original (effective_at), pero se registró más tarde (I-1).
 */
const lateAmendment = (tz: string) =>
  sql<boolean>`(r.amends_record_id IS NOT NULL AND (r.created_at AT TIME ZONE ${tz})::date > (r.effective_at AT TIME ZONE ${tz})::date)`;

const startOf = (date: string, tz: string) => sql<Date>`(${date}::date)::timestamp AT TIME ZONE ${tz}`;
const endOf = (date: string, tz: string) => sql<Date>`(${date}::date + 1)::timestamp AT TIME ZONE ${tz}`;

export interface AlertItem {
  kind:
    | 'temperatura_fuera_de_rango'
    | 'aceite_fuera_de_limite'
    | 'recepcion_rechazada'
    | 'recepcion_con_incidencia'
    | 'plagas_con_indicios'
    | 'incidencia_abierta'
    | 'cocinado_por_debajo'
    | 'enfriamiento_fuera_de_criterio'
    | 'enfriamiento_sin_cerrar'
    | 'registro_personalizado_no_conforme'
    | 'registro_personalizado_vencido';
  /** Registro al que lleva (en `registro_personalizado_vencido`, la plantilla). */
  recordId: string;
  message: string;
  createdAt: string;
}

interface EquipmentState {
  valid_from: Date;
  checks_per_day: number;
  active: boolean;
  name: string | null;
}
interface PlanState {
  valid_from: Date;
  frequency: 'daily' | 'weekly' | 'monthly';
  weekday: number | null;
  month_day: number | null;
  active: boolean;
  name: string | null;
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
    .select(['equipment_id', 'valid_from', 'checks_per_day', 'active', 'name'])
    .where('organization_id', '=', orgId)
    .orderBy('equipment_id')
    .orderBy('valid_from')
    .orderBy('id')
    .execute();
  return groupBy(rows, (r) => r.equipment_id);
}

interface TemplateState {
  valid_from: Date;
  frequency: Freq;
  times_per_day: number;
  weekday: number | null;
  month_day: number | null;
  active: boolean;
  name: string | null;
}
async function templateHistory(db: DB, orgId: string): Promise<Map<string, TemplateState[]>> {
  const rows = await db
    .selectFrom('custom_template_config_history')
    .select(['template_id', 'valid_from', 'frequency', 'times_per_day', 'weekday', 'month_day', 'active', 'name'])
    .where('organization_id', '=', orgId)
    .orderBy('template_id')
    .orderBy('valid_from')
    .orderBy('id')
    .execute();
  return groupBy(rows, (r) => r.template_id);
}

/** Lunes y domingo de la semana anterior a `today` (fechas locales). */
export function previousWeek(today: string): { from: string; to: string } {
  const thisMonday = startOfIsoWeek(today);
  return { from: addDays(thisMonday, -7), to: addDays(thisMonday, -1) };
}

/** ¿Hay alguna verificación del responsable que cubra entero [from, to]? */
export async function periodVerified(db: DB, orgId: string, from: string, to: string): Promise<boolean> {
  const r = await db
    .selectFrom('responsible_verifications')
    .select('id')
    .where('organization_id', '=', orgId)
    .where('period_from', '<=', from)
    .where('period_to', '>=', to)
    .limit(1)
    .executeTakeFirst();
  return !!r;
}

/** Enfriamientos empezados y sin cerrar (el inicio es la raíz; se muestra su versión vigente). */
export async function openCoolings(db: DB, org: Organization, now: Date) {
  const refs = effectiveReferenceValues(org.reference_values);
  const roots = await db
    .selectFrom('records as r')
    .select(['r.id', 'r.effective_at'])
    .where('r.organization_id', '=', org.id)
    .where('r.type', '=', 'enfriamiento')
    .where('r.amends_record_id', 'is', null)
    .where(sql<boolean>`r.data->>'phase' = 'inicio'`)
    // H-M4: solo cuenta un cierre original (no una corrección que apunte a otro inicio).
    .where(sql<boolean>`NOT EXISTS (SELECT 1 FROM records c WHERE c.related_record_id = r.id AND c.amends_record_id IS NULL)`)
    .orderBy('r.effective_at')
    .limit(50)
    .execute();
  const out = [];
  for (const root of roots) {
    const v = await latestVersion(db, org.id, root.id);
    const d = (v?.data ?? {}) as { product?: string; startTemp?: number };
    const deadline = new Date(root.effective_at.getTime() + refs.coolingMaxMinutes * 60_000);
    out.push({
      recordId: root.id,
      product: d.product ?? '',
      startTemp: typeof d.startTemp === 'number' ? d.startTemp : null,
      startedAt: root.effective_at.toISOString(),
      deadline: deadline.toISOString(),
      minutesElapsed: Math.max(0, Math.floor((now.getTime() - root.effective_at.getTime()) / 60_000)),
      overdue: now.getTime() >= deadline.getTime(),
      targetTemp: refs.coolingTargetTemp,
      maxMinutes: refs.coolingMaxMinutes,
    });
  }
  return out;
}

async function planHistory(db: DB, orgId: string): Promise<Map<string, PlanState[]>> {
  const rows = await db
    .selectFrom('cleaning_plan_config_history')
    .select(['cleaning_plan_id', 'valid_from', 'frequency', 'weekday', 'month_day', 'active', 'name'])
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
    .select(lateAmendment(tz).as('late'))
    .where('r.organization_id', '=', org.id)
    .where('r.type', '=', 'temperatura')
    .where('r.effective_at', '>=', startOf(today, tz))
    .where('r.effective_at', '<', endOf(today, tz))
    .where(NOT_SUPERSEDED)
    // A igual fecha del hecho, por orden de inserción: «última lectura» es siempre la última anotada.
    .orderBy('r.effective_at')
    .orderBy('r.seq')
    .execute();

  const temperatures = equipment.map((e) => {
    const mine = readings.filter((r) => r.equipment_id === e.id);
    const last = mine[mine.length - 1];
    const done = Math.min(mine.length, e.checks_per_day);
    // Lecturas que solo cuentan gracias a correcciones hechas otro día posterior.
    const correctedLater = done - Math.min(mine.filter((r) => !r.late).length, e.checks_per_day);
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
      correctedLater,
      /** false si el equipo se dio de alta (o se reactivó) hoy: hoy no es exigible ni cuenta en el resumen. */
      countsToday,
      /** 1.12: alguna lectura vigente de hoy está fuera de rango («Hecho con alerta» si además está hecho). */
      withAlert: mine.some((r) => r.alert),
      /** 1.12: la ÚLTIMA lectura vigente de hoy está fuera de rango: hay que volver a medir (desaparece con una lectura posterior correcta). */
      remeasure: last?.alert === true,
      /** Si la acción fue «Repetiré la medición en 30 min»: a partir de cuándo toca volver a medir (ISO). */
      remeasureFrom:
        last?.alert === true && String(last.data.correctiveAction ?? '').includes(REMEASURE_ACTION)
          ? new Date(last.effective_at.getTime() + REMEASURE_MINUTES * 60_000).toISOString()
          : null,
      lastReading: last
        ? { value: last.data.value as number, outOfRange: last.alert, at: last.effective_at.toISOString() }
        : null,
    };
  });

  // H-A2: las diarias, hoy; las semanales y mensuales, todos los días de su periodo (se cumplen con una
  // limpieza completa en cualquier día del periodo), indicando qué día tocan.
  const plans = (
    await db.selectFrom('cleaning_plans').selectAll().where('organization_id', '=', org.id).where('active', '=', true).orderBy('created_at').orderBy('id').execute()
  ).filter((p) => p.frequency !== 'daily' || isDue(p, today));
  const plHist = await planHistory(db, org.id);

  const cleaning = [] as {
    cleaningPlanId: string;
    name: string;
    frequency: string;
    status: 'done' | 'pending';
    countsToday: boolean;
    /** El día que toca es hoy (las semanales y mensuales solo cuentan en el resumen ese día). */
    dueToday: boolean;
    /** Día que toca dentro del periodo (semanal o mensual). */
    dueDate: string | null;
    correctedLater: boolean;
    completedAt: string | null;
    partial: { done: number; total: number; at: string; recordId: string } | null;
  }[];
  for (const p of plans) {
    // Solo una limpieza COMPLETA (todas las zonas hechas) da la tarea por hecha.
    const recs = await db
      .selectFrom('records as r')
      .select(['r.id', 'r.effective_at', 'r.data'])
      .select(lateAmendment(tz).as('late'))
      .where('r.organization_id', '=', org.id)
      .where('r.type', '=', 'limpieza')
      .where('r.cleaning_plan_id', '=', p.id)
      .where('r.effective_at', '>=', startOf(periodStart(p, today), tz))
      .where('r.effective_at', '<', endOf(today, tz))
      .where(NOT_SUPERSEDED)
      .orderBy('r.effective_at', 'desc')
      .limit(50)
      .execute();
    const complete = recs.find((r) => r.data.completed === true);
    const lastPartial = complete ? undefined : recs[0];
    const partialItems = (lastPartial?.data.items as { done: boolean }[] | undefined) ?? [];
    const hist = plHist.get(p.id);
    cleaning.push({
      cleaningPlanId: p.id,
      name: p.name,
      frequency: p.frequency,
      status: complete ? 'done' : 'pending',
      // Hecha, pero solo gracias a una corrección hecha en un día posterior al del hecho.
      correctedLater: complete != null && !recs.some((r) => r.data.completed === true && !r.late),
      countsToday: hist ? stateAt(hist, startToday)?.active === true : p.created_at.getTime() <= startToday.getTime(),
      dueToday: isDue(p, today),
      dueDate: dueDateInPeriod(p, today),
      completedAt: complete?.effective_at.toISOString() ?? null,
      partial: lastPartial
        ? { done: partialItems.filter((i) => i.done).length, total: partialItems.length, at: lastPartial.effective_at.toISOString(), recordId: lastPartial.id }
        : null,
    });
  }

  // Registros personalizados: diarios N veces hoy; semanales y mensuales, todo su periodo (H-A2).
  const allTemplates = await db.selectFrom('custom_record_templates').selectAll().where('organization_id', '=', org.id).where('active', '=', true).orderBy('created_at').orderBy('id').execute();
  const templates = allTemplates.filter((t) => t.frequency === 'weekly' || t.frequency === 'monthly' || isDue(t, today));
  const tplHist = await templateHistory(db, org.id);
  const custom = [] as {
    templateId: string;
    name: string;
    kind: string;
    frequency: string;
    required: number;
    done: number;
    status: 'done' | 'pending';
    countsToday: boolean;
    dueToday: boolean;
    dueDate: string | null;
    withAlert: boolean;
    lastAt: string | null;
  }[];
  for (const t of templates) {
    const recs = await db
      .selectFrom('records as r')
      .select(['r.id', 'r.effective_at', 'r.alert'])
      .where('r.organization_id', '=', org.id)
      .where('r.type', '=', 'personalizado')
      .where('r.custom_template_id', '=', t.id)
      .where('r.effective_at', '>=', startOf(periodStart(t, today), tz))
      .where('r.effective_at', '<', endOf(today, tz))
      .where(NOT_SUPERSEDED)
      .orderBy('r.effective_at', 'desc')
      .limit(50)
      .execute();
    const required = t.frequency === 'daily' ? t.times_per_day : 1;
    const doneN = Math.min(recs.length, required);
    const hist = tplHist.get(t.id);
    custom.push({
      templateId: t.id,
      name: t.name,
      kind: t.kind,
      frequency: t.frequency,
      required,
      done: doneN,
      status: doneN >= required ? 'done' : 'pending',
      countsToday: hist ? stateAt(hist, startToday)?.active === true : t.created_at.getTime() <= startToday.getTime(),
      dueToday: isDue(t, today),
      dueDate: dueDateInPeriod(t, today),
      withAlert: recs.some((r) => r.alert),
      lastAt: recs[0]?.effective_at.toISOString() ?? null,
    });
  }

  const coolings = await openCoolings(db, org, now);
  const lastWeek = previousWeek(today);
  const review = {
    ...lastWeek,
    // Solo se pide si el local ya existía al terminar esa semana.
    due: localDate(org.created_at, tz) <= lastWeek.to,
    verified: await periodVerified(db, org.id, lastWeek.from, lastWeek.to),
  };

  const alerts = await computeAlerts(db, org, today);
  // Recordatorio «cada N meses» (p. ej. verificación de termómetros): avisa si ha pasado el plazo.
  for (const t of allTemplates.filter((x) => x.reminder_months != null)) {
    const last = await db
      .selectFrom('records as r')
      .select(['r.effective_at'])
      .where('r.organization_id', '=', org.id)
      .where('r.custom_template_id', '=', t.id)
      .where(NOT_SUPERSEDED)
      .orderBy('r.effective_at', 'desc')
      .limit(1)
      .executeTakeFirst();
    const since = last?.effective_at ?? t.created_at;
    const limit = new Date(now);
    limit.setUTCMonth(limit.getUTCMonth() - t.reminder_months!);
    if (since.getTime() < limit.getTime()) {
      alerts.unshift({
        kind: 'registro_personalizado_vencido',
        recordId: t.id,
        createdAt: since.toISOString(),
        message: `${t.name}: ${last ? 'han pasado' : 'no consta en'} más de ${t.reminder_months} ${t.reminder_months === 1 ? 'mes' : 'meses'}${last ? ' desde el último registro' : ''}`,
      });
    }
  }
  for (const c of coolings.filter((x) => x.overdue)) {
    alerts.unshift({
      kind: 'enfriamiento_sin_cerrar',
      recordId: c.recordId,
      createdAt: c.startedAt,
      message: `Enfriamiento de ${c.product} sin cerrar: han pasado ${c.maxMinutes} min o más`,
    });
  }

  const counted = temperatures.filter((t) => t.countsToday);
  // Las semanales y mensuales cuentan en el resumen de hoy solo el día que tocan.
  const countedCleaning = cleaning.filter((c) => c.countsToday && c.dueToday);
  const countedCustom = custom.filter((c) => c.countsToday && c.dueToday);
  const total = counted.reduce((a, t) => a + t.required, 0) + countedCleaning.length + countedCustom.reduce((a, c) => a + c.required, 0);
  const done =
    counted.reduce((a, t) => a + t.done, 0) + countedCleaning.filter((c) => c.status === 'done').length + countedCustom.reduce((a, c) => a + c.done, 0);
  const correctedLater = counted.reduce((a, t) => a + t.correctedLater, 0) + countedCleaning.filter((c) => c.correctedLater).length;
  // «Hecho con alerta» cuenta como hecho en el porcentaje (el registro se hizo); la alerta y la
  // remedición se informan aparte para que no se confundan con «todo correcto».
  const doneWithAlert = counted.filter((t) => t.status === 'done' && t.withAlert).length;
  const remeasure = temperatures.filter((t) => t.remeasure).length;
  return {
    date: today,
    timezone: tz,
    temperatures,
    cleaning,
    custom,
    coolings,
    review,
    summary: { total, done, pending: total - done, percent: total === 0 ? 100 : Math.round((done / total) * 100), correctedLater, doneWithAlert, remeasure },
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
      out.push({ kind: 'temperatura_fuera_de_rango', recordId: r.id, createdAt: at, message: `${String(d.equipmentName)}: ${esNumber(Number(d.value))} °C, fuera de rango` });
    } else if (r.type === 'aceite') {
      out.push({ kind: 'aceite_fuera_de_limite', recordId: r.id, createdAt: at, message: `${String(d.fryerName)}: compuestos polares al ${esNumber(Number(d.polarCompounds))} %` });
    } else if (r.type === 'recepcion' && d.accepted === false) {
      out.push({ kind: 'recepcion_rechazada', recordId: r.id, createdAt: at, message: `Mercancía rechazada: ${String(d.product)} (${String(d.supplierName)})` });
    } else if (r.type === 'recepcion') {
      const why = [d.expired ? 'caducada' : null, d.temperatureOutOfRange && typeof d.temperature === 'number' ? `a ${esNumber(d.temperature)} °C` : null].filter(Boolean).join(' y ');
      out.push({ kind: 'recepcion_con_incidencia', recordId: r.id, createdAt: at, message: `Mercancía aceptada ${why || 'con incidencia'}: ${String(d.product)} (${String(d.supplierName)})` });
    } else if (r.type === 'plagas') {
      out.push({ kind: 'plagas_con_indicios', recordId: r.id, createdAt: at, message: 'Revisión de plagas con indicios' });
    } else if (r.type === 'cocinado') {
      out.push({
        kind: 'cocinado_por_debajo',
        recordId: r.id,
        createdAt: at,
        message: `${String(d.product)}: ${esNumber(Number(d.coreTemp))} °C en el centro (referencia ${esNumber(Number(d.referenceTemp))} °C)`,
      });
    } else if (r.type === 'enfriamiento') {
      out.push({
        kind: 'enfriamiento_fuera_de_criterio',
        recordId: r.id,
        createdAt: at,
        message: d.discarded ? `Enfriamiento de ${String(d.product)}: producto desechado` : `Enfriamiento de ${String(d.product)} fuera de criterio (${d.endTemp == null ? '—' : esNumber(Number(d.endTemp))} °C en ${String(d.minutes)} min)`,
      });
    } else if (r.type === 'personalizado') {
      out.push({ kind: 'registro_personalizado_no_conforme', recordId: r.id, createdAt: at, message: `${String(d.templateName)}: no conforme` });
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
    ...t.temperatures.filter((x) => x.remeasure).map((x) => `Volver a medir: ${x.name} (la última lectura estaba fuera de rango)`),
    ...t.cleaning.filter((x) => x.countsToday && x.status === 'pending' && (x.dueDate == null || x.dueDate <= t.date)).map((x) => `Limpieza: ${x.name}`),
    ...t.custom.filter((x) => x.countsToday && x.status === 'pending' && (x.dueDate == null || x.dueDate <= t.date)).map((x) => `${x.name}${x.required > 1 ? ` (${x.done}/${x.required})` : ''}`),
    ...t.alerts.filter((a) => a.kind === 'registro_personalizado_vencido').map((a) => a.message),
    ...t.coolings.map((x) => `Cerrar el enfriamiento de ${x.product}${x.overdue ? ' (fuera de tiempo)' : ''}`),
  ];
}

/** Tarea exigible un día que no se registró (entera o en parte). Sale en Informes y en el PDF. */
export interface MissingTask {
  kind: 'temperatura' | 'limpieza' | 'personalizado' | 'enfriamiento';
  id: string;
  /** Nombre vigente ESE día (historial de configuración), no el actual. En un enfriamiento, el producto. */
  name: string;
  expected: number;
  done: number;
  /** Limpieza: hubo una limpieza PARCIAL en el periodo, pero ninguna completa. */
  partial?: boolean;
  /** Frecuencia de la tarea (las semanales y mensuales se cumplen en cualquier día de su periodo). */
  frequency: string;
  /** El periodo (día, semana o mes) aún no ha terminado: «pendiente», nunca «no consta». */
  pending: boolean;
  /** Último día del periodo de la tarea. */
  periodEnd: string;
}

/**
 * % de cumplimiento por día entre from y to (fechas locales, inclusive). Los días futuros se omiten.
 * Lo esperado de cada día sale de la configuración vigente ESE día (historial de equipos, planes y
 * registros personalizados): desactivar, reactivar o cambiar la frecuencia no reescribe el pasado. Los
 * registros cuentan por la fecha del hecho (effective_at), así que una enmienda no mueve el
 * cumplimiento de día. `missing` dice qué tarea faltó cada día (fase 2, 2A).
 */
export async function computeCompliance(db: DB, org: Organization, from: string, to: string, now = new Date()) {
  const tz = org.timezone;
  const today = localDate(now, tz);
  const last = to > today ? today : to;
  const days: { date: string; expected: number; done: number; percent: number | null; correctedLater: number; missing: MissingTask[] }[] = [];
  let totalExpected = 0;
  let totalDone = 0;
  let totalCorrectedLater = 0;
  if (from <= last) {
    const [eqHist, plHist, tpHist, starts] = await Promise.all([
      equipmentHistory(db, org.id),
      planHistory(db, org.id),
      templateHistory(db, org.id),
      dayStarts(db, from, addDays(last, 1), tz),
    ]);
    const [eqNames, plNames, tpNames] = await Promise.all([
      db.selectFrom('equipment').select(['id', 'name']).where('organization_id', '=', org.id).execute(),
      db.selectFrom('cleaning_plans').select(['id', 'name']).where('organization_id', '=', org.id).execute(),
      db.selectFrom('custom_record_templates').select(['id', 'name']).where('organization_id', '=', org.id).execute(),
    ]);
    const nameOf = new Map([...eqNames, ...plNames, ...tpNames].map((x) => [x.id, x.name]));
    // Nombre vigente ese día (H-M2); si el tramo es anterior a 0012 y no lo tiene, el actual.
    const nameAt = (id: string, st: { name: string | null }) => st.name ?? nameOf.get(id) ?? '—';
    // Las semanales y mensuales se cumplen con un registro en cualquier día de su periodo, también
    // posterior al día que tocan (H-A2): se leen los registros hasta el final del mes de `last`
    // (como mucho, hasta hoy).
    const monthEndOfLast = periodEnd({ frequency: 'monthly' }, last);
    const fetchLast = monthEndOfLast < today ? monthEndOfLast : today;

    const tempCounts = await db
      .selectFrom('records as r')
      .select([
        sql<string>`((r.effective_at AT TIME ZONE ${tz})::date)::text`.as('day'),
        'r.equipment_id',
        sql<number>`count(*)::int`.as('n'),
        sql<number>`(count(*) FILTER (WHERE ${lateAmendment(tz)}))::int`.as('late'),
      ])
      .where('r.organization_id', '=', org.id)
      .where('r.type', '=', 'temperatura')
      .where('r.effective_at', '>=', startOf(from, tz))
      .where('r.effective_at', '<', endOf(last, tz))
      .where(NOT_SUPERSEDED)
      .groupBy(['day', 'r.equipment_id'])
      .execute();
    const tempMap = new Map(tempCounts.map((r) => [`${r.day}|${r.equipment_id}`, r.n]));
    const tempLateMap = new Map(tempCounts.map((r) => [`${r.day}|${r.equipment_id}`, r.late]));

    const periodFrom = startOfMonth(from) < startOfIsoWeek(from) ? startOfMonth(from) : startOfIsoWeek(from);
    const cleanDays = await db
      .selectFrom('records as r')
      .select([
        sql<string>`((r.effective_at AT TIME ZONE ${tz})::date)::text`.as('day'),
        'r.cleaning_plan_id',
        sql<boolean>`bool_or((r.data->>'completed')::boolean IS TRUE)`.as('complete'),
        // true si TODAS las limpiezas completas de ese día son correcciones hechas otro día posterior.
        sql<boolean>`bool_and(${lateAmendment(tz)}) FILTER (WHERE (r.data->>'completed')::boolean IS TRUE)`.as('all_late'),
      ])
      .where('r.organization_id', '=', org.id)
      .where('r.type', '=', 'limpieza')
      .where('r.effective_at', '>=', startOf(periodFrom, tz))
      .where('r.effective_at', '<', endOf(fetchLast, tz))
      .where(NOT_SUPERSEDED)
      .groupBy(['day', 'r.cleaning_plan_id'])
      .execute();
    // Una limpieza parcial no cuenta como tarea hecha (pero se señala como parcial).
    const cleanByPlan = new Map<string, { day: string; complete: boolean; allLate: boolean }[]>();
    for (const r of cleanDays) {
      if (!r.cleaning_plan_id) continue;
      const list = cleanByPlan.get(r.cleaning_plan_id) ?? [];
      list.push({ day: r.day, complete: r.complete, allLate: r.all_late === true });
      cleanByPlan.set(r.cleaning_plan_id, list);
    }

    const customDays = await db
      .selectFrom('records as r')
      .select([
        sql<string>`((r.effective_at AT TIME ZONE ${tz})::date)::text`.as('day'),
        'r.custom_template_id',
        sql<number>`count(*)::int`.as('n'),
        sql<number>`(count(*) FILTER (WHERE ${lateAmendment(tz)}))::int`.as('late'),
      ])
      .where('r.organization_id', '=', org.id)
      .where('r.type', '=', 'personalizado')
      .where('r.effective_at', '>=', startOf(periodFrom, tz))
      .where('r.effective_at', '<', endOf(fetchLast, tz))
      .where(NOT_SUPERSEDED)
      .groupBy(['day', 'r.custom_template_id'])
      .execute();
    const customByTpl = new Map<string, { day: string; n: number; late: number }[]>();
    for (const r of customDays) {
      if (!r.custom_template_id) continue;
      const list = customByTpl.get(r.custom_template_id) ?? [];
      list.push({ day: r.day, n: r.n, late: r.late });
      customByTpl.set(r.custom_template_id, list);
    }

    // H-A3: enfriamientos empezados en el periodo, sin cerrar y con el tiempo máximo ya pasado.
    const refs = effectiveReferenceValues(org.reference_values);
    const unclosed = await db
      .selectFrom('records as r')
      .select(['r.id', 'r.effective_at', sql<string>`((r.effective_at AT TIME ZONE ${tz})::date)::text`.as('day')])
      .where('r.organization_id', '=', org.id)
      .where('r.type', '=', 'enfriamiento')
      .where('r.amends_record_id', 'is', null)
      .where(sql<boolean>`r.data->>'phase' = 'inicio'`)
      .where('r.effective_at', '>=', startOf(from, tz))
      .where('r.effective_at', '<', endOf(last, tz))
      .where('r.effective_at', '<', new Date(now.getTime() - refs.coolingMaxMinutes * 60_000))
      .where(sql<boolean>`NOT EXISTS (SELECT 1 FROM records c WHERE c.related_record_id = r.id AND c.amends_record_id IS NULL)`)
      .orderBy('r.effective_at')
      .execute();
    const unclosedByDay = new Map<string, { id: string; product: string }[]>();
    for (const u of unclosed) {
      const v = await latestVersion(db, org.id, u.id);
      const list = unclosedByDay.get(u.day) ?? [];
      list.push({ id: u.id, product: String((v?.data as { product?: string } | undefined)?.product ?? '—') });
      unclosedByDay.set(u.day, list);
    }

    for (const day of eachDay(from, last)) {
      const start = starts.get(day)!;
      const isToday = day === today;
      const end = isToday ? now : starts.get(addDays(day, 1))!;
      let expected = 0;
      let done = 0;
      // Tareas que solo cuentan como hechas gracias a correcciones hechas en un día posterior
      // (informativo: no cambia el cálculo de `done`).
      let correctedLater = 0;
      const missing: MissingTask[] = [];
      for (const [equipmentId, hist] of eqHist) {
        const st = requiredState(hist, start, end, isToday);
        if (!st || st.checks_per_day <= 0) continue;
        expected += st.checks_per_day;
        const n = tempMap.get(`${day}|${equipmentId}`) ?? 0;
        const late = tempLateMap.get(`${day}|${equipmentId}`) ?? 0;
        const d = Math.min(n, st.checks_per_day);
        done += d;
        correctedLater += d - Math.min(n - late, st.checks_per_day);
        if (d < st.checks_per_day) missing.push({ kind: 'temperatura', id: equipmentId, name: nameAt(equipmentId, st), expected: st.checks_per_day, done: d, frequency: 'daily', pending: isToday, periodEnd: day });
      }
      for (const [planId, hist] of plHist) {
        const st = requiredState(hist, start, end, isToday);
        if (!st || !isDue(st, day)) continue;
        expected += 1;
        const pStart = periodStart(st, day);
        const pEnd = periodEnd(st, day);
        const inPeriod = (cleanByPlan.get(planId) ?? []).filter((d) => d.day >= pStart && d.day <= pEnd);
        const complete = inPeriod.filter((d) => d.complete);
        if (complete.length > 0) {
          done += 1;
          if (complete.every((d) => d.allLate)) correctedLater += 1;
        } else {
          missing.push({ kind: 'limpieza', id: planId, name: nameAt(planId, st), expected: 1, done: 0, partial: inPeriod.length > 0, frequency: st.frequency, pending: pEnd >= today, periodEnd: pEnd });
        }
      }
      for (const [tplId, hist] of tpHist) {
        const st = requiredState(hist, start, end, isToday);
        if (!st || !isDue(st, day)) continue;
        const list = customByTpl.get(tplId) ?? [];
        if (st.frequency === 'daily') {
          const req = st.times_per_day;
          expected += req;
          const row = list.find((x) => x.day === day);
          const n = row?.n ?? 0;
          const d = Math.min(n, req);
          done += d;
          correctedLater += d - Math.min(n - (row?.late ?? 0), req);
          if (d < req) missing.push({ kind: 'personalizado', id: tplId, name: nameAt(tplId, st), expected: req, done: d, frequency: st.frequency, pending: isToday, periodEnd: day });
        } else {
          expected += 1;
          const pStart = periodStart(st, day);
          const pEnd = periodEnd(st, day);
          const inPeriod = list.filter((x) => x.day >= pStart && x.day <= pEnd);
          if (inPeriod.length > 0) {
            done += 1;
            if (inPeriod.every((x) => x.late >= x.n)) correctedLater += 1;
          } else missing.push({ kind: 'personalizado', id: tplId, name: nameAt(tplId, st), expected: 1, done: 0, frequency: st.frequency, pending: pEnd >= today, periodEnd: pEnd });
        }
      }
      for (const u of unclosedByDay.get(day) ?? []) {
        missing.push({ kind: 'enfriamiento', id: u.id, name: u.product, expected: 1, done: 0, frequency: 'once', pending: false, periodEnd: day });
      }
      totalExpected += expected;
      totalDone += done;
      totalCorrectedLater += correctedLater;
      days.push({ date: day, expected, done, percent: expected === 0 ? null : Math.round((done / expected) * 100), correctedLater, missing });
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
      correctedLater: totalCorrectedLater,
      /** Días con alguna tarea exigible sin registrar (o sin completar) en un periodo ya terminado, o con un enfriamiento sin cerrar. */
      daysWithGaps: days.filter((d) => d.missing.some((m) => !m.pending)).length,
      /** Días evaluados: los del periodo desde el alta del local. */
      // Días desde el alta del local (y cualquier día anterior con algo exigible, para no dar «N de 0»).
      daysEvaluated: days.filter((d) => d.date >= localDate(org.created_at, tz) || d.missing.length > 0).length,
    },
  };
}
