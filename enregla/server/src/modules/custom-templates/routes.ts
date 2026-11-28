import type { FastifyInstance } from 'fastify';
import { sql } from 'kysely';
import * as S from '../../schemas/index.js';
import { idParam, parse } from '../../http/validation.js';
import { orgCtx, requireWritable } from '../../http/guards.js';
import { AppError, conflict, notFound } from '../../lib/errors.js';
import { audit } from '../../lib/audit.js';
import { json } from '../../db/index.js';
import type { CustomTemplateItem } from '../../db/types.js';
import { customTemplateView } from '../views.js';

/** Máximo de registros personalizados por local (activos o no). */
export const MAX_CUSTOM_TEMPLATES = 100;

/** Ítems con id estable: los que ya tenían id lo conservan (los registros guardan cada respuesta por id). */
function withIds(items: { id?: string; label: string }[], previous: CustomTemplateItem[] = []): CustomTemplateItem[] {
  const known = new Set(previous.map((i) => i.id));
  const seen = new Set<string>();
  return items.map((i) => {
    const id = i.id && known.has(i.id) && !seen.has(i.id) ? i.id : crypto.randomUUID();
    seen.add(id);
    return { id, label: i.label };
  });
}

/**
 * /api/orgs/:orgId/custom-templates — registros personalizados del local (fase 2, 2B). Desactivar una
 * plantilla no borra sus registros: no hay DELETE (el rol de la app tampoco puede borrarlas).
 */
export async function customTemplateRoutes(app: FastifyInstance): Promise<void> {
  const { db } = app.deps;

  app.get('/', async (req) => {
    const ctx = orgCtx(req);
    const rows = await db
      .selectFrom('custom_record_templates')
      .selectAll()
      .where('organization_id', '=', ctx.org.id)
      .orderBy('created_at')
      .orderBy('id')
      .limit(MAX_CUSTOM_TEMPLATES)
      .execute();
    return {
      items: rows.map(customTemplateView),
      // Plantillas sugeridas, con su fuente; `activated` si el local ya la tiene.
      suggestions: S.SUGGESTED_TEMPLATES.map((t) => ({ ...t, activated: rows.some((r) => r.suggestion_key === t.key && r.active) })),
    };
  });

  async function checkCount(orgId: string) {
    const count = await db.selectFrom('custom_record_templates').select(sql<number>`count(*)::int`.as('n')).where('organization_id', '=', orgId).executeTakeFirstOrThrow();
    if (count.n >= MAX_CUSTOM_TEMPLATES) throw new AppError(409, 'CONFLICT', `Has alcanzado el máximo de ${MAX_CUSTOM_TEMPLATES} registros personalizados`);
  }

  app.post('/', async (req, reply) => {
    const ctx = requireWritable(req);
    const body = parse(S.createCustomTemplateBody, req.body);
    await checkCount(ctx.org.id);
    const row = await db
      .insertInto('custom_record_templates')
      .values({
        organization_id: ctx.org.id,
        name: body.name,
        kind: body.kind,
        items: json(body.kind === 'checklist' ? withIds(body.items) : []),
        unit: body.kind === 'numeric' ? body.unit : null,
        min_value: body.kind === 'numeric' ? body.min : null,
        max_value: body.kind === 'numeric' ? body.max : null,
        frequency: body.frequency,
        times_per_day: body.frequency === 'daily' ? body.timesPerDay : 1,
        weekday: body.frequency === 'weekly' ? body.weekday : null,
        month_day: body.frequency === 'monthly' ? body.monthDay : null,
        instructions: body.instructions,
        reminder_months: body.reminderMonths,
        active: body.active,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    await audit(db, { event: 'custom_template.created', organizationId: ctx.org.id, userId: ctx.userId, ip: req.ip, metadata: { templateId: row.id, name: row.name } });
    return reply.status(201).send({ template: customTemplateView(row) });
  });

  /** Activa con un toque una plantilla sugerida (o la reactiva si ya existía). */
  app.post('/suggestions', async (req, reply) => {
    const ctx = requireWritable(req);
    const body = parse(S.activateSuggestionBody, req.body);
    const sug = S.SUGGESTED_TEMPLATES.find((t) => t.key === body.key);
    if (!sug) throw notFound('Plantilla sugerida');
    const existing = await db.selectFrom('custom_record_templates').selectAll().where('organization_id', '=', ctx.org.id).where('suggestion_key', '=', sug.key).executeTakeFirst();
    if (existing) {
      if (existing.active) return reply.status(200).send({ template: customTemplateView(existing) });
      const row = await db
        .updateTable('custom_record_templates')
        .set({ active: true, updated_at: sql<Date>`now()` })
        .where('id', '=', existing.id)
        .where('organization_id', '=', ctx.org.id)
        .returningAll()
        .executeTakeFirstOrThrow();
      await audit(db, { event: 'custom_template.updated', organizationId: ctx.org.id, userId: ctx.userId, ip: req.ip, metadata: { templateId: row.id, fields: ['active'], suggestion: sug.key } });
      return reply.status(200).send({ template: customTemplateView(row) });
    }
    await checkCount(ctx.org.id);
    const row = await db
      .insertInto('custom_record_templates')
      .values({
        organization_id: ctx.org.id,
        name: sug.name,
        kind: sug.kind,
        items: json(sug.kind === 'checklist' ? withIds((sug.items ?? []).map((label) => ({ label }))) : []),
        unit: sug.unit ?? null,
        min_value: sug.min ?? null,
        max_value: sug.max ?? null,
        frequency: sug.frequency,
        times_per_day: sug.timesPerDay ?? 1,
        weekday: sug.weekday ?? null,
        month_day: sug.monthDay ?? null,
        instructions: sug.instructions,
        reminder_months: sug.reminderMonths ?? null,
        suggestion_key: sug.key,
        source: sug.source,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    await audit(db, { event: 'custom_template.created', organizationId: ctx.org.id, userId: ctx.userId, ip: req.ip, metadata: { templateId: row.id, name: row.name, suggestion: sug.key } });
    return reply.status(201).send({ template: customTemplateView(row) });
  });

  app.patch('/:templateId', async (req) => {
    const ctx = requireWritable(req);
    const id = idParam(req.params, 'templateId', 'Registro personalizado');
    const body = parse(S.updateCustomTemplateBody, req.body);
    const cur = await db.selectFrom('custom_record_templates').selectAll().where('id', '=', id).where('organization_id', '=', ctx.org.id).executeTakeFirst();
    if (!cur) throw notFound('Registro personalizado');
    const frequency = body.frequency ?? cur.frequency;
    const weekday = body.weekday !== undefined ? body.weekday : cur.weekday;
    const monthDay = body.monthDay !== undefined ? body.monthDay : cur.month_day;
    const min = body.min !== undefined ? body.min : cur.min_value;
    const max = body.max !== undefined ? body.max : cur.max_value;
    const details: { path: string; message: string }[] = [];
    if (frequency === 'weekly' && weekday == null) details.push({ path: 'weekday', message: 'Indica el día de la semana' });
    if (frequency === 'monthly' && monthDay == null) details.push({ path: 'monthDay', message: 'Indica el día del mes' });
    if (min != null && max != null && min > max) details.push({ path: 'min', message: 'El mínimo no puede ser mayor que el máximo' });
    if (cur.kind === 'checklist' && body.items !== undefined && body.items.length === 0) details.push({ path: 'items', message: 'Añade al menos un punto a comprobar' });
    if (details.length) throw new AppError(400, 'VALIDATION_ERROR', details[0]!.message, details);
    if (body.items !== undefined && cur.kind !== 'checklist' && body.items.length > 0) throw conflict('Solo las listas de comprobación tienen puntos');
    const row = await db
      .updateTable('custom_record_templates')
      .set({
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.items !== undefined && cur.kind === 'checklist' ? { items: json(withIds(body.items, cur.items)) } : {}),
        ...(cur.kind === 'numeric' ? { min_value: min, max_value: max, ...(body.unit !== undefined ? { unit: body.unit } : {}) } : {}),
        frequency,
        times_per_day: frequency === 'daily' ? (body.timesPerDay ?? cur.times_per_day) : 1,
        weekday: frequency === 'weekly' ? weekday : null,
        month_day: frequency === 'monthly' ? monthDay : null,
        ...(body.instructions !== undefined ? { instructions: body.instructions } : {}),
        ...(body.reminderMonths !== undefined ? { reminder_months: body.reminderMonths } : {}),
        ...(body.active !== undefined ? { active: body.active } : {}),
        updated_at: sql<Date>`now()`,
      })
      .where('id', '=', id)
      .where('organization_id', '=', ctx.org.id)
      .returningAll()
      .executeTakeFirstOrThrow();
    await audit(db, { event: 'custom_template.updated', organizationId: ctx.org.id, userId: ctx.userId, ip: req.ip, metadata: { templateId: id, fields: Object.keys(body) } });
    return { template: customTemplateView(row) };
  });
}
