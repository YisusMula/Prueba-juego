import { newIdempotencyKey } from '@/lib/idempotency';

export const uuid = () => newIdempotencyKey();

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
/** Texto aleatorio en base64url (como `randomToken` del servidor). */
export function randomToken(chars: number): string {
  const bytes = crypto.getRandomValues(new Uint8Array(chars));
  let out = '';
  for (const b of bytes) out += ALPHABET[b & 63];
  return out;
}

/** Slug de la carta pública: 22 caracteres (128 bits). */
export const newSlug = () => randomToken(22);
/** Token de dispositivo de cocina: `kd_` + 43 caracteres. */
export const newDeviceToken = () => `kd_${randomToken(43)}`;
