import { cn } from '@/lib/cn';
import { Icon } from '@/components/icons/Icon';

/**
 * Teclado numérico en pantalla (modo cocina): teclas de ≥ 64 px, utilizable con guantes.
 * - mode "decimal": admite signo negativo (±) y coma decimal (máx. 1 decimal).
 * - mode "pin": solo dígitos, longitud máxima.
 */
export function Keypad({
  value,
  onChange,
  mode = 'decimal',
  maxLength = 6,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  mode?: 'decimal' | 'pin';
  maxLength?: number;
  className?: string;
}) {
  const press = (key: string) => {
    if (key === 'back') return onChange(value.slice(0, -1));
    if (key === 'sign') return onChange(value.startsWith('-') ? value.slice(1) : `-${value}`);
    if (key === ',') {
      if (value.includes(',')) return;
      const digits = value.replace('-', '');
      return onChange(`${value.startsWith('-') ? '-' : ''}${digits === '' ? '0' : digits},`);
    }
    // dígito
    const [, decimals] = value.split(',');
    if (decimals !== undefined && decimals.length >= 1) return;
    const digitsOnly = value.replace(/[-,]/g, '');
    if (digitsOnly.length >= maxLength) return;
    if (mode === 'decimal' && (value === '0' || value === '-0')) return onChange(value.replace('0', key));
    onChange(value + key);
  };

  const keys = mode === 'pin' ? ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'blank', '0', 'back'] : ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'sign', '0', ','];

  const label = (k: string) => (k === 'back' ? 'Borrar' : k === 'sign' ? 'Cambiar signo (negativo)' : k === ',' ? 'Coma decimal' : k);

  return (
    <div className={cn('grid grid-cols-3 gap-2.5', className)}>
      {keys.map((k) =>
        k === 'blank' ? (
          <span key={k} aria-hidden="true" />
        ) : (
          <button
            key={k}
            type="button"
            onClick={() => press(k)}
            aria-label={label(k)}
            className={cn(
              'grid min-h-16 place-items-center rounded-2xl border border-line bg-surface font-display text-3xl font-bold shadow-card transition-transform select-none active:scale-95 active:bg-surface-3 sm:min-h-[4.5rem]',
              (k === 'sign' || k === ',' || k === 'back') && 'bg-surface-2 text-2xl',
            )}
          >
            {k === 'back' ? <Icon name="backspace" size={30} /> : k === 'sign' ? '±' : k}
          </button>
        ),
      )}
      {mode === 'decimal' ? (
        <button
          type="button"
          onClick={() => onChange(value.slice(0, -1))}
          aria-label="Borrar"
          className="col-span-3 grid min-h-14 place-items-center rounded-2xl border border-line bg-surface-2 shadow-card active:scale-[0.99]"
        >
          <span className="inline-flex items-center gap-2 text-lg font-semibold">
            <Icon name="backspace" size={26} /> Borrar
          </span>
        </button>
      ) : null}
    </div>
  );
}

/** Texto del teclado → número (o null si incompleto). "-3," → null; "-3,5" → -3.5 */
export function keypadToNumber(v: string): number | null {
  if (!v || v === '-' || v.endsWith(',')) return null;
  const n = Number(v.replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

/** Visualización: signo menos tipográfico. */
export const keypadDisplay = (v: string) => (v ? v.replace('-', '−') : '');
