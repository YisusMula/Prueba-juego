import { hash, verify } from '@node-rs/argon2';

// Parámetros OWASP para argon2id: m=19 MiB, t=2, p=1. (@node-rs/argon2 usa argon2id por defecto.)
const ARGON2_OPTIONS = { memoryCost: 19_456, timeCost: 2, parallelism: 1, outputLen: 32 } as const;

export { PASSWORD_MIN, PASSWORD_MAX } from '../schemas/password-policy.js';

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

/** La política (compartida con el frontend) vive en schemas/password-policy.ts. */
export { checkPasswordPolicy } from '../schemas/password-policy.js';
