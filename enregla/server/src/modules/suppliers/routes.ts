import type { FastifyInstance } from 'fastify';
import { sql } from 'kysely';
import { z } from 'zod';
import * as S from '../../schemas/index.js';
import { idParam, parse } from '../../http/validation.js';
import { orgCtx, requireWritable } from '../../http/guards.js';
import { AppError, notFound } from '../../lib/errors.js';
import { keysetAfter, toPage } from '../../lib/pagination.js';
import { json } from '../../db/index.js';
import type { Selectable } from 'kysely';
import type { SuppliersTable } from '../../db/types.js';

export function supplierView(s: Selectable<SuppliersTable>) {
  return {
    id: s.id,
    name: s.name,
    contactName: s.contact_name,
    phone: s.phone,
    email: s.email,
    products: s.products,
    notes: s.notes,
    createdAt: s.created_at.toISOString(),
  };
}

const listQuery = S.pagination.extend({ q: z.string().trim().max(100).optional() });

export async function supplierRoutes(app: FastifyInstance): Promise<void> {
  const { db } = app.deps;

  app.get('/', async (req) => {
    const ctx = orgCtx(req);
    const q = parse(listQuery, req.query);
    let query = db.selectFrom('suppliers as s').selectAll('s').where('s.organization_id', '=', ctx.org.id);
    if (q.q) query = query.where('s.name', 'ilike', `%${q.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
    if (q.cursor) query = query.where(keysetAfter({ table: 'suppliers', alias: 's', cursor: q.cursor, orgId: ctx.org.id, direction: 'asc' }));
    const rows = await query.orderBy('s.created_at').orderBy('s.id').limit(q.limit + 1).execute();
    return toPage(rows, q.limit, (r) => r.id, supplierView);
  });

  app.get('/:supplierId', async (req) => {
    const ctx = orgCtx(req);
    const id = idParam(req.params, 'supplierId', 'Proveedor');
    const row = await db.selectFrom('suppliers').selectAll().where('id', '=', id).where('organization_id', '=', ctx.org.id).executeTakeFirst();
    if (!row) throw notFound('Proveedor');
    return { supplier: supplierView(row) };
  });

  app.post('/', async (req, reply) => {
    const ctx = requireWritable(req);
    const body = parse(S.supplierBody, req.body);
    const count = await db.selectFrom('suppliers').select(sql<number>`count(*)::int`.as('n')).where('organization_id', '=', ctx.org.id).executeTakeFirstOrThrow();
    if (count.n >= 1000) throw new AppError(409, 'CONFLICT', 'Has alcanzado el máximo de proveedores');
    const row = await db
      .insertInto('suppliers')
      .values({
        organization_id: ctx.org.id,
        name: body.name,
        contact_name: body.contactName,
        phone: body.phone,
        email: body.email,
        products: json(body.products),
        notes: body.notes,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    return reply.status(201).send({ supplier: supplierView(row) });
  });

  app.patch('/:supplierId', async (req) => {
    const ctx = requireWritable(req);
    const id = idParam(req.params, 'supplierId', 'Proveedor');
    const body = parse(S.updateSupplierBody, req.body);
    const row = await db
      .updateTable('suppliers')
      .set({
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.contactName !== undefined ? { contact_name: body.contactName } : {}),
        ...(body.phone !== undefined ? { phone: body.phone } : {}),
        ...(body.email !== undefined ? { email: body.email } : {}),
        ...(body.products !== undefined ? { products: json(body.products) } : {}),
        ...(body.notes !== undefined ? { notes: body.notes } : {}),
        updated_at: sql<Date>`now()`,
      })
      .where('id', '=', id)
      .where('organization_id', '=', ctx.org.id)
      .returningAll()
      .executeTakeFirst();
    if (!row) throw notFound('Proveedor');
    return { supplier: supplierView(row) };
  });

  // Los registros de recepción guardan una copia del nombre del proveedor: borrar no los altera.
  app.delete('/:supplierId', async (req, reply) => {
    const ctx = requireWritable(req);
    const id = idParam(req.params, 'supplierId', 'Proveedor');
    const r = await db.deleteFrom('suppliers').where('id', '=', id).where('organization_id', '=', ctx.org.id).executeTakeFirst();
    if (Number(r.numDeletedRows) === 0) throw notFound('Proveedor');
    return reply.status(204).send();
  });
}
