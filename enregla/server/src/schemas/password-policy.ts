/**
 * Política de contraseñas, compartida por servidor (decisión final) y frontend (aviso en vivo).
 * Reglas, todas con un mensaje que explica el motivo:
 *  - 10–128 caracteres;
 *  - no puede ser un único carácter repetido;
 *  - no puede COINCIDIR exactamente (sin distinguir mayúsculas) con una contraseña de la lista de
 *    las más usadas, con tu email, con la parte de tu email antes de la @ ni con tu nombre.
 *    Contener una palabra común ("Contrasena-Larga-77x") está permitido: solo se rechaza la coincidencia exacta.
 */
import { COMMON_PASSWORDS } from './common-passwords.js';

export const PASSWORD_MIN = 10;
export const PASSWORD_MAX = 128;

export type PasswordContext = { email?: string; name?: string };
export type PasswordRule = { id: 'length' | 'repeat' | 'common' | 'personal'; label: string; ok: boolean; message: string };

const norm = (s: string) => s.normalize('NFKC').trim().toLowerCase();

/** Estado de cada regla (para el medidor del formulario). */
export function passwordRules(password: string, context: PasswordContext = {}): PasswordRule[] {
  const lower = norm(password);
  const email = context.email ? norm(context.email) : '';
  const local = email.split('@')[0] ?? '';
  const name = context.name ? norm(context.name) : '';
  const compactName = name.replace(/\s+/g, '');
  const personal =
    password.length > 0 &&
    ((email !== '' && lower === email) ||
      (local.length >= 3 && lower === local) ||
      (name.length >= 3 && (lower === name || lower === compactName)));
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
      label: 'No es tu email ni tu nombre',
      ok: password.length > 0 && !personal,
      message: 'La contraseña no puede ser igual a tu email ni a tu nombre',
    },
  ];
}

/** Devuelve el motivo del rechazo (en español) o null si la contraseña es aceptable. */
export function checkPasswordPolicy(password: string, context: PasswordContext = {}): string | null {
  return passwordRules(password, context).find((r) => !r.ok)?.message ?? null;
}
