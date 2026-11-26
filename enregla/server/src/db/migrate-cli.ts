import { createPool } from './index.js';
import { runMigrations } from './migrate.js';
import { applyAppRolePrivileges } from './privileges.js';
import { resolveDatabaseUrl } from '../config.js';

// DATABASE_URL o PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE (lo que usan los compose).
const url = resolveDatabaseUrl({
  DATABASE_URL: process.env.DATABASE_URL,
  PGHOST: process.env.PGHOST,
  PGPORT: process.env.PGPORT ? Number(process.env.PGPORT) : undefined,
  PGUSER: process.env.PGUSER,
  PGPASSWORD: process.env.PGPASSWORD,
  PGDATABASE: process.env.PGDATABASE,
});
if (!url) {
  console.error('DATABASE_URL es obligatorio (o PGHOST, PGUSER, PGPASSWORD y PGDATABASE)');
  process.exit(1);
}
const appRole = process.env.APP_DB_ROLE?.trim();
const pool = createPool(url, 1);
try {
  const applied = await runMigrations(pool, (m) => console.log(m));
  console.log(applied.length === 0 ? 'La base de datos ya está al día.' : `${applied.length} migración(es) aplicada(s).`);
  // Separación de roles (1.8): el rol de ejecución de la app no puede modificar ni borrar registros.
  if (appRole) {
    await applyAppRolePrivileges(pool, appRole);
    console.log(`Permisos del rol de la app (${appRole}) aplicados: en records solo SELECT e INSERT.`);
  }
} catch (err) {
  console.error((err as Error).message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
