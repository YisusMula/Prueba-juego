import { loadConfig, ConfigError } from './config.js';
import { createDeps } from './deps.js';
import { buildApp } from './app.js';
import { runMigrations } from './db/migrate.js';
import { startEmailWorker, startScheduler } from './modules/reminders/scheduler.js';

let config;
try {
  config = loadConfig();
} catch (err) {
  console.error(err instanceof ConfigError ? err.message : err);
  process.exit(1);
}

const deps = createDeps(config);
const app = await buildApp(deps);

if (process.env.MIGRATE_ON_START !== 'false') {
  await runMigrations(deps.pool, (m) => app.log.info(m));
}
if (!config.stripe) app.log.warn('Stripe no está configurado: los endpoints de facturación responderán 503.');
else if (config.isProduction && config.stripe.secretKey.startsWith('sk_test_')) app.log.warn('Stripe está en modo test en producción.');

const stopScheduler = config.scheduler.enabled ? startScheduler(deps, app.log) : () => {};
const stopEmailWorker = config.mail.worker.enabled ? startEmailWorker(deps, app.log) : () => {};

let shuttingDown = false;
async function shutdown(signal: string, exitCode = 0): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  app.log.info({ signal }, 'Apagado ordenado');
  // /readyz pasa a 503 en cuanto empieza el apagado, para que el balanceador deje de enviar tráfico.
  app.markShuttingDown();
  const force = setTimeout(() => process.exit(exitCode || 1), 15_000);
  force.unref();
  try {
    stopScheduler();
    stopEmailWorker();
    await app.close();
    await deps.mailer.close?.();
    await deps.db.destroy();
    process.exit(exitCode);
  } catch (err) {
    app.log.error({ err }, 'Error durante el apagado');
    process.exit(1);
  }
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
// Errores no capturados: se registran y se apaga de forma ordenada con código 1 (el orquestador
// reinicia el contenedor). Seguir funcionando tras un estado desconocido es más peligroso.
process.on('unhandledRejection', (reason) => {
  app.log.fatal({ err: reason }, 'Promesa rechazada sin capturar');
  void shutdown('unhandledRejection', 1);
});
process.on('uncaughtException', (err) => {
  app.log.fatal({ err }, 'Excepción no capturada');
  void shutdown('uncaughtException', 1);
});

try {
  await app.listen({ host: config.host, port: config.port });
} catch (err) {
  app.log.error({ err }, 'No se pudo iniciar el servidor');
  process.exit(1);
}
