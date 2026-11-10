import type { FastifyInstance } from 'fastify';
import { sql } from 'kysely';
import * as S from '../../schemas/index.js';
import { parse } from '../../http/validation.js';
import { requireUser } from '../../http/guards.js';
import { AppError, badRequest, conflict } from '../../lib/errors.js';
import { enforce } from '../../lib/rate-limit.js';
import { checkPasswordPolicy, hashSecret, verifySecret } from '../../lib/password.js';
import { audit, pseudonymizeUserAudit } from '../../lib/audit.js';
import { emails } from '../../lib/emails.js';
import { subscriptionView } from '../billing/status.js';
import { clearSessionCookie, deleteUserSessions } from '../auth/sessions.js';
import { createEmailToken, invalidateUserTokens } from '../auth/tokens.js';
import { policyError, userView } from '../auth/routes.js';

export async function accountRoutes(app: FastifyInstance): Promise<void> {
  const deps = app.deps;
  const { config, db, rateLimiter } = deps;
  const ctx = { appName: config.appName, appOrigin: config.appOrigin };

  async function checkPassword(userId: string, password: string, ip: string): Promise<{ id: string; email: string; name: string }> {
    await enforce(rateLimiter, `sensitive:user:${userId}`, config.rateLimits.sensitiveUser);
    const user = await db.selectFrom('users').select(['id', 'email', 'name', 'password_hash']).where('id', '=', userId).executeTakeFirstOrThrow();
    if (!(await verifySecret(user.password_hash, password))) {
      await audit(db, { event: 'auth.login_failed', userId, ip, metadata: { reason: 'reauth' } });
      throw new AppError(401, 'INVALID_CREDENTIALS', 'La contraseña no es correcta');
    }
    return user;
  }

  app.get('/', async (req) => {
    const auth = requireUser(req);
    const user = await db.selectFrom('users').select(['id', 'email', 'name', 'email_verified_at', 'created_at']).where('id', '=', auth.user.id).executeTakeFirstOrThrow();
    const orgs = await db
      .selectFrom('memberships as m')
      .innerJoin('organizations as o', 'o.id', 'm.organization_id')
      .selectAll('o')
      .select(['m.role', 'm.daily_reminder'])
      .where('m.user_id', '=', auth.user.id)
      .orderBy('o.created_at')
      .limit(200)
      .execute();
    return {
      user: userView(user),
      organizations: orgs.map((o) => ({
        id: o.id,
        name: o.name,
        businessType: o.business_type,
        role: o.role,
        subscription: subscriptionView(o),
        deletionScheduledAt: o.deletion_scheduled_at?.toISOString() ?? null,
      })),
    };
  });

  app.patch('/', async (req) => {
    const auth = requireUser(req);
    const body = parse(S.updateAccountBody, req.body);
    const user = await db
      .updateTable('users')
      .set({ name: body.name, updated_at: sql<Date>`now()` })
      .where('id', '=', auth.user.id)
      .returning(['id', 'email', 'name', 'email_verified_at', 'created_at'])
      .executeTakeFirstOrThrow();
    return { user: userView(user) };
  });

  app.post('/password', async (req, reply) => {
    const auth = requireUser(req);
    const body = parse(S.changePasswordBody, req.body);
    const user = await checkPassword(auth.user.id, body.currentPassword, req.ip);
    const policy = checkPasswordPolicy(body.newPassword, { email: user.email, name: user.name });
    if (policy) throw policyError(policy);
    if (body.newPassword === body.currentPassword) throw policyError('La nueva contraseña debe ser distinta de la actual');
    const hash = await hashSecret(body.newPassword);
    const mailId = await db.transaction().execute(async (trx) => {
      await trx.updateTable('users').set({ password_hash: hash, updated_at: sql<Date>`now()` }).where('id', '=', user.id).execute();
      // Anula cambios de email y restablecimientos pendientes (pudo pedirlos quien conocía la contraseña antigua).
      await invalidateUserTokens(trx, user.id);
      return app.queueMail(trx, emails.passwordChanged(ctx, user.email));
    });
    await deleteUserSessions(deps, user.id, auth.sessionId);
    await audit(db, { event: 'auth.password_changed', userId: user.id, ip: req.ip });
    app.deliverEmails([mailId]);
    return reply.status(204).send();
  });

  app.post('/email', async (req, reply) => {
    const auth = requireUser(req);
    const body = parse(S.changeEmailBody, req.body);
    const user = await checkPassword(auth.user.id, body.password, req.ip);
    if (body.newEmail === user.email) throw badRequest('El nuevo email es igual al actual');
    const taken = await db.selectFrom('users').select('id').where('email', '=', body.newEmail).executeTakeFirst();
    // Si el email ya está en uso no se envía nada, pero la respuesta es idéntica.
    if (!taken) {
      const token = await createEmailToken(deps, user.id, 'email_change', body.newEmail);
      app.sendMail(emails.emailChange(ctx, body.newEmail, token));
    }
    // Aviso al email actual: si no ha sido el titular, puede cambiar la contraseña (lo que anula la solicitud).
    app.sendMail(emails.emailChangeRequested(ctx, user.email, body.newEmail));
    await audit(db, { event: 'auth.email_change_requested', userId: user.id, ip: req.ip });
    return reply.status(202).send({ message: 'Te hemos enviado un enlace de confirmación al nuevo email.' });
  });

  app.delete('/', async (req, reply) => {
    const auth = requireUser(req);
    const body = parse(S.passwordConfirmBody, req.body);
    const user = await checkPassword(auth.user.id, body.password, req.ip);
    // No se permite dejar locales sin propietario. Se bloquean (FOR UPDATE) las filas de
    // propietarios de todos sus locales, en orden fijo, para que dos bajas simultáneas
    // (o una baja y una salida) no dejen un local sin owner. La cuenta nunca arrastra
    // locales: si es el único propietario, hay que eliminarlos o transferirlos antes.
    await db.transaction().execute(async (trx) => {
      // Los locales ya pendientes de eliminación no bloquean: se purgarán en su fecha.
      const mine = await trx
        .selectFrom('memberships as m')
        .innerJoin('organizations as o', 'o.id', 'm.organization_id')
        .select('m.organization_id')
        .where('m.user_id', '=', user.id)
        .where('m.role', '=', 'owner')
        .where('o.deletion_scheduled_at', 'is', null)
        .execute();
      const orgIds = mine.map((m) => m.organization_id);
      if (orgIds.length > 0) {
        const owners = await trx
          .selectFrom('memberships')
          .select(['organization_id', 'user_id'])
          .where('organization_id', 'in', orgIds)
          .where('role', '=', 'owner')
          .orderBy('organization_id')
          .orderBy('user_id')
          .forUpdate()
          .execute();
        const blockingIds = orgIds.filter((id) => !owners.some((o) => o.organization_id === id && o.user_id !== user.id));
        if (blockingIds.length > 0) {
          const names = await trx.selectFrom('organizations').select('name').where('id', 'in', blockingIds).orderBy('name').execute();
          throw conflict(
            `Eres el único propietario de: ${names.map((o) => o.name).join(', ')}. Elimina esos locales o nombra otro propietario antes de borrar tu cuenta.`,
          );
        }
      }
      // Sus tokens de kiosko dejan de funcionar con su salida.
      const revoked = await trx
        .updateTable('devices')
        .set({ revoked_at: sql<Date>`now()` })
        .where('created_by', '=', user.id)
        .where('revoked_at', 'is', null)
        .returning(['id', 'organization_id'])
        .execute();
      for (const d of revoked) {
        await audit(trx, { event: 'device.revoked_with_member', organizationId: d.organization_id, metadata: { deviceId: d.id, reason: 'account_deleted' } });
      }
      await trx.deleteFrom('users').where('id', '=', user.id).execute();
      await pseudonymizeUserAudit(trx, user.id, user.email);
      await audit(trx, { event: 'account.deleted', userId: user.id });
    });
    app.sendMail(emails.accountDeleted(ctx, user.email));
    clearSessionCookie(reply, deps);
    return reply.status(204).send();
  });
}
