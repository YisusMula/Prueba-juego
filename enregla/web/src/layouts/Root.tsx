import { useEffect } from 'react';
import { Outlet, useLocation, useNavigate, useRouteError, isRouteErrorResponse, Link, ScrollRestoration } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { apiEvents, READ_ONLY_HIT, SESSION_EXPIRED } from '@/api/client';
import { ToastProvider } from '@/components/ui/Overlay';
import { Icon } from '@/components/icons/Icon';
import { useOnline } from '@/hooks/useOnline';
import { storage } from '@/lib/storage';
import { loginPath } from '@/lib/redirect';
import { buttonClasses } from '@/components/ui/Button';
import { Logo } from '@/components/ui/Logo';
import { SUPPORT_EMAIL } from '@/config/legal';

/** Rutas que requieren sesión: si caduca, se vuelve al login conservando el destino. */
const PRIVATE = /^\/(app|nuevo-local|locales)(\/|$)/;

function SessionWatcher() {
  const navigate = useNavigate();
  const location = useLocation();
  const qc = useQueryClient();
  // Ruta actual según el router (no window.location: el router puede no usar la barra de direcciones).
  const { pathname, search } = location;
  useEffect(() => {
    const onExpired = () => {
      storage.setSessionHint(false);
      if (!PRIVATE.test(pathname)) return;
      const next = pathname + search;
      qc.clear();
      navigate(`${loginPath(next)}&caducada=1`, { replace: true });
    };
    const onReadOnly = () => {
      void qc.invalidateQueries({ queryKey: ['org'] });
      void qc.invalidateQueries({ queryKey: ['account'] });
    };
    apiEvents.addEventListener(SESSION_EXPIRED, onExpired);
    apiEvents.addEventListener(READ_ONLY_HIT, onReadOnly);
    return () => {
      apiEvents.removeEventListener(SESSION_EXPIRED, onExpired);
      apiEvents.removeEventListener(READ_ONLY_HIT, onReadOnly);
    };
  }, [navigate, qc, location.key, pathname, search]);
  return null;
}

function OfflineBanner() {
  const online = useOnline();
  if (online) return null;
  return (
    <div role="status" className="sticky top-[var(--app-top,0px)] z-50 flex items-center justify-center gap-2 bg-ink px-4 py-2 text-center text-sm font-semibold text-paper">
      <Icon name="wifiOff" size={18} />
      Sin conexión. Lo que veas puede no estar actualizado y no se podrá guardar nada hasta que vuelva internet.
    </div>
  );
}

/** Mueve el foco al contenido principal al cambiar de página (lectores de pantalla). */
function RouteAnnouncer() {
  const location = useLocation();
  useEffect(() => {
    const main = document.getElementById('main');
    if (main && document.activeElement && document.activeElement !== document.body) {
      main.focus({ preventScroll: true });
    }
  }, [location.pathname]);
  return null;
}

export function Root() {
  return (
    <ToastProvider>
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[60] focus:rounded-xl focus:bg-ink focus:px-4 focus:py-3 focus:text-paper"
      >
        Saltar al contenido
      </a>
      <OfflineBanner />
      <SessionWatcher />
      <RouteAnnouncer />
      <ScrollRestoration />
      <Outlet />
    </ToastProvider>
  );
}

export function RouteError() {
  const error = useRouteError();
  const notFound = isRouteErrorResponse(error) && error.status === 404;
  // Un chunk que ya no existe tras un despliegue: recargar lo arregla.
  const chunk = error instanceof Error && /dynamically imported module|Importing a module script failed|Failed to fetch/i.test(error.message);
  return (
    <main id="main" tabIndex={-1} className="mx-auto flex min-h-dvh max-w-lg flex-col items-center justify-center px-6 text-center">
      <Logo />
      <h1 className="mt-8 text-3xl font-extrabold">{notFound ? 'Página no encontrada' : chunk ? 'Hay una versión nueva' : 'Algo ha fallado'}</h1>
      <p className="mt-2 text-ink-muted">
        {chunk ? 'Recarga la página para usar la última versión.' : 'Prueba a recargar la página. Si se repite, vuelve al inicio.'}
      </p>
      {SUPPORT_EMAIL && !chunk ? (
        <p className="mt-2 text-ink-muted">
          Si el problema continúa, escríbenos a{' '}
          <a href={`mailto:${SUPPORT_EMAIL}`} className="font-semibold underline underline-offset-4">
            {SUPPORT_EMAIL}
          </a>
          .
        </p>
      ) : null}
      <div className="mt-6 flex flex-wrap justify-center gap-3">
        <button type="button" className={buttonClasses('primary')} onClick={() => window.location.reload()}>
          <Icon name="refresh" size={20} /> Recargar
        </button>
        <Link to="/" className={buttonClasses('secondary')}>
          Ir al inicio
        </Link>
      </div>
    </main>
  );
}
