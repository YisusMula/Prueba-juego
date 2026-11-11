import type { z } from 'zod';
import { uuid as uuidSchema, validationSummary } from '@shared/schemas';
import type { ErrorCode, ErrorDetail } from '@/api/client';

/** Error con la misma forma que `AppError` del servidor (API.md §1.1). */
export class DemoError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode,
    message: string,
    readonly details?: ErrorDetail[],
    readonly headers?: Record<string, string>,
  ) {
    super(message);
  }
}

export const notFound = (what = 'Recurso') => new DemoError(404, 'NOT_FOUND', `${what} no encontrado`);
export const forbidden = (msg = 'No tienes permiso para realizar esta acción') => new DemoError(403, 'FORBIDDEN', msg);
export const unauthenticated = () => new DemoError(401, 'UNAUTHENTICATED', 'Debes iniciar sesión');
export const badRequest = (msg: string, details?: ErrorDetail[]) => new DemoError(400, 'BAD_REQUEST', msg, details);
export const conflict = (msg: string) => new DemoError(409, 'CONFLICT', msg);
export const invalidToken = () => new DemoError(400, 'INVALID_TOKEN', 'Este enlace no es válido: puede que haya caducado o que ya se haya usado.');
export const readOnly = () =>
  new DemoError(402, 'READ_ONLY', 'La suscripción de este local no está activa: puedes consultar y exportar los datos, pero no crear ni modificar nada.');
export const validationError = (path: string, message: string) => new DemoError(400, 'VALIDATION_ERROR', message, [{ path, message }]);

/** Igual que `parse` del servidor: 400 VALIDATION_ERROR con los detalles en español. */
export function parse<T extends z.ZodType>(schema: T, input: unknown, prefix: string[] = []): z.output<T> {
  const r = schema.safeParse(input ?? {});
  if (!r.success) {
    const details = r.error.issues.slice(0, 50).map((i) => ({ path: [...prefix, ...i.path.map(String)].join('.'), message: i.message }));
    throw new DemoError(400, 'VALIDATION_ERROR', validationSummary(details), details);
  }
  return r.data;
}

/** Id de ruta: si no es un UUID, 404 (no 400). */
export function idParam(value: string | undefined, what = 'Recurso'): string {
  const r = uuidSchema.safeParse(value);
  if (!r.success) throw notFound(what);
  return r.data;
}
