import { Readable } from 'node:stream';
import type { FastifyInstance } from 'fastify';
import { sql } from 'kysely';
import * as S from '../../schemas/index.js';
import { parse } from '../../http/validation.js';
import { orgCtx } from '../../http/guards.js';
import { AppError, badRequest, rateLimited } from '../../lib/errors.js';
import { enforce } from '../../lib/rate-limit.js';
import { audit } from '../../lib/audit.js';
import { diffDays } from '../../lib/dates.js';
import { keysetAfter } from '../../lib/pagination.js';
import type { DB } from '../../db/index.js';
import type { Organization } from '../../db/types.js';
import { amendedBySelect } from '../records/routes.js';
import { CSV_HEADERS, csvLine, csvRow, type ReportRecord } from './format.js';
import { createReportPdf } from './pdf.js';

export const MAX_REPORT_DAYS = 366;
export const MAX_CSV_ROWS = 500_000;
const BATCH = 500;

/** Itera los registros de un tipo en el rango [from, to] (fechas locales) por lotes. */
export async function* iterateRecords(db: DB, org: Organization, from: string, to: string, types: S.RecordType[]): AsyncGenerator<ReportRecord[]> {
  const tz = org.timezone;
  let cursor: string | null = null;
  for (;;) {
    let q = db
      .selectFrom('records as r')
      .selectAll('r')
      .select(amendedBySelect())
      .where('r.organization_id', '=', org.id)
      .where('r.type', 'in', types)
      .where('r.created_at', '>=', sql<Date>`(${from}::date)::timestamp AT TIME ZONE ${tz}`)
      .where('r.created_at', '<', sql<Date>`(${to}::date + 1)::timestamp AT TIME ZONE ${tz}`);
    if (cursor) q = q.where(keysetAfter({ table: 'records', alias: 'r', cursor, orgId: org.id, direction: 'asc' }));
    const batch = await q.orderBy('r.created_at').orderBy('r.id').limit(BATCH).execute();
    if (batch.length > 0) yield batch;
    if (batch.length < BATCH) return;
    cursor = batch[batch.length - 1]!.id;
  }
}

function filename(org: Organization, from: string, to: string, ext: string): string {
  const slug = org.name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40)
    .toLowerCase();
  return `registros-${slug || 'local'}-${from}-a-${to}.${ext}`;
}

/** Cuenta (con tope) las filas que entrarían en el informe, sin leerlas. */
async function countRecords(db: DB, org: Organization, from: string, to: string, types: S.RecordType[], cap: number): Promise<number> {
  const tz = org.timezone;
  const r = await db
    .selectFrom((eb) =>
      eb
        .selectFrom('records as r')
        .select(sql<number>`1`.as('x'))
        .where('r.organization_id', '=', org.id)
        .where('r.type', 'in', types)
        .where('r.created_at', '>=', sql<Date>`(${from}::date)::timestamp AT TIME ZONE ${tz}`)
        .where('r.created_at', '<', sql<Date>`(${to}::date + 1)::timestamp AT TIME ZONE ${tz}`)
        .limit(cap)
        .as('s'),
    )
    .select(sql<number>`count(*)::int`.as('n'))
    .executeTakeFirstOrThrow();
  return r.n;
}

export async function reportRoutes(app: FastifyInstance): Promise<void> {
  const { db, config, rateLimiter } = app.deps;

  function parseQuery(query: unknown) {
    const q = parse(S.reportQuery, query);
    if (diffDays(q.from, q.to) + 1 > MAX_REPORT_DAYS) throw badRequest('El periodo máximo de un informe es de 1 año');
    return q;
  }

  async function limit(kind: 'pdf' | 'csv', orgId: string, userId: string): Promise<void> {
    const rule = kind === 'pdf' ? config.rateLimits.reportPdf : config.rateLimits.reportCsv;
    const msg = `Has generado demasiados informes ${kind.toUpperCase()} en poco tiempo. Espera unos minutos.`;
    await enforce(rateLimiter, `report:${kind}:org:${orgId}`, rule, msg);
    await enforce(rateLimiter, `report:${kind}:user:${userId}`, rule, msg);
  }

  app.get('/pdf', async (req, reply) => {
    const ctx = orgCtx(req);
    const q = parseQuery(req.query);
    // Hueco global por proceso: si ya hay N PDF generándose, 429 inmediato (sin cola).
    const release = app.pdfSlots.tryAcquire();
    if (!release) {
      throw rateLimited(config.reports.pdfBusyRetrySeconds, 'Ahora mismo se están generando otros informes PDF. Inténtalo de nuevo en unos segundos.');
    }
    try {
      await limit('pdf', ctx.org.id, ctx.userId);
      const maxRows = config.reports.maxPdfRows;
      const n = await countRecords(db, ctx.org, q.from, q.to, q.types, maxRows + 1);
      if (n > maxRows) {
        throw new AppError(
          400,
          'REPORT_TOO_LARGE',
          `El informe PDF tendría más de ${maxRows.toLocaleString('es-ES')} registros. Acota el periodo o los tipos de registro, o descarga el CSV (admite muchas más filas).`,
        );
      }
      await audit(db, { event: 'report.generated', organizationId: ctx.org.id, userId: ctx.userId, ip: req.ip, metadata: { format: 'pdf', from: q.from, to: q.to, types: q.types } });
      const doc = createReportPdf(
        {
          appName: config.appName,
          org: ctx.org,
          from: q.from,
          to: q.to,
          types: q.types,
          records: (type) => iterateRecords(db, ctx.org, q.from, q.to, [type]),
          maxRows,
        },
        (err) => req.log.error({ err }, 'Error generando PDF'),
      );
      // Se libera el hueco al terminar, fallar o cortarse la descarga.
      doc.once('close', release);
      doc.once('error', release);
      reply.raw.once('close', () => {
        release();
        if (!doc.destroyed && !doc.readableEnded) doc.destroy();
      });
      reply.type('application/pdf').header('Content-Disposition', `attachment; filename="${filename(ctx.org, q.from, q.to, 'pdf')}"`);
      return reply.send(doc);
    } catch (err) {
      release();
      throw err;
    }
  });

  app.get('/csv', async (req, reply) => {
    const ctx = orgCtx(req);
    const q = parseQuery(req.query);
    await limit('csv', ctx.org.id, ctx.userId);
    await audit(db, { event: 'report.generated', organizationId: ctx.org.id, userId: ctx.userId, ip: req.ip, metadata: { format: 'csv', from: q.from, to: q.to, types: q.types } });
    const tz = ctx.org.timezone;
    async function* generate(): AsyncGenerator<string> {
      yield '\uFEFF' + csvLine(CSV_HEADERS);
      let n = 0;
      for await (const batch of iterateRecords(db, ctx.org, q.from, q.to, q.types)) {
        let chunk = '';
        for (const r of batch) {
          if (n++ >= MAX_CSV_ROWS) break;
          chunk += csvLine(csvRow(r, tz));
        }
        yield chunk;
        if (n >= MAX_CSV_ROWS) break;
      }
    }
    reply.type('text/csv; charset=utf-8').header('Content-Disposition', `attachment; filename="${filename(ctx.org, q.from, q.to, 'csv')}"`);
    return reply.send(Readable.from(generate()));
  });
}
