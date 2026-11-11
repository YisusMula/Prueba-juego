/**
 * Genera UNA VEZ el PDF de ejemplo de la demo con el servidor de verdad (pdfkit):
 *  1. base de datos propia y desechable (`enregla_demo_pdf`), rellenada con el seed demo,
 *  2. servidor aislado en un puerto libre (nunca el 3000),
 *  3. entra con la cuenta demo y descarga el informe PDF de los últimos 30 días,
 *  4. guarda src/demo/public/informe-ejemplo.pdf y una imagen de la primera página (pdftoppm).
 * Uso: npm run demo:pdf   (requiere PostgreSQL como el de la suite e2e y `pdftoppm`).
 * No modifica nada de enregla/server.
 */
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const here = path.dirname(fileURLToPath(import.meta.url));
const serverDir = path.resolve(here, '../../server');
const outDir = path.resolve(here, '../src/demo/public');
const ADMIN_URL = process.env.DEMO_PDF_ADMIN_DATABASE_URL ?? 'postgres://enregla:enregla@localhost:5432/postgres';
const DB_NAME = 'enregla_demo_pdf';
const DB_URL = new URL(ADMIN_URL);
DB_URL.pathname = `/${DB_NAME}`;

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => (port === 3000 ? freePort().then(resolve, reject) : resolve(port)));
    });
  });
}

async function recreateDb(drop) {
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`);
  if (!drop) await admin.query(`CREATE DATABASE ${DB_NAME}`);
  await admin.end();
}

const port = await freePort();
const appUrl = `http://localhost:${port}`;
const env = {
  ...process.env,
  NODE_ENV: 'development',
  PORT: String(port),
  HOST: '127.0.0.1',
  APP_URL: appUrl,
  DATABASE_URL: DB_URL.toString(),
  MAIL_TRANSPORT: 'console',
  LOG_LEVEL: 'warn',
  SCHEDULER_ENABLED: 'false',
  DEV_ORIGINS: '',
};
const tsx = path.join(serverDir, 'node_modules/.bin/tsx');

await recreateDb(false);
const seed = spawnSync(tsx, ['src/scripts/seed-demo.ts'], { cwd: serverDir, env, encoding: 'utf8' });
if (seed.status !== 0) {
  console.error(seed.stdout, seed.stderr);
  process.exit(1);
}
const email = /Usuario:\s+(\S+)/.exec(seed.stdout)?.[1];
const password = /Contraseña:\s+(\S+)/.exec(seed.stdout)?.[1];

const child = spawn(tsx, ['src/server.ts'], { cwd: serverDir, env, stdio: ['ignore', 'ignore', 'pipe'] });
let stderr = '';
child.stderr.on('data', (d) => (stderr += d));
const stop = async () => {
  child.kill('SIGTERM');
  await new Promise((r) => child.once('exit', r));
  await recreateDb(true);
};

try {
  for (let i = 0; ; i++) {
    try {
      if ((await fetch(`${appUrl}/healthz`)).ok) break;
    } catch {
      // aún arrancando
    }
    if (i > 120) throw new Error(`El servidor no arrancó:\n${stderr}`);
    await new Promise((r) => setTimeout(r, 500));
  }
  const headers = { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest', Origin: appUrl };
  const login = await fetch(`${appUrl}/api/auth/login`, { method: 'POST', headers, body: JSON.stringify({ email, password }) });
  if (!login.ok) throw new Error(`Login fallido: ${login.status} ${await login.text()}`);
  const cookie = login.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
  const orgs = await (await fetch(`${appUrl}/api/orgs`, { headers: { Cookie: cookie } })).json();
  const org = orgs.items[0];
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: org.timezone }).format(new Date());
  const from = new Date(`${today}T00:00:00Z`);
  from.setUTCDate(from.getUTCDate() - 30);
  const q = new URLSearchParams({ from: from.toISOString().slice(0, 10), to: today });
  const res = await fetch(`${appUrl}/api/orgs/${org.id}/reports/pdf?${q}`, { headers: { Cookie: cookie } });
  if (!res.ok || res.headers.get('content-type') !== 'application/pdf') throw new Error(`PDF fallido: ${res.status} ${await res.text()}`);
  const pdf = Buffer.from(await res.arrayBuffer());
  mkdirSync(outDir, { recursive: true });
  const pdfPath = path.join(outDir, 'informe-ejemplo.pdf');
  writeFileSync(pdfPath, pdf);
  const png = spawnSync('pdftoppm', ['-png', '-r', '90', '-f', '1', '-l', '1', '-singlefile', pdfPath, path.join(outDir, 'informe-ejemplo-p1')], { encoding: 'utf8' });
  if (png.status !== 0) throw new Error(`pdftoppm: ${png.stderr}`);
  console.log(`PDF de ejemplo: ${pdfPath} (${(pdf.length / 1024).toFixed(0)} KB, ${q.get('from')} a ${q.get('to')}) y vista previa de la primera página.`);
} finally {
  await stop();
}
