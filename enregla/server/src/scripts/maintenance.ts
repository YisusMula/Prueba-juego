/**
 * Mantenimiento de la base de datos con el ROL PROPIETARIO (servicio `maintenance` de los compose).
 * Purga los locales vencidos o con eliminación inmediata pedida por su titular y la auditoría antigua.
 * Uso: node dist/scripts/maintenance.js [--loop SEGUNDOS]
 * Conexión: DATABASE_URL o PGHOST/PGPORT/PGUSER/PGPASSWORD (o DB_OWNER_PASSWORD)/PGDATABASE.
 */
import { createDb, createPool } from '../db/index.js';
import { resolveDatabaseUrl } from '../config.js';
import { runMaintenance } from '../modules/maintenance/run.js';

const url = resolveDatabaseUrl({
  DATABASE_URL: process.env.DATABASE_URL,
  PGHOST: process.env.PGHOST,
  PGPORT: process.env.PGPORT ? Number(process.env.PGPORT) : undefined,
  PGUSER: process.env.PGUSER,
  PGPASSWORD: process.env.PGPASSWORD || process.env.DB_OWNER_PASSWORD,
  PGDATABASE: process.env.PGDATABASE,
});
if (!url) {
  console.error('DATABASE_URL es obligatorio (o PGHOST, PGUSER, PGPASSWORD y PGDATABASE)');
  process.exit(1);
}
const auditMonths = Number(process.env.AUDIT_RETENTION_MONTHS ?? 12);
const loopIdx = process.argv.indexOf('--loop');
const every = loopIdx >= 0 ? Number(process.argv[loopIdx + 1] ?? 3600) : 0;
const log = {
  info: (o: object, m: string) => console.log(JSON.stringify({ level: 'info', msg: m, ...o, time: new Date().toISOString() })),
  error: (o: object, m: string) => console.error(JSON.stringify({ level: 'error', msg: m, ...o, time: new Date().toISOString() })),
};
const pool = createPool(url, 1, { applicationName: 'enregla-maintenance' });
const db = createDb(pool);
let stop = false;
process.on('SIGTERM', () => (stop = true));
process.on('SIGINT', () => (stop = true));
do {
  try {
    const r = await runMaintenance(db, { auditMonths, log });
    log.info({ ...r }, 'Mantenimiento hecho');
  } catch (err) {
    log.error({ err: (err as Error).message }, 'Error en el mantenimiento');
    if (!every) process.exitCode = 1;
  }
  for (let waited = 0; every && !stop && waited < every; waited++) await new Promise((r) => setTimeout(r, 1000));
} while (every && !stop);
await db.destroy();
