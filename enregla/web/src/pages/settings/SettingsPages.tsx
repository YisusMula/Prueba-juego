import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { changeEmailBody, createDeviceBody, inviteBody, updateAccountBody } from '@shared/schemas';
import { api, errorMessage, isApiError } from '@/api/client';
import { keys, useAccount, useAudit, useBilling, useDevices, useInvitations, useMembers, useMembership } from '@/api/queries';
import type { Billing, Device, Organization, Role } from '@/api/types';
import { useOrgContext } from '@/hooks/useOrgContext';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { useLogout } from '@/layouts/OrgLayout';
import { Button, LinkButton } from '@/components/ui/Button';
import { Badge, Callout, EmptyState, ErrorState, LoadingBlock, Skeleton } from '@/components/ui/Feedback';
import { Card, PageHeader, SectionTitle } from '@/components/ui/Layout';
import { Field, Input, PasswordInput, Select, Switch, zodToFieldErrors } from '@/components/ui/Form';
import { ConfirmDialog, Dialog, useToast } from '@/components/ui/Overlay';
import { QrCode } from '@/components/ui/QrCode';
import { Icon, type IconName } from '@/components/icons/Icon';
import { CleaningManager, EquipmentManager, StaffManager, SupplierManager } from '@/features/ConfigLists';
import { PasswordMeter } from '@/features/PasswordMeter';
import { DownloadButton } from '@/features/DownloadButton';
import { STATUS_LABELS, WriteGuard } from '@/features/SubscriptionBanner';
import { formatDateTime, formatEuros, formatLocalDate, relativeDays } from '@/lib/format';
import { passwordAcceptable } from '@/lib/password';
import { storage } from '@/lib/storage';
import { cn } from '@/lib/cn';

function BackLink() {
  const { path } = useOrgContext();
  return (
    <Link to={path('ajustes')} className="mb-3 inline-flex min-h-11 items-center gap-1 font-semibold text-ink-muted hover:text-ink lg:hidden">
      <Icon name="chevronLeft" size={20} /> Ajustes
    </Link>
  );
}

function SettingsShell({ title, subtitle, children, actions }: { title: string; subtitle?: ReactNode; children: ReactNode; actions?: ReactNode }) {
  useDocumentTitle(title);
  return (
    <>
      <BackLink />
      <PageHeader title={title} subtitle={subtitle} actions={actions} />
      {children}
    </>
  );
}

function OwnerOnly({ children }: { children: ReactNode }) {
  const { isOwner } = useOrgContext();
  if (isOwner) return <>{children}</>;
  return (
    <Callout tone="info" icon="lock" title="Solo para propietarios">
      Esta sección solo la puede gestionar la persona propietaria del local.
    </Callout>
  );
}

// ===========================================================================
// HUB
// ===========================================================================
type HubItem = { to: string; icon: IconName; title: string; text: string; owner?: boolean; external?: boolean };

export function SettingsHubPage() {
  const { path, isOwner, org } = useOrgContext();
  const logout = useLogout();
  useDocumentTitle('Ajustes');
  const groups: { title: string; items: HubItem[] }[] = [
    {
      title: 'Tu local',
      items: [
        { to: 'ajustes/local', icon: 'store', title: 'Datos y recordatorios', text: 'Nombre, zona horaria y aviso diario' },
        { to: 'ajustes/equipos', icon: 'thermometer', title: 'Equipos', text: 'Cámaras, congeladores, vitrinas y freidoras' },
        { to: 'ajustes/limpieza', icon: 'sparkles', title: 'Planes de limpieza', text: 'Zonas y frecuencias' },
        { to: 'ajustes/proveedores', icon: 'truck', title: 'Proveedores', text: 'Para las recepciones de mercancía' },
        { to: 'alergenos', icon: 'utensils', title: 'Carta de alérgenos', text: 'Platos, QR y versión imprimible' },
      ],
    },
    {
      title: 'Personas y dispositivos',
      items: [
        { to: 'ajustes/personal', icon: 'users', title: 'Personal y PIN', text: 'Quién firma en la cocina' },
        { to: 'ajustes/cocina', icon: 'tablet', title: 'Dispositivos de cocina', text: 'Vincular o desvincular tablets' },
        { to: 'ajustes/equipo', icon: 'user', title: 'Encargados e invitaciones', text: 'Quién gestiona el local' },
      ],
    },
    {
      title: 'Cuenta y suscripción',
      items: [
        { to: 'facturacion', icon: 'card', title: 'Facturación', text: STATUS_LABELS[org.subscription.status], owner: true },
        { to: 'informes', icon: 'report', title: 'Informes', text: 'PDF y CSV para la inspección' },
        { to: 'ajustes/auditoria', icon: 'shield', title: 'Registro de actividad', text: 'Quién hizo qué y cuándo', owner: true },
        { to: 'ajustes/datos', icon: 'download', title: 'Exportar o eliminar datos', text: 'Copia completa y baja del local', owner: true },
        { to: 'ajustes/cuenta', icon: 'key', title: 'Mi cuenta', text: 'Nombre, email, contraseña y sesiones' },
      ],
    },
  ];
  return (
    <>
      <PageHeader title="Ajustes" subtitle={org.name} />
      <div className="space-y-7">
        {groups.map((g) => (
          <section key={g.title} aria-labelledby={`g-${g.title}`}>
            <h2 id={`g-${g.title}`} className="mb-2 text-sm font-bold tracking-wide text-ink-muted uppercase">
              {g.title}
            </h2>
            <ul className="grid gap-2 sm:grid-cols-2">
              {g.items
                .filter((i) => !i.owner || isOwner)
                .map((i) => (
                  <li key={i.to}>
                    <Link to={path(i.to)} className="flex min-h-18 items-center gap-3 rounded-2xl border border-line bg-surface p-4 shadow-card hover:border-brand">
                      <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand-strong dark:text-brand">
                        <Icon name={i.icon} size={22} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block font-bold">{i.title}</span>
                        <span className="block text-sm text-ink-muted">{i.text}</span>
                      </span>
                      <Icon name="chevronRight" className="shrink-0 text-ink-muted" />
                    </Link>
                  </li>
                ))}
            </ul>
          </section>
        ))}
        <div className="grid gap-2 sm:grid-cols-2 lg:hidden">
          <LinkButton to="/cocina" variant="secondary" size="lg" icon="chef">
            Abrir modo cocina
          </LinkButton>
          <Button variant="ghost" size="lg" icon="logout" onClick={() => void logout()}>
            Cerrar sesión
          </Button>
        </div>
      </div>
    </>
  );
}

// ===========================================================================
// DATOS DEL LOCAL
// ===========================================================================
const COMMON_TIMEZONES = [
  ['Europe/Madrid', 'Península y Baleares (Europe/Madrid)'],
  ['Atlantic/Canary', 'Canarias (Atlantic/Canary)'],
  ['Africa/Ceuta', 'Ceuta y Melilla (Africa/Ceuta)'],
  ['Europe/Lisbon', 'Portugal (Europe/Lisbon)'],
  ['Europe/Andorra', 'Andorra (Europe/Andorra)'],
] as const;

export function OrgSettingsPage() {
  const { org, orgId, isOwner, readOnly } = useOrgContext();
  const qc = useQueryClient();
  const toast = useToast();
  const [name, setName] = useState(org.name);
  const [timezone, setTimezone] = useState(org.timezone);
  const [reminderEnabled, setReminderEnabled] = useState(org.reminderEnabled);
  const [reminderHour, setReminderHour] = useState(org.reminderHour);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const membership = useMembership(orgId);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return setError('Escribe el nombre del local');
    setError(null);
    setSaving(true);
    try {
      const r = await api.patch<{ organization: Organization }>(`/api/orgs/${orgId}`, { name: name.trim(), timezone, reminderEnabled, reminderHour });
      qc.setQueryData(keys.org(orgId), r.organization);
      await qc.invalidateQueries({ queryKey: keys.account });
      toast.show('Datos del local guardados');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const setPersonal = async (v: boolean) => {
    try {
      await api.patch(`/api/orgs/${orgId}/membership`, { dailyReminder: v });
      await qc.invalidateQueries({ queryKey: keys.orgScoped(orgId, 'membership') });
      toast.show(v ? 'Recibirás el recordatorio diario' : 'Ya no recibirás el recordatorio diario');
    } catch (err) {
      toast.show(errorMessage(err), 'bad');
    }
  };

  const tzOptions = COMMON_TIMEZONES.some(([v]) => v === org.timezone) ? COMMON_TIMEZONES : [...COMMON_TIMEZONES, [org.timezone, org.timezone] as const];

  return (
    <SettingsShell title="Datos y recordatorios">
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <SectionTitle>Datos del local</SectionTitle>
          {!isOwner ? (
            <OwnerOnly>{null}</OwnerOnly>
          ) : (
            <WriteGuard>
              <form onSubmit={save} noValidate className="space-y-4">
                <Field label="Nombre">
                  <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />
                </Field>
                <Field label="Zona horaria" hint="Decide qué es «hoy» para las tareas y cómo se muestran las horas.">
                  <Select value={timezone} onChange={(e) => setTimezone(e.target.value)}>
                    {tzOptions.map(([v, l]) => (
                      <option key={v} value={v}>
                        {l}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Switch
                  checked={reminderEnabled}
                  onChange={setReminderEnabled}
                  label="Recordatorio diario por email"
                  description="Si a la hora indicada quedan tareas pendientes, se avisa a los encargados que lo tengan activado."
                />
                {reminderEnabled ? (
                  <Field label="Hora del recordatorio">
                    <Select value={reminderHour} onChange={(e) => setReminderHour(Number(e.target.value))}>
                      {Array.from({ length: 24 }, (_, h) => (
                        <option key={h} value={h}>
                          {String(h).padStart(2, '0')}:00
                        </option>
                      ))}
                    </Select>
                  </Field>
                ) : null}
                {error ? <Callout tone="bad" live="assertive">{error}</Callout> : null}
                <Button type="submit" loading={saving}>
                  Guardar cambios
                </Button>
              </form>
            </WriteGuard>
          )}
        </Card>
        <Card>
          <SectionTitle>Mis avisos</SectionTitle>
          {membership.isPending ? (
            <Skeleton className="h-14" />
          ) : membership.isError ? (
            <ErrorState error={membership.error} onRetry={() => void membership.refetch()} />
          ) : (
            <Switch
              checked={membership.data.dailyReminder}
              onChange={(v) => void setPersonal(v)}
              label="Quiero recibir el recordatorio diario"
              description={org.reminderEnabled ? 'Preferencia personal: solo te afecta a ti.' : 'El recordatorio del local está desactivado ahora mismo.'}
            />
          )}
          {readOnly ? <p className="mt-3 text-sm text-ink-muted">Esta preferencia se puede cambiar también en solo lectura.</p> : null}
        </Card>
      </div>
    </SettingsShell>
  );
}

// ===========================================================================
// LISTAS DE CONFIGURACIÓN
// ===========================================================================
export function EquipmentSettingsPage() {
  const { orgId, readOnly } = useOrgContext();
  return (
    <SettingsShell title="Equipos" subtitle="Los límites y controles diarios son orientativos: ajústalos a tu plan de autocontrol.">
      {readOnly ? <WriteGuard what="añadir ni cambiar equipos">{null}</WriteGuard> : null}
      <EquipmentManager orgId={orgId} readOnly={readOnly} />
    </SettingsShell>
  );
}
export function CleaningSettingsPage() {
  const { orgId, readOnly } = useOrgContext();
  return (
    <SettingsShell title="Planes de limpieza" subtitle="Cambiar un plan no altera los registros ya guardados.">
      {readOnly ? <WriteGuard what="añadir ni cambiar planes">{null}</WriteGuard> : null}
      <CleaningManager orgId={orgId} readOnly={readOnly} />
    </SettingsShell>
  );
}
export function SuppliersSettingsPage() {
  const { orgId, readOnly } = useOrgContext();
  return (
    <SettingsShell title="Proveedores">
      {readOnly ? <WriteGuard what="añadir ni cambiar proveedores">{null}</WriteGuard> : null}
      <SupplierManager orgId={orgId} readOnly={readOnly} />
    </SettingsShell>
  );
}
export function StaffSettingsPage() {
  const { orgId, readOnly, tz } = useOrgContext();
  return (
    <SettingsShell title="Personal y PIN" subtitle="Quienes firman los registros en la tablet de cocina. Tras 5 PIN fallidos se bloquea 15 minutos.">
      {readOnly ? <WriteGuard what="añadir ni cambiar personal">{null}</WriteGuard> : null}
      <StaffManager orgId={orgId} readOnly={readOnly} tz={tz} />
    </SettingsShell>
  );
}

// ===========================================================================
// DISPOSITIVOS DE COCINA
// ===========================================================================
export const kioskPairUrl = (token: string) => `${window.location.origin}/cocina/vincular#token=${token}`;

export function DevicesSettingsPage() {
  const { orgId, readOnly, tz } = useOrgContext();
  const q = useDevices(orgId);
  const qc = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('Tablet de cocina');
  const [nameError, setNameError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<{ device: Device; token: string } | null>(null);
  const [revoking, setRevoking] = useState<Device | null>(null);
  const [showToken, setShowToken] = useState(false);

  const create = async (e: FormEvent) => {
    e.preventDefault();
    const parsed = createDeviceBody.safeParse({ name });
    if (!parsed.success) return setNameError('Ponle un nombre (máx. 100 caracteres)');
    setNameError(null);
    setBusy(true);
    try {
      const r = await api.post<{ device: Device; token: string }>(`/api/orgs/${orgId}/devices`, parsed.data);
      setCreating(false);
      setCreated(r);
      setShowToken(false);
      await qc.invalidateQueries({ queryKey: keys.orgScoped(orgId, 'devices') });
    } catch (err) {
      setNameError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const revoke = async () => {
    if (!revoking) return;
    setBusy(true);
    try {
      await api.del(`/api/orgs/${orgId}/devices/${revoking.id}`);
      toast.show(`«${revoking.name}» desvinculado`);
      setRevoking(null);
      await qc.invalidateQueries({ queryKey: keys.orgScoped(orgId, 'devices') });
    } catch (err) {
      toast.show(errorMessage(err), 'bad');
    } finally {
      setBusy(false);
    }
  };

  const useHere = () => {
    if (!created) return;
    storage.setKioskToken(created.token);
    setCreated(null);
    navigate('/cocina');
  };

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.show('Copiado');
    } catch {
      toast.show('No se pudo copiar automáticamente', 'info');
    }
  };

  const active = q.data?.filter((d) => d.active) ?? [];
  const revoked = q.data?.filter((d) => !d.active) ?? [];

  return (
    <SettingsShell
      title="Dispositivos de cocina"
      subtitle="Vincula una tablet o móvil compartido para registrar en modo cocina sin iniciar sesión. Si quien la vinculó deja el local, la tablet se desvincula sola."
      actions={
        readOnly ? null : (
          <Button icon="plus" onClick={() => setCreating(true)}>
            Vincular dispositivo
          </Button>
        )
      }
    >
      {readOnly ? <WriteGuard what="vincular dispositivos nuevos (sí puedes desvincular)">{null}</WriteGuard> : null}
      {q.isPending ? (
        <LoadingBlock />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : active.length === 0 && revoked.length === 0 ? (
        <EmptyState icon="tablet" title="Aún no hay dispositivos" action={readOnly ? null : <Button icon="plus" onClick={() => setCreating(true)}>Vincular la primera tablet</Button>}>
          Genera un código, escanéalo con la tablet de la cocina y quedará lista para registrar.
        </EmptyState>
      ) : (
        <div className="space-y-6">
          <ul className="space-y-3" aria-label="Dispositivos activos">
            {active.map((d) => (
              <li key={d.id} className="flex flex-col gap-3 rounded-2xl border border-line bg-surface p-4 shadow-card sm:flex-row sm:items-center">
                <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand-strong dark:text-brand">
                  <Icon name="tablet" size={22} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="font-bold">{d.name}</p>
                  <p className="text-sm text-ink-muted">
                    Vinculado el {formatDateTime(d.createdAt, tz)}
                    {d.createdByName ? ` por ${d.createdByName}` : ''} · {d.lastUsedAt ? `último uso ${formatDateTime(d.lastUsedAt, tz)}` : 'sin usar todavía'}
                  </p>
                </div>
                <Badge tone="ok" icon="check">Activo</Badge>
                <Button variant="secondary" icon="x" onClick={() => setRevoking(d)} aria-label={`Desvincular ${d.name}`}>
                  Desvincular
                </Button>
              </li>
            ))}
          </ul>
          {revoked.length ? (
            <details className="rounded-2xl border border-line bg-surface p-4">
              <summary className="min-h-10 cursor-pointer font-semibold">Desvinculados ({revoked.length})</summary>
              <ul className="mt-2 divide-y divide-line">
                {revoked.map((d) => (
                  <li key={d.id} className="py-2 text-sm">
                    <span className="font-semibold">{d.name}</span> · desvinculado el {d.revokedAt ? formatDateTime(d.revokedAt, tz) : '—'}
                    {d.createdByName ? ` · creado por ${d.createdByName}` : ''}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </div>
      )}

      <Dialog open={creating} onClose={() => setCreating(false)} title="Vincular un dispositivo de cocina" size="sm">
        <form onSubmit={create} noValidate className="space-y-4">
          <Field label="Nombre del dispositivo" error={nameError} hint="Para reconocerlo luego, p. ej. «Tablet de la cocina caliente».">
            <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={100} />
          </Field>
          <Button type="submit" block loading={busy}>
            Generar código de vinculación
          </Button>
        </form>
      </Dialog>

      <Dialog open={!!created} onClose={() => setCreated(null)} title="Escanea este código con la tablet" dismissible>
        {created ? (
          <div className="space-y-4">
            <Callout tone="warn" title="Solo se muestra esta vez">
              Quien tenga este código puede registrar en tu local desde la cocina. No lo compartas; si se pierde la tablet, desvincúlala aquí.
            </Callout>
            <div className="flex justify-center rounded-2xl border border-line bg-white p-3">
              <QrCode value={kioskPairUrl(created.token)} size={240} label="Código QR para vincular la tablet de cocina" />
            </div>
            <ol className="list-decimal space-y-1 pl-5 text-ink">
              <li>En la tablet, abre la cámara y escanea el código.</li>
              <li>Se abrirá el modo cocina ya vinculado a «{created.device.name}».</li>
            </ol>
            <details open={showToken} onToggle={(e) => setShowToken((e.target as HTMLDetailsElement).open)}>
              <summary className="min-h-10 cursor-pointer font-semibold">¿No puedes escanear? Copia el código</summary>
              <p className="mt-2 rounded-xl bg-surface-2 px-3 py-2 font-mono text-sm break-all" data-testid="device-token">
                {created.token}
              </p>
              <Button variant="secondary" size="sm" icon="copy" className="mt-2" onClick={() => void copy(created.token)}>
                Copiar código
              </Button>
              <p className="mt-2 text-sm text-ink-muted">En la tablet, abre {window.location.host}/cocina y pégalo.</p>
            </details>
            <div className="grid gap-2 sm:grid-cols-2">
              <Button variant="secondary" icon="tablet" onClick={useHere}>
                Usar este dispositivo
              </Button>
              <Button onClick={() => setCreated(null)}>Hecho</Button>
            </div>
          </div>
        ) : null}
      </Dialog>

      <ConfirmDialog open={!!revoking} onClose={() => setRevoking(null)} onConfirm={() => void revoke()} loading={busy} title={`¿Desvincular «${revoking?.name ?? ''}»?`} confirmLabel="Desvincular">
        La tablet dejará de poder registrar inmediatamente. Los registros que ya hizo se conservan.
      </ConfirmDialog>
    </SettingsShell>
  );
}

// ===========================================================================
// EQUIPO (miembros e invitaciones)
// ===========================================================================
const roleLabel = (r: Role) => (r === 'owner' ? 'Propietario/a' : 'Encargado/a');

export function TeamSettingsPage() {
  const { orgId, isOwner, readOnly, tz } = useOrgContext();
  const account = useAccount();
  const members = useMembers(orgId);
  const invitations = useInvitations(orgId, isOwner);
  const qc = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('manager');
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [removing, setRemoving] = useState<{ userId: string; name: string; self: boolean } | null>(null);
  const me = account.data?.user.id;

  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: keys.orgScoped(orgId, 'members') }), qc.invalidateQueries({ queryKey: keys.orgScoped(orgId, 'invitations') })]);

  const invite = async (e: FormEvent) => {
    e.preventDefault();
    const parsed = inviteBody.safeParse({ email, role });
    if (!parsed.success) return setInviteError('Escribe un email válido');
    setInviteError(null);
    setBusy('invite');
    try {
      await api.post(`/api/orgs/${orgId}/invitations`, parsed.data);
      toast.show(`Invitación enviada a ${parsed.data.email}`);
      setEmail('');
      await refresh();
    } catch (err) {
      setInviteError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const changeRole = async (userId: string, r: Role) => {
    setBusy(userId);
    try {
      await api.patch(`/api/orgs/${orgId}/members/${userId}`, { role: r });
      toast.show('Rol actualizado');
      await refresh();
    } catch (err) {
      toast.show(errorMessage(err), 'bad');
    } finally {
      setBusy(null);
    }
  };

  const remove = async () => {
    if (!removing) return;
    setBusy(removing.userId);
    try {
      await api.del(`/api/orgs/${orgId}/members/${removing.userId}`);
      if (removing.self) {
        await qc.invalidateQueries({ queryKey: keys.account });
        navigate('/app', { replace: true });
        return;
      }
      toast.show(`${removing.name} ya no tiene acceso`);
      setRemoving(null);
      await refresh();
    } catch (err) {
      toast.show(errorMessage(err), 'bad');
    } finally {
      setBusy(null);
    }
  };

  const revokeInvitation = async (id: string) => {
    setBusy(id);
    try {
      await api.del(`/api/orgs/${orgId}/invitations/${id}`);
      toast.show('Invitación anulada');
      await refresh();
    } catch (err) {
      toast.show(errorMessage(err), 'bad');
    } finally {
      setBusy(null);
    }
  };

  return (
    <SettingsShell title="Encargados e invitaciones" subtitle="Los encargados llevan el día a día; solo los propietarios gestionan facturación, miembros y datos del local.">
      <div className="grid gap-6 lg:grid-cols-[1.3fr_1fr]">
        <Card>
          <SectionTitle>Personas con acceso</SectionTitle>
          {members.isPending ? (
            <LoadingBlock />
          ) : members.isError ? (
            <ErrorState error={members.error} onRetry={() => void members.refetch()} />
          ) : (
            <ul className="divide-y divide-line">
              {members.data.map((m) => (
                <li key={m.userId} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center">
                  <div className="min-w-0 flex-1">
                    <p className="font-bold">
                      {m.name} {m.userId === me ? <span className="font-normal text-ink-muted">(tú)</span> : null}
                    </p>
                    <p className="text-sm break-all text-ink-muted">{m.email}</p>
                  </div>
                  {isOwner && m.userId !== me && !readOnly ? (
                    <Select aria-label={`Rol de ${m.name}`} value={m.role} disabled={busy === m.userId} onChange={(e) => void changeRole(m.userId, e.target.value as Role)} className="sm:w-48">
                      <option value="manager">Encargado/a</option>
                      <option value="owner">Propietario/a</option>
                    </Select>
                  ) : (
                    <Badge tone={m.role === 'owner' ? 'info' : 'neutral'}>{roleLabel(m.role)}</Badge>
                  )}
                  {m.userId === me ? (
                    <Button variant="ghost" size="md" onClick={() => setRemoving({ userId: m.userId, name: m.name, self: true })}>
                      Salir del local
                    </Button>
                  ) : isOwner ? (
                    <Button variant="ghost" size="md" icon="trash" onClick={() => setRemoving({ userId: m.userId, name: m.name, self: false })} aria-label={`Quitar a ${m.name}`}>
                      Quitar
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card>
          <SectionTitle>Invitar</SectionTitle>
          {!isOwner ? (
            <OwnerOnly>{null}</OwnerOnly>
          ) : (
            <>
              <WriteGuard what="enviar invitaciones">
                <form onSubmit={invite} noValidate className="space-y-3">
                  <Field label="Email" error={inviteError}>
                    <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off" />
                  </Field>
                  <Field label="Rol">
                    <Select value={role} onChange={(e) => setRole(e.target.value as Role)}>
                      <option value="manager">Encargado/a</option>
                      <option value="owner">Propietario/a</option>
                    </Select>
                  </Field>
                  <Button type="submit" icon="mail" loading={busy === 'invite'} block>
                    Enviar invitación
                  </Button>
                </form>
              </WriteGuard>
              <h3 className="mt-6 mb-2 font-bold">Pendientes</h3>
              {invitations.isPending ? (
                <Skeleton className="h-12" />
              ) : invitations.isError ? (
                <ErrorState error={invitations.error} onRetry={() => void invitations.refetch()} />
              ) : invitations.data.length === 0 ? (
                <p className="text-ink-muted">No hay invitaciones pendientes.</p>
              ) : (
                <ul className="divide-y divide-line">
                  {invitations.data.map((i) => (
                    <li key={i.id} className="flex items-center gap-2 py-2">
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold break-all">{i.email}</p>
                        <p className="text-sm text-ink-muted">
                          {roleLabel(i.role)} · caduca el {formatDateTime(i.expiresAt, tz)}
                        </p>
                      </div>
                      <Button variant="ghost" size="sm" loading={busy === i.id} onClick={() => void revokeInvitation(i.id)} aria-label={`Anular invitación a ${i.email}`}>
                        Anular
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </Card>
      </div>
      <ConfirmDialog
        open={!!removing}
        onClose={() => setRemoving(null)}
        onConfirm={() => void remove()}
        loading={!!busy}
        title={removing?.self ? '¿Salir de este local?' : `¿Quitar el acceso a ${removing?.name ?? ''}?`}
        confirmLabel={removing?.self ? 'Salir' : 'Quitar acceso'}
      >
        {removing?.self
          ? 'Dejarás de ver este local y se desvincularán las tablets de cocina que diste de alta. Para volver, alguien tendrá que invitarte de nuevo.'
          : 'Sus registros se conservan con su nombre. Las tablets de cocina que vinculó esa persona se desvincularán.'}
      </ConfirmDialog>
    </SettingsShell>
  );
}

// ===========================================================================
// AUDITORÍA
// ===========================================================================
const AUDIT_LABELS: Record<string, string> = {
  'org.created': 'Local creado',
  'org.updated': 'Datos del local cambiados',
  'org.exported': 'Datos exportados',
  'member.invited': 'Invitación enviada',
  'member.role_changed': 'Rol cambiado',
  'member.removed': 'Acceso retirado',
  'member.joined': 'Se unió al local',
  'member.invitation_revoked': 'Invitación anulada',
  'device.created': 'Dispositivo de cocina vinculado',
  'device.revoked': 'Dispositivo de cocina desvinculado',
  'device.revoked_with_member': 'Dispositivo desvinculado al salir su creador',
  'billing.subscription_canceled': 'Suscripción cancelada',
  'staff.pin_changed': 'PIN cambiado',
  'staff.pin_failed': 'PIN incorrecto en cocina',
  'staff.pin_locked': 'PIN bloqueado',
  'report.generated': 'Informe descargado',
  'billing.checkout_started': 'Inicio de contratación',
  'billing.subscription_updated': 'Suscripción actualizada',
  'public_menu.updated': 'Carta pública cambiada',
};

export function AuditPage() {
  const { orgId, tz } = useOrgContext();
  const q = useAudit(orgId);
  const items = q.data?.pages.flatMap((p) => p.items) ?? [];
  return (
    <SettingsShell title="Registro de actividad" subtitle="Acciones importantes en el local: accesos, cambios de configuración, informes y facturación.">
      <OwnerOnly>
        {q.isPending ? (
          <LoadingBlock rows={6} />
        ) : q.isError ? (
          <ErrorState error={q.error} onRetry={() => void q.refetch()} />
        ) : items.length === 0 ? (
          <EmptyState icon="shield" title="Sin actividad registrada" />
        ) : (
          <>
            <ul className="divide-y divide-line rounded-2xl border border-line bg-surface shadow-card">
              {items.map((ev) => (
                <li key={ev.id} className="flex flex-col gap-0.5 px-4 py-3 sm:flex-row sm:items-center sm:gap-4">
                  <span className="w-44 shrink-0 text-sm text-ink-muted tabular">{formatDateTime(ev.createdAt, tz)}</span>
                  <span className="min-w-0 flex-1">
                    <span className="font-semibold">{AUDIT_LABELS[ev.event] ?? ev.event}</span>
                    <span className="text-ink-muted"> · {ev.user?.name ?? (ev.event.startsWith('staff.') ? 'Tablet de cocina' : 'Sistema')}</span>
                  </span>
                  {ev.ip ? <span className="font-mono text-xs text-ink-muted">{ev.ip}</span> : null}
                </li>
              ))}
            </ul>
            {q.hasNextPage ? (
              <div className="mt-4 text-center">
                <Button variant="secondary" onClick={() => void q.fetchNextPage()} loading={q.isFetchingNextPage}>
                  Cargar más
                </Button>
              </div>
            ) : null}
          </>
        )}
      </OwnerOnly>
    </SettingsShell>
  );
}

// ===========================================================================
// EXPORTAR Y ELIMINAR
// ===========================================================================
export function DataSettingsPage() {
  const { orgId, org } = useOrgContext();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [confirmName, setConfirmName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const del = async (e: FormEvent) => {
    e.preventDefault();
    if (confirmName.trim() !== org.name) return setError('Escribe el nombre del local exactamente');
    if (!password) return setError('Escribe tu contraseña');
    setBusy(true);
    setError(null);
    try {
      await api.del(`/api/orgs/${orgId}`, { password });
      storage.setLastOrg(null);
      await qc.invalidateQueries({ queryKey: keys.account });
      qc.removeQueries({ queryKey: keys.org(orgId) });
      navigate('/app', { replace: true });
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  return (
    <SettingsShell title="Exportar o eliminar datos">
      <OwnerOnly>
        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <SectionTitle>Exportar todo</SectionTitle>
            <p className="text-ink-muted">
              Descarga una copia completa del local en formato JSON: configuración, personal, platos y todos los registros. No incluye contraseñas ni PIN.
              Disponible también en solo lectura.
            </p>
            <DownloadButton url={`/api/orgs/${orgId}/export`} fallbackName="exportacion.json" className="mt-4">
              Descargar exportación
            </DownloadButton>
          </Card>
          <Card className="border-bad/40">
            <SectionTitle>Eliminar el local</SectionTitle>
            <p className="text-ink-muted">Borra el local y todos sus registros de forma permanente. No se puede deshacer. Te recomendamos exportar antes. Si tiene una suscripción activa, se cancela automáticamente.</p>
            <Button variant="danger" icon="trash" className="mt-4" onClick={() => setOpen(true)}>
              Eliminar «{org.name}»
            </Button>
          </Card>
        </div>
      </OwnerOnly>
      <Dialog open={open} onClose={() => setOpen(false)} title="Eliminar el local definitivamente" size="sm">
        <form onSubmit={del} noValidate className="space-y-4">
          <Callout tone="bad">Se borrarán todos los datos y registros de «{org.name}». Esta acción no se puede deshacer.</Callout>
          <Field label={`Escribe «${org.name}» para confirmar`}>
            <Input value={confirmName} onChange={(e) => setConfirmName(e.target.value)} autoComplete="off" />
          </Field>
          <Field label="Tu contraseña">
            <PasswordInput value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
          </Field>
          {error ? <Callout tone="bad" live="assertive">{error}</Callout> : null}
          <Button type="submit" variant="danger" block loading={busy}>
            Eliminar para siempre
          </Button>
        </form>
      </Dialog>
    </SettingsShell>
  );
}

// ===========================================================================
// CUENTA
// ===========================================================================
export function AccountSettingsPage() {
  const account = useAccount();
  const qc = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const user = account.data?.user;
  const [name, setName] = useState(user?.name ?? '');
  const [nameErr, setNameErr] = useState<string | null>(null);
  const [pw, setPw] = useState({ current: '', next: '' });
  const [pwErr, setPwErr] = useState<string | null>(null);
  const [em, setEm] = useState({ password: '', email: '' });
  const [emErr, setEmErr] = useState<string | null>(null);
  const [emDone, setEmDone] = useState<string | null>(null);
  const [delOpen, setDelOpen] = useState(false);
  const [delPw, setDelPw] = useState('');
  const [delErr, setDelErr] = useState<string | null>(null);
  const [logoutAllOpen, setLogoutAllOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  if (!user) return <LoadingBlock />;

  const run = async (key: string, fn: () => Promise<void>, onError: (m: string) => void) => {
    setBusy(key);
    try {
      await fn();
    } catch (err) {
      onError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const goodbye = (path: string) => {
    storage.setSessionHint(false);
    qc.clear();
    navigate(path, { replace: true });
  };

  return (
    <SettingsShell title="Mi cuenta" subtitle={user.email}>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <SectionTitle>Nombre</SectionTitle>
          <form
            noValidate
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              const p = updateAccountBody.safeParse({ name });
              if (!p.success) return setNameErr('Escribe tu nombre');
              setNameErr(null);
              void run(
                'name',
                async () => {
                  await api.patch('/api/account', p.data);
                  await qc.invalidateQueries({ queryKey: keys.account });
                  toast.show('Nombre actualizado');
                },
                setNameErr,
              );
            }}
          >
            <Field label="Tu nombre" error={nameErr}>
              <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={100} autoComplete="name" />
            </Field>
            <Button type="submit" loading={busy === 'name'}>
              Guardar
            </Button>
          </form>
        </Card>

        <Card>
          <SectionTitle>Cambiar email</SectionTitle>
          {emDone ? (
            <Callout tone="ok" live="polite">
              {emDone}
            </Callout>
          ) : (
            <form
              noValidate
              className="space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                const p = changeEmailBody.safeParse({ password: em.password, newEmail: em.email });
                if (!p.success) return setEmErr(Object.values(zodToFieldErrors(p.error.issues))[0] ?? 'Revisa los datos');
                setEmErr(null);
                void run(
                  'email',
                  async () => {
                    const r = await api.post<{ message: string }>('/api/account/email', p.data);
                    setEmDone(r.message);
                  },
                  setEmErr,
                );
              }}
            >
              <Field label="Nuevo email">
                <Input type="email" value={em.email} onChange={(e) => setEm((s) => ({ ...s, email: e.target.value }))} autoComplete="email" />
              </Field>
              <Field label="Contraseña actual" error={emErr}>
                <PasswordInput value={em.password} onChange={(e) => setEm((s) => ({ ...s, password: e.target.value }))} autoComplete="current-password" />
              </Field>
              <Button type="submit" loading={busy === 'email'}>
                Enviar enlace de confirmación
              </Button>
            </form>
          )}
        </Card>

        <Card>
          <SectionTitle>Cambiar contraseña</SectionTitle>
          <form
            noValidate
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (!pw.current) return setPwErr('Escribe tu contraseña actual');
              if (!passwordAcceptable(pw.next, user.email)) return setPwErr('La nueva contraseña no cumple los requisitos');
              setPwErr(null);
              void run(
                'pw',
                async () => {
                  await api.post('/api/account/password', { currentPassword: pw.current, newPassword: pw.next });
                  setPw({ current: '', next: '' });
                  toast.show('Contraseña cambiada. Hemos cerrado tus otras sesiones.');
                },
                setPwErr,
              );
            }}
          >
            <Field label="Contraseña actual">
              <PasswordInput value={pw.current} onChange={(e) => setPw((s) => ({ ...s, current: e.target.value }))} autoComplete="current-password" />
            </Field>
            <Field label="Nueva contraseña" error={pwErr}>
              <PasswordInput value={pw.next} onChange={(e) => setPw((s) => ({ ...s, next: e.target.value }))} autoComplete="new-password" maxLength={128} />
            </Field>
            <PasswordMeter password={pw.next} email={user.email} />
            <Button type="submit" loading={busy === 'pw'}>
              Cambiar contraseña
            </Button>
          </form>
        </Card>

        <Card>
          <SectionTitle>Sesiones</SectionTitle>
          <p className="text-ink-muted">¿Has entrado desde un ordenador ajeno o has perdido el móvil? Cierra la sesión en todos los dispositivos, incluido este.</p>
          <Button variant="secondary" icon="logout" className="mt-4" onClick={() => setLogoutAllOpen(true)}>
            Cerrar todas las sesiones
          </Button>
          <hr className="my-6 border-line" />
          <SectionTitle>Eliminar mi cuenta</SectionTitle>
          <p className="text-ink-muted">Si eres el único propietario de algún local, antes debes eliminarlo o nombrar a otra persona propietaria.</p>
          <Button variant="danger" icon="trash" className="mt-4" onClick={() => setDelOpen(true)}>
            Eliminar mi cuenta
          </Button>
        </Card>
      </div>

      <ConfirmDialog
        open={logoutAllOpen}
        onClose={() => setLogoutAllOpen(false)}
        onConfirm={() =>
          void run(
            'all',
            async () => {
              await api.post('/api/auth/logout-all');
              goodbye('/entrar?salida=1');
            },
            (m) => toast.show(m, 'bad'),
          )
        }
        loading={busy === 'all'}
        tone="primary"
        title="¿Cerrar todas las sesiones?"
        confirmLabel="Cerrar todas"
      >
        Tendrás que volver a entrar en todos tus dispositivos. Las tablets de cocina vinculadas no se ven afectadas.
      </ConfirmDialog>

      <Dialog open={delOpen} onClose={() => setDelOpen(false)} title="Eliminar mi cuenta" size="sm">
        <form
          noValidate
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!delPw) return setDelErr('Escribe tu contraseña');
            void run(
              'del',
              async () => {
                await api.del('/api/account', { password: delPw });
                goodbye('/');
              },
              setDelErr,
            );
          }}
        >
          <Callout tone="bad">Se borrará tu cuenta y se desvincularán las tablets de cocina que diste de alta. Los registros que firmaste conservan tu nombre.</Callout>
          <Field label="Tu contraseña" error={delErr}>
            <PasswordInput value={delPw} onChange={(e) => setDelPw(e.target.value)} autoComplete="current-password" />
          </Field>
          <Button type="submit" variant="danger" block loading={busy === 'del'}>
            Eliminar mi cuenta
          </Button>
        </form>
      </Dialog>
    </SettingsShell>
  );
}

// ===========================================================================
// FACTURACIÓN
// ===========================================================================
function isSafeExternal(url: string): boolean {
  try {
    return new URL(url).protocol === 'https:';
  } catch {
    return false;
  }
}

export function BillingPage() {
  const { orgId, isOwner, tz } = useOrgContext();
  useDocumentTitle('Facturación');
  const [params, setParams] = useSearchParams();
  const q = useBilling(orgId);
  const qc = useQueryClient();
  const [plan, setPlan] = useState<'monthly' | 'annual'>('annual');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ message: string; notConfigured: boolean } | null>(null);
  const checkout = params.get('checkout');

  // Tras volver de Stripe, el estado llega por webhook: se refresca unas cuantas veces.
  useEffect(() => {
    if (checkout !== 'ok') return;
    let n = 0;
    const id = window.setInterval(() => {
      n++;
      void qc.invalidateQueries({ queryKey: keys.orgScoped(orgId, 'billing') });
      void qc.invalidateQueries({ queryKey: keys.org(orgId), exact: true });
      if (n >= 5) window.clearInterval(id);
    }, 3000);
    return () => window.clearInterval(id);
  }, [checkout, orgId, qc]);

  const go = async (kind: 'checkout' | 'portal') => {
    setBusy(true);
    setError(null);
    try {
      const r = await api.post<{ url: string }>(`/api/orgs/${orgId}/billing/${kind}`, kind === 'checkout' ? { plan } : undefined);
      if (!isSafeExternal(r.url)) throw new Error('URL de pago no válida');
      window.location.assign(r.url);
    } catch (err) {
      setError({ message: errorMessage(err), notConfigured: isApiError(err) && err.code === 'BILLING_NOT_CONFIGURED' });
      setBusy(false);
    }
  };

  return (
    <>
      <BackLink />
      <PageHeader title="Facturación" subtitle="12 € al mes o 120 € al año por local, IVA no incluido. Sin permanencia." />
      {checkout === 'ok' ? (
        <Callout tone="ok" className="mb-5" title="¡Gracias! Estamos confirmando el pago" live="polite" action={<Button variant="ghost" size="sm" onClick={() => setParams({}, { replace: true })}>Cerrar</Button>}>
          El estado de la suscripción puede tardar unos segundos en actualizarse.
        </Callout>
      ) : checkout === 'cancelado' ? (
        <Callout tone="info" className="mb-5" title="No se ha completado el pago" action={<Button variant="ghost" size="sm" onClick={() => setParams({}, { replace: true })}>Cerrar</Button>}>
          No se ha cobrado nada. Puedes intentarlo de nuevo cuando quieras.
        </Callout>
      ) : null}
      {!isOwner ? (
        <OwnerOnly>{null}</OwnerOnly>
      ) : q.isPending ? (
        <LoadingBlock />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : (
        <BillingContent billing={q.data} plan={plan} setPlan={setPlan} go={go} busy={busy} error={error} tz={tz} />
      )}
    </>
  );
}

function BillingContent({
  billing,
  plan,
  setPlan,
  go,
  busy,
  error,
  tz,
}: {
  billing: Billing;
  plan: 'monthly' | 'annual';
  setPlan: (p: 'monthly' | 'annual') => void;
  go: (k: 'checkout' | 'portal') => Promise<void>;
  busy: boolean;
  error: { message: string; notConfigured: boolean } | null;
  tz: string;
}) {
  const sub = billing.subscription;
  const hasSubscription = ['active', 'past_due', 'unpaid', 'paused', 'incomplete'].includes(sub.status) || (sub.status === 'trialing' && sub.hasBillingAccount && sub.plan != null);
  const days = relativeDays(sub.trialEndsAt);
  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_1.2fr]">
      <Card>
        <SectionTitle>Estado</SectionTitle>
        <Badge tone={sub.readOnly ? 'bad' : sub.status === 'active' ? 'ok' : 'info'} icon={sub.readOnly ? 'lock' : 'check'}>
          {STATUS_LABELS[sub.status]}
        </Badge>
        <dl className="mt-4 space-y-2">
          {sub.status === 'trialing' ? (
            <div>
              <dt className="text-sm text-ink-muted">Fin de la prueba</dt>
              <dd className="font-semibold">
                {formatLocalDate(sub.trialEndsAt.slice(0, 10))} ({days > 0 ? `${days} días` : 'hoy'})
              </dd>
            </div>
          ) : null}
          {sub.plan ? (
            <div>
              <dt className="text-sm text-ink-muted">Plan</dt>
              <dd className="font-semibold">{sub.plan === 'annual' ? `Anual · ${formatEuros(billing.prices.annual.amount)}/año` : `Mensual · ${formatEuros(billing.prices.monthly.amount)}/mes`}</dd>
            </div>
          ) : null}
          {sub.currentPeriodEnd ? (
            <div>
              <dt className="text-sm text-ink-muted">{sub.cancelAtPeriodEnd ? 'Se cancela el' : 'Próxima renovación'}</dt>
              <dd className="font-semibold">{formatDateTime(sub.currentPeriodEnd, tz)}</dd>
            </div>
          ) : null}
        </dl>
        {sub.readOnly ? (
          <Callout tone="bad" className="mt-4">
            El local está en solo lectura. Al activar la suscripción podrás volver a registrar enseguida. Tus datos siguen ahí.
          </Callout>
        ) : null}
        {sub.hasBillingAccount ? (
          <Button variant="secondary" icon="external" className="mt-5" loading={busy} disabled={!billing.billingEnabled} onClick={() => void go('portal')}>
            Gestionar pago, facturas o cancelar
          </Button>
        ) : null}
      </Card>
      <Card>
        <SectionTitle>{hasSubscription ? 'Tu plan' : 'Elige tu plan'}</SectionTitle>
        {!billing.billingEnabled ? (
          <Callout tone="info" icon="card" title="Los pagos online aún no están disponibles">
            Este servidor todavía no tiene configurada la pasarela de pago. Tus datos y la prueba siguen funcionando con normalidad; contacta con
            soporte para activar tu suscripción.
          </Callout>
        ) : hasSubscription ? (
          <p className="text-ink-muted">Para cambiar de plan, actualizar la tarjeta, descargar facturas o cancelar, usa «Gestionar pago».</p>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-2" role="radiogroup" aria-label="Plan">
              {(['monthly', 'annual'] as const).map((p) => (
                <button
                  key={p}
                  type="button"
                  role="radio"
                  aria-checked={plan === p}
                  onClick={() => setPlan(p)}
                  className={cn('rounded-2xl border-2 p-4 text-left transition-colors', plan === p ? 'border-brand bg-brand-soft' : 'border-line bg-surface hover:border-line-strong')}
                >
                  <span className="block font-bold">{p === 'annual' ? 'Anual' : 'Mensual'}</span>
                  <span className="block font-display text-3xl font-extrabold">
                    {formatEuros(p === 'annual' ? billing.prices.annual.amount : billing.prices.monthly.amount)}
                  </span>
                  <span className="block text-sm text-ink-muted">{p === 'annual' ? 'al año · 2 meses gratis' : 'al mes'} · IVA no incluido</span>
                </button>
              ))}
            </div>
            {sub.status === 'trialing' && days >= 2 ? (
              <p className="mt-3 text-sm text-ink-muted">No se cobra nada hasta que termine tu prueba.</p>
            ) : null}
            <Button size="lg" block className="mt-5" icon="card" loading={busy} onClick={() => void go('checkout')}>
              Continuar al pago seguro
            </Button>
            <p className="mt-2 text-center text-sm text-ink-muted">El pago lo gestiona Stripe. No guardamos los datos de tu tarjeta.</p>
          </>
        )}
        {error ? (
          <Callout tone={error.notConfigured ? 'info' : 'bad'} className="mt-4" live="assertive" title={error.notConfigured ? 'Pagos no disponibles todavía' : undefined}>
            {error.notConfigured ? 'La pasarela de pago no está configurada en este servidor. Inténtalo más tarde o contacta con soporte.' : error.message}
          </Callout>
        ) : null}
      </Card>
    </div>
  );
}
