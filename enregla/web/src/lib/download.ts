import { ApiError, apiEvents, fetchFailure, SESSION_EXPIRED, timeoutSignal } from '@/api/client';

/** Las descargas (PDF, CSV, exportación) pueden tardar más que una petición normal. */
export const DOWNLOAD_TIMEOUT_MS = 120_000;

/** Extrae el nombre de fichero de Content-Disposition (admite filename* RFC 5987). */
export function filenameFromDisposition(header: string | null, fallback: string): string {
  if (!header) return fallback;
  const star = /filename\*\s*=\s*UTF-8''([^;]+)/i.exec(header);
  if (star?.[1]) {
    try {
      return decodeURIComponent(star[1].trim());
    } catch {
      // continúa con filename=
    }
  }
  const plain = /filename\s*=\s*"?([^";]+)"?/i.exec(header);
  return plain?.[1]?.trim() || fallback;
}

/**
 * Descarga un fichero de la API (PDF, CSV, exportación) con la cookie de sesión.
 * Se pide con fetch para poder mostrar los errores (límite de filas, 429 con Retry-After…)
 * en lugar de descargar un JSON de error.
 */
export async function downloadFile(url: string, fallbackName: string): Promise<string> {
  let res: Response;
  try {
    res = await fetch(url, {
      credentials: 'same-origin',
      headers: { 'X-Requested-With': 'XMLHttpRequest' },
      signal: timeoutSignal(DOWNLOAD_TIMEOUT_MS),
    });
  } catch (err) {
    throw fetchFailure(err);
  }
  if (!res.ok) {
    const retry = res.headers.get('Retry-After');
    let code: ApiError['code'] = res.status >= 500 ? 'INTERNAL_ERROR' : 'BAD_REQUEST';
    let message = 'No se pudo generar la descarga.';
    let details: { path: string; message: string }[] = [];
    try {
      const data = (await res.json()) as { error?: { code?: ApiError['code']; message?: string; details?: typeof details } };
      if (data.error?.code) code = data.error.code;
      if (data.error?.message) message = data.error.message;
      details = data.error?.details ?? [];
    } catch {
      // sin cuerpo JSON
    }
    if (code === 'UNAUTHENTICATED') apiEvents.dispatchEvent(new Event(SESSION_EXPIRED));
    throw new ApiError(res.status, code, message, details, retry ? Number(retry) || null : null);
  }
  let blob: Blob;
  try {
    blob = await res.blob();
  } catch (err) {
    throw fetchFailure(err);
  }
  const name = filenameFromDisposition(res.headers.get('Content-Disposition'), fallbackName);
  const href = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = href;
  a.download = name;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(href), 30_000);
  return name;
}
