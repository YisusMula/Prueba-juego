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
import { MAX_PDF_BYTES, renderPdfInProcess, renderPdfInWorker, type PdfJob } from './pdf-render.js';
import { computeCompliance } from '../tasks/service.js';
import { guardSlowDownload } from '../../http/slow-download.js';

export const MAX_REPORT_DAYS = 366;
export { MAX_PDF_BYTES };

/**
 * Presupuesto de tiempo de generación de PDF por local y hora (B-2), en la tabla `rate_limits`
 * (compartida entre instancias): `count` acumula milisegundos de generación en la ventana.
 */
const PDF_BUDGET_WINDOW_SECONDS = 3600;
async function pdfBudgetUsed(db: DB, key: string): Promise<{ usedMs: number; retryAfter: number }> {
  const r = await sql<{ count: number; retry: number }>`
    SELECT count, CEIL(EXTRACT(EPOCH FROM (reset_at - now())))::int AS retry
    FROM rate_limits WHERE key = ${key} AND reset_at > now()`.execute(db);
  const row = r.rows[0];
  return { usedMs: row?.count ?? 0, retryAfter: Math.max(1, row?.retry ?? 1) };
}
async function addPdfBudget(db: DB, key: string, ms: number): Promise<void> {
  const add = Math.max(1, Math.min(Math.round(ms), 2_000_000_000));
  await sql`
    INSERT INTO rate_limits (key, count, reset_at)
    VALUES (${key}, ${add}, now() + make_interval(secs => ${PDF_BUDGET_WINDOW_SECONDS}))
    ON CONFLICT (key) DO UPDATE SET
      count = CASE WHEN rate_limits.reset_at <= now() THEN ${add} ELSE least(rate_limits.count::bigint + ${add}, 2000000000)::int END,
      reset_at = CASE WHEN rate_limits.reset_at <= now() THEN now() + make_interval(secs => ${PDF_BUDGET_WINDOW_SECONDS}) ELSE rate_limits.reset_at END`.execute(db);
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
      // Cuándo y quién corrigió el registro (para «Corregido el … por …», sin ids internos).
      .select(sql<Date | null>`(SELECT a.created_at FROM records a WHERE a.amends_record_id = r.id)`.as('amended_at'))
      .select(sql<string | null>`(SELECT coalesce(a.staff_name, a.user_name) FROM records a WHERE a.amends_record_id = r.id)`.as('amended_by_name'))
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

  // Un PDF en generación (o esperando en la cola) a la vez por local y por usuario (B-2).
  const pdfBusyOrgs = new Set<string>();
  const pdfBusyUsers = new Set<string>();

  app.get('/pdf', async (req, reply) => {
    const ctx = orgCtx(req);
    const q = parseQuery(req.query);
    const r = config.reports;
    if (pdfBusyOrgs.has(ctx.org.id)) {
      throw rateLimited(r.pdfBusyRetrySeconds, 'Ya se está generando un informe PDF de este local. Espera a que termine y vuelve a intentarlo.');
    }
    if (pdfBusyUsers.has(ctx.userId)) {
      throw rateLimited(r.pdfBusyRetrySeconds, 'Ya estás generando otro informe PDF. Espera a que termine y vuelve a intentarlo.');
    }
    pdfBusyOrgs.add(ctx.org.id);
    pdfBusyUsers.add(ctx.userId);
    let release: (() => void) | null = null;
    const abort = new AbortController();
    const onClose = () => {
      // Conexión cerrada por el cliente antes de responder: se deja de esperar/generar.
      if (!reply.raw.writableEnded) abort.abort();
    };
    reply.raw.once('close', onClose);
    try {
      await limit('pdf', ctx.org.id, ctx.userId);
      const budgetKey = `pdf-budget:org:${ctx.org.id}`;
      const budget = await pdfBudgetUsed(db, budgetKey);
      if (budget.usedMs >= r.pdfBudgetMsPerHour) {
        throw rateLimited(
          budget.retryAfter,
          'Este local ha agotado el tiempo de generación de informes PDF de esta hora. Inténtalo más tarde o descarga el CSV.',
        );
      }
      const maxRows = r.maxPdfRows;
      const n = await countRecords(db, ctx.org, q.from, q.to, q.types, maxRows + 1);
      if (n > maxRows) {
        throw new AppError(
          400,
          'REPORT_TOO_LARGE',
          `El informe PDF tendría más de ${maxRows.toLocaleString('es-ES')} registros. Acota el periodo o los tipos de registro, o descarga el CSV (admite muchas más filas).`,
        );
      }
      // Cola corta y justa (FIFO) para los huecos globales: espera como mucho pdfQueueMaxWaitMs.
      release = await app.pdfSlots.acquire(r.pdfQueueMaxWaitMs, abort.signal);
      if (!release) {
        throw rateLimited(r.pdfBusyRetrySeconds, 'Ahora mismo se están generando muchos informes PDF. Inténtalo de nuevo en unos segundos.');
      }
      // Datos acotados (máx. maxRows filas) cargados aquí; la maquetación va a un worker_thread.
      const records: PdfJob['records'] = {};
      let loaded = 0;
      for (const type of q.types) {
        const list: ReportRecord[] = [];
        for await (const batch of iterateRecords(db, ctx.org, q.from, q.to, [type])) {
          for (const rec of batch) if (loaded < maxRows) {
            list.push(rec);
            loaded += 1;
          }
          if (loaded >= maxRows) break;
        }
        records[type] = list;
      }
      const compliance = await computeCompliance(db, ctx.org, q.from, q.to, app.deps.now());
      const dayNotes = compliance.days.filter((d) => d.correctedLater > 0);
      await audit(db, { event: 'report.generated', organizationId: ctx.org.id, userId: ctx.userId, ip: req.ip, metadata: { format: 'pdf', from: q.from, to: q.to, types: q.types } });
      const job: PdfJob = { appName: config.appName, org: ctx.org, from: q.from, to: q.to, types: q.types, records, maxRows, dayNotes, maxBytes: MAX_PDF_BYTES };
      const t0 = performance.now();
      let pdf: Buffer;
      try {
        pdf = r.pdfWorker ? await renderPdfInWorker(job, abort.signal) : await renderPdfInProcess(job, abort.signal);
      } finally {
        // El tiempo de generación cuenta para el presupuesto del local aunque falle o se cancele.
        await addPdfBudget(db, budgetKey, performance.now() - t0).catch((err: unknown) => req.log.warn({ err }, 'No se pudo anotar el presupuesto de PDF'));
      }
      // El hueco se libera al terminar la GENERACIÓN, no la descarga: un cliente lento que no
      // lee la respuesta no puede retener los huecos y dejar sin PDF al resto.
      release();
      pdfBusyOrgs.delete(ctx.org.id);
      pdfBusyUsers.delete(ctx.userId);
      guardSlowDownload(reply);
      reply
        .type('application/pdf')
        .header('Content-Length', String(pdf.length))
        .header('Content-Disposition', `attachment; filename="${filename(ctx.org, q.from, q.to, 'pdf')}"`);
      return reply.send(pdf);
    } catch (err) {
      if (abort.signal.aborted && !(err instanceof AppError)) req.log.info('Generación de PDF cancelada por el cliente');
      throw err;
    } finally {
      reply.raw.off('close', onClose);
      release?.();
      pdfBusyOrgs.delete(ctx.org.id);
      pdfBusyUsers.delete(ctx.userId);
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
