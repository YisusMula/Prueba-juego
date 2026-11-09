import { sql } from 'kysely';
import type { AppDeps } from '../../http/context.js';
import type { EmailTokenPurpose } from '../../db/types.js';
import { isWellFormedToken, randomToken, sha256 } from '../../lib/crypto.js';

export const TOKEN_TTL_MS: Record<EmailTokenPurpose, number> = {
  verify_email: 24 * 3600 * 1000,
  password_reset: 3600 * 1000,
  email_change: 24 * 3600 * 1000,
};

/** Crea un token de un solo uso (256 bits, guardado hasheado) e invalida los anteriores del mismo propósito. */
export async function createEmailToken(deps: AppDeps, userId: string, purpose: EmailTokenPurpose, newEmail: string | null = null): Promise<string> {
  const token = randomToken();
  await deps.db.transaction().execute(async (trx) => {
    await trx
      .updateTable('email_tokens')
      .set({ used_at: sql<Date>`now()` })
      .where('user_id', '=', userId)
      .where('purpose', '=', purpose)
      .where('used_at', 'is', null)
      .execute();
    await trx
      .insertInto('email_tokens')
      .values({
        user_id: userId,
        purpose,
        token_hash: sha256(token),
        new_email: newEmail,
        expires_at: new Date(Date.now() + TOKEN_TTL_MS[purpose]),
      })
      .execute();
  });
  return token;
}

export interface TokenRow {
  id: string;
  user_id: string;
  new_email: string | null;
}

/** Busca un token válido sin consumirlo. */
export async function peekEmailToken(deps: AppDeps, token: string, purpose: EmailTokenPurpose): Promise<TokenRow | null> {
  if (!isWellFormedToken(token)) return null;
  const row = await deps.db
    .selectFrom('email_tokens')
    .select(['id', 'user_id', 'new_email'])
    .where('token_hash', '=', sha256(token))
    .where('purpose', '=', purpose)
    .where('used_at', 'is', null)
    .where('expires_at', '>', sql<Date>`now()`)
    .executeTakeFirst();
  return row ?? null;
}

/** Consume el token de forma atómica (un solo uso). Devuelve null si no es válido. */
export async function consumeEmailToken(deps: AppDeps, token: string, purpose: EmailTokenPurpose): Promise<TokenRow | null> {
  if (!isWellFormedToken(token)) return null;
  const row = await deps.db
    .updateTable('email_tokens')
    .set({ used_at: sql<Date>`now()` })
    .where('token_hash', '=', sha256(token))
    .where('purpose', '=', purpose)
    .where('used_at', 'is', null)
    .where('expires_at', '>', sql<Date>`now()`)
    .returning(['id', 'user_id', 'new_email'])
    .executeTakeFirst();
  return row ?? null;
}
