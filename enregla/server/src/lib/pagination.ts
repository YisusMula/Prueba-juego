import { sql, type Expression, type SqlBool } from 'kysely';

/**
 * Condición keyset para paginar por (created_at, id). El cursor es el id del último
 * elemento de la página anterior; se resuelve con una subconsulta restringida a la
 * organización, así que un cursor ajeno simplemente devuelve una página vacía.
 */
export function keysetAfter(opts: {
  table: string;
  alias: string;
  idColumn?: string;
  cursor: string;
  orgId: string;
  direction: 'asc' | 'desc';
}): Expression<SqlBool> {
  const idCol = opts.idColumn ?? 'id';
  const op = sql.raw(opts.direction === 'asc' ? '>' : '<');
  return sql<SqlBool>`(${sql.ref(`${opts.alias}.created_at`)}, ${sql.ref(`${opts.alias}.${idCol}`)}) ${op} (
    SELECT c.created_at, c.${sql.ref(idCol)} FROM ${sql.table(opts.table)} c
    WHERE c.${sql.ref(idCol)} = ${opts.cursor} AND c.organization_id = ${opts.orgId}
  )`;
}

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

/** Recibe `limit + 1` filas y construye la página. */
export function toPage<T, R = T>(rows: T[], limit: number, cursorOf: (row: T) => string, map?: (row: T) => R): Page<R> {
  const hasMore = rows.length > limit;
  const slice = hasMore ? rows.slice(0, limit) : rows;
  return {
    items: map ? slice.map(map) : (slice as unknown as R[]),
    nextCursor: hasMore ? cursorOf(slice[slice.length - 1]!) : null,
  };
}
