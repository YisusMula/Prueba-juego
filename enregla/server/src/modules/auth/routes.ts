import type { FastifyInstance } from 'fastify';
import { sql } from 'kysely';
import * as S from '../../schemas/index.js';
import { parse } from '../../http/validation.js';
import { requireUser } from '../../http/guards.js';
import { AppError, invalidToken, conflict } from '../../lib/errors.js';
import { enforce } from '../../lib/rate-limit.js';
import { checkPasswordPolicy, getDummyHash, hashSecret, verifySecret } from '../../lib/password.js';
import { audit } from '../../lib/audit.js';
import { emails } from '../../lib/emails.js';
import { clearSessionCookie, createSession, deleteUserSessions, setSessionCookie } from './sessions.js';
import { consumeEmailToken, createEmailToken, peekEmailToken } from './tokens.js';

export function userView(u: { id: string; email: string; name: string; email_verified_at: Date | null; created_at?: Date }) {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    emailVerified: u.email_verified_at != null,
    ...(u.created_at ? { createdAt: u.created_at.toISOString() } : {}),
  };
}

export function policyError(message: string): AppError {
  return new AppError(400, 'VALIDATION_ERROR', message, [{ path: 'password', message }]);
}

export async function authRoutes(app: FastifyInstance): Promise<void> {
  const deps = app.deps;
  const { config, db, rateLimiter } = deps;
  const ctx = { appName: config.appName, appOrigin: config.appOrigin };

  const ACCEPTED = { message: 'Si los datos son correctos, recibirás un email en unos minutos.' };

  app.post('/register', async (req, reply) => {
    await enforce(rateLimiter, `register:ip:${req.ip}`, config.rateLimits.registerIp);
    const body = parse(S.registerBody, req.body);
    const policy = checkPasswordPolicy(body.password, { email: body.email, name: body.name });
    if (policy) throw policyError(policy);
    // Se calcula siempre el hash para que el tiempo de respuesta no revele si el email existe.
    const passwordHash = await hashSecret(body.password);
    const existing = await db.selectFrom('users').select(['id', 'email_verified_at']).where('email', '=', body.email).executeTakeFirst();
    if (existing?.email_verified_at) {
      app.sendMail(emails.alreadyRegistered(ctx, body.email));
    } else {
      let userId: string;
      if (existing) {
        // Cuenta sin verificar: nadie ha podido usarla todavía. Se reemplazan los datos
        // para que un registro previo malicioso no bloquee al dueño real del email.
        await db.updateTable('users').set({ password_hash: passwordHash, name: body.name, updated_at: sql<Date>`now()` }).where('id', '=', existing.id).execute();
        userId = existing.id;
      } else {
        const inserted = await db
          .insertInto('users')
          .values({ email: body.email, password_hash: passwordHash, name: body.name })
          .onConflict((oc) => oc.column('email').doNothing())
          .returning('id')
          .executeTakeFirst();
        if (!inserted) return reply.status(202).send(ACCEPTED);
        userId = inserted.id;
        await audit(db, { event: 'auth.register', userId, ip: req.ip });
      }
      const token = await createEmailToken(deps, userId, 'verify_email');
      app.sendMail(emails.verifyEmail(ctx, body.email, body.name, token));
    }
    return reply.status(202).send(ACCEPTED);
  });

  app.post('/verify-email', async (req) => {
    await enforce(rateLimiter, `token:ip:${req.ip}`, config.rateLimits.tokenIp);
    const { token } = parse(S.tokenBody, req.body);
    const row = await consumeEmailToken(deps, token, 'verify_email');
    if (!row) throw invalidToken();
    await db.updateTable('users').set({ email_verified_at: sql<Date>`coalesce(email_verified_at, now())` }).where('id', '=', row.user_id).execute();
    await audit(db, { event: 'auth.email_verified', userId: row.user_id, ip: req.ip });
    return { message: 'Email confirmado. Ya puedes iniciar sesión.' };
  });

  app.post('/resend-verification', async (req, reply) => {
    await enforce(rateLimiter, `register:ip:${req.ip}`, config.rateLimits.registerIp);
    const { email } = parse(S.emailBody, req.body);
    await enforce(rateLimiter, `reset:acct:${email}`, config.rateLimits.passwordResetAccount);
    const user = await db.selectFrom('users').select(['id', 'name', 'email_verified_at']).where('email', '=', email).executeTakeFirst();
    if (user && !user.email_verified_at) {
      const token = await createEmailToken(deps, user.id, 'verify_email');
      app.sendMail(emails.verifyEmail(ctx, email, user.name, token));
    }
    return reply.status(202).send(ACCEPTED);
  });

  app.post('/login', async (req, reply) => {
    await enforce(rateLimiter, `login:ip:${req.ip}`, config.rateLimits.loginIp);
    const body = parse(S.loginBody, req.body);
    await enforce(rateLimiter, `login:acct:${body.email}`, config.rateLimits.loginAccount);
    const user = await db.selectFrom('users').selectAll().where('email', '=', body.email).executeTakeFirst();
    const ok = await verifySecret(user?.password_hash ?? (await getDummyHash()), body.password);
    if (!user || !ok) {
      await audit(db, { event: 'auth.login_failed', userId: user?.id ?? null, ip: req.ip, metadata: { reason: 'credentials' } });
      throw new AppError(401, 'INVALID_CREDENTIALS', 'Email o contraseña incorrectos');
    }
    if (!user.email_verified_at) {
      const token = await createEmailToken(deps, user.id, 'verify_email');
      app.sendMail(emails.verifyEmail(ctx, user.email, user.name, token));
      throw new AppError(403, 'EMAIL_NOT_VERIFIED', 'Debes confirmar tu email antes de iniciar sesión. Te hemos enviado un nuevo enlace.');
    }
    // Rotación: cualquier sesión previa presentada en esta petición se descarta.
    if (req.auth) await db.deleteFrom('sessions').where('id', '=', req.auth.sessionId).execute();
    const token = await createSession(deps, user.id, req);
    setSessionCookie(reply, deps, token);
    await rateLimiter.reset(`login:acct:${body.email}`);
    await audit(db, { event: 'auth.login', userId: user.id, ip: req.ip });
    return { user: userView(user) };
  });

  app.post('/logout', async (req, reply) => {
    if (req.auth) {
      await db.deleteFrom('sessions').where('id', '=', req.auth.sessionId).execute();
      await audit(db, { event: 'auth.logout', userId: req.auth.user.id, ip: req.ip });
    }
    clearSessionCookie(reply, deps);
    return reply.status(204).send();
  });

  app.post('/logout-all', async (req, reply) => {
    const auth = requireUser(req);
    await deleteUserSessions(deps, auth.user.id);
    await audit(db, { event: 'auth.logout_all', userId: auth.user.id, ip: req.ip });
    clearSessionCookie(reply, deps);
    return reply.status(204).send();
  });

  app.post('/password-reset/request', async (req, reply) => {
    await enforce(rateLimiter, `reset:ip:${req.ip}`, config.rateLimits.passwordResetIp);
    const { email } = parse(S.emailBody, req.body);
    const acct = await rateLimiter.hit(`reset:acct:${email}`, config.rateLimits.passwordResetAccount);
    // Por cuenta: se responde igual (202) para no revelar nada, simplemente no se envía más.
    if (acct.allowed) {
      const user = await db.selectFrom('users').select(['id']).where('email', '=', email).executeTakeFirst();
      if (user) {
        const token = await createEmailToken(deps, user.id, 'password_reset');
        app.sendMail(emails.passwordReset(ctx, email, token));
        await audit(db, { event: 'auth.password_reset_requested', userId: user.id, ip: req.ip });
      }
    }
    return reply.status(202).send(ACCEPTED);
  });

  app.post('/password-reset/confirm', async (req) => {
    await enforce(rateLimiter, `token:ip:${req.ip}`, config.rateLimits.tokenIp);
    const body = parse(S.passwordResetConfirmBody, req.body);
    const peek = await peekEmailToken(deps, body.token, 'password_reset');
    if (!peek) throw invalidToken();
    const user = await db.selectFrom('users').select(['id', 'email', 'name']).where('id', '=', peek.user_id).executeTakeFirstOrThrow();
    const policy = checkPasswordPolicy(body.password, { email: user.email, name: user.name });
    if (policy) throw policyError(policy);
    const passwordHash = await hashSecret(body.password);
    const row = await consumeEmailToken(deps, body.token, 'password_reset');
    if (!row) throw invalidToken();
    await db
      .updateTable('users')
      .set({ password_hash: passwordHash, email_verified_at: sql<Date>`coalesce(email_verified_at, now())`, updated_at: sql<Date>`now()` })
      .where('id', '=', user.id)
      .execute();
    await deleteUserSessions(deps, user.id);
    await audit(db, { event: 'auth.password_reset', userId: user.id, ip: req.ip });
    app.sendMail(emails.passwordChanged(ctx, user.email));
    return { message: 'Contraseña actualizada. Ya puedes iniciar sesión.' };
  });

  app.post('/email-change/confirm', async (req) => {
    await enforce(rateLimiter, `token:ip:${req.ip}`, config.rateLimits.tokenIp);
    const { token } = parse(S.tokenBody, req.body);
    const peek = await peekEmailToken(deps, token, 'email_change');
    if (!peek?.new_email) throw invalidToken();
    const taken = await db.selectFrom('users').select('id').where('email', '=', peek.new_email).executeTakeFirst();
    if (taken) throw conflict('Ese email ya está en uso por otra cuenta');
    const row = await consumeEmailToken(deps, token, 'email_change');
    if (!row?.new_email) throw invalidToken();
    const old = await db.selectFrom('users').select(['email']).where('id', '=', row.user_id).executeTakeFirstOrThrow();
    try {
      await db
        .updateTable('users')
        .set({ email: row.new_email, email_verified_at: sql<Date>`now()`, updated_at: sql<Date>`now()` })
        .where('id', '=', row.user_id)
        .execute();
    } catch (err) {
      if ((err as { code?: string }).code === '23505') throw conflict('Ese email ya está en uso por otra cuenta');
      throw err;
    }
    await audit(db, { event: 'auth.email_changed', userId: row.user_id, ip: req.ip, metadata: { from: old.email, to: row.new_email } });
    app.sendMail(emails.emailChangedNotice(ctx, old.email, row.new_email));
    return { message: 'Email actualizado.' };
  });
}
