import type { FastifyInstance } from 'fastify';
import { sql } from 'kysely';
import * as S from '../../schemas/index.js';
import { idParam, parse } from '../../http/validation.js';
import { orgCtx, requireWritable } from '../../http/guards.js';
import { notFound } from '../../lib/errors.js';
import { hashSecret } from '../../lib/password.js';
import { audit } from '../../lib/audit.js';
import { keysetAfter, toPage } from '../../lib/pagination.js';
import { staffView } from '../views.js';

const listQuery = S.pagination.extend({ active: S.booleanString.optional() });

export async function staffRoutes(app: FastifyInstance): Promise<void> {
  const { db } = app.deps;
  const cols = ['s.id', 's.name', 's.pin_hash', 's.active', 's.pin_locked_until', 's.created_at'] as const;

  app.get('/', async (req) => {
    const ctx = orgCtx(req);
    const q = parse(listQuery, req.query);
    let query = db.selectFrom('staff as s').select(cols).where('s.organization_id', '=', ctx.org.id);
    if (q.active !== undefined) query = query.where('s.active', '=', q.active);
    if (q.cursor) query = query.where(keysetAfter({ table: 'staff', alias: 's', cursor: q.cursor, orgId: ctx.org.id, direction: 'asc' }));
    const rows = await query.orderBy('s.created_at').orderBy('s.id').limit(q.limit + 1).execute();
    return toPage(rows, q.limit, (r) => r.id, staffView);
  });

  app.post('/', async (req, reply) => {
    const ctx = requireWritable(req);
    const body = parse(S.createStaffBody, req.body);
    const row = await db
      .insertInto('staff')
      .values({ organization_id: ctx.org.id, name: body.name, pin_hash: body.pin ? await hashSecret(body.pin) : null })
      .returning(['id', 'name', 'pin_hash', 'active', 'pin_locked_until', 'created_at'])
      .executeTakeFirstOrThrow();
    return reply.status(201).send({ staff: staffView(row) });
  });

  app.patch('/:staffId', async (req) => {
    const ctx = requireWritable(req);
    const id = idParam(req.params, 'staffId', 'Miembro del personal');
    const body = parse(S.updateStaffBody, req.body);
    const pinChange = body.pin !== undefined;
    const row = await db
      .updateTable('staff')
      .set({
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.active !== undefined ? { active: body.active } : {}),
        ...(pinChange ? { pin_hash: body.pin ? await hashSecret(body.pin) : null, pin_failed_count: 0, pin_locked_until: null } : {}),
        updated_at: sql<Date>`now()`,
      })
      .where('id', '=', id)
      .where('organization_id', '=', ctx.org.id)
      .returning(['id', 'name', 'pin_hash', 'active', 'pin_locked_until', 'created_at'])
      .executeTakeFirst();
    if (!row) throw notFound('Miembro del personal');
    if (pinChange) {
      await audit(db, { event: 'staff.pin_changed', organizationId: ctx.org.id, userId: ctx.userId, ip: req.ip, metadata: { staffId: id, removed: body.pin === null } });
    }
    return { staff: staffView(row) };
  });

  app.post('/:staffId/unlock', async (req) => {
    const ctx = requireWritable(req);
    const id = idParam(req.params, 'staffId', 'Miembro del personal');
    const row = await db
      .updateTable('staff')
      .set({ pin_failed_count: 0, pin_locked_until: null, updated_at: sql<Date>`now()` })
      .where('id', '=', id)
      .where('organization_id', '=', ctx.org.id)
      .returning(['id', 'name', 'pin_hash', 'active', 'pin_locked_until', 'created_at'])
      .executeTakeFirst();
    if (!row) throw notFound('Miembro del personal');
    return { staff: staffView(row) };
  });
}
