/**
 * Capacidad `downloads` del visor de Artifacts (`window.claude.use("downloads")`). Puede no existir
 * (página abierta fuera del visor, pruebas locales) o resolver `null`: entonces la demo no ofrece
 * descargas y enseña una vista previa en pantalla.
 */
import { useSyncExternalStore } from 'react';

export type SaveRequest = { filename: string; data: string | Blob | ArrayBuffer | ArrayBufferView };
export type DownloadsApi = { save: (req: SaveRequest) => Promise<{ status: 'saved' | 'delivered' }> };
export type DownloadsError = { code?: string; message?: string };

type State = { status: 'pending' | 'ready' | 'none'; api: DownloadsApi | null };
let state: State = { status: 'pending', api: null };
const listeners = new Set<() => void>();
const set = (s: State) => {
  state = s;
  for (const l of listeners) l();
};

type ClaudeLike = { use?: (name: string) => Promise<unknown> | unknown };

/** Se llama una vez al arrancar: la respuesta del visor llega más tarde (o nunca). */
export function initDownloads(): void {
  let pending: unknown;
  try {
    const claude = (window as unknown as { claude?: ClaudeLike }).claude;
    pending = typeof claude?.use === 'function' ? claude.use('downloads') : null;
  } catch {
    pending = null;
  }
  if (!pending || typeof (pending as Promise<unknown>).then !== 'function') {
    set({ status: 'none', api: null });
    return;
  }
  (pending as Promise<unknown>).then(
    (api) => set(api && typeof (api as DownloadsApi).save === 'function' ? { status: 'ready', api: api as DownloadsApi } : { status: 'none', api: null }),
    () => set({ status: 'none', api: null }),
  );
}

/** Tras un error que indica que este visor no puede guardar ficheros, se dejan de ofrecer. */
export function disableDownloads(): void {
  set({ status: 'none', api: null });
}

export function useDownloads(): State {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
  );
}

/** Códigos que significan «aquí no se puede guardar»: se oculta el botón y se muestra la vista previa. */
export const UNAVAILABLE_CODES = new Set(['unavailable', 'not_granted', 'capability_disabled', 'capability_removed', 'extension_not_enabled']);
