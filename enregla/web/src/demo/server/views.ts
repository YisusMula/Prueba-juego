/** Formas de respuesta de la API (las mismas que `server/src/modules/views.ts` y las rutas). */
import type {
  AppRecord,
  CleaningPlan,
  Device,
  Dish,
  Equipment,
  Organization,
  Role,
  Staff,
  Subscription,
  Supplier,
} from '@/api/types';
import type { DDevice, DDish, DemoState, DEquipment, DOrg, DPlan, DRecord, DStaff, DSupplier } from './state';
import { iso } from './time';

export function isWritable(org: DOrg, now = Date.now()): boolean {
  if (org.deletionScheduledAt) return false;
  return !(org.subscriptionStatus === 'trialing' && org.trialEndsAt <= now);
}

export function subscriptionView(org: DOrg, now = Date.now()): Subscription {
  const status = org.subscriptionStatus === 'trialing' && org.trialEndsAt <= now ? 'trial_expired' : org.subscriptionStatus;
  return {
    status,
    readOnly: !isWritable(org, now),
    paymentFailed: false,
    pastDueSince: null,
    trialEndsAt: iso(org.trialEndsAt),
    plan: null,
    currentPeriodEnd: null,
    cancelAtPeriodEnd: false,
    hasBillingAccount: false,
  };
}

export function orgView(o: DOrg, role: Role): Organization {
  return {
    id: o.id,
    name: o.name,
    businessType: o.businessType,
    timezone: o.timezone,
    reminderEnabled: o.reminderEnabled,
    reminderHour: o.reminderHour,
    role,
    publicMenu: { enabled: o.publicMenuEnabled, slug: o.publicMenuSlug },
    subscription: subscriptionView(o),
    deletionScheduledAt: o.deletionScheduledAt ? iso(o.deletionScheduledAt) : null,
    createdAt: iso(o.createdAt),
  };
}

export const staffView = (s: DStaff): Staff => ({
  id: s.id,
  name: s.name,
  hasPin: s.pin != null,
  active: s.active,
  lockedUntil: s.lockedUntil && s.lockedUntil > Date.now() ? iso(s.lockedUntil) : null,
  createdAt: iso(s.createdAt),
});

export const equipmentView = (e: DEquipment): Equipment => ({
  id: e.id,
  name: e.name,
  type: e.type,
  minTemp: e.minTemp,
  maxTemp: e.maxTemp,
  checksPerDay: e.checksPerDay,
  active: e.active,
  createdAt: iso(e.createdAt),
});

export const cleaningPlanView = (p: DPlan): CleaningPlan => ({
  id: p.id,
  name: p.name,
  frequency: p.frequency,
  weekday: p.weekday,
  monthDay: p.monthDay,
  items: p.items,
  active: p.active,
  createdAt: iso(p.createdAt),
});

export const supplierView = (s: DSupplier): Supplier => ({
  id: s.id,
  name: s.name,
  contactName: s.contactName,
  phone: s.phone,
  email: s.email,
  products: s.products,
  notes: s.notes,
  createdAt: iso(s.createdAt),
});

export const dishView = (d: DDish): Dish => ({
  id: d.id,
  name: d.name,
  category: d.category,
  description: d.description,
  allergens: d.allergens,
  allergensReviewed: d.allergensReviewed,
  allergensReviewedAt: d.allergensReviewedAt ? iso(d.allergensReviewedAt) : null,
  visible: d.visible,
  createdAt: iso(d.createdAt),
  updatedAt: iso(d.updatedAt),
});

export function deviceView(db: DemoState, d: DDevice): Device {
  return {
    id: d.id,
    name: d.name,
    createdByName: db.users.find((u) => u.id === d.createdBy)?.name ?? null,
    createdAt: iso(d.createdAt),
    lastUsedAt: d.lastUsedAt ? iso(d.lastUsedAt) : null,
    revokedAt: d.revokedAt ? iso(d.revokedAt) : null,
    active: d.revokedAt == null,
  };
}

export function amendedBy(db: DemoState, r: DRecord): string | null {
  return db.records.find((a) => a.amendsRecordId === r.id)?.id ?? null;
}

export function recordView(db: DemoState, r: DRecord): AppRecord {
  return {
    id: r.id,
    type: r.type,
    data: r.data,
    staff: r.staffId ? { id: r.staffId, name: r.staffName ?? '' } : null,
    user: r.userId ? { id: r.userId, name: r.userName ?? '' } : null,
    deviceId: r.deviceId,
    alert: r.alert,
    amendsRecordId: r.amendsRecordId,
    amendmentReason: r.amendmentReason,
    amendedByRecordId: amendedBy(db, r),
    effectiveAt: iso(r.effectiveAt),
    createdAt: iso(r.createdAt),
  } as AppRecord;
}
