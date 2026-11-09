import { useEffect } from 'react';
import { APP_NAME } from '@/config/brand';

export function useDocumentTitle(title?: string) {
  useEffect(() => {
    document.title = title ? `${title} · ${APP_NAME}` : `${APP_NAME} · Registros de higiene alimentaria sin papeles`;
  }, [title]);
}
