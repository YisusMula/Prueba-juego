/**
 * Tareas de hoy, alertas y cumplimiento: la misma lógica que `server/src/modules/tasks/service.ts`,
 * sobre las tablas en memoria de la demo.
 */
import { effectiveReferenceValues, esNumber, REMEASURE_ACTION, REMEASURE_MINUTES } from '@shared/schemas';
import type { AlertKind, Compliance, CustomFrequency, MissingTask, OpenCooling, TodayTasks } from '@/api/types';
import type { DemoState, DOrg, DRecord, EquipmentState, PlanState, TemplateState } from './state';
import { latestVersion } from './records';
import { addDays, dayOfMonth, dayStart, eachDay, iso, isoWeekday, localDate, startOfIsoWeek, startOfMonth } from './time';

export function isDue(plan: { frequency: CustomFrequency; weekday: number | null; monthDay: number | null }, date: string): boolean {
  if (plan.frequency === 'on_demand') return false;
  if (plan.frequency === 'daily') return true;
  if (plan.frequency === 'weekly') return plan.weekday === isoWeekday(date);
  return plan.monthDay === dayOfMonth(date);
}

export function periodStart(plan: { frequency: CustomFrequency }, date: string): string {
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
    // A igual fecha del hecho, por orden de inserción (en el servidor, `seq`).
    .sort((a, b) => a.effectiveAt - b.effectiveAt || db.records.indexOf(a) - db.records.indexOf(b));
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
      withAlert: mine.some((r) => r.alert),
      remeasure: last?.alert === true,
      remeasureFrom:
        last?.alert === true && String(last.data.correctiveAction ?? '').includes(REMEASURE_ACTION)
          ? iso(last.effectiveAt + REMEASURE_MINUTES * 60_000)
          : null,
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

  const templates = db.templates.filter((t) => t.orgId === org.id && t.active && isDue(t, today)).sort((a, b) => a.createdAt - b.createdAt);
  const custom = templates.map((t) => {
    const from = dayStart(periodStart(t, today), tz);
    const recs = live.filter((r) => r.type === 'personalizado' && r.customTemplateId === t.id && r.effectiveAt >= from && r.effectiveAt < endToday).sort((a, b) => b.effectiveAt - a.effectiveAt);
    const required = t.frequency === 'daily' ? t.timesPerDay : 1;
    const doneN = Math.min(recs.length, required);
    return {
      templateId: t.id,
      name: t.name,
      kind: t.kind,
      frequency: t.frequency,
      required,
      done: doneN,
      status: doneN >= required ? ('done' as const) : ('pending' as const),
      countsToday: stateAt(t.history, startToday)?.active === true,
      withAlert: recs.some((r) => r.alert),
      lastAt: recs[0] ? iso(recs[0].effectiveAt) : null,
    };
  });
  const coolings = openCoolings(db, org, now);
  const thisMonday = startOfIsoWeek(today);
  const lastWeek = { from: addDays(thisMonday, -7), to: addDays(thisMonday, -1) };
  const review = {
    ...lastWeek,
    due: localDate(new Date(org.createdAt), tz) <= lastWeek.to,
    verified: db.verifications.some((v) => v.orgId === org.id && v.from <= lastWeek.from && v.to >= lastWeek.to),
  };

  const alerts = computeAlerts(live, startToday, endToday);
  for (const c of coolings.filter((x) => x.overdue)) {
    alerts.unshift({ kind: 'enfriamiento_sin_cerrar', recordId: c.recordId, createdAt: c.startedAt, message: `Enfriamiento de ${c.product} sin cerrar: han pasado más de ${c.maxMinutes} min` });
  }
  const counted = temperatures.filter((t) => t.countsToday);
  const countedCleaning = cleaning.filter((c) => c.countsToday);
  const countedCustom = custom.filter((c) => c.countsToday);
  const total = counted.reduce((a, t) => a + t.required, 0) + countedCleaning.length + countedCustom.reduce((a, c) => a + c.required, 0);
  const done = counted.reduce((a, t) => a + t.done, 0) + countedCleaning.filter((c) => c.status === 'done').length + countedCustom.reduce((a, c) => a + c.done, 0);
  const correctedLater = counted.reduce((a, t) => a + t.correctedLater, 0) + countedCleaning.filter((c) => c.correctedLater).length;
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

/** Enfriamientos empezados y sin cerrar (como el servidor). */
export function openCoolings(db: DemoState, org: DOrg, now = Date.now()): OpenCooling[] {
  const refs = effectiveReferenceValues(org.referenceValues);
  return db.records
    .filter((r) => r.orgId === org.id && r.type === 'enfriamiento' && !r.amendsRecordId && r.data.phase === 'inicio' && !db.records.some((c) => c.relatedRecordId === r.id))
    .sort((a, b) => a.effectiveAt - b.effectiveAt)
    .slice(0, 50)
    .map((root) => {
      const d = (latestVersion(db, root.id) ?? root).data as { product?: string; startTemp?: number };
      const deadline = root.effectiveAt + refs.coolingMaxMinutes * 60_000;
      return {
        recordId: root.id,
        product: d.product ?? '',
        startTemp: typeof d.startTemp === 'number' ? d.startTemp : null,
        startedAt: iso(root.effectiveAt),
        deadline: iso(deadline),
        minutesElapsed: Math.max(0, Math.floor((now - root.effectiveAt) / 60_000)),
        overdue: now > deadline,
        targetTemp: refs.coolingTargetTemp,
        maxMinutes: refs.coolingMaxMinutes,
      };
    });
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
    } else if (r.type === 'cocinado') {
      out.push({ kind: 'cocinado_por_debajo', recordId: r.id, createdAt: at, message: `${String(d.product)}: ${esNumber(Number(d.coreTemp))} °C en el centro (referencia ${esNumber(Number(d.referenceTemp))} °C)` });
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
    const partialByPlan = new Map<string, Set<string>>();
    for (const r of live) {
      if (r.type !== 'limpieza' || !r.cleaningPlanId || r.effectiveAt < cleanStart || r.effectiveAt >= endLast) continue;
      const day = dayOf(r.effectiveAt);
      if (r.data.completed !== true) {
        const set = partialByPlan.get(r.cleaningPlanId) ?? new Set<string>();
        set.add(day);
        partialByPlan.set(r.cleaningPlanId, set);
        continue;
      }
      const m = cleanByPlan.get(r.cleaningPlanId) ?? new Map<string, boolean>();
      m.set(day, (m.get(day) ?? true) && isLate(r, tz));
      cleanByPlan.set(r.cleaningPlanId, m);
    }
    const customByTpl = new Map<string, Map<string, { n: number; late: number }>>();
    for (const r of live) {
      if (r.type !== 'personalizado' || !r.customTemplateId || r.effectiveAt < cleanStart || r.effectiveAt >= endLast) continue;
      const m = customByTpl.get(r.customTemplateId) ?? new Map<string, { n: number; late: number }>();
      const day = dayOf(r.effectiveAt);
      const v = m.get(day) ?? { n: 0, late: 0 };
      v.n += 1;
      if (isLate(r, tz)) v.late += 1;
      m.set(day, v);
      customByTpl.set(r.customTemplateId, m);
    }
    const nameOf = new Map<string, string>([
      ...db.equipment.filter((e) => e.orgId === org.id).map((e) => [e.id, e.name] as [string, string]),
      ...db.plans.filter((p) => p.orgId === org.id).map((p) => [p.id, p.name] as [string, string]),
      ...db.templates.filter((t) => t.orgId === org.id).map((t) => [t.id, t.name] as [string, string]),
    ]);
    const tpHist: [string, TemplateState[]][] = db.templates.filter((t) => t.orgId === org.id).map((t) => [t.id, t.history]);
    const eqHist: [string, EquipmentState[]][] = db.equipment.filter((e) => e.orgId === org.id).map((e) => [e.id, e.history]);
    const plHist: [string, PlanState[]][] = db.plans.filter((p) => p.orgId === org.id).map((p) => [p.id, p.history]);
    for (const day of eachDay(from, last)) {
      const start = dayStart(day, tz);
      const isToday = day === today;
      const end = isToday ? now : dayStart(addDays(day, 1), tz);
      let expected = 0;
      let done = 0;
      let correctedLater = 0;
      const missing: MissingTask[] = [];
      for (const [equipmentId, hist] of eqHist) {
        const st = requiredState(hist, start, end, isToday);
        if (!st || st.checksPerDay <= 0) continue;
        expected += st.checksPerDay;
        const c = temp.get(`${day}|${equipmentId}`) ?? { n: 0, late: 0 };
        const d = Math.min(c.n, st.checksPerDay);
        done += d;
        correctedLater += d - Math.min(c.n - c.late, st.checksPerDay);
        if (d < st.checksPerDay) missing.push({ kind: 'temperatura', id: equipmentId, name: nameOf.get(equipmentId) ?? '—', expected: st.checksPerDay, done: d, frequency: 'daily' });
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
        } else {
          const partial = [...(partialByPlan.get(planId) ?? new Set<string>())].some((d) => d >= pStart && d <= day);
          missing.push({ kind: 'limpieza', id: planId, name: nameOf.get(planId) ?? '—', expected: 1, done: 0, partial, frequency: st.frequency });
        }
      }
      for (const [tplId, hist] of tpHist) {
        const st = requiredState(hist, start, end, isToday);
        if (!st || !isDue(st, day)) continue;
        const m = customByTpl.get(tplId) ?? new Map<string, { n: number; late: number }>();
        if (st.frequency === 'daily') {
          const req = st.timesPerDay;
          expected += req;
          const c = m.get(day) ?? { n: 0, late: 0 };
          const d = Math.min(c.n, req);
          done += d;
          correctedLater += d - Math.min(c.n - c.late, req);
          if (d < req) missing.push({ kind: 'personalizado', id: tplId, name: nameOf.get(tplId) ?? '—', expected: req, done: d, frequency: st.frequency });
        } else {
          expected += 1;
          const pStart = periodStart(st, day);
          const inPeriod = [...m.entries()].filter(([d]) => d >= pStart && d <= day);
          if (inPeriod.length > 0) {
            done += 1;
            if (inPeriod.every(([, v]) => v.late >= v.n)) correctedLater += 1;
          } else missing.push({ kind: 'personalizado', id: tplId, name: nameOf.get(tplId) ?? '—', expected: 1, done: 0, frequency: st.frequency });
        }
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
      daysWithGaps: days.filter((d) => (d.missing?.length ?? 0) > 0).length,
    },
  };
}
