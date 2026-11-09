import { hash, verify } from '@node-rs/argon2';
import { COMMON_PASSWORDS } from './common-passwords.js';

// Parámetros OWASP para argon2id: m=19 MiB, t=2, p=1. (@node-rs/argon2 usa argon2id por defecto.)
const ARGON2_OPTIONS = { memoryCost: 19_456, timeCost: 2, parallelism: 1, outputLen: 32 } as const;

export const PASSWORD_MIN = 10;
export const PASSWORD_MAX = 128;

export async function hashSecret(secret: string): Promise<string> {
  return hash(secret.normalize('NFKC'), ARGON2_OPTIONS);
}

/** Verificación en tiempo constante (la hace argon2). Nunca lanza: devuelve false si el hash es inválido. */
export async function verifySecret(hashed: string, secret: string): Promise<boolean> {
  try {
    return await verify(hashed, secret.normalize('NFKC'));
  } catch {
    return false;
  }
}

let dummyHash: Promise<string> | null = null;
/** Hash ficticio para igualar tiempos cuando el usuario no existe. */
export function getDummyHash(): Promise<string> {
  dummyHash ??= hashSecret('dummy-password-for-timing-equalization');
  return dummyHash;
}

/** Devuelve un mensaje de error en español o null si la contraseña es aceptable. */
export function checkPasswordPolicy(password: string, context: { email?: string; name?: string } = {}): string | null {
  if (password.length < PASSWORD_MIN) return `La contraseña debe tener al menos ${PASSWORD_MIN} caracteres`;
  if (password.length > PASSWORD_MAX) return `La contraseña no puede superar ${PASSWORD_MAX} caracteres`;
  const lower = password.toLowerCase();
  if (COMMON_PASSWORDS.has(lower)) return 'Esa contraseña es demasiado común; elige otra';
  if (/^(.)\1+$/.test(password)) return 'La contraseña no puede ser un único carácter repetido';
  if (context.email && lower === context.email.toLowerCase()) return 'La contraseña no puede ser igual a tu email';
  const local = context.email?.split('@')[0]?.toLowerCase();
  if (local && local.length >= 4 && lower.includes(local) && lower.length - local.length < 4) {
    return 'La contraseña no puede basarse en tu email';
  }
  return null;
}
