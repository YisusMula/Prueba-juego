export type ErrorCode =
  | 'VALIDATION_ERROR'
  | 'BAD_REQUEST'
  | 'UNAUTHENTICATED'
  | 'INVALID_CREDENTIALS'
  | 'EMAIL_NOT_VERIFIED'
  | 'FORBIDDEN'
  | 'CSRF_FAILED'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'INVALID_TOKEN'
  | 'READ_ONLY'
  | 'PIN_REQUIRED'
  | 'INVALID_PIN'
  | 'PIN_LOCKED'
  | 'RATE_LIMITED'
  | 'REPORT_TOO_LARGE'
  | 'PAYLOAD_TOO_LARGE'
  | 'BILLING_NOT_CONFIGURED'
  | 'BILLING_ERROR'
  | 'INTERNAL_ERROR';

export interface ErrorDetail {
  path: string;
  message: string;
}

export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: ErrorCode,
    message: string,
    public readonly details?: ErrorDetail[],
    public readonly headers?: Record<string, string>,
  ) {
    super(message);
  }
}

export const notFound = (what = 'Recurso') => new AppError(404, 'NOT_FOUND', `${what} no encontrado`);
export const forbidden = (msg = 'No tienes permiso para realizar esta acción') => new AppError(403, 'FORBIDDEN', msg);
export const unauthenticated = () => new AppError(401, 'UNAUTHENTICATED', 'Debes iniciar sesión');
export const badRequest = (msg: string, details?: ErrorDetail[]) => new AppError(400, 'BAD_REQUEST', msg, details);
export const conflict = (msg: string) => new AppError(409, 'CONFLICT', msg);
export const invalidToken = () => new AppError(400, 'INVALID_TOKEN', 'Este enlace no es válido: puede que haya caducado o que ya se haya usado.');
export const rateLimited = (retryAfter: number, message = 'Demasiados intentos. Espera un momento y vuelve a intentarlo.') =>
  new AppError(429, 'RATE_LIMITED', message, undefined, {
    'Retry-After': String(retryAfter),
  });
export const readOnly = () =>
  new AppError(
    402,
    'READ_ONLY',
    'La suscripción de este local no está activa: puedes consultar y exportar los datos, pero no crear ni modificar nada.',
  );
