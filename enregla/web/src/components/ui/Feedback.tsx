import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { Icon, type IconName } from '@/components/icons/Icon';
import { errorMessage, isApiError } from '@/api/client';

export function Spinner({ size = 20, label }: { size?: number; label?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      className="animate-spin motion-reduce:animate-none"
      role={label ? 'status' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M21 12a9 9 0 00-9-9" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('skeleton', className)} aria-hidden="true" />;
}

/** Bloque de carga accesible con esqueletos. */
export function LoadingBlock({ rows = 3, label = 'Cargando…' }: { rows?: number; label?: string }) {
  return (
    <div role="status" aria-live="polite" className="space-y-3">
      <span className="sr-only">{label}</span>
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className={cn('h-16 w-full', i === 0 && 'h-20')} />
      ))}
    </div>
  );
}

export type Tone = 'ok' | 'warn' | 'bad' | 'info' | 'neutral' | 'brand';

const toneBox: Record<Tone, string> = {
  ok: 'bg-ok-soft text-ok border-ok/30',
  warn: 'bg-warn-soft text-warn border-warn/30',
  bad: 'bg-bad-soft text-bad border-bad/30',
  info: 'bg-brand-soft text-brand-strong border-brand/25 dark:text-brand',
  brand: 'bg-brand-soft text-brand-strong border-brand/25 dark:text-brand',
  neutral: 'bg-surface-2 text-ink border-line',
};
const toneIcon: Record<Tone, IconName> = { ok: 'check', warn: 'alert', bad: 'alert', info: 'info', brand: 'info', neutral: 'info' };

export function Callout({
  tone = 'info',
  title,
  children,
  icon,
  action,
  className,
  live,
}: {
  tone?: Tone;
  title?: ReactNode;
  children?: ReactNode;
  icon?: IconName;
  action?: ReactNode;
  className?: string;
  /** Anunciar a lectores de pantalla (avisos que aparecen tras una acción). */
  live?: 'polite' | 'assertive';
}) {
  return (
    <div
      className={cn('flex flex-col gap-3 rounded-2xl border p-4 sm:flex-row sm:items-start', toneBox[tone], className)}
      role={live === 'assertive' ? 'alert' : live ? 'status' : undefined}
    >
      <Icon name={icon ?? toneIcon[tone]} size={22} className="mt-0.5 shrink-0" />
      <div className="min-w-0 flex-1 text-ink">
        {title ? <p className="font-bold">{title}</p> : null}
        {children ? <div className={cn('text-[0.95rem]', title ? 'mt-0.5' : '')}>{children}</div> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

const badgeTone: Record<Tone, string> = {
  ok: 'bg-ok-soft text-ok',
  warn: 'bg-warn-soft text-warn',
  bad: 'bg-bad-soft text-bad',
  info: 'bg-brand-soft text-brand-strong dark:text-brand',
  brand: 'bg-brand text-on-brand',
  neutral: 'bg-surface-2 text-ink-muted',
};

/** Etiqueta de estado: SIEMPRE con texto (y normalmente icono), nunca solo color. */
export function Badge({ tone = 'neutral', icon, children, className }: { tone?: Tone; icon?: IconName; children: ReactNode; className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-sm font-semibold whitespace-nowrap', badgeTone[tone], className)}>
      {icon ? <Icon name={icon} size={15} strokeWidth={2.5} /> : null}
      {children}
    </span>
  );
}

export function EmptyState({
  icon = 'leaf',
  title,
  children,
  action,
}: {
  icon?: IconName;
  title: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center rounded-2xl border border-dashed border-line-strong bg-surface/60 px-6 py-10 text-center">
      <span className="mb-3 grid size-14 place-items-center rounded-2xl bg-brand-soft text-brand-strong dark:text-brand">
        <Icon name={icon} size={28} />
      </span>
      <h3 className="text-lg font-bold">{title}</h3>
      {children ? <div className="mt-1 max-w-md text-ink-muted">{children}</div> : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}

export function ErrorState({ error, onRetry, title = 'No hemos podido cargar esto' }: { error: unknown; onRetry?: () => void; title?: string }) {
  const offline = isApiError(error) && error.code === 'NETWORK_ERROR';
  return (
    <div role="alert" className="flex flex-col items-center rounded-2xl border border-bad/30 bg-bad-soft/50 px-6 py-10 text-center">
      <span className="mb-3 grid size-14 place-items-center rounded-2xl bg-bad-soft text-bad">
        <Icon name={offline ? 'wifiOff' : 'alert'} size={28} />
      </span>
      <h3 className="text-lg font-bold">{offline ? 'Sin conexión' : title}</h3>
      <p className="mt-1 max-w-md text-ink-muted">{errorMessage(error)}</p>
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="mt-5 inline-flex min-h-12 items-center gap-2 rounded-xl border border-line-strong bg-surface px-5 font-semibold hover:bg-surface-2"
        >
          <Icon name="refresh" size={20} /> Reintentar
        </button>
      ) : null}
    </div>
  );
}

/** Anillo de progreso (SVG). El porcentaje también se da en texto. */
export function ProgressRing({ percent, size = 112, stroke = 12, label }: { percent: number; size?: number; stroke?: number; label?: string }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const p = Math.max(0, Math.min(100, percent));
  const color = p >= 100 ? 'var(--ok-solid)' : p >= 50 ? 'var(--brand)' : 'var(--warn-solid)';
  return (
    <div className="relative inline-grid place-items-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true" className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--surface-3)" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - p / 100)}
          className="transition-[stroke-dashoffset] duration-700 ease-out"
        />
      </svg>
      <div className="absolute inset-0 grid place-items-center text-center">
        <span className="font-display text-2xl font-bold tabular">{Math.round(p)}%</span>
      </div>
      {label ? <span className="sr-only">{label}</span> : null}
    </div>
  );
}

export function ProgressBar({ value, max, label }: { value: number; max: number; label: string }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <div>
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={value}
        className="h-2.5 w-full overflow-hidden rounded-full bg-surface-3"
      >
        <div className={cn('h-full rounded-full transition-[width] duration-500', pct >= 100 ? 'bg-ok-solid' : 'bg-brand')} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
