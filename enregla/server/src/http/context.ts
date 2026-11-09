import type pg from 'pg';
import type { Config } from '../config.js';
import type { DB } from '../db/index.js';
import type { Organization, Role } from '../db/types.js';
import type { Mailer, MailMessage } from '../lib/mailer.js';
import type { RateLimiter } from '../lib/rate-limit.js';
import type { BillingProvider } from '../modules/billing/provider.js';

export interface AppDeps {
  config: Config;
  pool: pg.Pool;
  db: DB;
  mailer: Mailer;
  rateLimiter: RateLimiter;
  billing: BillingProvider | null;
}

export interface AuthCtx {
  sessionId: string;
  user: { id: string; email: string; name: string; emailVerifiedAt: Date | null };
}

export interface OrgCtx {
  org: Organization;
  role: Role;
  userId: string;
}

export interface DeviceCtx {
  deviceId: string;
  deviceName: string;
  org: Organization;
}

declare module 'fastify' {
  interface FastifyInstance {
    deps: AppDeps;
    /** Envía un email sin bloquear la respuesta (tiempos uniformes); los fallos se registran en el log. */
    sendMail(message: MailMessage): void;
  }
  interface FastifyRequest {
    auth: AuthCtx | null;
    orgCtx: OrgCtx | null;
    deviceCtx: DeviceCtx | null;
  }
}
