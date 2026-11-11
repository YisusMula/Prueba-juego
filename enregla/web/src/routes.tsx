import { lazy, Suspense, type ComponentType, type ReactNode } from 'react';
import { Navigate, type RouteObject } from 'react-router';
import { QueryCache, QueryClient } from '@tanstack/react-query';
import { isApiError } from '@/api/client';
import { Root, RouteError } from '@/layouts/Root';
import { RequireAuth, AppIndexRedirect } from '@/layouts/RequireAuth';
import { PageLoader } from '@/layouts/PageLoader';

function page<M, K extends keyof M>(loader: () => Promise<M>, name: K): ReactNode {
  const C = lazy(() => loader().then((m) => ({ default: m[name] as unknown as ComponentType })));
  return (
    <Suspense fallback={<PageLoader />}>
      <C />
    </Suspense>
  );
}

/** Cliente de TanStack Query con los reintentos y tiempos de la app. */
export function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: (count, err) => {
          if (isApiError(err) && err.status > 0 && err.status < 500) return false;
          return count < 2;
        },
        refetchOnWindowFocus: true,
        staleTime: 15_000,
      },
      mutations: { retry: false },
    },
    queryCache: new QueryCache(),
  });
}

const publicPages = () => import('@/pages/public/Landing');
const legalPages = () => import('@/pages/legal/LegalPages');
const authPages = () => import('@/pages/auth/AuthPages');
const appPages = () => import('@/pages/app/AppPages');
const settings = () => import('@/pages/settings/SettingsPages');

/** Rutas de la SPA (las comparten el router del navegador y cualquier otro router). */
export const routes: RouteObject[] = [
  {
    element: <Root />,
    errorElement: <RouteError />,
    children: [
      { path: '/', element: page(publicPages, 'LandingPage') },
      { path: '/aviso-legal', element: page(legalPages, 'LegalNoticePage') },
      { path: '/privacidad', element: page(legalPages, 'PrivacyPage') },
      { path: '/terminos', element: page(legalPages, 'TermsPage') },
      { path: '/cookies', element: page(legalPages, 'CookiesPage') },
      { path: '/carta/:slug', element: page(() => import('@/pages/public/PublicMenu'), 'PublicMenuPage') },

      { path: '/entrar', element: page(authPages, 'LoginPage') },
      { path: '/registro', element: page(authPages, 'RegisterPage') },
      { path: '/revisa-tu-correo', element: page(authPages, 'CheckEmailPage') },
      { path: '/verificar-email', element: page(authPages, 'VerifyEmailPage') },
      { path: '/recuperar-contrasena', element: page(authPages, 'ForgotPasswordPage') },
      { path: '/restablecer-contrasena', element: page(authPages, 'ResetPasswordPage') },
      { path: '/confirmar-email', element: page(authPages, 'ConfirmEmailChangePage') },
      { path: '/invitacion', element: page(authPages, 'InvitationPage') },

      { path: '/cocina', element: page(() => import('@/pages/kiosk/Kiosk'), 'KioskPage') },
      { path: '/cocina/vincular', element: page(() => import('@/pages/kiosk/KioskPair'), 'KioskPairPage') },

      {
        element: <RequireAuth />,
        children: [
          { path: '/app', element: <AppIndexRedirect /> },
          { path: '/nuevo-local', element: page(() => import('@/pages/onboarding/Onboarding'), 'OnboardingPage') },
          {
            path: '/locales/:orgId',
            element: page(() => import('@/layouts/OrgLayout'), 'OrgLayout'),
            children: [
              { index: true, element: <Navigate to="hoy" replace /> },
              { path: 'hoy', element: page(appPages, 'TodayPage') },
              { path: 'registrar', element: page(() => import('@/pages/app/RecordPages'), 'RegisterHubPage') },
              { path: 'registrar/:type', element: page(() => import('@/pages/app/RecordPages'), 'RegisterTypePage') },
              { path: 'historial', element: page(() => import('@/pages/app/HistoryPages'), 'HistoryPage') },
              { path: 'historial/:recordId', element: page(() => import('@/pages/app/HistoryPages'), 'RecordDetailPage') },
              { path: 'alergenos', element: page(() => import('@/pages/app/Allergens'), 'AllergensPage') },
              { path: 'alergenos/imprimir', element: page(() => import('@/pages/app/Allergens'), 'AllergensPrintPage') },
              { path: 'informes', element: page(appPages, 'ReportsPage') },
              { path: 'facturacion', element: page(settings, 'BillingPage') },
              { path: 'ajustes', element: page(settings, 'SettingsHubPage') },
              { path: 'ajustes/local', element: page(settings, 'OrgSettingsPage') },
              { path: 'ajustes/equipos', element: page(settings, 'EquipmentSettingsPage') },
              { path: 'ajustes/limpieza', element: page(settings, 'CleaningSettingsPage') },
              { path: 'ajustes/proveedores', element: page(settings, 'SuppliersSettingsPage') },
              { path: 'ajustes/personal', element: page(settings, 'StaffSettingsPage') },
              { path: 'ajustes/cocina', element: page(settings, 'DevicesSettingsPage') },
              { path: 'ajustes/equipo', element: page(settings, 'TeamSettingsPage') },
              { path: 'ajustes/auditoria', element: page(settings, 'AuditPage') },
              { path: 'ajustes/datos', element: page(settings, 'DataSettingsPage') },
              { path: 'ajustes/cuenta', element: page(settings, 'AccountSettingsPage') },
            ],
          },
        ],
      },
      { path: '*', element: page(() => import('@/pages/NotFound'), 'NotFoundPage') },
    ],
  },
];
