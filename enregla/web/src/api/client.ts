/**
 * Cliente HTTP de la API. La sesión es una cookie httpOnly: el frontend nunca la lee.
 * Todas las mutaciones llevan `X-Requested-With: XMLHttpRequest` (protección CSRF, API.md §1.4).
 */

export type ErrorCode =
  | 'VALIDATION_ERROR'
  | 'BAD_REQUEST'
  | 'INVALID_TOKEN'
  | 'UNAUTHENTICATED'
  | 'INVALID_CREDENTIALS'
  | 'PIN_REQUIRED'
  | 'INVALID_PIN'
  | 'READ_ONLY'
  | 'EMAIL_NOT_VERIFIED'
  | 'FORBIDDEN'
  | 'CSRF_FAILED'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'PAYLOAD_TOO_LARGE'
  | 'RATE_LIMITED'
  | 'PIN_LOCKED'
  | 'REPORT_TOO_LARGE'
  | 'BILLING_ERROR'
  | 'BILLING_NOT_CONFIGURED'
  | 'INTERNAL_ERROR'
  | 'NETWORK_ERROR'
  | 'TIMEOUT';

export type ErrorDetail = { path: string; message: string };

export class ApiError extends Error {
  readonly status: number;
  readonly code: ErrorCode;
  readonly details: ErrorDetail[];
  readonly retryAfter: number | null;
  constructor(status: number, code: ErrorCode, message: string, details: ErrorDetail[] = [], retryAfter: number | null = null) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
    this.retryAfter = retryAfter;
  }
  /** Error de red o de tiempo de espera: tiene sentido reintentar la misma petición. */
  get retryable(): boolean {
    return this.code === 'NETWORK_ERROR' || this.code === 'TIMEOUT';
  }
  /** Mensaje del primer detalle cuyo path coincide (p. ej. "data.correctiveAction"). */
  fieldError(path: string): string | undefined {
    return this.details.find((d) => d.path === path)?.message;
  }
}

export const isApiError = (e: unknown): e is ApiError => e instanceof ApiError;

/** Eventos globales para reaccionar a sesión caducada y solo lectura desde cualquier petición. */
export const apiEvents = new EventTarget();
export const SESSION_EXPIRED = 'session-expired';
export const READ_ONLY_HIT = 'read-only';

export type RequestOptions = {
  /** Cabeceras extra (p. ej. Authorization del kiosko). */
  headers?: Record<string, string>;
  /** No emitir el evento global de sesión caducada (p. ej. login, comprobación inicial). */
  silentAuth?: boolean;
  signal?: AbortSignal;
  /** Tiempo máximo de espera en ms (por defecto 15 s). */
  timeoutMs?: number;
  /** Clave de idempotencia (altas de registros): la misma en todos los reintentos del mismo registro. */
  idempotencyKey?: string;
};

/** Tiempo máximo de una petición normal a la API. Las descargas usan uno mayor (download.ts). */
export const REQUEST_TIMEOUT_MS = 15_000;
export const TIMEOUT_MESSAGE = 'El servidor está tardando demasiado en responder. Comprueba la conexión y vuelve a intentarlo.';
export const NETWORK_MESSAGE = 'Sin conexión con el servidor. Comprueba tu conexión a internet y vuelve a intentarlo.';

/** Señal que se cancela por tiempo (y, si se da, también con la señal del llamador). */
export function timeoutSignal(ms: number, signal?: AbortSignal): AbortSignal {
  if (typeof AbortSignal.timeout === 'function' && (!signal || typeof AbortSignal.any === 'function')) {
    const t = AbortSignal.timeout(ms);
    return signal ? AbortSignal.any([signal, t]) : t;
  }
  // Navegadores antiguos: equivalente manual.
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(new DOMException('Tiempo agotado', 'TimeoutError')), ms);
  signal?.addEventListener('abort', () => {
    clearTimeout(id);
    ctrl.abort(signal.reason);
  });
  return ctrl.signal;
}

/** Traduce un fallo de fetch a ApiError (red o tiempo agotado). Los abortos del llamador se relanzan. */
export function fetchFailure(err: unknown, callerSignal?: AbortSignal): unknown {
  if (callerSignal?.aborted) return err;
  const name = (err as Error | undefined)?.name;
  if (name === 'TimeoutError' || name === 'AbortError') return new ApiError(0, 'TIMEOUT', TIMEOUT_MESSAGE);
  return new ApiError(0, 'NETWORK_ERROR', NETWORK_MESSAGE);
}

const FALLBACK_MESSAGES: Partial<Record<number, string>> = {
  404: 'No lo encontramos.',
  429: 'Demasiados intentos. Espera un poco y vuelve a probar.',
  500: 'Algo ha fallado en el servidor. Inténtalo de nuevo en un momento.',
  502: 'El servicio no responde ahora mismo. Inténtalo de nuevo.',
  503: 'El servicio no está disponible ahora mismo.',
};

async function parseError(res: Response): Promise<ApiError> {
  const retryAfterHeader = res.headers.get('Retry-After');
  const retryAfter = retryAfterHeader ? Number(retryAfterHeader) || null : null;
  try {
    const data = (await res.json()) as { error?: { code?: ErrorCode; message?: string; details?: ErrorDetail[] } };
    if (data.error?.code) {
      return new ApiError(res.status, data.error.code, data.error.message ?? 'Error', data.error.details ?? [], retryAfter);
    }
  } catch {
    // respuesta no JSON
  }
  return new ApiError(res.status, res.status >= 500 ? 'INTERNAL_ERROR' : 'BAD_REQUEST', FALLBACK_MESSAGES[res.status] ?? 'No se pudo completar la acción.', [], retryAfter);
}

export async function request<T>(method: string, url: string, body?: unknown, opts: RequestOptions = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      credentials: 'same-origin',
      headers: {
        Accept: 'application/json',
        'X-Requested-With': 'XMLHttpRequest',
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(opts.idempotencyKey ? { 'Idempotency-Key': opts.idempotencyKey } : {}),
        ...opts.headers,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: timeoutSignal(opts.timeoutMs ?? REQUEST_TIMEOUT_MS, opts.signal),
    });
  } catch (err) {
    throw fetchFailure(err, opts.signal);
  }
  // 200 (repetición idempotente) y 201 (creado) son igual de válidos.
  if (res.status === 204) return undefined as T;
  if (!res.ok) {
    const error = await parseError(res);
    if (error.code === 'UNAUTHENTICATED' && !opts.silentAuth) apiEvents.dispatchEvent(new Event(SESSION_EXPIRED));
    if (error.code === 'READ_ONLY') apiEvents.dispatchEvent(new Event(READ_ONLY_HIT));
    throw error;
  }
  return (await res.json()) as T;
}

export const api = {
  get: <T>(url: string, opts?: RequestOptions) => request<T>('GET', url, undefined, opts),
  post: <T>(url: string, body?: unknown, opts?: RequestOptions) => request<T>('POST', url, body, opts),
  patch: <T>(url: string, body?: unknown, opts?: RequestOptions) => request<T>('PATCH', url, body, opts),
  del: <T = void>(url: string, body?: unknown, opts?: RequestOptions) => request<T>('DELETE', url, body, opts),
};

/** Construye una query string ignorando valores vacíos. */
export function qs(params: Record<string, string | number | boolean | null | undefined>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue;
    sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : '';
}

/** Mensaje apto para el usuario a partir de cualquier error. */
export function errorMessage(e: unknown): string {
  if (isApiError(e)) {
    if ((e.code === 'RATE_LIMITED' || e.code === 'PIN_LOCKED') && e.retryAfter) {
      return `${e.message.replace(/\.?\s*$/, '.')} Inténtalo de nuevo en ${formatWait(e.retryAfter)}.`;
    }
    return e.message;
  }
  return 'Algo no ha ido bien. Inténtalo de nuevo.';
}

/** 45 → "45 segundos"; 130 → "3 minutos"; 4000 → "1 hora y 7 minutos". */
export function formatWait(seconds: number): string {
  if (seconds < 60) return `${Math.max(1, Math.round(seconds))} ${Math.round(seconds) === 1 ? 'segundo' : 'segundos'}`;
  const min = Math.ceil(seconds / 60);
  if (min < 60) return `${min} ${min === 1 ? 'minuto' : 'minutos'}`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${h} ${h === 1 ? 'hora' : 'horas'}${m ? ` y ${m} ${m === 1 ? 'minuto' : 'minutos'}` : ''}`;
}
