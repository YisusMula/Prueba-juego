import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { parse } from '../../http/validation.js';
import { requireRole } from '../../http/guards.js';

const auditQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().regex(/^\d{1,18}$/).optional(),
});

/** GET /api/orgs/:orgId/audit — registro de eventos de seguridad (solo propietario). */
export async function auditRoutes(app: FastifyInstance): Promise<void> {
  const { db } = app.deps;
  app.get('/', async (req) => {
    const ctx = requireRole(req, 'owner');
    const q = parse(auditQuery, req.query);
    let query = db
      .selectFrom('audit_events as a')
      .leftJoin('users as u', 'u.id', 'a.user_id')
      .select(['a.id', 'a.event', 'a.user_id', 'u.name as user_name', 'a.ip', 'a.metadata', 'a.created_at'])
      .where('a.organization_id', '=', ctx.org.id);
    if (q.cursor) query = query.where('a.id', '<', q.cursor);
    const rows = await query.orderBy('a.id', 'desc').limit(q.limit + 1).execute();
    const hasMore = rows.length > q.limit;
    const items = rows.slice(0, q.limit).map((r) => ({
      id: String(r.id),
      event: r.event,
      user: r.user_id ? { id: r.user_id, name: r.user_name } : null,
      ip: r.ip,
      metadata: r.metadata,
      createdAt: r.created_at.toISOString(),
    }));
    return { items, nextCursor: hasMore ? items[items.length - 1]!.id : null };
  });
}
