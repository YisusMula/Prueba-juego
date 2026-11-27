import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { CUSTOM_FREQUENCY_LABELS, CUSTOM_KIND_LABELS, createCustomTemplateBody, type CustomFrequency, type CustomKind } from '@shared/schemas';
import { api, errorMessage, isApiError } from '@/api/client';
import { useCustomTemplates, useOrgMutation } from '@/api/queries';
import type { CustomTemplate, TemplateSuggestion } from '@/api/types';
import { useOrgContext } from '@/hooks/useOrgContext';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { Button } from '@/components/ui/Button';
import { Badge, Callout, ErrorState, LoadingBlock } from '@/components/ui/Feedback';
import { PageHeader, SectionTitle } from '@/components/ui/Layout';
import { ChoiceGroup, Field, Input, Select, Switch, Textarea, detailsToFieldErrors, zodToFieldErrors } from '@/components/ui/Form';
import { Dialog, useToast } from '@/components/ui/Overlay';
import { Icon } from '@/components/icons/Icon';
import { WriteGuard } from '@/features/SubscriptionBanner';
import { WEEKDAYS, formatDecimal, parseDecimal } from '@/lib/format';

/** «Cada día (2 veces)», «Cada lunes», «Día 1 de cada mes», «Cuando ocurra». */
export function customFrequencyText(t: Pick<CustomTemplate, 'frequency' | 'timesPerDay' | 'weekday' | 'monthDay'>): string {
  if (t.frequency === 'daily') return t.timesPerDay > 1 ? `Cada día (${t.timesPerDay} veces)` : 'Cada día';
  if (t.frequency === 'weekly') return t.weekday ? `Cada ${WEEKDAYS[t.weekday - 1]}` : 'Semanal';
  if (t.frequency === 'monthly') return t.monthDay ? `Día ${t.monthDay} de cada mes` : 'Mensual';
  return 'Cuando ocurra (no cuenta en el cumplimiento)';
}

function kindDetail(t: CustomTemplate): string {
  if (t.kind === 'checklist') return `${t.items.length} ${t.items.length === 1 ? 'punto' : 'puntos'} a comprobar`;
  if (t.kind === 'numeric') {
    const u = t.unit ? ` ${t.unit}` : '';
    const r = t.min != null && t.max != null ? `de ${formatDecimal(t.min)} a ${formatDecimal(t.max)}${u}` : t.min != null ? `mín. ${formatDecimal(t.min)}${u}` : t.max != null ? `máx. ${formatDecimal(t.max)}${u}` : `sin rango${u ? ` (${t.unit})` : ''}`;
    return `Valor: ${r}`;
  }
  return 'Pregunta de sí o no';
}

/** Ajustes → Registros personalizados (fase 2, 2B). */
export function CustomTemplatesPage() {
  const { orgId, path, readOnly } = useOrgContext();
  useDocumentTitle('Registros personalizados');
  const q = useCustomTemplates(orgId);
  const toast = useToast();
  const [editing, setEditing] = useState<CustomTemplate | 'new' | null>(null);
  const activate = useOrgMutation(orgId, (key: string) => api.post<{ template: CustomTemplate }>(`/api/orgs/${orgId}/custom-templates/suggestions`, { key }), [['custom-templates'], ['today']]);
  const toggle = useOrgMutation(orgId, (t: { id: string; active: boolean }) => api.patch(`/api/orgs/${orgId}/custom-templates/${t.id}`, { active: t.active }), [['custom-templates'], ['today']]);

  return (
    <>
      <Link to={path('ajustes')} className="mb-3 inline-flex min-h-11 items-center gap-1 font-semibold text-ink-muted hover:text-ink lg:hidden">
        <Icon name="chevronLeft" size={20} /> Ajustes
      </Link>
      <PageHeader
        title="Registros personalizados"
        subtitle="Controles propios de tu local o de tu comunidad autónoma: listas de comprobación, valores con número o preguntas de sí/no. Salen en Hoy, en la tablet, en el historial y en el PDF."
        actions={
          <Button icon="plus" onClick={() => setEditing('new')} disabled={readOnly}>
            Nuevo registro
          </Button>
        }
      />
      {q.isPending ? (
        <LoadingBlock rows={4} />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : (
        <div className="grid gap-6 xl:grid-cols-[1.2fr_1fr]">
          <section aria-labelledby="mis-registros">
            <SectionTitle id="mis-registros">Tus registros</SectionTitle>
            {q.data.items.length === 0 ? (
              <Callout tone="info" title="Aún no tienes registros personalizados">
                Crea uno o activa uno de los sugeridos.
              </Callout>
            ) : (
              <ul className="space-y-2" data-testid="custom-templates">
                {q.data.items.map((t) => (
                  <li key={t.id} className="flex flex-wrap items-center gap-3 rounded-2xl border border-line bg-surface p-4 shadow-card">
                    <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-surface-2 text-ink-muted">
                      <Icon name="clipboard" size={22} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block font-bold [overflow-wrap:anywhere]">{t.name}</span>
                      <span className="block text-sm text-ink-muted">
                        {CUSTOM_KIND_LABELS[t.kind]} · {kindDetail(t)} · {customFrequencyText(t)}
                      </span>
                      {!t.active ? (
                        <Badge tone="neutral" className="mt-1">
                          Desactivado: sus registros se conservan
                        </Badge>
                      ) : null}
                    </span>
                    <span className="flex gap-2">
                      <Button size="md" variant="secondary" icon="pencil" onClick={() => setEditing(t)} disabled={readOnly}>
                        Editar
                      </Button>
                      <Button
                        size="md"
                        variant="ghost"
                        disabled={readOnly}
                        onClick={() =>
                          void toggle
                            .mutateAsync({ id: t.id, active: !t.active })
                            .then(() => toast.show(t.active ? `«${t.name}» desactivado (sus registros se conservan)` : `«${t.name}» activado`))
                            .catch((err: unknown) => toast.show(errorMessage(err), 'bad'))
                        }
                      >
                        {t.active ? 'Desactivar' : 'Activar'}
                      </Button>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section aria-labelledby="sugeridos">
            <SectionTitle id="sugeridos">Sugeridos</SectionTitle>
            <p className="-mt-2 mb-3 text-sm text-ink-muted">Se activan con un toque y luego puedes adaptarlos. Los valores son orientativos; cada uno indica su fuente.</p>
            <ul className="space-y-2">
              {q.data.suggestions.map((s) => (
                <SuggestionCard
                  key={s.key}
                  s={s}
                  busy={activate.isPending && activate.variables === s.key}
                  disabled={readOnly}
                  onActivate={() =>
                    void activate
                      .mutateAsync(s.key)
                      .then(() => toast.show(`«${s.name}» activado`))
                      .catch((err: unknown) => toast.show(errorMessage(err), 'bad'))
                  }
                />
              ))}
            </ul>
          </section>
        </div>
      )}
      {editing ? <TemplateDialog template={editing === 'new' ? null : editing} onClose={() => setEditing(null)} /> : null}
    </>
  );
}

function SuggestionCard({ s, onActivate, busy, disabled }: { s: TemplateSuggestion; onActivate: () => void; busy: boolean; disabled: boolean }) {
  return (
    <li className="rounded-2xl border border-line bg-surface p-4" data-testid={`suggestion-${s.key}`}>
      <div className="flex flex-wrap items-start gap-3">
        <span className="min-w-0 flex-1">
          <span className="block font-bold">{s.name}</span>
          <span className="block text-sm text-ink-muted">
            {CUSTOM_KIND_LABELS[s.kind]} · {customFrequencyText({ frequency: s.frequency, timesPerDay: s.timesPerDay ?? 1, weekday: s.weekday ?? null, monthDay: s.monthDay ?? null })}
          </span>
          <span className="mt-1 block text-sm">{s.when}</span>
        </span>
        {s.activated ? (
          <Badge tone="ok" icon="check">
            Activado
          </Badge>
        ) : (
          <Button size="md" icon="plus" loading={busy} disabled={disabled} onClick={onActivate}>
            Activar
          </Button>
        )}
      </div>
      <details className="mt-2 text-sm text-ink-muted">
        <summary className="min-h-10 cursor-pointer font-semibold">Fuente</summary>
        <p className="mt-1">{s.source}</p>
      </details>
    </li>
  );
}

type Draft = {
  name: string;
  kind: CustomKind | null;
  items: { id?: string; label: string }[];
  unit: string;
  min: string;
  max: string;
  frequency: CustomFrequency;
  timesPerDay: number;
  weekday: number;
  monthDay: number;
  instructions: string;
  active: boolean;
};

function TemplateDialog({ template, onClose }: { template: CustomTemplate | null; onClose: () => void }) {
  const { orgId } = useOrgContext();
  const toast = useToast();
  const [d, setD] = useState<Draft>(() => ({
    name: template?.name ?? '',
    kind: template?.kind ?? null,
    items: template?.items.map((i) => ({ id: i.id, label: i.label })) ?? [{ label: '' }],
    unit: template?.unit ?? '',
    min: template?.min != null ? formatDecimal(template.min) : '',
    max: template?.max != null ? formatDecimal(template.max) : '',
    frequency: template?.frequency ?? 'daily',
    timesPerDay: template?.timesPerDay ?? 1,
    weekday: template?.weekday ?? 1,
    monthDay: template?.monthDay ?? 1,
    instructions: template?.instructions ?? '',
    active: template?.active ?? true,
  }));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [general, setGeneral] = useState<string | null>(null);
  const save = useOrgMutation(
    orgId,
    (body: Record<string, unknown>) => (template ? api.patch(`/api/orgs/${orgId}/custom-templates/${template.id}`, body) : api.post(`/api/orgs/${orgId}/custom-templates`, body)),
    [['custom-templates'], ['today']],
  );
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => ({ ...x, [k]: v }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setGeneral(null);
    const errs: Record<string, string> = {};
    const min = d.min.trim() ? parseDecimal(d.min) : null;
    const max = d.max.trim() ? parseDecimal(d.max) : null;
    if (d.min.trim() && min == null) errs.min = 'Escribe el mínimo con números';
    if (d.max.trim() && max == null) errs.max = 'Escribe el máximo con números';
    const body = {
      name: d.name.trim(),
      kind: d.kind ?? undefined,
      items: d.kind === 'checklist' ? d.items.map((i) => ({ ...(i.id ? { id: i.id } : {}), label: i.label.trim() })).filter((i) => i.label) : [],
      unit: d.kind === 'numeric' ? d.unit.trim() || null : null,
      min: d.kind === 'numeric' ? min : null,
      max: d.kind === 'numeric' ? max : null,
      frequency: d.frequency,
      timesPerDay: d.frequency === 'daily' ? d.timesPerDay : 1,
      weekday: d.frequency === 'weekly' ? d.weekday : null,
      monthDay: d.frequency === 'monthly' ? d.monthDay : null,
      instructions: d.instructions.trim() || null,
      active: d.active,
    };
    const r = createCustomTemplateBody.safeParse(body);
    const all = { ...(r.success ? {} : zodToFieldErrors(r.error.issues)), ...errs };
    if (!d.kind) all.kind = 'Elige el tipo de registro';
    setErrors(all);
    if (Object.keys(all).length) return;
    try {
      // El tipo no se cambia una vez creado (los registros hechos lo usan).
      const { kind: _k, ...patch } = body;
      await save.mutateAsync(template ? patch : body);
      toast.show(template ? 'Registro personalizado guardado' : 'Registro personalizado creado');
      onClose();
    } catch (err) {
      if (isApiError(err) && err.details.length) setErrors(detailsToFieldErrors(err.details));
      setGeneral(errorMessage(err));
    }
  };

  return (
    <Dialog
      open
      onClose={onClose}
      size="lg"
      title={template ? `Editar «${template.name}»` : 'Nuevo registro personalizado'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" form="tpl-form" icon="check" loading={save.isPending}>
            Guardar
          </Button>
        </>
      }
    >
      <WriteGuard>
        <form id="tpl-form" onSubmit={(e) => void submit(e)} noValidate className="space-y-4">
          <Field label="Nombre" error={errors.name}>
            <Input value={d.name} onChange={(e) => set('name', e.target.value)} maxLength={120} placeholder="Ej.: Control de cloro, Revisión de apertura" />
          </Field>
          {template ? (
            <p className="text-sm text-ink-muted">Tipo: {CUSTOM_KIND_LABELS[template.kind]} (no se puede cambiar: los registros ya hechos lo usan).</p>
          ) : (
            <ChoiceGroup
              legend="Tipo"
              value={d.kind}
              onChange={(v) => set('kind', v)}
              error={errors.kind}
              columns={3}
              options={[
                { value: 'checklist', label: CUSTOM_KIND_LABELS.checklist, description: 'Varios puntos: correcto o no' },
                { value: 'numeric', label: CUSTOM_KIND_LABELS.numeric, description: 'Un valor con unidad y rango' },
                { value: 'yesno', label: CUSTOM_KIND_LABELS.yesno, description: '«Sí» es lo correcto' },
              ]}
            />
          )}
          {d.kind === 'checklist' ? (
            <fieldset className="space-y-2">
              <legend className="mb-1 font-semibold">Puntos a comprobar</legend>
              {d.items.map((it, i) => (
                <div key={it.id ?? `n${i}`} className="flex gap-2">
                  <Input aria-label={`Punto ${i + 1}`} value={it.label} onChange={(e) => set('items', d.items.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} maxLength={200} />
                  <Button variant="ghost" icon="trash" aria-label={`Quitar el punto ${i + 1}`} onClick={() => set('items', d.items.filter((_, j) => j !== i))} disabled={d.items.length === 1} />
                </div>
              ))}
              {errors.items ? (
                <p role="alert" className="text-sm font-semibold text-bad">
                  {errors.items}
                </p>
              ) : null}
              <Button variant="secondary" size="md" icon="plus" onClick={() => set('items', [...d.items, { label: '' }])} disabled={d.items.length >= 50}>
                Añadir punto
              </Button>
            </fieldset>
          ) : null}
          {d.kind === 'numeric' ? (
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Unidad" optional error={errors.unit}>
                <Input value={d.unit} onChange={(e) => set('unit', e.target.value)} maxLength={20} placeholder="mg/l, °C, %…" />
              </Field>
              <Field label="Mínimo" optional error={errors.min}>
                <Input value={d.min} onChange={(e) => set('min', e.target.value.replace('.', ','))} inputMode="decimal" maxLength={12} />
              </Field>
              <Field label="Máximo" optional error={errors.max}>
                <Input value={d.max} onChange={(e) => set('max', e.target.value.replace('.', ','))} inputMode="decimal" maxLength={12} />
              </Field>
            </div>
          ) : null}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Frecuencia" error={errors.frequency}>
              <Select value={d.frequency} onChange={(e) => set('frequency', e.target.value as CustomFrequency)}>
                {(Object.keys(CUSTOM_FREQUENCY_LABELS) as CustomFrequency[]).map((f) => (
                  <option key={f} value={f}>
                    {CUSTOM_FREQUENCY_LABELS[f]}
                  </option>
                ))}
              </Select>
            </Field>
            {d.frequency === 'daily' ? (
              <Field label="Veces al día" error={errors.timesPerDay}>
                <Select value={d.timesPerDay} onChange={(e) => set('timesPerDay', Number(e.target.value))}>
                  {Array.from({ length: 12 }, (_, i) => i + 1).map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </Select>
              </Field>
            ) : d.frequency === 'weekly' ? (
              <Field label="Día de la semana" error={errors.weekday}>
                <Select value={d.weekday} onChange={(e) => set('weekday', Number(e.target.value))}>
                  {WEEKDAYS.map((w, i) => (
                    <option key={w} value={i + 1}>
                      {w}
                    </option>
                  ))}
                </Select>
              </Field>
            ) : d.frequency === 'monthly' ? (
              <Field label="Día del mes" error={errors.monthDay}>
                <Select value={d.monthDay} onChange={(e) => set('monthDay', Number(e.target.value))}>
                  {Array.from({ length: 28 }, (_, i) => i + 1).map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </Select>
              </Field>
            ) : (
              <p className="self-end pb-3 text-sm text-ink-muted">Se registra cuando hace falta; no cuenta en el cumplimiento.</p>
            )}
          </div>
          <Field label="Instrucciones" optional hint="Se muestran al registrarlo (en la web y en la tablet).">
            <Textarea value={d.instructions} onChange={(e) => set('instructions', e.target.value)} maxLength={1000} rows={2} />
          </Field>
          {template ? <Switch checked={d.active} onChange={(v) => set('active', v)} label="Activo" description="Si lo desactivas, deja de pedirse y sus registros se conservan." /> : null}
          {general ? (
            <Callout tone="bad" live="assertive">
              {general}
            </Callout>
          ) : null}
        </form>
      </WriteGuard>
    </Dialog>
  );
}
