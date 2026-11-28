import { PublicLayout } from '@/layouts/PublicLayout';
import { LinkButton } from '@/components/ui/Button';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';

export function NotFoundPage() {
  useDocumentTitle('Página no encontrada');
  return (
    <PublicLayout>
      <div className="mx-auto flex max-w-xl flex-col items-center px-4 py-20 text-center">
        <svg width="140" height="140" viewBox="0 0 140 140" aria-hidden="true">
          <circle cx="70" cy="70" r="64" fill="var(--brand-soft)" />
          <path d="M78 86V34a8 8 0 10-16 0v52a16 16 0 1016 0z" fill="var(--surface)" stroke="var(--brand)" strokeWidth="5" />
          <circle cx="70" cy="99" r="9" fill="var(--warn-solid)" />
          <path d="M70 90V62" stroke="var(--warn-solid)" strokeWidth="6" strokeLinecap="round" />
        </svg>
        <p className="mt-6 font-display text-6xl font-extrabold text-brand">404</p>
        <h1 className="mt-2 text-3xl font-extrabold">Esta página no existe</h1>
        <p className="mt-2 text-lg text-ink-muted">Puede que el enlace esté mal escrito o que la página se haya movido.</p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <LinkButton to="/app">Ir a mi panel</LinkButton>
          <LinkButton to="/" variant="secondary">
            Inicio
          </LinkButton>
        </div>
      </div>
    </PublicLayout>
  );
}
