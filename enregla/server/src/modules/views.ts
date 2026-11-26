import type { CleaningPlan, Equipment, Organization, RecordRow, Staff } from '../db/types.js';
import type { Role } from '../db/types.js';
import { subscriptionView } from './billing/status.js';
import { recordCorrector, recordSignature } from '../schemas/index.js';

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
    createdAt: o.created_at.toISOString(),
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
