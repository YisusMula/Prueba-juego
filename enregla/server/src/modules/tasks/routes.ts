import type { FastifyInstance } from 'fastify';
import * as S from '../../schemas/index.js';
import { parse } from '../../http/validation.js';
import { orgCtx } from '../../http/guards.js';
import { badRequest } from '../../lib/errors.js';
import { diffDays } from '../../lib/dates.js';
import { computeCompliance, computeToday } from './service.js';

export const MAX_COMPLIANCE_DAYS = 92;

export async function taskRoutes(app: FastifyInstance): Promise<void> {
  const { db } = app.deps;

  app.get('/today', async (req) => {
    const ctx = orgCtx(req);
    return computeToday(db, ctx.org);
  });

  app.get('/compliance', async (req) => {
    const ctx = orgCtx(req);
    const q = parse(S.dateRangeQuery, req.query);
    if (diffDays(q.from, q.to) + 1 > MAX_COMPLIANCE_DAYS) throw badRequest(`El rango máximo es de ${MAX_COMPLIANCE_DAYS} días`);
    return computeCompliance(db, ctx.org, q.from, q.to);
  });
}
