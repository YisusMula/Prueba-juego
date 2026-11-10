import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { EQUIPMENT_TYPE_LABELS } from '@shared/schemas';
import { api, errorMessage } from '@/api/client';
import { keys, useCleaningPlans, useEquipment, useStaff, useSuppliers } from '@/api/queries';
import type { CleaningPlan, Equipment, Staff, Supplier } from '@/api/types';
import { Button } from '@/components/ui/Button';
import { Badge, EmptyState, ErrorState, LoadingBlock } from '@/components/ui/Feedback';
import { ConfirmDialog, useToast } from '@/components/ui/Overlay';
import { Icon, type IconName } from '@/components/icons/Icon';
import { CleaningPlanDialog, EquipmentDialog, StaffDialog, SupplierDialog } from './ConfigForms';
import { formatRange, formatTime, frequencyLabel, plural } from '@/lib/format';
import { cn } from '@/lib/cn';

type ManagerProps = { orgId: string; readOnly: boolean };

function Row({ icon, title, meta, badges, actions, muted }: { icon: IconName; title: string; meta?: string; badges?: React.ReactNode; actions?: React.ReactNode; muted?: boolean }) {
  return (
    <li className={cn('flex flex-col gap-3 rounded-2xl border border-line bg-surface p-4 shadow-card sm:flex-row sm:items-center', muted && 'opacity-70')}>
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand-strong dark:text-brand">
          <Icon name={icon} size={22} />
        </span>
        <div className="min-w-0">
          <p className="font-bold break-words">{title}</p>
          {meta ? <p className="text-sm text-ink-muted">{meta}</p> : null}
          {badges ? <div className="mt-1.5 flex flex-wrap gap-1.5">{badges}</div> : null}
        </div>
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap gap-2 sm:justify-end">{actions}</div> : null}
    </li>
  );
}

function useInvalidate(orgId: string) {
  const qc = useQueryClient();
  return (...k: string[]) => Promise.all(k.map((x) => qc.invalidateQueries({ queryKey: keys.orgScoped(orgId, x) })));
}

// ---------------------------------------------------------------------------
export function EquipmentManager({ orgId, readOnly }: ManagerProps) {
  const q = useEquipment(orgId);
  const [editing, setEditing] = useState<Equipment | null | undefined>(undefined);
  const invalidate = useInvalidate(orgId);
  const toast = useToast();
  return (
    <div>
      {q.isPending ? (
        <LoadingBlock />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : q.data.length === 0 ? (
        <EmptyState icon="thermometer" title="Aún no hay equipos" action={readOnly ? null : <Button icon="plus" onClick={() => setEditing(null)}>Añadir equipo</Button>}>
          Añade tus cámaras, congeladores, vitrinas y freidoras para controlar sus temperaturas.
        </EmptyState>
      ) : (
        <>
          <ul className="space-y-3">
            {q.data.map((e) => (
              <Row
                key={e.id}
                icon={e.type === 'freidora' ? 'droplet' : 'thermometer'}
                title={e.name}
                muted={!e.active}
                meta={`${EQUIPMENT_TYPE_LABELS[e.type]} · ${formatRange(e.minTemp, e.maxTemp)} · ${e.checksPerDay === 0 ? 'sin controles diarios' : plural(e.checksPerDay, 'control al día', 'controles al día')}`}
                badges={!e.active ? <Badge>Desactivado</Badge> : null}
                actions={
                  readOnly ? null : (
                    <Button variant="secondary" size="md" icon="pencil" onClick={() => setEditing(e)} aria-label={`Editar ${e.name}`}>
                      Editar
                    </Button>
                  )
                }
              />
            ))}
          </ul>
          {readOnly ? null : (
            <Button className="mt-4" icon="plus" variant="quiet" onClick={() => setEditing(null)}>
              Añadir equipo
            </Button>
          )}
        </>
      )}
      {editing !== undefined ? (
        <EquipmentDialog
          key={editing?.id ?? 'new'}
          orgId={orgId}
          open
          initial={editing}
          onClose={() => setEditing(undefined)}
          onSaved={(eq) => {
            setEditing(undefined);
            toast.show(`Equipo «${eq.name}» guardado`);
            void invalidate('equipment', 'today');
          }}
        />
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
export function CleaningManager({ orgId, readOnly }: ManagerProps) {
  const q = useCleaningPlans(orgId);
  const [editing, setEditing] = useState<CleaningPlan | null | undefined>(undefined);
  const invalidate = useInvalidate(orgId);
  const toast = useToast();
  return (
    <div>
      {q.isPending ? (
        <LoadingBlock />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : q.data.length === 0 ? (
        <EmptyState icon="sparkles" title="Aún no hay planes de limpieza" action={readOnly ? null : <Button icon="plus" onClick={() => setEditing(null)}>Crear plan</Button>}>
          Crea un plan con las zonas que hay que limpiar y cada cuánto.
        </EmptyState>
      ) : (
        <>
          <ul className="space-y-3">
            {q.data.map((p) => (
              <Row
                key={p.id}
                icon="sparkles"
                title={p.name}
                muted={!p.active}
                meta={`${frequencyLabel(p.frequency, p.weekday, p.monthDay)} · ${plural(p.items.length, 'zona', 'zonas')}: ${p.items
                  .slice(0, 4)
                  .map((i) => i.area)
                  .join(', ')}${p.items.length > 4 ? '…' : ''}`}
                badges={!p.active ? <Badge>Desactivado</Badge> : null}
                actions={
                  readOnly ? null : (
                    <Button variant="secondary" icon="pencil" onClick={() => setEditing(p)} aria-label={`Editar ${p.name}`}>
                      Editar
                    </Button>
                  )
                }
              />
            ))}
          </ul>
          {readOnly ? null : (
            <Button className="mt-4" icon="plus" variant="quiet" onClick={() => setEditing(null)}>
              Nuevo plan de limpieza
            </Button>
          )}
        </>
      )}
      {editing !== undefined ? (
        <CleaningPlanDialog
          key={editing?.id ?? 'new'}
          orgId={orgId}
          open
          initial={editing}
          onClose={() => setEditing(undefined)}
          onSaved={(p) => {
            setEditing(undefined);
            toast.show(`Plan «${p.name}» guardado`);
            void invalidate('cleaning-plans', 'today');
          }}
        />
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
export function StaffManager({ orgId, readOnly, tz }: ManagerProps & { tz?: string }) {
  const q = useStaff(orgId);
  const [editing, setEditing] = useState<Staff | null | undefined>(undefined);
  const [busy, setBusy] = useState<string | null>(null);
  const invalidate = useInvalidate(orgId);
  const toast = useToast();
  const unlock = async (s: Staff) => {
    setBusy(s.id);
    try {
      await api.post(`/api/orgs/${orgId}/staff/${s.id}/unlock`);
      toast.show(`PIN de ${s.name} desbloqueado`);
      await invalidate('staff');
    } catch (err) {
      toast.show(errorMessage(err), 'bad');
    } finally {
      setBusy(null);
    }
  };
  return (
    <div>
      {q.isPending ? (
        <LoadingBlock />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : q.data.length === 0 ? (
        <EmptyState icon="users" title="Aún no hay personal" action={readOnly ? null : <Button icon="plus" onClick={() => setEditing(null)}>Añadir persona</Button>}>
          Añade a quienes trabajan en cocina para que firmen sus registros en la tablet.
        </EmptyState>
      ) : (
        <>
          <ul className="space-y-3">
            {q.data.map((s) => (
              <Row
                key={s.id}
                icon="user"
                title={s.name}
                muted={!s.active}
                badges={
                  <>
                    {s.hasPin ? (
                      <Badge tone="info" icon="lock">
                        Con PIN
                      </Badge>
                    ) : (
                      <Badge>Sin PIN</Badge>
                    )}
                    {s.lockedUntil ? (
                      <Badge tone="bad" icon="alert">
                        PIN bloqueado hasta las {formatTime(s.lockedUntil, tz)}
                      </Badge>
                    ) : null}
                    {!s.active ? <Badge>Desactivada</Badge> : null}
                  </>
                }
                actions={
                  readOnly ? null : (
                    <>
                      {s.lockedUntil ? (
                        <Button variant="danger" icon="key" loading={busy === s.id} onClick={() => void unlock(s)}>
                          Desbloquear
                        </Button>
                      ) : null}
                      <Button variant="secondary" icon="pencil" onClick={() => setEditing(s)} aria-label={`Editar ${s.name}`}>
                        Editar
                      </Button>
                    </>
                  )
                }
              />
            ))}
          </ul>
          {readOnly ? null : (
            <Button className="mt-4" icon="plus" variant="quiet" onClick={() => setEditing(null)}>
              Añadir persona
            </Button>
          )}
        </>
      )}
      {editing !== undefined ? (
        <StaffDialog
          key={editing?.id ?? 'new'}
          orgId={orgId}
          open
          initial={editing}
          onClose={() => setEditing(undefined)}
          onSaved={(s) => {
            setEditing(undefined);
            toast.show(`${s.name} guardado`);
            void invalidate('staff');
          }}
        />
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
export function SupplierManager({ orgId, readOnly }: ManagerProps) {
  const q = useSuppliers(orgId);
  const [editing, setEditing] = useState<Supplier | null | undefined>(undefined);
  const [deleting, setDeleting] = useState<Supplier | null>(null);
  const [busy, setBusy] = useState(false);
  const invalidate = useInvalidate(orgId);
  const toast = useToast();
  const remove = async () => {
    if (!deleting) return;
    setBusy(true);
    try {
      await api.del(`/api/orgs/${orgId}/suppliers/${deleting.id}`);
      toast.show(`Proveedor «${deleting.name}» eliminado`);
      setDeleting(null);
      await invalidate('suppliers');
    } catch (err) {
      toast.show(errorMessage(err), 'bad');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div>
      {q.isPending ? (
        <LoadingBlock />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : q.data.length === 0 ? (
        <EmptyState icon="truck" title="Aún no hay proveedores" action={readOnly ? null : <Button icon="plus" onClick={() => setEditing(null)}>Añadir proveedor</Button>}>
          Guarda tus proveedores para registrar las recepciones más rápido.
        </EmptyState>
      ) : (
        <>
          <ul className="space-y-3">
            {q.data.map((s) => (
              <Row
                key={s.id}
                icon="truck"
                title={s.name}
                meta={[s.contactName, s.phone, s.email].filter(Boolean).join(' · ') || undefined}
                badges={s.products.length ? <span className="text-sm text-ink-muted">{s.products.join(', ')}</span> : null}
                actions={
                  readOnly ? null : (
                    <>
                      <Button variant="secondary" icon="pencil" onClick={() => setEditing(s)} aria-label={`Editar ${s.name}`}>
                        Editar
                      </Button>
                      <Button variant="ghost" icon="trash" onClick={() => setDeleting(s)} aria-label={`Eliminar ${s.name}`}>
                        Eliminar
                      </Button>
                    </>
                  )
                }
              />
            ))}
          </ul>
          {readOnly ? null : (
            <Button className="mt-4" icon="plus" variant="quiet" onClick={() => setEditing(null)}>
              Añadir proveedor
            </Button>
          )}
        </>
      )}
      {editing !== undefined ? (
        <SupplierDialog
          key={editing?.id ?? 'new'}
          orgId={orgId}
          open
          initial={editing}
          onClose={() => setEditing(undefined)}
          onSaved={(s) => {
            setEditing(undefined);
            toast.show(`Proveedor «${s.name}» guardado`);
            void invalidate('suppliers');
          }}
        />
      ) : null}
      <ConfirmDialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        onConfirm={() => void remove()}
        loading={busy}
        title={`¿Eliminar «${deleting?.name ?? ''}»?`}
        confirmLabel="Eliminar"
      >
        Los registros de recepción ya guardados conservan el nombre del proveedor.
      </ConfirmDialog>
    </div>
  );
}
