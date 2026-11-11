import { TEMPLATES } from '../../../../server/src/modules/orgs/templates';
import type { BusinessType } from '@/api/types';
import type { DemoState, DOrg } from './state';
import { newSlug, uuid } from './ids';

export const TRIAL_DAYS = 14;

/** Igual que `createOrganization` del servidor: local + propietario + plantilla orientativa de equipos y limpieza. */
export function createOrganization(
  db: DemoState,
  input: { name: string; businessType: BusinessType; timezone: string; ownerId: string; now: number },
): DOrg {
  const owner = db.users.find((u) => u.id === input.ownerId)!;
  const org: DOrg = {
    id: uuid(),
    name: input.name,
    businessType: input.businessType,
    timezone: input.timezone,
    reminderEnabled: true,
    reminderHour: 18,
    publicMenuEnabled: false,
    publicMenuSlug: newSlug(),
    subscriptionStatus: 'trialing',
    trialEndsAt: owner.trialEndsAt,
    deletionScheduledAt: null,
    createdAt: input.now,
  };
  db.orgs.push(org);
  db.memberships.push({ orgId: org.id, userId: input.ownerId, role: 'owner', dailyReminder: true, createdAt: input.now });
  const tpl = TEMPLATES[input.businessType];
  for (const e of tpl.equipment) {
    db.equipment.push({
      id: uuid(),
      orgId: org.id,
      name: e.name,
      type: e.type,
      minTemp: e.minTemp,
      maxTemp: e.maxTemp,
      checksPerDay: e.checksPerDay,
      active: true,
      createdAt: input.now,
      history: [{ validFrom: input.now, checksPerDay: e.checksPerDay, active: true }],
    });
  }
  for (const p of tpl.cleaning) {
    db.plans.push({
      id: uuid(),
      orgId: org.id,
      name: p.name,
      frequency: p.frequency,
      weekday: p.weekday,
      monthDay: p.monthDay,
      items: p.items.map((i) => ({ id: uuid(), ...i })),
      active: true,
      createdAt: input.now,
      history: [{ validFrom: input.now, frequency: p.frequency, weekday: p.weekday, monthDay: p.monthDay, active: true }],
    });
  }
  return org;
}
