import type { FastifyRequest } from 'fastify';
import type { AuthCtx, DeviceCtx, OrgCtx } from './context.js';
import type { Role } from '../db/types.js';
import { forbidden, notFound, readOnly, unauthenticated } from '../lib/errors.js';
import { isWritable } from '../modules/billing/status.js';
import { idParam } from './validation.js';

export function requireUser(req: FastifyRequest): AuthCtx {
  if (!req.auth) throw unauthenticated();
  return req.auth;
}

/** preHandler de las rutas /api/orgs/:orgId/*: exige sesión y pertenencia (404 si no es miembro). */
export async function loadOrgContext(req: FastifyRequest): Promise<void> {
  const auth = requireUser(req);
  const orgId = idParam(req.params, 'orgId', 'Local');
  const row = await req.server.deps.db
    .selectFrom('memberships as m')
    .innerJoin('organizations as o', 'o.id', 'm.organization_id')
    .selectAll('o')
    .select(['m.role'])
    .where('m.user_id', '=', auth.user.id)
    .where('m.organization_id', '=', orgId)
    .executeTakeFirst();
  if (!row) throw notFound('Local');
  const { role, ...org } = row;
  req.orgCtx = { org, role, userId: auth.user.id };
}

export function orgCtx(req: FastifyRequest): OrgCtx {
  if (!req.orgCtx) throw notFound('Local');
  return req.orgCtx;
}

export function requireRole(req: FastifyRequest, role: Role): OrgCtx {
  const ctx = orgCtx(req);
  if (role === 'owner' && ctx.role !== 'owner') throw forbidden('Solo el propietario del local puede realizar esta acción');
  return ctx;
}

/** Exige suscripción activa o prueba vigente para escribir. */
export function requireWritable(req: FastifyRequest): OrgCtx {
  const ctx = orgCtx(req);
  if (!isWritable(ctx.org)) throw readOnly();
  return ctx;
}

export function deviceCtx(req: FastifyRequest): DeviceCtx {
  if (!req.deviceCtx) throw unauthenticated();
  return req.deviceCtx;
}
