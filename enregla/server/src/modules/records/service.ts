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
  /**
   * Empleado que figura como autor del hecho. En una corrección, `undefined` conserva el del
   * registro original (corregir un dato no cambia quién lo hizo); `null` lo quita.
   */
  staffId: string | null | undefined;
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
  customTemplateId?: string | null;
  relatedRecordId?: string | null;
}

/**
 * Forma comparable de un nombre de proveedor escrito a mano (A3): sin tildes ni mayúsculas, espacios
 * (también duros) colapsados y sin puntuación al principio ni al final.
 */
export function supplierKey(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[\s\u00A0\u2000-\u200B\u202F\u205F\u3000\uFEFF]+/g, ' ')
    .trim()
    .replace(/^[\s.,;:!¡?¿'"«»()\-–—]+|[\s.,;:!¡?¿'"«»()\-–—]+$/g, '');
}

interface PrepareCtx {
  org: Organization;
  today: string;
  now: Date;
  previous?: RecordRow;
}

/** Raíz de la cadena de correcciones de un registro (el original). */
async function chainRoot(db: DB, orgId: string, id: string): Promise<RecordRow | undefined> {
  let rec = await db.selectFrom('records').selectAll().where('id', '=', id).where('organization_id', '=', orgId).executeTakeFirst();
  for (let i = 0; rec?.amends_record_id && i < 100; i++) {
    rec = await db.selectFrom('records').selectAll().where('id', '=', rec.amends_record_id).where('organization_id', '=', orgId).executeTakeFirst();
  }
  return rec;
}

/** Versión vigente (la última corrección) de la cadena que empieza en `rootId`. */
export async function latestVersion(db: DB, orgId: string, rootId: string): Promise<RecordRow | undefined> {
  let rec = await db.selectFrom('records').selectAll().where('id', '=', rootId).where('organization_id', '=', orgId).executeTakeFirst();
  for (let i = 0; rec && i < 100; i++) {
    const next = await db.selectFrom('records').selectAll().where('amends_record_id', '=', rec.id).executeTakeFirst();
    if (!next) break;
    rec = next;
  }
  return rec;
}

async function prepare(db: DB, type: S.RecordType, raw: unknown, pc: PrepareCtx): Promise<Prepared> {
  const orgId = pc.org.id;
  const today = pc.today;
  const previous = pc.previous;
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
      let supplierId = d.supplierId ?? null;
      let supplier: { defaultCategory: S.ReceptionCategory | null; receptionLimit: number | null } | null = null;
      if (supplierId) {
        const s = await db.selectFrom('suppliers').select(['name', 'default_category', 'reception_limit']).where('id', '=', supplierId).where('organization_id', '=', orgId).executeTakeFirst();
        if (!s) throw notFound('Proveedor');
        supplierName = s.name;
        supplier = { defaultCategory: s.default_category as S.ReceptionCategory | null, receptionLimit: s.reception_limit };
      } else if (supplierName) {
        // R6: un proveedor escrito a mano con el nombre de uno dado de alta ES ese proveedor (sus límites
        // y su categoría habitual cuentan igual). A3: aunque cambien tildes, mayúsculas, espacios
        // (también duros) o la puntuación final.
        const wanted = supplierKey(supplierName);
        const list = await db
          .selectFrom('suppliers')
          .select(['id', 'name', 'default_category', 'reception_limit'])
          .where('organization_id', '=', orgId)
          .orderBy('created_at')
          .limit(5000)
          .execute();
        const s = wanted ? list.find((x) => supplierKey(x.name) === wanted) : undefined;
        if (s) {
          supplierId = s.id;
          supplierName = s.name;
          supplier = { defaultCategory: s.default_category as S.ReceptionCategory | null, receptionLimit: s.reception_limit };
        }
      }
      // Límite de la categoría (o el propio del proveedor); no se edita al recibir. Sin categoría en
      // una petición antigua con temperatura se aplica refrigerado (≤ 4 °C) (S.receptionLimits).
      const limits = S.receptionLimits(d, supplier);
      const temperatureOutOfRange = S.receptionOutOfLimits(d, limits);
      // Caducidad anterior a hoy (fecha local del local).
      const expired = d.expiryDate != null && d.expiryDate < today;
      // Fuera de límite o caducada: alerta y motivo obligatorio.
      const needsReason = expired || temperatureOutOfRange;
      // N9: «ambiente» para un proveedor habitualmente refrigerado/congelado/caliente exige motivo.
      const categoryDiffersFromSupplier =
        d.category === 'ambiente' && supplier?.defaultCategory != null && supplier.defaultCategory !== 'ambiente';
      // R6: una corrección que pasa de refrigerado/congelado/caliente a ambiente también exige motivo.
      const prevCategory = (previous?.data as { category?: S.ReceptionCategory | null } | undefined)?.category ?? null;
      const categoryChangedToAmbient = d.category === 'ambiente' && prevCategory != null && prevCategory !== 'ambiente';
      if (categoryDiffersFromSupplier && !d.categoryReason) {
        throw validationError(
          'data.categoryReason',
          `Este proveedor suele traer producto ${S.RECEPTION_CATEGORY_LABELS[supplier!.defaultCategory!].toLowerCase()}: explica por qué lo registras como ambiente`,
        );
      }
      if (categoryChangedToAmbient && !d.categoryReason) {
        throw validationError(
          'data.categoryReason',
          `El registro original era producto ${S.RECEPTION_CATEGORY_LABELS[prevCategory].toLowerCase()}: explica por qué lo cambias a ambiente`,
        );
      }
      if (d.accepted && needsReason && !d.correctiveAction) {
        throw validationError(
          'data.correctiveAction',
          expired ? 'La fecha de caducidad ya ha pasado: recházala o indica por qué la aceptas' : S.receptionLimitMessage(limits),
        );
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
        // Alerta: rechazo, o aceptación de mercancía caducada o fuera del límite de temperatura.
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
    case 'cocinado': {
      const d = parseData(S.cocinadoData, raw);
      const refs = S.effectiveReferenceValues(pc.org.reference_values);
      // Cocinado: 70 °C (75 °C con huevo fresco); regeneración: 74 °C. Siempre la del local, orientativa.
      const freshEgg = d.process === 'cocinado' && d.freshEgg === true;
      const referenceTemp = d.process === 'cocinado' ? (freshEgg ? refs.cookingEggMinTemp : refs.cookingMinTemp) : refs.reheatMinTemp;
      const outOfRange = d.coreTemp < referenceTemp;
      if (outOfRange && !d.correctiveAction) {
        throw validationError('data.correctiveAction', `No llega a la temperatura de referencia (${S.esNumber(referenceTemp)} °C en el centro${freshEgg ? ', con huevo fresco' : ''}): indica la acción correctora`);
      }
      return {
        data: { product: d.product, process: d.process, freshEgg, coreTemp: d.coreTemp, minutes: d.minutes ?? null, referenceTemp, outOfRange, correctiveAction: d.correctiveAction },
        alert: outOfRange,
        equipmentId: null,
        cleaningPlanId: null,
      };
    }
    case 'enfriamiento': {
      const d = parseData(S.enfriamientoData, raw);
      const prevPhase = (previous?.data as { phase?: string } | undefined)?.phase;
      if (previous && prevPhase !== d.phase) {
        throw validationError('data.phase', d.phase === 'fin' ? 'Este registro es el inicio de un enfriamiento: corrige el inicio, no lo cierres aquí' : 'Este registro es el cierre de un enfriamiento: corrige el cierre');
      }
      if (d.phase === 'inicio') {
        // H-M3: el criterio es de 60 °C a 10 °C; si empieza más frío, se anota por qué.
        const startRef = (previous?.data as { startReferenceTemp?: number } | undefined)?.startReferenceTemp ?? S.effectiveReferenceValues(pc.org.reference_values).coolingStartTemp;
        const belowStartReference = d.startTemp < startRef;
        if (belowStartReference && !d.startReason) {
          throw validationError('data.startReason', `Empieza por debajo de ${S.esNumber(startRef)} °C (referencia orientativa): indica el motivo (por ejemplo, «ya venía templado»)`);
        }
        return {
          data: {
            phase: 'inicio',
            product: d.product,
            startTemp: d.startTemp,
            startReferenceTemp: startRef,
            belowStartReference,
            startReason: belowStartReference ? d.startReason : null,
            notes: d.notes,
          },
          alert: false,
          equipmentId: null,
          cleaningPlanId: null,
        };
      }
      // Cierre: un registro NUEVO enlazado al inicio (nunca se modifica el inicio).
      const root = await chainRoot(db, orgId, d.startRecordId);
      if (!root || root.type !== 'enfriamiento' || (root.data as { phase?: string }).phase !== 'inicio') throw notFound('Enfriamiento');
      if (previous && previous.related_record_id !== root.id) throw validationError('data.startRecordId', 'Una corrección del cierre no puede cambiar de enfriamiento');
      if (!previous) {
        const closed = await db.selectFrom('records').select('id').where('related_record_id', '=', root.id).where('amends_record_id', 'is', null).executeTakeFirst();
        if (closed) throw conflict('Este enfriamiento ya está cerrado');
      }
      const start = (await latestVersion(db, orgId, root.id)) ?? root;
      const sd = start.data as { product?: string; startTemp?: number };
      const prev = previous?.data as { minutes?: number; endedAt?: string; targetTemp?: number; maxMinutes?: number } | undefined;
      const refs = S.effectiveReferenceValues(pc.org.reference_values);
      // En una corrección se conservan la hora de fin y los criterios aplicados al cerrar.
      const endedAt = prev?.endedAt ? new Date(prev.endedAt) : pc.now;
      const minutes = prev?.minutes ?? Math.max(0, Math.round((endedAt.getTime() - root.effective_at.getTime()) / 60_000));
      const targetTemp = prev?.targetTemp ?? refs.coolingTargetTemp;
      const maxMinutes = prev?.maxMinutes ?? refs.coolingMaxMinutes;
      const discarded = d.discarded === true;
      if (!discarded && d.endTemp == null) throw validationError('data.endTemp', 'Escribe la temperatura al terminar el enfriamiento');
      const overTemp = !discarded && d.endTemp != null && d.endTemp > targetTemp;
      // «En menos de dos horas»: llegar justo al máximo ya no cumple.
      const overTime = endedAt.getTime() - root.effective_at.getTime() >= maxMinutes * 60_000;
      const outOfRange = discarded || overTemp || overTime;
      if (outOfRange && !d.correctiveAction) {
        throw validationError(
          'data.correctiveAction',
          discarded
            ? 'Indica qué se ha hecho con el producto (por ejemplo, «Desechado»)'
            : `No cumple el criterio de referencia (${S.esNumber(targetTemp)} °C o menos en menos de ${maxMinutes} minutos): indica la acción correctora`,
        );
      }
      return {
        data: {
          phase: 'fin',
          startRecordId: root.id,
          product: sd.product ?? null,
          startTemp: sd.startTemp ?? null,
          startedAt: root.effective_at.toISOString(),
          endedAt: endedAt.toISOString(),
          endTemp: discarded ? (d.endTemp ?? null) : d.endTemp,
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
      const d = parseData(S.personalizadoData, raw);
      const tpl = await db.selectFrom('custom_record_templates').selectAll().where('id', '=', d.templateId).where('organization_id', '=', orgId).executeTakeFirst();
      if (!tpl) throw notFound('Registro personalizado');
      if (!tpl.active && !previous) throw validationError('data.templateId', 'Este registro personalizado está desactivado');
      if (previous && (previous.data as { templateId?: string }).templateId !== tpl.id) throw validationError('data.templateId', 'Una corrección no puede cambiar de registro personalizado');
      let alert: boolean;
      const base = { templateId: tpl.id, templateName: tpl.name, kind: tpl.kind, notes: d.notes };
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
        const outOfRange = isOutOfRange(d.reading, tpl.min_value, tpl.max_value);
        alert = outOfRange;
        data = { ...base, reading: d.reading, unit: tpl.unit, min: tpl.min_value, max: tpl.max_value, outOfRange };
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
  const now = opts.now ?? new Date();
  const prepared = await prepare(db, type, rawData, { org, today: localDate(now, org.timezone), now, previous: original });
  // En una corrección, por defecto se conserva el firmante del original (aunque ya esté desactivado).
  const staffId = actor.staffId === undefined ? (original?.staff_id ?? null) : actor.staffId;
  let staffName: string | null = null;
  if (staffId && original && staffId === original.staff_id) staffName = original.staff_name;
  else if (staffId) staffName = (await resolveStaff(db, org.id, staffId)).name;
  if (!staffId && !actor.userId) throw validationError('staffId', 'Indica quién realiza el registro');
  try {
    return await db
      .insertInto('records')
      .values({
        organization_id: org.id,
        type,
        data: json(prepared.data),
        staff_id: staffId,
        staff_name: staffName,
        user_id: actor.userId,
        user_name: actor.userName,
        device_id: actor.deviceId,
        equipment_id: prepared.equipmentId,
        cleaning_plan_id: prepared.cleaningPlanId,
        custom_template_id: prepared.customTemplateId ?? null,
        related_record_id: prepared.relatedRecordId ?? null,
        amends_record_id: original?.id ?? null,
        amendment_reason: amendment?.reason ?? null,
        alert: prepared.alert,
        // Hora del servidor de aplicación (reloj inyectable en tests). effective_at la fija un trigger.
        ...(opts.now ? { created_at: opts.now } : {}),
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  } catch (err) {
    if ((err as { code?: string; constraint?: string }).code === '23505') {
      if ((err as { constraint?: string }).constraint === 'records_single_close_idx') throw conflict('Este enfriamiento ya está cerrado');
      throw conflict('Este registro ya tiene una enmienda: enmienda la versión más reciente');
    }
    throw err;
  }
}
