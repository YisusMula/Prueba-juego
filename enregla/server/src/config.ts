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
  DATABASE_URL: z.string().min(1, 'DATABASE_URL es obligatorio'),
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),
  APP_NAME: z.string().min(1).max(60).default('EnRegla'),
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
  WEB_DIST_DIR: z.string().optional(),
  TRIAL_DAYS: z.coerce.number().int().min(1).max(60).default(14),
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
  rateLimits: {
    loginIp: RateLimitRule;
    loginAccount: RateLimitRule;
    registerIp: RateLimitRule;
    passwordResetIp: RateLimitRule;
    passwordResetAccount: RateLimitRule;
    tokenIp: RateLimitRule;
    pinDevice: RateLimitRule;
    publicIp: RateLimitRule;
    kioskDevice: RateLimitRule;
    sensitiveUser: RateLimitRule;
  };
  pinMaxFailures: number;
  pinLockMinutes: number;
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

  if (isProduction) {
    if (!appOrigin.startsWith('https://')) problems.push('APP_URL debe usar https en producción');
    if (mailTransport !== 'smtp') problems.push('En producción MAIL_TRANSPORT debe ser smtp');
    if (e.COOKIE_SECURE === false) problems.push('COOKIE_SECURE no puede desactivarse en producción');
    if (e.DEV_ORIGINS.length > 0) problems.push('DEV_ORIGINS no debe definirse en producción');
    if (stripe?.secretKey.startsWith('sk_test_')) {
      // Permitido (entornos de preproducción), pero se avisa al arrancar.
    }
    let dbPassword = '';
    try {
      dbPassword = decodeURIComponent(new URL(e.DATABASE_URL).password);
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
    databaseUrl: e.DATABASE_URL,
    databasePoolMax: e.DATABASE_POOL_MAX,
    appName: e.APP_NAME,
    appOrigin,
    allowedOrigins,
    trustProxy: parseTrustProxy(e.TRUST_PROXY),
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
    },
    stripe,
    scheduler: { enabled: e.SCHEDULER_ENABLED && e.NODE_ENV !== 'test', intervalSeconds: e.SCHEDULER_INTERVAL_SECONDS },
    webDistDir: e.WEB_DIST_DIR,
    trialDays: e.TRIAL_DAYS,
    rateLimits: {
      loginIp: { limit: 30, windowSeconds: 15 * 60 },
      loginAccount: { limit: 10, windowSeconds: 15 * 60 },
      registerIp: { limit: 10, windowSeconds: 3600 },
      passwordResetIp: { limit: 10, windowSeconds: 3600 },
      passwordResetAccount: { limit: 3, windowSeconds: 3600 },
      tokenIp: { limit: 30, windowSeconds: 15 * 60 },
      pinDevice: { limit: 30, windowSeconds: 15 * 60 },
      publicIp: { limit: 120, windowSeconds: 60 },
      kioskDevice: { limit: 600, windowSeconds: 60 },
      sensitiveUser: { limit: 10, windowSeconds: 15 * 60 },
    },
    pinMaxFailures: 5,
    pinLockMinutes: 15,
  };
  return { ...config, ...overrides };
}
