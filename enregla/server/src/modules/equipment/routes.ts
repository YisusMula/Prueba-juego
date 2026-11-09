import type { FastifyInstance } from 'fastify';
import { sql } from 'kysely';
import * as S from '../../schemas/index.js';
import { idParam, parse } from '../../http/validation.js';
import { orgCtx, requireWritable } from '../../http/guards.js';
import { AppError, notFound } from '../../lib/errors.js';
import { keysetAfter, toPage } from '../../lib/pagination.js';
import { equipmentView } from '../views.js';

const listQuery = S.pagination.extend({ active: S.booleanString.optional(), type: S.equipmentType.optional() });

export async function equipmentRoutes(app: FastifyInstance): Promise<void> {
  const { db } = app.deps;

  app.get('/', async (req) => {
    const ctx = orgCtx(req);
    const q = parse(listQuery, req.query);
    let query = db.selectFrom('equipment as e').selectAll('e').where('e.organization_id', '=', ctx.org.id);
    if (q.active !== undefined) query = query.where('e.active', '=', q.active);
    if (q.type) query = query.where('e.type', '=', q.type);
    if (q.cursor) query = query.where(keysetAfter({ table: 'equipment', alias: 'e', cursor: q.cursor, orgId: ctx.org.id, direction: 'asc' }));
    const rows = await query.orderBy('e.created_at').orderBy('e.id').limit(q.limit + 1).execute();
    return toPage(rows, q.limit, (r) => r.id, equipmentView);
  });

  app.get('/:equipmentId', async (req) => {
    const ctx = orgCtx(req);
    const id = idParam(req.params, 'equipmentId', 'Equipo');
    const row = await db.selectFrom('equipment').selectAll().where('id', '=', id).where('organization_id', '=', ctx.org.id).executeTakeFirst();
    if (!row) throw notFound('Equipo');
    return { equipment: equipmentView(row) };
  });

  app.post('/', async (req, reply) => {
    const ctx = requireWritable(req);
    const body = parse(S.createEquipmentBody, req.body);
    const count = await db.selectFrom('equipment').select(sql<number>`count(*)::int`.as('n')).where('organization_id', '=', ctx.org.id).executeTakeFirstOrThrow();
    if (count.n >= 200) throw new AppError(409, 'CONFLICT', 'Has alcanzado el máximo de equipos');
    const row = await db
      .insertInto('equipment')
      .values({
        organization_id: ctx.org.id,
        name: body.name,
        type: body.type,
        min_temp: body.minTemp,
        max_temp: body.maxTemp,
        checks_per_day: body.checksPerDay,
        active: body.active,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    return reply.status(201).send({ equipment: equipmentView(row) });
  });

  app.patch('/:equipmentId', async (req) => {
    const ctx = requireWritable(req);
    const id = idParam(req.params, 'equipmentId', 'Equipo');
    const body = parse(S.updateEquipmentBody, req.body);
    const current = await db.selectFrom('equipment').selectAll().where('id', '=', id).where('organization_id', '=', ctx.org.id).executeTakeFirst();
    if (!current) throw notFound('Equipo');
    const min = body.minTemp !== undefined ? body.minTemp : current.min_temp;
    const max = body.maxTemp !== undefined ? body.maxTemp : current.max_temp;
    if (min != null && max != null && min > max) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Los datos enviados no son válidos', [
        { path: 'minTemp', message: 'La temperatura mínima no puede ser mayor que la máxima' },
      ]);
    }
    const row = await db
      .updateTable('equipment')
      .set({
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.type !== undefined ? { type: body.type } : {}),
        min_temp: min,
        max_temp: max,
        ...(body.checksPerDay !== undefined ? { checks_per_day: body.checksPerDay } : {}),
        ...(body.active !== undefined ? { active: body.active } : {}),
        updated_at: sql<Date>`now()`,
      })
      .where('id', '=', id)
      .where('organization_id', '=', ctx.org.id)
      .returningAll()
      .executeTakeFirstOrThrow();
    return { equipment: equipmentView(row) };
  });
}
