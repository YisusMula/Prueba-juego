import type { FastifyInstance } from 'fastify';
import { sql } from 'kysely';
import * as S from '../../schemas/index.js';
import { idParam, parse } from '../../http/validation.js';
import { orgCtx, requireUser, requireWritable } from '../../http/guards.js';
import { notFound } from '../../lib/errors.js';
import { enforce } from '../../lib/rate-limit.js';
import { keysetAfter, toPage } from '../../lib/pagination.js';
import type { DB } from '../../db/index.js';
import { recordView } from '../views.js';
import { createRecord } from './service.js';
import { idempotencyKey, withIdempotency } from './idempotency.js';

export function amendedBySelect() {
  return sql<string | null>`(SELECT a.id FROM records a WHERE a.amends_record_id = r.id)`.as('amended_by');
}

async function getRecord(db: DB, orgId: string, id: string) {
  return db.selectFrom('records as r').selectAll('r').select(amendedBySelect()).where('r.id', '=', id).where('r.organization_id', '=', orgId).executeTakeFirst();
}

export async function recordRoutes(app: FastifyInstance): Promise<void> {
  const { db, config, rateLimiter } = app.deps;
  /** Límite holgado de altas (registros y enmiendas) por usuario y local. */
  const limitCreate = (userId: string, orgId: string) =>
    enforce(rateLimiter, `records:user:${userId}:org:${orgId}`, config.rateLimits.recordCreateUser, 'Demasiados registros seguidos. Espera un minuto.');

  app.get('/', async (req) => {
    const ctx = orgCtx(req);
    const q = parse(S.listRecordsQuery, req.query);
    const tz = ctx.org.timezone;
    let query = db.selectFrom('records as r').selectAll('r').select(amendedBySelect()).where('r.organization_id', '=', ctx.org.id);
    if (q.type) query = query.where('r.type', '=', q.type);
    if (q.equipmentId) query = query.where('r.equipment_id', '=', q.equipmentId);
    if (q.staffId) query = query.where('r.staff_id', '=', q.staffId);
    if (q.alert !== undefined) query = query.where('r.alert', '=', q.alert);
    // Fechas y orden por la fecha del hecho (effective_at): una enmienda aparece junto al original.
    if (q.from) query = query.where('r.effective_at', '>=', sql<Date>`(${q.from}::date)::timestamp AT TIME ZONE ${tz}`);
    if (q.to) query = query.where('r.effective_at', '<', sql<Date>`(${q.to}::date + 1)::timestamp AT TIME ZONE ${tz}`);
    if (q.cursor) query = query.where(keysetAfter({ table: 'records', alias: 'r', cursor: q.cursor, orgId: ctx.org.id, direction: 'desc', orderColumn: 'effective_at' }));
    const rows = await query.orderBy('r.effective_at', 'desc').orderBy('r.id', 'desc').limit(q.limit + 1).execute();
    return toPage(rows, q.limit, (r) => r.id, recordView);
  });

  app.get('/:recordId', async (req) => {
    const ctx = orgCtx(req);
    const id = idParam(req.params, 'recordId', 'Registro');
    const rec = await getRecord(db, ctx.org.id, id);
    if (!rec) throw notFound('Registro');
    const amends = rec.amends_record_id ? await getRecord(db, ctx.org.id, rec.amends_record_id) : undefined;
    const amendedBy = rec.amended_by ? await getRecord(db, ctx.org.id, rec.amended_by) : undefined;
    return {
      record: recordView(rec),
      amends: amends ? recordView(amends) : null,
      amendedBy: amendedBy ? recordView(amendedBy) : null,
    };
  });

  app.post('/', async (req, reply) => {
    const ctx = requireWritable(req);
    const auth = requireUser(req);
    const body = parse(S.createRecordBody, req.body);
    const key = idempotencyKey(req);
    await limitCreate(auth.user.id, ctx.org.id);
    const { record, replayed } = await withIdempotency(db, { orgId: ctx.org.id, key, scope: 'records', payload: body }, (tx) =>
      createRecord(
        tx,
        ctx.org,
        { userId: auth.user.id, userName: auth.user.name, staffId: body.staffId ?? null, deviceId: null },
        body.type,
        body.data,
        undefined,
        { now: app.deps.now() },
      ),
    );
    if (replayed) reply.header('Idempotent-Replayed', 'true');
    return reply.status(replayed ? 200 : 201).send({ record: recordView(record) });
  });

  app.post('/:recordId/amendments', async (req, reply) => {
    const ctx = requireWritable(req);
    const auth = requireUser(req);
    const id = idParam(req.params, 'recordId', 'Registro');
    const body = parse(S.amendmentBody, req.body);
    const key = idempotencyKey(req);
    await limitCreate(auth.user.id, ctx.org.id);
    const { record, replayed } = await withIdempotency(db, { orgId: ctx.org.id, key, scope: `amendment:${id}`, payload: body }, (tx) =>
      createRecord(
        tx,
        ctx.org,
        { userId: auth.user.id, userName: auth.user.name, staffId: body.staffId ?? null, deviceId: null },
        null, // el tipo es el del registro original
        body.data,
        { originalId: id, reason: body.reason },
        { now: app.deps.now() },
      ),
    );
    if (replayed) reply.header('Idempotent-Replayed', 'true');
    return reply.status(replayed ? 200 : 201).send({ record: recordView(record) });
  });
}
