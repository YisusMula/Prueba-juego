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
  deletion_requested_by: string | null;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export type Role = 'owner' | 'manager';

export interface MembershipsTable {
  organization_id: string;
  user_id: string;
  role: Role;
  daily_reminder: Generated<boolean>;
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
  alert: Generated<boolean>;
  created_at: Timestamp;
  /** Fecha del hecho: la del registro raíz en una enmienda. La rellena un trigger. */
  effective_at: ColumnType<Date, never, never>;
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
}

export type User = Selectable<UsersTable>;
export type Organization = Selectable<OrganizationsTable>;
export type Staff = Selectable<StaffTable>;
export type Equipment = Selectable<EquipmentTable>;
export type CleaningPlan = Selectable<CleaningPlansTable>;
export type RecordRow = Selectable<RecordsTable>;
export type NewRecord = Insertable<RecordsTable>;
export type OrganizationUpdate = Updateable<OrganizationsTable>;
