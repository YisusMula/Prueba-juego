import type { FastifyInstance } from 'fastify';
import { sql } from 'kysely';
import * as S from '../../schemas/index.js';
import { idParam, parse } from '../../http/validation.js';
import { orgCtx, requireUser, requireWritable } from '../../http/guards.js';
import { notFound } from '../../lib/errors.js';
import { keysetAfter, toPage } from '../../lib/pagination.js';
import type { DB } from '../../db/index.js';
import { recordView } from '../views.js';
import { createRecord } from './service.js';

export function amendedBySelect() {
  return sql<string | null>`(SELECT a.id FROM records a WHERE a.amends_record_id = r.id)`.as('amended_by');
}

async function getRecord(db: DB, orgId: string, id: string) {
  return db.selectFrom('records as r').selectAll('r').select(amendedBySelect()).where('r.id', '=', id).where('r.organization_id', '=', orgId).executeTakeFirst();
}

export async function recordRoutes(app: FastifyInstance): Promise<void> {
  const { db } = app.deps;

  app.get('/', async (req) => {
    const ctx = orgCtx(req);
    const q = parse(S.listRecordsQuery, req.query);
    const tz = ctx.org.timezone;
    let query = db.selectFrom('records as r').selectAll('r').select(amendedBySelect()).where('r.organization_id', '=', ctx.org.id);
    if (q.type) query = query.where('r.type', '=', q.type);
    if (q.equipmentId) query = query.where('r.equipment_id', '=', q.equipmentId);
    if (q.staffId) query = query.where('r.staff_id', '=', q.staffId);
    if (q.alert !== undefined) query = query.where('r.alert', '=', q.alert);
    if (q.from) query = query.where('r.created_at', '>=', sql<Date>`(${q.from}::date)::timestamp AT TIME ZONE ${tz}`);
    if (q.to) query = query.where('r.created_at', '<', sql<Date>`(${q.to}::date + 1)::timestamp AT TIME ZONE ${tz}`);
    if (q.cursor) query = query.where(keysetAfter({ table: 'records', alias: 'r', cursor: q.cursor, orgId: ctx.org.id, direction: 'desc' }));
    const rows = await query.orderBy('r.created_at', 'desc').orderBy('r.id', 'desc').limit(q.limit + 1).execute();
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
    const row = await createRecord(
      db,
      ctx.org,
      { userId: auth.user.id, userName: auth.user.name, staffId: body.staffId ?? null, deviceId: null },
      body.type,
      body.data,
    );
    return reply.status(201).send({ record: recordView(row) });
  });

  app.post('/:recordId/amendments', async (req, reply) => {
    const ctx = requireWritable(req);
    const auth = requireUser(req);
    const id = idParam(req.params, 'recordId', 'Registro');
    const body = parse(S.amendmentBody, req.body);
    const row = await createRecord(
      db,
      ctx.org,
      { userId: auth.user.id, userName: auth.user.name, staffId: body.staffId ?? null, deviceId: null },
      null, // el tipo es el del registro original
      body.data,
      { originalId: id, reason: body.reason },
    );
    return reply.status(201).send({ record: recordView(row) });
  });
}
