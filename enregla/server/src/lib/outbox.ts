import { sql } from 'kysely';
import type { DB } from '../db/index.js';
import type { Mailer, MailMessage } from './mailer.js';

/**
 * Bandeja de salida de emails en PostgreSQL.
 *
 * - Se encola (idealmente en la misma transacción que el hecho que lo origina) y se intenta
 *   enviar enseguida, fuera de cualquier transacción.
 * - Si el SMTP falla, se reintenta con backoff (segundos → minutos → horas) hasta ~24 h.
 * - Segura con varias instancias: cada fila se "reclama" con FOR UPDATE SKIP LOCKED y un
 *   arrendamiento (next_attempt_at en el futuro), así que nunca la envían dos procesos a la vez
 *   y, si un proceso muere a mitad de envío, otra instancia la reintenta al vencer el arrendamiento.
 * - Almacenamiento temporal: los cuerpos pueden llevar enlaces con token. Las enviadas se purgan
 *   a las SENT_RETENTION_HOURS y las fallidas definitivas a los FAILED_RETENTION_DAYS.
 */

/** Espera tras el intento n (1-based) antes del siguiente. Suma ≈ 24 h. */
export const BACKOFF_SECONDS = [30, 120, 600, 1800, 3600, 7200, 14_400, 28_800, 28_800];
export const MAX_ATTEMPTS = BACKOFF_SECONDS.length + 1;
/** Pasado este tiempo desde el encolado no se reintenta más. */
export const MAX_AGE_HOURS = 26;
/** Tiempo que una fila reclamada queda reservada para el proceso que la envía. */
const LEASE_SECONDS = 120;
export const SENT_RETENTION_HOURS = 6;
export const FAILED_RETENTION_DAYS = 3;

export interface OutboxRow {
  id: string;
  to_address: string;
  subject: string;
  text_body: string;
  html_body: string;
  attempts: number;
  created_at: Date;
}

export async function enqueueEmail(db: DB, message: MailMessage): Promise<string> {
  const row = await db
    .insertInto('email_outbox')
    .values({ to_address: message.to, subject: message.subject, text_body: message.text, html_body: message.html, next_attempt_at: sql<Date>`now()` })
    .returning('id')
    .executeTakeFirstOrThrow();
  return row.id;
}

/**
 * Resumen del error SIN datos sensibles: código y respuesta SMTP, sin direcciones ni tokens.
 */
export function summarizeError(err: unknown): string {
  const e = (err ?? {}) as { code?: unknown; responseCode?: unknown; command?: unknown; message?: unknown };
  const parts = [typeof e.code === 'string' ? e.code : null, typeof e.responseCode === 'number' ? `SMTP ${e.responseCode}` : null, typeof e.command === 'string' ? e.command : null];
  let msg = typeof e.message === 'string' ? e.message : String(err);
  msg = msg
    .replace(/[^\s<>"']+@[^\s<>"']+/g, '[email]')
    .replace(/token=[A-Za-z0-9_-]+/g, 'token=[…]')
    .replace(/https?:\/\/\S+/g, '[url]')
    .replace(/\s+/g, ' ')
    .slice(0, 160);
  return [...parts.filter(Boolean), msg].join(' · ').slice(0, 240);
}

/** Reclama filas pendientes y vencidas (o las indicadas) para enviarlas. */
async function claim(db: DB, opts: { ids?: string[]; limit: number }): Promise<OutboxRow[]> {
  if (opts.ids && opts.ids.length === 0) return [];
  const idFilter = opts.ids ? sql`AND id = ANY(${opts.ids}::uuid[])` : sql``;
  const r = await sql<OutboxRow>`
    UPDATE email_outbox o
    SET attempts = o.attempts + 1, next_attempt_at = now() + make_interval(secs => ${LEASE_SECONDS})
    WHERE o.id IN (
      SELECT id FROM email_outbox
      WHERE status = 'pending' AND next_attempt_at <= now() ${idFilter}
      ORDER BY next_attempt_at
      LIMIT ${opts.limit}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING o.id, o.to_address, o.subject, o.text_body, o.html_body, o.attempts, o.created_at`.execute(db);
  return r.rows;
}

export interface OutboxResult {
  sent: number;
  retried: number;
  failed: number;
}

async function deliver(db: DB, mailer: Mailer, row: OutboxRow, onError?: (err: unknown, row: OutboxRow) => void): Promise<'sent' | 'retried' | 'failed'> {
  try {
    await mailer.send({ to: row.to_address, subject: row.subject, text: row.text_body, html: row.html_body });
    await db.updateTable('email_outbox').set({ status: 'sent', sent_at: sql<Date>`now()`, last_error: null }).where('id', '=', row.id).execute();
    return 'sent';
  } catch (err) {
    onError?.(err, row);
    const tooOld = Date.now() - row.created_at.getTime() > MAX_AGE_HOURS * 3600_000;
    const final = row.attempts >= MAX_ATTEMPTS || tooOld;
    const wait = BACKOFF_SECONDS[Math.min(row.attempts, BACKOFF_SECONDS.length) - 1] ?? BACKOFF_SECONDS[0]!;
    await db
      .updateTable('email_outbox')
      .set({
        status: final ? 'failed' : 'pending',
        last_error: summarizeError(err),
        next_attempt_at: final ? sql<Date>`now()` : sql<Date>`now() + make_interval(secs => ${wait})`,
      })
      .where('id', '=', row.id)
      .execute();
    return final ? 'failed' : 'retried';
  }
}

/**
 * Envía lo pendiente y vencido (o solo `ids`). Nunca lanza por errores de SMTP: los registra
 * en la fila y programa el reintento.
 */
export async function processOutbox(
  db: DB,
  mailer: Mailer,
  opts: { ids?: string[]; limit?: number; onError?: (err: unknown, row: OutboxRow) => void } = {},
): Promise<OutboxResult> {
  const result: OutboxResult = { sent: 0, retried: 0, failed: 0 };
  const rows = await claim(db, { ids: opts.ids, limit: opts.limit ?? 20 });
  for (const row of rows) result[await deliver(db, mailer, row, opts.onError)] += 1;
  return result;
}

/** Purga del almacenamiento temporal de emails. */
export async function purgeOutbox(db: DB): Promise<number> {
  const r = await db
    .deleteFrom('email_outbox')
    .where((eb) =>
      eb.or([
        eb.and([eb('status', '=', 'sent'), eb('sent_at', '<', sql<Date>`now() - make_interval(hours => ${SENT_RETENTION_HOURS})`)]),
        eb.and([eb('status', '=', 'failed'), eb('created_at', '<', sql<Date>`now() - make_interval(days => ${FAILED_RETENTION_DAYS})`)]),
      ]),
    )
    .executeTakeFirst();
  return Number(r.numDeletedRows);
}
