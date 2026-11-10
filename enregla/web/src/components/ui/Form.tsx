import {
  createContext,
  forwardRef,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { cn } from '@/lib/cn';
import { Icon } from '@/components/icons/Icon';

type FieldCtx = { id: string; describedBy?: string; invalid: boolean; counterId?: string; onEdit?: () => void };
const FieldContext = createContext<FieldCtx | null>(null);

export function useField() {
  return useContext(FieldContext);
}

/**
 * Error que desaparece en cuanto la persona cambia el valor del campo (B6) y vuelve a mostrarse
 * si, al enviar otra vez el formulario, el error sigue ahí. Sirve para cualquier formulario sin
 * que cada uno tenga que limpiar sus errores a mano.
 */
export function useDismissibleError<T extends HTMLElement>(error: string | null | undefined) {
  const ref = useRef<T>(null);
  const [dismissed, setDismissed] = useState<string | null>(null);
  useEffect(() => {
    const form = ref.current?.closest('form');
    if (!form) return;
    // Al enviar, se vuelven a mostrar los errores (antes de que el formulario calcule los nuevos).
    const onSubmit = () => setDismissed(null);
    form.addEventListener('submit', onSubmit, true);
    return () => form.removeEventListener('submit', onSubmit, true);
  }, []);
  const visible = error && error !== dismissed ? error : null;
  const onEdit = () => {
    if (error) setDismissed(error);
  };
  return { ref, visible, onEdit };
}

/** Campo con etiqueta, ayuda y error asociados (aria-describedby / aria-invalid). */
export function Field({
  label,
  hint,
  error,
  children,
  className,
  optional,
  id: idProp,
}: {
  label: ReactNode;
  hint?: ReactNode;
  error?: string | null;
  children: ReactNode;
  className?: string;
  optional?: boolean;
  id?: string;
}) {
  const autoId = useId();
  const id = idProp ?? autoId;
  const { ref, visible, onEdit } = useDismissibleError<HTMLDivElement>(error);
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = visible ? `${id}-error` : undefined;
  const counterId = `${id}-count`;
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined;
  return (
    <FieldContext.Provider value={{ id, describedBy, invalid: !!visible, counterId, onEdit }}>
      <div ref={ref} className={cn('flex min-w-0 flex-col gap-1.5', className)} onInput={onEdit} onChange={onEdit}>
        <label htmlFor={id} className="font-semibold text-ink">
          {label}
          {optional ? <span className="ml-1 font-normal text-ink-muted">(opcional)</span> : null}
        </label>
        {hint ? (
          <p id={hintId} className="-mt-0.5 text-sm text-ink-muted">
            {hint}
          </p>
        ) : null}
        {children}
        {visible ? (
          <p id={errorId} className="flex items-start gap-1.5 text-sm font-semibold text-bad" role="alert">
            <Icon name="alert" size={16} className="mt-0.5 shrink-0" />
            {visible}
          </p>
        ) : null}
      </div>
    </FieldContext.Provider>
  );
}

export const inputClasses =
  'w-full min-h-12 rounded-xl border border-line-strong bg-surface px-3.5 py-2.5 text-ink placeholder:text-ink-muted/70 shadow-[inset_0_1px_2px_rgb(0_0_0/0.04)] transition-colors hover:border-ink-muted focus:border-brand focus:outline-none focus-visible:outline-3 focus-visible:outline-focus disabled:cursor-not-allowed disabled:bg-surface-2 disabled:text-ink-muted aria-[invalid=true]:border-bad';

/** Contador de caracteres: aparece al acercarse al límite (mismo límite que el servidor). */
export function CharCounter({ value, max, id }: { value: string; max: number; id?: string }) {
  if (value.length < Math.floor(max * 0.8)) return null;
  const left = max - value.length;
  return (
    <span id={id} className={cn('-mt-0.5 self-end text-sm tabular', left <= 0 ? 'font-semibold text-bad' : 'text-ink-muted')} aria-live="polite">
      {left <= 0 ? `Has llegado al máximo de ${max} caracteres` : `${value.length}/${max}`}
    </span>
  );
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, id, ...rest }, ref) {
  const field = useField();
  // La API solo admite fechas entre los años 2000 y 2100.
  const dateLimits = rest.type === 'date' ? { min: '2000-01-01', max: '2100-12-31' } : {};
  const counter = typeof rest.value === 'string' && typeof rest.maxLength === 'number' && rest.maxLength >= 20 && rest.type !== 'password';
  const describedBy = [field?.describedBy, counter && field?.counterId ? field.counterId : null].filter(Boolean).join(' ') || undefined;
  return (
    <>
      <input
        {...dateLimits}
        ref={ref}
        id={id ?? field?.id}
        aria-describedby={describedBy}
        aria-invalid={field?.invalid || undefined}
        className={cn(inputClasses, className)}
        {...rest}
      />
      {counter && field ? <CharCounter value={rest.value as string} max={rest.maxLength!} id={field.counterId} /> : null}
    </>
  );
});

/**
 * Campo de PIN: solo cifras. Si se teclea otra cosa no se descarta en silencio: se avisa (B14).
 */
export const PinInput = forwardRef<HTMLInputElement, Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'value'> & { value: string; onChange: (v: string) => void; maxDigits?: number }>(
  function PinInput({ value, onChange, maxDigits = 6, className, ...rest }, ref) {
    const [warning, setWarning] = useState<string | null>(null);
    return (
      <>
        <Input
          ref={ref}
          {...rest}
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          autoComplete="off"
          value={value}
          className={cn('max-w-48 tracking-[0.3em]', className)}
          onChange={(e) => {
            const raw = e.target.value;
            const digits = raw.replace(/\D/g, '');
            if (digits.length !== raw.length) setWarning('El PIN solo admite números (0–9).');
            else if (digits.length > maxDigits) setWarning(`El PIN tiene como máximo ${maxDigits} cifras.`);
            else setWarning(null);
            onChange(digits.slice(0, maxDigits));
          }}
        />
        {warning ? (
          <p className="flex items-start gap-1.5 text-sm font-semibold text-warn" role="status">
            <Icon name="info" size={16} className="mt-0.5 shrink-0" />
            {warning}
          </p>
        ) : null}
      </>
    );
  },
);

export const PasswordInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function PasswordInput(props, ref) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <Input ref={ref} {...props} type={show ? 'text' : 'password'} className={cn('pr-14', props.className)} />
      <button
        type="button"
        onClick={() => setShow((s) => !s)}
        className="absolute inset-y-0 right-0 grid w-12 place-items-center rounded-r-xl text-ink-muted hover:text-ink"
        aria-label={show ? 'Ocultar contraseña' : 'Mostrar contraseña'}
        aria-pressed={show}
      >
        <Icon name={show ? 'eyeOff' : 'eye'} size={20} />
      </button>
    </div>
  );
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, id, rows = 3, ...rest }, ref) {
  const field = useField();
  return (
    <textarea
      ref={ref}
      id={id ?? field?.id}
      rows={rows}
      aria-describedby={field?.describedBy}
      aria-invalid={field?.invalid || undefined}
      className={cn(inputClasses, 'min-h-24 resize-y', className)}
      {...rest}
    />
  );
});

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select({ className, id, children, ...rest }, ref) {
  const field = useField();
  return (
    <div className="relative">
      <select
        ref={ref}
        id={id ?? field?.id}
        aria-describedby={field?.describedBy}
        aria-invalid={field?.invalid || undefined}
        className={cn(inputClasses, 'appearance-none pr-11', className)}
        {...rest}
      >
        {children}
      </select>
      <Icon name="chevronDown" size={18} className="pointer-events-none absolute top-1/2 right-3.5 -translate-y-1/2 text-ink-muted" />
    </div>
  );
});

/** Interruptor accesible (role="switch"). */
export function Switch({
  checked,
  onChange,
  label,
  description,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className="flex min-h-12 items-center justify-between gap-4">
      <div className="min-w-0">
        <label htmlFor={id} className="font-semibold">
          {label}
        </label>
        {description ? (
          <p id={`${id}-d`} className="text-sm text-ink-muted">
            {description}
          </p>
        ) : null}
      </div>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-describedby={description ? `${id}-d` : undefined}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          'relative inline-flex h-8 w-14 shrink-0 items-center rounded-full border-2 transition-colors disabled:opacity-50',
          checked ? 'border-brand bg-brand' : 'border-line-strong bg-surface-3',
        )}
      >
        <span
          className={cn(
            'inline-grid size-6 place-items-center rounded-full bg-white shadow transition-transform',
            checked ? 'translate-x-6.5 text-brand' : 'translate-x-0.5 text-transparent',
          )}
        >
          <Icon name="check" size={14} strokeWidth={3} />
        </span>
        <span className="sr-only">{checked ? 'Activado' : 'Desactivado'}</span>
      </button>
    </div>
  );
}

/** Grupo de opciones grandes (radio) — muy usado en formularios de cocina. */
export function ChoiceGroup<T extends string>({
  legend,
  value,
  onChange,
  options,
  columns = 2,
  error,
  size = 'md',
  name,
}: {
  legend: ReactNode;
  value: T | null | undefined;
  onChange: (v: T) => void;
  options: { value: T; label: ReactNode; tone?: 'ok' | 'bad' | 'warn' | 'neutral'; description?: ReactNode }[];
  columns?: 2 | 3 | 4;
  error?: string | null;
  size?: 'md' | 'xl';
  name?: string;
}) {
  const autoName = useId();
  const groupName = name ?? autoName;
  const { ref, visible, onEdit } = useDismissibleError<HTMLFieldSetElement>(error);
  const errorId = visible ? `${groupName}-err` : undefined;
  const colClass = columns === 4 ? 'grid-cols-2 sm:grid-cols-4' : columns === 3 ? 'grid-cols-1 sm:grid-cols-3' : 'grid-cols-1 min-[400px]:grid-cols-2';
  return (
    <fieldset ref={ref} aria-describedby={errorId} onChange={onEdit} className="min-w-0">
      <legend className="mb-1.5 font-semibold">{legend}</legend>
      <div className={cn('grid gap-2', colClass)}>
        {options.map((o) => {
          const selected = value === o.value;
          const toneSel =
            o.tone === 'ok'
              ? 'border-ok-solid bg-ok-soft'
              : o.tone === 'bad'
                ? 'border-bad-solid bg-bad-soft'
                : o.tone === 'warn'
                  ? 'border-warn-solid bg-warn-soft'
                  : 'border-brand bg-brand-soft';
          return (
            <label
              key={o.value}
              className={cn(
                'relative flex cursor-pointer items-center gap-3 rounded-xl border-2 px-4 transition-colors has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-focus',
                size === 'xl' ? 'min-h-18 text-lg' : 'min-h-12 py-2',
                selected ? toneSel : 'border-line bg-surface hover:border-line-strong',
              )}
            >
              <input
                type="radio"
                name={groupName}
                value={o.value}
                checked={selected}
                onChange={() => onChange(o.value)}
                className="sr-only"
              />
              <span
                aria-hidden="true"
                className={cn(
                  'grid size-6 shrink-0 place-items-center rounded-full border-2',
                  selected ? 'border-current bg-current' : 'border-line-strong',
                )}
              >
                {selected ? <Icon name="check" size={14} strokeWidth={3} className="text-surface" /> : null}
              </span>
              <span className="min-w-0">
                <span className="block font-semibold">{o.label}</span>
                {o.description ? <span className="block text-sm text-ink-muted">{o.description}</span> : null}
              </span>
            </label>
          );
        })}
      </div>
      {visible ? (
        <p id={errorId} className="mt-1.5 text-sm font-semibold text-bad" role="alert">
          {visible}
        </p>
      ) : null}
    </fieldset>
  );
}

export function Checkbox({ checked, onChange, label, description, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; description?: ReactNode; disabled?: boolean }) {
  return (
    <label className={cn('flex min-h-12 cursor-pointer items-center gap-3 rounded-xl px-1', disabled && 'cursor-not-allowed opacity-60')}>
      <input type="checkbox" className="peer sr-only" checked={checked} onChange={(e) => onChange(e.target.checked)} disabled={disabled} />
      <span
        aria-hidden="true"
        className={cn(
          'grid size-7 shrink-0 place-items-center rounded-lg border-2 transition-colors peer-focus-visible:outline-3 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-focus',
          checked ? 'border-ok-solid bg-ok-solid text-white' : 'border-line-strong bg-surface',
        )}
      >
        {checked ? <Icon name="check" size={18} strokeWidth={3} /> : null}
      </span>
      <span className="min-w-0">
        <span className="block">{label}</span>
        {description ? <span className="block text-sm text-ink-muted">{description}</span> : null}
      </span>
    </label>
  );
}

/** Une errores del servidor (details) en un mapa campo → mensaje, quitando un prefijo opcional. */
export function detailsToFieldErrors(details: { path: string; message: string }[], prefix = ''): Record<string, string> {
  const out: Record<string, string> = {};
  for (const d of details) {
    const key = prefix && d.path.startsWith(prefix) ? d.path.slice(prefix.length) : d.path;
    if (!(key in out)) out[key] = d.message;
  }
  return out;
}

/** Errores de zod → mapa campo → mensaje. */
export function zodToFieldErrors(issues: readonly { path: readonly PropertyKey[]; message: string }[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const i of issues) {
    const key = i.path.map(String).join('.');
    if (!(key in out)) out[key] = i.message;
  }
  return out;
}
