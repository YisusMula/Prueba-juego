import type { ElementType, ReactNode } from 'react';
import { cn } from '@/lib/cn';

export function Card({ children, className, as: As = 'section', ...rest }: { children: ReactNode; className?: string; as?: ElementType } & Record<string, unknown>) {
  return (
    <As className={cn('rounded-2xl border border-line bg-surface p-4 shadow-card sm:p-5', className)} {...rest}>
      {children}
    </As>
  );
}

export function PageHeader({ title, subtitle, actions, eyebrow }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; eyebrow?: ReactNode }) {
  return (
    <header className="mb-5 flex flex-col gap-3 sm:mb-7 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {eyebrow ? <p className="mb-1 text-sm font-bold tracking-wide text-brand uppercase">{eyebrow}</p> : null}
        <h1 className="text-[1.75rem] font-extrabold sm:text-4xl">{title}</h1>
        {subtitle ? <p className="mt-1 text-ink-muted">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2 sm:shrink-0 [&>*]:whitespace-nowrap">{actions}</div> : null}
    </header>
  );
}

export function SectionTitle({ children, action, id }: { children: ReactNode; action?: ReactNode; id?: string }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-3">
      <h2 id={id} className="text-xl font-bold">
        {children}
      </h2>
      {action}
    </div>
  );
}

/** Lista de definición compacta para detalles. */
export function DetailList({ items }: { items: { label: ReactNode; value: ReactNode }[] }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
      {items.map((it, i) => (
        <div key={i} className="min-w-0">
          <dt className="text-sm text-ink-muted">{it.label}</dt>
          <dd className="font-semibold break-words">{it.value}</dd>
        </div>
      ))}
    </dl>
  );
}
