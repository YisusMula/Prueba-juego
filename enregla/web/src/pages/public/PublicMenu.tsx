import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router';
import { ALLERGENS, ALLERGEN_LABELS } from '@shared/schemas';
import { api, isApiError } from '@/api/client';
import type { AllergenId, PublicMenu } from '@/api/types';
import { AllergenIcon } from '@/components/icons/AllergenIcon';
import { Icon } from '@/components/icons/Icon';
import { Skeleton } from '@/components/ui/Feedback';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { APP_NAME } from '@/config/brand';
import { formatDateTime } from '@/lib/format';
import { cn } from '@/lib/cn';

type State = { status: 'loading' } | { status: 'ok'; menu: PublicMenu } | { status: 'notfound' } | { status: 'error'; message: string };

/** Nombres cortos para los chips del filtro (la leyenda oficial completa se muestra abajo). */
const SHORT: Record<AllergenId, string> = {
  gluten: 'Gluten',
  crustaceans: 'Crustáceos',
  eggs: 'Huevo',
  fish: 'Pescado',
  peanuts: 'Cacahuete',
  soybeans: 'Soja',
  milk: 'Leche',
  nuts: 'Frutos de cáscara',
  celery: 'Apio',
  mustard: 'Mostaza',
  sesame: 'Sésamo',
  sulphites: 'Sulfitos',
  lupin: 'Altramuces',
  molluscs: 'Moluscos',
};

export function PublicMenuPage() {
  const { slug = '' } = useParams();
  const [state, setState] = useState<State>({ status: 'loading' });
  const [selected, setSelected] = useState<Set<AllergenId>>(new Set());
  const [hideUnsafe, setHideUnsafe] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useDocumentTitle(state.status === 'ok' ? `Alérgenos · ${state.menu.organization.name}` : 'Carta de alérgenos');

  useEffect(() => {
    let active = true;
    api.get<PublicMenu>(`/api/public/menu/${encodeURIComponent(slug)}`, { silentAuth: true }).then(
      (menu) => active && setState({ status: 'ok', menu }),
      (err: unknown) => {
        if (!active) return;
        if (isApiError(err) && err.code === 'NOT_FOUND') setState({ status: 'notfound' });
        else setState({ status: 'error', message: isApiError(err) ? err.message : 'No se pudo cargar la carta.' });
      },
    );
    return () => {
      active = false;
    };
  }, [slug, attempt]);

  const groups = useMemo(() => {
    if (state.status !== 'ok') return [];
    const map = new Map<string, PublicMenu['dishes']>();
    for (const d of state.menu.dishes) {
      const key = d.category ?? 'Otros';
      map.set(key, [...(map.get(key) ?? []), d]);
    }
    return [...map.entries()];
  }, [state]);

  const toggle = (a: AllergenId) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(a)) n.delete(a);
      else n.add(a);
      return n;
    });

  return (
    <div className="min-h-dvh bg-paper">
      <main id="main" tabIndex={-1} className="mx-auto max-w-2xl px-4 pt-8 pb-16 outline-none">
        {state.status === 'loading' ? (
          <div role="status" className="space-y-4">
            <span className="sr-only">Cargando carta…</span>
            <Skeleton className="h-10 w-2/3" />
            <Skeleton className="h-24" />
            <Skeleton className="h-20" />
            <Skeleton className="h-20" />
          </div>
        ) : state.status === 'notfound' ? (
          <div className="py-16 text-center">
            <Icon name="utensils" size={48} className="mx-auto text-ink-muted" />
            <h1 className="mt-4 text-2xl font-extrabold">Esta carta no está disponible</h1>
            <p className="mt-2 text-ink-muted">Puede que el código QR haya cambiado. Pregunta al personal por la información de alérgenos.</p>
          </div>
        ) : state.status === 'error' ? (
          <div className="py-16 text-center" role="alert">
            <h1 className="text-2xl font-extrabold">No se pudo cargar la carta</h1>
            <p className="mt-2 text-ink-muted">{state.message}</p>
            <button type="button" onClick={() => setAttempt((a) => a + 1)} className="mt-6 min-h-12 rounded-xl bg-brand px-6 font-semibold text-on-brand">
              Reintentar
            </button>
          </div>
        ) : (
          <>
            <header>
              <p className="text-sm font-bold tracking-wide text-brand uppercase">Información de alérgenos</p>
              <h1 className="mt-1 text-[2rem] leading-tight font-extrabold sm:text-4xl">{state.menu.organization.name}</h1>
            </header>

            <section aria-labelledby="filtro" className="sticky top-0 z-10 -mx-4 mt-5 border-b border-line bg-paper/95 px-4 py-4 backdrop-blur">
              <h2 id="filtro" className="text-lg font-bold">
                Soy alérgico/a a…
              </h2>
              <div className="mt-3 flex gap-2 overflow-x-auto pb-1 [scrollbar-width:thin]" role="group" aria-label="Alérgenos a evitar">
                {ALLERGENS.map((a) => {
                  const on = selected.has(a);
                  return (
                    <button
                      key={a}
                      type="button"
                      aria-pressed={on}
                      onClick={() => toggle(a)}
                      className={cn(
                        'inline-flex min-h-12 shrink-0 items-center gap-2 rounded-full border-2 py-1 pr-4 pl-1.5 font-semibold transition-colors',
                        on ? 'border-ink bg-ink text-paper' : 'border-line bg-surface hover:border-line-strong',
                      )}
                    >
                      <AllergenIcon id={a} size={34} />
                      {SHORT[a]}
                      {on ? <Icon name="check" size={16} strokeWidth={3} /> : null}
                    </button>
                  );
                })}
              </div>
              {selected.size > 0 ? (
                <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
                  <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 font-semibold">
                    <input type="checkbox" checked={hideUnsafe} onChange={(e) => setHideUnsafe(e.target.checked)} className="size-5 accent-[var(--brand)]" />
                    Ocultar platos que lo contienen
                  </label>
                  <button type="button" onClick={() => setSelected(new Set())} className="min-h-11 font-semibold text-brand-strong underline underline-offset-4 dark:text-brand">
                    Quitar filtro
                  </button>
                </div>
              ) : null}
            </section>

            {state.menu.dishes.length === 0 ? (
              <p className="mt-10 text-center text-ink-muted">Todavía no hay platos publicados.</p>
            ) : (
              <div className="mt-6 space-y-8" aria-live="polite">
                {groups.map(([category, dishes]) => {
                  const visible = dishes
                    .map((d) => {
                      const hits = [...selected].filter((a) => d.allergens[a] === 'contains');
                      const traces = [...selected].filter((a) => d.allergens[a] === 'traces');
                      return { d, hits, traces };
                    })
                    .filter((x) => !(hideUnsafe && x.hits.length > 0));
                  if (visible.length === 0) return null;
                  return (
                    <section key={category} aria-labelledby={`cat-${category}`}>
                      <h2 id={`cat-${category}`} className="mb-3 text-xl font-extrabold">
                        {category}
                      </h2>
                      <ul className="space-y-3">
                        {visible.map(({ d, hits, traces }) => {
                          const contains = ALLERGENS.filter((a) => d.allergens[a] === 'contains');
                          const mayContain = ALLERGENS.filter((a) => d.allergens[a] === 'traces');
                          const unsafe = hits.length > 0;
                          return (
                            <li
                              key={d.name}
                              className={cn(
                                'rounded-2xl border bg-surface p-4 shadow-card',
                                unsafe ? 'border-bad/40 opacity-75' : selected.size > 0 && traces.length === 0 ? 'border-ok/50' : 'border-line',
                              )}
                            >
                              <div className="flex items-start justify-between gap-3">
                                <h3 className="text-lg font-bold">{d.name}</h3>
                                {selected.size > 0 ? (
                                  unsafe ? (
                                    <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-bad-soft px-2.5 py-0.5 text-sm font-bold text-bad">
                                      <Icon name="x" size={14} strokeWidth={3} /> No apto
                                    </span>
                                  ) : traces.length ? (
                                    <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-warn-soft px-2.5 py-0.5 text-sm font-bold text-warn">
                                      <Icon name="alert" size={14} strokeWidth={2.5} /> Trazas
                                    </span>
                                  ) : (
                                    <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-ok-soft px-2.5 py-0.5 text-sm font-bold text-ok">
                                      <Icon name="check" size={14} strokeWidth={3} /> Sin tus alérgenos
                                    </span>
                                  )
                                ) : null}
                              </div>
                              {d.description ? <p className="mt-1 text-ink-muted">{d.description}</p> : null}
                              {contains.length === 0 && mayContain.length === 0 ? (
                                <p className="mt-3 text-sm font-semibold text-ok">No contiene ninguno de los 14 alérgenos</p>
                              ) : (
                                <div className="mt-3 space-y-2">
                                  {contains.length ? (
                                    <div>
                                      <p className="text-sm font-bold">Contiene:</p>
                                      <ul className="mt-1 flex flex-wrap gap-1.5">
                                        {contains.map((a) => (
                                          <li key={a} className={cn('inline-flex items-center gap-1.5 rounded-full py-0.5 pr-3 pl-0.5 text-sm font-semibold', hits.includes(a) ? 'bg-bad-solid text-white' : 'bg-surface-2')}>
                                            <AllergenIcon id={a} size={26} /> {SHORT[a]}
                                          </li>
                                        ))}
                                      </ul>
                                    </div>
                                  ) : null}
                                  {mayContain.length ? (
                                    <div>
                                      <p className="text-sm font-bold">Puede contener trazas de:</p>
                                      <ul className="mt-1 flex flex-wrap gap-1.5">
                                        {mayContain.map((a) => (
                                          <li key={a} className="inline-flex items-center gap-1.5 rounded-full border border-dashed border-line-strong py-0.5 pr-3 pl-0.5 text-sm">
                                            <AllergenIcon id={a} size={26} status="traces" /> {SHORT[a]}
                                          </li>
                                        ))}
                                      </ul>
                                    </div>
                                  ) : null}
                                </div>
                              )}
                            </li>
                          );
                        })}
                      </ul>
                    </section>
                  );
                })}
              </div>
            )}

            <aside className="mt-10 rounded-2xl border border-line bg-surface-2/60 p-4 text-sm">
              <p className="flex gap-2">
                <Icon name="info" size={18} className="mt-0.5 shrink-0" />
                <span>{state.menu.notice}</span>
              </p>
              {state.menu.updatedAt ? <p className="mt-2 text-ink-muted">Actualizado el {formatDateTime(state.menu.updatedAt)}.</p> : null}
              <details className="mt-3">
                <summary className="min-h-10 cursor-pointer font-semibold">Leyenda de los 14 alérgenos</summary>
                <ul className="mt-2 grid gap-2 sm:grid-cols-2">
                  {ALLERGENS.map((a) => (
                    <li key={a} className="flex items-center gap-2">
                      <AllergenIcon id={a} size={28} /> {ALLERGEN_LABELS[a]}
                    </li>
                  ))}
                </ul>
              </details>
            </aside>
            <p className="mt-6 text-center text-xs text-ink-muted">Carta de alérgenos gestionada con {APP_NAME}</p>
          </>
        )}
      </main>
    </div>
  );
}
