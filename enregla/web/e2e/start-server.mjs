/**
 * Arranca un servidor de EnRegla AISLADO para la suite e2e:
 *  - base de datos propia `enregla_e2e` (se crea si no existe; el seed demo la rellena),
 *  - puerto 3100 con APP_URL http://localhost:3100 (CSRF y enlaces de email coherentes),
 *  - sirve el build de producción de web/dist (con la CSP real del servidor),
 *  - MAIL_TRANSPORT=console: los emails (con sus enlaces #token=) se escriben en
 *    e2e/.runtime/server.log, de donde los leen las pruebas. No se modifica el servidor.
 */
import { spawn, spawnSync } from 'node:child_process';
import { createWriteStream, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import pg from 'pg';

const here = path.dirname(fileURLToPath(import.meta.url));
const serverDir = path.resolve(here, '../../server');
const runtime = path.join(here, '.runtime');
mkdirSync(runtime, { recursive: true });

const PORT = process.env.E2E_PORT ?? '3100';
const ADMIN_URL = process.env.E2E_ADMIN_DATABASE_URL ?? 'postgres://enregla:enregla@localhost:5432/postgres';
const DB_URL = process.env.E2E_DATABASE_URL ?? 'postgres://enregla:enregla@localhost:5432/enregla_e2e';

const admin = new pg.Client({ connectionString: ADMIN_URL });
await admin.connect();
const exists = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [new URL(DB_URL).pathname.slice(1)]);
if (exists.rowCount === 0) await admin.query(`CREATE DATABASE ${new URL(DB_URL).pathname.slice(1)}`);
await admin.end();

const env = {
  ...process.env,
  NODE_ENV: 'development',
  PORT,
  HOST: '127.0.0.1',
  APP_URL: `http://localhost:${PORT}`,
  DATABASE_URL: DB_URL,
  MAIL_TRANSPORT: 'console',
  LOG_LEVEL: 'warn',
  SCHEDULER_ENABLED: 'false',
  WEB_DIST_DIR: path.resolve(here, '../dist'),
  DEV_ORIGINS: '',
};

const tsx = path.join(serverDir, 'node_modules/.bin/tsx');
const seed = spawnSync(tsx, ['src/scripts/seed-demo.ts'], { cwd: serverDir, env, encoding: 'utf8' });
if (seed.status !== 0) {
  console.error(seed.stdout, seed.stderr);
  process.exit(1);
}
writeFileSync(path.join(runtime, 'seed.txt'), seed.stdout);

// Contadores de límite de peticiones a cero en cada ejecución.
const db = new pg.Client({ connectionString: DB_URL });
await db.connect();
await db.query('TRUNCATE rate_limits');
await db.end();

const log = createWriteStream(path.join(runtime, 'server.log'), { flags: 'w' });
const child = spawn(tsx, ['src/server.ts'], { cwd: serverDir, env, stdio: ['ignore', 'pipe', 'pipe'] });
child.stdout.pipe(log);
child.stderr.pipe(log);
child.stderr.pipe(process.stderr);
const stop = () => child.kill('SIGTERM');
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
child.on('exit', (code) => process.exit(code ?? 0));
