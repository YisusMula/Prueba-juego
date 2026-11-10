import { useMemo, useState, type FormEvent, type ReactNode } from 'react';
import {
  POLAR_COMPOUNDS_LIMIT,
  RECEPTION_MAX_TEMP_PRESETS,
  RECEPTION_TEMP_MAX,
  RECEPTION_TEMP_MESSAGE,
  RECEPTION_TEMP_MIN,
  TEMP_MAX,
  TEMP_MIN,
  TEMP_RANGE_MESSAGE,
  receptionOverTemperature,
  aceiteData,
  formacionData,
  incidenciaData,
  limpiezaData,
  plagasData,
  recepcionData,
  temperaturaData,
  EQUIPMENT_TYPE_LABELS,
} from '@shared/schemas';
import type { z } from 'zod';
import type { CleaningItem, Frequency, RecordDataMap, RecordType, EquipmentType } from '@/api/types';
import { ApiError, errorMessage } from '@/api/client';
import { Button } from '@/components/ui/Button';
import { Callout } from '@/components/ui/Feedback';
import { Checkbox, ChoiceGroup, Field, Input, Select, Textarea, detailsToFieldErrors, useField, zodToFieldErrors } from '@/components/ui/Form';
import { ConfirmDialog } from '@/components/ui/Overlay';
import { Icon } from '@/components/icons/Icon';
import { cn } from '@/lib/cn';
import { formatLocalDate, formatRange, formatTemp, frequencyLabel, isOutOfRange, localDateIn, parseDecimal } from '@/lib/format';

/** Datos de configuración que necesitan los formularios (compatibles con web y kiosko). */
export type FormContext = {
  equipment: { id: string; name: string; type: EquipmentType; minTemp: number | null; maxTemp: number | null; active?: boolean }[];
  cleaningPlans: { id: string; name: string; frequency: Frequency; weekday: number | null; monthDay: number | null; items: CleaningItem[]; active?: boolean }[];
  suppliers: { id: string; name: string; products: string[] }[];
  staff: { id: string; name: string; active?: boolean }[];
  timezone: string;
};

type Props<T extends RecordType> = {
  ctx: FormContext;
  /** Datos almacenados de un registro existente (para corregirlo con una enmienda). */
  initial?: RecordDataMap[T];
  onSubmit: (data: unknown) => void;
  submitting?: boolean;
  serverError?: unknown;
  submitLabel?: string;
  /** Tamaño táctil grande (modo cocina). */
  large?: boolean;
  /** Contenido extra antes del botón (p. ej. motivo de la enmienda o firmante). */
  footer?: ReactNode;
  /** Preselección (p. ej. equipo desde "Hoy"). */
  preset?: Record<string, string>;
  /** Reintentar el último envío (tras un error de red o de tiempo agotado). */
  onRetry?: () => void;
};

/** Temperatura dentro del rango físico admitido (el del esquema): fuera de él no tiene sentido evaluar si está «en rango». */
export const physicallyValidTemp = (n: number | null, min = TEMP_MIN, max = TEMP_MAX) => n != null && n >= min && n <= max;
const ORDER: Record<Frequency, number> = { daily: 0, weekly: 1, monthly: 2 };

export const TEMP_ACTIONS = [
  'Regulado el termostato',
  'Puerta cerrada y revisada',
  'Producto trasladado a otra cámara',
  'Producto desechado',
  'Avisado el servicio técnico',
  'Repetiré la medición en 30 min',
];
export const OIL_ACTIONS = ['Aceite cambiado', 'Aceite filtrado', 'Freidora parada hasta el cambio'];

const numText = (n: number | null | undefined) => (n == null ? '' : String(n).replace('.', ',').replace('-', '−'));
const fieldErrorsFrom = (e: unknown) => (e instanceof ApiError ? detailsToFieldErrors(e.details, 'data.') : {});
const generalError = (e: unknown) =>
  e instanceof ApiError && (e.code !== 'VALIDATION_ERROR' || e.details.length === 0) ? errorMessage(e) : null;
const retryable = (e: unknown) => e instanceof ApiError && e.retryable;

function useValidated<S extends z.ZodType>(schema: S, onSubmit: (d: unknown) => void) {
  const [errors, setErrors] = useState<Record<string, string>>({});
  const submit = (input: unknown, extra?: Record<string, string>) => {
    const res = schema.safeParse(input);
    const errs = { ...(res.success ? {} : zodToFieldErrors(res.error.issues)), ...extra };
    setErrors(errs);
    if (!res.success || Object.keys(errs).length > 0) {
      requestAnimationFrame(() => document.querySelector<HTMLElement>('[aria-invalid="true"], fieldset [role="alert"]')?.focus());
      return;
    }
    onSubmit(res.data);
  };
  return { errors, submit };
}

function FormShell({ onSubmit, children, footer, submitting, submitLabel, large, serverError, danger, onRetry, disabled }: {
  onSubmit: (e: FormEvent) => void;
  children: ReactNode;
  footer?: ReactNode;
  submitting?: boolean;
  submitLabel?: string;
  large?: boolean;
  serverError?: unknown;
  danger?: boolean;
  onRetry?: () => void;
  disabled?: boolean;
}) {
  const general = generalError(serverError);
  return (
    <form onSubmit={onSubmit} noValidate className={cn('space-y-5', large && 'text-lg')}>
      {children}
      {footer}
      {general ? (
        <Callout
          tone="bad"
          live="assertive"
          action={
            onRetry && retryable(serverError) ? (
              <Button variant="secondary" icon="refresh" onClick={onRetry} loading={submitting}>
                Reintentar
              </Button>
            ) : undefined
          }
        >
          {general}
        </Callout>
      ) : null}
      <Button type="submit" size={large ? 'xl' : 'lg'} block loading={submitting} disabled={disabled} variant={danger ? 'danger' : 'primary'} icon="check">
        {submitLabel ?? 'Guardar registro'}
      </Button>
    </form>
  );
}

/** Sugerencias rápidas de acción correctora (un toque) + texto libre. */
export function CorrectiveAction({
  value,
  onChange,
  suggestions,
  error,
  label = '¿Qué has hecho para corregirlo?',
  large,
}: {
  value: string;
  onChange: (v: string) => void;
  suggestions: string[];
  error?: string;
  label?: string;
  large?: boolean;
}) {
  return (
    <div className="space-y-2 rounded-2xl border-2 border-bad/40 bg-bad-soft/60 p-4">
      <Field label={label} error={error} hint="Toca una opción o escríbela tú.">
        <Suggestions value={value} onChange={onChange} suggestions={suggestions} large={large} />
        <Textarea value={value} onChange={(e) => onChange(e.target.value)} maxLength={1000} rows={2} placeholder="Describe la acción tomada" />
      </Field>
    </div>
  );
}

function Suggestions({ value, onChange, suggestions, large }: { value: string; onChange: (v: string) => void; suggestions: string[]; large?: boolean }) {
  const field = useField();
  return (
        <div className="flex flex-wrap gap-2 pb-1">
          {suggestions.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => {
                onChange(s);
                field?.onEdit?.();
              }}
              aria-pressed={value === s}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full border-2 px-4 font-semibold transition-colors',
                large ? 'min-h-14 text-lg' : 'min-h-11',
                value === s ? 'border-ink bg-ink text-paper' : 'border-line-strong bg-surface hover:border-ink',
              )}
            >
              {value === s ? <Icon name="check" size={16} strokeWidth={3} /> : null}
              {s}
            </button>
          ))}
        </div>
  );
}

// ---------------------------------------------------------------------------
// Temperatura
// ---------------------------------------------------------------------------
export function TemperaturaForm(p: Props<'temperatura'>) {
  const options = p.ctx.equipment.filter((e) => e.active !== false && e.type !== 'freidora');
  const [equipmentId, setEquipmentId] = useState(p.initial?.equipmentId ?? p.preset?.equipmentId ?? (options.length === 1 ? options[0]!.id : ''));
  const [value, setValue] = useState(numText(p.initial?.value));
  const [action, setAction] = useState(p.initial?.correctiveAction ?? '');
  const { errors, submit } = useValidated(temperaturaData, p.onSubmit);
  const server = fieldErrorsFrom(p.serverError);
  const eq = options.find((e) => e.id === equipmentId);
  const num = parseDecimal(value);
  // Validación en el momento del rango físico admitido: 999 o −99 no son temperaturas válidas.
  const valid = physicallyValidTemp(num);
  const liveError = value.trim() === '' ? null : num == null ? 'Escribe la temperatura con números (por ejemplo 3,5 o −18)' : !valid ? TEMP_RANGE_MESSAGE : null;
  const out = eq && valid ? isOutOfRange(num!, eq.minTemp, eq.maxTemp) : false;

  if (options.length === 0) {
    return <Callout tone="warn" title="No hay equipos de frío o calor activos">Añádelos en Ajustes → Equipos para registrar temperaturas.</Callout>;
  }

  return (
    <FormShell
      {...p}
      danger={out}
      disabled={!!liveError}
      submitLabel={p.submitLabel ?? (out ? 'Guardar con acción correctora' : 'Guardar temperatura')}
      onSubmit={(e) => {
        e.preventDefault();
        if (liveError) return;
        const extra: Record<string, string> = {};
        if (num == null) extra.value = 'Escribe la temperatura (por ejemplo 3,5 o −18)';
        if (out && !action.trim()) extra.correctiveAction = 'Fuera de rango: indica qué has hecho';
        submit({ equipmentId, value: num ?? Number.NaN, correctiveAction: action.trim() || null }, extra);
      }}
    >
      <fieldset>
        <legend className="mb-1.5 font-semibold">Equipo</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {options.map((e) => (
            <label
              key={e.id}
              className={cn(
                'flex min-h-16 cursor-pointer items-center gap-3 rounded-xl border-2 px-4 py-2 has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-focus',
                equipmentId === e.id ? 'border-brand bg-brand-soft' : 'border-line bg-surface hover:border-line-strong',
              )}
            >
              <input type="radio" name="equipment" className="sr-only" checked={equipmentId === e.id} onChange={() => setEquipmentId(e.id)} />
              <Icon name="thermometer" size={24} className="shrink-0 text-brand" />
              <span className="min-w-0">
                <span className="block font-semibold">{e.name}</span>
                <span className="block text-sm text-ink-muted">
                  {EQUIPMENT_TYPE_LABELS[e.type]} · {formatRange(e.minTemp, e.maxTemp)}
                </span>
              </span>
            </label>
          ))}
        </div>
        {(errors.equipmentId || server.equipmentId) && !equipmentId ? <p className="mt-1.5 text-sm font-semibold text-bad" role="alert">Elige un equipo</p> : null}
      </fieldset>

      <Field label="Temperatura (°C)" error={liveError || errors.value || server.value} hint={eq ? `Rango correcto: ${formatRange(eq.minTemp, eq.maxTemp)}` : undefined}>
        <div className="relative max-w-60">
          <Input
            inputMode="decimal"
            autoComplete="off"
            value={value}
            onChange={(e) => setValue(e.target.value.replace('.', ',').replace('-', '−'))}
            placeholder="Ej.: 3,5"
            maxLength={7}
            className={cn('pr-14 font-display text-3xl font-bold tabular', large(p) && 'min-h-16')}
            name="value"
          />
          <span className="pointer-events-none absolute top-1/2 right-4 -translate-y-1/2 text-lg text-ink-muted">°C</span>
        </div>
      </Field>

      {eq && valid ? (
        out ? (
          <Callout tone="bad" title={`${formatTemp(num!)} está fuera de rango`} live="polite">
            El rango para {eq.name} es {formatRange(eq.minTemp, eq.maxTemp)}. Anota qué has hecho.
          </Callout>
        ) : (
          <Callout tone="ok" title={`${formatTemp(num!)}: dentro de rango`} live="polite" />
        )
      ) : null}

      {/* La acción correctora solo se pide si el valor (también el corregido) está fuera de rango. */}
      {out ? (
        <CorrectiveAction value={action} onChange={setAction} suggestions={TEMP_ACTIONS} error={errors.correctiveAction || server.correctiveAction} large={p.large} />
      ) : null}
    </FormShell>
  );
}

const large = (p: { large?: boolean }) => !!p.large;

// ---------------------------------------------------------------------------
// Limpieza
// ---------------------------------------------------------------------------
export function LimpiezaForm(p: Props<'limpieza'>) {
  // Orden lógico (diaria, semanal, mensual) y opciones a lo ancho: nada se corta.
  const plans = p.ctx.cleaningPlans
    .filter((x) => x.active !== false)
    .sort((a, b) => ORDER[a.frequency] - ORDER[b.frequency] || a.name.localeCompare(b.name, 'es'));
  const [planId, setPlanId] = useState(p.initial?.cleaningPlanId ?? p.preset?.cleaningPlanId ?? (plans.length === 1 ? plans[0]!.id : ''));
  const plan = plans.find((x) => x.id === planId);
  const initialDone = useMemo(() => new Set(p.initial?.items.filter((i) => i.done).map((i) => i.itemId) ?? []), [p.initial]);
  const [done, setDone] = useState<Set<string>>(initialDone);
  const [obs, setObs] = useState(p.initial?.observations ?? '');
  const [confirm, setConfirm] = useState<unknown>(null);
  const { errors, submit } = useValidated(limpiezaData, (d) => {
    // Si no están todas las zonas, se pide confirmación antes de guardar una limpieza parcial.
    if (plan && done.size < plan.items.length) setConfirm(d);
    else p.onSubmit(d);
  });
  const server = fieldErrorsFrom(p.serverError);

  if (plans.length === 0) return <Callout tone="warn" title="No hay planes de limpieza activos">Créalos en Ajustes → Limpieza.</Callout>;

  const toggle = (id: string, v: boolean) =>
    setDone((s) => {
      const n = new Set(s);
      if (v) n.add(id);
      else n.delete(id);
      return n;
    });
  const missing = plan ? plan.items.length - done.size : 0;
  const itemsError = errors.items || server.items;

  return (
    <>
      <FormShell
        {...p}
        onSubmit={(e) => {
          e.preventDefault();
          if (!plan) return submit({ cleaningPlanId: '', items: [] });
          submit({ cleaningPlanId: plan.id, items: plan.items.map((i) => ({ itemId: i.id, done: done.has(i.id) })), observations: obs.trim() || null });
        }}
      >
        <ChoiceGroup
          legend="Plan de limpieza"
          value={planId || null}
          onChange={(v) => {
            setPlanId(v);
            setDone(new Set());
          }}
          error={errors.cleaningPlanId || server.cleaningPlanId ? 'Elige un plan' : null}
          columns={2}
          size={p.large ? 'xl' : 'md'}
          options={plans.map((x) => ({ value: x.id, label: x.name, description: frequencyLabel(x.frequency, x.weekday, x.monthDay) }))}
        />
        {plan ? (
          <fieldset className="rounded-2xl border border-line bg-surface p-3" aria-describedby={itemsError && done.size === 0 ? 'zonas-err' : undefined}>
            <div className="flex flex-wrap items-center justify-between gap-2 px-1 pb-2">
              <legend className="font-semibold">
                Zonas limpiadas ({done.size} de {plan.items.length})
              </legend>
              <Button size="sm" variant="quiet" onClick={() => setDone(done.size === plan.items.length ? new Set() : new Set(plan.items.map((i) => i.id)))}>
                {done.size === plan.items.length ? 'Desmarcar todo' : 'Marcar todo'}
              </Button>
            </div>
            <div className="divide-y divide-line">
              {plan.items.map((i) => (
                <Checkbox
                  key={i.id}
                  checked={done.has(i.id)}
                  onChange={(v) => toggle(i.id, v)}
                  label={<span className="font-semibold">{i.area}</span>}
                  description={[i.product, i.method].filter(Boolean).join(' · ') || undefined}
                />
              ))}
            </div>
            {itemsError && done.size === 0 ? (
              <p id="zonas-err" className="mt-1.5 text-sm font-semibold text-bad" role="alert">
                Marca al menos una zona hecha
              </p>
            ) : null}
          </fieldset>
        ) : null}
        {plan && done.size > 0 && missing > 0 ? (
          <Callout tone="warn">
            Se guardará como <strong>parcial ({done.size} de {plan.items.length})</strong> y la tarea seguirá pendiente. Si no se pueden hacer, explica el motivo en
            observaciones.
          </Callout>
        ) : null}
        <Field label="Observaciones" optional error={errors.observations}>
          <Textarea value={obs} onChange={(e) => setObs(e.target.value)} maxLength={1000} rows={2} />
        </Field>
      </FormShell>
      <ConfirmDialog
        open={confirm != null}
        onClose={() => setConfirm(null)}
        onConfirm={() => {
          const d = confirm;
          setConfirm(null);
          p.onSubmit(d);
        }}
        tone="primary"
        title={missing === 1 ? 'Queda 1 zona sin hacer' : `Quedan ${missing} zonas sin hacer`}
        confirmLabel="Guardar como parcial"
      >
        La limpieza se guardará como parcial ({done.size} de {plan?.items.length ?? 0}) y no contará como hecha hasta que se complete.
      </ConfirmDialog>
    </>
  );
}

// ---------------------------------------------------------------------------
// Recepción de mercancía
// ---------------------------------------------------------------------------
export function RecepcionForm(p: Props<'recepcion'>) {
  const i = p.initial;
  const today = localDateIn(p.ctx.timezone);
  const [supplierId, setSupplierId] = useState(i?.supplierId ?? (i ? '__other' : ''));
  const [supplierName, setSupplierName] = useState(i && !i.supplierId ? i.supplierName : '');
  const [product, setProduct] = useState(i?.product ?? '');
  const [lot, setLot] = useState(i?.lot ?? '');
  const [temperature, setTemperature] = useState(numText(i?.temperature));
  const [maxTemp, setMaxTemp] = useState(numText(i?.maxTemperature));
  const [expiry, setExpiry] = useState(i?.expiryDate ?? '');
  const [accepted, setAccepted] = useState<'si' | 'no' | null>(i ? (i.accepted ? 'si' : 'no') : null);
  const [reason, setReason] = useState(i?.rejectionReason ?? '');
  const [corrective, setCorrective] = useState(i?.correctiveAction ?? '');
  const { errors, submit } = useValidated(recepcionData, p.onSubmit);
  const server = fieldErrorsFrom(p.serverError);
  const supplier = p.ctx.suppliers.find((s) => s.id === supplierId);
  const listId = 'products-list';

  const t = temperature.trim() ? parseDecimal(temperature) : null;
  const mt = maxTemp.trim() ? parseDecimal(maxTemp) : null;
  const tError = temperature.trim() && (t == null || !physicallyValidTemp(t, RECEPTION_TEMP_MIN, RECEPTION_TEMP_MAX)) ? RECEPTION_TEMP_MESSAGE : null;
  const mtError = maxTemp.trim() && (mt == null || !physicallyValidTemp(mt, RECEPTION_TEMP_MIN, RECEPTION_TEMP_MAX)) ? RECEPTION_TEMP_MESSAGE : null;
  const overTemp = !tError && !mtError && receptionOverTemperature({ temperature: t, maxTemperature: mt });
  const expired = !!expiry && expiry < today;
  const issue = overTemp || expired;
  const needsReason = accepted === 'si' && issue;

  return (
    <FormShell
      {...p}
      danger={accepted === 'no' || needsReason}
      disabled={!!tError || !!mtError}
      onSubmit={(e) => {
        e.preventDefault();
        if (tError || mtError) return;
        const extra: Record<string, string> = {};
        if (accepted == null) extra.accepted = expired ? 'La mercancía está caducada: decide si la rechazas o la aceptas con un motivo' : 'Indica si aceptas o rechazas la mercancía';
        if (needsReason && !corrective.trim()) {
          extra.correctiveAction = expired ? 'Está caducada: indica por qué la aceptas o recházala' : 'Supera la temperatura máxima: indica qué has hecho o por qué la aceptas';
        }
        submit(
          {
            supplierId: supplier ? supplier.id : null,
            supplierName: supplier ? null : supplierName.trim() || null,
            product: product.trim(),
            lot: lot.trim() || null,
            temperature: t,
            maxTemperature: mt,
            expiryDate: expiry || null,
            accepted: accepted === 'si',
            rejectionReason: reason.trim() || null,
            correctiveAction: accepted === 'si' ? corrective.trim() || null : null,
          },
          extra,
        );
      }}
    >
      <Field label="Proveedor" error={errors.supplierName || server.supplierId || server.supplierName}>
        <Select value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
          <option value="">Elige un proveedor…</option>
          {p.ctx.suppliers.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
          <option value="__other">Otro (escribir nombre)</option>
        </Select>
      </Field>
      {supplierId === '__other' ? (
        <Field label="Nombre del proveedor" error={errors.supplierName}>
          <Input value={supplierName} onChange={(e) => setSupplierName(e.target.value)} maxLength={150} />
        </Field>
      ) : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Producto" error={errors.product || server.product}>
          <Input value={product} onChange={(e) => setProduct(e.target.value)} maxLength={200} list={supplier?.products.length ? listId : undefined} />
          {supplier?.products.length ? (
            <datalist id={listId}>
              {supplier.products.map((x) => (
                <option key={x} value={x} />
              ))}
            </datalist>
          ) : null}
        </Field>
        <Field label="Lote" optional error={errors.lot}>
          <Input value={lot} onChange={(e) => setLot(e.target.value)} maxLength={100} />
        </Field>
        <Field label="Temperatura al recibir (°C)" optional error={tError || errors.temperature || server.temperature}>
          <Input inputMode="decimal" value={temperature} onChange={(e) => setTemperature(e.target.value.replace('.', ',').replace('-', '−'))} placeholder="Ej.: 2,5" maxLength={7} />
        </Field>
        <Field label="Fecha de caducidad" optional error={errors.expiryDate || server.expiryDate}>
          <Input type="date" value={expiry} onChange={(e) => setExpiry(e.target.value)} />
        </Field>
      </div>
      <Field
        label="Temperatura máxima admisible (°C)"
        optional
        hint="Para avisar si el producto llega demasiado caliente. Valores orientativos."
        error={mtError || errors.maxTemperature || server.maxTemperature}
      >
        <div className="flex flex-wrap items-center gap-2">
          <Input inputMode="decimal" value={maxTemp} onChange={(e) => setMaxTemp(e.target.value.replace('.', ',').replace('-', '−'))} placeholder="—" className="max-w-32" maxLength={7} />
          {RECEPTION_MAX_TEMP_PRESETS.map((pr) => (
            <button
              key={pr.label}
              type="button"
              aria-pressed={mt === pr.value}
              onClick={() => setMaxTemp(numText(pr.value))}
              className={cn('min-h-11 rounded-full border-2 px-4 font-semibold', mt === pr.value ? 'border-ink bg-ink text-paper' : 'border-line-strong bg-surface hover:border-ink')}
            >
              {pr.label} ({formatTemp(pr.value)})
            </button>
          ))}
        </div>
      </Field>
      {overTemp ? (
        <Callout tone="bad" title={`${formatTemp(t!)} supera la máxima admisible (${formatTemp(mt!)})`} live="polite">
          Lo normal es rechazarla. Si la aceptas, quedará como alerta y tendrás que indicar qué has hecho.
        </Callout>
      ) : null}
      {expired ? (
        <Callout tone="bad" title="La fecha de caducidad ya ha pasado" live="polite">
          Caducó el {formatLocalDate(expiry)}. Recházala o, si la aceptas, indica el motivo: quedará registrada como alerta.
        </Callout>
      ) : null}
      <ChoiceGroup
        legend="¿Aceptas la mercancía?"
        value={accepted}
        onChange={setAccepted}
        error={errors.accepted}
        size={p.large ? 'xl' : 'md'}
        options={[
          { value: 'si', label: issue ? 'Sí, aceptarla con motivo' : 'Sí, aceptada', tone: issue ? 'warn' : 'ok' },
          { value: 'no', label: 'No, rechazada', tone: 'bad' },
        ]}
      />
      {accepted === 'no' ? (
        <Field label="Motivo del rechazo" error={errors.rejectionReason || server.rejectionReason}>
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} maxLength={1000} rows={2} placeholder="Ej.: llegó a 9 °C, envase roto, caducada…" />
        </Field>
      ) : null}
      {needsReason ? (
        <CorrectiveAction
          label={expired ? '¿Por qué la aceptas?' : '¿Qué has hecho?'}
          value={corrective}
          onChange={setCorrective}
          suggestions={expired ? ['Se devuelve al proveedor', 'Se desecha', 'Error en la etiqueta: confirmado con el proveedor'] : ['Se usa de inmediato', 'Pasada a cámara al momento', 'Avisado el proveedor']}
          error={errors.correctiveAction || server.correctiveAction}
          large={p.large}
        />
      ) : null}
    </FormShell>
  );
}

// ---------------------------------------------------------------------------
// Aceite de fritura
// ---------------------------------------------------------------------------
export function AceiteForm(p: Props<'aceite'>) {
  const fryers = p.ctx.equipment.filter((e) => e.active !== false && e.type === 'freidora');
  const [equipmentId, setEquipmentId] = useState(p.initial?.equipmentId ?? (fryers.length === 1 ? fryers[0]!.id : ''));
  const [action, setAction] = useState<'revisado' | 'cambiado' | null>(p.initial?.action ?? null);
  const [polar, setPolar] = useState(numText(p.initial?.polarCompounds));
  const [corrective, setCorrective] = useState(p.initial?.correctiveAction ?? '');
  const { errors, submit } = useValidated(aceiteData, p.onSubmit);
  const server = fieldErrorsFrom(p.serverError);
  const polarNum = polar.trim() ? parseDecimal(polar) : null;
  const over = polarNum != null && polarNum > POLAR_COMPOUNDS_LIMIT;

  if (fryers.length === 0) return <Callout tone="warn" title="No hay freidoras">Añade una freidora en Ajustes → Equipos para registrar el aceite.</Callout>;

  return (
    <FormShell
      {...p}
      danger={over}
      onSubmit={(e) => {
        e.preventDefault();
        const extra: Record<string, string> = {};
        if (polar.trim() && polarNum == null) extra.polarCompounds = 'Valor no válido';
        if (!action) extra.action = 'Indica si lo has revisado o cambiado';
        if (over && !corrective.trim()) extra.correctiveAction = `Por encima del ${POLAR_COMPOUNDS_LIMIT} %: indica qué has hecho`;
        submit({ equipmentId, action: action ?? undefined, polarCompounds: polarNum, correctiveAction: corrective.trim() || null }, extra);
      }}
    >
      <Field label="Freidora" error={errors.equipmentId ? 'Elige una freidora' : server.equipmentId}>
        <Select value={equipmentId} onChange={(e) => setEquipmentId(e.target.value)}>
          <option value="">Elige una freidora…</option>
          {fryers.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
            </option>
          ))}
        </Select>
      </Field>
      <ChoiceGroup
        legend="¿Qué has hecho?"
        value={action}
        onChange={setAction}
        error={errors.action}
        size={p.large ? 'xl' : 'md'}
        options={[
          { value: 'revisado', label: 'Revisado' },
          { value: 'cambiado', label: 'Cambiado' },
        ]}
      />
      <Field
        label="Compuestos polares (%)"
        optional
        hint={`Si lo mides con tester. Referencia orientativa: por encima del ${POLAR_COMPOUNDS_LIMIT} % hay que cambiarlo.`}
        error={errors.polarCompounds || server.polarCompounds}
      >
        <Input inputMode="decimal" value={polar} onChange={(e) => setPolar(e.target.value.replace('.', ','))} className="max-w-40" />
      </Field>
      {over ? <CorrectiveAction value={corrective} onChange={setCorrective} suggestions={OIL_ACTIONS} error={errors.correctiveAction || server.correctiveAction} large={p.large} /> : null}
    </FormShell>
  );
}

// ---------------------------------------------------------------------------
// Plagas
// ---------------------------------------------------------------------------
export function PlagasForm(p: Props<'plagas'>) {
  const [result, setResult] = useState<'sin_indicios' | 'con_indicios' | null>(p.initial?.result ?? null);
  const [description, setDescription] = useState(p.initial?.description ?? '');
  const [action, setAction] = useState(p.initial?.action ?? '');
  const { errors, submit } = useValidated(plagasData, p.onSubmit);
  const server = fieldErrorsFrom(p.serverError);
  return (
    <FormShell
      {...p}
      danger={result === 'con_indicios'}
      onSubmit={(e) => {
        e.preventDefault();
        submit({ result: result ?? undefined, description: description.trim() || null, action: action.trim() || null }, result ? {} : { result: 'Indica el resultado de la revisión' });
      }}
    >
      <ChoiceGroup
        legend="Resultado de la revisión"
        value={result}
        onChange={setResult}
        error={errors.result}
        size={p.large ? 'xl' : 'md'}
        options={[
          { value: 'sin_indicios', label: 'Sin indicios', tone: 'ok', description: 'Todo en orden' },
          { value: 'con_indicios', label: 'Con indicios', tone: 'bad', description: 'Excrementos, roeduras, insectos…' },
        ]}
      />
      <Field label={result === 'con_indicios' ? 'Qué has encontrado y dónde' : 'Observaciones'} optional={result !== 'con_indicios'} error={errors.description || server.description}>
        <Textarea value={description} onChange={(e) => setDescription(e.target.value)} maxLength={1000} rows={2} />
      </Field>
      {result === 'con_indicios' ? (
        <Field label="Acción tomada" error={errors.action || server.action} hint="Ej.: avisada la empresa de control de plagas, zona limpiada y desinfectada.">
          <Textarea value={action} onChange={(e) => setAction(e.target.value)} maxLength={1000} rows={2} />
        </Field>
      ) : null}
    </FormShell>
  );
}

// ---------------------------------------------------------------------------
// Incidencia
// ---------------------------------------------------------------------------
export function IncidenciaForm(p: Props<'incidencia'> & { forceClosed?: boolean }) {
  const [description, setDescription] = useState(p.initial?.description ?? '');
  const [corrective, setCorrective] = useState(p.initial?.correctiveAction ?? '');
  const [closed, setClosed] = useState<'abierta' | 'cerrada'>(p.forceClosed ? 'cerrada' : p.initial?.closed ? 'cerrada' : 'abierta');
  const { errors, submit } = useValidated(incidenciaData, p.onSubmit);
  const server = fieldErrorsFrom(p.serverError);
  return (
    <FormShell
      {...p}
      onSubmit={(e) => {
        e.preventDefault();
        submit({ description: description.trim(), correctiveAction: corrective.trim() || null, closed: closed === 'cerrada' });
      }}
    >
      <Field label="¿Qué ha pasado?" error={errors.description || server.description}>
        <Textarea value={description} onChange={(e) => setDescription(e.target.value)} maxLength={2000} rows={3} placeholder="Ej.: la cámara 2 ha amanecido a 9 °C" />
      </Field>
      <Field label="Acción correctora" optional error={errors.correctiveAction || server.correctiveAction}>
        <Textarea value={corrective} onChange={(e) => setCorrective(e.target.value)} maxLength={2000} rows={2} />
      </Field>
      <ChoiceGroup
        legend="Estado"
        value={closed}
        onChange={setClosed}
        size={p.large ? 'xl' : 'md'}
        options={[
          { value: 'abierta', label: 'Abierta', tone: 'warn', description: 'Aún hay que resolverla' },
          { value: 'cerrada', label: 'Cerrada', tone: 'ok', description: 'Resuelta' },
        ]}
      />
    </FormShell>
  );
}

// ---------------------------------------------------------------------------
// Formación
// ---------------------------------------------------------------------------
export function FormacionForm(p: Props<'formacion'>) {
  const staff = p.ctx.staff.filter((s) => s.active !== false);
  const [trainee, setTrainee] = useState(p.initial?.traineeStaffId ?? '');
  const [course, setCourse] = useState(p.initial?.course ?? '');
  const today = localDateIn(p.ctx.timezone);
  const [date, setDate] = useState(p.initial?.trainingDate ?? today);
  const [trainer, setTrainer] = useState(p.initial?.trainer ?? '');
  const [hours, setHours] = useState(numText(p.initial?.hours));
  const { errors, submit } = useValidated(formacionData, p.onSubmit);
  const server = fieldErrorsFrom(p.serverError);

  if (staff.length === 0) return <Callout tone="warn" title="No hay personal dado de alta">Añade a tu equipo en Ajustes → Personal.</Callout>;

  return (
    <FormShell
      {...p}
      onSubmit={(e) => {
        e.preventDefault();
        const h = hours.trim() ? parseDecimal(hours) : null;
        submit(
          { traineeStaffId: trainee, course: course.trim(), trainingDate: date, trainer: trainer.trim() || null, hours: h },
          hours.trim() && h == null ? { hours: 'Escribe las horas con números (por ejemplo 2 o 1,5)' } : date > today ? { trainingDate: 'La fecha de la formación no puede ser futura' } : {},
        );
      }}
    >
      <Field label="Persona formada" error={errors.traineeStaffId ? 'Elige a una persona' : server.traineeStaffId}>
        <Select value={trainee} onChange={(e) => setTrainee(e.target.value)}>
          <option value="">Elige…</option>
          {staff.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Curso o formación" error={errors.course || server.course}>
        <Input value={course} onChange={(e) => setCourse(e.target.value)} maxLength={300} placeholder="Ej.: Manipulador de alimentos, alérgenos…" />
      </Field>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Fecha" error={errors.trainingDate || server.trainingDate}>
          <Input type="date" value={date} max={today} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label="Formador o entidad" optional error={errors.trainer}>
          <Input value={trainer} onChange={(e) => setTrainer(e.target.value)} maxLength={200} />
        </Field>
        <Field label="Horas" optional error={errors.hours || server.hours}>
          <Input inputMode="decimal" value={hours} onChange={(e) => setHours(e.target.value.replace('.', ','))} maxLength={6} />
        </Field>
      </div>
    </FormShell>
  );
}

/** Selecciona el formulario según el tipo. */
export function RecordForm({ type, ...props }: { type: RecordType } & Props<RecordType> & { forceClosed?: boolean }) {
  switch (type) {
    case 'temperatura':
      return <TemperaturaForm {...(props as Props<'temperatura'>)} />;
    case 'limpieza':
      return <LimpiezaForm {...(props as Props<'limpieza'>)} />;
    case 'recepcion':
      return <RecepcionForm {...(props as Props<'recepcion'>)} />;
    case 'aceite':
      return <AceiteForm {...(props as Props<'aceite'>)} />;
    case 'plagas':
      return <PlagasForm {...(props as Props<'plagas'>)} />;
    case 'incidencia':
      return <IncidenciaForm {...(props as Props<'incidencia'>)} />;
    case 'formacion':
      return <FormacionForm {...(props as Props<'formacion'>)} />;
  }
}
