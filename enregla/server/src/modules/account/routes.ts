import type { FastifyInstance } from 'fastify';
import { sql } from 'kysely';
import * as S from '../../schemas/index.js';
import { parse } from '../../http/validation.js';
import { requireUser } from '../../http/guards.js';
import { AppError, badRequest, conflict } from '../../lib/errors.js';
import { enforce } from '../../lib/rate-limit.js';
import { checkPasswordPolicy, hashSecret, verifySecret } from '../../lib/password.js';
import { audit } from '../../lib/audit.js';
import { emails } from '../../lib/emails.js';
import { subscriptionView } from '../billing/status.js';
import { clearSessionCookie, deleteUserSessions } from '../auth/sessions.js';
import { createEmailToken } from '../auth/tokens.js';
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
    await db.updateTable('users').set({ password_hash: hash, updated_at: sql<Date>`now()` }).where('id', '=', user.id).execute();
    await deleteUserSessions(deps, user.id, auth.sessionId);
    await audit(db, { event: 'auth.password_changed', userId: user.id, ip: req.ip });
    app.sendMail(emails.passwordChanged(ctx, user.email));
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
    await audit(db, { event: 'auth.email_change_requested', userId: user.id, ip: req.ip });
    return reply.status(202).send({ message: 'Te hemos enviado un enlace de confirmación al nuevo email.' });
  });

  app.delete('/', async (req, reply) => {
    const auth = requireUser(req);
    const body = parse(S.passwordConfirmBody, req.body);
    const user = await checkPassword(auth.user.id, body.password, req.ip);
    // No se permite dejar locales sin propietario: hay que eliminarlos o transferirlos antes.
    const blocking = await db
      .selectFrom('memberships as m')
      .innerJoin('organizations as o', 'o.id', 'm.organization_id')
      .select(['o.id', 'o.name'])
      .where('m.user_id', '=', user.id)
      .where('m.role', '=', 'owner')
      .where(({ not, exists, selectFrom }) =>
        not(
          exists(
            selectFrom('memberships as m2')
              .select('m2.user_id')
              .whereRef('m2.organization_id', '=', 'm.organization_id')
              .where('m2.role', '=', 'owner')
              .where('m2.user_id', '!=', user.id),
          ),
        ),
      )
      .execute();
    if (blocking.length > 0) {
      throw conflict(
        `Eres el único propietario de: ${blocking.map((o) => o.name).join(', ')}. Elimina esos locales o nombra otro propietario antes de borrar tu cuenta.`,
      );
    }
    await db.deleteFrom('users').where('id', '=', user.id).execute();
    await audit(db, { event: 'account.deleted', userId: user.id, ip: req.ip });
    app.sendMail(emails.accountDeleted(ctx, user.email));
    clearSessionCookie(reply, deps);
    return reply.status(204).send();
  });
}
