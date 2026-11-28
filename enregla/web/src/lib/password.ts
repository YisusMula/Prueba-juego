/**
 * Requisitos de contraseña: las MISMAS reglas que aplica el servidor (server/src/schemas/password-policy.ts).
 * Contener una palabra común está permitido; solo se rechaza la coincidencia exacta con una
 * contraseña muy usada, con tu email o con tu nombre.
 */
import { passwordRules, type PasswordRule } from '@shared/schemas';

export type PasswordCheck = PasswordRule;

export function passwordChecks(password: string, email = '', name = ''): PasswordCheck[] {
  return passwordRules(password, { email, name });
}

/** 0–4. Solo orientativo: la decisión final es del servidor. */
export function passwordScore(password: string, email = '', name = ''): number {
  const checks = passwordChecks(password, email, name);
  if (!checks.every((c) => c.ok)) return Math.min(1, password.length > 0 ? 1 : 0);
  let score = 2;
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((r) => r.test(password)).length;
  if (password.length >= 14 || classes >= 3) score++;
  if (password.length >= 16 && classes >= 3) score++;
  return score;
}

export const passwordAcceptable = (password: string, email = '', name = '') => passwordChecks(password, email, name).every((c) => c.ok);

/** Motivo concreto del rechazo (o null). */
export const passwordProblem = (password: string, email = '', name = '') => passwordChecks(password, email, name).find((c) => !c.ok)?.message ?? null;
