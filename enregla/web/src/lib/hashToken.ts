/**
 * Lee `token` del fragmento de la URL (#token=…), que nunca llega al servidor ni a los logs,
 * y lo quita de la barra de direcciones con history.replaceState.
 * Es idempotente durante la misma visita (React puede invocar inicializadores dos veces).
 */
let taken: { path: string; token: string | null } | null = null;

export function takeHashToken(): string | null {
  const path = window.location.pathname;
  const hash = window.location.hash.startsWith('#') ? window.location.hash.slice(1) : window.location.hash;
  if (!hash) return taken && taken.path === path ? taken.token : null;
  const raw = new URLSearchParams(hash).get('token');
  window.history.replaceState(window.history.state, '', path + window.location.search);
  const token = raw && raw.length >= 10 && raw.length <= 300 ? raw : null;
  taken = { path, token };
  return token;
}
