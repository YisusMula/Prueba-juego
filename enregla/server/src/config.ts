import { isIP } from 'node:net';
import { z } from 'zod';

const bool = z
  .enum(['true', 'false', '1', '0', 'yes', 'no'])
  .transform((v) => v === 'true' || v === '1' || v === 'yes');

const csv = z
  .string()
  .default('')
  .transform((v) =>
    v
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );

const WEAK_DB_PASSWORDS = new Set(['', 'postgres', 'password', 'enregla', 'changeme', 'secret', 'admin', 'root', '123456']);

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).optional(),
  // DATABASE_URL o, como alternativa, PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE (la contraseña
  // no necesita codificarse para URL). Vacío cuenta como no definido.
  DATABASE_URL: z.string().optional(),
  PGHOST: z.string().optional(),
  PGPORT: z.coerce.number().int().min(1).max(65535).optional(),
  PGUSER: z.string().optional(),
  PGPASSWORD: z.string().optional(),
  PGDATABASE: z.string().optional(),
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),
  APP_NAME: z.string().min(1).max(60).default('EnRegla'),
  /** Email de soporte visible en los emails (opcional). */
  SUPPORT_EMAIL: z.union([z.literal(''), z.email()]).optional(),
  APP_URL: z.url().default('http://localhost:5173'),
  DEV_ORIGINS: csv,
  TRUST_PROXY: z.string().default('false'),
  COOKIE_SECURE: bool.optional(),
  SESSION_ABSOLUTE_DAYS: z.coerce.number().int().min(1).max(90).default(30),
  SESSION_IDLE_HOURS: z.coerce.number().int().min(1).max(24 * 30).default(24 * 7),
  MAIL_TRANSPORT: z.enum(['smtp', 'console', 'memory']).optional(),
  MAIL_FROM: z.string().optional(),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(587),
  SMTP_SECURE: bool.default(false),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  STRIPE_PRICE_MONTHLY: z.string().optional(),
  STRIPE_PRICE_ANNUAL: z.string().optional(),
  SCHEDULER_ENABLED: bool.default(true),
  SCHEDULER_INTERVAL_SECONDS: z.coerce.number().int().min(10).max(3600).default(60),
  EMAIL_WORKER_ENABLED: bool.default(true),
  EMAIL_WORKER_INTERVAL_SECONDS: z.coerce.number().int().min(1).max(600).default(15),
  ORG_DELETION_GRACE_DAYS: z.coerce.number().int().min(1).max(90).default(30),
  WEB_DIST_DIR: z.string().optional(),
  TRIAL_DAYS: z.coerce.number().int().min(1).max(60).default(14),
  AUDIT_RETENTION_MONTHS: z.coerce.number().int().min(1).max(120).default(12),
  UNVERIFIED_ACCOUNT_DAYS: z.coerce.number().int().min(1).max(90).default(7),
  PDF_MAX_CONCURRENCY: z.coerce.number().int().min(1).max(16).default(2),
  /** Espera máxima en la cola de PDF (segundos) antes de responder 429. */
  PDF_QUEUE_MAX_WAIT_SECONDS: z.coerce.number().int().min(0).max(120).default(20),
  /** Segundos de generación de PDF por local y hora. */
  PDF_BUDGET_SECONDS_PER_HOUR: z.coerce.number().int().min(10).max(3600).default(180),
  /** Generar los PDF en un worker_thread (recomendado). */
  PDF_WORKER: bool.default(true),
  /** Días en past_due tras los que el local pasa a solo lectura (salvaguarda, I-3). */
  PAST_DUE_READ_ONLY_DAYS: z.coerce.number().int().min(1).max(90).default(21),
});

export interface RateLimitRule {
  limit: number;
  windowSeconds: number;
}

export interface Config {
  env: 'development' | 'production' | 'test';
  isProduction: boolean;
  host: string;
  port: number;
  logLevel: string;
  databaseUrl: string;
  databasePoolMax: number;
  appName: string;
  /** Email de soporte que se muestra en los emails (null si no se configura). */
  supportEmail: string | null;
  /** Origen público de la aplicación (sin barra final), p. ej. https://app.enregla.es */
  appOrigin: string;
  /** Orígenes aceptados para CORS/CSRF (appOrigin + DEV_ORIGINS). */
  allowedOrigins: string[];
  trustProxy: boolean | number | string[];
  cookieSecure: boolean;
  cookieName: string;
  sessionAbsoluteMs: number;
  sessionIdleMs: number;
  mail: {
    transport: 'smtp' | 'console' | 'memory';
    from: string;
    smtp?: { host: string; port: number; secure: boolean; user?: string; pass?: string };
    /** Worker de la bandeja de salida (reintentos). Desactivado en tests (se invoca a mano). */
    worker: { enabled: boolean; intervalSeconds: number };
  };
  stripe: {
    secretKey: string;
    webhookSecret: string;
    priceMonthly: string;
    priceAnnual: string;
  } | null;
  scheduler: { enabled: boolean; intervalSeconds: number };
  webDistDir?: string;
  trialDays: number;
  /** Días que un local pendiente de eliminación se conserva antes de purgarlo. */
  orgDeletionGraceDays: number;
  rateLimits: {
    loginIp: RateLimitRule;
    /** Intentos fallidos por (cuenta + IP): el umbral "normal" de bloqueo. */
    loginAccountIp: RateLimitRule;
    /** Techo por cuenta (todas las IP) contra fuerza bruta distribuida. */
    loginAccount: RateLimitRule;
    registerIp: RateLimitRule;
    passwordResetIp: RateLimitRule;
    passwordResetAccount: RateLimitRule;
    /** Reenvíos de verificación: claves propias, separadas de las de reset. */
    verifyIp: RateLimitRule;
    verifyAccount: RateLimitRule;
    tokenIp: RateLimitRule;
    pinDevice: RateLimitRule;
    /** PIN erróneos por dispositivo (todas las personas). */
    pinFailDevice: RateLimitRule;
    publicIp: RateLimitRule;
    kioskDevice: RateLimitRule;
    sensitiveUser: RateLimitRule;
    /** Informes y exportaciones: se aplican por organización y por usuario. */
    reportPdf: RateLimitRule;
    reportCsv: RateLimitRule;
    orgExport: RateLimitRule;
    /** Alta de registros desde la web (usuario + organización) y desde el kiosko (dispositivo). */
    recordCreateUser: RateLimitRule;
    recordCreateDevice: RateLimitRule;
    /** Invitaciones: mismo destinatario por organización, por organización y por usuario. */
    inviteRecipient: RateLimitRule;
    inviteOrg: RateLimitRule;
    inviteUser: RateLimitRule;
  };
  pinMaxFailures: number;
  pinLockMinutes: number;
  reports: {
    /** Máximo de filas de un PDF (por encima se pide acotar o usar CSV). */
    maxPdfRows: number;
    /** Máximo de filas de un CSV (por encima se rechaza con REPORT_TOO_LARGE antes de empezar). */
    maxCsvRows: number;
    /** PDF generándose a la vez en este proceso; si está lleno se responde 429. */
    pdfConcurrency: number;
    /** Segundos sugeridos en Retry-After cuando no hay hueco para otro PDF. */
    pdfBusyRetrySeconds: number;
    /** Espera máxima (ms) en la cola justa de PDF antes de responder 429. */
    pdfQueueMaxWaitMs: number;
    /** Peticiones de PDF esperando a la vez en la cola (por encima, 429 inmediato). */
    pdfQueueMaxLength: number;
    /** Presupuesto de tiempo de generación de PDF por local y hora (ms). */
    pdfBudgetMsPerHour: number;
    /** Genera el PDF en un worker_thread (no compite con el event loop de la API). */
    pdfWorker: boolean;
  };
  billing: {
    /** Días en `past_due` tras los que el local pasa a solo lectura. */
    pastDueReadOnlyDays: number;
  };
  retention: {
    auditMonths: number;
    unverifiedAccountDays: number;
  };
}

const TRUST_PROXY_NAMES = new Set(['loopback', 'linklocal', 'uniquelocal']);

function isIpOrCidr(v: string): boolean {
  if (TRUST_PROXY_NAMES.has(v)) return true;
  const [ip, bits, ...rest] = v.split('/');
  if (rest.length > 0 || !ip) return false;
  const family = isIP(ip);
  if (family === 0) return false;
  if (bits === undefined) return true;
  if (!/^\d{1,3}$/.test(bits)) return false;
  return Number(bits) <= (family === 4 ? 32 : 128);
}

function parseTrustProxy(v: string): boolean | number | string[] {
  const s = v.trim().toLowerCase();
  if (s === 'true') return true;
  if (s === 'false' || s === '') return false;
  if (/^\d+$/.test(s)) return Number(s);
  return v
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
}

export class ConfigError extends Error {}

/** URL de conexión desde DATABASE_URL o desde las variables PG* (con la contraseña codificada). */
export function resolveDatabaseUrl(e: { DATABASE_URL?: string; PGHOST?: string; PGPORT?: number; PGUSER?: string; PGPASSWORD?: string; PGDATABASE?: string }): string | null {
  if (e.DATABASE_URL && e.DATABASE_URL.trim() !== '') return e.DATABASE_URL.trim();
  if (!e.PGHOST) return null;
  const enc = encodeURIComponent;
  const auth = e.PGUSER ? `${enc(e.PGUSER)}${e.PGPASSWORD ? `:${enc(e.PGPASSWORD)}` : ''}@` : '';
  return `postgres://${auth}${e.PGHOST.includes(':') ? `[${e.PGHOST}]` : e.PGHOST}:${e.PGPORT ?? 5432}/${enc(e.PGDATABASE ?? e.PGUSER ?? 'postgres')}`;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env, overrides: Partial<Config> = {}): Config {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new ConfigError(`Configuración no válida: ${msg}`);
  }
  const e = parsed.data;
  const isProduction = e.NODE_ENV === 'production';
  const appOrigin = new URL(e.APP_URL).origin;
  const problems: string[] = [];
  const databaseUrl = resolveDatabaseUrl(e);
  if (!databaseUrl) throw new ConfigError('Configuración no válida: DATABASE_URL es obligatorio (o PGHOST, PGUSER, PGPASSWORD y PGDATABASE)');

  const stripeVals = [e.STRIPE_SECRET_KEY, e.STRIPE_WEBHOOK_SECRET, e.STRIPE_PRICE_MONTHLY, e.STRIPE_PRICE_ANNUAL];
  const stripeSet = stripeVals.filter((v) => v && v.length > 0).length;
  let stripe: Config['stripe'] = null;
  if (stripeSet === 4) {
    if (!/^(sk|rk)_(live|test)_[A-Za-z0-9]{10,}$/.test(e.STRIPE_SECRET_KEY!)) problems.push('STRIPE_SECRET_KEY no tiene un formato válido');
    if (!/^whsec_[A-Za-z0-9+/=]{16,}$/.test(e.STRIPE_WEBHOOK_SECRET!)) problems.push('STRIPE_WEBHOOK_SECRET no tiene un formato válido');
    stripe = {
      secretKey: e.STRIPE_SECRET_KEY!,
      webhookSecret: e.STRIPE_WEBHOOK_SECRET!,
      priceMonthly: e.STRIPE_PRICE_MONTHLY!,
      priceAnnual: e.STRIPE_PRICE_ANNUAL!,
    };
  } else if (stripeSet > 0) {
    problems.push('Configuración de Stripe incompleta: define STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, STRIPE_PRICE_MONTHLY y STRIPE_PRICE_ANNUAL, o ninguna');
  }

  const mailTransport = e.MAIL_TRANSPORT ?? (isProduction ? 'smtp' : e.NODE_ENV === 'test' ? 'memory' : 'console');
  if (mailTransport === 'smtp' && !e.SMTP_HOST) problems.push('SMTP_HOST es obligatorio con MAIL_TRANSPORT=smtp');
  if (e.SMTP_USER && !e.SMTP_PASS) problems.push('SMTP_PASS es obligatorio si se define SMTP_USER');

  const trustProxy = parseTrustProxy(e.TRUST_PROXY);
  if (Array.isArray(trustProxy)) {
    const bad = trustProxy.filter((x) => !isIpOrCidr(x));
    if (bad.length > 0) problems.push(`TRUST_PROXY contiene valores que no son IP/CIDR: ${bad.join(', ')}`);
  }

  if (isProduction) {
    if (trustProxy === true) {
      problems.push(
        'TRUST_PROXY=true no se permite en producción (cualquiera podría falsificar su IP con X-Forwarded-For): indica el número de proxies delante de la app (p. ej. TRUST_PROXY=1) o la lista de IP/CIDR del proxy (p. ej. TRUST_PROXY=172.18.0.0/16)',
      );
    }
    if (!appOrigin.startsWith('https://')) problems.push('APP_URL debe usar https en producción');
    if (mailTransport !== 'smtp') problems.push('En producción MAIL_TRANSPORT debe ser smtp');
    if (e.COOKIE_SECURE === false) problems.push('COOKIE_SECURE no puede desactivarse en producción');
    if (e.DEV_ORIGINS.length > 0) problems.push('DEV_ORIGINS no debe definirse en producción');
    if (stripe?.secretKey.startsWith('sk_test_')) {
      // Permitido (entornos de preproducción), pero se avisa al arrancar.
    }
    let dbPassword = '';
    try {
      dbPassword = decodeURIComponent(new URL(databaseUrl).password);
    } catch {
      problems.push('DATABASE_URL no es una URL válida');
    }
    if (WEAK_DB_PASSWORDS.has(dbPassword.toLowerCase()) || dbPassword.length < 12) {
      problems.push('La contraseña de DATABASE_URL es débil o falta (mínimo 12 caracteres, no valores por defecto)');
    }
    if (!e.MAIL_FROM) problems.push('MAIL_FROM es obligatorio en producción');
    if (e.SMTP_USER && e.SMTP_PASS && e.SMTP_PASS.length < 8) problems.push('SMTP_PASS es demasiado corta');
  }

  if (problems.length > 0) throw new ConfigError(`Configuración no válida: ${problems.join('; ')}`);

  const cookieSecure = e.COOKIE_SECURE ?? isProduction;
  const allowedOrigins = Array.from(new Set([appOrigin, ...e.DEV_ORIGINS.map((o) => new URL(o).origin)]));

  const config: Config = {
    env: e.NODE_ENV,
    isProduction,
    host: e.HOST,
    port: e.PORT,
    logLevel: e.LOG_LEVEL ?? (e.NODE_ENV === 'test' ? 'silent' : 'info'),
    databaseUrl,
    databasePoolMax: e.DATABASE_POOL_MAX,
    appName: e.APP_NAME,
    supportEmail: e.SUPPORT_EMAIL ? e.SUPPORT_EMAIL : null,
    appOrigin,
    allowedOrigins,
    trustProxy,
    cookieSecure,
    // El prefijo __Host- exige Secure; en desarrollo sobre http se usa un nombre sin prefijo.
    cookieName: cookieSecure ? '__Host-enregla_session' : 'enregla_session',
    sessionAbsoluteMs: e.SESSION_ABSOLUTE_DAYS * 24 * 3600 * 1000,
    sessionIdleMs: e.SESSION_IDLE_HOURS * 3600 * 1000,
    mail: {
      transport: mailTransport,
      // Si MAIL_FROM es solo una dirección, el nombre visible sale de APP_NAME.
      from: !e.MAIL_FROM ? `"${e.APP_NAME}" <no-reply@localhost>` : e.MAIL_FROM.includes('<') ? e.MAIL_FROM : `"${e.APP_NAME}" <${e.MAIL_FROM}>`,
      smtp: e.SMTP_HOST
        ? { host: e.SMTP_HOST, port: e.SMTP_PORT, secure: e.SMTP_SECURE, user: e.SMTP_USER, pass: e.SMTP_PASS }
        : undefined,
      worker: { enabled: e.EMAIL_WORKER_ENABLED && e.NODE_ENV !== 'test', intervalSeconds: e.EMAIL_WORKER_INTERVAL_SECONDS },
    },
    stripe,
    scheduler: { enabled: e.SCHEDULER_ENABLED && e.NODE_ENV !== 'test', intervalSeconds: e.SCHEDULER_INTERVAL_SECONDS },
    webDistDir: e.WEB_DIST_DIR,
    trialDays: e.TRIAL_DAYS,
    orgDeletionGraceDays: e.ORG_DELETION_GRACE_DAYS,
    rateLimits: {
      loginIp: { limit: 30, windowSeconds: 15 * 60 },
      loginAccountIp: { limit: 10, windowSeconds: 15 * 60 },
      loginAccount: { limit: 100, windowSeconds: 3600 },
      registerIp: { limit: 10, windowSeconds: 3600 },
      passwordResetIp: { limit: 10, windowSeconds: 3600 },
      passwordResetAccount: { limit: 3, windowSeconds: 3600 },
      verifyIp: { limit: 10, windowSeconds: 3600 },
      verifyAccount: { limit: 3, windowSeconds: 3600 },
      tokenIp: { limit: 30, windowSeconds: 15 * 60 },
      pinDevice: { limit: 30, windowSeconds: 15 * 60 },
      pinFailDevice: { limit: 20, windowSeconds: 15 * 60 },
      publicIp: { limit: 120, windowSeconds: 60 },
      kioskDevice: { limit: 600, windowSeconds: 60 },
      sensitiveUser: { limit: 10, windowSeconds: 15 * 60 },
      reportPdf: { limit: 10, windowSeconds: 10 * 60 },
      reportCsv: { limit: 20, windowSeconds: 10 * 60 },
      orgExport: { limit: 5, windowSeconds: 3600 },
      recordCreateUser: { limit: 120, windowSeconds: 60 },
      recordCreateDevice: { limit: 120, windowSeconds: 60 },
      inviteRecipient: { limit: 3, windowSeconds: 24 * 3600 },
      inviteOrg: { limit: 20, windowSeconds: 24 * 3600 },
      inviteUser: { limit: 30, windowSeconds: 24 * 3600 },
    },
    pinMaxFailures: 5,
    pinLockMinutes: 15,
    reports: {
      maxPdfRows: 5_000,
      maxCsvRows: 500_000,
      pdfConcurrency: e.PDF_MAX_CONCURRENCY,
      pdfBusyRetrySeconds: 15,
      pdfQueueMaxWaitMs: e.PDF_QUEUE_MAX_WAIT_SECONDS * 1000,
      pdfQueueMaxLength: 50,
      pdfBudgetMsPerHour: e.PDF_BUDGET_SECONDS_PER_HOUR * 1000,
      pdfWorker: e.PDF_WORKER,
    },
    billing: { pastDueReadOnlyDays: e.PAST_DUE_READ_ONLY_DAYS },
    retention: { auditMonths: e.AUDIT_RETENTION_MONTHS, unverifiedAccountDays: e.UNVERIFIED_ACCOUNT_DAYS },
  };
  return { ...config, ...overrides };
}
