import type { FastifyInstance } from 'fastify';
import { sql } from 'kysely';
import type { z } from 'zod';
import * as S from '../../schemas/index.js';
import { idParam, parse } from '../../http/validation.js';
import { orgCtx, requireWritable } from '../../http/guards.js';
import { AppError, notFound } from '../../lib/errors.js';
import { keysetAfter, toPage } from '../../lib/pagination.js';
import { json } from '../../db/index.js';
import type { CleaningItem } from '../../db/types.js';
import { cleaningPlanView } from '../views.js';

const listQuery = S.pagination.extend({ active: S.booleanString.optional() });

/** Conserva los ids de ítems existentes; asigna uno nuevo a los demás. */
function normalizeItems(items: z.output<typeof S.cleaningItemInput>[], existing: CleaningItem[] = []): CleaningItem[] {
  const known = new Set(existing.map((i) => i.id));
  const used = new Set<string>();
  return items.map((i) => {
    let id = i.id && known.has(i.id) && !used.has(i.id) ? i.id : crypto.randomUUID();
    if (used.has(id)) id = crypto.randomUUID();
    used.add(id);
    return { id, area: i.area, product: i.product ?? null, method: i.method ?? null };
  });
}

export async function cleaningRoutes(app: FastifyInstance): Promise<void> {
  const { db } = app.deps;

  app.get('/', async (req) => {
    const ctx = orgCtx(req);
    const q = parse(listQuery, req.query);
    let query = db.selectFrom('cleaning_plans as p').selectAll('p').where('p.organization_id', '=', ctx.org.id);
    if (q.active !== undefined) query = query.where('p.active', '=', q.active);
    if (q.cursor) query = query.where(keysetAfter({ table: 'cleaning_plans', alias: 'p', cursor: q.cursor, orgId: ctx.org.id, direction: 'asc' }));
    const rows = await query.orderBy('p.created_at').orderBy('p.id').limit(q.limit + 1).execute();
    return toPage(rows, q.limit, (r) => r.id, cleaningPlanView);
  });

  app.get('/:planId', async (req) => {
    const ctx = orgCtx(req);
    const id = idParam(req.params, 'planId', 'Plan de limpieza');
    const row = await db.selectFrom('cleaning_plans').selectAll().where('id', '=', id).where('organization_id', '=', ctx.org.id).executeTakeFirst();
    if (!row) throw notFound('Plan de limpieza');
    return { cleaningPlan: cleaningPlanView(row) };
  });

  app.post('/', async (req, reply) => {
    const ctx = requireWritable(req);
    const body = parse(S.createCleaningPlanBody, req.body);
    const count = await db.selectFrom('cleaning_plans').select(sql<number>`count(*)::int`.as('n')).where('organization_id', '=', ctx.org.id).executeTakeFirstOrThrow();
    if (count.n >= 200) throw new AppError(409, 'CONFLICT', 'Has alcanzado el máximo de planes de limpieza');
    const row = await db
      .insertInto('cleaning_plans')
      .values({
        organization_id: ctx.org.id,
        name: body.name,
        frequency: body.frequency,
        weekday: body.frequency === 'weekly' ? body.weekday : null,
        month_day: body.frequency === 'monthly' ? body.monthDay : null,
        items: json(normalizeItems(body.items)),
        active: body.active,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    return reply.status(201).send({ cleaningPlan: cleaningPlanView(row) });
  });

  app.patch('/:planId', async (req) => {
    const ctx = requireWritable(req);
    const id = idParam(req.params, 'planId', 'Plan de limpieza');
    const body = parse(S.updateCleaningPlanBody, req.body);
    const current = await db.selectFrom('cleaning_plans').selectAll().where('id', '=', id).where('organization_id', '=', ctx.org.id).executeTakeFirst();
    if (!current) throw notFound('Plan de limpieza');
    const frequency = body.frequency ?? current.frequency;
    const weekday = body.weekday !== undefined ? body.weekday : current.weekday;
    const monthDay = body.monthDay !== undefined ? body.monthDay : current.month_day;
    if (frequency === 'weekly' && weekday == null) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Indica el día de la semana', [{ path: 'weekday', message: 'Indica el día de la semana' }]);
    }
    if (frequency === 'monthly' && monthDay == null) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Indica el día del mes', [{ path: 'monthDay', message: 'Indica el día del mes' }]);
    }
    const row = await db
      .updateTable('cleaning_plans')
      .set({
        ...(body.name !== undefined ? { name: body.name } : {}),
        frequency,
        weekday: frequency === 'weekly' ? weekday : null,
        month_day: frequency === 'monthly' ? monthDay : null,
        ...(body.items !== undefined ? { items: json(normalizeItems(body.items, current.items)) } : {}),
        ...(body.active !== undefined ? { active: body.active } : {}),
        updated_at: sql<Date>`now()`,
      })
      .where('id', '=', id)
      .where('organization_id', '=', ctx.org.id)
      .returningAll()
      .executeTakeFirstOrThrow();
    return { cleaningPlan: cleaningPlanView(row) };
  });
}
