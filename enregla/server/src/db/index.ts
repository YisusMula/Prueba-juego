import pg from 'pg';
import { Kysely, PostgresDialect } from 'kysely';
import type { Database } from './types.js';

// DATE (oid 1082) como texto 'YYYY-MM-DD' para evitar desplazamientos de zona horaria.
pg.types.setTypeParser(1082, (v) => v);
// INT8 (bigint) como número: solo se usa para contadores y ids de auditoría pequeños.
pg.types.setTypeParser(20, (v) => Number(v));

export type DB = Kysely<Database>;

export function createPool(databaseUrl: string, max: number): pg.Pool {
  return new pg.Pool({ connectionString: databaseUrl, max, idleTimeoutMillis: 30_000, connectionTimeoutMillis: 10_000 });
}

export function createDb(pool: pg.Pool): DB {
  return new Kysely<Database>({ dialect: new PostgresDialect({ pool }) });
}

/** Serializa a JSON para columnas jsonb. */
export function json(value: unknown): string {
  return JSON.stringify(value);
}
