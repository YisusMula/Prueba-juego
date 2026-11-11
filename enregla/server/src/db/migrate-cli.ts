import { createPool } from './index.js';
import { runMigrations } from './migrate.js';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL es obligatorio');
  process.exit(1);
}
const pool = createPool(url, 1);
try {
  const applied = await runMigrations(pool, (m) => console.log(m));
  console.log(applied.length === 0 ? 'La base de datos ya está al día.' : `${applied.length} migración(es) aplicada(s).`);
} catch (err) {
  console.error((err as Error).message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
