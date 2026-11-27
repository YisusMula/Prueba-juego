/**
 * Alta de registros y enmiendas: misma validación y enriquecimiento que
 * `server/src/modules/records/service.ts` (esquemas zod compartidos, rangos, acción correctora,
 * limpieza parcial, recepción con incidencia, formación no futura…).
 */
import * as S from '@shared/schemas';
import type { RecordType } from '@/api/types';
import type { DemoState, DOrg, DRecord } from './state';
import { conflict, notFound, parse, validationError } from './errors';
import { uuid } from './ids';
import { localDate } from './time';

/** `staffId: undefined` en una corrección conserva el firmante del original (como el servidor). */
export type Actor = { userId: string | null; userName: string | null; staffId: string | null | undefined; deviceId: string | null };

const isOutOfRange = (value: number, min: number | null, max: number | null) => (min != null && value < min) || (max != null && value > max);

type Prepared = { data: Record<string, unknown>; alert: boolean; equipmentId: string | null; cleaningPlanId: string | null; customTemplateId?: string | null; relatedRecordId?: string | null };

/** Como el servidor (A3): nombre de proveedor comparable sin tildes, mayúsculas, espacios dobles ni puntuación final. */
export function supplierKey(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[\s\u00A0\u2000-\u200B\u202F\u205F\u3000\uFEFF]+/g, ' ')
    .trim()
    .replace(/^[\s.,;:!¡?¿'"«»()\-–—]+|[\s.,;:!¡?¿'"«»()\-–—]+$/g, '');
}

/** Raíz de una cadena de correcciones y su versión vigente. */
function chainRoot(db: DemoState, orgId: string, id: string): DRecord | undefined {
  let r = db.records.find((x) => x.id === id && x.orgId === orgId);
  while (r?.amendsRecordId) r = db.records.find((x) => x.id === r!.amendsRecordId);
  return r;
}
export function latestVersion(db: DemoState, rootId: string): DRecord | undefined {
  let r = db.records.find((x) => x.id === rootId);
  for (let next = r ? db.records.find((x) => x.amendsRecordId === r!.id) : undefined; next; next = db.records.find((x) => x.amendsRecordId === r!.id)) r = next;
  return r;
}

function prepare(db: DemoState, org: DOrg, type: RecordType, raw: unknown, today: string, now: number, previous?: DRecord): Prepared {
  const orgId = org.id;
  switch (type) {
    case 'temperatura': {
      const d = parse(S.temperaturaData, raw, ['data']);
      const eq = db.equipment.find((e) => e.id === d.equipmentId && e.orgId === orgId);
      if (!eq) throw notFound('Equipo');
      if (!eq.active) throw validationError('data.equipmentId', 'El equipo está desactivado');
      const outOfRange = isOutOfRange(d.value, eq.minTemp, eq.maxTemp);
      if (outOfRange && !d.correctiveAction) throw validationError('data.correctiveAction', 'La temperatura está fuera de rango: indica la acción correctora');
      return {
        data: { equipmentId: eq.id, equipmentName: eq.name, value: d.value, minTemp: eq.minTemp, maxTemp: eq.maxTemp, outOfRange, correctiveAction: d.correctiveAction },
        alert: outOfRange,
        equipmentId: eq.id,
        cleaningPlanId: null,
      };
    }
    case 'limpieza': {
      const d = parse(S.limpiezaData, raw, ['data']);
      const plan = db.plans.find((p) => p.id === d.cleaningPlanId && p.orgId === orgId);
      if (!plan) throw notFound('Plan de limpieza');
      const done = new Map(d.items.map((i) => [i.itemId, i.done]));
      for (const id of done.keys()) {
        if (!plan.items.some((i) => i.id === id)) throw validationError('data.items', 'Hay ítems que no pertenecen al plan de limpieza');
      }
      const items = plan.items.map((i) => ({ itemId: i.id, area: i.area, done: done.get(i.id) ?? false }));
      if (!items.some((i) => i.done)) throw validationError('data.items', 'Marca al menos una zona hecha');
      return {
        data: { cleaningPlanId: plan.id, planName: plan.name, items, completed: items.every((i) => i.done), observations: d.observations },
        alert: false,
        equipmentId: null,
        cleaningPlanId: plan.id,
      };
    }
    case 'recepcion': {
      const d = parse(S.recepcionData, raw, ['data']);
      let supplierName = d.supplierName;
      let supplierId = d.supplierId ?? null;
      let supplier: { defaultCategory: S.ReceptionCategory | null; receptionLimit: number | null } | null = null;
      if (supplierId) {
        const s = db.suppliers.find((x) => x.id === supplierId && x.orgId === orgId);
        if (!s) throw notFound('Proveedor');
        supplierName = s.name;
        supplier = { defaultCategory: s.defaultCategory ?? null, receptionLimit: s.receptionLimit ?? null };
      } else if (supplierName) {
        // Como el servidor (R6): un nombre escrito a mano que coincide con un proveedor ES ese proveedor.
        const wanted = supplierKey(supplierName);
        const s = wanted ? db.suppliers.find((x) => x.orgId === orgId && supplierKey(x.name) === wanted) : undefined;
        if (s) {
          supplierId = s.id;
          supplierName = s.name;
          supplier = { defaultCategory: s.defaultCategory ?? null, receptionLimit: s.receptionLimit ?? null };
        }
      }
      // Como el servidor: límite de la categoría o el propio del proveedor; nunca el de la petición.
      const limits = S.receptionLimits(d, supplier);
      const temperatureOutOfRange = S.receptionOutOfLimits(d, limits);
      const expired = d.expiryDate != null && d.expiryDate < today;
      const needsReason = expired || temperatureOutOfRange;
      // Como el servidor (N9): «ambiente» para un proveedor habitualmente refrigerado/congelado/caliente.
      const categoryDiffersFromSupplier = d.category === 'ambiente' && supplier?.defaultCategory != null && supplier.defaultCategory !== 'ambiente';
      const prevCategory = (previous?.data.category as S.ReceptionCategory | null | undefined) ?? null;
      const categoryChangedToAmbient = d.category === 'ambiente' && prevCategory != null && prevCategory !== 'ambiente';
      if (categoryDiffersFromSupplier && !d.categoryReason) {
        throw validationError(
          'data.categoryReason',
          `Este proveedor suele traer producto ${S.RECEPTION_CATEGORY_LABELS[supplier!.defaultCategory!].toLowerCase()}: explica por qué lo registras como ambiente`,
        );
      }
      if (categoryChangedToAmbient && !d.categoryReason) {
        throw validationError('data.categoryReason', `El registro original era producto ${S.RECEPTION_CATEGORY_LABELS[prevCategory].toLowerCase()}: explica por qué lo cambias a ambiente`);
      }
      if (d.accepted && needsReason && !d.correctiveAction) {
        throw validationError('data.correctiveAction', expired ? 'La fecha de caducidad ya ha pasado: recházala o indica por qué la aceptas' : S.receptionLimitMessage(limits));
      }
      return {
        data: {
          supplierId,
          supplierName,
          product: d.product,
          lot: d.lot,
          temperature: d.temperature ?? null,
          category: limits.category,
          categoryAssumed: limits.assumed,
          limitSource: limits.source,
          limitDiffersFromReference: limits.differsFromReference,
          categoryDiffersFromSupplier,
          categoryChangedFrom: categoryChangedToAmbient ? prevCategory : null,
          categoryReason: categoryDiffersFromSupplier || categoryChangedToAmbient ? d.categoryReason : null,
          maxTemperature: limits.max,
          minTemperature: limits.min,
          temperatureOutOfRange,
          expiryDate: d.expiryDate ?? null,
          expired,
          accepted: d.accepted,
          rejectionReason: d.accepted ? null : d.rejectionReason,
          correctiveAction: d.accepted ? d.correctiveAction : null,
        },
        alert: !d.accepted || expired || temperatureOutOfRange,
        equipmentId: null,
        cleaningPlanId: null,
      };
    }
    case 'aceite': {
      const d = parse(S.aceiteData, raw, ['data']);
      const eq = db.equipment.find((e) => e.id === d.equipmentId && e.orgId === orgId);
      if (!eq) throw notFound('Freidora');
      if (eq.type !== 'freidora') throw validationError('data.equipmentId', 'El equipo seleccionado no es una freidora');
      const overLimit = d.polarCompounds != null && d.polarCompounds > S.POLAR_COMPOUNDS_LIMIT;
      if (overLimit && !d.correctiveAction) {
        throw validationError('data.correctiveAction', `Los compuestos polares superan el ${S.POLAR_COMPOUNDS_LIMIT} %: indica la acción correctora`);
      }
      return {
        data: { equipmentId: eq.id, fryerName: eq.name, action: d.action, polarCompounds: d.polarCompounds ?? null, overLimit, correctiveAction: d.correctiveAction },
        alert: overLimit,
        equipmentId: eq.id,
        cleaningPlanId: null,
      };
    }
    case 'plagas': {
      const d = parse(S.plagasData, raw, ['data']);
      return { data: { result: d.result, description: d.description, action: d.action }, alert: d.result === 'con_indicios', equipmentId: null, cleaningPlanId: null };
    }
    case 'incidencia': {
      const d = parse(S.incidenciaData, raw, ['data']);
      return { data: { description: d.description, correctiveAction: d.correctiveAction, closed: d.closed }, alert: !d.closed, equipmentId: null, cleaningPlanId: null };
    }
    case 'formacion': {
      const d = parse(S.formacionData, raw, ['data']);
      if (d.trainingDate > today) throw validationError('data.trainingDate', 'La fecha de la formación no puede ser futura');
      const st = db.staff.find((s) => s.id === d.traineeStaffId && s.orgId === orgId);
      if (!st) throw notFound('Miembro del personal');
      return {
        data: { traineeStaffId: st.id, traineeName: st.name, course: d.course, trainingDate: d.trainingDate, trainer: d.trainer, hours: d.hours ?? null },
        alert: false,
        equipmentId: null,
        cleaningPlanId: null,
      };
    }
    case 'cocinado': {
      const d = parse(S.cocinadoData, raw, ['data']);
      const refs = S.effectiveReferenceValues(org.referenceValues);
      const referenceTemp = d.process === 'cocinado' ? refs.cookingMinTemp : refs.reheatMinTemp;
      const outOfRange = d.coreTemp < referenceTemp;
      if (outOfRange && !d.correctiveAction) throw validationError('data.correctiveAction', `No llega a la temperatura de referencia (${S.esNumber(referenceTemp)} °C en el centro): indica la acción correctora`);
      return {
        data: { product: d.product, process: d.process, coreTemp: d.coreTemp, minutes: d.minutes ?? null, referenceTemp, outOfRange, correctiveAction: d.correctiveAction },
        alert: outOfRange,
        equipmentId: null,
        cleaningPlanId: null,
      };
    }
    case 'enfriamiento': {
      const d = parse(S.enfriamientoData, raw, ['data']);
      const prevPhase = previous?.data.phase;
      if (previous && prevPhase !== d.phase) throw validationError('data.phase', d.phase === 'fin' ? 'Este registro es el inicio de un enfriamiento: corrige el inicio, no lo cierres aquí' : 'Este registro es el cierre de un enfriamiento: corrige el cierre');
      if (d.phase === 'inicio') return { data: { phase: 'inicio', product: d.product, startTemp: d.startTemp, notes: d.notes }, alert: false, equipmentId: null, cleaningPlanId: null };
      const root = chainRoot(db, orgId, d.startRecordId);
      if (!root || root.type !== 'enfriamiento' || root.data.phase !== 'inicio') throw notFound('Enfriamiento');
      if (previous && previous.relatedRecordId !== root.id) throw validationError('data.startRecordId', 'Una corrección del cierre no puede cambiar de enfriamiento');
      if (!previous && db.records.some((r) => r.relatedRecordId === root.id && !r.amendsRecordId)) throw conflict('Este enfriamiento ya está cerrado');
      const start = latestVersion(db, root.id) ?? root;
      const prev = previous?.data as { minutes?: number; endedAt?: string; targetTemp?: number; maxMinutes?: number } | undefined;
      const refs = S.effectiveReferenceValues(org.referenceValues);
      const endedAt = prev?.endedAt ? Date.parse(prev.endedAt) : now;
      const minutes = prev?.minutes ?? Math.max(0, Math.round((endedAt - root.effectiveAt) / 60_000));
      const targetTemp = prev?.targetTemp ?? refs.coolingTargetTemp;
      const maxMinutes = prev?.maxMinutes ?? refs.coolingMaxMinutes;
      const discarded = d.discarded === true;
      if (!discarded && d.endTemp == null) throw validationError('data.endTemp', 'Escribe la temperatura al terminar el enfriamiento');
      const overTemp = !discarded && d.endTemp != null && d.endTemp > targetTemp;
      const overTime = minutes > maxMinutes;
      const outOfRange = discarded || overTemp || overTime;
      if (outOfRange && !d.correctiveAction) {
        throw validationError(
          'data.correctiveAction',
          discarded ? 'Indica qué se ha hecho con el producto (por ejemplo, «Desechado»)' : `No cumple el criterio de referencia (${S.esNumber(targetTemp)} °C o menos en ${maxMinutes} minutos o menos): indica la acción correctora`,
        );
      }
      return {
        data: {
          phase: 'fin',
          startRecordId: root.id,
          product: start.data.product ?? null,
          startTemp: start.data.startTemp ?? null,
          startedAt: new Date(root.effectiveAt).toISOString(),
          endedAt: new Date(endedAt).toISOString(),
          endTemp: d.endTemp ?? null,
          minutes,
          targetTemp,
          maxMinutes,
          overTemp,
          overTime,
          discarded,
          outOfRange,
          correctiveAction: d.correctiveAction,
        },
        alert: outOfRange,
        equipmentId: null,
        cleaningPlanId: null,
        relatedRecordId: root.id,
      };
    }
    case 'personalizado': {
      const d = parse(S.personalizadoData, raw, ['data']);
      const tpl = db.templates.find((t) => t.id === d.templateId && t.orgId === orgId);
      if (!tpl) throw notFound('Registro personalizado');
      if (!tpl.active && !previous) throw validationError('data.templateId', 'Este registro personalizado está desactivado');
      if (previous && previous.data.templateId !== tpl.id) throw validationError('data.templateId', 'Una corrección no puede cambiar de registro personalizado');
      const base = { templateId: tpl.id, templateName: tpl.name, kind: tpl.kind, notes: d.notes };
      let alert: boolean;
      let data: Record<string, unknown>;
      if (tpl.kind === 'checklist') {
        const answers = new Map((d.items ?? []).map((i) => [i.itemId, i.ok]));
        for (const id of answers.keys()) if (!tpl.items.some((i) => i.id === id)) throw validationError('data.items', 'Hay puntos que no pertenecen a este registro');
        const missing = tpl.items.filter((i) => !answers.has(i.id));
        if (missing.length > 0) throw validationError('data.items', `Marca todos los puntos (falta: ${missing[0]!.label})`);
        const items = tpl.items.map((i) => ({ itemId: i.id, label: i.label, ok: answers.get(i.id) === true }));
        const failed = items.filter((i) => !i.ok).length;
        alert = failed > 0;
        data = { ...base, items, failed };
      } else if (tpl.kind === 'numeric') {
        if (d.reading == null) throw validationError('data.reading', 'Escribe el valor');
        const outOfRange = isOutOfRange(d.reading, tpl.min, tpl.max);
        alert = outOfRange;
        data = { ...base, reading: d.reading, unit: tpl.unit, min: tpl.min, max: tpl.max, outOfRange };
      } else {
        if (d.answer == null) throw validationError('data.answer', 'Responde sí o no');
        alert = d.answer === false;
        data = { ...base, answer: d.answer };
      }
      if (alert && !d.correctiveAction) {
        throw validationError(
          'data.correctiveAction',
          tpl.kind === 'checklist' ? 'Hay puntos que no se cumplen: indica la acción correctora' : tpl.kind === 'numeric' ? 'El valor está fuera del rango: indica la acción correctora' : 'La respuesta es «No»: indica la acción correctora',
        );
      }
      return { data: { ...data, correctiveAction: d.correctiveAction }, alert, equipmentId: null, cleaningPlanId: null, customTemplateId: tpl.id };
    }
  }
}

export function resolveStaff(db: DemoState, orgId: string, staffId: string) {
  const st = db.staff.find((s) => s.id === staffId && s.orgId === orgId);
  if (!st) throw notFound('Miembro del personal');
  if (!st.active) throw validationError('staffId', 'Ese miembro del personal está desactivado');
  return st;
}

/** Crea un registro (o una enmienda). Los registros nunca se modifican ni se borran. */
export function createRecord(
  db: DemoState,
  org: DOrg,
  actor: Actor,
  requestedType: RecordType | null,
  rawData: unknown,
  amendment?: { originalId: string; reason: string },
  now = Date.now(),
): DRecord {
  let original: DRecord | undefined;
  let type: RecordType;
  if (!amendment) {
    if (!requestedType) throw validationError('type', 'Indica el tipo de registro');
    type = requestedType;
  } else {
    original = db.records.find((r) => r.id === amendment.originalId && r.orgId === org.id);
    if (!original) throw notFound('Registro');
    type = original.type;
    if (db.records.some((r) => r.amendsRecordId === original!.id)) throw conflict('Este registro ya tiene una enmienda: enmienda la versión más reciente');
  }
  const prepared = prepare(db, org, type, rawData, localDate(new Date(now), org.timezone), now, original);
  const staffId = actor.staffId === undefined ? (original?.staffId ?? null) : actor.staffId;
  let staffName: string | null = null;
  if (staffId && original && staffId === original.staffId) staffName = original.staffName;
  else if (staffId) staffName = resolveStaff(db, org.id, staffId).name;
  if (!staffId && !actor.userId) throw validationError('staffId', 'Indica quién realiza el registro');
  const record: DRecord = {
    id: uuid(),
    orgId: org.id,
    type,
    data: prepared.data,
    staffId,
    staffName,
    userId: actor.userId,
    userName: actor.userName,
    deviceId: actor.deviceId,
    equipmentId: prepared.equipmentId,
    cleaningPlanId: prepared.cleaningPlanId,
    customTemplateId: prepared.customTemplateId ?? null,
    relatedRecordId: prepared.relatedRecordId ?? null,
    amendsRecordId: original?.id ?? null,
    amendmentReason: amendment?.reason ?? null,
    alert: prepared.alert,
    createdAt: now,
    // Fecha del hecho: la del registro raíz de la cadena (lo hace un trigger en el servidor).
    effectiveAt: original ? original.effectiveAt : now,
  };
  db.records.push(record);
  return record;
}
