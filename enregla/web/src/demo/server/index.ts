/**
 * «Servidor» de la demo: atiende en el navegador las peticiones a /api que hace el cliente de la
 * app (lo instala `configurePlatform({ fetch })`). Responde con objetos Response reales, así que la
 * app pasa por el mismo código de errores, reintentos y descargas que con el servidor de verdad.
 */
import { DemoError } from './errors';
import { resolve, type DemoResponse } from './routes';
import { getDb, persist } from './store';

/** Retardo simulado de red: lo justo para que se vean los estados de carga. */
const LATENCY_MS = 120;

export function handle(method: string, url: string, init: { headers?: HeadersInit; body?: unknown } = {}): DemoResponse {
  const u = new URL(url, 'https://demo.invalid');
  const headers = new Headers(init.headers);
  try {
    const found = resolve(method, u.pathname);
    if (found === null) throw new DemoError(404, 'NOT_FOUND', 'Ruta no encontrada');
    if (found === 'method') throw new DemoError(404, 'NOT_FOUND', 'Ruta no encontrada');
    let body: unknown = undefined;
    if (typeof init.body === 'string' && init.body.length) {
      try {
        body = JSON.parse(init.body);
      } catch {
        throw new DemoError(400, 'BAD_REQUEST', 'El cuerpo de la petición no es JSON válido');
      }
    }
    const db = getDb();
    const res = found.handler(db, { method, path: u.pathname, query: u.searchParams, body, headers, params: found.params });
    // Las lecturas también pueden cambiar el estado (último uso de la tablet, auditoría de informes).
    persist();
    return res;
  } catch (err) {
    if (err instanceof DemoError) {
      // Los fallos de PIN también cambian el estado (contadores y bloqueo).
      if (method !== 'GET') persist();
      return {
        status: err.status,
        json: { error: { code: err.code, message: err.message, ...(err.details ? { details: err.details } : {}) } },
        headers: err.headers,
      };
    }
    console.error('Error en la API de la demo', err);
    return { status: 500, json: { error: { code: 'INTERNAL_ERROR', message: 'Algo ha fallado en el servidor. Inténtalo de nuevo en un momento.' } } };
  }
}

export function toResponse(r: DemoResponse): Response {
  const headers = new Headers(r.headers);
  if (r.status === 204) return new Response(null, { status: 204, headers });
  if (r.text !== undefined) {
    headers.set('Content-Type', r.contentType ?? 'text/plain; charset=utf-8');
    return new Response(r.text, { status: r.status, headers });
  }
  headers.set('Content-Type', 'application/json; charset=utf-8');
  return new Response(JSON.stringify(r.json ?? null), { status: r.status, headers });
}

const isApi = (url: string) => /^\/api(\/|$)/.test(url);

/** Sustituto de fetch para el cliente de la app: /api/* en memoria; lo demás, fetch normal (ficheros publicados). */
export async function demoFetch(input: string, init: RequestInit = {}): Promise<Response> {
  if (!isApi(input)) return window.fetch(input, init);
  const signal = init.signal;
  await new Promise<void>((resolveDelay, reject) => {
    if (signal?.aborted) return reject(signal.reason ?? new DOMException('Cancelado', 'AbortError'));
    const id = window.setTimeout(resolveDelay, LATENCY_MS);
    signal?.addEventListener('abort', () => {
      window.clearTimeout(id);
      reject(signal.reason ?? new DOMException('Cancelado', 'AbortError'));
    });
  });
  return toResponse(handle((init.method ?? 'GET').toUpperCase(), input, { headers: init.headers, body: init.body }));
}
