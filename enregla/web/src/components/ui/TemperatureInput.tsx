import { useRef, type InputHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';
import { Input, useField } from './Form';

/** Normaliza lo tecleado: coma decimal y signo menos tipográfico (como el resto de la app). */
export const normalizeTemperatureText = (v: string) => v.replace('.', ',').replace('-', '−');

/** Cambia el signo de un texto de temperatura («3,5» ⇄ «−3,5»; vacío → «−» para seguir tecleando). */
export function toggleTemperatureSign(v: string): string {
  const t = v.trim();
  return /^[−-]/.test(t) ? t.replace(/^[−-]/, '') : `−${t}`;
}

/**
 * Campo de temperatura con botón «±». El teclado numérico de iPhone (`inputMode="decimal"`) no
 * tiene signo menos: sin este botón no se podría escribir −18 °C en la web desde un iPhone.
 * Va dentro de un `Field` (etiqueta, ayuda y error asociados al campo de texto).
 */
export function TemperatureInput({
  value,
  onChange,
  className,
  inputClassName,
  unit = true,
  large,
  ...rest
}: {
  value: string;
  onChange: (v: string) => void;
  className?: string;
  inputClassName?: string;
  /** Muestra «°C» dentro del campo. */
  unit?: boolean;
  /** Tamaño grande (registro de temperatura, modo cocina). */
  large?: boolean;
} & Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'className' | 'inputMode'>) {
  const ref = useRef<HTMLInputElement>(null);
  const field = useField();
  const negative = /^[−-]/.test(value.trim());
  return (
    <div className={cn('flex items-stretch gap-2', className)}>
      <div className="relative min-w-0 flex-1">
        <Input
          ref={ref}
          inputMode="decimal"
          autoComplete="off"
          maxLength={7}
          {...rest}
          value={value}
          onChange={(e) => onChange(normalizeTemperatureText(e.target.value))}
          className={cn(unit && 'pr-12', inputClassName)}
        />
        {unit ? <span className="pointer-events-none absolute top-1/2 right-3.5 -translate-y-1/2 text-lg text-ink-muted">°C</span> : null}
      </div>
      <button
        type="button"
        onClick={() => {
          onChange(toggleTemperatureSign(value));
          field?.onEdit?.();
          ref.current?.focus();
        }}
        aria-pressed={negative}
        aria-label={negative ? 'Quitar el signo menos (temperatura sobre cero)' : 'Poner signo menos (temperatura bajo cero)'}
        title="Cambiar el signo (bajo cero / sobre cero)"
        className={cn(
          'grid shrink-0 place-items-center rounded-xl border-2 font-display font-extrabold transition-colors focus-visible:outline-3 focus-visible:outline-focus disabled:opacity-50',
          large ? 'min-h-16 min-w-16 text-2xl' : 'min-h-12 min-w-12 text-xl',
          negative ? 'border-ink bg-ink text-paper' : 'border-line-strong bg-surface text-ink hover:border-ink',
        )}
      >
        ±
      </button>
    </div>
  );
}
