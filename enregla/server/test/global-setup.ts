import pg from 'pg';
import { runMigrations } from '../src/db/migrate.js';

export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgres://enregla:enregla@localhost:5432/enregla_test';

export default async function setup(): Promise<void> {
  const pool = new pg.Pool({ connectionString: TEST_DATABASE_URL, max: 1 });
  try {
    await pool.query('DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;');
    await runMigrations(pool);
  } finally {
    await pool.end();
  }
}
