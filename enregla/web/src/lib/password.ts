/**
 * Requisitos de contraseña, alineados con la política del servidor (server/src/lib/password.ts):
 * 10–128 caracteres, no un único carácter repetido, no basada en el email. La lista de
 * contraseñas comunes la comprueba el servidor (aquí solo unas pocas evidentes, como pista).
 */
export type PasswordCheck = { id: string; label: string; ok: boolean };

const OBVIOUS = ['contraseña', 'contrasena', 'password', '1234567890', '0123456789', 'qwertyuiop', 'abcdefghij'];

export function passwordChecks(password: string, email = ''): PasswordCheck[] {
  const lower = password.toLowerCase();
  const local = email.split('@')[0]?.toLowerCase() ?? '';
  const basedOnEmail =
    (email && lower === email.toLowerCase()) || (local.length >= 4 && lower.includes(local) && lower.length - local.length < 4);
  return [
    { id: 'length', label: 'Al menos 10 caracteres', ok: password.length >= 10 && password.length <= 128 },
    { id: 'repeat', label: 'No es un solo carácter repetido', ok: password.length > 0 && !/^(.)\1+$/.test(password) },
    { id: 'email', label: 'No se parece a tu email', ok: password.length > 0 && !basedOnEmail },
    { id: 'common', label: 'No es una contraseña típica', ok: password.length > 0 && !OBVIOUS.some((o) => lower.startsWith(o)) },
  ];
}

/** 0–4. Solo orientativo: la decisión final es del servidor. */
export function passwordScore(password: string, email = ''): number {
  const checks = passwordChecks(password, email);
  if (!checks.every((c) => c.ok)) return Math.min(1, password.length > 0 ? 1 : 0);
  let score = 2;
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((r) => r.test(password)).length;
  if (password.length >= 14 || classes >= 3) score++;
  if (password.length >= 16 && classes >= 3) score++;
  return score;
}

export const passwordAcceptable = (password: string, email = '') => passwordChecks(password, email).every((c) => c.ok);
