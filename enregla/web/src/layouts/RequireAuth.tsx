import { Navigate, Outlet, useLocation } from 'react-router';
import { useAccount } from '@/api/queries';
import { isApiError } from '@/api/client';
import { ErrorState } from '@/components/ui/Feedback';
import { storage } from '@/lib/storage';
import { loginPath } from '@/lib/redirect';
import { PageLoader } from './PageLoader';

export function RequireAuth() {
  const location = useLocation();
  const account = useAccount();
  if (account.isPending) return <PageLoader />;
  if (account.isError) {
    if (isApiError(account.error) && account.error.code === 'UNAUTHENTICATED') {
      storage.setSessionHint(false);
      return <Navigate to={loginPath(location.pathname + location.search)} replace />;
    }
    return (
      <main id="main" tabIndex={-1} className="mx-auto max-w-lg px-4 py-16">
        <ErrorState error={account.error} onRetry={() => void account.refetch()} />
      </main>
    );
  }
  storage.setSessionHint(true);
  return <Outlet />;
}

/** /app → último local usado, el primero, o el alta guiada si no hay ninguno. */
export function AppIndexRedirect() {
  const account = useAccount();
  const orgs = account.data?.organizations ?? [];
  if (orgs.length === 0) return <Navigate to="/nuevo-local" replace />;
  const last = storage.getLastOrg();
  const target = orgs.find((o) => o.id === last) ?? orgs[0]!;
  return <Navigate to={`/locales/${target.id}/hoy`} replace />;
}
