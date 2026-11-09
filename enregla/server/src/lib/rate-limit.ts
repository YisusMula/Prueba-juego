import { sql } from 'kysely';
import type { DB } from '../db/index.js';
import type { RateLimitRule } from '../config.js';
import { rateLimited } from './errors.js';

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

/** Interfaz sustituible (p. ej. por Redis). */
export interface RateLimiter {
  hit(key: string, rule: RateLimitRule): Promise<RateLimitResult>;
  reset(key: string): Promise<void>;
  cleanup(): Promise<void>;
}

/**
 * Ventana fija almacenada en PostgreSQL: funciona con varias instancias sin
 * infraestructura adicional. La actualización es atómica (INSERT … ON CONFLICT).
 */
export class PgRateLimiter implements RateLimiter {
  constructor(private readonly db: DB) {}

  async hit(key: string, rule: RateLimitRule): Promise<RateLimitResult> {
    const { rows } = await sql<{ count: number; retry: number }>`
      INSERT INTO rate_limits (key, count, reset_at)
      VALUES (${key}, 1, now() + make_interval(secs => ${rule.windowSeconds}))
      ON CONFLICT (key) DO UPDATE SET
        count = CASE WHEN rate_limits.reset_at <= now() THEN 1 ELSE rate_limits.count + 1 END,
        reset_at = CASE WHEN rate_limits.reset_at <= now() THEN now() + make_interval(secs => ${rule.windowSeconds}) ELSE rate_limits.reset_at END
      RETURNING count, CEIL(EXTRACT(EPOCH FROM (reset_at - now())))::int AS retry
    `.execute(this.db);
    const row = rows[0]!;
    return {
      allowed: row.count <= rule.limit,
      remaining: Math.max(0, rule.limit - row.count),
      retryAfterSeconds: Math.max(1, row.retry),
    };
  }

  async reset(key: string): Promise<void> {
    await this.db.deleteFrom('rate_limits').where('key', '=', key).execute();
  }

  async cleanup(): Promise<void> {
    await sql`DELETE FROM rate_limits WHERE reset_at < now() - interval '1 hour'`.execute(this.db);
  }
}

/** Lanza 429 si se supera el límite. */
export async function enforce(limiter: RateLimiter, key: string, rule: RateLimitRule): Promise<void> {
  const r = await limiter.hit(key, rule);
  if (!r.allowed) throw rateLimited(r.retryAfterSeconds);
}
