import { useMemo, useState, type FormEvent, type ReactNode } from 'react';
import {
  POLAR_COMPOUNDS_LIMIT,
  RECEPTION_CATEGORIES,
  RECEPTION_CATEGORY_LABELS,
  RECEPTION_CATEGORY_LIMITS,
  RECEPTION_TEMP_MAX,
  RECEPTION_TEMP_MESSAGE,
  RECEPTION_TEMP_MIN,
  TEMP_MAX,
  TEMP_MIN,
  TEMP_RANGE_MESSAGE,
  receptionLimits,
  receptionOutOfLimits,
  RECEPTION_TEMPERATURE_REQUIRED,
  REMEASURE_ACTION,
  type ReceptionCategory,
  aceiteData,
  formacionData,
  incidenciaData,
  limpiezaData,
  plagasData,
  recepcionData,
  temperaturaData,
  EQUIPMENT_TYPE_LABELS,
  COOKING_PROCESS_LABELS,
  REFERENCE_DEFAULTS,
  REFERENCE_SOURCES,
  cocinadoData,
  enfriamientoData,
  personalizadoData,
  type CookingProcess,
  type ReferenceValues,
} from '@shared/schemas';
import type { z } from 'zod';
import type { CleaningItem, CustomTemplate, Frequency, OpenCooling, RecordDataMap, RecordType, EquipmentType } from '@/api/types';
import { Keypad } from '@/components/ui/Keypad';
import { TemperatureInput } from '@/components/ui/TemperatureInput';
import { ApiError, errorMessage } from '@/api/client';
import { Button } from '@/components/ui/Button';
import { Callout } from '@/components/ui/Feedback';
import { Checkbox, ChoiceGroup, Field, Input, Select, Textarea, detailsToFieldErrors, useField, zodToFieldErrors } from '@/components/ui/Form';
import { ConfirmDialog } from '@/components/ui/Overlay';
import { Icon } from '@/components/icons/Icon';
import { cn } from '@/lib/cn';
import { formatLocalDate, formatRange, formatTemp, frequencyLabel, isOutOfRange, localDateIn, numberFieldError, parseDecimal } from '@/lib/format';

/** Datos de configuración que necesitan los formularios (compatibles con web y kiosko). */
export type FormContext = {
  equipment: { id: string; name: string; type: EquipmentType; minTemp: number | null; maxTemp: number | null; active?: boolean }[];
  cleaningPlans: { id: string; name: string; frequency: Frequency; weekday: number | null; monthDay: number | null; items: CleaningItem[]; active?: boolean }[];
  suppliers: { id: string; name: string; products: string[]; defaultCategory?: ReceptionCategory | null; receptionLimit?: number | null }[];
  staff: { id: string; name: string; active?: boolean }[];
  timezone: string;
  /** Fase 2: registros personalizados activos, valores de referencia del local y enfriamientos en curso. */
  customTemplates?: CustomTemplate[];
  referenceValues?: ReferenceValues;
  coolings?: OpenCooling[];
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
  REMEASURE_ACTION,
];
/** Motivos coherentes con ACEPTAR mercancía caducada o caliente (devolver o desechar solo tiene sentido al rechazarla). */
export const ACCEPT_EXPIRED_ACTIONS = ['Error en la etiqueta: confirmado con el proveedor', 'Fecha revisada: producto en buen estado', 'Se consume hoy bajo control del responsable'];
export const ACCEPT_HOT_ACTIONS = ['Se usa de inmediato', 'Pasada a cámara al momento', 'Avisado el proveedor'];
/** Producto que debía llegar caliente (≥ 63 °C) y llega por debajo. */
export const ACCEPT_COLD_HOT_FOOD_ACTIONS = ['Regenerado a más de 70 °C antes de servir', 'Se mantiene en caliente y se vuelve a medir', 'Avisado el proveedor'];
export const REJECT_REASONS = ['Se devuelve al proveedor', 'Se desecha'];
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

/** Acciones separadas por «; » (varias acciones rápidas + texto libre en un solo campo). */
export const splitActions = (v: string) =>
  v
    .split(/\s*;\s*/)
    .map((x) => x.trim())
    .filter(Boolean);
/** Marca o desmarca una acción rápida sin tocar el resto del texto. */
export function toggleAction(value: string, action: string): string {
  const parts = splitActions(value);
  return (parts.includes(action) ? parts.filter((x) => x !== action) : [...parts, action]).join('; ');
}

/** Sugerencias rápidas de acción correctora (se pueden marcar varias) + texto libre. */
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
      <Field label={label} error={error} hint="Toca una o varias opciones, o escríbelo tú.">
        <Suggestions value={value} onChange={onChange} suggestions={suggestions} large={large} multiple />
        <Textarea value={value} onChange={(e) => onChange(e.target.value)} maxLength={1000} rows={2} placeholder="Describe la acción tomada" />
      </Field>
    </div>
  );
}

function Suggestions({ value, onChange, suggestions, large, multiple }: { value: string; onChange: (v: string) => void; suggestions: string[]; large?: boolean; multiple?: boolean }) {
  const field = useField();
  const parts = multiple ? splitActions(value) : [value];
  return (
    <div className="flex flex-wrap gap-2 pb-1">
      {suggestions.map((s) => {
        const on = parts.includes(s);
        return (
          <button
            key={s}
            type="button"
            onClick={() => {
              onChange(multiple ? toggleAction(value, s) : s);
              field?.onEdit?.();
            }}
            aria-pressed={on}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-full border-2 px-4 text-left font-semibold transition-colors',
              large ? 'min-h-14 text-lg' : 'min-h-11',
              on ? 'border-ink bg-ink text-paper' : 'border-line-strong bg-surface hover:border-ink',
            )}
          >
            {on ? <Icon name="check" size={16} strokeWidth={3} /> : null}
            {s}
          </button>
        );
      })}
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
              <input type="radio" id={`equipment-${e.id}`} name="equipment" className="sr-only" checked={equipmentId === e.id} onChange={() => setEquipmentId(e.id)} />
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

      <Field label="Temperatura (°C)" live={!!liveError} error={liveError || errors.value || server.value} hint={eq ? `Rango correcto: ${formatRange(eq.minTemp, eq.maxTemp)}` : undefined}>
        <TemperatureInput
          value={value}
          onChange={setValue}
          placeholder="Ej.: 3,5"
          name="value"
          large
          className="max-w-72"
          inputClassName={cn('min-h-16 font-display text-3xl font-bold tabular')}
        />
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
  // Tipo de producto (obligatorio en la interfaz): fija el límite. El límite NO se edita al recibir: es el
  // de referencia o el propio del proveedor (Ajustes → Proveedores), igual que en el servidor.
  const [category, setCategory] = useState<ReceptionCategory | null>(i ? (i.category ?? null) : (p.ctx.suppliers.find((x) => x.id === supplierId)?.defaultCategory ?? null));
  const [categoryReason, setCategoryReason] = useState(i?.categoryReason ?? '');
  const [expiry, setExpiry] = useState(i?.expiryDate ?? '');
  const [accepted, setAccepted] = useState<'si' | 'no' | null>(i ? (i.accepted ? 'si' : 'no') : null);
  const [reason, setReason] = useState(i?.rejectionReason ?? '');
  const [corrective, setCorrective] = useState(i?.correctiveAction ?? '');
  const { errors, submit } = useValidated(recepcionData, p.onSubmit);
  const server = fieldErrorsFrom(p.serverError);
  const supplier = p.ctx.suppliers.find((s) => s.id === supplierId);
  const listId = 'products-list';

  const chooseCategory = (c: ReceptionCategory) => setCategory(c);
  const t = temperature.trim() ? parseDecimal(temperature) : null;
  const tError = temperature.trim() && (t == null || !physicallyValidTemp(t, RECEPTION_TEMP_MIN, RECEPTION_TEMP_MAX)) ? RECEPTION_TEMP_MESSAGE : null;
  const input = { category, temperature: t };
  const limits = category ? receptionLimits(input, supplier ? { defaultCategory: supplier.defaultCategory ?? null, receptionLimit: supplier.receptionLimit ?? null } : null) : null;
  const outOfLimits = !tError && limits != null && receptionOutOfLimits(input, limits);
  // Refrigerado, congelado o caliente: hay que medir la temperatura para aceptarlo (también lo exige el servidor).
  const tempRequired = category != null && RECEPTION_TEMPERATURE_REQUIRED.includes(category);
  // «Ambiente» para un proveedor que suele traer frío o caliente: motivo obligatorio (también en el servidor).
  // R6: también si el proveedor se escribe a mano con el nombre de uno dado de alta, y en una corrección
  // de un registro que era refrigerado, congelado o caliente.
  const typedSupplier =
    !supplier && supplierId === '__other' && supplierName.trim()
      ? p.ctx.suppliers.find((x) => x.name.trim().toLowerCase() === supplierName.trim().toLowerCase())
      : undefined;
  const supplierDefault = (supplier ?? typedSupplier)?.defaultCategory ?? null;
  const supplierWantsCold = category === 'ambiente' && supplierDefault != null && supplierDefault !== 'ambiente';
  const initialCategory = i?.category ?? null;
  const changedToAmbient = category === 'ambiente' && initialCategory != null && initialCategory !== 'ambiente';
  const categoryNeedsReason = supplierWantsCold || changedToAmbient;
  const expired = !!expiry && expiry < today;
  const issue = outOfLimits || expired;
  const needsReason = accepted === 'si' && issue;
  const limitLabel = limits?.max != null ? `máx. ${formatTemp(limits.max)}` : limits?.min != null ? `mín. ${formatTemp(limits.min)}` : '';

  return (
    <FormShell
      {...p}
      danger={accepted === 'no' || needsReason}
      disabled={!!tError}
      onSubmit={(e) => {
        e.preventDefault();
        if (tError) return;
        const extra: Record<string, string> = {};
        if (!category) extra.category = 'Elige el tipo de producto: fija la temperatura límite';
        if (categoryNeedsReason && !categoryReason.trim()) extra.categoryReason = 'Explica por qué lo registras como ambiente';
        if (tempRequired && accepted === 'si' && t == null) extra.temperature = 'Anota la temperatura al recibirlo: es obligatoria para producto refrigerado, congelado o caliente';
        if (accepted == null) extra.accepted = expired ? 'La mercancía está caducada: decide si la rechazas o la aceptas con un motivo' : 'Indica si aceptas o rechazas la mercancía';
        if (needsReason && !corrective.trim()) {
          extra.correctiveAction = expired ? 'Está caducada: indica por qué la aceptas o recházala' : 'Está fuera del límite de temperatura: indica qué has hecho o por qué la aceptas';
        }
        submit(
          {
            supplierId: supplier ? supplier.id : null,
            supplierName: supplier ? null : supplierName.trim() || null,
            product: product.trim(),
            lot: lot.trim() || null,
            temperature: t,
            category,
            categoryReason: categoryNeedsReason ? categoryReason.trim() || null : null,
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
        <Select
          value={supplierId}
          onChange={(e) => {
            setSupplierId(e.target.value);
            // La categoría habitual del proveedor se preselecciona (se puede cambiar).
            const def = p.ctx.suppliers.find((x) => x.id === e.target.value)?.defaultCategory;
            if (def) chooseCategory(def);
          }}
        >
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
      </div>
      <ChoiceGroup
        legend="Tipo de producto"
        value={category}
        onChange={(v) => chooseCategory(v)}
        error={errors.category || server.category}
        columns={2}
        size={p.large ? 'xl' : 'md'}
        options={RECEPTION_CATEGORIES.map((c) => {
          const d = RECEPTION_CATEGORY_LIMITS[c];
          return {
            value: c,
            label: RECEPTION_CATEGORY_LABELS[c],
            description: d.max != null ? `Hasta ${formatTemp(d.max)}` : d.min != null ? `Desde ${formatTemp(d.min)}` : 'Sin límite de temperatura',
          };
        })}
      />
      {categoryNeedsReason ? (
        <Field
          label="¿Por qué es ambiente?"
          hint={
            supplierWantsCold
              ? `${(supplier ?? typedSupplier)!.name} suele traer producto ${RECEPTION_CATEGORY_LABELS[supplierDefault!].toLowerCase()}. Quedará señalado en el informe.`
              : `El registro original era producto ${RECEPTION_CATEGORY_LABELS[initialCategory!].toLowerCase()}. Quedará señalado en el informe.`
          }
          error={errors.categoryReason || server.categoryReason}
        >
          <Input value={categoryReason} onChange={(e) => setCategoryReason(e.target.value)} maxLength={300} placeholder="Ej.: hoy trae conservas, no producto fresco" />
        </Field>
      ) : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Temperatura al recibir (°C)"
          optional={!tempRequired}
          hint={
            limits && (limits.max != null || limits.min != null)
              ? `Límite: ${limits.max != null ? `máx. ${formatTemp(limits.max)}` : `mín. ${formatTemp(limits.min)}`}${limits.differsFromReference ? ' (límite propio de este proveedor)' : ' (referencia orientativa)'}. Se cambia en Ajustes → Proveedores.`
              : category === 'ambiente'
                ? 'Producto a temperatura ambiente: sin límite.'
                : undefined
          }
          live={!!tError}
          error={tError || errors.temperature || server.temperature}
        >
          <TemperatureInput value={temperature} onChange={setTemperature} placeholder="Ej.: 2,5" large={p.large} />
        </Field>
        <Field label="Fecha de caducidad" optional error={errors.expiryDate || server.expiryDate}>
          <Input type="date" value={expiry} onChange={(e) => setExpiry(e.target.value)} />
        </Field>
      </div>
      {outOfLimits ? (
        <Callout tone="bad" title={`${formatTemp(t!)} está fuera del límite (${limitLabel})`} live="polite">
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
          <Suggestions value={reason} onChange={setReason} suggestions={REJECT_REASONS} large={p.large} />
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} maxLength={1000} rows={2} placeholder="Ej.: llegó a 9 °C, envase roto, caducada…" />
        </Field>
      ) : null}
      {needsReason ? (
        <CorrectiveAction
          label={expired ? '¿Por qué la aceptas?' : '¿Qué has hecho?'}
          value={corrective}
          onChange={setCorrective}
          suggestions={expired ? ACCEPT_EXPIRED_ACTIONS : category === 'caliente' ? ACCEPT_COLD_HOT_FOOD_ACTIONS : ACCEPT_HOT_ACTIONS}
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
  const polarError = numberFieldError(polar, {
    notNumber: 'Escribe el porcentaje con números (por ejemplo 18 o 27,5)',
    min: 0,
    max: 100,
    outOfRange: 'Los compuestos polares deben estar entre 0 y 100 %',
  });

  if (fryers.length === 0) return <Callout tone="warn" title="No hay freidoras">Añade una freidora en Ajustes → Equipos para registrar el aceite.</Callout>;

  return (
    <FormShell
      {...p}
      danger={over}
      disabled={!!polarError}
      onSubmit={(e) => {
        e.preventDefault();
        if (polarError) return;
        const extra: Record<string, string> = {};
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
        live={!!polarError}
        error={polarError || errors.polarCompounds || server.polarCompounds}
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
  const hoursError = numberFieldError(hours, {
    notNumber: 'Escribe las horas con números (por ejemplo 2 o 1,5)',
    min: 0,
    max: 1000,
    outOfRange: 'Las horas deben estar entre 0 y 1000',
  });

  if (staff.length === 0) return <Callout tone="warn" title="No hay personal dado de alta">Añade a tu equipo en Ajustes → Personal.</Callout>;

  return (
    <FormShell
      {...p}
      disabled={!!hoursError}
      onSubmit={(e) => {
        e.preventDefault();
        if (hoursError) return;
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
        <Field label="Horas" optional live={!!hoursError} error={hoursError || errors.hours || server.hours}>
          <Input inputMode="decimal" value={hours} onChange={(e) => setHours(e.target.value.replace('.', ','))} maxLength={6} />
        </Field>
      </div>
    </FormShell>
  );
}

// ---------------------------------------------------------------------------
// Fase 2: campo de valor (teclado grande con ± en la tablet; «±» junto al campo en la web)
// ---------------------------------------------------------------------------
export function ValueField({
  label,
  value,
  onChange,
  large,
  unit = '°C',
  error,
  hint,
  temperature = true,
  name,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  large?: boolean;
  unit?: string;
  error?: string | null;
  hint?: string;
  temperature?: boolean;
  name: string;
}) {
  if (large) {
    // Tablet: el mismo teclado grande que la temperatura de los equipos (± y coma), sin teclado del sistema.
    const id = `kv-${name}`;
    return (
      <div className="space-y-2">
        <p id={`${id}-label`} className="font-semibold">
          {label}
        </p>
        <output
          aria-labelledby={`${id}-label`}
          aria-live="polite"
          data-testid={`value-${name}`}
          className="block min-h-20 rounded-2xl border-2 border-line bg-surface-2 px-4 py-2 font-display text-5xl font-extrabold tabular"
        >
          {value ? value.replace('-', '−') : '—'} <span className="text-2xl text-ink-muted">{unit}</span>
        </output>
        {hint ? <p className="text-ink-muted">{hint}</p> : null}
        {error ? (
          <p role="alert" className="font-semibold text-bad">
            {error}
          </p>
        ) : null}
        <Keypad value={value.replace('−', '-')} onChange={(v) => onChange(v.replace('-', '−'))} mode="decimal" maxLength={temperature ? 4 : 6} className="max-w-md" />
      </div>
    );
  }
  return (
    <Field label={`${label} (${unit})`} error={error} hint={hint}>
      {temperature ? (
        <TemperatureInput value={value} onChange={onChange} name={name} large className="max-w-72" inputClassName="min-h-14 font-display text-2xl font-bold tabular" />
      ) : (
        <Input inputMode="decimal" name={name} value={value} onChange={(e) => onChange(e.target.value.replace('.', ','))} maxLength={12} className="max-w-72 font-display text-2xl font-bold tabular" />
      )}
    </Field>
  );
}

const refs = (ctx: FormContext): ReferenceValues => ctx.referenceValues ?? REFERENCE_DEFAULTS;

// ---------------------------------------------------------------------------
// Cocinado y regeneración
// ---------------------------------------------------------------------------
export const COOK_ACTIONS = ['Se prolongó la cocción hasta alcanzar la temperatura', 'Se volvió a calentar y a medir', 'Producto desechado', 'Avisado el responsable'];

export function CocinadoForm(p: Props<'cocinado'>) {
  const [product, setProduct] = useState(p.initial?.product ?? '');
  const [process, setProcess] = useState<CookingProcess | null>(p.initial?.process ?? null);
  const [value, setValue] = useState(numText(p.initial?.coreTemp));
  const [minutes, setMinutes] = useState(p.initial?.minutes != null ? String(p.initial.minutes) : '');
  const [action, setAction] = useState(p.initial?.correctiveAction ?? '');
  const { errors, submit } = useValidated(cocinadoData, p.onSubmit);
  const server = fieldErrorsFrom(p.serverError);
  const r = refs(p.ctx);
  const reference = process === 'regeneracion' ? r.reheatMinTemp : r.cookingMinTemp;
  const num = parseDecimal(value);
  const valid = physicallyValidTemp(num);
  const liveError = value.trim() === '' || value.trim() === '−' ? null : num == null ? (p.large ? null : 'Escribe la temperatura con números (por ejemplo 72,5)') : !valid ? TEMP_RANGE_MESSAGE : null;
  const low = process != null && valid && num! < reference;
  const minutesError = minutes.trim() && !/^\d{1,4}$/.test(minutes.trim()) ? 'Escribe los minutos sin decimales' : null;
  return (
    <FormShell
      {...p}
      danger={low}
      disabled={!!liveError || !!minutesError}
      submitLabel={p.submitLabel ?? (low ? 'Guardar con acción correctora' : 'Guardar')}
      onSubmit={(e) => {
        e.preventDefault();
        const extra: Record<string, string> = {};
        if (!process) extra.process = 'Elige si es cocinado o regeneración';
        if (num == null) extra.coreTemp = 'Escribe la temperatura en el centro del producto';
        if (low && !action.trim()) extra.correctiveAction = 'No llega a la temperatura de referencia: indica qué has hecho';
        submit({ product: product.trim(), process: process ?? undefined, coreTemp: num ?? Number.NaN, minutes: minutes.trim() ? Number(minutes) : null, correctiveAction: action.trim() || null }, extra);
      }}
    >
      <Field label="Producto" error={errors.product || server.product}>
        <Input value={product} onChange={(e) => setProduct(e.target.value)} maxLength={200} placeholder="Ej.: pollo asado, lentejas" className={cn(p.large && 'min-h-16 text-xl')} />
      </Field>
      <ChoiceGroup
        legend="Proceso"
        value={process}
        onChange={setProcess}
        error={errors.process || server.process}
        size={p.large ? 'xl' : 'md'}
        options={(['cocinado', 'regeneracion'] as const).map((v) => ({
          value: v,
          label: COOKING_PROCESS_LABELS[v],
          description: `Referencia: ${formatTemp(v === 'cocinado' ? r.cookingMinTemp : r.reheatMinTemp)} o más en el centro`,
        }))}
      />
      <ValueField
        name="coreTemp"
        label="Temperatura en el centro del producto"
        value={value}
        onChange={setValue}
        large={p.large}
        error={liveError || errors.coreTemp || server.coreTemp}
        hint={process ? `Valor de referencia orientativo: ${formatTemp(reference)} o más. ${REFERENCE_SOURCES[process === 'regeneracion' ? 'reheatMinTemp' : 'cookingMinTemp']}` : 'Mide con la sonda en la parte más gruesa del producto.'}
      />
      {process && valid ? (
        low ? (
          <Callout tone="bad" title={`${formatTemp(num!)}: no llega a ${formatTemp(reference)}`} live="polite">
            Sigue cocinando o calentando hasta alcanzarla y anota qué has hecho.
          </Callout>
        ) : (
          <Callout tone="ok" title={`${formatTemp(num!)}: alcanza la referencia`} live="polite" />
        )
      ) : null}
      <Field label="Tiempo del tratamiento (minutos)" optional error={minutesError || errors.minutes || server.minutes} hint="Si aplica (por ejemplo, horneado de 45 minutos).">
        <Input inputMode="numeric" value={minutes} onChange={(e) => setMinutes(e.target.value)} maxLength={4} className="max-w-40" />
      </Field>
      {low ? <CorrectiveAction value={action} onChange={setAction} suggestions={COOK_ACTIONS} error={errors.correctiveAction || server.correctiveAction} large={p.large} /> : null}
    </FormShell>
  );
}

// ---------------------------------------------------------------------------
// Enfriamiento rápido: inicio y cierre (dos registros)
// ---------------------------------------------------------------------------
export const COOL_ACTIONS = ['Producto regenerado y consumido en el día', 'Producto desechado', 'Abatidor revisado: estaba sobrecargado', 'Avisado el servicio técnico'];

/** Minutos desde un instante ISO hasta ahora. */
const minutesSince = (iso: string, now = Date.now()) => Math.max(0, Math.floor((now - new Date(iso).getTime()) / 60_000));

export function EnfriamientoForm(p: Props<'enfriamiento'>) {
  const init = p.initial;
  const open = p.ctx.coolings ?? [];
  const presetStart = p.preset?.startRecordId;
  const [mode, setMode] = useState<'inicio' | 'fin' | null>(init ? init.phase : presetStart ? 'fin' : open.length === 0 ? 'inicio' : null);
  const [startId, setStartId] = useState(init?.phase === 'fin' ? init.startRecordId : (presetStart ?? (open.length === 1 ? open[0]!.recordId : '')));
  const [product, setProduct] = useState(init?.phase === 'inicio' ? init.product : '');
  const [value, setValue] = useState(init ? numText(init.phase === 'inicio' ? init.startTemp : init.endTemp) : '');
  const [notes, setNotes] = useState(init?.phase === 'inicio' ? (init.notes ?? '') : '');
  const [discarded, setDiscarded] = useState(init?.phase === 'fin' ? init.discarded : false);
  const [action, setAction] = useState(init?.phase === 'fin' ? (init.correctiveAction ?? '') : '');
  const { errors, submit } = useValidated(enfriamientoData, p.onSubmit);
  const server = fieldErrorsFrom(p.serverError);
  const r = refs(p.ctx);
  const cooling = open.find((c) => c.recordId === startId);
  const num = parseDecimal(value);
  const valid = physicallyValidTemp(num);
  const liveError = value.trim() === '' || value.trim() === '−' ? null : num == null ? (p.large ? null : 'Escribe la temperatura con números (por ejemplo 8 o 3,5)') : !valid ? TEMP_RANGE_MESSAGE : null;
  // Criterio al cerrar: en una corrección, el aplicado al cerrar; si no, el del local.
  const target = init?.phase === 'fin' ? init.targetTemp : (cooling?.targetTemp ?? r.coolingTargetTemp);
  const maxMin = init?.phase === 'fin' ? init.maxMinutes : (cooling?.maxMinutes ?? r.coolingMaxMinutes);
  const elapsed = init?.phase === 'fin' ? init.minutes : cooling ? minutesSince(cooling.startedAt) : null;
  const overTime = elapsed != null && elapsed > maxMin;
  const overTemp = !discarded && valid && num! > target;
  const bad = mode === 'fin' && (discarded || overTemp || overTime);

  if (mode === null) {
    return (
      <div className="space-y-4">
        <ChoiceGroup
          legend="¿Qué quieres hacer?"
          value={null as 'inicio' | 'fin' | null}
          onChange={setMode}
          size={p.large ? 'xl' : 'md'}
          options={[
            { value: 'fin', label: open.length === 1 ? 'Terminar el enfriamiento en curso' : `Terminar uno de los ${open.length} en curso`, tone: 'warn', description: 'Anota la temperatura final' },
            { value: 'inicio', label: 'Empezar un enfriamiento nuevo', description: 'Producto y temperatura al meterlo en el abatidor' },
          ]}
        />
      </div>
    );
  }

  return (
    <FormShell
      {...p}
      danger={bad}
      disabled={!!liveError}
      submitLabel={p.submitLabel ?? (mode === 'inicio' ? 'Empezar el enfriamiento' : bad ? 'Terminar con acción correctora' : 'Terminar el enfriamiento')}
      onSubmit={(e) => {
        e.preventDefault();
        if (mode === 'inicio') {
          submit({ phase: 'inicio', product: product.trim(), startTemp: num ?? Number.NaN, notes: notes.trim() || null }, num == null ? { startTemp: 'Escribe la temperatura al empezar' } : {});
          return;
        }
        const extra: Record<string, string> = {};
        if (!startId) extra.startRecordId = 'Elige el enfriamiento que terminas';
        if (!discarded && num == null) extra.endTemp = 'Escribe la temperatura al terminar';
        if (bad && !action.trim()) extra.correctiveAction = discarded ? 'Indica qué se ha hecho con el producto' : 'No cumple el criterio: indica qué has hecho';
        submit({ phase: 'fin', startRecordId: startId, endTemp: num, discarded, correctiveAction: action.trim() || null }, extra);
      }}
    >
      {!init && open.length > 0 ? (
        <button type="button" onClick={() => setMode(mode === 'inicio' ? 'fin' : 'inicio')} className="min-h-11 font-semibold text-brand-strong underline underline-offset-4 dark:text-brand">
          {mode === 'inicio' ? 'No, quiero terminar uno en curso' : 'No, quiero empezar uno nuevo'}
        </button>
      ) : null}
      {mode === 'inicio' ? (
        <>
          <Field label="Producto" error={errors.product || server.product}>
            <Input value={product} onChange={(e) => setProduct(e.target.value)} maxLength={200} placeholder="Ej.: caldo, arroz, salsa" className={cn(p.large && 'min-h-16 text-xl')} />
          </Field>
          <ValueField
            name="startTemp"
            label="Temperatura al empezar"
            value={value}
            onChange={setValue}
            large={p.large}
            error={liveError || errors.startTemp || server.startTemp}
            hint={`Criterio orientativo del local: ${formatTemp(r.coolingTargetTemp)} o menos en ${r.coolingMaxMinutes} minutos o menos. ${REFERENCE_SOURCES.coolingMaxMinutes}`}
          />
          <Field label="Notas" optional>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} placeholder="Ej.: en abatidor, en bandejas de 5 cm" />
          </Field>
        </>
      ) : (
        <>
          {init?.phase === 'fin' ? (
            <p className="text-ink-muted">
              Enfriamiento de <strong>{init.product}</strong>: {init.minutes} minutos (criterio: {formatTemp(init.targetTemp)} o menos en {init.maxMinutes} min).
            </p>
          ) : (
            <fieldset>
              <legend className="mb-1.5 font-semibold">Enfriamiento en curso</legend>
              <div className="grid gap-2">
                {open.map((c) => (
                  <label
                    key={c.recordId}
                    className={cn(
                      'flex min-h-16 cursor-pointer items-center gap-3 rounded-xl border-2 px-4 py-2 has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-focus',
                      startId === c.recordId ? 'border-brand bg-brand-soft' : 'border-line bg-surface hover:border-line-strong',
                      p.large && 'min-h-20 text-xl',
                    )}
                  >
                    <input type="radio" name="cooling" className="sr-only" checked={startId === c.recordId} onChange={() => setStartId(c.recordId)} />
                    <Icon name="snowflake" size={24} className="shrink-0 text-brand" />
                    <span className="min-w-0">
                      <span className="block font-semibold [overflow-wrap:anywhere]">{c.product}</span>
                      <span className={cn('block text-sm', c.overdue ? 'font-semibold text-bad' : 'text-ink-muted')}>
                        Empezó a {formatTemp(c.startTemp)} · hace {minutesSince(c.startedAt)} min{c.overdue ? ` · supera los ${c.maxMinutes} min` : ''}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
              {errors.startRecordId || server.startRecordId ? (
                <p className="mt-1.5 text-sm font-semibold text-bad" role="alert">
                  {errors.startRecordId || server.startRecordId}
                </p>
              ) : null}
            </fieldset>
          )}
          {!discarded ? (
            <ValueField
              name="endTemp"
              label="Temperatura al terminar"
              value={value}
              onChange={setValue}
              large={p.large}
              error={liveError || errors.endTemp || server.endTemp}
              hint={`Criterio orientativo: ${formatTemp(target)} o menos en ${maxMin} minutos o menos.`}
            />
          ) : null}
          <Checkbox checked={discarded} onChange={setDiscarded} label="No se ha podido medir: el producto se ha desechado" />
          {startId || init ? (
            bad ? (
              <Callout tone="bad" title={discarded ? 'Producto desechado' : overTime ? `Han pasado ${elapsed} min: supera los ${maxMin} min` : `${formatTemp(num!)}: por encima de ${formatTemp(target)}`} live="polite">
                Anota qué has hecho con el producto.
              </Callout>
            ) : valid ? (
              <Callout tone="ok" title={`${formatTemp(num!)} en ${elapsed ?? '—'} min: cumple el criterio`} live="polite" />
            ) : null
          ) : null}
          {bad ? <CorrectiveAction value={action} onChange={setAction} suggestions={COOL_ACTIONS} error={errors.correctiveAction || server.correctiveAction} large={p.large} /> : null}
        </>
      )}
    </FormShell>
  );
}

// ---------------------------------------------------------------------------
// Registros personalizados (lista de comprobación, valor con número o sí/no)
// ---------------------------------------------------------------------------
export const CUSTOM_ACTIONS = ['Corregido en el momento', 'Avisado el responsable', 'Avisado el servicio técnico', 'Se repetirá el control'];

export function PersonalizadoForm(p: Props<'personalizado'>) {
  const templates = (p.ctx.customTemplates ?? []).filter((t) => t.active || t.id === p.initial?.templateId);
  const [templateId, setTemplateId] = useState(p.initial?.templateId ?? p.preset?.templateId ?? (templates.length === 1 ? templates[0]!.id : ''));
  const tpl = templates.find((t) => t.id === templateId);
  const [answers, setAnswers] = useState<Record<string, boolean>>(() => Object.fromEntries((p.initial?.items ?? []).map((i) => [i.itemId, i.ok])));
  const [reading, setReading] = useState(numText(p.initial?.reading));
  const [answer, setAnswer] = useState<'si' | 'no' | null>(p.initial?.answer === true ? 'si' : p.initial?.answer === false ? 'no' : null);
  const [notes, setNotes] = useState(p.initial?.notes ?? '');
  const [action, setAction] = useState(p.initial?.correctiveAction ?? '');
  const { errors, submit } = useValidated(personalizadoData, p.onSubmit);
  const server = fieldErrorsFrom(p.serverError);
  const num = parseDecimal(reading);
  const readingError = reading.trim() === '' || reading.trim() === '−' ? null : num == null ? (p.large ? null : 'Escribe el valor con números (por ejemplo 0,5)') : null;
  const failed = tpl?.kind === 'checklist' ? tpl.items.filter((i) => answers[i.id] === false).length : 0;
  const bad =
    tpl?.kind === 'checklist' ? failed > 0 : tpl?.kind === 'numeric' ? num != null && isOutOfRange(num, tpl.min, tpl.max) : tpl?.kind === 'yesno' ? answer === 'no' : false;

  if (templates.length === 0) {
    return (
      <Callout tone="info" title="Aún no hay registros personalizados">
        Créalos en Ajustes → Registros personalizados (o activa uno sugerido: cloro del agua, termómetros, mantenimiento…).
      </Callout>
    );
  }
  const rangeText = (t: CustomTemplate) =>
    t.min != null && t.max != null ? `entre ${numText(t.min)} y ${numText(t.max)}` : t.min != null ? `${numText(t.min)} o más` : t.max != null ? `${numText(t.max)} o menos` : '';

  return (
    <FormShell
      {...p}
      danger={bad}
      disabled={!!readingError || !tpl}
      submitLabel={p.submitLabel ?? (bad ? 'Guardar con acción correctora' : 'Guardar')}
      onSubmit={(e) => {
        e.preventDefault();
        if (!tpl) return;
        const extra: Record<string, string> = {};
        if (tpl.kind === 'checklist' && tpl.items.some((i) => answers[i.id] === undefined)) extra.items = 'Marca cada punto como correcto o no';
        if (tpl.kind === 'numeric' && num == null) extra.reading = 'Escribe el valor';
        if (tpl.kind === 'yesno' && !answer) extra.answer = 'Responde sí o no';
        if (bad && !action.trim()) extra.correctiveAction = 'Indica la acción correctora';
        submit(
          {
            templateId: tpl.id,
            items: tpl.kind === 'checklist' ? tpl.items.filter((i) => answers[i.id] !== undefined).map((i) => ({ itemId: i.id, ok: answers[i.id] })) : null,
            reading: tpl.kind === 'numeric' ? num : null,
            answer: tpl.kind === 'yesno' ? answer === 'si' : null,
            notes: notes.trim() || null,
            correctiveAction: action.trim() || null,
          },
          extra,
        );
      }}
    >
      {p.initial ? null : (
        <Field label="Registro" error={errors.templateId || server.templateId}>
          <Select value={templateId} onChange={(e) => setTemplateId(e.target.value)} className={cn(p.large && 'min-h-16 text-xl')}>
            <option value="">Elige…</option>
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </Select>
        </Field>
      )}
      {tpl ? (
        <>
          {tpl.instructions ? <Callout tone="info" title={tpl.name}>{tpl.instructions}</Callout> : null}
          {tpl.kind === 'checklist' ? (
            <fieldset className="space-y-2">
              <legend className="mb-1.5 font-semibold">Puntos a comprobar</legend>
              {tpl.items.map((it) => (
                <div key={it.id} className={cn('flex flex-wrap items-center gap-2 rounded-xl border px-3 py-2', answers[it.id] === false ? 'border-bad/50 bg-bad-soft/60' : 'border-line')}>
                  <span className={cn('min-w-44 flex-1 font-semibold [overflow-wrap:anywhere]', p.large && 'text-xl')}>{it.label}</span>
                  <div role="group" aria-label={it.label} className="flex gap-2">
                    {([true, false] as const).map((ok) => (
                      <button
                        key={String(ok)}
                        type="button"
                        aria-pressed={answers[it.id] === ok}
                        onClick={() => setAnswers((a) => ({ ...a, [it.id]: ok }))}
                        className={cn(
                          'inline-flex items-center gap-1.5 rounded-full border-2 px-4 font-semibold',
                          p.large ? 'min-h-14 text-lg' : 'min-h-11',
                          answers[it.id] === ok ? (ok ? 'border-ok-solid bg-ok-soft text-ok' : 'border-bad-solid bg-bad-soft text-bad') : 'border-line-strong bg-surface',
                        )}
                      >
                        {answers[it.id] === ok ? <Icon name={ok ? 'check' : 'x'} size={16} strokeWidth={3} /> : null}
                        {ok ? 'Correcto' : 'No'}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
              {errors.items || server.items ? (
                <p className="text-sm font-semibold text-bad" role="alert">
                  {errors.items || server.items}
                </p>
              ) : null}
            </fieldset>
          ) : tpl.kind === 'numeric' ? (
            <ValueField
              name="reading"
              label="Valor"
              unit={tpl.unit ?? ''}
              temperature={false}
              value={reading}
              onChange={setReading}
              large={p.large}
              error={readingError || errors.reading || server.reading}
              hint={rangeText(tpl) ? `Rango correcto: ${rangeText(tpl)}${tpl.unit ? ` ${tpl.unit}` : ''}` : undefined}
            />
          ) : (
            <ChoiceGroup
              legend={tpl.name}
              value={answer}
              onChange={setAnswer}
              error={errors.answer || server.answer}
              size={p.large ? 'xl' : 'md'}
              options={[
                { value: 'si', label: 'Sí', tone: 'ok' },
                { value: 'no', label: 'No', tone: 'bad' },
              ]}
            />
          )}
          {bad ? (
            <Callout tone="bad" title={tpl.kind === 'checklist' ? `${failed} ${failed === 1 ? 'punto no se cumple' : 'puntos no se cumplen'}` : tpl.kind === 'numeric' ? 'Fuera del rango correcto' : 'Respuesta «No»'} live="polite">
              Anota qué has hecho.
            </Callout>
          ) : null}
          <Field label="Observaciones" optional>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={1000} rows={2} />
          </Field>
          {bad ? <CorrectiveAction value={action} onChange={setAction} suggestions={CUSTOM_ACTIONS} error={errors.correctiveAction || server.correctiveAction} large={p.large} /> : null}
        </>
      ) : null}
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
    case 'cocinado':
      return <CocinadoForm {...(props as Props<'cocinado'>)} />;
    case 'enfriamiento':
      return <EnfriamientoForm {...(props as Props<'enfriamiento'>)} />;
    case 'personalizado':
      return <PersonalizadoForm {...(props as Props<'personalizado'>)} />;
  }
}
