/**
 * Preferencias de la app en la demo (token de la tablet, último local, indicador de sesión):
 * en memoria y, si se puede, copiadas en localStorage con un prefijo propio.
 */
const PREFIX = 'enregla.demo.pref.';
const memory = new Map<string, string>();
/**
 * El indicador «hay sesión» hace que la portada redirija al panel. En la demo la portada debe verse
 * siempre como la ve un visitante (el acceso «Portada» de la barra), así que no se recuerda.
 */
const IGNORED = new Set(['enregla.hasSession']);

export const demoStorage = {
  get(key: string): string | null {
    if (IGNORED.has(key)) return null;
    if (memory.has(key)) return memory.get(key)!;
    try {
      const v = window.localStorage.getItem(PREFIX + key);
      if (v != null) memory.set(key, v);
      return v;
    } catch {
      return null;
    }
  },
  set(key: string, value: string | null): void {
    if (IGNORED.has(key)) return;
    if (value === null) memory.delete(key);
    else memory.set(key, value);
    try {
      if (value === null) window.localStorage.removeItem(PREFIX + key);
      else window.localStorage.setItem(PREFIX + key, value);
    } catch {
      // bloqueado: queda en memoria
    }
  },
  clear(): void {
    for (const key of [...memory.keys()]) this.set(key, null);
    try {
      for (let i = window.localStorage.length - 1; i >= 0; i--) {
        const k = window.localStorage.key(i);
        if (k?.startsWith(PREFIX)) window.localStorage.removeItem(k);
      }
    } catch {
      // nada que limpiar
    }
  },
};
