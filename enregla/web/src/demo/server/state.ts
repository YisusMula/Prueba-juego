/**
 * Estado del «servidor» de la demo: tablas en memoria con la misma información que la base de datos
 * del servidor real (fechas como milisegundos). Se guarda en localStorage si se puede; si no, vive
 * solo en memoria hasta recargar.
 */
import type { AllergenMap, BusinessType, CleaningItem, EquipmentType, Frequency, RecordType, Role } from '@/api/types';

export type DUser = { id: string; email: string; name: string; password: string; createdAt: number; trialEndsAt: number };
export type DOrg = {
  id: string;
  name: string;
  businessType: BusinessType;
  timezone: string;
  reminderEnabled: boolean;
  reminderHour: number;
  publicMenuEnabled: boolean;
  publicMenuSlug: string;
  subscriptionStatus: 'trialing' | 'active';
  trialEndsAt: number;
  deletionScheduledAt: number | null;
  createdAt: number;
};
export type DMembership = { orgId: string; userId: string; role: Role; dailyReminder: boolean; createdAt: number };
export type DStaff = { id: string; orgId: string; name: string; pin: string | null; active: boolean; failed: number; lockedUntil: number | null; createdAt: number };
export type DDevice = { id: string; orgId: string; name: string; token: string; createdBy: string | null; createdAt: number; lastUsedAt: number | null; revokedAt: number | null };
export type EquipmentState = { validFrom: number; checksPerDay: number; active: boolean };
export type DEquipment = {
  id: string;
  orgId: string;
  name: string;
  type: EquipmentType;
  minTemp: number | null;
  maxTemp: number | null;
  checksPerDay: number;
  active: boolean;
  createdAt: number;
  history: EquipmentState[];
};
export type PlanState = { validFrom: number; frequency: Frequency; weekday: number | null; monthDay: number | null; active: boolean };
export type DPlan = {
  id: string;
  orgId: string;
  name: string;
  frequency: Frequency;
  weekday: number | null;
  monthDay: number | null;
  items: CleaningItem[];
  active: boolean;
  createdAt: number;
  history: PlanState[];
};
export type DSupplier = {
  id: string;
  orgId: string;
  name: string;
  contactName: string | null;
  phone: string | null;
  email: string | null;
  products: string[];
  notes: string | null;
  createdAt: number;
};
export type DDish = {
  id: string;
  orgId: string;
  name: string;
  category: string | null;
  description: string | null;
  allergens: AllergenMap;
  allergensReviewed: boolean;
  allergensReviewedAt: number | null;
  visible: boolean;
  createdAt: number;
  updatedAt: number;
};
export type DRecord = {
  id: string;
  orgId: string;
  type: RecordType;
  data: Record<string, unknown>;
  staffId: string | null;
  staffName: string | null;
  userId: string | null;
  userName: string | null;
  deviceId: string | null;
  equipmentId: string | null;
  cleaningPlanId: string | null;
  amendsRecordId: string | null;
  amendmentReason: string | null;
  alert: boolean;
  createdAt: number;
  effectiveAt: number;
};
export type DInvitation = { id: string; orgId: string; email: string; role: Role; invitedBy: string; expiresAt: number; createdAt: number };
export type DAudit = { id: number; orgId: string; event: string; userId: string | null; ip: string | null; metadata: Record<string, unknown>; createdAt: number };

export type DemoState = {
  version: number;
  /** Fecha local (AAAA-MM-DD) en la que se generaron los datos de ejemplo. */
  seededOn: string;
  /** Usuario con la sesión iniciada (null tras cerrar sesión). */
  sessionUserId: string | null;
  users: DUser[];
  orgs: DOrg[];
  memberships: DMembership[];
  staff: DStaff[];
  devices: DDevice[];
  equipment: DEquipment[];
  plans: DPlan[];
  suppliers: DSupplier[];
  dishes: DDish[];
  records: DRecord[];
  invitations: DInvitation[];
  audit: DAudit[];
  auditSeq: number;
  /** Claves de idempotencia: `${orgId}|${scope}|${key}` → cuerpo (JSON) e id del registro creado. */
  idempotency: Record<string, { payload: string; recordId: string }>;
  /** Fallos de PIN por dispositivo (instantes) para el límite de 20 / 15 min. */
  pinFailsByDevice: Record<string, number[]>;
};

export const STATE_VERSION = 1;
