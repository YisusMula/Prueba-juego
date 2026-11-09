import type { DB } from '../db/index.js';
import { json } from '../db/index.js';

export type AuditEvent =
  | 'auth.register'
  | 'auth.email_verified'
  | 'auth.login'
  | 'auth.login_failed'
  | 'auth.logout'
  | 'auth.logout_all'
  | 'auth.password_reset_requested'
  | 'auth.password_reset'
  | 'auth.password_changed'
  | 'auth.email_change_requested'
  | 'auth.email_changed'
  | 'account.deleted'
  | 'org.created'
  | 'org.updated'
  | 'org.deleted'
  | 'org.exported'
  | 'member.invited'
  | 'member.invitation_revoked'
  | 'member.joined'
  | 'member.role_changed'
  | 'member.removed'
  | 'device.created'
  | 'device.revoked'
  | 'staff.pin_changed'
  | 'staff.pin_failed'
  | 'staff.pin_locked'
  | 'report.generated'
  | 'billing.checkout_started'
  | 'billing.subscription_updated'
  | 'public_menu.updated';

export interface AuditInput {
  event: AuditEvent;
  organizationId?: string | null;
  userId?: string | null;
  ip?: string | null;
  metadata?: Record<string, unknown>;
}

export async function audit(db: DB, input: AuditInput): Promise<void> {
  await db
    .insertInto('audit_events')
    .values({
      event: input.event,
      organization_id: input.organizationId ?? null,
      user_id: input.userId ?? null,
      ip: input.ip ?? null,
      metadata: json(input.metadata ?? {}),
    })
    .execute();
}
