import type { FastifyInstance } from 'fastify';
import { sql } from 'kysely';
import * as S from '../../schemas/index.js';
import { idParam, parse } from '../../http/validation.js';
import { orgCtx, requireRole, requireUser, requireWritable } from '../../http/guards.js';
import { conflict, forbidden, invalidToken, notFound } from '../../lib/errors.js';
import { enforce } from '../../lib/rate-limit.js';
import { audit } from '../../lib/audit.js';
import { emails, mailCtxFrom } from '../../lib/emails.js';
import { isWellFormedToken, randomToken, sha256 } from '../../lib/crypto.js';
import type { DB } from '../../db/index.js';

const INVITATION_TTL_MS = 7 * 24 * 3600 * 1000;

/**
 * Bloquea (FOR UPDATE, orden fijo) las filas de propietarios del local dentro de la
 * transacción y devuelve sus ids. Serializa salidas, expulsiones, cambios de rol y bajas
 * de cuenta para que nunca quede un local sin propietario.
 */
export async function lockOwners(trx: DB, orgId: string): Promise<string[]> {
  const rows = await trx
    .selectFrom('memberships')
    .select('user_id')
    .where('organization_id', '=', orgId)
    .where('role', '=', 'owner')
    .orderBy('user_id')
    .forUpdate()
    .execute();
  return rows.map((r) => r.user_id);
}

/** Revoca los dispositivos de cocina que creó un miembro al salir del local (misma transacción). */
export async function revokeDevicesOf(trx: DB, orgId: string, userId: string, actorId: string | null, ip: string | null, reason: string): Promise<string[]> {
  const rows = await trx
    .updateTable('devices')
    .set({ revoked_at: sql<Date>`now()` })
    .where('organization_id', '=', orgId)
    .where('created_by', '=', userId)
    .where('revoked_at', 'is', null)
    .returning('id')
    .execute();
  for (const r of rows) {
    await audit(trx, { event: 'device.revoked_with_member', organizationId: orgId, userId: actorId, ip, metadata: { deviceId: r.id, createdBy: userId, reason } });
  }
  return rows.map((r) => r.id);
}

function invitationView(i: { id: string; email: string; role: string; expires_at: Date; created_at: Date }) {
  return { id: i.id, email: i.email, role: i.role, expiresAt: i.expires_at.toISOString(), createdAt: i.created_at.toISOString() };
}

/** Rutas bajo /api/orgs/:orgId */
export async function memberRoutes(app: FastifyInstance): Promise<void> {
  const { db, config, rateLimiter } = app.deps;
  const ctxMail = mailCtxFrom(config);

  app.get('/members', async (req) => {
    const ctx = orgCtx(req);
    const rows = await db
      .selectFrom('memberships as m')
      .innerJoin('users as u', 'u.id', 'm.user_id')
      .select(['u.id', 'u.name', 'u.email', 'm.role', 'm.created_at'])
      .where('m.organization_id', '=', ctx.org.id)
      .orderBy('m.created_at')
      .limit(200)
      .execute();
    return {
      items: rows.map((r) => ({ userId: r.id, name: r.name, email: r.email, role: r.role, joinedAt: r.created_at.toISOString() })),
      nextCursor: null,
    };
  });

  app.patch('/members/:userId', async (req) => {
    requireRole(req, 'owner');
    const ctx = requireWritable(req);
    const userId = idParam(req.params, 'userId', 'Miembro');
    const body = parse(S.updateMemberBody, req.body);
    await db.transaction().execute(async (trx) => {
      const owners = await lockOwners(trx, ctx.org.id);
      const member = await trx
        .selectFrom('memberships')
        .select(['role'])
        .where('organization_id', '=', ctx.org.id)
        .where('user_id', '=', userId)
        .executeTakeFirst();
      if (!member) throw notFound('Miembro');
      if (member.role === 'owner' && body.role !== 'owner' && owners.filter((o) => o !== userId).length === 0) {
        throw conflict('El local debe tener al menos un propietario');
      }
      await trx.updateTable('memberships').set({ role: body.role }).where('organization_id', '=', ctx.org.id).where('user_id', '=', userId).execute();
      await audit(trx, { event: 'member.role_changed', organizationId: ctx.org.id, userId: ctx.userId, ip: req.ip, metadata: { target: userId, from: member.role, to: body.role } });
    });
    return { userId, role: body.role };
  });

  app.delete('/members/:userId', async (req, reply) => {
    const ctx = orgCtx(req);
    const userId = idParam(req.params, 'userId', 'Miembro');
    if (userId !== ctx.userId && ctx.role !== 'owner') throw forbidden('Solo el propietario puede quitar a otros miembros');
    await db.transaction().execute(async (trx) => {
      const owners = await lockOwners(trx, ctx.org.id);
      const member = await trx
        .selectFrom('memberships')
        .select(['role'])
        .where('organization_id', '=', ctx.org.id)
        .where('user_id', '=', userId)
        .executeTakeFirst();
      if (!member) throw notFound('Miembro');
      if (member.role === 'owner' && owners.filter((o) => o !== userId).length === 0) {
        throw conflict('El local debe tener al menos un propietario. Nombra otro propietario o elimina el local.');
      }
      await trx.deleteFrom('memberships').where('organization_id', '=', ctx.org.id).where('user_id', '=', userId).execute();
      // Los tokens de kiosko que creó dejan de funcionar con su salida.
      await revokeDevicesOf(trx, ctx.org.id, userId, ctx.userId, req.ip, userId === ctx.userId ? 'member_left' : 'member_removed');
      await audit(trx, { event: 'member.removed', organizationId: ctx.org.id, userId: ctx.userId, ip: req.ip, metadata: { target: userId } });
    });
    return reply.status(204).send();
  });

  app.get('/invitations', async (req) => {
    const ctx = requireRole(req, 'owner');
    const rows = await db
      .selectFrom('invitations')
      .select(['id', 'email', 'role', 'expires_at', 'created_at'])
      .where('organization_id', '=', ctx.org.id)
      .where('accepted_at', 'is', null)
      .where('revoked_at', 'is', null)
      .where('expires_at', '>', sql<Date>`now()`)
      .orderBy('created_at')
      .limit(200)
      .execute();
    return { items: rows.map(invitationView), nextCursor: null };
  });

  app.post('/invitations', async (req, reply) => {
    requireRole(req, 'owner');
    const ctx = requireWritable(req);
    const body = parse(S.inviteBody, req.body);
    const already = await db
      .selectFrom('memberships as m')
      .innerJoin('users as u', 'u.id', 'm.user_id')
      .select('u.id')
      .where('m.organization_id', '=', ctx.org.id)
      .where('u.email', '=', body.email)
      .executeTakeFirst();
    if (already) throw conflict('Esa persona ya es miembro del local');
    const pending = await db
      .selectFrom('invitations')
      .select(sql<number>`count(*)::int`.as('n'))
      .where('organization_id', '=', ctx.org.id)
      .where('accepted_at', 'is', null)
      .where('revoked_at', 'is', null)
      .where('expires_at', '>', sql<Date>`now()`)
      .executeTakeFirstOrThrow();
    if (pending.n >= 50) throw conflict('Hay demasiadas invitaciones pendientes');
    // Anti-spam: mismo destinatario por local, total por local y total por usuario (ventana de 24 h).
    const limitMsg = 'Has alcanzado el límite de invitaciones por hoy. Inténtalo mañana.';
    await enforce(rateLimiter, `invite:org:${ctx.org.id}:to:${body.email}`, config.rateLimits.inviteRecipient, 'Ya has enviado varias invitaciones a este email hoy. Inténtalo mañana.');
    await enforce(rateLimiter, `invite:org:${ctx.org.id}`, config.rateLimits.inviteOrg, limitMsg);
    await enforce(rateLimiter, `invite:user:${ctx.userId}`, config.rateLimits.inviteUser, limitMsg);
    const token = randomToken();
    const inviter = requireUser(req).user.name;
    let mailId = '';
    const inv = await db.transaction().execute(async (trx) => {
      await trx
        .updateTable('invitations')
        .set({ revoked_at: sql<Date>`now()` })
        .where('organization_id', '=', ctx.org.id)
        .where('email', '=', body.email)
        .where('accepted_at', 'is', null)
        .where('revoked_at', 'is', null)
        .execute();
      const created = await trx
        .insertInto('invitations')
        .values({
          organization_id: ctx.org.id,
          email: body.email,
          role: body.role,
          token_hash: sha256(token),
          invited_by: ctx.userId,
          expires_at: new Date(Date.now() + INVITATION_TTL_MS),
        })
        .returning(['id', 'email', 'role', 'expires_at', 'created_at'])
        .executeTakeFirstOrThrow();
      // El email se encola en la misma transacción que la invitación (o ambos o ninguno).
      mailId = await app.queueMail(trx, emails.invitation(ctxMail, body.email, ctx.org.name, inviter, body.role, token));
      return created;
    });
    app.deliverEmails([mailId]);
    await audit(db, { event: 'member.invited', organizationId: ctx.org.id, userId: ctx.userId, ip: req.ip, metadata: { email: body.email, role: body.role } });
    return reply.status(201).send({ invitation: invitationView(inv) });
  });

  app.delete('/invitations/:invitationId', async (req, reply) => {
    const ctx = requireRole(req, 'owner');
    const id = idParam(req.params, 'invitationId', 'Invitación');
    const r = await db
      .updateTable('invitations')
      .set({ revoked_at: sql<Date>`now()` })
      .where('id', '=', id)
      .where('organization_id', '=', ctx.org.id)
      .where('accepted_at', 'is', null)
      .where('revoked_at', 'is', null)
      .executeTakeFirst();
    if (Number(r.numUpdatedRows) === 0) throw notFound('Invitación');
    await audit(db, { event: 'member.invitation_revoked', organizationId: ctx.org.id, userId: ctx.userId, ip: req.ip, metadata: { invitationId: id } });
    return reply.status(204).send();
  });
}

/** Rutas bajo /api/invitations (el invitado aún no es miembro). */
export async function invitationPublicRoutes(app: FastifyInstance): Promise<void> {
  const { db, config, rateLimiter } = app.deps;

  async function findValid(token: string) {
    if (!isWellFormedToken(token)) return null;
    return db
      .selectFrom('invitations as i')
      .innerJoin('organizations as o', 'o.id', 'i.organization_id')
      .leftJoin('users as u', 'u.id', 'i.invited_by')
      .select(['i.id', 'i.email', 'i.role', 'i.organization_id', 'o.name as org_name', 'u.name as inviter_name', 'i.expires_at'])
      .where('i.token_hash', '=', sha256(token))
      .where('i.accepted_at', 'is', null)
      .where('i.revoked_at', 'is', null)
      .where('i.expires_at', '>', sql<Date>`now()`)
      .executeTakeFirst();
  }

  app.post('/preview', async (req) => {
    await enforce(rateLimiter, `token:ip:${req.ip}`, config.rateLimits.tokenIp);
    const { token } = parse(S.tokenBody, req.body);
    const inv = await findValid(token);
    if (!inv) throw invalidToken();
    return {
      invitation: {
        organizationName: inv.org_name,
        email: inv.email,
        role: inv.role,
        invitedBy: inv.inviter_name,
        expiresAt: inv.expires_at.toISOString(),
      },
    };
  });

  app.post('/accept', async (req) => {
    const auth = requireUser(req);
    await enforce(rateLimiter, `token:ip:${req.ip}`, config.rateLimits.tokenIp);
    const { token } = parse(S.tokenBody, req.body);
    const inv = await findValid(token);
    if (!inv) throw invalidToken();
    if (inv.email !== auth.user.email.toLowerCase()) {
      throw forbidden('Esta invitación es para otro email. Inicia sesión con la cuenta correspondiente.');
    }
    const accepted = await db.transaction().execute(async (trx) => {
      const r = await trx
        .updateTable('invitations')
        .set({ accepted_at: sql<Date>`now()` })
        .where('id', '=', inv.id)
        .where('accepted_at', 'is', null)
        .where('revoked_at', 'is', null)
        .executeTakeFirst();
      if (Number(r.numUpdatedRows) === 0) return false;
      await trx
        .insertInto('memberships')
        .values({ organization_id: inv.organization_id, user_id: auth.user.id, role: inv.role })
        .onConflict((oc) => oc.columns(['organization_id', 'user_id']).doNothing())
        .execute();
      return true;
    });
    if (!accepted) throw invalidToken();
    await audit(db, { event: 'member.joined', organizationId: inv.organization_id, userId: auth.user.id, ip: req.ip, metadata: { role: inv.role } });
    const m = await db
      .selectFrom('memberships')
      .select('role')
      .where('organization_id', '=', inv.organization_id)
      .where('user_id', '=', auth.user.id)
      .executeTakeFirstOrThrow();
    return { organizationId: inv.organization_id, role: m.role };
  });
}
