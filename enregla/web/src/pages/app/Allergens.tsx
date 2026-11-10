import { useMemo, useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { ALLERGENS, ALLERGEN_LABELS, ALLERGEN_STATUS_LABELS, dishBody } from '@shared/schemas';
import { api, errorMessage, isApiError } from '@/api/client';
import { keys, useDishes, usePublicMenuSettings } from '@/api/queries';
import type { AllergenId, AllergenMap, AllergenStatus, Dish, PublicMenuSettings } from '@/api/types';
import { useOrgContext } from '@/hooks/useOrgContext';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { Button, LinkButton, buttonClasses } from '@/components/ui/Button';
import { Badge, Callout, EmptyState, ErrorState, LoadingBlock, Skeleton } from '@/components/ui/Feedback';
import { Card, PageHeader, SectionTitle } from '@/components/ui/Layout';
import { Field, Input, Switch, Textarea, detailsToFieldErrors, zodToFieldErrors } from '@/components/ui/Form';
import { ConfirmDialog, Dialog, useToast } from '@/components/ui/Overlay';
import { QrCode } from '@/components/ui/QrCode';
import { AllergenIcon } from '@/components/icons/AllergenIcon';
import { Icon } from '@/components/icons/Icon';
import { WriteGuard } from '@/features/SubscriptionBanner';
import { formatDateTime } from '@/lib/format';
import { cn } from '@/lib/cn';

const emptyMap = (): AllergenMap => Object.fromEntries(ALLERGENS.map((a) => [a, 'no'])) as AllergenMap;
export const publicMenuUrl = (slug: string) => `${window.location.origin}/carta/${slug}`;

export function AllergensPage() {
  const { orgId, readOnly, path, tz } = useOrgContext();
  useDocumentTitle('Alérgenos');
  const dishes = useDishes(orgId);
  const [editing, setEditing] = useState<Dish | null | undefined>(undefined);
  const [deleting, setDeleting] = useState<Dish | null>(null);
  const [busy, setBusy] = useState(false);
  const qc = useQueryClient();
  const toast = useToast();

  const grouped = useMemo(() => {
    const m = new Map<string, Dish[]>();
    for (const d of [...(dishes.data ?? [])].sort((a, b) => (a.category ?? '').localeCompare(b.category ?? '') || a.name.localeCompare(b.name))) {
      const k = d.category ?? 'Sin categoría';
      m.set(k, [...(m.get(k) ?? []), d]);
    }
    return [...m.entries()];
  }, [dishes.data]);

  const remove = async () => {
    if (!deleting) return;
    setBusy(true);
    try {
      await api.del(`/api/orgs/${orgId}/dishes/${deleting.id}`);
      toast.show(`«${deleting.name}» eliminado`);
      setDeleting(null);
      await qc.invalidateQueries({ queryKey: keys.orgScoped(orgId, 'dishes') });
    } catch (err) {
      toast.show(errorMessage(err), 'bad');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader
        title="Carta de alérgenos"
        subtitle="Marca los 14 alérgenos de declaración obligatoria en cada plato. Revisa las fichas técnicas de tus proveedores."
        actions={
          <>
            <LinkButton to={path('alergenos/imprimir')} variant="secondary" icon="printer">
              Imprimir tabla
            </LinkButton>
            {readOnly ? null : (
              <Button icon="plus" onClick={() => setEditing(null)}>
                Añadir plato
              </Button>
            )}
          </>
        }
      />
      <div className="grid gap-6 xl:grid-cols-[1fr_22rem]">
        <section aria-labelledby="platos">
          <h2 id="platos" className="sr-only">
            Platos
          </h2>
          {readOnly ? <WriteGuard what="añadir ni cambiar platos">{null}</WriteGuard> : null}
          {dishes.isPending ? (
            <LoadingBlock rows={4} />
          ) : dishes.isError ? (
            <ErrorState error={dishes.error} onRetry={() => void dishes.refetch()} />
          ) : dishes.data.length === 0 ? (
            <EmptyState icon="utensils" title="Aún no hay platos" action={readOnly ? null : <Button icon="plus" onClick={() => setEditing(null)}>Añadir el primer plato</Button>}>
              Añade tus platos y marca sus alérgenos. Después podrás compartir la carta con un código QR.
            </EmptyState>
          ) : (
            <div className="space-y-6">
              {grouped.map(([cat, list]) => (
                <div key={cat}>
                  <h3 className="mb-2 text-lg font-bold text-ink-muted">{cat}</h3>
                  <ul className="space-y-3">
                    {list.map((d) => {
                      const contains = ALLERGENS.filter((a) => d.allergens[a] === 'contains');
                      const traces = ALLERGENS.filter((a) => d.allergens[a] === 'traces');
                      return (
                        <li key={d.id} className={cn('rounded-2xl border border-line bg-surface p-4 shadow-card', !d.visible && 'opacity-75')}>
                          <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
                            <div className="min-w-0 flex-1">
                              <p className="text-lg font-bold">{d.name}</p>
                              {d.description ? <p className="text-ink-muted">{d.description}</p> : null}
                              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                                {contains.length === 0 && traces.length === 0 ? <Badge tone="ok" icon="check">Sin alérgenos</Badge> : null}
                                {contains.map((a) => (
                                  <span key={a} className="inline-flex items-center gap-1 rounded-full bg-surface-2 py-0.5 pr-2.5 pl-0.5 text-sm font-semibold" title={ALLERGEN_LABELS[a]}>
                                    <AllergenIcon id={a} size={24} /> {ALLERGEN_LABELS[a].split(' ')[0]}
                                  </span>
                                ))}
                                {traces.map((a) => (
                                  <span key={a} className="inline-flex items-center gap-1 rounded-full border border-dashed border-line-strong py-0.5 pr-2.5 pl-0.5 text-sm" title={`Trazas: ${ALLERGEN_LABELS[a]}`}>
                                    <AllergenIcon id={a} size={24} status="traces" /> Trazas
                                  </span>
                                ))}
                                {!d.visible ? <Badge icon="eyeOff">Oculto en la carta</Badge> : null}
                              </div>
                            </div>
                            {readOnly ? null : (
                              <div className="flex shrink-0 gap-2">
                                <Button variant="secondary" icon="pencil" onClick={() => setEditing(d)} aria-label={`Editar ${d.name}`}>
                                  Editar
                                </Button>
                                <Button variant="ghost" icon="trash" onClick={() => setDeleting(d)} aria-label={`Eliminar ${d.name}`}>
                                  <span className="sr-only sm:not-sr-only">Eliminar</span>
                                </Button>
                              </div>
                            )}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
              <p className="text-sm text-ink-muted">Última modificación: {formatDateTime(dishes.data.reduce((m, d) => (d.updatedAt > m ? d.updatedAt : m), dishes.data[0]!.updatedAt), tz)}</p>
            </div>
          )}
        </section>
        <PublicMenuCard />
      </div>
      {editing !== undefined ? (
        <DishDialog
          key={editing?.id ?? 'new'}
          dish={editing}
          onClose={() => setEditing(undefined)}
          onSaved={(d) => {
            setEditing(undefined);
            toast.show(`«${d.name}» guardado`);
            void qc.invalidateQueries({ queryKey: keys.orgScoped(orgId, 'dishes') });
          }}
        />
      ) : null}
      <ConfirmDialog open={!!deleting} onClose={() => setDeleting(null)} onConfirm={() => void remove()} loading={busy} title={`¿Eliminar «${deleting?.name ?? ''}»?`} confirmLabel="Eliminar">
        Desaparecerá también de la carta pública.
      </ConfirmDialog>
    </>
  );
}

const STATUS_OPTIONS: { v: AllergenStatus; short: string }[] = [
  { v: 'contains', short: 'Contiene' },
  { v: 'traces', short: 'Trazas' },
  { v: 'no', short: 'No' },
];

function DishDialog({ dish, onClose, onSaved }: { dish: Dish | null; onClose: () => void; onSaved: (d: Dish) => void }) {
  const { orgId } = useOrgContext();
  const [name, setName] = useState(dish?.name ?? '');
  const [category, setCategory] = useState(dish?.category ?? '');
  const [description, setDescription] = useState(dish?.description ?? '');
  const [visible, setVisible] = useState(dish?.visible ?? true);
  const [allergens, setAllergens] = useState<AllergenMap>(dish?.allergens ?? emptyMap());
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [general, setGeneral] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const body = { name: name.trim(), category: category.trim() || null, description: description.trim() || null, allergens, visible };
    const parsed = dishBody.safeParse(body);
    if (!parsed.success) return setErrors(zodToFieldErrors(parsed.error.issues));
    setErrors({});
    setGeneral(null);
    setLoading(true);
    try {
      const r = dish ? await api.patch<{ dish: Dish }>(`/api/orgs/${orgId}/dishes/${dish.id}`, body) : await api.post<{ dish: Dish }>(`/api/orgs/${orgId}/dishes`, body);
      onSaved(r.dish);
    } catch (err) {
      if (isApiError(err) && err.details.length) setErrors(detailsToFieldErrors(err.details));
      else setGeneral(errorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open onClose={onClose} title={dish ? 'Editar plato' : 'Nuevo plato'} size="lg">
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Nombre del plato" error={errors.name}>
            <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={150} />
          </Field>
          <Field label="Categoría" optional error={errors.category} hint="Entrantes, principales, postres…">
            <Input value={category} onChange={(e) => setCategory(e.target.value)} maxLength={100} />
          </Field>
        </div>
        <Field label="Descripción" optional error={errors.description}>
          <Textarea value={description} onChange={(e) => setDescription(e.target.value)} maxLength={1000} rows={2} />
        </Field>
        <fieldset>
          <legend className="font-semibold">Alérgenos</legend>
          <p className="mb-2 text-sm text-ink-muted">Para cada uno: contiene, puede contener trazas o no contiene.</p>
          <ul className="divide-y divide-line rounded-2xl border border-line">
            {ALLERGENS.map((a: AllergenId) => (
              <li key={a} className="flex flex-col gap-2 px-3 py-2.5 sm:flex-row sm:items-center">
                <span className="flex min-w-0 flex-1 items-center gap-2.5" id={`al-${a}`}>
                  <AllergenIcon id={a} size={34} status={allergens[a]} />
                  <span className="font-semibold">{ALLERGEN_LABELS[a]}</span>
                </span>
                <div role="radiogroup" aria-labelledby={`al-${a}`} className="grid shrink-0 grid-cols-3 gap-1 rounded-xl bg-surface-2 p-1">
                  {STATUS_OPTIONS.map((o) => {
                    const on = allergens[a] === o.v;
                    return (
                      <button
                        key={o.v}
                        type="button"
                        role="radio"
                        aria-checked={on}
                        aria-label={`${ALLERGEN_LABELS[a]}: ${ALLERGEN_STATUS_LABELS[o.v]}`}
                        onClick={() => setAllergens((m) => ({ ...m, [a]: o.v }))}
                        className={cn(
                          'min-h-11 rounded-lg px-3 text-sm font-bold transition-colors',
                          on && o.v === 'contains' && 'bg-bad-solid text-white',
                          on && o.v === 'traces' && 'bg-warn-solid text-ink',
                          on && o.v === 'no' && 'bg-surface text-ink shadow-card',
                          !on && 'text-ink-muted hover:text-ink',
                        )}
                      >
                        {o.short}
                      </button>
                    );
                  })}
                </div>
              </li>
            ))}
          </ul>
        </fieldset>
        <Switch checked={visible} onChange={setVisible} label="Mostrar en la carta pública" />
        {general ? <Callout tone="bad" live="assertive">{general}</Callout> : null}
        <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" loading={loading}>
            Guardar plato
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function PublicMenuCard() {
  const { orgId, readOnly } = useOrgContext();
  const q = usePublicMenuSettings(orgId);
  const qc = useQueryClient();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [confirmRegen, setConfirmRegen] = useState(false);

  const update = async (fn: () => Promise<{ publicMenu: PublicMenuSettings }>, msg: string) => {
    setBusy(true);
    try {
      const r = await fn();
      qc.setQueryData(keys.orgScoped(orgId, 'public-menu'), r.publicMenu);
      await qc.invalidateQueries({ queryKey: keys.org(orgId), exact: true });
      toast.show(msg);
    } catch (err) {
      toast.show(errorMessage(err), 'bad');
    } finally {
      setBusy(false);
      setConfirmRegen(false);
    }
  };

  const copy = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      toast.show('Enlace copiado');
    } catch {
      toast.show('No se pudo copiar. Selecciona el enlace y cópialo a mano.', 'info');
    }
  };

  return (
    <Card as="aside" aria-labelledby="carta-publica" className="h-fit">
      <SectionTitle id="carta-publica">Carta pública</SectionTitle>
      {q.isPending ? (
        <Skeleton className="h-64" />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : (
        <div className="space-y-4">
          <Switch
            checked={q.data.enabled}
            disabled={busy || readOnly}
            onChange={(v) => void update(() => api.patch(`/api/orgs/${orgId}/public-menu`, { enabled: v }), v ? 'Carta pública activada' : 'Carta pública desactivada')}
            label="Activar carta pública"
            description="Tus clientes la consultan desde el móvil escaneando el QR. Solo muestra los platos visibles."
          />
          {q.data.enabled ? (
            <>
              <div className="flex justify-center rounded-2xl border border-line bg-white p-3">
                <QrCode value={publicMenuUrl(q.data.slug)} size={200} label="Código QR de la carta pública" />
              </div>
              <div>
                <p className="text-sm font-semibold">Enlace</p>
                <p className="rounded-xl bg-surface-2 px-3 py-2 font-mono text-sm break-all" data-testid="public-menu-url">
                  {publicMenuUrl(q.data.slug)}
                </p>
              </div>
              <div className="grid gap-2">
                <Button variant="secondary" icon="copy" onClick={() => void copy(publicMenuUrl(q.data.slug))}>
                  Copiar enlace
                </Button>
                <a href={`/carta/${q.data.slug}`} target="_blank" rel="noopener noreferrer" className={buttonClasses('secondary')}>
                  <Icon name="external" size={20} /> Abrir la carta
                </a>
                {readOnly ? null : (
                  <Button variant="ghost" icon="refresh" onClick={() => setConfirmRegen(true)}>
                    Cambiar el enlace
                  </Button>
                )}
              </div>
            </>
          ) : (
            <p className="text-ink-muted">Desactivada: el enlace y el QR no muestran nada.</p>
          )}
        </div>
      )}
      <ConfirmDialog
        open={confirmRegen}
        onClose={() => setConfirmRegen(false)}
        onConfirm={() => void update(() => api.post(`/api/orgs/${orgId}/public-menu/regenerate`), 'Nuevo enlace generado')}
        loading={busy}
        title="¿Cambiar el enlace de la carta?"
        confirmLabel="Cambiar enlace"
      >
        El enlace y los QR que ya hayas impreso dejarán de funcionar. Tendrás que imprimir el nuevo QR.
      </ConfirmDialog>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Versión imprimible
// ---------------------------------------------------------------------------
export function AllergensPrintPage() {
  const { orgId, org, path, tz } = useOrgContext();
  useDocumentTitle('Tabla de alérgenos');
  const dishes = useDishes(orgId);
  const menu = usePublicMenuSettings(orgId);
  const list = [...(dishes.data ?? [])].filter((d) => d.visible).sort((a, b) => (a.category ?? '').localeCompare(b.category ?? '') || a.name.localeCompare(b.name));
  return (
    <div className="mx-auto max-w-[1100px] bg-surface p-4 sm:p-8 print:max-w-none print:p-0">
      <div className="no-print mb-6 flex flex-wrap gap-3">
        <Link to={path('alergenos')} className={buttonClasses('secondary')}>
          <Icon name="chevronLeft" size={20} /> Volver
        </Link>
        <Button icon="printer" onClick={() => window.print()}>
          Imprimir
        </Button>
      </div>
      <header className="flex items-start justify-between gap-6">
        <div>
          <h1 className="text-3xl font-extrabold">Información de alérgenos</h1>
          <p className="text-lg">{org.name}</p>
          <p className="text-sm text-ink-muted">
            ● Contiene · ◐ Puede contener trazas · vacío: no contiene. Actualizado el {formatDateTime(new Date().toISOString(), tz)}.
          </p>
        </div>
        {menu.data?.enabled ? (
          <div className="shrink-0 text-center">
            <QrCode value={publicMenuUrl(menu.data.slug)} size={110} label="QR de la carta pública" />
            <p className="text-xs">Escanéame</p>
          </div>
        ) : null}
      </header>
      {dishes.isPending ? (
        <LoadingBlock />
      ) : dishes.isError ? (
        <ErrorState error={dishes.error} onRetry={() => void dishes.refetch()} />
      ) : list.length === 0 ? (
        <p className="mt-8">No hay platos visibles.</p>
      ) : (
        <div className="mt-6 overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr>
                <th scope="col" className="border border-line-strong p-2 text-left align-bottom">
                  Plato
                </th>
                {ALLERGENS.map((a) => (
                  <th key={a} scope="col" className="w-12 border border-line-strong p-1 align-bottom">
                    <div className="flex flex-col items-center gap-1">
                      <AllergenIcon id={a} size={28} />
                      <span className="text-[10px] leading-tight font-semibold">{ALLERGEN_LABELS[a].replace('Cereales que contienen ', '').replace('Dióxido de azufre y ', '')}</span>
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {list.map((d) => (
                <tr key={d.id}>
                  <th scope="row" className="border border-line-strong p-2 text-left font-semibold">
                    {d.name}
                    {d.category ? <span className="block text-xs font-normal text-ink-muted">{d.category}</span> : null}
                  </th>
                  {ALLERGENS.map((a) => (
                    <td key={a} className="border border-line-strong p-1 text-center text-lg">
                      {d.allergens[a] === 'contains' ? (
                        <span aria-label="Contiene">●</span>
                      ) : d.allergens[a] === 'traces' ? (
                        <span aria-label="Puede contener trazas">◐</span>
                      ) : (
                        <span className="sr-only">No contiene</span>
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-4 text-xs text-ink-muted">
        Si tienes alguna alergia o intolerancia, consulta al personal antes de pedir. Información elaborada por el establecimiento.
      </p>
    </div>
  );
}
