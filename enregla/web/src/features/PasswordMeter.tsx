import { passwordChecks, passwordScore } from '@/lib/password';
import { Icon } from '@/components/icons/Icon';
import { cn } from '@/lib/cn';

const LEVELS = ['Muy débil', 'Débil', 'Aceptable', 'Buena', 'Muy buena'];

/** Medidor de requisitos de contraseña (las reglas coinciden con las del servidor). */
export function PasswordMeter({ password, email = '' }: { password: string; email?: string }) {
  const checks = passwordChecks(password, email);
  const score = passwordScore(password, email);
  return (
    <div className="rounded-2xl border border-line bg-surface-2/60 p-3.5" aria-live="polite">
      <div className="flex items-center gap-3">
        <div className="grid flex-1 grid-cols-4 gap-1.5" aria-hidden="true">
          {[1, 2, 3, 4].map((i) => (
            <span
              key={i}
              className={cn(
                'h-2 rounded-full transition-colors',
                password && score >= i ? (score <= 1 ? 'bg-bad-solid' : score === 2 ? 'bg-warn-solid' : 'bg-ok-solid') : 'bg-surface-3',
              )}
            />
          ))}
        </div>
        <span className="w-24 text-right text-sm font-semibold">{password ? LEVELS[score] : 'Sin escribir'}</span>
      </div>
      <ul className="mt-2.5 grid gap-1 text-sm sm:grid-cols-2">
        {checks.map((c) => (
          <li key={c.id} className={cn('flex items-center gap-1.5', c.ok ? 'text-ok' : 'text-ink-muted')}>
            <Icon name={c.ok ? 'check' : 'x'} size={16} strokeWidth={2.5} />
            <span>
              {c.label}
              <span className="sr-only">{c.ok ? ': cumplido' : ': pendiente'}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
