import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { Logo } from '@/components/ui/Logo';
import { Icon } from '@/components/icons/Icon';
import { APP_NAME } from '@/config/brand';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';

const POINTS = [
  { icon: 'thermometer', text: 'Temperaturas en tres toques desde la tablet de cocina' },
  { icon: 'today', text: 'De un vistazo: qué falta hoy y qué está fuera de rango' },
  { icon: 'report', text: 'Informe PDF listo cuando llega la inspección' },
] as const;

export function AuthLayout({ title, subtitle, children, docTitle }: { title: ReactNode; subtitle?: ReactNode; children: ReactNode; docTitle: string }) {
  useDocumentTitle(docTitle);
  return (
    <div className="grid min-h-dvh lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
      <aside className="relative hidden overflow-hidden bg-brand-strong text-white lg:flex lg:flex-col lg:justify-between lg:p-12 dark:bg-[#0a2f33]">
        <TilePattern />
        <Link to="/" className="relative z-10 text-white [&_rect]:fill-white/15">
          <Logo />
        </Link>
        <div className="relative z-10 max-w-md">
          <p className="font-display text-4xl leading-tight font-extrabold">Los registros de cocina, sin papeles ni carpetas grasientas.</p>
          <ul className="mt-8 space-y-4">
            {POINTS.map((p) => (
              <li key={p.text} className="flex items-start gap-3 text-lg text-white/90">
                <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-white/12">
                  <Icon name={p.icon} size={22} />
                </span>
                <span className="pt-1.5">{p.text}</span>
              </li>
            ))}
          </ul>
        </div>
        <p className="relative z-10 text-sm text-white/70">
          {APP_NAME} te ayuda a llevar los registros al día. Las plantillas son orientativas: adáptalas a tu plan de autocontrol.
        </p>
      </aside>
      <main id="main" tabIndex={-1} className="flex flex-col px-4 py-6 outline-none sm:px-8 lg:justify-center lg:py-12">
        <Link to="/" className="mb-8 self-start lg:hidden">
          <Logo />
        </Link>
        <div className="mx-auto w-full max-w-md">
          <h1 className="text-3xl font-extrabold sm:text-4xl">{title}</h1>
          {subtitle ? <p className="mt-2 text-lg text-ink-muted">{subtitle}</p> : null}
          <div className="mt-7">{children}</div>
        </div>
      </main>
    </div>
  );
}

/** Patrón de azulejos de cocina (decorativo). */
export function TilePattern() {
  return (
    <svg aria-hidden="true" className="absolute inset-0 h-full w-full opacity-[0.09]">
      <defs>
        <pattern id="tiles" width="56" height="56" patternUnits="userSpaceOnUse">
          <rect x="2" y="2" width="52" height="52" rx="10" fill="none" stroke="#fff" strokeWidth="2" />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#tiles)" />
    </svg>
  );
}
