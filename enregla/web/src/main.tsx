import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import './styles/index.css';
import { App } from './App';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Service worker: caché solo del "app shell" (nunca de /api). Se actualiza solo.
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  registerSW({ immediate: true });
}
