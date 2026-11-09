import type { FastifyInstance } from 'fastify';
import { sql } from 'kysely';
import * as S from '../../schemas/index.js';
import { idParam, parse } from '../../http/validation.js';
import { orgCtx, requireWritable } from '../../http/guards.js';
import { conflict, notFound } from '../../lib/errors.js';
import { audit } from '../../lib/audit.js';
import { randomToken, sha256 } from '../../lib/crypto.js';
import { keysetAfter, toPage } from '../../lib/pagination.js';

export const KIOSK_TOKEN_PREFIX = 'kd_';

function deviceView(d: { id: string; name: string; created_at: Date; last_used_at: Date | null; revoked_at: Date | null }) {
  return {
    id: d.id,
    name: d.name,
    createdAt: d.created_at.toISOString(),
    lastUsedAt: d.last_used_at?.toISOString() ?? null,
    revokedAt: d.revoked_at?.toISOString() ?? null,
    active: d.revoked_at == null,
  };
}

export async function deviceRoutes(app: FastifyInstance): Promise<void> {
  const { db } = app.deps;
  const cols = ['d.id', 'd.name', 'd.created_at', 'd.last_used_at', 'd.revoked_at'] as const;

  app.get('/', async (req) => {
    const ctx = orgCtx(req);
    const q = parse(S.pagination, req.query);
    let query = db.selectFrom('devices as d').select(cols).where('d.organization_id', '=', ctx.org.id);
    if (q.cursor) query = query.where(keysetAfter({ table: 'devices', alias: 'd', cursor: q.cursor, orgId: ctx.org.id, direction: 'asc' }));
    const rows = await query.orderBy('d.created_at').orderBy('d.id').limit(q.limit + 1).execute();
    return toPage(rows, q.limit, (r) => r.id, deviceView);
  });

  app.post('/', async (req, reply) => {
    const ctx = requireWritable(req);
    const body = parse(S.createDeviceBody, req.body);
    const active = await db
      .selectFrom('devices')
      .select(sql<number>`count(*)::int`.as('n'))
      .where('organization_id', '=', ctx.org.id)
      .where('revoked_at', 'is', null)
      .executeTakeFirstOrThrow();
    if (active.n >= 20) throw conflict('Has alcanzado el máximo de 20 dispositivos de cocina activos');
    // 256 bits aleatorios; solo se guarda el hash. Se muestra UNA vez.
    const token = KIOSK_TOKEN_PREFIX + randomToken();
    const row = await db
      .insertInto('devices')
      .values({ organization_id: ctx.org.id, name: body.name, token_hash: sha256(token), created_by: ctx.userId })
      .returning(['id', 'name', 'created_at', 'last_used_at', 'revoked_at'])
      .executeTakeFirstOrThrow();
    await audit(db, { event: 'device.created', organizationId: ctx.org.id, userId: ctx.userId, ip: req.ip, metadata: { deviceId: row.id, name: row.name } });
    return reply.status(201).send({ device: deviceView(row), token });
  });

  // Revocar siempre está permitido (incluso en solo lectura): reduce privilegios.
  app.delete('/:deviceId', async (req, reply) => {
    const ctx = orgCtx(req);
    const id = idParam(req.params, 'deviceId', 'Dispositivo');
    const r = await db
      .updateTable('devices')
      .set({ revoked_at: sql<Date>`coalesce(revoked_at, now())` })
      .where('id', '=', id)
      .where('organization_id', '=', ctx.org.id)
      .executeTakeFirst();
    if (Number(r.numUpdatedRows) === 0) throw notFound('Dispositivo');
    await audit(db, { event: 'device.revoked', organizationId: ctx.org.id, userId: ctx.userId, ip: req.ip, metadata: { deviceId: id } });
    return reply.status(204).send();
  });
}
