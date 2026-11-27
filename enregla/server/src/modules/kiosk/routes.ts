import type { FastifyInstance, FastifyRequest } from 'fastify';
import { sql } from 'kysely';
import * as S from '../../schemas/index.js';
import { parse } from '../../http/validation.js';
import { deviceCtx } from '../../http/guards.js';
import { AppError, conflict, notFound, rateLimited, readOnly } from '../../lib/errors.js';
import { enforce } from '../../lib/rate-limit.js';
import { getDummyHash, verifySecret } from '../../lib/password.js';
import { audit } from '../../lib/audit.js';
import { sha256 } from '../../lib/crypto.js';
import { isWritable } from '../billing/status.js';
import { computeToday } from '../tasks/service.js';
import { createRecord } from '../records/service.js';
import { recordView } from '../views.js';
import { idempotencyKey, withIdempotency } from '../records/idempotency.js';

/** R7: duración de los bloqueos sucesivos de un PIN (el último, hasta config.pinLockMinutes). */
export const PIN_LOCK_STEPS_SECONDS = [60, 300] as const;

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
      db.selectFrom('suppliers').select(['id', 'name', 'products', 'default_category', 'reception_limit']).where('organization_id', '=', orgId).orderBy('name').limit(500).execute(),
    ]);
    return {
      device: { id: ctx.deviceId, name: ctx.deviceName },
      organization: { id: orgId, name: ctx.org.name, timezone: ctx.org.timezone, readOnly: !isWritable(ctx.org) },
      staff: staff.map((s) => ({ id: s.id, name: s.name, hasPin: s.pin_hash != null })),
      equipment: equipment.map((e) => ({ id: e.id, name: e.name, type: e.type, minTemp: e.min_temp, maxTemp: e.max_temp, checksPerDay: e.checks_per_day })),
      cleaningPlans: plans.map((p) => ({ id: p.id, name: p.name, frequency: p.frequency, weekday: p.weekday, monthDay: p.month_day, items: p.items })),
      suppliers: suppliers.map((s) => ({ id: s.id, name: s.name, products: s.products, defaultCategory: s.default_category ?? null, receptionLimit: s.reception_limit ?? null })),
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
    // N5: superado el tope de fallos de la tablet, un PIN correcto sigue entrando (no se penaliza a
    // quien acierta); uno erróneo responde 429 y cuenta igualmente para el bloqueo de esa persona
    // (5 fallos), que es el límite real contra quien prueba PIN.
    const deviceOverLimit = !dev.allowed;
    if (deviceOverLimit) await rateLimiter.release(deviceKey);
    const max = config.pinMaxFailures;
    const lockSecs = config.pinLockMinutes * 60;
    // R7: bloqueo PROGRESIVO (1 min, luego 5, luego pinLockMinutes) mientras nadie acierte: quien
    // teclee mal a propósito ya no deja a un compañero 15 min sin poder firmar a la primera.
    const [s1, s2] = PIN_LOCK_STEPS_SECONDS;
    const lockFor = sql<number>`(CASE WHEN pin_lock_level <= 0 THEN ${Math.min(s1!, lockSecs)}::int WHEN pin_lock_level = 1 THEN ${Math.min(s2!, lockSecs)}::int ELSE ${lockSecs}::int END)`;
    const expired = sql<boolean>`(pin_locked_until IS NOT NULL AND pin_locked_until <= now())`;
    const next = sql<number>`(CASE WHEN ${expired} THEN 1 ELSE pin_failed_count + 1 END)`;
    const reserved = await db
      .updateTable('staff')
      .set({
        pin_failed_count: next,
        pin_locked_until: sql<Date | null>`CASE WHEN ${next} >= ${max} THEN now() + make_interval(secs => ${lockFor}) WHEN ${expired} THEN NULL ELSE pin_locked_until END`,
        pin_lock_level: sql<number>`CASE WHEN ${next} >= ${max} THEN pin_lock_level + 1 ELSE pin_lock_level END`,
      })
      .where('id', '=', staffId)
      .where(sql<boolean>`(pin_locked_until IS NULL OR pin_locked_until <= now())`)
      .returning(['pin_failed_count', 'pin_locked_until'])
      .executeTakeFirst();
    if (!reserved) {
      if (!deviceOverLimit) await rateLimiter.release(deviceKey);
      const st = await db.selectFrom('staff').select('pin_locked_until').where('id', '=', staffId).executeTakeFirst();
      throw lockedError(st?.pin_locked_until ? Math.ceil((st.pin_locked_until.getTime() - Date.now()) / 1000) : lockSecs);
    }
    const ok = /^\d{4,6}$/.test(pin) && (await verifySecret(pinHash, pin));
    if (ok) {
      await db.updateTable('staff').set({ pin_failed_count: 0, pin_locked_until: null, pin_lock_level: 0 }).where('id', '=', staffId).execute();
      if (!deviceOverLimit) await rateLimiter.release(deviceKey);
      return;
    }
    await audit(db, { event: 'staff.pin_failed', organizationId: ctx.org.id, ip, metadata: { staffId, deviceId: ctx.deviceId } });
    if (deviceOverLimit && reserved.pin_failed_count < max) throw rateLimited(dev.retryAfterSeconds, 'Demasiados PIN incorrectos en este dispositivo. Espera unos minutos.');
    if (reserved.pin_failed_count >= max) {
      const secs = reserved.pin_locked_until ? Math.max(1, Math.ceil((reserved.pin_locked_until.getTime() - Date.now()) / 1000)) : lockSecs;
      await audit(db, { event: 'staff.pin_locked', organizationId: ctx.org.id, ip, metadata: { staffId, deviceId: ctx.deviceId, lockSeconds: secs } });
      throw lockedError(secs);
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

  const notAllowed = (msg: string) => new AppError(403, 'CORRECTION_NOT_ALLOWED', msg);

  /** Comprueba (si lo tiene) el PIN de un miembro activo del personal del local. */
  async function checkStaffPin(ctx: { org: { id: string }; deviceId: string }, staffId: string, pin: string | null | undefined, ip: string, path = 'staffId') {
    const st = await db.selectFrom('staff').selectAll().where('id', '=', staffId).where('organization_id', '=', ctx.org.id).executeTakeFirst();
    if (!st) throw notFound('Miembro del personal');
    if (!st.active) throw new AppError(400, 'VALIDATION_ERROR', 'Ese miembro del personal está desactivado', [{ path, message: 'Ese miembro del personal está desactivado' }]);
    // Con «Me equivoqué de persona» hay dos PIN: los errores del segundo se marcan con `newStaffPin`.
    const pinPath = path === 'staffId' ? 'pin' : 'newStaffPin';
    if (st.pin_hash) {
      if (!pin) {
        const msg = path === 'staffId' ? 'Introduce tu PIN' : `Introduce el PIN de ${st.name}`;
        throw new AppError(401, 'PIN_REQUIRED', msg, [{ path: pinPath, message: msg }]);
      }
      try {
        await verifyPinWithReservation(ctx, st.id, st.pin_hash, pin, ip);
      } catch (err) {
        if (err instanceof AppError && err.code === 'INVALID_PIN') throw new AppError(401, 'INVALID_PIN', err.message, [{ path: pinPath, message: err.message }]);
        throw err;
      }
    }
    return st;
  }

  /**
   * 1.5: corregir desde la tablet el registro RECIÉN hecho (2 minutos + 30 s de margen). Nunca borra:
   * crea una corrección (enmienda) enlazada. Solo el mismo dispositivo y la misma persona (con su
   * PIN si lo tiene); un registro de otro local responde 404. Con «Me equivoqué de persona» la
   * persona correcta se identifica con su propio PIN.
   */
  app.post('/records/:recordId/amendments', async (req, reply) => {
    const ctx = deviceCtx(req);
    if (!isWritable(ctx.org)) throw readOnly();
    const id = (req.params as { recordId?: string }).recordId ?? '';
    if (!S.uuid.safeParse(id).success) throw notFound('Registro');
    const body = parse(S.kioskAmendmentBody, req.body);
    const key = idempotencyKey(req);
    await enforce(rateLimiter, `kiosk-correction:device:${ctx.deviceId}`, config.rateLimits.kioskCorrectionDevice, 'Demasiadas correcciones seguidas desde esta tablet. Espera unos minutos.');
    const original = await db.selectFrom('records').selectAll().where('id', '=', id).where('organization_id', '=', ctx.org.id).executeTakeFirst();
    if (!original) throw notFound('Registro');
    if (original.device_id !== ctx.deviceId || original.user_id != null) throw notAllowed('Solo se puede corregir desde la tablet en la que se hizo el registro. Pide a un encargado que lo corrija desde la web.');
    if (original.amends_record_id != null) throw notAllowed('Esta corrección ya no se puede cambiar desde la tablet. Pide a un encargado que la corrija desde la web.');
    if (original.staff_id !== body.staffId) throw notAllowed('Solo puede corregirlo la persona que hizo el registro.');
    // La persona que hizo el registro confirma con su PIN (si lo tiene) y, al cambiar de persona,
    // la persona correcta con el suyo.
    await checkStaffPin(ctx, body.staffId, body.pin, req.ip);
    const signerId = body.reason === 'wrong_person' ? body.newStaffId! : body.staffId;
    if (body.reason === 'wrong_person') await checkStaffPin(ctx, signerId, body.newStaffPin, req.ip, 'newStaffId');
    await enforce(rateLimiter, `records:device:${ctx.deviceId}`, config.rateLimits.recordCreateDevice, 'Demasiados registros seguidos desde este dispositivo. Espera un minuto.');
    const reason = S.kioskAmendmentReason(body, original.staff_name);
    const { pin: _p, newStaffPin: _np, ...payload } = body;
    // El plazo y «ya corregido» se comprueban DENTRO de la idempotencia: un reintento de una corrección
    // ya guardada (misma clave y cuerpo) devuelve 200 con ella aunque ya haya corrección o pasado el plazo.
    const windowMs = (S.KIOSK_CORRECTION_MINUTES * 60 + S.KIOSK_CORRECTION_GRACE_SECONDS) * 1000;
    const { record, replayed } = await withIdempotency(db, { orgId: ctx.org.id, key, scope: `kiosk-amendment:${id}`, payload }, async (tx) => {
      if (app.deps.now().getTime() - original.created_at.getTime() > windowMs) {
        throw notAllowed(`Solo se puede corregir en la tablet durante los ${S.KIOSK_CORRECTION_MINUTES} minutos siguientes a guardarlo. Pide a un encargado que lo corrija desde la web.`);
      }
      const already = await tx.selectFrom('records').select('id').where('amends_record_id', '=', original.id).executeTakeFirst();
      if (already) throw conflict('Este registro ya tiene una corrección.');
      return createRecord(
        tx,
        ctx.org,
        { userId: null, userName: null, staffId: signerId, deviceId: ctx.deviceId },
        null,
        // Sin datos nuevos (p. ej. solo cambia la persona) se reutilizan los del original.
        body.data === undefined ? original.data : body.data,
        { originalId: original.id, reason },
        { now: app.deps.now() },
      );
    });
    if (replayed) reply.header('Idempotent-Replayed', 'true');
    return reply.status(replayed ? 200 : 201).send({ record: recordView(record) });
  });

  /**
   * 1.10: salir del modo cocina o desvincular la tablet exige el email y la contraseña de un
   * propietario o encargado de ESTE local, verificados aquí (nunca un secreto guardado en la
   * tablet), con límite de intentos por dispositivo y por cuenta.
   */
  async function managerAuth(req: FastifyRequest) {
    const ctx = deviceCtx(req);
    const body = parse(S.kioskManagerAuthBody, req.body);
    const email = body.email.toLowerCase();
    // Límites que cuentan solo FALLOS (un acierto devuelve su reserva): por cuenta y tablet (10 / 15 min),
    // así que quien pruebe contraseñas con otros emails no bloquea al encargado; y por tablet, más alto
    // (30 / 15 min), contra quien pruebe muchos emails. El techo de login por cuenta también se aplica.
    const acctKey = `kiosk-manager:acct-device:${email}:${ctx.deviceId}`;
    const devKey = `kiosk-manager:device:${ctx.deviceId}`;
    const tooMany = (retry: number) => rateLimited(retry, 'Demasiados intentos fallidos en esta tablet. Espera unos minutos o hazlo desde la web (Ajustes → Dispositivos de cocina).');
    const acct = await rateLimiter.hit(acctKey, config.rateLimits.kioskManagerAuthAccountDevice);
    if (!acct.allowed) {
      await rateLimiter.release(acctKey);
      throw tooMany(acct.retryAfterSeconds);
    }
    const dev = await rateLimiter.hit(devKey, config.rateLimits.kioskManagerAuthDevice);
    if (!dev.allowed) {
      await rateLimiter.release(devKey);
      await rateLimiter.release(acctKey);
      throw tooMany(dev.retryAfterSeconds);
    }
    await enforce(rateLimiter, `login:acct:${email}`, config.rateLimits.loginAccount);
    const user = await db
      .selectFrom('users as u')
      .innerJoin('memberships as m', (j) => j.onRef('m.user_id', '=', 'u.id').on('m.organization_id', '=', ctx.org.id))
      .select(['u.id', 'u.name', 'u.password_hash', 'u.email_verified_at', 'm.role'])
      .where('u.email', '=', email)
      .executeTakeFirst();
    // Mismo coste con y sin cuenta (hash ficticio) y mismo mensaje: no revela qué emails existen.
    const ok = await verifySecret(user?.password_hash ?? (await getDummyHash()), body.password);
    if (!user || !ok || !user.email_verified_at || (user.role !== 'owner' && user.role !== 'manager')) {
      await audit(db, { event: 'device.kiosk_auth_failed', organizationId: ctx.org.id, userId: user?.id ?? null, ip: req.ip, metadata: { deviceId: ctx.deviceId, deviceName: ctx.deviceName } });
      throw new AppError(401, 'INVALID_CREDENTIALS', 'Email o contraseña incorrectos, o esa cuenta no es propietaria ni encargada de este local.');
    }
    // Acierto: no cuenta para los límites de fallos.
    await rateLimiter.release(acctKey);
    await rateLimiter.release(devKey);
    await rateLimiter.release(`login:acct:${email}`);
    return { ctx, user };
  }

  app.post('/exit', async (req) => {
    const { ctx, user } = await managerAuth(req);
    await audit(db, { event: 'device.kiosk_exit', organizationId: ctx.org.id, userId: user.id, ip: req.ip, metadata: { deviceId: ctx.deviceId, deviceName: ctx.deviceName } });
    return { ok: true, by: { name: user.name } };
  });

  /**
   * R7: un encargado desbloquea en la propia tablet el PIN de una persona bloqueada, con su email y
   * contraseña (mismos límites que salir del modo cocina). Queda en la auditoría.
   */
  app.post('/staff/:staffId/unlock', async (req) => {
    const staffId = (req.params as { staffId?: string }).staffId ?? '';
    if (!S.uuid.safeParse(staffId).success) throw notFound('Persona');
    const { ctx, user } = await managerAuth(req);
    const st = await db
      .updateTable('staff')
      .set({ pin_failed_count: 0, pin_locked_until: null, pin_lock_level: 0, updated_at: sql<Date>`now()` })
      .where('id', '=', staffId)
      .where('organization_id', '=', ctx.org.id)
      .returning(['id', 'name'])
      .executeTakeFirst();
    if (!st) throw notFound('Persona');
    await audit(db, { event: 'staff.pin_unlocked', organizationId: ctx.org.id, userId: user.id, ip: req.ip, metadata: { staffId, deviceId: ctx.deviceId, fromKiosk: true } });
    return { ok: true, by: { name: user.name }, staff: { id: st.id, name: st.name } };
  });

  app.post('/unpair', async (req) => {
    const { ctx, user } = await managerAuth(req);
    await db.updateTable('devices').set({ revoked_at: sql<Date>`now()` }).where('id', '=', ctx.deviceId).where('revoked_at', 'is', null).execute();
    await audit(db, { event: 'device.revoked', organizationId: ctx.org.id, userId: user.id, ip: req.ip, metadata: { deviceId: ctx.deviceId, name: ctx.deviceName, fromKiosk: true } });
    return { ok: true, by: { name: user.name } };
  });
}
