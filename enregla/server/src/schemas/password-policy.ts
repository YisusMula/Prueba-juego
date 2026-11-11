/**
 * Política de contraseñas, compartida por servidor (decisión final) y frontend (aviso en vivo).
 * Reglas, todas con un mensaje que explica el motivo:
 *  - 10–128 caracteres;
 *  - no puede ser un único carácter repetido;
 *  - no puede COINCIDIR exactamente (sin distinguir mayúsculas) con una contraseña de la lista de
 *    las más usadas. Contener una palabra común ("Contrasena-Larga-77x") está permitido;
 *  - no puede basarse en tus datos personales. Comparando sin mayúsculas, tildes, espacios ni signos:
 *    se rechaza si es tu email, si CONTIENE la parte del email antes de la @ o tu nombre (completo o
 *    cualquiera de sus palabras) cuando estos tienen 5 o más caracteres (`juanperez1` con
 *    juanperez@…), o si es uno de ellos con pocos caracteres añadidos (como mucho 7 al principio y/o
 *    al final: `ana2026xyz` con ana@…).
 */
import { COMMON_PASSWORDS } from './common-passwords.js';

export const PASSWORD_MIN = 10;
export const PASSWORD_MAX = 128;

export type PasswordContext = { email?: string; name?: string };
export type PasswordRule = { id: 'length' | 'repeat' | 'common' | 'personal'; label: string; ok: boolean; message: string };

const norm = (s: string) => s.normalize('NFKC').trim().toLowerCase();
/** Solo letras y dígitos, sin tildes ni mayúsculas (para comparar con los datos personales). */
const alnum = (s: string) =>
  s
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '');

/** Datos personales con 5 o más caracteres: la contraseña no puede contenerlos. */
const CONTAINS_MIN = 5;
/** Datos personales más cortos (3–4): se rechaza si la contraseña es el dato con pocos caracteres añadidos. */
const SHORT_MIN = 3;
const MAX_ADDED = 7;

function isPersonal(password: string, context: PasswordContext): boolean {
  if (password.length === 0) return false;
  const lower = norm(password);
  const email = context.email ? norm(context.email) : '';
  if (email !== '' && lower === email) return true;
  const pw = alnum(password);
  if (pw === '') return false;
  const tokens = new Set<string>();
  const local = alnum(email.split('@')[0] ?? '');
  if (local) tokens.add(local);
  if (context.name) {
    tokens.add(alnum(context.name));
    for (const word of context.name.split(/[\s.,_-]+/)) tokens.add(alnum(word));
  }
  for (const t of tokens) {
    if (t.length >= CONTAINS_MIN && pw.includes(t)) return true;
    if (t.length >= SHORT_MIN && pw.length - t.length <= MAX_ADDED && (pw.startsWith(t) || pw.endsWith(t))) return true;
  }
  return false;
}

/** Estado de cada regla (para el medidor del formulario). */
export function passwordRules(password: string, context: PasswordContext = {}): PasswordRule[] {
  const lower = norm(password);
  const personal = isPersonal(password, context);
  return [
    {
      id: 'length',
      label: `Entre ${PASSWORD_MIN} y ${PASSWORD_MAX} caracteres`,
      ok: password.length >= PASSWORD_MIN && password.length <= PASSWORD_MAX,
      message:
        password.length > PASSWORD_MAX
          ? `La contraseña no puede superar ${PASSWORD_MAX} caracteres`
          : `La contraseña debe tener al menos ${PASSWORD_MIN} caracteres`,
    },
    {
      id: 'repeat',
      label: 'No es un solo carácter repetido',
      ok: password.length > 0 && !/^(.)\1+$/su.test(password),
      message: 'La contraseña no puede ser un único carácter repetido (por ejemplo, «aaaaaaaaaa»)',
    },
    {
      id: 'common',
      label: 'No es una de las contraseñas más usadas',
      ok: password.length > 0 && !COMMON_PASSWORDS.has(lower),
      message: 'Esa contraseña está en la lista de las más usadas y se adivina enseguida. Elige otra (puedes añadirle palabras o números)',
    },
    {
      id: 'personal',
      label: 'No contiene tu email ni tu nombre',
      ok: password.length > 0 && !personal,
      message:
        'La contraseña no puede ser igual a tu email ni a tu nombre, ni contenerlos (por ejemplo, «juanperez1» si tu email es juanperez@…). Elige algo que no tenga que ver con tus datos',
    },
  ];
}

/** Devuelve el motivo del rechazo (en español) o null si la contraseña es aceptable. */
export function checkPasswordPolicy(password: string, context: PasswordContext = {}): string | null {
  return passwordRules(password, context).find((r) => !r.ok)?.message ?? null;
}
