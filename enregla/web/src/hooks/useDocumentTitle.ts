import { useEffect } from 'react';
import { APP_NAME } from '@/config/brand';
import { PUBLIC_URL } from '@/config/legal';

export function useDocumentTitle(title?: string) {
  useEffect(() => {
    document.title = title ? `${title} · ${APP_NAME}` : `${APP_NAME} · Registros de higiene alimentaria sin papeles`;
  }, [title]);
}

/**
 * Enlace canonical de las páginas públicas indexables (portada y legales), a partir de
 * VITE_PUBLIC_URL. Sin URL pública configurada no se añade nada.
 */
export function useCanonical(path: string) {
  useEffect(() => {
    if (!PUBLIC_URL) return;
    let link = document.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    if (!link) {
      link = document.createElement('link');
      link.rel = 'canonical';
      document.head.appendChild(link);
    }
    link.href = `${PUBLIC_URL}${path}`;
  }, [path]);
}
