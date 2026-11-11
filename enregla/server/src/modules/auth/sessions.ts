import type { FastifyReply, FastifyRequest } from 'fastify';
import { sql } from 'kysely';
import type { AppDeps, AuthCtx } from '../../http/context.js';
import { isWellFormedToken, randomToken, sha256 } from '../../lib/crypto.js';

const TOUCH_INTERVAL_MS = 60_000;

export async function createSession(deps: AppDeps, userId: string, req: FastifyRequest): Promise<string> {
  const token = randomToken();
  await deps.db
    .insertInto('sessions')
    .values({
      token_hash: sha256(token),
      user_id: userId,
      expires_at: new Date(Date.now() + deps.config.sessionAbsoluteMs),
      ip: req.ip ?? null,
      user_agent: (req.headers['user-agent'] ?? '').slice(0, 300) || null,
    })
    .execute();
  return token;
}

export async function loadSession(deps: AppDeps, token: string): Promise<AuthCtx | null> {
  if (!isWellFormedToken(token)) return null;
  const row = await deps.db
    .selectFrom('sessions as s')
    .innerJoin('users as u', 'u.id', 's.user_id')
    .select(['s.id as session_id', 's.expires_at', 's.last_seen_at', 'u.id', 'u.email', 'u.name', 'u.email_verified_at'])
    .where('s.token_hash', '=', sha256(token))
    .executeTakeFirst();
  if (!row) return null;
  const now = Date.now();
  if (row.expires_at.getTime() <= now || row.last_seen_at.getTime() + deps.config.sessionIdleMs <= now) {
    await deps.db.deleteFrom('sessions').where('id', '=', row.session_id).execute();
    return null;
  }
  if (now - row.last_seen_at.getTime() > TOUCH_INTERVAL_MS) {
    await deps.db.updateTable('sessions').set({ last_seen_at: sql<Date>`now()` }).where('id', '=', row.session_id).execute();
  }
  return {
    sessionId: row.session_id,
    user: { id: row.id, email: row.email, name: row.name, emailVerifiedAt: row.email_verified_at },
  };
}

export function setSessionCookie(reply: FastifyReply, deps: AppDeps, token: string): void {
  reply.setCookie(deps.config.cookieName, token, {
    path: '/',
    httpOnly: true,
    secure: deps.config.cookieSecure,
    sameSite: 'lax',
    maxAge: Math.floor(deps.config.sessionAbsoluteMs / 1000),
  });
}

export function clearSessionCookie(reply: FastifyReply, deps: AppDeps): void {
  reply.clearCookie(deps.config.cookieName, { path: '/', httpOnly: true, secure: deps.config.cookieSecure, sameSite: 'lax' });
}

export async function deleteUserSessions(deps: AppDeps, userId: string, exceptSessionId?: string): Promise<void> {
  let q = deps.db.deleteFrom('sessions').where('user_id', '=', userId);
  if (exceptSessionId) q = q.where('id', '!=', exceptSessionId);
  await q.execute();
}
