import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import cookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import { sql } from 'kysely';
import { z } from 'zod';
import type { AppDeps } from './http/context.js';
import { AppError } from './lib/errors.js';
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

function trustHops(n: number) {
  return (_address: string, hop: number) => hop < n;
}

const SERVER_ROOT = fileURLToPath(new URL('..', import.meta.url));

function resolveWebDist(deps: AppDeps): string | null {
  const dir = deps.config.webDistDir ? path.resolve(deps.config.webDistDir) : path.resolve(SERVER_ROOT, '..', 'web', 'dist');
  return existsSync(path.join(dir, 'index.html')) ? dir : null;
}

export async function buildApp(deps: AppDeps, opts: { logger?: FastifyServerOptions['logger'] } = {}): Promise<FastifyInstance> {
  const { config } = deps;
  const app = Fastify({
    logger: opts.logger ?? {
      level: config.logLevel,
      redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
      ...(config.env === 'development' ? { transport: { target: 'pino-pretty', options: { singleLine: true } } } : {}),
    },
    trustProxy: typeof config.trustProxy === 'number' ? trustHops(config.trustProxy) : config.trustProxy,
    bodyLimit: 256 * 1024,
    routerOptions: { ignoreTrailingSlash: true, maxParamLength: 200 },
    requestIdHeader: false,
    genReqId: () => crypto.randomUUID(),
  });

  // API solo JSON: sin parser de text/plain (→ 415 para cualquier otro Content-Type).
  app.removeContentTypeParser('text/plain');
  app.decorate('deps', deps);
  app.decorate('sendMail', (message) => {
    deps.mailer.send(message).catch((err: unknown) => app.log.error({ err: (err as Error).message, subject: message.subject }, 'Error enviando email'));
  });
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

  app.setErrorHandler((err: unknown, req, reply) => {
    if (err instanceof AppError) {
      if (err.headers) reply.headers(err.headers);
      return reply.status(err.statusCode).send({ error: { code: err.code, message: err.message, ...(err.details ? { details: err.details } : {}) } });
    }
    const e = err as { statusCode?: number; code?: string; message?: string };
    if (e.code === 'FST_ERR_CTP_BODY_TOO_LARGE') {
      return reply.status(413).send({ error: { code: 'PAYLOAD_TOO_LARGE', message: 'El cuerpo de la petición es demasiado grande' } });
    }
    if (e.statusCode && e.statusCode >= 400 && e.statusCode < 500) {
      const message = e.code === 'FST_ERR_CTP_INVALID_MEDIA_TYPE' ? 'Tipo de contenido no admitido (usa application/json)' : 'Petición no válida';
      return reply.status(e.statusCode).send({ error: { code: 'BAD_REQUEST', message } });
    }
    req.log.error({ err }, 'Error no controlado');
    return reply.status(500).send({ error: { code: 'INTERNAL_ERROR', message: 'Error interno. Inténtalo de nuevo más tarde.' } });
  });

  // Salud
  app.get('/healthz', async () => ({ status: 'ok' }));
  app.get('/readyz', async (_req, reply) => {
    try {
      await sql`SELECT 1`.execute(deps.db);
      return { status: 'ok' };
    } catch {
      return reply.status(503).send({ status: 'unavailable' });
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

  app.setNotFoundHandler((req, reply) => {
    const isApi = req.url.startsWith('/api/') || req.url === '/api';
    if (!isApi && webDist && (req.method === 'GET' || req.method === 'HEAD') && (req.headers.accept ?? '').includes('text/html')) {
      reply.header('Cache-Control', 'no-cache');
      return reply.sendFile('index.html');
    }
    return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Ruta no encontrada' } });
  });

  return app;
}
