/**
 * Estado del «servidor» de la demo: tablas en memoria con la misma información que la base de datos
 * del servidor real (fechas como milisegundos). Se guarda en localStorage si se puede; si no, vive
 * solo en memoria hasta recargar.
 */
import type { AllergenMap, BusinessType, CleaningItem, CustomFrequency, CustomKind, EquipmentType, Frequency, RecordType, ReferenceValues, Role } from '@/api/types';

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
  /** El titular pidió la eliminación inmediata: el «mantenimiento» la ejecuta en la próxima hora. */
  purgeRequestedAt?: number | null;
  /** Fase 2: datos del establecimiento (portada del PDF) y valores de referencia propios. */
  legalName?: string | null;
  taxId?: string | null;
  address?: string | null;
  postalCode?: string | null;
  city?: string | null;
  province?: string | null;
  sanitaryRegistry?: string | null;
  referenceValues?: Partial<ReferenceValues> | null;
  createdAt: number;
};
export type DMembership = { orgId: string; userId: string; role: Role; dailyReminder: boolean; weeklyReviewReminder?: boolean; createdAt: number };
export type TemplateState = { validFrom: number; frequency: CustomFrequency; timesPerDay: number; weekday: number | null; monthDay: number | null; active: boolean };
export type DTemplate = {
  id: string;
  orgId: string;
  name: string;
  kind: CustomKind;
  items: { id: string; label: string }[];
  unit: string | null;
  min: number | null;
  max: number | null;
  frequency: CustomFrequency;
  timesPerDay: number;
  weekday: number | null;
  monthDay: number | null;
  instructions: string | null;
  suggestionKey: string | null;
  source: string | null;
  active: boolean;
  createdAt: number;
  history: TemplateState[];
};
export type DVerification = {
  id: string;
  orgId: string;
  from: string;
  to: string;
  kind: 'week' | 'month' | 'custom';
  comment: string | null;
  userId: string;
  userName: string;
  userRole: Role;
  createdAt: number;
};
export type DStaff = { id: string; orgId: string; name: string; pin: string | null; active: boolean; failed: number; lockedUntil: number | null; createdAt: number; /** Bloqueo progresivo (R7). */ lockLevel?: number };
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
  /** Categoría de producto por defecto en la recepción (servidor: suppliers.default_category). */
  defaultCategory?: 'refrigerado' | 'congelado' | 'ambiente' | 'caliente' | null;
  /** Límite propio de recepción (servidor: suppliers.reception_limit). */
  receptionLimit?: number | null;
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
  /** Fase 2: plantilla de un registro personalizado y, en el cierre de un enfriamiento, su inicio. */
  customTemplateId?: string | null;
  relatedRecordId?: string | null;
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
  templates: DTemplate[];
  verifications: DVerification[];
  invitations: DInvitation[];
  audit: DAudit[];
  auditSeq: number;
  /** Claves de idempotencia: `${orgId}|${scope}|${key}` → cuerpo (JSON) e id del registro creado. */
  idempotency: Record<string, { payload: string; recordId: string }>;
  /** Fallos de PIN por dispositivo (instantes) para el límite de 20 / 15 min. */
  pinFailsByDevice: Record<string, number[]>;
};

/** 2: categoría de proveedor y de recepción, firma «anotado por», correcciones desde la tablet (fase 1). 3: fase 2 (registros nuevos, verificaciones, datos del establecimiento). */
export const STATE_VERSION = 3;
