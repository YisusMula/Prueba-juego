import { useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { Logo } from '@/components/ui/Logo';
import { LinkButton } from '@/components/ui/Button';
import { Icon } from '@/components/icons/Icon';
import { APP_NAME } from '@/config/brand';
import { storage } from '@/lib/storage';
import { cn } from '@/lib/cn';

export function PublicHeader({ landing }: { landing?: boolean }) {
  const [open, setOpen] = useState(false);
  const hasSession = storage.hasSessionHint();
  const links = landing
    ? [
        { href: '#como-funciona', label: 'Cómo funciona' },
        { href: '#funciones', label: 'Funciones' },
        { href: '#precios', label: 'Precios' },
        { href: '#preguntas', label: 'Preguntas' },
      ]
    : [];
  return (
    <header className="sticky top-0 z-40 border-b border-line/70 bg-paper/90 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-4 px-4 sm:px-6">
        <Link to="/" aria-label={`${APP_NAME}, inicio`} className="shrink-0">
          <Logo size={34} />
        </Link>
        {links.length ? (
          <nav aria-label="Secciones" className="ml-6 hidden flex-1 items-center gap-1 md:flex">
            {links.map((l) => (
              <a key={l.href} href={l.href} className="rounded-lg px-3 py-2 font-semibold text-ink-muted hover:bg-surface-2 hover:text-ink">
                {l.label}
              </a>
            ))}
          </nav>
        ) : (
          <div className="flex-1" />
        )}
        <div className="ml-auto hidden items-center gap-2 sm:flex">
          {hasSession ? (
            <LinkButton to="/app" icon="today">
              Ir a mi panel
            </LinkButton>
          ) : (
            <>
              <LinkButton to="/entrar" variant="ghost">
                Entrar
              </LinkButton>
              <LinkButton to="/registro">Pruébalo gratis</LinkButton>
            </>
          )}
        </div>
        <button
          type="button"
          className="ml-auto grid size-12 place-items-center rounded-xl hover:bg-surface-2 sm:hidden"
          aria-expanded={open}
          aria-controls="menu-movil"
          aria-label={open ? 'Cerrar menú' : 'Abrir menú'}
          onClick={() => setOpen((o) => !o)}
        >
          <Icon name={open ? 'x' : 'menu'} size={26} />
        </button>
      </div>
      <div id="menu-movil" hidden={!open} className="border-t border-line bg-paper px-4 pt-2 pb-5 sm:hidden">
        <nav aria-label="Menú" className="flex flex-col">
          {links.map((l) => (
            <a key={l.href} href={l.href} onClick={() => setOpen(false)} className="flex min-h-12 items-center border-b border-line font-semibold">
              {l.label}
            </a>
          ))}
        </nav>
        <div className="mt-4 grid gap-2">
          {hasSession ? (
            <LinkButton to="/app" size="lg" block>
              Ir a mi panel
            </LinkButton>
          ) : (
            <>
              <LinkButton to="/registro" size="lg" block>
                Pruébalo 14 días gratis
              </LinkButton>
              <LinkButton to="/entrar" variant="secondary" size="lg" block>
                Entrar
              </LinkButton>
            </>
          )}
        </div>
      </div>
    </header>
  );
}

export function PublicFooter() {
  return (
    <footer className="border-t border-line bg-surface-2/50">
      <div className="mx-auto grid max-w-6xl gap-8 px-4 py-10 sm:px-6 md:grid-cols-[2fr_1fr_1fr]">
        <div>
          <Logo size={30} />
          <p className="mt-3 max-w-md text-sm text-ink-muted">
            {APP_NAME} te ayuda a llevar al día los registros de autocontrol de tu cocina. Las plantillas y rangos que incluye son orientativos:
            revísalos y adáptalos al plan de autocontrol de tu local. La herramienta no sustituye a tu plan APPCC ni garantiza por sí misma el
            cumplimiento de la normativa.
          </p>
        </div>
        <nav aria-label="Producto" className="text-sm">
          <p className="mb-2 font-bold">Producto</p>
          <ul className="space-y-1">
            <li><Link className={footerLink} to="/registro">Crear cuenta</Link></li>
            <li><Link className={footerLink} to="/entrar">Entrar</Link></li>
            <li><Link className={footerLink} to="/cocina">Modo cocina (tablet)</Link></li>
          </ul>
        </nav>
        <nav aria-label="Legal" className="text-sm">
          <p className="mb-2 font-bold">Legal</p>
          <ul className="space-y-1">
            <li><Link className={footerLink} to="/aviso-legal">Aviso legal</Link></li>
            <li><Link className={footerLink} to="/privacidad">Privacidad</Link></li>
            <li><Link className={footerLink} to="/terminos">Términos</Link></li>
            <li><Link className={footerLink} to="/cookies">Cookies</Link></li>
          </ul>
        </nav>
      </div>
      <p className="border-t border-line py-4 text-center text-xs text-ink-muted">
        © {new Date().getFullYear()} {APP_NAME}
      </p>
    </footer>
  );
}

const footerLink = 'inline-flex min-h-10 items-center text-ink-muted hover:text-ink hover:underline';

export function PublicLayout({ children, landing, className }: { children: ReactNode; landing?: boolean; className?: string }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <PublicHeader landing={landing} />
      <main id="main" tabIndex={-1} className={cn('flex-1 outline-none', className)}>
        {children}
      </main>
      <PublicFooter />
    </div>
  );
}
