import type { FastifyRequest } from 'fastify';
import { sql } from 'kysely';
import type { DB } from '../../db/index.js';
import type { RecordRow } from '../../db/types.js';
import { AppError, conflict } from '../../lib/errors.js';
import { sha256 } from '../../lib/crypto.js';

/** Las claves se conservan este tiempo (la purga diaria borra las más antiguas). */
export const IDEMPOTENCY_RETENTION_DAYS = 7;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Lee la cabecera Idempotency-Key (UUID). Ausente → null; mal formada → 400. */
export function idempotencyKey(req: FastifyRequest): string | null {
  const raw = req.headers['idempotency-key'];
  if (raw === undefined) return null;
  const v = Array.isArray(raw) ? raw[0] : raw;
  if (typeof v !== 'string' || !UUID_RE.test(v.trim())) {
    throw new AppError(400, 'VALIDATION_ERROR', 'La cabecera Idempotency-Key debe ser un UUID', [{ path: 'Idempotency-Key', message: 'Debe ser un UUID' }]);
  }
  return v.trim().toLowerCase();
}

/** JSON con claves ordenadas: el mismo cuerpo produce siempre la misma huella. */
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value as Record<string, unknown>)
      .sort()
      .filter((k) => (value as Record<string, unknown>)[k] !== undefined)
      .map((k) => `${JSON.stringify(k)}:${stable((value as Record<string, unknown>)[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

export function requestHash(scope: string, payload: unknown): string {
  return sha256(`${scope}\n${stable(payload)}`);
}

/**
 * Crea un registro como mucho una vez por (organización, clave). Repetir la petición con la misma
 * clave y el mismo cuerpo devuelve el registro ya creado (`replayed: true`), también con peticiones
 * simultáneas: la segunda espera en el índice único a que la primera confirme. La misma clave con
 * otro cuerpo → 409.
 */
export async function withIdempotency(
  db: DB,
  opts: { orgId: string; key: string | null; scope: string; payload: unknown },
  create: (db: DB) => Promise<RecordRow>,
): Promise<{ record: RecordRow; replayed: boolean }> {
  if (!opts.key) return { record: await create(db), replayed: false };
  const key = opts.key;
  const hash = requestHash(opts.scope, opts.payload);
  return db.transaction().execute(async (trx) => {
    const claimed = await trx
      .insertInto('idempotency_keys')
      .values({ organization_id: opts.orgId, key, request_hash: hash })
      .onConflict((oc) => oc.columns(['organization_id', 'key']).doNothing())
      .returning('key')
      .executeTakeFirst();
    if (!claimed) {
      const prev = await trx
        .selectFrom('idempotency_keys')
        .select(['request_hash', 'record_id'])
        .where('organization_id', '=', opts.orgId)
        .where('key', '=', key)
        .executeTakeFirstOrThrow();
      if (prev.request_hash !== hash || !prev.record_id) {
        throw conflict('Esta clave de idempotencia ya se usó con otra petición distinta. Genera una clave nueva para cada registro.');
      }
      const record = await trx
        .selectFrom('records as r')
        .selectAll('r')
        .select(sql<string | null>`(SELECT a.id FROM records a WHERE a.amends_record_id = r.id)`.as('amended_by'))
        .where('r.id', '=', prev.record_id)
        .executeTakeFirstOrThrow();
      return { record, replayed: true };
    }
    const record = await create(trx);
    await trx.updateTable('idempotency_keys').set({ record_id: record.id }).where('organization_id', '=', opts.orgId).where('key', '=', key).execute();
    return { record, replayed: false };
  });
}
