import type { Config } from './config.js';
import type { AppDeps } from './http/context.js';
import { createDb, createPool } from './db/index.js';
import { createMailer } from './lib/mailer.js';
import { PgRateLimiter } from './lib/rate-limit.js';
import { StripeBillingProvider } from './modules/billing/provider.js';

export function createDeps(config: Config, overrides: Partial<AppDeps> = {}): AppDeps {
  const pool = overrides.pool ?? createPool(config.databaseUrl, config.databasePoolMax);
  const db = overrides.db ?? createDb(pool);
  return {
    config,
    pool,
    db,
    mailer: overrides.mailer ?? createMailer(config),
    rateLimiter: overrides.rateLimiter ?? new PgRateLimiter(db),
    billing: overrides.billing !== undefined ? overrides.billing : config.stripe ? new StripeBillingProvider(config.stripe) : null,
    now: overrides.now ?? (() => new Date()),
  };
}
