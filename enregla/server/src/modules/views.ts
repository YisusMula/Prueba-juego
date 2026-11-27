import type { CleaningPlan, CustomTemplate, Equipment, Organization, RecordRow, Staff, Verification } from '../db/types.js';
import type { Role } from '../db/types.js';
import { subscriptionView } from './billing/status.js';
import { effectiveReferenceValues, recordCorrector, recordSignature, sanitaryRegistryLooksValid } from '../schemas/index.js';

export function orgView(o: Organization, role: Role) {
  return {
    id: o.id,
    name: o.name,
    businessType: o.business_type,
    timezone: o.timezone,
    reminderEnabled: o.reminder_enabled,
    reminderHour: o.reminder_hour,
    role,
    publicMenu: { enabled: o.public_menu_enabled, slug: o.public_menu_slug },
    subscription: subscriptionView(o),
    /** Si no es null, el local está pendiente de eliminación definitiva en esa fecha (solo lectura). */
    deletionScheduledAt: o.deletion_scheduled_at?.toISOString() ?? null,
    /** NUEVO: el titular pidió la eliminación inmediata; el mantenimiento la ejecuta en la próxima hora. */
    purgeRequestedAt: o.purge_requested_at?.toISOString() ?? null,
    /** NUEVO (fase 2): datos del establecimiento para la portada del PDF (null = no indicado). */
    establishment: establishmentView(o),
    /** NUEVO (fase 2): valores de referencia vigentes (los del local o, si no tiene, los orientativos). */
    referenceValues: effectiveReferenceValues(o.reference_values),
    /** NUEVO: valores que el local ha cambiado (los demás son los de referencia). */
    referenceValuesCustom: o.reference_values ?? {},
    createdAt: o.created_at.toISOString(),
  };
}

export function establishmentView(o: Pick<Organization, 'legal_name' | 'tax_id' | 'address' | 'postal_code' | 'city' | 'province' | 'sanitary_registry'>) {
  return {
    legalName: o.legal_name,
    taxId: o.tax_id,
    address: o.address,
    postalCode: o.postal_code,
    city: o.city,
    province: o.province,
    sanitaryRegistry: o.sanitary_registry,
    /** false si el nº de Registro Sanitario no sigue el formato habitual NN.NNNNN/XX (se guarda igual). */
    sanitaryRegistryFormatOk: sanitaryRegistryLooksValid(o.sanitary_registry),
  };
}

export function customTemplateView(t: CustomTemplate) {
  return {
    id: t.id,
    name: t.name,
    kind: t.kind,
    items: t.items,
    unit: t.unit,
    min: t.min_value,
    max: t.max_value,
    frequency: t.frequency,
    timesPerDay: t.times_per_day,
    weekday: t.weekday,
    monthDay: t.month_day,
    instructions: t.instructions,
    reminderMonths: t.reminder_months,
    suggestionKey: t.suggestion_key,
    source: t.source,
    active: t.active,
    createdAt: t.created_at.toISOString(),
  };
}

export function verificationView(v: Verification) {
  return {
    id: v.id,
    from: v.period_from,
    to: v.period_to,
    kind: v.period_kind,
    comment: v.comment,
    user: { id: v.user_id, name: v.user_name, role: v.user_role },
    /** Foto de lo que había al verificar (null en las anteriores a 0012). */
    snapshot: v.snapshot ?? null,
    createdAt: v.created_at.toISOString(),
  };
}

export function staffView(s: Pick<Staff, 'id' | 'name' | 'pin_hash' | 'active' | 'pin_locked_until' | 'created_at'>) {
  return {
    id: s.id,
    name: s.name,
    hasPin: s.pin_hash != null,
    active: s.active,
    lockedUntil: s.pin_locked_until && s.pin_locked_until.getTime() > Date.now() ? s.pin_locked_until.toISOString() : null,
    createdAt: s.created_at.toISOString(),
  };
}

export function equipmentView(e: Equipment) {
  return {
    id: e.id,
    name: e.name,
    type: e.type,
    minTemp: e.min_temp,
    maxTemp: e.max_temp,
    checksPerDay: e.checks_per_day,
    active: e.active,
    createdAt: e.created_at.toISOString(),
  };
}

export function cleaningPlanView(p: CleaningPlan) {
  return {
    id: p.id,
    name: p.name,
    frequency: p.frequency,
    weekday: p.weekday,
    monthDay: p.month_day,
    items: p.items,
    active: p.active,
    createdAt: p.created_at.toISOString(),
  };
}

export function recordView(r: RecordRow & { amended_by?: string | null }) {
  return {
    id: r.id,
    type: r.type,
    data: r.data,
    staff: r.staff_id ? { id: r.staff_id, name: r.staff_name } : null,
    user: r.user_id ? { id: r.user_id, name: r.user_name } : null,
    deviceId: r.device_id,
    /** Firma legible (NUEVO): «Ana Martín (anotado por Laura Gil)» si un usuario lo anotó para un empleado. */
    signature: recordSignature({ staffName: r.staff_name, userName: r.user_name, deviceId: r.device_id, isAmendment: r.amends_record_id != null }),
    /** En una corrección (NUEVO): quién la hizo (el usuario en la web; el empleado en la tablet). */
    correctedBy: r.amends_record_id ? recordCorrector({ staffName: r.staff_name, userName: r.user_name }) : null,
    alert: r.alert,
    amendsRecordId: r.amends_record_id,
    amendmentReason: r.amendment_reason,
    amendedByRecordId: r.amended_by ?? null,
    /** Fecha del hecho: en una enmienda, la del registro original (raíz de la cadena). */
    effectiveAt: r.effective_at.toISOString(),
    /** Hora real de inserción (en una enmienda, cuándo se enmendó). */
    createdAt: r.created_at.toISOString(),
  };
}
