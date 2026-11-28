import type { FastifyInstance } from 'fastify';
import { sql, type Selectable } from 'kysely';
import { z } from 'zod';
import * as S from '../../schemas/index.js';
import { idParam, parse } from '../../http/validation.js';
import { orgCtx, requireWritable } from '../../http/guards.js';
import { AppError, notFound } from '../../lib/errors.js';
import { enforce } from '../../lib/rate-limit.js';
import { audit } from '../../lib/audit.js';
import { randomToken } from '../../lib/crypto.js';
import { keysetAfter, toPage } from '../../lib/pagination.js';
import { json } from '../../db/index.js';
import { isWritable } from '../billing/status.js';
import type { DishesTable } from '../../db/types.js';

export function dishView(d: Selectable<DishesTable>) {
  return {
    id: d.id,
    name: d.name,
    category: d.category,
    description: d.description,
    allergens: d.allergens,
    allergensReviewed: d.allergens_reviewed,
    allergensReviewedAt: d.allergens_reviewed_at?.toISOString() ?? null,
    visible: d.visible,
    createdAt: d.created_at.toISOString(),
    updatedAt: d.updated_at.toISOString(),
  };
}

const ALLERGEN_LEGEND = S.ALLERGENS.map((id) => ({ id, label: S.ALLERGEN_LABELS[id], name: S.ALLERGEN_NAMES[id] }));
export const PUBLIC_MENU_NOTICE =
  'Información sobre alérgenos facilitada por el establecimiento. Si tienes alguna alergia o intolerancia, consulta siempre al personal antes de pedir: aunque un plato no declare alérgenos, puede haber trazas por contaminación cruzada en la cocina.';
const listQuery = S.pagination.extend({ category: z.string().trim().max(100).optional() });

/** Rutas bajo /api/orgs/:orgId */
export async function dishRoutes(app: FastifyInstance): Promise<void> {
  const { db } = app.deps;

  app.get('/dishes', async (req) => {
    const ctx = orgCtx(req);
    const q = parse(listQuery, req.query);
    let query = db.selectFrom('dishes as d').selectAll('d').where('d.organization_id', '=', ctx.org.id);
    if (q.category) query = query.where('d.category', '=', q.category);
    if (q.cursor) query = query.where(keysetAfter({ table: 'dishes', alias: 'd', cursor: q.cursor, orgId: ctx.org.id, direction: 'asc' }));
    const rows = await query.orderBy('d.created_at').orderBy('d.id').limit(q.limit + 1).execute();
    return toPage(rows, q.limit, (r) => r.id, dishView);
  });

  app.get('/dishes/:dishId', async (req) => {
    const ctx = orgCtx(req);
    const id = idParam(req.params, 'dishId', 'Plato');
    const row = await db.selectFrom('dishes').selectAll().where('id', '=', id).where('organization_id', '=', ctx.org.id).executeTakeFirst();
    if (!row) throw notFound('Plato');
    return { dish: dishView(row) };
  });

  app.post('/dishes', async (req, reply) => {
    const ctx = requireWritable(req);
    const body = parse(S.dishBody, req.body);
    const count = await db.selectFrom('dishes').select(sql<number>`count(*)::int`.as('n')).where('organization_id', '=', ctx.org.id).executeTakeFirstOrThrow();
    if (count.n >= 1000) throw new AppError(409, 'CONFLICT', 'Has alcanzado el máximo de platos');
    const row = await db
      .insertInto('dishes')
      .values({
        organization_id: ctx.org.id,
        name: body.name,
        category: body.category,
        description: body.description,
        allergens: json(body.allergens),
        allergens_reviewed: body.allergensReviewed,
        allergens_reviewed_at: body.allergensReviewed ? sql<Date>`now()` : null,
        visible: body.visible,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    return reply.status(201).send({ dish: dishView(row) });
  });

  app.patch('/dishes/:dishId', async (req) => {
    const ctx = requireWritable(req);
    const id = idParam(req.params, 'dishId', 'Plato');
    const body = parse(S.updateDishBody, req.body);
    const row = await db
      .updateTable('dishes')
      .set({
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.category !== undefined ? { category: body.category } : {}),
        ...(body.description !== undefined ? { description: body.description } : {}),
        ...(body.allergens !== undefined ? { allergens: json(body.allergens) } : {}),
        ...(body.visible !== undefined ? { visible: body.visible } : {}),
        ...(body.allergensReviewed !== undefined
          ? { allergens_reviewed: body.allergensReviewed, allergens_reviewed_at: body.allergensReviewed ? sql<Date>`now()` : null }
          : {}),
        updated_at: sql<Date>`now()`,
      })
      .where('id', '=', id)
      .where('organization_id', '=', ctx.org.id)
      .returningAll()
      .executeTakeFirst();
    if (!row) throw notFound('Plato');
    return { dish: dishView(row) };
  });

  app.delete('/dishes/:dishId', async (req, reply) => {
    const ctx = requireWritable(req);
    const id = idParam(req.params, 'dishId', 'Plato');
    const r = await db.deleteFrom('dishes').where('id', '=', id).where('organization_id', '=', ctx.org.id).executeTakeFirst();
    if (Number(r.numDeletedRows) === 0) throw notFound('Plato');
    return reply.status(204).send();
  });

  const menuView = (o: { public_menu_enabled: boolean; public_menu_slug: string }) => ({
    enabled: o.public_menu_enabled,
    slug: o.public_menu_slug,
    apiPath: `/api/public/menu/${o.public_menu_slug}`,
  });

  app.get('/public-menu', async (req) => {
    const ctx = orgCtx(req);
    return { publicMenu: menuView(ctx.org) };
  });

  // Desactivar la carta pública se permite SIEMPRE (reduce exposición), también en solo lectura.
  app.patch('/public-menu', async (req) => {
    const body = parse(S.publicMenuSettingsBody, req.body);
    const ctx = body.enabled ? requireWritable(req) : orgCtx(req);
    const o = await db
      .updateTable('organizations')
      .set({ public_menu_enabled: body.enabled, updated_at: sql<Date>`now()` })
      .where('id', '=', ctx.org.id)
      .returning(['public_menu_enabled', 'public_menu_slug'])
      .executeTakeFirstOrThrow();
    await audit(db, { event: 'public_menu.updated', organizationId: ctx.org.id, userId: ctx.userId, ip: req.ip, metadata: { enabled: body.enabled } });
    return { publicMenu: menuView(o) };
  });

  // Genera un slug nuevo: el QR anterior deja de funcionar.
  app.post('/public-menu/regenerate', async (req) => {
    const ctx = requireWritable(req);
    const o = await db
      .updateTable('organizations')
      .set({ public_menu_slug: randomToken(16), updated_at: sql<Date>`now()` })
      .where('id', '=', ctx.org.id)
      .returning(['public_menu_enabled', 'public_menu_slug'])
      .executeTakeFirstOrThrow();
    await audit(db, { event: 'public_menu.updated', organizationId: ctx.org.id, userId: ctx.userId, ip: req.ip, metadata: { regenerated: true } });
    return { publicMenu: menuView(o) };
  });
}

/** GET /api/public/menu/:slug — carta pública de alérgenos (sin autenticación, solo lectura). */
export async function publicMenuRoutes(app: FastifyInstance): Promise<void> {
  const { db, config, rateLimiter } = app.deps;

  app.get('/menu/:slug', async (req, reply) => {
    await enforce(rateLimiter, `public:ip:${req.ip}`, config.rateLimits.publicIp);
    const slug = (req.params as { slug?: string }).slug ?? '';
    if (!/^[A-Za-z0-9_-]{22}$/.test(slug)) throw notFound('Carta');
    const org = await db
      .selectFrom('organizations')
      .select(['id', 'name', 'subscription_status', 'trial_ends_at', 'stripe_subscription_id', 'deletion_scheduled_at', 'past_due_since'])
      .where('public_menu_slug', '=', slug)
      .where('public_menu_enabled', '=', true)
      .executeTakeFirst();
    // En solo lectura (prueba caducada, impago, cancelada, pendiente de eliminación) la carta no se sirve.
    if (!org || !isWritable(org)) throw notFound('Carta');
    // Solo platos visibles CON los alérgenos revisados: un plato sin revisar nunca se publica.
    const dishes = (
      await db
        .selectFrom('dishes')
        .select(['name', 'category', 'description', 'allergens', 'updated_at'])
        .where('organization_id', '=', org.id)
        .where('visible', '=', true)
        .where('allergens_reviewed', '=', true)
        .orderBy('name')
        .limit(1000)
        .execute()
    ).sort((a, b) => S.compareMenuCategories(a.category, b.category) || a.name.localeCompare(b.name, 'es', { sensitivity: 'base' }));
    reply.header('X-Robots-Tag', 'noindex, nofollow');
    const updatedAt = dishes.reduce<Date | null>((acc, d) => (!acc || d.updated_at > acc ? d.updated_at : acc), null);
    return {
      organization: { name: org.name },
      allergens: ALLERGEN_LEGEND,
      statuses: S.ALLERGEN_STATUS_LABELS,
      dishes: dishes.map((d) => ({ name: d.name, category: d.category, description: d.description, allergens: d.allergens })),
      updatedAt: updatedAt?.toISOString() ?? null,
      notice: PUBLIC_MENU_NOTICE,
    };
  });
}
