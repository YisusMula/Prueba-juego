import { Readable } from 'node:stream';
import type { FastifyInstance, FastifyReply } from 'fastify';
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
import { createReportPdf, type PdfInput } from './pdf.js';
import { guardSlowDownload } from '../../http/slow-download.js';

export const MAX_REPORT_DAYS = 366;
/** Tope defensivo de tamaño de un PDF en memoria (5.000 filas ocupan bastante menos). */
export const MAX_PDF_BYTES = 64 * 1024 * 1024;

/** Genera el PDF entero en un búfer. Se aborta si el cliente se desconecta o se supera el tope. */
export function renderPdfToBuffer(input: PdfInput, reply: FastifyReply, maxBytes = MAX_PDF_BYTES): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let settled = false;
    const done = (err: Error | null, buf?: Buffer) => {
      if (settled) return;
      settled = true;
      reply.raw.off('close', onAbort);
      if (err) reject(err);
      else resolve(buf!);
    };
    const doc = createReportPdf(input, (err) => reply.request.log.error({ err }, 'Error generando PDF'));
    const onAbort = () => {
      // Conexión cerrada por el cliente antes de terminar (la respuesta aún no se ha enviado,
      // así que 'close' de la respuesta solo puede ser un aborto): se deja de generar.
      if (!doc.readableEnded) {
        doc.destroy();
        done(new Error('Petición cancelada durante la generación del PDF'));
      }
    };
    reply.raw.once('close', onAbort);
    doc.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxBytes) {
        doc.destroy();
        done(new AppError(400, 'REPORT_TOO_LARGE', 'El informe PDF es demasiado grande. Acota el periodo o los tipos de registro, o descarga el CSV.'));
        return;
      }
      chunks.push(chunk);
    });
    doc.once('end', () => done(null, Buffer.concat(chunks, size)));
    doc.once('error', (err: Error) => done(err));
    doc.once('close', () => done(new Error('La generación del PDF se interrumpió')));
  });
}
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
      .where('r.effective_at', '>=', sql<Date>`(${from}::date)::timestamp AT TIME ZONE ${tz}`)
      .where('r.effective_at', '<', sql<Date>`(${to}::date + 1)::timestamp AT TIME ZONE ${tz}`);
    if (cursor) q = q.where(keysetAfter({ table: 'records', alias: 'r', cursor, orgId: org.id, direction: 'asc', orderColumn: 'effective_at' }));
    // Por fecha del hecho: cada enmienda sale junto a su original.
    const batch = await q.orderBy('r.effective_at').orderBy('r.id').limit(BATCH).execute();
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
        .where('r.effective_at', '>=', sql<Date>`(${from}::date)::timestamp AT TIME ZONE ${tz}`)
        .where('r.effective_at', '<', sql<Date>`(${to}::date + 1)::timestamp AT TIME ZONE ${tz}`)
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
      // Se genera COMPLETO en memoria (acotado: máx. maxPdfRows filas y MAX_PDF_BYTES) y el hueco
      // del semáforo se libera en cuanto termina la GENERACIÓN, no la descarga: un cliente lento
      // que no lee la respuesta no puede retener los huecos y dejar sin PDF al resto.
      const pdf = await renderPdfToBuffer(
        {
          appName: config.appName,
          org: ctx.org,
          from: q.from,
          to: q.to,
          types: q.types,
          records: (type) => iterateRecords(db, ctx.org, q.from, q.to, [type]),
          maxRows,
        },
        reply,
      );
      release();
      guardSlowDownload(reply);
      reply
        .type('application/pdf')
        .header('Content-Length', String(pdf.length))
        .header('Content-Disposition', `attachment; filename="${filename(ctx.org, q.from, q.to, 'pdf')}"`);
      return reply.send(pdf);
    } finally {
      release();
    }
  });

  app.get('/csv', async (req, reply) => {
    const ctx = orgCtx(req);
    const q = parseQuery(req.query);
    await limit('csv', ctx.org.id, ctx.userId);
    // Como en el PDF: si el CSV superaría el máximo se rechaza ANTES de empezar (nunca se corta en silencio).
    const maxRows = config.reports.maxCsvRows;
    const n = await countRecords(db, ctx.org, q.from, q.to, q.types, maxRows + 1);
    if (n > maxRows) {
      throw new AppError(
        400,
        'REPORT_TOO_LARGE',
        `El CSV tendría más de ${maxRows.toLocaleString('es-ES')} registros. Acota el periodo o los tipos de registro y descárgalo en varias partes.`,
      );
    }
    await audit(db, { event: 'report.generated', organizationId: ctx.org.id, userId: ctx.userId, ip: req.ip, metadata: { format: 'csv', from: q.from, to: q.to, types: q.types } });
    const tz = ctx.org.timezone;
    async function* generate(): AsyncGenerator<string> {
      yield '\uFEFF' + csvLine(CSV_HEADERS);
      for await (const batch of iterateRecords(db, ctx.org, q.from, q.to, q.types)) {
        let chunk = '';
        for (const r of batch) chunk += csvLine(csvRow(r, tz));
        yield chunk;
      }
    }
    guardSlowDownload(reply);
    reply.type('text/csv; charset=utf-8').header('Content-Disposition', `attachment; filename="${filename(ctx.org, q.from, q.to, 'csv')}"`);
    return reply.send(Readable.from(generate()));
  });
}
