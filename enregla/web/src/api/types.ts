/**
 * Tipos de las respuestas de la API (docs/API.md). Las constantes y esquemas de entrada
 * se importan directamente de `@shared/schemas` (enregla/server/src/schemas) para usar
 * exactamente las mismas reglas que el servidor.
 */
import type { AllergenId, RecordType } from '@shared/schemas';
import type { BUSINESS_TYPES, EQUIPMENT_TYPES } from '@shared/schemas';

export type { AllergenId, RecordType };
export type BusinessType = (typeof BUSINESS_TYPES)[number];
export type EquipmentType = (typeof EQUIPMENT_TYPES)[number];
export type Role = 'owner' | 'manager';

export type Page<T> = { items: T[]; nextCursor: string | null };

export type User = { id: string; email: string; name: string; emailVerified: boolean; createdAt?: string };

export type SubscriptionStatus =
  | 'trialing'
  | 'trial_expired'
  | 'active'
  | 'past_due'
  | 'unpaid'
  | 'canceled'
  | 'incomplete'
  | 'incomplete_expired'
  | 'paused';

export type Subscription = {
  status: SubscriptionStatus;
  readOnly: boolean;
  trialEndsAt: string;
  plan: 'monthly' | 'annual' | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  hasBillingAccount: boolean;
};

export type OrgSummary = { id: string; name: string; businessType: BusinessType; role: Role; subscription: Subscription };

export type Account = { user: User; organizations: OrgSummary[] };

export type Organization = {
  id: string;
  name: string;
  businessType: BusinessType;
  timezone: string;
  reminderEnabled: boolean;
  reminderHour: number;
  role: Role;
  publicMenu: { enabled: boolean; slug: string };
  subscription: Subscription;
  createdAt: string;
};

export type Member = { userId: string; name: string; email: string; role: Role; joinedAt: string };
export type Invitation = { id: string; email: string; role: Role; expiresAt: string; createdAt: string };
export type InvitationPreview = { organizationName: string; email: string; role: Role; invitedBy: string | null; expiresAt: string };

export type AuditEvent = {
  id: string;
  event: string;
  user: { id: string; name: string | null } | null;
  ip: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
};

export type Staff = { id: string; name: string; hasPin: boolean; active: boolean; lockedUntil: string | null; createdAt: string };
export type Device = { id: string; name: string; createdAt: string; lastUsedAt: string | null; revokedAt: string | null; active: boolean };

export type Equipment = {
  id: string;
  name: string;
  type: EquipmentType;
  minTemp: number | null;
  maxTemp: number | null;
  checksPerDay: number;
  active: boolean;
  createdAt: string;
};

export type Frequency = 'daily' | 'weekly' | 'monthly';
export type CleaningItem = { id: string; area: string; product: string | null; method: string | null };
export type CleaningPlan = {
  id: string;
  name: string;
  frequency: Frequency;
  weekday: number | null;
  monthDay: number | null;
  items: CleaningItem[];
  active: boolean;
  createdAt: string;
};

export type Supplier = {
  id: string;
  name: string;
  contactName: string | null;
  phone: string | null;
  email: string | null;
  products: string[];
  notes: string | null;
  createdAt: string;
};

// --- Registros ---------------------------------------------------------------
export type TemperaturaStored = {
  equipmentId: string;
  equipmentName: string;
  value: number;
  minTemp: number | null;
  maxTemp: number | null;
  outOfRange: boolean;
  correctiveAction: string | null;
};
export type LimpiezaStored = {
  cleaningPlanId: string;
  planName: string;
  items: { itemId: string; area: string; done: boolean }[];
  completed: boolean;
  observations: string | null;
};
export type RecepcionStored = {
  supplierId: string | null;
  supplierName: string;
  product: string;
  lot: string | null;
  temperature: number | null;
  expiryDate: string | null;
  accepted: boolean;
  rejectionReason: string | null;
};
export type AceiteStored = {
  equipmentId: string;
  fryerName: string;
  action: 'revisado' | 'cambiado';
  polarCompounds: number | null;
  overLimit: boolean;
  correctiveAction: string | null;
};
export type PlagasStored = { result: 'sin_indicios' | 'con_indicios'; description: string | null; action: string | null };
export type IncidenciaStored = { description: string; correctiveAction: string | null; closed: boolean };
export type FormacionStored = {
  traineeStaffId: string;
  traineeName: string;
  course: string;
  trainingDate: string;
  trainer: string | null;
  hours: number | null;
};

export type RecordDataMap = {
  temperatura: TemperaturaStored;
  limpieza: LimpiezaStored;
  recepcion: RecepcionStored;
  aceite: AceiteStored;
  plagas: PlagasStored;
  incidencia: IncidenciaStored;
  formacion: FormacionStored;
};

type RecordBase = {
  id: string;
  staff: { id: string; name: string } | null;
  user: { id: string; name: string } | null;
  deviceId: string | null;
  alert: boolean;
  amendsRecordId: string | null;
  amendmentReason: string | null;
  amendedByRecordId: string | null;
  createdAt: string;
};

export type AppRecord = {
  [K in RecordType]: RecordBase & { type: K; data: RecordDataMap[K] };
}[RecordType];

export type RecordDetail = { record: AppRecord; amends: AppRecord | null; amendedBy: AppRecord | null };

// --- Alérgenos ------------------------------------------------------------------
export type AllergenStatus = 'contains' | 'traces' | 'no';
export type AllergenMap = Record<AllergenId, AllergenStatus>;
export type Dish = {
  id: string;
  name: string;
  category: string | null;
  description: string | null;
  allergens: AllergenMap;
  visible: boolean;
  createdAt: string;
  updatedAt: string;
};
export type PublicMenuSettings = { enabled: boolean; slug: string; apiPath: string };
export type PublicMenu = {
  organization: { name: string };
  allergens: { id: AllergenId; label: string }[];
  statuses: Record<AllergenStatus, string>;
  dishes: { name: string; category: string | null; description: string | null; allergens: AllergenMap }[];
  updatedAt: string | null;
  notice: string;
};

// --- Tareas -------------------------------------------------------------------
export type AlertKind =
  | 'temperatura_fuera_de_rango'
  | 'aceite_fuera_de_limite'
  | 'recepcion_rechazada'
  | 'plagas_con_indicios'
  | 'incidencia_abierta';

export type TodayTasks = {
  date: string;
  timezone: string;
  temperatures: {
    equipmentId: string;
    name: string;
    type: EquipmentType;
    minTemp: number | null;
    maxTemp: number | null;
    required: number;
    done: number;
    status: 'done' | 'pending';
    lastReading: { value: number; outOfRange: boolean; at: string } | null;
  }[];
  cleaning: {
    cleaningPlanId: string;
    name: string;
    frequency: Frequency;
    status: 'done' | 'pending';
    completedAt: string | null;
  }[];
  summary: { total: number; done: number; pending: number; percent: number };
  alerts: { kind: AlertKind; recordId: string; message: string; createdAt: string }[];
};

export type Compliance = {
  from: string;
  to: string;
  days: { date: string; expected: number; done: number; percent: number | null }[];
  overall: { expected: number; done: number; percent: number | null };
};

export type Billing = {
  billingEnabled: boolean;
  prices: {
    monthly: { amount: number; currency: string; interval: string };
    annual: { amount: number; currency: string; interval: string };
  };
  subscription: Subscription;
};

// --- Kiosko -------------------------------------------------------------------
export type KioskContext = {
  device: { id: string; name: string };
  organization: { id: string; name: string; timezone: string; readOnly: boolean };
  staff: { id: string; name: string; hasPin: boolean }[];
  equipment: { id: string; name: string; type: EquipmentType; minTemp: number | null; maxTemp: number | null; checksPerDay: number }[];
  cleaningPlans: { id: string; name: string; frequency: Frequency; weekday: number | null; monthDay: number | null; items: CleaningItem[] }[];
  suppliers: { id: string; name: string; products: string[] }[];
};
