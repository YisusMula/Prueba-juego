import type { FastifyInstance, FastifyRequest } from 'fastify';
import helmet from '@fastify/helmet';
import cors from '@fastify/cors';
import type { Config } from '../config.js';
import { AppError } from '../lib/errors.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** Rutas mutantes exentas de CSRF por diseño: no usan la cookie de sesión. */
export function isCsrfExempt(url: string): boolean {
  const path = url.split('?')[0]!;
  return path === '/api/billing/webhook' || path.startsWith('/api/kiosk/');
}

export const CSRF_HEADER = 'x-requested-with';
export const CSRF_HEADER_VALUE = 'XMLHttpRequest';

export function checkCsrf(req: FastifyRequest, config: Config): void {
  if (SAFE_METHODS.has(req.method) || !req.url.startsWith('/api/') || isCsrfExempt(req.url)) return;
  // 1) Cabecera propia: un formulario o <img> de otro sitio no puede añadirla, y desde otro
  //    origen fuerza un preflight CORS que se rechaza.
  if (req.headers[CSRF_HEADER] !== CSRF_HEADER_VALUE) {
    throw new AppError(403, 'CSRF_FAILED', 'Petición rechazada por seguridad (falta la cabecera X-Requested-With)');
  }
  // 2) Origen: debe coincidir con un origen permitido. Si el navegador no envía Origin,
  //    se exige Sec-Fetch-Site: same-origin.
  const origin = req.headers.origin;
  if (origin) {
    if (!config.allowedOrigins.includes(origin)) {
      throw new AppError(403, 'CSRF_FAILED', 'Petición rechazada por seguridad (origen no permitido)');
    }
  } else if (req.headers['sec-fetch-site'] !== 'same-origin') {
    throw new AppError(403, 'CSRF_FAILED', 'Petición rechazada por seguridad (origen desconocido)');
  }
}

export async function registerSecurity(app: FastifyInstance, config: Config): Promise<void> {
  await app.register(helmet, {
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
        imgSrc: ["'self'", 'data:', 'blob:'],
        fontSrc: ["'self'"],
        connectSrc: ["'self'"],
        manifestSrc: ["'self'"],
        workerSrc: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
        ...(config.isProduction ? { upgradeInsecureRequests: [] } : {}),
      },
    },
    hsts: config.isProduction ? { maxAge: 63_072_000, includeSubDomains: true, preload: false } : false,
    referrerPolicy: { policy: 'no-referrer' },
    frameguard: { action: 'deny' },
    crossOriginResourcePolicy: { policy: 'same-origin' },
    crossOriginOpenerPolicy: { policy: 'same-origin' },
    crossOriginEmbedderPolicy: false,
  });
  app.addHook('onSend', async (req, reply, payload) => {
    reply.header('Permissions-Policy', 'camera=(self), microphone=(), geolocation=(), payment=()');
    if (req.url.startsWith('/api/')) reply.header('Cache-Control', 'no-store');
    return payload;
  });

  // CORS cerrado: mismo origen. Solo se aceptan orígenes de desarrollo explícitos (DEV_ORIGINS).
  const devOrigins = config.allowedOrigins.filter((o) => o !== config.appOrigin);
  await app.register(cors, {
    origin: devOrigins.length > 0 ? devOrigins : false,
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'X-Requested-With'],
    maxAge: 600,
  });
}
