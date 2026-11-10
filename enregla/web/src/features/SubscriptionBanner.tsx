import { useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { useOrgContext } from '@/hooks/useOrgContext';
import { Icon } from '@/components/icons/Icon';
import { Button, buttonClasses } from '@/components/ui/Button';
import { Callout } from '@/components/ui/Feedback';
import { Field, Input, PasswordInput } from '@/components/ui/Form';
import { Dialog, useToast } from '@/components/ui/Overlay';
import { api, errorMessage } from '@/api/client';
import { keys } from '@/api/queries';
import type { Organization, SubscriptionStatus } from '@/api/types';
import { formatLocalDate, localDateIn, relativeDays } from '@/lib/format';
import { storage } from '@/lib/storage';

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

/** Abre el portal de pago de Stripe (cambiar tarjeta, facturas). */
export async function openBillingPortal(orgId: string): Promise<void> {
  const r = await api.post<{ url: string }>(`/api/orgs/${orgId}/billing/portal`);
  if (!/^https:\/\//.test(r.url)) throw new Error('URL de pago no válida');
  window.location.assign(r.url);
}

/** Fecha de eliminación definitiva en la zona del local («9 dic 2026»). */
export const deletionDate = (iso: string, tz: string) => formatLocalDate(localDateIn(tz, new Date(iso)));

/** Aviso persistente: local pendiente de eliminación, pago fallido, solo lectura o prueba a punto de terminar. */
export function SubscriptionBanner() {
  const { org, readOnly, isOwner, path } = useOrgContext();
  const sub = org.subscription;
  if (org.deletionScheduledAt) return <DeletionBanner />;
  if (sub.paymentFailed && !readOnly) return <PaymentFailedBanner />;
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

function PaymentFailedBanner() {
  const { orgId, isOwner } = useOrgContext();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div role="status" className="border-b border-warn/30 bg-warn-soft px-4 py-3 sm:px-6 lg:px-10" data-testid="payment-failed-banner">
      <div className="mx-auto flex max-w-5xl flex-col gap-3 sm:flex-row sm:items-center">
        <Icon name="card" size={22} className="shrink-0 text-warn" />
        <p className="flex-1 text-ink">
          <strong>No hemos podido cobrar la suscripción.</strong> Puedes seguir trabajando con normalidad mientras lo reintentamos.{' '}
          {isOwner ? 'Actualiza el método de pago para evitar que el local pase a solo lectura.' : 'Avisa a la persona propietaria del local para que actualice el método de pago.'}
          {error ? <span className="mt-1 block font-semibold text-bad">{error}</span> : null}
        </p>
        {isOwner ? (
          <Button
            variant="secondary"
            icon="external"
            className="shrink-0"
            loading={busy}
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                await openBillingPortal(orgId);
              } catch (err) {
                setError(errorMessage(err));
                setBusy(false);
              }
            }}
          >
            Actualizar el método de pago
          </Button>
        ) : null}
      </div>
    </div>
  );
}

/** Aviso persistente de local pendiente de eliminación, con Restaurar y Eliminar ya (solo propietarios). */
function DeletionBanner() {
  const { org, orgId, isOwner, tz } = useOrgContext();
  const qc = useQueryClient();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [permanentOpen, setPermanentOpen] = useState(false);
  const when = deletionDate(org.deletionScheduledAt!, tz);

  const restore = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await api.post<{ organization: Organization }>(`/api/orgs/${orgId}/restore`);
      qc.setQueryData(keys.org(orgId), r.organization);
      await qc.invalidateQueries({ queryKey: keys.account });
      await qc.invalidateQueries({ queryKey: ['org', orgId] });
      toast.show('Local restaurado: ya no se eliminará');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div role="status" className="border-b border-bad/40 bg-bad-soft px-4 py-3 sm:px-6 lg:px-10" data-testid="deletion-banner">
      <div className="mx-auto flex max-w-5xl flex-col gap-3 lg:flex-row lg:items-center">
        <Icon name="trash" size={22} className="shrink-0 text-bad" />
        <p className="flex-1 text-ink">
          <strong>Este local se eliminará definitivamente el {when}.</strong> Hasta entonces está en solo lectura: puedes consultar el historial,
          descargar informes y exportar los datos.{' '}
          {isOwner ? 'Si cambias de opinión, restáuralo.' : 'Solo una persona propietaria puede restaurarlo.'}
          {error ? <span className="mt-1 block font-semibold text-bad">{error}</span> : null}
        </p>
        {isOwner ? (
          <div className="flex shrink-0 flex-wrap gap-2">
            <Button icon="refresh" onClick={() => void restore()} loading={busy}>
              Restaurar
            </Button>
            <Button variant="ghost" icon="trash" onClick={() => setPermanentOpen(true)}>
              Eliminar ya definitivamente
            </Button>
          </div>
        ) : null}
      </div>
      {permanentOpen ? <PermanentDeleteDialog onClose={() => setPermanentOpen(false)} /> : null}
    </div>
  );
}

/** Eliminación inmediata y definitiva (derecho de supresión): contraseña + nombre exacto del local. */
function PermanentDeleteDialog({ onClose }: { onClose: () => void }) {
  const { org, orgId } = useOrgContext();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [confirmName, setConfirmName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (confirmName.trim() !== org.name) return setError('Escribe el nombre del local exactamente como aparece');
    if (!password) return setError('Escribe tu contraseña');
    setBusy(true);
    setError(null);
    try {
      await api.del(`/api/orgs/${orgId}/permanent`, { password });
      storage.setLastOrg(null);
      qc.removeQueries({ queryKey: keys.org(orgId) });
      await qc.invalidateQueries({ queryKey: keys.account });
      navigate('/app', { replace: true });
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };
  return (
    <Dialog open onClose={onClose} title="Eliminar el local ya, definitivamente" size="sm">
      <form onSubmit={submit} noValidate className="space-y-4">
        <Callout tone="bad">
          Se borrarán ahora mismo «{org.name}» y todos sus registros, sin esperar al plazo de 30 días. <strong>No se puede deshacer.</strong> Si
          necesitas una copia, expórtala antes.
        </Callout>
        <Field label={`Escribe «${org.name}» para confirmar`}>
          <Input value={confirmName} onChange={(e) => setConfirmName(e.target.value)} autoComplete="off" />
        </Field>
        <Field label="Tu contraseña">
          <PasswordInput value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
        </Field>
        {error ? (
          <Callout tone="bad" live="assertive">
            {error}
          </Callout>
        ) : null}
        <Button type="submit" variant="danger" block loading={busy}>
          Eliminar definitivamente
        </Button>
      </form>
    </Dialog>
  );
}

/**
 * Envuelve formularios de alta/edición: en solo lectura los deshabilita y explica por qué.
 */
export function WriteGuard({ children, what = 'añadir ni cambiar datos' }: { children: ReactNode; what?: string }) {
  const { readOnly, isOwner, path, org } = useOrgContext();
  if (!readOnly) return <>{children}</>;
  const pendingDeletion = !!org.deletionScheduledAt;
  return (
    <div>
      <div className="mb-4 flex flex-col gap-2 rounded-2xl border border-bad/30 bg-bad-soft p-4 sm:flex-row sm:items-center" data-testid="write-guard">
        <Icon name="lock" size={22} className="shrink-0 text-bad" />
        <p className="flex-1">
          {pendingDeletion ? `El local está pendiente de eliminación: ahora no se puede ${what}. ` : `El local está en solo lectura: ahora no se puede ${what}. `}
          {pendingDeletion ? (
            isOwner ? 'Restáuralo desde el aviso de arriba para volver a usarlo.' : null
          ) : isOwner ? (
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
