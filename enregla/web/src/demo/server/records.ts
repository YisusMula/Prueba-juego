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

export type Actor = { userId: string | null; userName: string | null; staffId: string | null; deviceId: string | null };

const isOutOfRange = (value: number, min: number | null, max: number | null) => (min != null && value < min) || (max != null && value > max);

type Prepared = { data: Record<string, unknown>; alert: boolean; equipmentId: string | null; cleaningPlanId: string | null };

function prepare(db: DemoState, orgId: string, type: RecordType, raw: unknown, today: string): Prepared {
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
      if (d.supplierId) {
        const s = db.suppliers.find((x) => x.id === d.supplierId && x.orgId === orgId);
        if (!s) throw notFound('Proveedor');
        supplierName = s.name;
      }
      const temperatureOutOfRange = S.receptionOverTemperature(d);
      const expired = d.expiryDate != null && d.expiryDate < today;
      if (d.accepted && (expired || temperatureOutOfRange) && !d.correctiveAction) {
        throw validationError(
          'data.correctiveAction',
          expired
            ? 'La fecha de caducidad ya ha pasado: recházala o indica por qué la aceptas'
            : 'La temperatura supera la máxima admisible: indica qué has hecho o por qué la aceptas',
        );
      }
      return {
        data: {
          supplierId: d.supplierId ?? null,
          supplierName,
          product: d.product,
          lot: d.lot,
          temperature: d.temperature ?? null,
          maxTemperature: d.maxTemperature ?? null,
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
  const prepared = prepare(db, org.id, type, rawData, localDate(new Date(now), org.timezone));
  let staffName: string | null = null;
  if (actor.staffId) staffName = resolveStaff(db, org.id, actor.staffId).name;
  if (!actor.staffId && !actor.userId) throw validationError('staffId', 'Indica quién realiza el registro');
  const record: DRecord = {
    id: uuid(),
    orgId: org.id,
    type,
    data: prepared.data,
    staffId: actor.staffId,
    staffName,
    userId: actor.userId,
    userName: actor.userName,
    deviceId: actor.deviceId,
    equipmentId: prepared.equipmentId,
    cleaningPlanId: prepared.cleaningPlanId,
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
