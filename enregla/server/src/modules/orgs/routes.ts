import { Readable } from 'node:stream';
import type { FastifyInstance } from 'fastify';
import { sql } from 'kysely';
import * as S from '../../schemas/index.js';
import { parse } from '../../http/validation.js';
import { orgCtx, requireRole, requireUser, requireWritable } from '../../http/guards.js';
import { AppError } from '../../lib/errors.js';
import { enforce } from '../../lib/rate-limit.js';
import { verifySecret } from '../../lib/password.js';
import { audit } from '../../lib/audit.js';
import { randomToken } from '../../lib/crypto.js';
import { json } from '../../db/index.js';
import type { DB } from '../../db/index.js';
import { TEMPLATES } from './templates.js';
import { hasLiveStripeSubscription } from '../billing/status.js';
import { keysetAfter } from '../../lib/pagination.js';
import { orgView, recordView } from '../views.js';

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

  app.delete('/', async (req, reply) => {
    const ctx = requireRole(req, 'owner');
    const body = parse(S.passwordConfirmBody, req.body);
    await enforce(rateLimiter, `sensitive:user:${ctx.userId}`, config.rateLimits.sensitiveUser);
    const user = await db.selectFrom('users').select(['password_hash']).where('id', '=', ctx.userId).executeTakeFirstOrThrow();
    if (!(await verifySecret(user.password_hash, body.password))) {
      await audit(db, { event: 'auth.login_failed', userId: ctx.userId, ip: req.ip, metadata: { reason: 'reauth' } });
      throw new AppError(401, 'INVALID_CREDENTIALS', 'La contraseña no es correcta');
    }
    // Una suscripción viva en Stripe se cancela ANTES de borrar; si falla, no se borra nada.
    const org = await db.selectFrom('organizations').selectAll().where('id', '=', ctx.org.id).executeTakeFirstOrThrow();
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
    await db.deleteFrom('organizations').where('id', '=', ctx.org.id).execute();
    await audit(db, { event: 'org.deleted', organizationId: ctx.org.id, userId: ctx.userId, ip: req.ip, metadata: { name: ctx.org.name } });
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
    reply
      .type('application/json; charset=utf-8')
      .header('Content-Disposition', `attachment; filename="exportacion-${date}.json"`);
    return reply.send(Readable.from(generate()));
  });
}
