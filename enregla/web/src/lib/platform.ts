import { createElement, type ComponentType, type ReactNode } from 'react';
import type { IconName } from '@/components/icons/Icon';
import type { ButtonVariant } from '@/components/ui/Button';

/**
 * Puntos de extensión del entorno en el que corre la SPA. En la app normal todos tienen el
 * comportamiento por defecto (fetch real, localStorage, origen de la página…) y nada cambia.
 * Un entorno alternativo (p. ej. una compilación aislada que no tiene servidor) puede sustituirlos
 * llamando a `configurePlatform` ANTES de renderizar la aplicación.
 */
export type DownloadButtonProps = {
  url: string;
  fallbackName: string;
  children: ReactNode;
  icon?: IconName;
  variant?: ButtonVariant;
  disabled?: boolean;
  className?: string;
  busyLabel?: string;
};

/** Textos o avisos que un entorno puede añadir en puntos concretos de la interfaz. */
export type PlatformNoteId =
  | 'login'
  | 'register'
  | 'password-reset'
  | 'billing'
  | 'invitations'
  | 'export'
  | 'audit'
  | 'account-email'
  | 'print'
  | 'public-menu-link'
  | 'kiosk-pair'
  | 'device-token';

export type Platform = {
  /** Transporte HTTP de la API y de las descargas. */
  fetch: (input: string, init?: RequestInit) => Promise<Response>;
  /** Almacenamiento de preferencias (por defecto, localStorage con try/catch en `lib/storage`). */
  storage: { get: (key: string) => string | null; set: (key: string, value: string | null) => void } | null;
  /** Sustituto del botón de descarga (PDF, CSV, exportación). */
  DownloadButton: ComponentType<DownloadButtonProps> | null;
  /** Origen público con el que se construyen los enlaces que se comparten (carta, vinculación de tablets). */
  appOrigin: () => string;
  /** Si se puede imprimir con window.print(). */
  canPrint: boolean;
  /** Credenciales con las que se rellena el formulario de entrar. */
  loginPrefill: { email: string; password: string } | null;
  notes: Partial<Record<PlatformNoteId, ReactNode>>;
};

const defaults: Platform = {
  fetch: (input, init) => window.fetch(input, init),
  storage: null,
  DownloadButton: null,
  appOrigin: () => window.location.origin,
  canPrint: true,
  loginPrefill: null,
  notes: {},
};

export const platform: Platform = { ...defaults };

export function configurePlatform(overrides: Partial<Platform>): void {
  Object.assign(platform, overrides);
}

/** Aviso del entorno para un punto de la interfaz (null si no hay ninguno). */
export function PlatformNote({ id }: { id: PlatformNoteId }) {
  const note = platform.notes[id];
  return note ? createElement('div', { className: 'mb-5', 'data-platform-note': id }, note) : null;
}

export const hasPlatformNote = (id: PlatformNoteId) => !!platform.notes[id];
