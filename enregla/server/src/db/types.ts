import type { ColumnType, Generated, Insertable, Selectable, Updateable } from 'kysely';

type Timestamp = ColumnType<Date, Date | string | undefined, Date | string>;
type TimestampNullable = ColumnType<Date | null, Date | string | null | undefined, Date | string | null>;
type Json<T> = ColumnType<T, string, string>;

export interface UsersTable {
  id: Generated<string>;
  email: string;
  email_verified_at: TimestampNullable;
  password_hash: string;
  name: string;
  /** Fin de la prueba gratuita de la cuenta (fijado al crear su primer local). */
  trial_ends_at: TimestampNullable;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface SessionsTable {
  id: Generated<string>;
  token_hash: string;
  user_id: string;
  created_at: Timestamp;
  last_seen_at: Timestamp;
  expires_at: Timestamp;
  ip: string | null;
  user_agent: string | null;
}

export type EmailTokenPurpose = 'verify_email' | 'password_reset' | 'email_change';

export interface EmailTokensTable {
  id: Generated<string>;
  user_id: string;
  purpose: EmailTokenPurpose;
  token_hash: string;
  new_email: string | null;
  expires_at: Timestamp;
  used_at: TimestampNullable;
  created_at: Timestamp;
}

export interface OrganizationsTable {
  id: Generated<string>;
  name: string;
  business_type: string;
  timezone: string;
  reminder_enabled: Generated<boolean>;
  reminder_hour: Generated<number>;
  /** Fecha local YYYY-MM-DD (DATE devuelto como texto). */
  last_reminder_on: string | null;
  public_menu_enabled: Generated<boolean>;
  public_menu_slug: string;
  subscription_status: Generated<string>;
  trial_ends_at: Timestamp;
  plan: string | null;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  current_period_end: TimestampNullable;
  cancel_at_period_end: Generated<boolean>;
  stripe_event_at: TimestampNullable;
  trial_notice_soon_sent_at: TimestampNullable;
  trial_notice_end_sent_at: TimestampNullable;
  /** Borrado diferido: cuándo se pidió y cuándo se purgará definitivamente. */
  deletion_requested_at: TimestampNullable;
  deletion_scheduled_at: TimestampNullable;
  /** Eliminación inmediata pedida por el titular (migración 0007); la purga la hace enregla_purge_organization. */
  purge_requested_at: Date | null;
  /** Propietario que pidió la eliminación inmediata (0010: lo comprueba un trigger). */
  purge_requested_by: string | null;
  /** Por qué el mantenimiento no ha podido purgarlo (solo lo escribe el propietario). */
  purge_blocked_reason: Generated<string | null>;
  deletion_requested_by: string | null;
  /** Sesión de Checkout abierta (se expira al pedir el borrado del local). */
  stripe_checkout_session_id: string | null;
  /** Desde cuándo la suscripción está en `past_due` (null si no lo está). */
  past_due_since: TimestampNullable;
  /** Datos del establecimiento (0011): portada del PDF. */
  legal_name: string | null;
  tax_id: string | null;
  address: string | null;
  postal_code: string | null;
  city: string | null;
  province: string | null;
  sanitary_registry: string | null;
  /** Valores de referencia propios del local (0011); null = los de referencia. */
  reference_values: Json<Record<string, unknown> | null> | null;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export type Role = 'owner' | 'manager';

export interface MembershipsTable {
  organization_id: string;
  user_id: string;
  role: Role;
  daily_reminder: Generated<boolean>;
  /** Aviso semanal de periodo sin revisar (0011). */
  weekly_review_reminder: Generated<boolean>;
  created_at: Timestamp;
}

export interface InvitationsTable {
  id: Generated<string>;
  organization_id: string;
  email: string;
  role: Role;
  token_hash: string;
  invited_by: string | null;
  expires_at: Timestamp;
  accepted_at: TimestampNullable;
  revoked_at: TimestampNullable;
  created_at: Timestamp;
}

export interface StaffTable {
  id: Generated<string>;
  organization_id: string;
  name: string;
  pin_hash: string | null;
  pin_failed_count: Generated<number>;
  pin_locked_until: TimestampNullable;
  /** Bloqueo progresivo (0010): 0 sin bloqueos recientes; 1 → 1 min, 2 → 5 min, 3+ → 15 min. */
  pin_lock_level: Generated<number>;
  active: Generated<boolean>;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface DevicesTable {
  id: Generated<string>;
  organization_id: string;
  name: string;
  token_hash: string;
  created_by: string | null;
  created_at: Timestamp;
  last_used_at: TimestampNullable;
  revoked_at: TimestampNullable;
}

export interface EquipmentTable {
  id: Generated<string>;
  organization_id: string;
  name: string;
  type: string;
  min_temp: number | null;
  max_temp: number | null;
  checks_per_day: number;
  active: Generated<boolean>;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface CleaningItem {
  id: string;
  area: string;
  product: string | null;
  method: string | null;
}

export interface CleaningPlansTable {
  id: Generated<string>;
  organization_id: string;
  name: string;
  frequency: 'daily' | 'weekly' | 'monthly';
  weekday: number | null;
  month_day: number | null;
  items: Json<CleaningItem[]>;
  active: Generated<boolean>;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface SuppliersTable {
  id: Generated<string>;
  organization_id: string;
  name: string;
  contact_name: string | null;
  phone: string | null;
  email: string | null;
  products: Json<string[]>;
  notes: string | null;
  /** Categoría de producto por defecto en la recepción (migración 0006). */
  default_category: string | null;
  /** Límite de temperatura de recepción propio del proveedor (migración 0008). */
  reception_limit: number | null;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface RecordsTable {
  id: Generated<string>;
  organization_id: string;
  type: string;
  data: Json<Record<string, unknown>>;
  staff_id: string | null;
  staff_name: string | null;
  user_id: string | null;
  user_name: string | null;
  device_id: string | null;
  equipment_id: string | null;
  cleaning_plan_id: string | null;
  amends_record_id: string | null;
  amendment_reason: string | null;
  /** Plantilla de un registro personalizado (0011). */
  custom_template_id: string | null;
  /** Cierre de un enfriamiento: el registro de inicio (raíz) al que cierra (0011). */
  related_record_id: string | null;
  alert: Generated<boolean>;
  created_at: Timestamp;
  /** Fecha del hecho: la del registro raíz en una enmienda. La rellena un trigger. */
  effective_at: ColumnType<Date, never, never>;
  /** Orden de inserción (migración 0006): desempata original → corrección con la misma fecha del hecho. */
  seq: ColumnType<number, never, never>;
}

export interface DishesTable {
  id: Generated<string>;
  organization_id: string;
  name: string;
  category: string | null;
  description: string | null;
  allergens: Json<Record<string, string>>;
  /** Revisión explícita de los 14 alérgenos (migración 0004). Sin revisar no se publica. */
  allergens_reviewed: Generated<boolean>;
  allergens_reviewed_at: Date | null;
  visible: Generated<boolean>;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface AuditEventsTable {
  id: Generated<string>;
  organization_id: string | null;
  user_id: string | null;
  event: string;
  ip: string | null;
  metadata: Json<Record<string, unknown>>;
  created_at: Timestamp;
}

export interface RateLimitsTable {
  key: string;
  count: number;
  reset_at: Timestamp;
}

export interface JobRunsTable {
  name: string;
  last_run_at: Timestamp;
}

export interface StripeEventsTable {
  id: string;
  type: string;
  processed_at: Timestamp;
}

export interface EquipmentConfigHistoryTable {
  id: Generated<string>;
  equipment_id: string;
  organization_id: string;
  valid_from: Timestamp;
  checks_per_day: number;
  active: boolean;
  /** Nombre y rango vigentes en ese tramo (0012). */
  name: string | null;
  min_temp: number | null;
  max_temp: number | null;
}

export interface CleaningPlanConfigHistoryTable {
  id: Generated<string>;
  cleaning_plan_id: string;
  organization_id: string;
  valid_from: Timestamp;
  frequency: 'daily' | 'weekly' | 'monthly';
  weekday: number | null;
  month_day: number | null;
  active: boolean;
  /** Nombre vigente en ese tramo (0012). */
  name: string | null;
}

export interface IdempotencyKeysTable {
  organization_id: string;
  key: string;
  request_hash: string;
  record_id: string | null;
  created_at: Timestamp;
}

export interface EmailOutboxTable {
  id: Generated<string>;
  to_address: string;
  subject: string;
  text_body: string;
  html_body: string;
  status: Generated<'pending' | 'sent' | 'failed'>;
  attempts: Generated<number>;
  next_attempt_at: Timestamp;
  last_error: string | null;
  created_at: Timestamp;
  sent_at: TimestampNullable;
}

export interface CustomTemplateItem {
  id: string;
  label: string;
}

export interface CustomRecordTemplatesTable {
  id: Generated<string>;
  organization_id: string;
  name: string;
  kind: 'checklist' | 'numeric' | 'yesno';
  items: Json<CustomTemplateItem[]>;
  unit: string | null;
  min_value: number | null;
  max_value: number | null;
  frequency: 'daily' | 'weekly' | 'monthly' | 'on_demand';
  times_per_day: number;
  weekday: number | null;
  month_day: number | null;
  instructions: string | null;
  /** Aviso si pasan estos meses sin registrarlo (0012). */
  reminder_months: number | null;
  suggestion_key: string | null;
  source: string | null;
  active: Generated<boolean>;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface CustomTemplateConfigHistoryTable {
  id: Generated<string>;
  template_id: string;
  organization_id: string;
  valid_from: Timestamp;
  frequency: 'daily' | 'weekly' | 'monthly' | 'on_demand';
  times_per_day: number;
  weekday: number | null;
  month_day: number | null;
  active: boolean;
  /** Nombre y rango vigentes en ese tramo (0012). */
  name: string | null;
  unit: string | null;
  min_value: number | null;
  max_value: number | null;
}

export interface ResponsibleVerificationsTable {
  id: Generated<string>;
  organization_id: string;
  period_from: ColumnType<string, string, never>;
  period_to: ColumnType<string, string, never>;
  period_kind: 'week' | 'month' | 'custom';
  comment: string | null;
  user_id: string;
  user_name: string;
  user_role: Role;
  /** Foto de lo que había al verificar (0012): huecos, alertas sin acción y enfriamientos sin cerrar. */
  snapshot: Json<VerificationSnapshot | null> | null;
  created_at: Timestamp;
}

export interface VerificationSnapshot {
  gapTasks: number;
  gapDays: number;
  pendingTasks: number;
  alerts: number;
  alertsWithoutAction: number;
  openCoolings: number;
  records: number;
}

export interface Database {
  users: UsersTable;
  sessions: SessionsTable;
  email_tokens: EmailTokensTable;
  organizations: OrganizationsTable;
  memberships: MembershipsTable;
  invitations: InvitationsTable;
  staff: StaffTable;
  devices: DevicesTable;
  equipment: EquipmentTable;
  cleaning_plans: CleaningPlansTable;
  suppliers: SuppliersTable;
  records: RecordsTable;
  dishes: DishesTable;
  audit_events: AuditEventsTable;
  rate_limits: RateLimitsTable;
  stripe_events: StripeEventsTable;
  job_runs: JobRunsTable;
  equipment_config_history: EquipmentConfigHistoryTable;
  cleaning_plan_config_history: CleaningPlanConfigHistoryTable;
  idempotency_keys: IdempotencyKeysTable;
  email_outbox: EmailOutboxTable;
  custom_record_templates: CustomRecordTemplatesTable;
  custom_template_config_history: CustomTemplateConfigHistoryTable;
  responsible_verifications: ResponsibleVerificationsTable;
}

export type User = Selectable<UsersTable>;
export type Organization = Selectable<OrganizationsTable>;
export type Staff = Selectable<StaffTable>;
export type Equipment = Selectable<EquipmentTable>;
export type CleaningPlan = Selectable<CleaningPlansTable>;
export type RecordRow = Selectable<RecordsTable>;
export type CustomTemplate = Selectable<CustomRecordTemplatesTable>;
export type Verification = Selectable<ResponsibleVerificationsTable>;
export type NewRecord = Insertable<RecordsTable>;
export type OrganizationUpdate = Updateable<OrganizationsTable>;
