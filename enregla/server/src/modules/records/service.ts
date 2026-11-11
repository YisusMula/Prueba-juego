import type { z } from 'zod';
import * as S from '../../schemas/index.js';
import type { DB } from '../../db/index.js';
import { json } from '../../db/index.js';
import type { Organization, RecordRow } from '../../db/types.js';
import { AppError, conflict, notFound } from '../../lib/errors.js';
import { localDate } from '../../lib/dates.js';

export interface Actor {
  userId: string | null;
  userName: string | null;
  staffId: string | null;
  deviceId: string | null;
}

function validationError(path: string, message: string): AppError {
  return new AppError(400, 'VALIDATION_ERROR', message, [{ path, message }]);
}

function parseData<T extends z.ZodType>(schema: T, data: unknown): z.output<T> {
  const r = schema.safeParse(data ?? {});
  if (!r.success) {
    const details = r.error.issues.slice(0, 50).map((i) => ({ path: ['data', ...i.path.map(String)].join('.'), message: i.message }));
    throw new AppError(400, 'VALIDATION_ERROR', S.validationSummary(details), details);
  }
  return r.data;
}

export function isOutOfRange(value: number, min: number | null, max: number | null): boolean {
  return (min != null && value < min) || (max != null && value > max);
}

interface Prepared {
  data: Record<string, unknown>;
  alert: boolean;
  equipmentId: string | null;
  cleaningPlanId: string | null;
}

async function prepare(db: DB, orgId: string, type: S.RecordType, raw: unknown, today: string): Promise<Prepared> {
  switch (type) {
    case 'temperatura': {
      const d = parseData(S.temperaturaData, raw);
      const eq = await db.selectFrom('equipment').selectAll().where('id', '=', d.equipmentId).where('organization_id', '=', orgId).executeTakeFirst();
      if (!eq) throw notFound('Equipo');
      if (!eq.active) throw validationError('data.equipmentId', 'El equipo está desactivado');
      const outOfRange = isOutOfRange(d.value, eq.min_temp, eq.max_temp);
      if (outOfRange && !d.correctiveAction) {
        throw validationError('data.correctiveAction', 'La temperatura está fuera de rango: indica la acción correctora');
      }
      return {
        data: {
          equipmentId: eq.id,
          equipmentName: eq.name,
          value: d.value,
          minTemp: eq.min_temp,
          maxTemp: eq.max_temp,
          outOfRange,
          correctiveAction: d.correctiveAction,
        },
        alert: outOfRange,
        equipmentId: eq.id,
        cleaningPlanId: null,
      };
    }
    case 'limpieza': {
      const d = parseData(S.limpiezaData, raw);
      const plan = await db.selectFrom('cleaning_plans').selectAll().where('id', '=', d.cleaningPlanId).where('organization_id', '=', orgId).executeTakeFirst();
      if (!plan) throw notFound('Plan de limpieza');
      const done = new Map(d.items.map((i) => [i.itemId, i.done]));
      for (const id of done.keys()) {
        if (!plan.items.some((i) => i.id === id)) throw validationError('data.items', 'Hay ítems que no pertenecen al plan de limpieza');
      }
      const items = plan.items.map((i) => ({ itemId: i.id, area: i.area, done: done.get(i.id) ?? false }));
      if (!items.some((i) => i.done)) throw validationError('data.items', 'Marca al menos una zona hecha');
      return {
        data: {
          cleaningPlanId: plan.id,
          planName: plan.name,
          items,
          completed: items.every((i) => i.done),
          observations: d.observations,
        },
        alert: false,
        equipmentId: null,
        cleaningPlanId: plan.id,
      };
    }
    case 'recepcion': {
      const d = parseData(S.recepcionData, raw);
      let supplierName = d.supplierName;
      if (d.supplierId) {
        const s = await db.selectFrom('suppliers').select(['name']).where('id', '=', d.supplierId).where('organization_id', '=', orgId).executeTakeFirst();
        if (!s) throw notFound('Proveedor');
        supplierName = s.name;
      }
      const temperatureOutOfRange = S.receptionOverTemperature(d);
      // Caducidad anterior a hoy (fecha local del local).
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
        // Alerta: rechazo, o aceptación de mercancía caducada o por encima de la temperatura máxima.
        alert: !d.accepted || expired || temperatureOutOfRange,
        equipmentId: null,
        cleaningPlanId: null,
      };
    }
    case 'aceite': {
      const d = parseData(S.aceiteData, raw);
      const eq = await db.selectFrom('equipment').selectAll().where('id', '=', d.equipmentId).where('organization_id', '=', orgId).executeTakeFirst();
      if (!eq) throw notFound('Freidora');
      if (eq.type !== 'freidora') throw validationError('data.equipmentId', 'El equipo seleccionado no es una freidora');
      const overLimit = d.polarCompounds != null && d.polarCompounds > S.POLAR_COMPOUNDS_LIMIT;
      if (overLimit && !d.correctiveAction) {
        throw validationError('data.correctiveAction', `Los compuestos polares superan el ${S.POLAR_COMPOUNDS_LIMIT} %: indica la acción correctora`);
      }
      return {
        data: {
          equipmentId: eq.id,
          fryerName: eq.name,
          action: d.action,
          polarCompounds: d.polarCompounds ?? null,
          overLimit,
          correctiveAction: d.correctiveAction,
        },
        alert: overLimit,
        equipmentId: eq.id,
        cleaningPlanId: null,
      };
    }
    case 'plagas': {
      const d = parseData(S.plagasData, raw);
      return {
        data: { result: d.result, description: d.description, action: d.action },
        alert: d.result === 'con_indicios',
        equipmentId: null,
        cleaningPlanId: null,
      };
    }
    case 'incidencia': {
      const d = parseData(S.incidenciaData, raw);
      return {
        data: { description: d.description, correctiveAction: d.correctiveAction, closed: d.closed },
        alert: !d.closed,
        equipmentId: null,
        cleaningPlanId: null,
      };
    }
    case 'formacion': {
      const d = parseData(S.formacionData, raw);
      if (d.trainingDate > today) throw validationError('data.trainingDate', 'La fecha de la formación no puede ser futura');
      const st = await db.selectFrom('staff').select(['id', 'name']).where('id', '=', d.traineeStaffId).where('organization_id', '=', orgId).executeTakeFirst();
      if (!st) throw notFound('Miembro del personal');
      return {
        data: {
          traineeStaffId: st.id,
          traineeName: st.name,
          course: d.course,
          trainingDate: d.trainingDate,
          trainer: d.trainer,
          hours: d.hours ?? null,
        },
        alert: false,
        equipmentId: null,
        cleaningPlanId: null,
      };
    }
  }
}

export async function resolveStaff(db: DB, orgId: string, staffId: string) {
  const st = await db.selectFrom('staff').selectAll().where('id', '=', staffId).where('organization_id', '=', orgId).executeTakeFirst();
  if (!st) throw notFound('Miembro del personal');
  if (!st.active) throw validationError('staffId', 'Ese miembro del personal está desactivado');
  return st;
}

/** Crea un registro (o una enmienda). Los registros nunca se modifican ni se borran. */
export async function createRecord(
  db: DB,
  org: Organization,
  actor: Actor,
  requestedType: S.RecordType | null,
  rawData: unknown,
  amendment?: { originalId: string; reason: string },
  opts: { now?: Date } = {},
): Promise<RecordRow> {
  let original: RecordRow | undefined;
  let type: S.RecordType;
  if (!amendment) {
    if (!requestedType) throw validationError('type', 'Indica el tipo de registro');
    type = requestedType;
  } else {
    original = await db.selectFrom('records').selectAll().where('id', '=', amendment.originalId).where('organization_id', '=', org.id).executeTakeFirst();
    if (!original) throw notFound('Registro');
    type = original.type as S.RecordType;
    const already = await db.selectFrom('records').select('id').where('amends_record_id', '=', original.id).executeTakeFirst();
    if (already) throw conflict('Este registro ya tiene una enmienda: enmienda la versión más reciente');
  }
  const prepared = await prepare(db, org.id, type, rawData, localDate(opts.now ?? new Date(), org.timezone));
  let staffName: string | null = null;
  if (actor.staffId) staffName = (await resolveStaff(db, org.id, actor.staffId)).name;
  if (!actor.staffId && !actor.userId) throw validationError('staffId', 'Indica quién realiza el registro');
  try {
    return await db
      .insertInto('records')
      .values({
        organization_id: org.id,
        type,
        data: json(prepared.data),
        staff_id: actor.staffId,
        staff_name: staffName,
        user_id: actor.userId,
        user_name: actor.userName,
        device_id: actor.deviceId,
        equipment_id: prepared.equipmentId,
        cleaning_plan_id: prepared.cleaningPlanId,
        amends_record_id: original?.id ?? null,
        amendment_reason: amendment?.reason ?? null,
        alert: prepared.alert,
        // Hora del servidor de aplicación (reloj inyectable en tests). effective_at la fija un trigger.
        ...(opts.now ? { created_at: opts.now } : {}),
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  } catch (err) {
    if ((err as { code?: string }).code === '23505') throw conflict('Este registro ya tiene una enmienda: enmienda la versión más reciente');
    throw err;
  }
}
