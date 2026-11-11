import { Readable } from 'node:stream';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { sql } from 'kysely';
import * as S from '../../schemas/index.js';
import { parse } from '../../http/validation.js';
import { orgCtx, requireRole, requireUser, requireWritable } from '../../http/guards.js';
import { AppError, conflict, notFound } from '../../lib/errors.js';
import { emails, mailCtxFrom } from '../../lib/emails.js';
import { formatDateEs, localDate } from '../../lib/dates.js';
import { enforce } from '../../lib/rate-limit.js';
import { verifySecret } from '../../lib/password.js';
import { audit } from '../../lib/audit.js';
import { randomToken } from '../../lib/crypto.js';
import { json } from '../../db/index.js';
import type { DB } from '../../db/index.js';
import { TEMPLATES } from './templates.js';
import { hasLiveStripeSubscription } from '../billing/status.js';
import { BillingTeardownError, stopOrgBilling } from '../billing/teardown.js';
import { keysetAfter } from '../../lib/pagination.js';
import { orgView, recordView } from '../views.js';
import { guardSlowDownload } from '../../http/slow-download.js';

export function newItemId(): string {
  return crypto.randomUUID();
}

export async function createOrganization(
  db: DB,
  input: { name: string; businessType: S.CreateOrgBody['businessType']; timezone: string; ownerId: string; trialDays: number },
) {
  return db.transaction().execute(async (trx) => {
    // La prueba gratuita es UNA por cuenta: la primera organización fija la fecha en el
    // usuario (de forma atómica) y las siguientes heredan esa misma fecha. Si ya caducó,
    // el local nace en solo lectura (con la plantilla igualmente precargada).
    const owner = await trx
      .updateTable('users')
      .set({ trial_ends_at: sql<Date>`coalesce(trial_ends_at, now() + make_interval(days => ${input.trialDays}))` })
      .where('id', '=', input.ownerId)
      .returning('trial_ends_at')
      .executeTakeFirstOrThrow();
    const org = await trx
      .insertInto('organizations')
      .values({
        name: input.name,
        business_type: input.businessType,
        timezone: input.timezone,
        public_menu_slug: randomToken(16),
        trial_ends_at: owner.trial_ends_at!,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    await trx.insertInto('memberships').values({ organization_id: org.id, user_id: input.ownerId, role: 'owner' }).execute();
    const tpl = TEMPLATES[input.businessType];
    if (tpl.equipment.length > 0) {
      await trx
        .insertInto('equipment')
        .values(
          tpl.equipment.map((e) => ({
            organization_id: org.id,
            name: e.name,
            type: e.type,
            min_temp: e.minTemp,
            max_temp: e.maxTemp,
            checks_per_day: e.checksPerDay,
          })),
        )
        .execute();
    }
    for (const p of tpl.cleaning) {
      await trx
        .insertInto('cleaning_plans')
        .values({
          organization_id: org.id,
          name: p.name,
          frequency: p.frequency,
          weekday: p.weekday,
          month_day: p.monthDay,
          items: json(p.items.map((i) => ({ id: newItemId(), ...i }))),
        })
        .execute();
    }
    return org;
  });
}

/** /api/orgs (sin :orgId) */
export async function orgRootRoutes(app: FastifyInstance): Promise<void> {
  const { db, config } = app.deps;

  app.get('/', async (req) => {
    const auth = requireUser(req);
    const rows = await db
      .selectFrom('memberships as m')
      .innerJoin('organizations as o', 'o.id', 'm.organization_id')
      .selectAll('o')
      .select(['m.role'])
      .where('m.user_id', '=', auth.user.id)
      .orderBy('o.created_at')
      .limit(200)
      .execute();
    return { items: rows.map(({ role, ...o }) => orgView(o, role)) };
  });

  app.post('/', async (req, reply) => {
    const auth = requireUser(req);
    const body = parse(S.createOrgBody, req.body);
    const count = await db.selectFrom('memberships').select(sql<number>`count(*)::int`.as('n')).where('user_id', '=', auth.user.id).executeTakeFirstOrThrow();
    if (count.n >= 50) throw new AppError(409, 'CONFLICT', 'Has alcanzado el número máximo de locales por cuenta');
    const org = await createOrganization(db, { ...body, ownerId: auth.user.id, trialDays: config.trialDays });
    await audit(db, { event: 'org.created', organizationId: org.id, userId: auth.user.id, ip: req.ip, metadata: { businessType: body.businessType } });
    return reply.status(201).send({ organization: orgView(org, 'owner') });
  });
}

/** /api/orgs/:orgId (con contexto de organización cargado) */
export async function orgRoutes(app: FastifyInstance): Promise<void> {
  const { db, config, rateLimiter } = app.deps;
  const mailCtx = mailCtxFrom(config);

  app.get('/', async (req) => {
    const ctx = orgCtx(req);
    return { organization: orgView(ctx.org, ctx.role) };
  });

  app.patch('/', async (req) => {
    requireRole(req, 'owner');
    const ctx = requireWritable(req);
    const body = parse(S.updateOrgBody, req.body);
    const org = await db
      .updateTable('organizations')
      .set({
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.timezone !== undefined ? { timezone: body.timezone } : {}),
        ...(body.reminderEnabled !== undefined ? { reminder_enabled: body.reminderEnabled } : {}),
        ...(body.reminderHour !== undefined ? { reminder_hour: body.reminderHour } : {}),
        updated_at: sql<Date>`now()`,
      })
      .where('id', '=', ctx.org.id)
      .returningAll()
      .executeTakeFirstOrThrow();
    await audit(db, { event: 'org.updated', organizationId: org.id, userId: ctx.userId, ip: req.ip, metadata: { fields: Object.keys(body) } });
    return { organization: orgView(org, ctx.role) };
  });

  async function reauth(req: FastifyRequest, userId: string): Promise<void> {
    const body = parse(S.passwordConfirmBody, req.body);
    await enforce(rateLimiter, `sensitive:user:${userId}`, config.rateLimits.sensitiveUser);
    const user = await db.selectFrom('users').select(['password_hash']).where('id', '=', userId).executeTakeFirstOrThrow();
    if (!(await verifySecret(user.password_hash, body.password))) {
      await audit(db, { event: 'auth.login_failed', userId, ip: req.ip, metadata: { reason: 'reauth' } });
      throw new AppError(401, 'INVALID_CREDENTIALS', 'La contraseña no es correcta');
    }
  }

  /**
   * Eliminación DIFERIDA: el local queda "pendiente de eliminación" durante
   * ORG_DELETION_GRACE_DAYS (30) días en solo lectura, sin carta pública, con los dispositivos
   * de cocina revocados y sin recordatorios. Un owner puede restaurarlo; la tarea diaria lo purga
   * al vencer. Antes se cancela la suscripción de Stripe (si falla, no se hace nada).
   */
  app.delete('/', async (req, reply) => {
    const ctx = requireRole(req, 'owner');
    await reauth(req, ctx.userId);
    const org = await db.selectFrom('organizations').selectAll().where('id', '=', ctx.org.id).executeTakeFirstOrThrow();
    if (org.deletion_scheduled_at) throw conflict('Este local ya está pendiente de eliminación.');
    // Una suscripción viva en Stripe se cancela ANTES; si falla, no se marca nada.
    if (hasLiveStripeSubscription(org)) {
      const billing = app.deps.billing;
      if (!billing) {
        throw new AppError(503, 'BILLING_NOT_CONFIGURED', 'Este local tiene una suscripción activa y la facturación no está configurada en el servidor: no se puede cancelar, así que el local no se ha eliminado.');
      }
      try {
        await billing.cancelSubscription(org.stripe_subscription_id!);
      } catch (err) {
        req.log.error({ err: (err as Error).message }, 'Error cancelando la suscripción al eliminar el local');
        throw new AppError(502, 'BILLING_ERROR', 'No se ha podido cancelar la suscripción en Stripe, así que el local NO se ha eliminado. Inténtalo de nuevo en unos minutos.');
      }
      await audit(db, { event: 'billing.subscription_canceled', organizationId: ctx.org.id, userId: ctx.userId, ip: req.ip, metadata: { reason: 'org_deleted' } });
    }
    // M-1 (c): una sesión de Checkout abierta se expira: ya no se podrá completar el pago y crear
    // una suscripción para un local que se va a borrar. Si falla, no se marca nada.
    if (org.stripe_checkout_session_id && app.deps.billing) {
      try {
        await app.deps.billing.expireCheckoutSession(org.stripe_checkout_session_id);
      } catch (err) {
        req.log.error({ err: (err as Error).message }, 'Error expirando la sesión de Checkout al eliminar el local');
        throw new AppError(502, 'BILLING_ERROR', 'No se ha podido anular el pago pendiente en Stripe, así que el local NO se ha eliminado. Inténtalo de nuevo en unos minutos.');
      }
    }
    const graceDays = config.orgDeletionGraceDays;
    const queued = await db.transaction().execute(async (trx) => {
      const updated = await trx
        .updateTable('organizations')
        .set({
          deletion_requested_at: sql<Date>`now()`,
          deletion_scheduled_at: sql<Date>`now() + make_interval(days => ${graceDays})`,
          deletion_requested_by: ctx.userId,
          // La cancelación ya está hecha en Stripe; el webhook lo confirmará.
          ...(hasLiveStripeSubscription(org) ? { subscription_status: 'canceled', cancel_at_period_end: false } : {}),
          stripe_checkout_session_id: null,
          updated_at: sql<Date>`now()`,
        })
        .where('id', '=', ctx.org.id)
        .returning(['deletion_scheduled_at', 'name', 'timezone'])
        .executeTakeFirstOrThrow();
      // B-1: las invitaciones pendientes se anulan (nadie puede unirse a un local que se va a borrar).
      const invitationsRevoked = await trx
        .updateTable('invitations')
        .set({ revoked_at: sql<Date>`now()` })
        .where('organization_id', '=', ctx.org.id)
        .where('accepted_at', 'is', null)
        .where('revoked_at', 'is', null)
        .returning('id')
        .execute();
      const revoked = await trx
        .updateTable('devices')
        .set({ revoked_at: sql<Date>`now()` })
        .where('organization_id', '=', ctx.org.id)
        .where('revoked_at', 'is', null)
        .returning('id')
        .execute();
      await audit(trx, {
        event: 'org.deletion_scheduled',
        organizationId: ctx.org.id,
        userId: ctx.userId,
        ip: req.ip,
        metadata: { scheduledFor: updated.deletion_scheduled_at!.toISOString(), devicesRevoked: revoked.length, invitationsRevoked: invitationsRevoked.length },
      });
      const owners = await trx
        .selectFrom('memberships as m')
        .innerJoin('users as u', 'u.id', 'm.user_id')
        .select('u.email')
        .where('m.organization_id', '=', ctx.org.id)
        .where('m.role', '=', 'owner')
        .execute();
      const deleteOn = formatDateEs(localDate(updated.deletion_scheduled_at!, updated.timezone));
      const ids: string[] = [];
      for (const o of owners) ids.push(await app.queueMail(trx, emails.orgDeletionScheduled(mailCtx, o.email, updated.name, ctx.org.id, deleteOn)));
      return ids;
    });
    app.deliverEmails(queued);
    return reply.status(204).send();
  });

  /** Restaura un local pendiente de eliminación (no reactiva la suscripción cancelada ni los dispositivos). */
  app.post('/restore', async (req) => {
    const ctx = requireRole(req, 'owner');
    if (!ctx.org.deletion_scheduled_at) throw conflict('Este local no está pendiente de eliminación.');
    // B-6: la purga diaria (o una eliminación inmediata) puede haberlo borrado mientras tanto.
    // Solo se restaura lo que de verdad sigue pendiente; nunca un 500.
    const org = await db
      .updateTable('organizations')
      .set({ deletion_requested_at: null, deletion_scheduled_at: null, deletion_requested_by: null, updated_at: sql<Date>`now()` })
      .where('id', '=', ctx.org.id)
      .where('deletion_scheduled_at', 'is not', null)
      .returningAll()
      .executeTakeFirst();
    if (!org) {
      const still = await db.selectFrom('organizations').select('id').where('id', '=', ctx.org.id).executeTakeFirst();
      if (!still) throw notFound('Local');
      throw conflict('Este local no está pendiente de eliminación.');
    }
    await audit(db, { event: 'org.restored', organizationId: ctx.org.id, userId: ctx.userId, ip: req.ip });
    return { organization: orgView(org, ctx.role) };
  });

  /**
   * Eliminación inmediata y definitiva (derecho de supresión). Solo para un local que YA está
   * pendiente de eliminación, y con reautenticación.
   */
  app.delete('/permanent', async (req, reply) => {
    const ctx = requireRole(req, 'owner');
    await reauth(req, ctx.userId);
    if (!ctx.org.deletion_scheduled_at) {
      throw conflict('Primero solicita la eliminación del local; la eliminación inmediata solo está disponible para locales pendientes de eliminación.');
    }
    // M-1 (a): nada en Stripe puede seguir cobrando. Si no se puede cancelar, NO se borra.
    try {
      const stopped = await stopOrgBilling(app.deps.billing, ctx.org);
      if (stopped.subscriptionCanceled) {
        await audit(db, {
          event: 'billing.subscription_canceled',
          organizationId: ctx.org.id,
          userId: ctx.userId,
          ip: req.ip,
          metadata: { reason: 'org_deleted_permanently', subscriptionId: stopped.subscriptionCanceled },
        });
      }
    } catch (err) {
      req.log.error({ err: (err as Error).message }, 'Error cancelando en Stripe antes de la eliminación definitiva');
      if (err instanceof BillingTeardownError && err.notConfigured) {
        throw new AppError(503, 'BILLING_NOT_CONFIGURED', 'Este local tiene una suscripción activa y la facturación no está configurada en el servidor: no se puede cancelar, así que el local no se ha eliminado.');
      }
      throw new AppError(502, 'BILLING_ERROR', 'No se ha podido cancelar la suscripción en Stripe, así que el local NO se ha eliminado. Inténtalo de nuevo en unos minutos.');
    }
    const del = await db.deleteFrom('organizations').where('id', '=', ctx.org.id).where('deletion_scheduled_at', 'is not', null).executeTakeFirst();
    if (Number(del.numDeletedRows) === 0) {
      const still = await db.selectFrom('organizations').select('id').where('id', '=', ctx.org.id).executeTakeFirst();
      if (still) throw conflict('Este local ya no está pendiente de eliminación.');
      throw notFound('Local');
    }
    await audit(db, { event: 'org.deleted', organizationId: ctx.org.id, userId: ctx.userId, ip: req.ip, metadata: { name: ctx.org.name, reason: 'permanent_request' } });
    return reply.status(204).send();
  });

  app.patch('/membership', async (req) => {
    const ctx = orgCtx(req);
    const body = parse(S.membershipPrefsBody, req.body);
    await db
      .updateTable('memberships')
      .set({ daily_reminder: body.dailyReminder })
      .where('organization_id', '=', ctx.org.id)
      .where('user_id', '=', ctx.userId)
      .execute();
    return { dailyReminder: body.dailyReminder };
  });

  app.get('/membership', async (req) => {
    const ctx = orgCtx(req);
    const m = await db
      .selectFrom('memberships')
      .select(['role', 'daily_reminder'])
      .where('organization_id', '=', ctx.org.id)
      .where('user_id', '=', ctx.userId)
      .executeTakeFirstOrThrow();
    return { role: m.role, dailyReminder: m.daily_reminder };
  });

  // Exportación RGPD completa (JSON en streaming).
  app.get('/export', async (req, reply) => {
    const ctx = requireRole(req, 'owner');
    const msg = 'Has alcanzado el máximo de exportaciones por hora. Inténtalo más tarde.';
    await enforce(rateLimiter, `export:org:${ctx.org.id}`, config.rateLimits.orgExport, msg);
    await enforce(rateLimiter, `export:user:${ctx.userId}`, config.rateLimits.orgExport, msg);
    await audit(db, { event: 'org.exported', organizationId: ctx.org.id, userId: ctx.userId, ip: req.ip });
    const orgId = ctx.org.id;
    async function* generate(): AsyncGenerator<string> {
      const o = ctx.org;
      yield `{"exportedAt":${JSON.stringify(new Date().toISOString())},"organization":${JSON.stringify({
        id: o.id,
        name: o.name,
        businessType: o.business_type,
        timezone: o.timezone,
        reminderEnabled: o.reminder_enabled,
        reminderHour: o.reminder_hour,
        publicMenuEnabled: o.public_menu_enabled,
        subscriptionStatus: o.subscription_status,
        trialEndsAt: o.trial_ends_at,
        plan: o.plan,
        createdAt: o.created_at,
      })}`;
      const members = await db
        .selectFrom('memberships as m')
        .innerJoin('users as u', 'u.id', 'm.user_id')
        .select(['u.id', 'u.name', 'u.email', 'm.role', 'm.created_at'])
        .where('m.organization_id', '=', orgId)
        .execute();
      yield `,"members":${JSON.stringify(members)}`;
      const staff = await db.selectFrom('staff').select(['id', 'name', 'active', 'created_at']).where('organization_id', '=', orgId).execute();
      yield `,"staff":${JSON.stringify(staff)}`;
      const devices = await db
        .selectFrom('devices')
        .select(['id', 'name', 'created_at', 'last_used_at', 'revoked_at'])
        .where('organization_id', '=', orgId)
        .execute();
      yield `,"devices":${JSON.stringify(devices)}`;
      const equipment = await db.selectFrom('equipment').selectAll().where('organization_id', '=', orgId).execute();
      yield `,"equipment":${JSON.stringify(equipment)}`;
      const plans = await db.selectFrom('cleaning_plans').selectAll().where('organization_id', '=', orgId).execute();
      yield `,"cleaningPlans":${JSON.stringify(plans)}`;
      const suppliers = await db.selectFrom('suppliers').selectAll().where('organization_id', '=', orgId).execute();
      yield `,"suppliers":${JSON.stringify(suppliers)}`;
      const dishes = await db.selectFrom('dishes').selectAll().where('organization_id', '=', orgId).execute();
      yield `,"dishes":${JSON.stringify(dishes)}`;
      // Registros por lotes para no cargarlos todos en memoria.
      yield `,"records":[`;
      let first = true;
      let after: string | null = null;
      for (;;) {
        let q = db.selectFrom('records as r').selectAll('r').where('r.organization_id', '=', orgId);
        if (after) q = q.where(keysetAfter({ table: 'records', alias: 'r', cursor: after, orgId, direction: 'asc' }));
        const batch = await q.orderBy('r.created_at').orderBy('r.id').limit(1000).execute();
        for (const r of batch) {
          yield (first ? '' : ',') + JSON.stringify(recordView(r));
          first = false;
        }
        if (batch.length < 1000) break;
        after = batch[batch.length - 1]!.id;
      }
      yield ']';
      const auditRows = await db
        .selectFrom('audit_events')
        .select(['id', 'event', 'user_id', 'ip', 'metadata', 'created_at'])
        .where('organization_id', '=', orgId)
        .orderBy('id')
        .limit(50_000)
        .execute();
      yield `,"auditEvents":${JSON.stringify(auditRows)}}`;
    }
    const date = new Date().toISOString().slice(0, 10);
    guardSlowDownload(reply);
    reply
      .type('application/json; charset=utf-8')
      .header('Content-Disposition', `attachment; filename="exportacion-${date}.json"`);
    return reply.send(Readable.from(generate()));
  });
}
