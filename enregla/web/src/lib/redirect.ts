/**
 * Destino tras el login: solo rutas internas (evita redirecciones abiertas).
 * Acepta "/algo" pero no "//dominio", "/\\dominio", esquemas ni caracteres de control.
 */
export function safeNext(next: string | null | undefined, fallback = '/app'): string {
  if (!next) return fallback;
  let value = next;
  try {
    value = decodeURIComponent(next);
  } catch {
    return fallback;
  }
  if (!value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) return fallback;
  if (/[\u0000-\u001f\u007f\\]/.test(value)) return fallback;
  try {
    const url = new URL(value, 'https://interno.invalid');
    if (url.origin !== 'https://interno.invalid') return fallback;
    const path = `${url.pathname}${url.search}${url.hash}`;
    // Rutas de cuenta: volver a ellas tras entrar no tiene sentido.
    if (/^\/(entrar|registro)(\/|$|\?)/.test(path)) return fallback;
    return path;
  } catch {
    return fallback;
  }
}

export const loginPath = (next?: string) => (next ? `/entrar?next=${encodeURIComponent(next)}` : '/entrar');
