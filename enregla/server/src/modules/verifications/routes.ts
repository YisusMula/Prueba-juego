import type { FastifyInstance } from 'fastify';
import * as S from '../../schemas/index.js';
import { parse } from '../../http/validation.js';
import { orgCtx, requireUser, requireWritable } from '../../http/guards.js';
import { AppError } from '../../lib/errors.js';
import { audit } from '../../lib/audit.js';
import { enforce } from '../../lib/rate-limit.js';
import { addDays, diffDays, isoWeekday, localDate, startOfMonth } from '../../lib/dates.js';
import type { DB } from '../../db/index.js';
import { verificationView } from '../views.js';
import { json } from '../../db/index.js';
import { periodSnapshot } from '../reports/summary.js';

const bad = (path: string, message: string) => new AppError(400, 'VALIDATION_ERROR', message, [{ path, message }]);

/** Último día del mes de `date`. */
export function endOfMonth(date: string): string {
  const first = startOfMonth(date);
  const [y, m] = first.split('-').map(Number) as [number, number];
  return addDays(m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`, -1);
}

/** Verificaciones que se solapan con [from, to] (las más recientes primero). */
export async function verificationsOverlapping(db: DB, orgId: string, from: string, to: string, limit = 200) {
  return db
    .selectFrom('responsible_verifications')
    .selectAll()
    .where('organization_id', '=', orgId)
    .where('period_from', '<=', to)
    .where('period_to', '>=', from)
    .orderBy('created_at', 'desc')
    .orderBy('id', 'desc')
    .limit(limit)
    .execute();
}

/**
 * /api/orgs/:orgId/verifications — verificación del responsable (fase 2, 2A): un propietario o
 * encargado marca un periodo como revisado. Es un hecho inmutable: una verificación posterior del
 * mismo periodo se AÑADE (no sustituye); no hay PATCH ni DELETE y el rol de la app no puede
 * modificarlas ni borrarlas. La hora la pone la base de datos.
 */
export async function verificationRoutes(app: FastifyInstance): Promise<void> {
  const { db, config, rateLimiter } = app.deps;

  app.get('/', async (req) => {
    const ctx = orgCtx(req);
    const q = parse(S.dateRangeQuery, req.query);
    const rows = await verificationsOverlapping(db, ctx.org.id, q.from, q.to);
    return { items: rows.map(verificationView) };
  });

  /** H-M1: el periodo verificado debe haber terminado (como muy tarde, ayer). */
  function checkPeriod(orgTz: string, from: string, to: string) {
    const today = localDate(app.deps.now(), orgTz);
    if (to >= today) throw bad('to', 'Solo se puede marcar como revisado un periodo ya terminado: elige fechas hasta ayer');
    if (diffDays(from, to) + 1 > 366) throw bad('from', 'El periodo máximo es de un año');
  }

  /** Lo que hay en el periodo (se enseña antes de confirmar y se guarda con la verificación). */
  app.get('/preview', async (req) => {
    const ctx = orgCtx(req);
    const q = parse(S.dateRangeQuery, req.query);
    checkPeriod(ctx.org.timezone, q.from, q.to);
    return periodSnapshot(db, ctx.org, q.from, q.to, app.deps.now());
  });

  app.post('/', async (req, reply) => {
    const ctx = requireWritable(req);
    const auth = requireUser(req);
    const body = parse(S.createVerificationBody, req.body);
    await enforce(rateLimiter, `records:user:${auth.user.id}:org:${ctx.org.id}`, config.rateLimits.recordCreateUser, 'Demasiadas acciones seguidas. Espera un minuto.');
    checkPeriod(ctx.org.timezone, body.from, body.to);
    const now = app.deps.now();
    const snapshot = await periodSnapshot(db, ctx.org, body.from, body.to, now);
    if (body.kind === 'week' && (isoWeekday(body.from) !== 1 || body.to !== addDays(body.from, 6))) throw bad('from', 'Una semana va de lunes a domingo');
    if (body.kind === 'month' && (body.from !== startOfMonth(body.from) || body.to !== endOfMonth(body.from))) throw bad('from', 'Un mes va del día 1 al último día del mes');
    const row = await db.transaction().execute(async (trx) => {
      const v = await trx
        .insertInto('responsible_verifications')
        .values({
          organization_id: ctx.org.id,
          period_from: body.from,
          period_to: body.to,
          period_kind: body.kind,
          comment: body.comment,
          snapshot: json(snapshot),
          // Con el rol de la app la base de datos fuerza la hora real; se envía la del reloj del servidor.
          created_at: now,
          user_id: auth.user.id,
          user_name: auth.user.name,
          user_role: ctx.role,
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      await audit(trx, {
        event: 'report.verified',
        organizationId: ctx.org.id,
        userId: auth.user.id,
        ip: req.ip,
        metadata: { verificationId: v.id, from: body.from, to: body.to, kind: body.kind, hasComment: body.comment != null },
      });
      return v;
    });
    return reply.status(201).send({ verification: verificationView(row) });
  });
}
