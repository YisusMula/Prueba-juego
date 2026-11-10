import { useEffect, useMemo, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate, useParams } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { useAccount, useOrg } from '@/api/queries';
import { api, isApiError } from '@/api/client';
import { OrgContext, useOrgContext, type OrgCtx } from '@/hooks/useOrgContext';
import { Icon, type IconName } from '@/components/icons/Icon';
import { Logo, LogoMark } from '@/components/ui/Logo';
import { ErrorState, EmptyState } from '@/components/ui/Feedback';
import { LinkButton, buttonClasses } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Overlay';
import { storage } from '@/lib/storage';
import { cn } from '@/lib/cn';
import { PageLoader } from './PageLoader';
import { SubscriptionBanner } from '@/features/SubscriptionBanner';
import { APP_NAME } from '@/config/brand';

type NavItem = { to: string; label: string; icon: IconName; end?: boolean };

const NAV: NavItem[] = [
  { to: 'hoy', label: 'Hoy', icon: 'today' },
  { to: 'registrar', label: 'Registrar', icon: 'plus' },
  { to: 'historial', label: 'Historial', icon: 'history' },
  { to: 'alergenos', label: 'Alérgenos', icon: 'utensils' },
  { to: 'informes', label: 'Informes', icon: 'report' },
  { to: 'ajustes', label: 'Ajustes', icon: 'settings' },
];

const MOBILE_NAV: NavItem[] = [
  { to: 'hoy', label: 'Hoy', icon: 'today' },
  { to: 'historial', label: 'Historial', icon: 'history' },
  { to: 'registrar', label: 'Registrar', icon: 'plus' },
  { to: 'informes', label: 'Informes', icon: 'report' },
  { to: 'ajustes', label: 'Más', icon: 'menu' },
];

function useLogout() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  return async () => {
    try {
      await api.post('/api/auth/logout');
    } catch {
      // aunque falle, se limpia el estado local
    }
    storage.setSessionHint(false);
    qc.clear();
    navigate('/entrar?salida=1', { replace: true });
  };
}

function OrgSwitcher({ compact }: { compact?: boolean }) {
  const { org } = useOrgContext();
  const account = useAccount();
  const [open, setOpen] = useState(false);
  const orgs = account.data?.organizations ?? [];
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          'flex min-h-12 w-full min-w-0 items-center gap-2 rounded-xl text-left hover:bg-surface-2',
          compact ? 'px-2' : 'border border-line bg-surface px-3 py-2',
        )}
        aria-haspopup="dialog"
      >
        <Icon name="store" size={20} className="shrink-0 text-brand" />
        <span className="min-w-0 flex-1">
          <span className="sr-only">Local actual: </span>
          <span className="block truncate font-bold" title={org.name}>
            {org.name}
          </span>
          {!compact ? (
            <span className="block truncate text-xs text-ink-muted">
              {org.deletionScheduledAt ? 'Pendiente de eliminación' : org.role === 'owner' ? 'Propietario' : 'Encargado'} · cambiar
            </span>
          ) : null}
        </span>
        <Icon name="chevronDown" size={18} className="shrink-0 text-ink-muted" />
      </button>
      <Dialog open={open} onClose={() => setOpen(false)} title="Tus locales" size="sm">
        <ul className="space-y-2">
          {orgs.map((o) => (
            <li key={o.id}>
              <Link
                to={`/locales/${o.id}/hoy`}
                onClick={() => setOpen(false)}
                aria-current={o.id === org.id ? 'true' : undefined}
                className={cn(
                  'flex min-h-14 items-center gap-3 rounded-xl border px-4 font-semibold',
                  o.id === org.id ? 'border-brand bg-brand-soft' : 'border-line hover:bg-surface-2',
                )}
              >
                <Icon name="store" size={20} className="shrink-0" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate" title={o.name}>
                    {o.name}
                  </span>
                  {o.deletionScheduledAt ? (
                    <span className="block text-sm font-normal text-bad">Pendiente de eliminación · solo lectura</span>
                  ) : o.subscription.readOnly ? (
                    <span className="block text-sm font-normal text-ink-muted">Solo lectura</span>
                  ) : null}
                </span>
                {o.id === org.id ? <Icon name="check" size={20} className="shrink-0" /> : null}
              </Link>
            </li>
          ))}
        </ul>
        <Link to="/nuevo-local" onClick={() => setOpen(false)} className={buttonClasses('secondary', 'md', 'mt-4 w-full')}>
          <Icon name="plus" size={20} /> Añadir otro local
        </Link>
      </Dialog>
    </>
  );
}

function Sidebar() {
  const { path } = useOrgContext();
  const account = useAccount();
  const logout = useLogout();
  return (
    <aside className="sticky top-0 hidden h-dvh w-72 shrink-0 flex-col border-r border-line bg-surface/70 px-4 py-5 lg:flex">
      <Link to={path('hoy')} className="mb-5 px-2" aria-label={`${APP_NAME}: ir a Hoy`}>
        <Logo />
      </Link>
      <OrgSwitcher />
      <nav aria-label="Principal" className="mt-5 flex-1 space-y-1">
        {NAV.map((item) => (
          <NavLink
            key={item.to}
            to={path(item.to)}
            className={({ isActive }) =>
              cn(
                'flex min-h-12 items-center gap-3 rounded-xl px-3 font-semibold transition-colors',
                isActive ? 'bg-brand text-on-brand shadow-card' : 'text-ink hover:bg-surface-2',
              )
            }
          >
            <Icon name={item.icon} size={22} />
            {item.label}
          </NavLink>
        ))}
      </nav>
      <div className="space-y-1 border-t border-line pt-4">
        <Link to="/cocina" className="flex min-h-12 items-center gap-3 rounded-xl px-3 font-semibold hover:bg-surface-2">
          <Icon name="chef" size={22} /> Modo cocina
        </Link>
        <NavLink
          to={path('ajustes/cuenta')}
          className={({ isActive }) => cn('flex min-h-12 items-center gap-3 rounded-xl px-3 hover:bg-surface-2', isActive && 'bg-surface-2')}
        >
          <Icon name="user" size={22} />
          <span className="min-w-0 flex-1 truncate">{account.data?.user.name ?? 'Mi cuenta'}</span>
        </NavLink>
        <button type="button" onClick={() => void logout()} className="flex min-h-12 w-full items-center gap-3 rounded-xl px-3 text-left hover:bg-surface-2">
          <Icon name="logout" size={22} /> Cerrar sesión
        </button>
      </div>
    </aside>
  );
}

function MobileTopBar() {
  return (
    <header className="sticky top-0 z-30 flex items-center gap-2 border-b border-line bg-paper/95 px-3 py-2 backdrop-blur lg:hidden">
      <LogoMark size={32} className="shrink-0" />
      <div className="min-w-0 flex-1">
        <OrgSwitcher compact />
      </div>
      <Link to="/cocina" className="grid size-12 shrink-0 place-items-center rounded-xl hover:bg-surface-2" aria-label="Modo cocina" title="Modo cocina">
        <Icon name="chef" size={24} />
      </Link>
    </header>
  );
}

function MobileNav() {
  const { path } = useOrgContext();
  return (
    <nav
      aria-label="Principal"
      className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden no-print"
    >
      <ul className="mx-auto grid max-w-xl grid-cols-5">
        {MOBILE_NAV.map((item) => (
          <li key={item.to}>
            <NavLink
              to={path(item.to)}
              className={({ isActive }) =>
                cn('flex min-h-16 flex-col items-center justify-center gap-0.5 text-xs font-semibold', isActive ? 'text-brand' : 'text-ink-muted')
              }
            >
              {({ isActive }) =>
                item.to === 'registrar' ? (
                  <>
                    <span className={cn('grid size-11 place-items-center rounded-2xl bg-brand text-on-brand shadow-card', isActive && 'ring-2 ring-brand ring-offset-2 ring-offset-surface')}>
                      <Icon name="plus" size={26} strokeWidth={2.5} />
                    </span>
                    <span className="sr-only">{item.label}</span>
                  </>
                ) : (
                  <>
                    <span className={cn('grid h-8 w-14 place-items-center rounded-full', isActive && 'bg-brand-soft')}>
                      <Icon name={item.icon} size={22} />
                    </span>
                    {item.label}
                  </>
                )
              }
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}

export function OrgLayout() {
  const { orgId = '' } = useParams();
  const org = useOrg(orgId);
  const location = useLocation();

  useEffect(() => {
    if (org.data) storage.setLastOrg(org.data.id);
  }, [org.data]);

  const ctx = useMemo<OrgCtx | null>(() => {
    if (!org.data) return null;
    return {
      org: org.data,
      orgId: org.data.id,
      readOnly: org.data.subscription.readOnly,
      isOwner: org.data.role === 'owner',
      tz: org.data.timezone,
      path: (sub?: string) => `/locales/${org.data.id}${sub ? `/${sub}` : ''}`,
    };
  }, [org.data]);

  if (org.isPending) return <PageLoader />;
  if (org.isError || !ctx) {
    const notFound = isApiError(org.error) && org.error.code === 'NOT_FOUND';
    return (
      <main id="main" tabIndex={-1} className="mx-auto max-w-lg px-4 py-16">
        {notFound ? (
          <EmptyState icon="store" title="Este local no existe o no tienes acceso" action={<LinkButton to="/app">Ir a mis locales</LinkButton>}>
            Puede que te hayan quitado el acceso o que el enlace sea incorrecto.
          </EmptyState>
        ) : (
          <ErrorState error={org.error} onRetry={() => void org.refetch()} />
        )}
      </main>
    );
  }

  const printView = location.pathname.endsWith('/imprimir');
  if (printView) {
    return (
      <OrgContext.Provider value={ctx}>
        <main id="main" tabIndex={-1} className="outline-none">
          <Outlet />
        </main>
      </OrgContext.Provider>
    );
  }

  return (
    <OrgContext.Provider value={ctx}>
      <div className="flex min-h-dvh">
        <Sidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          <MobileTopBar />
          <SubscriptionBanner />
          <main id="main" tabIndex={-1} className="mx-auto w-full max-w-5xl flex-1 px-4 pt-5 pb-28 outline-none sm:px-6 lg:px-10 lg:pt-9 lg:pb-12">
            <Outlet />
          </main>
        </div>
      </div>
      <MobileNav />
    </OrgContext.Provider>
  );
}

export { useLogout };
