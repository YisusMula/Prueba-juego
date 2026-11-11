/**
 * Tareas de hoy, alertas y cumplimiento: la misma lógica que `server/src/modules/tasks/service.ts`,
 * sobre las tablas en memoria de la demo.
 */
import { esNumber } from '@shared/schemas';
import type { AlertKind, Compliance, Frequency, TodayTasks } from '@/api/types';
import type { DemoState, DOrg, DRecord, EquipmentState, PlanState } from './state';
import { addDays, dayOfMonth, dayStart, eachDay, iso, isoWeekday, localDate, startOfIsoWeek, startOfMonth } from './time';

export function isDue(plan: { frequency: Frequency; weekday: number | null; monthDay: number | null }, date: string): boolean {
  if (plan.frequency === 'daily') return true;
  if (plan.frequency === 'weekly') return plan.weekday === isoWeekday(date);
  return plan.monthDay === dayOfMonth(date);
}

export function periodStart(plan: { frequency: Frequency }, date: string): string {
  if (plan.frequency === 'weekly') return startOfIsoWeek(date);
  if (plan.frequency === 'monthly') return startOfMonth(date);
  return date;
}

/** Configuración vigente en `instant` (último tramo con validFrom ≤ instant, o < si `strict`). */
function stateAt<T extends { validFrom: number }>(list: T[], instant: number, strict = false): T | null {
  let found: T | null = null;
  for (const row of list) {
    if (strict ? row.validFrom < instant : row.validFrom <= instant) found = row;
    else break;
  }
  return found;
}

function requiredState<T extends { validFrom: number; active: boolean }>(list: T[], start: number, end: number, endInclusive: boolean): T | null {
  const s = stateAt(list, start);
  const e = stateAt(list, end, !endInclusive);
  return s?.active && e?.active ? e : null;
}

/** Registros vigentes del local (los que no han sido sustituidos por una enmienda). */
export function currentRecords(db: DemoState, orgId: string): DRecord[] {
  const superseded = new Set<string>();
  for (const r of db.records) if (r.orgId === orgId && r.amendsRecordId) superseded.add(r.amendsRecordId);
  return db.records.filter((r) => r.orgId === orgId && !superseded.has(r.id));
}

/** Enmienda registrada en un día local posterior al del hecho. */
const isLate = (r: DRecord, tz: string) => r.amendsRecordId != null && localDate(new Date(r.createdAt), tz) > localDate(new Date(r.effectiveAt), tz);

export function computeToday(db: DemoState, org: DOrg, now = Date.now()): TodayTasks {
  const tz = org.timezone;
  const today = localDate(new Date(now), tz);
  const startToday = dayStart(today, tz);
  const endToday = dayStart(addDays(today, 1), tz);
  const live = currentRecords(db, org.id);

  const equipment = db.equipment.filter((e) => e.orgId === org.id && e.active && e.checksPerDay > 0).sort((a, b) => a.createdAt - b.createdAt);
  const readings = live
    .filter((r) => r.type === 'temperatura' && r.effectiveAt >= startToday && r.effectiveAt < endToday)
    .sort((a, b) => a.effectiveAt - b.effectiveAt);
  const temperatures = equipment.map((e) => {
    const mine = readings.filter((r) => r.equipmentId === e.id);
    const last = mine[mine.length - 1];
    const done = Math.min(mine.length, e.checksPerDay);
    const correctedLater = done - Math.min(mine.filter((r) => !isLate(r, tz)).length, e.checksPerDay);
    return {
      equipmentId: e.id,
      name: e.name,
      type: e.type,
      minTemp: e.minTemp,
      maxTemp: e.maxTemp,
      required: e.checksPerDay,
      done,
      status: done >= e.checksPerDay ? ('done' as const) : ('pending' as const),
      correctedLater,
      countsToday: stateAt(e.history, startToday)?.active === true,
      lastReading: last ? { value: Number(last.data.value), outOfRange: last.alert, at: iso(last.effectiveAt) } : null,
    };
  });

  const plans = db.plans.filter((p) => p.orgId === org.id && p.active && isDue(p, today)).sort((a, b) => a.createdAt - b.createdAt);
  const cleaning = plans.map((p) => {
    const from = dayStart(periodStart(p, today), tz);
    const recs = live
      .filter((r) => r.type === 'limpieza' && r.cleaningPlanId === p.id && r.effectiveAt >= from && r.effectiveAt < endToday)
      .sort((a, b) => b.effectiveAt - a.effectiveAt);
    const complete = recs.find((r) => r.data.completed === true);
    const lastPartial = complete ? undefined : recs[0];
    const partialItems = (lastPartial?.data.items as { done: boolean }[] | undefined) ?? [];
    return {
      cleaningPlanId: p.id,
      name: p.name,
      frequency: p.frequency,
      status: complete ? ('done' as const) : ('pending' as const),
      correctedLater: complete != null && !recs.some((r) => r.data.completed === true && !isLate(r, tz)),
      countsToday: stateAt(p.history, startToday)?.active === true,
      completedAt: complete ? iso(complete.effectiveAt) : null,
      partial: lastPartial
        ? { done: partialItems.filter((i) => i.done).length, total: partialItems.length, at: iso(lastPartial.effectiveAt), recordId: lastPartial.id }
        : null,
    };
  });

  const alerts = computeAlerts(live, startToday, endToday);
  const counted = temperatures.filter((t) => t.countsToday);
  const countedCleaning = cleaning.filter((c) => c.countsToday);
  const total = counted.reduce((a, t) => a + t.required, 0) + countedCleaning.length;
  const done = counted.reduce((a, t) => a + t.done, 0) + countedCleaning.filter((c) => c.status === 'done').length;
  const correctedLater = counted.reduce((a, t) => a + t.correctedLater, 0) + countedCleaning.filter((c) => c.correctedLater).length;
  return {
    date: today,
    timezone: tz,
    temperatures,
    cleaning,
    summary: { total, done, pending: total - done, percent: total === 0 ? 100 : Math.round((done / total) * 100), correctedLater },
    alerts,
  };
}

function computeAlerts(live: DRecord[], startToday: number, endToday: number): TodayTasks['alerts'] {
  const desc = (a: DRecord, b: DRecord) => b.effectiveAt - a.effectiveAt;
  const todays = live.filter((r) => r.alert && r.type !== 'incidencia' && r.effectiveAt >= startToday && r.effectiveAt < endToday).sort(desc).slice(0, 50);
  const openIncidents = live.filter((r) => r.type === 'incidencia' && r.alert).sort(desc).slice(0, 50);
  const out: { kind: AlertKind; recordId: string; message: string; createdAt: string }[] = [];
  for (const r of todays) {
    const d = r.data;
    const at = iso(r.effectiveAt);
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
    }
  }
  for (const r of openIncidents) {
    const text = String(r.data.description);
    out.push({ kind: 'incidencia_abierta', recordId: r.id, createdAt: iso(r.effectiveAt), message: `Incidencia abierta: ${text.length > 80 ? `${text.slice(0, 80)}…` : text}` });
  }
  return out;
}

export function computeCompliance(db: DemoState, org: DOrg, from: string, to: string, now = Date.now()): Compliance {
  const tz = org.timezone;
  const today = localDate(new Date(now), tz);
  const last = to > today ? today : to;
  const days: Compliance['days'] = [];
  let totalExpected = 0;
  let totalDone = 0;
  let totalCorrectedLater = 0;
  if (from <= last) {
    const live = currentRecords(db, org.id);
    const dayOf = (ms: number) => localDate(new Date(ms), tz);
    const startFrom = dayStart(from, tz);
    const endLast = dayStart(addDays(last, 1), tz);
    const temp = new Map<string, { n: number; late: number }>();
    for (const r of live) {
      if (r.type !== 'temperatura' || r.effectiveAt < startFrom || r.effectiveAt >= endLast) continue;
      const k = `${dayOf(r.effectiveAt)}|${r.equipmentId}`;
      const v = temp.get(k) ?? { n: 0, late: 0 };
      v.n += 1;
      if (isLate(r, tz)) v.late += 1;
      temp.set(k, v);
    }
    const cleanFrom = startOfMonth(from) < startOfIsoWeek(from) ? startOfMonth(from) : startOfIsoWeek(from);
    const cleanStart = dayStart(cleanFrom, tz);
    const cleanByPlan = new Map<string, Map<string, boolean>>();
    for (const r of live) {
      if (r.type !== 'limpieza' || r.data.completed !== true || !r.cleaningPlanId || r.effectiveAt < cleanStart || r.effectiveAt >= endLast) continue;
      const m = cleanByPlan.get(r.cleaningPlanId) ?? new Map<string, boolean>();
      const day = dayOf(r.effectiveAt);
      m.set(day, (m.get(day) ?? true) && isLate(r, tz));
      cleanByPlan.set(r.cleaningPlanId, m);
    }
    const eqHist: [string, EquipmentState[]][] = db.equipment.filter((e) => e.orgId === org.id).map((e) => [e.id, e.history]);
    const plHist: [string, PlanState[]][] = db.plans.filter((p) => p.orgId === org.id).map((p) => [p.id, p.history]);
    for (const day of eachDay(from, last)) {
      const start = dayStart(day, tz);
      const isToday = day === today;
      const end = isToday ? now : dayStart(addDays(day, 1), tz);
      let expected = 0;
      let done = 0;
      let correctedLater = 0;
      for (const [equipmentId, hist] of eqHist) {
        const st = requiredState(hist, start, end, isToday);
        if (!st || st.checksPerDay <= 0) continue;
        expected += st.checksPerDay;
        const c = temp.get(`${day}|${equipmentId}`) ?? { n: 0, late: 0 };
        const d = Math.min(c.n, st.checksPerDay);
        done += d;
        correctedLater += d - Math.min(c.n - c.late, st.checksPerDay);
      }
      for (const [planId, hist] of plHist) {
        const st = requiredState(hist, start, end, isToday);
        if (!st || !isDue(st, day)) continue;
        expected += 1;
        const pStart = periodStart(st, day);
        const inPeriod = [...(cleanByPlan.get(planId) ?? new Map<string, boolean>()).entries()].filter(([d]) => d >= pStart && d <= day);
        if (inPeriod.length > 0) {
          done += 1;
          if (inPeriod.every(([, allLate]) => allLate)) correctedLater += 1;
        }
      }
      totalExpected += expected;
      totalDone += done;
      totalCorrectedLater += correctedLater;
      days.push({ date: day, expected, done, percent: expected === 0 ? null : Math.round((done / expected) * 100), correctedLater });
    }
  }
  return {
    from,
    to,
    days,
    overall: { expected: totalExpected, done: totalDone, percent: totalExpected === 0 ? null : Math.round((totalDone / totalExpected) * 100), correctedLater: totalCorrectedLater },
  };
}
