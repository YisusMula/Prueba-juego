import { sql } from 'kysely';
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
  | 'org.deletion_scheduled'
  | 'org.restored'
  | 'org.exported'
  | 'member.invited'
  | 'member.invitation_revoked'
  | 'member.joined'
  | 'member.role_changed'
  | 'member.removed'
  | 'device.created'
  | 'device.revoked'
  | 'device.kiosk_exit'
  | 'org.purge_requested'
  | 'device.kiosk_auth_failed'
  | 'device.revoked_with_member'
  | 'staff.pin_changed'
  | 'staff.pin_failed'
  | 'staff.pin_locked'
  | 'staff.pin_unlocked'
  | 'report.generated'
  | 'billing.checkout_started'
  | 'billing.subscription_updated'
  | 'billing.subscription_canceled'
  | 'public_menu.updated'
  | 'report.verified'
  | 'custom_template.created'
  | 'custom_template.updated';

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

/**
 * Al borrar una cuenta, sus eventos de auditoría se conservan (el id de usuario es un
 * identificador aleatorio que ya no apunta a nadie) pero se les quita la IP y los emails.
 * También se quita su email de eventos de terceros (p. ej. la invitación que recibió).
 */
export async function pseudonymizeUserAudit(db: DB, userId: string, email: string): Promise<void> {
  // Función acotada del propietario (0007): el rol de la app no puede editar la auditoría directamente.
  await sql`SELECT enregla_pseudonymize_audit(${userId}::uuid, ${email}::text)`.execute(db);
}
