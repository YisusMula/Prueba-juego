import type { FastifyInstance, FastifyRequest } from 'fastify';
import { sql } from 'kysely';
import * as S from '../../schemas/index.js';
import { parse } from '../../http/validation.js';
import { deviceCtx } from '../../http/guards.js';
import { AppError, notFound, readOnly } from '../../lib/errors.js';
import { enforce } from '../../lib/rate-limit.js';
import { verifySecret } from '../../lib/password.js';
import { audit } from '../../lib/audit.js';
import { sha256 } from '../../lib/crypto.js';
import { isWritable } from '../billing/status.js';
import { computeToday } from '../tasks/service.js';
import { createRecord } from '../records/service.js';
import { recordView } from '../views.js';

const TOKEN_RE = /^kd_[A-Za-z0-9_-]{43}$/;

/**
 * API del modo cocina. Autenticación: `Authorization: Bearer <token del dispositivo>`.
 * Mínimo privilegio: solo lectura del contexto necesario y alta de registros.
 */
export async function kioskRoutes(app: FastifyInstance): Promise<void> {
  const { db, config, rateLimiter } = app.deps;

  app.addHook('onRequest', async (req: FastifyRequest) => {
    const header = req.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    const unauthorized = new AppError(401, 'UNAUTHENTICATED', 'Dispositivo de cocina no autorizado o revocado');
    if (!TOKEN_RE.test(token)) {
      await enforce(rateLimiter, `kiosk-bad:ip:${req.ip}`, config.rateLimits.tokenIp);
      throw unauthorized;
    }
    const row = await db
      .selectFrom('devices as d')
      .innerJoin('organizations as o', 'o.id', 'd.organization_id')
      .selectAll('o')
      .select(['d.id as device_id', 'd.name as device_name', 'd.last_used_at'])
      .where('d.token_hash', '=', sha256(token))
      .where('d.revoked_at', 'is', null)
      .executeTakeFirst();
    if (!row) {
      await enforce(rateLimiter, `kiosk-bad:ip:${req.ip}`, config.rateLimits.tokenIp);
      throw unauthorized;
    }
    const { device_id, device_name, last_used_at, ...org } = row;
    await enforce(rateLimiter, `kiosk:device:${device_id}`, config.rateLimits.kioskDevice);
    if (!last_used_at || Date.now() - last_used_at.getTime() > 60_000) {
      await db.updateTable('devices').set({ last_used_at: sql<Date>`now()` }).where('id', '=', device_id).execute();
    }
    req.deviceCtx = { deviceId: device_id, deviceName: device_name, org };
  });

  app.get('/context', async (req) => {
    const ctx = deviceCtx(req);
    const orgId = ctx.org.id;
    const [staff, equipment, plans, suppliers] = await Promise.all([
      db.selectFrom('staff').select(['id', 'name', 'pin_hash']).where('organization_id', '=', orgId).where('active', '=', true).orderBy('name').limit(500).execute(),
      db.selectFrom('equipment').selectAll().where('organization_id', '=', orgId).where('active', '=', true).orderBy('created_at').limit(500).execute(),
      db.selectFrom('cleaning_plans').selectAll().where('organization_id', '=', orgId).where('active', '=', true).orderBy('created_at').limit(500).execute(),
      db.selectFrom('suppliers').select(['id', 'name', 'products']).where('organization_id', '=', orgId).orderBy('name').limit(500).execute(),
    ]);
    return {
      device: { id: ctx.deviceId, name: ctx.deviceName },
      organization: { id: orgId, name: ctx.org.name, timezone: ctx.org.timezone, readOnly: !isWritable(ctx.org) },
      staff: staff.map((s) => ({ id: s.id, name: s.name, hasPin: s.pin_hash != null })),
      equipment: equipment.map((e) => ({ id: e.id, name: e.name, type: e.type, minTemp: e.min_temp, maxTemp: e.max_temp, checksPerDay: e.checks_per_day })),
      cleaningPlans: plans.map((p) => ({ id: p.id, name: p.name, frequency: p.frequency, weekday: p.weekday, monthDay: p.month_day, items: p.items })),
      suppliers: suppliers.map((s) => ({ id: s.id, name: s.name, products: s.products })),
    };
  });

  app.get('/tasks/today', async (req) => {
    const ctx = deviceCtx(req);
    return computeToday(db, ctx.org);
  });

  app.post('/records', async (req, reply) => {
    const ctx = deviceCtx(req);
    if (!isWritable(ctx.org)) throw readOnly();
    const body = parse(S.kioskRecordBody, req.body);
    const staff = await db
      .selectFrom('staff')
      .selectAll()
      .where('id', '=', body.staffId)
      .where('organization_id', '=', ctx.org.id)
      .executeTakeFirst();
    if (!staff) throw notFound('Miembro del personal');
    if (!staff.active) throw new AppError(400, 'VALIDATION_ERROR', 'Ese miembro del personal está desactivado', [{ path: 'staffId', message: 'Desactivado' }]);

    if (staff.pin_hash) {
      if (staff.pin_locked_until && staff.pin_locked_until.getTime() > Date.now()) {
        const retry = Math.ceil((staff.pin_locked_until.getTime() - Date.now()) / 1000);
        throw new AppError(429, 'PIN_LOCKED', 'PIN bloqueado temporalmente por demasiados intentos fallidos. Pide a un encargado que lo desbloquee o espera unos minutos.', undefined, {
          'Retry-After': String(retry),
        });
      }
      if (!body.pin) throw new AppError(401, 'PIN_REQUIRED', 'Introduce tu PIN');
      await enforce(rateLimiter, `pin:device:${ctx.deviceId}`, config.rateLimits.pinDevice);
      const ok = /^\d{4,6}$/.test(body.pin) && (await verifySecret(staff.pin_hash, body.pin));
      if (!ok) {
        const upd = await db
          .updateTable('staff')
          .set({ pin_failed_count: sql<number>`pin_failed_count + 1` })
          .where('id', '=', staff.id)
          .returning(['pin_failed_count'])
          .executeTakeFirstOrThrow();
        await audit(db, { event: 'staff.pin_failed', organizationId: ctx.org.id, ip: req.ip, metadata: { staffId: staff.id, deviceId: ctx.deviceId } });
        if (upd.pin_failed_count >= config.pinMaxFailures) {
          await db
            .updateTable('staff')
            .set({ pin_failed_count: 0, pin_locked_until: new Date(Date.now() + config.pinLockMinutes * 60_000) })
            .where('id', '=', staff.id)
            .execute();
          await audit(db, { event: 'staff.pin_locked', organizationId: ctx.org.id, ip: req.ip, metadata: { staffId: staff.id, deviceId: ctx.deviceId } });
          throw new AppError(429, 'PIN_LOCKED', 'PIN bloqueado temporalmente por demasiados intentos fallidos. Pide a un encargado que lo desbloquee o espera unos minutos.', undefined, {
            'Retry-After': String(config.pinLockMinutes * 60),
          });
        }
        throw new AppError(401, 'INVALID_PIN', 'PIN incorrecto');
      }
      if (staff.pin_failed_count > 0) {
        await db.updateTable('staff').set({ pin_failed_count: 0, pin_locked_until: null }).where('id', '=', staff.id).execute();
      }
    }

    const row = await createRecord(db, ctx.org, { userId: null, userName: null, staffId: staff.id, deviceId: ctx.deviceId }, body.type, body.data);
    return reply.status(201).send({ record: recordView(row) });
  });
}
