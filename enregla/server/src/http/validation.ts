import type { z } from 'zod';
import { AppError, notFound } from '../lib/errors.js';
import { uuid, validationSummary } from '../schemas/index.js';

export function parse<T extends z.ZodType>(schema: T, input: unknown): z.output<T> {
  const r = schema.safeParse(input ?? {});
  if (!r.success) {
    const details = r.error.issues.slice(0, 50).map((i) => ({ path: i.path.map(String).join('.'), message: i.message }));
    throw new AppError(400, 'VALIDATION_ERROR', validationSummary(details), details);
  }
  return r.data;
}

/** Valida un id de ruta: si no es un UUID se responde 404 (no 400) para no dar pistas. */
export function idParam(params: unknown, key: string, what = 'Recurso'): string {
  const v = (params as Record<string, unknown> | undefined)?.[key];
  const r = uuid.safeParse(v);
  if (!r.success) throw notFound(what);
  return r.data;
}
