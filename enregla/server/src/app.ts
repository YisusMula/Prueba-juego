import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import cookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import { sql } from 'kysely';
import { z } from 'zod';
import type { AppDeps } from './http/context.js';
import { AppError } from './lib/errors.js';
import { TrySemaphore } from './lib/semaphore.js';
import { checkCsrf, isCsrfExempt, registerSecurity } from './http/security.js';
import { loadSession, clearSessionCookie } from './modules/auth/sessions.js';
import { loadOrgContext } from './http/guards.js';
import { authRoutes } from './modules/auth/routes.js';
import { accountRoutes } from './modules/account/routes.js';
import { orgRootRoutes, orgRoutes } from './modules/orgs/routes.js';
import { memberRoutes, invitationPublicRoutes } from './modules/orgs/members.js';
import { staffRoutes } from './modules/staff/routes.js';
import { deviceRoutes } from './modules/devices/routes.js';
import { equipmentRoutes } from './modules/equipment/routes.js';
import { cleaningRoutes } from './modules/cleaning/routes.js';
import { supplierRoutes } from './modules/suppliers/routes.js';
import { recordRoutes } from './modules/records/routes.js';
import { dishRoutes, publicMenuRoutes } from './modules/allergens/routes.js';
import { taskRoutes } from './modules/tasks/routes.js';
import { reportRoutes } from './modules/reports/routes.js';
import { billingRoutes, billingWebhookRoutes } from './modules/billing/routes.js';
import { kioskRoutes } from './modules/kiosk/routes.js';
import { auditRoutes } from './modules/orgs/audit.js';
import { enqueueEmail, processOutbox } from './lib/outbox.js';
import type { Config } from './config.js';

z.config(z.locales.es());

export const REDACT_PATHS = [
  'req.headers.cookie',
  'req.headers.authorization',
  'req.headers["stripe-signature"]',
  'res.headers["set-cookie"]',
  '*.password',
  '*.currentPassword',
  '*.newPassword',
  '*.token',
  '*.pin',
  '*.pin_hash',
  '*.password_hash',
  '*.token_hash',
];

function containsNul(value: unknown, depth = 0): boolean {
  if (typeof value === 'string') return value.includes('\u0000');
  if (depth > 32 || value === null || typeof value !== 'object') return false;
  if (Buffer.isBuffer(value)) return false;
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (k.includes('\u0000') || containsNul(v, depth + 1)) return true;
  }
  return false;
}

function trustHops(n: number) {
  return (_address: string, hop: number) => hop < n;
}

const SERVER_ROOT = fileURLToPath(new URL('..', import.meta.url));

function resolveWebDist(deps: AppDeps): string | null {
  const dir = deps.config.webDistDir ? path.resolve(deps.config.webDistDir) : path.resolve(SERVER_ROOT, '..', 'web', 'dist');
  return existsSync(path.join(dir, 'index.html')) ? dir : null;
}

const requireFromHere = createRequire(import.meta.url);
function defaultResolve(id: string): string {
  return requireFromHere.resolve(id);
}

/**
 * Opciones del logger. `pino-pretty` es dependencia de desarrollo: si no está instalada (imagen de
 * producción tras `npm prune`, o alguien arranca con NODE_ENV=development), se usa JSON plano en
 * vez de caerse al arrancar.
 */
export function loggerOptions(config: Pick<Config, 'env' | 'logLevel'>, resolve: (id: string) => string = defaultResolve): Exclude<FastifyServerOptions['logger'], boolean | undefined> {
  let pretty = false;
  if (config.env === 'development') {
    try {
      resolve('pino-pretty');
      pretty = true;
    } catch {
      pretty = false;
    }
  }
  return {
    level: config.logLevel,
    redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
    ...(pretty ? { transport: { target: 'pino-pretty', options: { singleLine: true } } } : {}),
  };
}

/** keep-alive mayor que el de los balanceadores habituales (60–120 s) para evitar 502 por carreras. */
export const HTTP_TIMEOUTS = { keepAliveMs: 125_000, headersMs: 130_000, requestMs: 300_000, connectionMs: 130_000 };

/** Rutas de la SPA que no son públicas (o no aportan nada indexadas): llevan X-Robots-Tag: noindex. */
const PRIVATE_SPA_PREFIXES = [
  '/app',
  '/locales',
  '/nuevo-local',
  '/cocina',
  '/carta',
  '/entrar',
  '/registro',
  '/revisa-tu-correo',
  '/verificar-email',
  '/recuperar-contrasena',
  '/restablecer-contrasena',
  '/confirmar-email',
  '/invitacion',
];
export function isPrivateSpaPath(pathname: string): boolean {
  return PRIVATE_SPA_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export async function buildApp(deps: AppDeps, opts: { logger?: FastifyServerOptions['logger'] } = {}): Promise<FastifyInstance> {
  const { config } = deps;
  const app = Fastify({
    logger: opts.logger ?? loggerOptions(config),
    keepAliveTimeout: HTTP_TIMEOUTS.keepAliveMs,
    requestTimeout: HTTP_TIMEOUTS.requestMs,
    // Inactividad del socket (sin lecturas ni escrituras): corta conexiones colgadas.
    connectionTimeout: HTTP_TIMEOUTS.connectionMs,
    trustProxy: typeof config.trustProxy === 'number' ? trustHops(config.trustProxy) : config.trustProxy,
    bodyLimit: 256 * 1024,
    routerOptions: { ignoreTrailingSlash: true, maxParamLength: 200 },
    requestIdHeader: false,
    genReqId: () => crypto.randomUUID(),
  });

  // headersTimeout coherente: mayor que keepAliveTimeout (y menor que requestTimeout).
  app.server.headersTimeout = HTTP_TIMEOUTS.headersMs;
  // Corte o reinicio de PostgreSQL: se registra y el pool reconecta en la siguiente petición.
  deps.pool.on('error', (err) => app.log.error({ err: err.message }, 'Conexión inactiva con PostgreSQL perdida'));

  // API solo JSON: sin parser de text/plain (→ 415 para cualquier otro Content-Type).
  app.removeContentTypeParser('text/plain');
  app.decorate('deps', deps);
  // Trabajos en segundo plano (emails, tokens, auditoría que no deben influir en el tiempo de respuesta).
  const pendingJobs = new Set<Promise<void>>();
  const track = (p: Promise<void>) => {
    pendingJobs.add(p);
    void p.finally(() => pendingJobs.delete(p));
  };
  // Emails: bandeja de salida en PostgreSQL (ver lib/outbox.ts) con primer intento inmediato.
  const deliver = async (ids: string[]) => {
    await processOutbox(deps.db, deps.mailer, {
      ids,
      limit: ids.length,
      onError: (err) => app.log.warn({ err: (err as Error).message }, 'Fallo enviando email: se reintentará'),
    });
  };
  app.decorate('queueMail', (db, message) => enqueueEmail(db, message));
  app.decorate('deliverEmails', (ids: string[]) => {
    if (ids.length === 0) return;
    track(deliver(ids).catch((err: unknown) => app.log.error({ err }, 'Error procesando la bandeja de emails')));
  });
  app.decorate('sendMail', (message) => {
    track(
      enqueueEmail(deps.db, message)
        .then((id) => deliver([id]))
        .catch((err: unknown) => {
          app.log.error({ err: (err as Error).message }, 'Error encolando email');
        }),
    );
  });
  let shuttingDown = false;
  app.decorate('markShuttingDown', () => {
    shuttingDown = true;
  });
  app.decorate('runInBackground', (label: string, job: () => Promise<void>) => {
    track(
      new Promise<void>((resolve) => setImmediate(resolve))
        .then(job)
        .catch((err: unknown) => {
          app.log.error({ err, job: label }, 'Error en tarea en segundo plano');
        }),
    );
  });
  app.decorate('drainBackground', async () => {
    while (pendingJobs.size > 0) await Promise.all([...pendingJobs]);
  });
  app.addHook('onClose', async () => app.drainBackground());
  app.decorate('pdfSlots', new TrySemaphore(config.reports.pdfConcurrency));
  app.decorateRequest('auth', null);
  app.decorateRequest('orgCtx', null);
  app.decorateRequest('deviceCtx', null);

  await registerSecurity(app, config);
  await app.register(cookie);

  // CSRF y carga de sesión (solo cookies; el kiosko y el webhook no usan cookie).
  app.addHook('onRequest', async (req, reply) => {
    if (!req.url.startsWith('/api/')) return;
    checkCsrf(req, config);
    if (isCsrfExempt(req.url) || req.url.startsWith('/api/public/')) return;
    const token = req.cookies[config.cookieName];
    if (token) {
      req.auth = await loadSession(deps, token);
      if (!req.auth) clearSessionCookie(reply, deps);
    }
  });

  // PostgreSQL no admite el carácter NUL en text/jsonb: se rechaza con 400 en cualquier entrada.
  app.addHook('preValidation', async (req) => {
    if (!req.url.startsWith('/api/') || req.url === '/api/billing/webhook') return;
    if (req.url.includes('%00') || containsNul(req.body) || containsNul(req.query) || containsNul(req.params)) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Los datos enviados contienen caracteres no permitidos');
    }
  });

  app.setErrorHandler((err: unknown, req, reply) => {
    if (err instanceof AppError) {
      if (err.headers) reply.headers(err.headers);
      return reply.status(err.statusCode).send({ error: { code: err.code, message: err.message, ...(err.details ? { details: err.details } : {}) } });
    }
    const e = err as { statusCode?: number; code?: string; message?: string };
    if (e.code === 'FST_ERR_CTP_BODY_TOO_LARGE') {
      return reply.status(413).send({ error: { code: 'PAYLOAD_TOO_LARGE', message: 'El cuerpo de la petición es demasiado grande' } });
    }
    // Errores de datos de PostgreSQL (clase 22: fechas fuera de rango, texto no válido, números
    // desbordados…) provocados por entradas raras: 400, nunca 500.
    if (typeof e.code === 'string' && /^22[0-9A-Z]{3}$/.test(e.code) && !e.statusCode) {
      req.log.warn({ pgCode: e.code }, 'Entrada rechazada por la base de datos');
      return reply.status(400).send({ error: { code: 'BAD_REQUEST', message: 'Algún dato no tiene un valor admitido (fecha, número o texto fuera de rango). Revísalo y vuelve a intentarlo.' } });
    }
    if (e.statusCode && e.statusCode >= 400 && e.statusCode < 500) {
      const message = e.code === 'FST_ERR_CTP_INVALID_MEDIA_TYPE' ? 'Tipo de contenido no admitido (usa application/json)' : 'Petición no válida';
      return reply.status(e.statusCode).send({ error: { code: 'BAD_REQUEST', message } });
    }
    req.log.error({ err }, 'Error no controlado');
    return reply.status(500).send({ error: { code: 'INTERNAL_ERROR', message: 'Error interno. Inténtalo de nuevo más tarde.' } });
  });

  // Salud
  // Las sondas no se registran a nivel info (serían una línea por segundo en los logs).
  app.get('/healthz', { logLevel: 'warn' }, async () => ({ status: 'ok' }));
  app.get('/readyz', { logLevel: 'warn' }, async (_req, reply) => {
    if (shuttingDown) return reply.status(503).send({ status: 'unavailable', reason: 'shutting_down' });
    let timer: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        sql`SELECT 1`.execute(deps.db),
        new Promise((_resolve, reject) => {
          timer = setTimeout(() => reject(new Error('timeout')), 3_000);
        }),
      ]);
      return { status: 'ok' };
    } catch {
      return reply.status(503).send({ status: 'unavailable' });
    } finally {
      clearTimeout(timer);
    }
  });

  // API
  await app.register(authRoutes, { prefix: '/api/auth' });
  await app.register(accountRoutes, { prefix: '/api/account' });
  await app.register(invitationPublicRoutes, { prefix: '/api/invitations' });
  await app.register(orgRootRoutes, { prefix: '/api/orgs' });
  await app.register(
    async (scope) => {
      scope.addHook('preHandler', loadOrgContext);
      await scope.register(orgRoutes);
      await scope.register(memberRoutes);
      await scope.register(auditRoutes, { prefix: '/audit' });
      await scope.register(staffRoutes, { prefix: '/staff' });
      await scope.register(deviceRoutes, { prefix: '/devices' });
      await scope.register(equipmentRoutes, { prefix: '/equipment' });
      await scope.register(cleaningRoutes, { prefix: '/cleaning-plans' });
      await scope.register(supplierRoutes, { prefix: '/suppliers' });
      await scope.register(recordRoutes, { prefix: '/records' });
      await scope.register(dishRoutes);
      await scope.register(taskRoutes, { prefix: '/tasks' });
      await scope.register(reportRoutes, { prefix: '/reports' });
      await scope.register(billingRoutes, { prefix: '/billing' });
    },
    { prefix: '/api/orgs/:orgId' },
  );
  await app.register(billingWebhookRoutes, { prefix: '/api/billing' });
  await app.register(kioskRoutes, { prefix: '/api/kiosk' });
  await app.register(publicMenuRoutes, { prefix: '/api/public' });

  // Frontend (SPA) si existe el build.
  const webDist = resolveWebDist(deps);
  if (webDist) {
    await app.register(fastifyStatic, {
      root: webDist,
      wildcard: false,
      index: false,
      setHeaders: (res, filePath) => {
        if (filePath.includes(`${path.sep}assets${path.sep}`)) res.header('Cache-Control', 'public, max-age=31536000, immutable');
        else res.header('Cache-Control', 'no-cache');
      },
    });
  }

  // X-Robots-Tag: la API, la carta pública y la app privada no deben indexarse.
  app.addHook('onSend', async (req, reply, payload) => {
    const pathname = req.url.split('?')[0]!;
    if (pathname === '/api' || pathname.startsWith('/api/') || isPrivateSpaPath(pathname)) reply.header('X-Robots-Tag', 'noindex, nofollow');
    return payload;
  });

  app.setNotFoundHandler((req, reply) => {
    const pathname = req.url.split('?')[0]!;
    const isApi = pathname.startsWith('/api/') || pathname === '/api';
    // Un fichero (último segmento con extensión) inexistente es 404; cualquier otra ruta GET/HEAD
    // fuera de /api es una ruta de la SPA y recibe index.html, sea cual sea la cabecera Accept.
    const lastSegment = pathname.slice(pathname.lastIndexOf('/') + 1);
    const looksLikeFile = /\.[A-Za-z0-9]{1,8}$/.test(lastSegment);
    if (!isApi && webDist && !looksLikeFile && (req.method === 'GET' || req.method === 'HEAD')) {
      reply.header('Cache-Control', 'no-cache');
      return reply.sendFile('index.html');
    }
    return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Ruta no encontrada' } });
  });

  return app;
}
