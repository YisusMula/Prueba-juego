import type { FastifyInstance, FastifyRequest } from 'fastify';
import { sql } from 'kysely';
import * as S from '../../schemas/index.js';
import { parse } from '../../http/validation.js';
import { deviceCtx } from '../../http/guards.js';
import { AppError, notFound, rateLimited, readOnly } from '../../lib/errors.js';
import { enforce } from '../../lib/rate-limit.js';
import { verifySecret } from '../../lib/password.js';
import { audit } from '../../lib/audit.js';
import { sha256 } from '../../lib/crypto.js';
import { isWritable } from '../billing/status.js';
import { computeToday } from '../tasks/service.js';
import { createRecord } from '../records/service.js';
import { recordView } from '../views.js';
import { idempotencyKey, withIdempotency } from '../records/idempotency.js';

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
    return computeToday(db, ctx.org, app.deps.now());
  });

  const lockedError = (retrySeconds: number) =>
    new AppError(429, 'PIN_LOCKED', 'PIN bloqueado temporalmente por demasiados intentos fallidos. Pide a un encargado que lo desbloquee o espera unos minutos.', undefined, {
      'Retry-After': String(Math.max(1, retrySeconds)),
    });

  /**
   * Verificación de PIN con reserva atómica del intento ANTES de verificar:
   *  1. Reserva en el dispositivo (límite de PIN erróneos por dispositivo, todas las personas).
   *  2. Reserva en la persona: UPDATE condicional que incrementa el contador solo si no está
   *     bloqueada; la reserva que alcanza el máximo fija ya el bloqueo. Así, por muchas
   *     peticiones simultáneas que lleguen, nunca se verifican más de `pinMaxFailures` PIN
   *     por ventana.
   *  3. Si el PIN es correcto se devuelven ambas reservas (contador a 0, sin bloqueo).
   */
  async function verifyPinWithReservation(ctx: { org: { id: string }; deviceId: string }, staffId: string, pinHash: string, pin: string, ip: string): Promise<void> {
    const deviceKey = `pin-fail:device:${ctx.deviceId}`;
    const dev = await rateLimiter.hit(deviceKey, config.rateLimits.pinFailDevice);
    if (!dev.allowed) {
      await rateLimiter.release(deviceKey);
      throw rateLimited(dev.retryAfterSeconds, 'Demasiados PIN incorrectos en este dispositivo. Espera unos minutos.');
    }
    const max = config.pinMaxFailures;
    const lockSecs = config.pinLockMinutes * 60;
    const expired = sql<boolean>`(pin_locked_until IS NOT NULL AND pin_locked_until <= now())`;
    const next = sql<number>`(CASE WHEN ${expired} THEN 1 ELSE pin_failed_count + 1 END)`;
    const reserved = await db
      .updateTable('staff')
      .set({
        pin_failed_count: next,
        pin_locked_until: sql<Date | null>`CASE WHEN ${next} >= ${max} THEN now() + make_interval(secs => ${lockSecs}) WHEN ${expired} THEN NULL ELSE pin_locked_until END`,
      })
      .where('id', '=', staffId)
      .where(sql<boolean>`(pin_locked_until IS NULL OR pin_locked_until <= now())`)
      .returning(['pin_failed_count'])
      .executeTakeFirst();
    if (!reserved) {
      await rateLimiter.release(deviceKey);
      const st = await db.selectFrom('staff').select('pin_locked_until').where('id', '=', staffId).executeTakeFirst();
      throw lockedError(st?.pin_locked_until ? Math.ceil((st.pin_locked_until.getTime() - Date.now()) / 1000) : lockSecs);
    }
    const ok = /^\d{4,6}$/.test(pin) && (await verifySecret(pinHash, pin));
    if (ok) {
      await db.updateTable('staff').set({ pin_failed_count: 0, pin_locked_until: null }).where('id', '=', staffId).execute();
      await rateLimiter.release(deviceKey);
      return;
    }
    await audit(db, { event: 'staff.pin_failed', organizationId: ctx.org.id, ip, metadata: { staffId, deviceId: ctx.deviceId } });
    if (reserved.pin_failed_count >= max) {
      await audit(db, { event: 'staff.pin_locked', organizationId: ctx.org.id, ip, metadata: { staffId, deviceId: ctx.deviceId } });
      throw lockedError(lockSecs);
    }
    throw new AppError(401, 'INVALID_PIN', 'PIN incorrecto');
  }

  /**
   * Comprobación del PIN al identificarse (antes de registrar): mismos contadores atómicos de
   * fallos, bloqueo y límites por dispositivo que el alta de registros. El alta sigue exigiendo
   * y verificando el PIN (la tablet lo guarda solo en memoria).
   */
  app.post('/verify-pin', async (req) => {
    const ctx = deviceCtx(req);
    const body = parse(S.kioskVerifyPinBody, req.body);
    const staff = await db
      .selectFrom('staff')
      .selectAll()
      .where('id', '=', body.staffId)
      .where('organization_id', '=', ctx.org.id)
      .executeTakeFirst();
    if (!staff) throw notFound('Miembro del personal');
    if (!staff.active) throw new AppError(400, 'VALIDATION_ERROR', 'Ese miembro del personal está desactivado', [{ path: 'staffId', message: 'Ese miembro del personal está desactivado' }]);
    if (staff.pin_hash) {
      if (!body.pin) throw new AppError(401, 'PIN_REQUIRED', 'Introduce tu PIN');
      await enforce(rateLimiter, `pin:device:${ctx.deviceId}`, config.rateLimits.pinDevice);
      await verifyPinWithReservation(ctx, staff.id, staff.pin_hash, body.pin, req.ip);
    }
    return { staff: { id: staff.id, name: staff.name, hasPin: staff.pin_hash != null } };
  });

  app.post('/records', async (req, reply) => {
    const ctx = deviceCtx(req);
    if (!isWritable(ctx.org)) throw readOnly();
    const body = parse(S.kioskRecordBody, req.body);
    const key = idempotencyKey(req);
    const staff = await db
      .selectFrom('staff')
      .selectAll()
      .where('id', '=', body.staffId)
      .where('organization_id', '=', ctx.org.id)
      .executeTakeFirst();
    if (!staff) throw notFound('Miembro del personal');
    if (!staff.active) throw new AppError(400, 'VALIDATION_ERROR', 'Ese miembro del personal está desactivado', [{ path: 'staffId', message: 'Ese miembro del personal está desactivado' }]);

    if (staff.pin_hash) {
      if (!body.pin) throw new AppError(401, 'PIN_REQUIRED', 'Introduce tu PIN');
      await enforce(rateLimiter, `pin:device:${ctx.deviceId}`, config.rateLimits.pinDevice);
      await verifyPinWithReservation(ctx, staff.id, staff.pin_hash, body.pin, req.ip);
    }

    await enforce(rateLimiter, `records:device:${ctx.deviceId}`, config.rateLimits.recordCreateDevice, 'Demasiados registros seguidos desde este dispositivo. Espera un minuto.');
    // El PIN no forma parte de la huella: un reintento con el mismo registro es la misma petición.
    const { pin: _pin, ...payload } = body;
    const { record, replayed } = await withIdempotency(db, { orgId: ctx.org.id, key, scope: 'kiosk', payload }, (tx) =>
      createRecord(tx, ctx.org, { userId: null, userName: null, staffId: staff.id, deviceId: ctx.deviceId }, body.type, body.data, undefined, { now: app.deps.now() }),
    );
    if (replayed) reply.header('Idempotent-Replayed', 'true');
    return reply.status(replayed ? 200 : 201).send({ record: recordView(record) });
  });
}
