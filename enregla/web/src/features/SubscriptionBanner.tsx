import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { useOrgContext } from '@/hooks/useOrgContext';
import { Icon } from '@/components/icons/Icon';
import { buttonClasses } from '@/components/ui/Button';
import { relativeDays } from '@/lib/format';
import type { SubscriptionStatus } from '@/api/types';

export const STATUS_LABELS: Record<SubscriptionStatus, string> = {
  trialing: 'En periodo de prueba',
  trial_expired: 'Prueba terminada',
  active: 'Suscripción activa',
  past_due: 'Pago pendiente',
  unpaid: 'Impagada',
  canceled: 'Cancelada',
  incomplete: 'Pago sin completar',
  incomplete_expired: 'Pago caducado',
  paused: 'En pausa',
};

/** Aviso persistente de solo lectura (402) o de prueba a punto de terminar. */
export function SubscriptionBanner() {
  const { org, readOnly, isOwner, path } = useOrgContext();
  const sub = org.subscription;
  if (readOnly) {
    return (
      <div role="status" className="border-b border-bad/30 bg-bad-soft px-4 py-3 sm:px-6 lg:px-10" data-testid="read-only-banner">
        <div className="mx-auto flex max-w-5xl flex-col gap-3 sm:flex-row sm:items-center">
          <Icon name="lock" size={22} className="shrink-0 text-bad" />
          <p className="flex-1 text-ink">
            <strong>Modo solo lectura</strong> ({STATUS_LABELS[sub.status].toLowerCase()}). Puedes consultar el historial y descargar
            informes, pero no añadir ni cambiar registros.{' '}
            {isOwner ? null : 'Pide a la persona propietaria del local que active la suscripción.'}
          </p>
          {isOwner ? (
            <Link to={path('facturacion')} className={buttonClasses('danger', 'md', 'shrink-0')}>
              <Icon name="card" size={20} /> Activar suscripción
            </Link>
          ) : null}
        </div>
      </div>
    );
  }
  if (sub.status === 'trialing' && !sub.hasBillingAccount) {
    const days = relativeDays(sub.trialEndsAt);
    if (days <= 3) {
      return (
        <div role="status" className="border-b border-warn/30 bg-warn-soft px-4 py-2.5 sm:px-6 lg:px-10">
          <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-3 gap-y-2">
            <Icon name="clock" size={20} className="text-warn" />
            <p className="flex-1 text-ink">
              {days <= 0 ? 'Tu prueba gratuita termina hoy.' : `Te ${days === 1 ? 'queda 1 día' : `quedan ${days} días`} de prueba gratuita.`}
            </p>
            {isOwner ? (
              <Link to={path('facturacion')} className="font-semibold text-brand-strong underline underline-offset-4 dark:text-brand">
                Elegir plan
              </Link>
            ) : null}
          </div>
        </div>
      );
    }
  }
  return null;
}

/**
 * Envuelve formularios de alta/edición: en solo lectura los deshabilita y explica por qué.
 */
export function WriteGuard({ children, what = 'añadir ni cambiar datos' }: { children: ReactNode; what?: string }) {
  const { readOnly, isOwner, path } = useOrgContext();
  if (!readOnly) return <>{children}</>;
  return (
    <div>
      <div className="mb-4 flex flex-col gap-2 rounded-2xl border border-bad/30 bg-bad-soft p-4 sm:flex-row sm:items-center" data-testid="write-guard">
        <Icon name="lock" size={22} className="shrink-0 text-bad" />
        <p className="flex-1">
          El local está en solo lectura: ahora no se puede {what}.{' '}
          {isOwner ? (
            <Link to={path('facturacion')} className="font-semibold underline underline-offset-4">
              Activa la suscripción
            </Link>
          ) : (
            'La persona propietaria puede activar la suscripción.'
          )}
        </p>
      </div>
      <fieldset disabled aria-disabled="true" className="opacity-60">
        {children}
      </fieldset>
    </div>
  );
}
