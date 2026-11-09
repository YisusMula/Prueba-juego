/**
 * Almacenamiento local. POLÍTICA: aquí NO se guardan tokens de sesión ni datos personales.
 * Excepciones documentadas:
 *  - Token del dispositivo de cocina (kiosko): la tablet no tiene sesión de usuario y lo
 *    necesita para autenticarse (cabecera Authorization, nunca en la URL). Solo da acceso a
 *    /api/kiosk/* (tareas de hoy y alta de registros). Se revoca desde Ajustes → Dispositivos
 *    de cocina (y la tablet lo borra al recibir 401) o con el botón "Desvincular" del kiosko.
 *  - Preferencias sin datos sensibles: último local abierto (id) e indicador "hay sesión"
 *    (un booleano para redirigir de la portada al panel; la sesión real es la cookie httpOnly).
 */
const KEYS = {
  kioskToken: 'enregla.kiosk.deviceToken',
  lastOrg: 'enregla.lastOrgId',
  sessionHint: 'enregla.hasSession',
} as const;

function safeGet(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}
function safeSet(key: string, value: string | null): void {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    // almacenamiento no disponible (modo privado): se ignora
  }
}

export const KIOSK_TOKEN_RE = /^kd_[A-Za-z0-9_-]{43}$/;

export const storage = {
  getKioskToken: () => {
    const t = safeGet(KEYS.kioskToken);
    return t && KIOSK_TOKEN_RE.test(t) ? t : null;
  },
  setKioskToken: (token: string | null) => safeSet(KEYS.kioskToken, token),
  getLastOrg: () => safeGet(KEYS.lastOrg),
  setLastOrg: (id: string | null) => safeSet(KEYS.lastOrg, id),
  hasSessionHint: () => safeGet(KEYS.sessionHint) === '1',
  setSessionHint: (on: boolean) => safeSet(KEYS.sessionHint, on ? '1' : null),
};
