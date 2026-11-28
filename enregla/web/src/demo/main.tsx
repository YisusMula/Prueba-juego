/**
 * Entrada de la compilación DEMO (`npm run build:demo`): la interfaz real de EnRegla con un
 * backend simulado en memoria, para publicarla como página estática dentro de un visor restringido
 * (sin servidor, sin service worker, sin descargas directas ni URL propias).
 * Este módulo y todo `src/demo/` NO entran en la compilación normal (`src/main.tsx`).
 */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './zod-jitless'; // primero: antes de crear ningún esquema
import '@shared/schemas'; // mensajes de validación en español (zod)
import '@/styles/index.css';
import './demo.css';
import { configurePlatform } from '@/lib/platform';
import { DemoApp } from './DemoApp';
import { DemoDownload } from './DemoDownload';
import { DEMO_NOTES } from './notes';
import { demoFetch } from './server';
import { DEMO_EMAIL, DEMO_PASSWORD } from './server/seed';
import { getDb } from './server/store';
import { demoStorage } from './storage';
import { initDownloads } from './downloads';

configurePlatform({
  fetch: demoFetch,
  storage: demoStorage,
  DownloadButton: DemoDownload,
  // Origen ficticio para los enlaces y QR que en la app real se comparten (carta, vinculación de tablets).
  appOrigin: () => 'https://app.enregla.example',
  canPrint: false,
  loginPrefill: { email: DEMO_EMAIL, password: DEMO_PASSWORD },
  notes: DEMO_NOTES,
});
getDb();
initDownloads();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <DemoApp />
  </StrictMode>,
);
