import { useEffect, useState } from 'react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { QueryClientProvider } from '@tanstack/react-query';
import { createQueryClient, routes } from '@/routes';
import { DemoBar } from './DemoBar';
import { startPath } from './actions';
import { resetDb } from './server/store';
import { demoStorage } from './storage';

/**
 * La app real con un router EN MEMORIA: dentro del visor no se puede depender de la URL
 * (ni rutas con pushState, ni query strings, ni #ruta).
 */
function makeEnv() {
  return { router: createMemoryRouter(routes, { initialEntries: [startPath()] }), queryClient: createQueryClient() };
}

type Router = ReturnType<typeof makeEnv>['router'];

/**
 * Formularios: un marco con `sandbox` sin `allow-forms` bloquea el envío nativo ANTES de lanzar el evento
 * `submit`, así que React nunca lo recibiría. Al pulsar un botón de envío (también con Intro, que el
 * navegador convierte en un clic en ese botón) se cancela el envío nativo y se lanza el evento a mano;
 * la app siempre lo gestiona por JavaScript (preventDefault + petición a la API).
 */
function submitFromClick(e: MouseEvent): boolean {
  const btn = (e.target as Element | null)?.closest?.('button, input[type="submit"]') as HTMLButtonElement | HTMLInputElement | null;
  if (!btn || btn.type !== 'submit' || btn.disabled || !btn.form) return false;
  e.preventDefault();
  const form = btn.form;
  const event = typeof SubmitEvent === 'function' ? new SubmitEvent('submit', { bubbles: true, cancelable: true, submitter: btn }) : new Event('submit', { bubbles: true, cancelable: true });
  form.dispatchEvent(event);
  return true;
}

/** Enlaces <a> que el router no ha gestionado (anclas #seccion, target="_blank" internos…) y envíos de formularios. */
function useLinkInterceptor(router: Router) {
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented) return;
      if (submitFromClick(e)) return;
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.('a[href]');
      if (!a) return;
      const href = a.getAttribute('href') ?? '';
      if (href.startsWith('#')) {
        e.preventDefault();
        let id = href.slice(1);
        try {
          id = decodeURIComponent(id);
        } catch {
          // id sin codificar
        }
        const target = id ? document.getElementById(id) : null;
        if (target) {
          const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
          target.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
          if (target.tabIndex >= 0 || target.hasAttribute('tabindex')) target.focus({ preventScroll: true });
        }
        return;
      }
      if (href.startsWith('/') && !href.startsWith('//')) {
        e.preventDefault();
        void router.navigate(href);
        window.scrollTo({ top: 0 });
        return;
      }
      if (/^(mailto|tel):/i.test(href)) e.preventDefault();
    };
    document.addEventListener('click', onClick);
    return () => document.removeEventListener('click', onClick);
  }, [router]);
}

export function DemoApp() {
  const [env, setEnv] = useState(makeEnv);
  useLinkInterceptor(env.router);
  return (
    <>
      <DemoBar
        router={env.router}
        onReset={() => {
          env.router.dispose();
          resetDb();
          demoStorage.clear();
          setEnv(makeEnv());
        }}
      />
      <QueryClientProvider client={env.queryClient}>
        <RouterProvider router={env.router} />
      </QueryClientProvider>
    </>
  );
}
