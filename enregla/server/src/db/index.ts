import pg from 'pg';
import { Kysely, PostgresDialect } from 'kysely';
import type { Database } from './types.js';

// DATE (oid 1082) como texto 'YYYY-MM-DD' para evitar desplazamientos de zona horaria.
pg.types.setTypeParser(1082, (v) => v);
// INT8 (bigint) como número: solo se usa para contadores y ids de auditoría pequeños.
pg.types.setTypeParser(20, (v) => Number(v));

export type DB = Kysely<Database>;

/** Límites por conexión: ninguna consulta ni transacción abierta puede bloquear el pool indefinidamente. */
export const DB_TIMEOUTS = {
  /** Máximo por sentencia (los informes leen por lotes, así que ninguna consulta normal se acerca). */
  statementMs: 30_000,
  /** Sesión con una transacción abierta sin actividad: PostgreSQL la corta. */
  idleInTransactionMs: 60_000,
  /** Espera de bloqueos. */
  lockMs: 15_000,
  /** Tiempo máximo para obtener una conexión del pool (o abrir una nueva). */
  connectMs: 5_000,
  idleMs: 30_000,
};

export function createPool(databaseUrl: string, max: number, opts: { applicationName?: string } = {}): pg.Pool {
  const pool = new pg.Pool({
    connectionString: databaseUrl,
    max,
    idleTimeoutMillis: DB_TIMEOUTS.idleMs,
    connectionTimeoutMillis: DB_TIMEOUTS.connectMs,
    statement_timeout: DB_TIMEOUTS.statementMs,
    idle_in_transaction_session_timeout: DB_TIMEOUTS.idleInTransactionMs,
    lock_timeout: DB_TIMEOUTS.lockMs,
    application_name: opts.applicationName ?? 'enregla',
    keepAlive: true,
  });
  // Un cliente inactivo del pool que pierde la conexión (reinicio o corte de PostgreSQL,
  // pg_terminate_backend…) emite 'error' en el pool. Sin manejador, Node lo convierte en una
  // excepción no capturada y el proceso muere. El pool descarta ese cliente y abre otro en la
  // siguiente petición. buildApp añade además un manejador que lo registra con el logger.
  pool.on('error', (err) => {
    if (pool.listenerCount('error') === 1) console.error(`[pg] error en una conexión inactiva del pool: ${err.message}`);
  });
  return pool;
}

export function createDb(pool: pg.Pool): DB {
  return new Kysely<Database>({ dialect: new PostgresDialect({ pool }) });
}

/** Serializa a JSON para columnas jsonb. */
export function json(value: unknown): string {
  return JSON.stringify(value);
}
