/**
 * Barra fija de la demo: aviso de datos de ejemplo, accesos a las cuatro caras del producto y
 * «Reiniciar demo». Mide su altura y la publica en `--app-top` para que las cabeceras fijas de la
 * app se coloquen debajo (nunca tapa la navegación inferior).
 */
import { useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { createMemoryRouter } from 'react-router';
import { Icon, type IconName } from '@/components/icons/Icon';
import { cn } from '@/lib/cn';
import { pairDemoKiosk, publicMenuPath } from './actions';

type Router = ReturnType<typeof createMemoryRouter>;
type Face = 'portada' | 'panel' | 'cocina' | 'carta';

const FACES: { id: Face; label: string; short: string; icon: IconName }[] = [
  { id: 'portada', label: 'Portada', short: 'Portada', icon: 'home' },
  { id: 'panel', label: 'Panel del dueño', short: 'Panel', icon: 'today' },
  { id: 'cocina', label: 'Modo cocina', short: 'Cocina', icon: 'chef' },
  { id: 'carta', label: 'Carta de alérgenos', short: 'Carta', icon: 'utensils' },
];

function faceOf(pathname: string): Face | null {
  if (pathname === '/') return 'portada';
  if (/^\/(locales|app|nuevo-local)(\/|$)/.test(pathname)) return 'panel';
  if (/^\/cocina(\/|$)/.test(pathname)) return 'cocina';
  if (/^\/carta\//.test(pathname)) return 'carta';
  return null;
}

export function DemoBar({ router, onReset }: { router: Router; onReset: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const path = useSyncExternalStore(
    (onChange) => router.subscribe(onChange),
    () => router.state.location.pathname,
  );
  const [confirming, setConfirming] = useState(false);
  const [status, setStatus] = useState('');

  // Altura de la barra → --app-top (cabeceras fijas de la app) y margen superior del contenido.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const apply = () => {
      const h = Math.ceil(el.getBoundingClientRect().height);
      document.documentElement.style.setProperty('--app-top', `${h}px`);
    };
    apply();
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(apply) : null;
    ro?.observe(el);
    window.addEventListener('resize', apply);
    return () => {
      ro?.disconnect();
      window.removeEventListener('resize', apply);
    };
  }, []);

  const go = (face: Face) => {
    setStatus('');
    setConfirming(false);
    if (face === 'portada') void router.navigate('/');
    else if (face === 'panel') void router.navigate('/app');
    else if (face === 'cocina') {
      if (pairDemoKiosk()) void router.navigate('/cocina', { state: { kioskStart: 'who' } });
      else void router.navigate('/cocina');
    } else {
      const p = publicMenuPath();
      void router.navigate(p ?? '/');
    }
    window.scrollTo({ top: 0 });
  };

  const active = faceOf(path);
  return (
    <div
      ref={ref}
      data-demo-bar
      className="fixed inset-x-0 top-0 z-[45] border-b border-line-strong bg-surface-3 pt-[env(safe-area-inset-top)] pr-[max(0.75rem,env(safe-area-inset-right))] pl-[max(0.75rem,env(safe-area-inset-left))] text-ink shadow-card"
    >
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-3 gap-y-1.5 py-1.5">
        <p className="flex min-w-0 flex-1 items-center gap-2 text-[0.8125rem] leading-tight font-semibold sm:flex-none">
          <span className="shrink-0 rounded-md bg-brand px-1.5 py-0.5 text-[0.75rem] font-extrabold tracking-wide whitespace-nowrap text-on-brand uppercase">Demo</span>
          <span className="min-w-0">Los datos son de ejemplo y no se guardan</span>
        </p>
        <nav aria-label="Demo: ir a" className="order-3 grid w-full grid-cols-4 gap-1 sm:order-none sm:flex sm:w-auto sm:flex-1 sm:justify-center">
          {FACES.map((f) => (
            <button
              key={f.id}
              type="button"
              aria-label={f.label}
              aria-current={active === f.id ? 'page' : undefined}
              onClick={() => go(f.id)}
              className={cn(
                'flex min-h-9 min-w-0 items-center justify-center gap-1.5 rounded-lg px-2 text-[0.8125rem] leading-tight font-bold whitespace-nowrap',
                active === f.id ? 'bg-brand text-on-brand' : 'bg-surface text-ink hover:bg-surface-2',
              )}
            >
              <Icon name={f.icon} size={16} className="hidden shrink-0 min-[420px]:block" />
              <span className="lg:hidden">{f.short}</span>
              <span className="hidden lg:inline">{f.label}</span>
            </button>
          ))}
        </nav>
        <button
          type="button"
          onClick={() => setConfirming((c) => !c)}
          aria-expanded={confirming}
          className="flex min-h-9 shrink-0 items-center gap-1.5 rounded-lg px-2 text-[0.8125rem] font-bold text-ink hover:bg-surface-2"
        >
          <Icon name="refresh" size={16} /> Reiniciar demo
        </button>
      </div>
      {confirming ? (
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-2 border-t border-line pt-1.5 pb-2 text-[0.8125rem]" role="group" aria-label="Confirmar reinicio">
          <span className="min-w-0 flex-1">¿Volver a los datos iniciales? Se pierde lo que hayas registrado.</span>
          <button
            type="button"
            className="min-h-9 rounded-lg bg-brand px-3 font-bold text-on-brand"
            onClick={() => {
              setConfirming(false);
              onReset();
              setStatus('Demo reiniciada con los datos iniciales.');
              window.scrollTo({ top: 0 });
            }}
          >
            Sí, reiniciar
          </button>
          <button type="button" className="min-h-9 rounded-lg bg-surface px-3 font-bold" onClick={() => setConfirming(false)}>
            Cancelar
          </button>
        </div>
      ) : null}
      <p role="status" className="sr-only">
        {status}
      </p>
    </div>
  );
}
