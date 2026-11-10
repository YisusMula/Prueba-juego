import { useState } from 'react';
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { RECORD_TYPES } from '@shared/schemas';
import { useCleaningPlans, useEquipment, useStaff, useSuppliers, orgApi } from '@/api/queries';
import type { AppRecord } from '@/api/types';
import { useOrgContext } from '@/hooks/useOrgContext';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { Button, LinkButton } from '@/components/ui/Button';
import { ErrorState, LoadingBlock } from '@/components/ui/Feedback';
import { Card, PageHeader } from '@/components/ui/Layout';
import { Field, Select } from '@/components/ui/Form';
import { useToast } from '@/components/ui/Overlay';
import { Icon } from '@/components/icons/Icon';
import { RecordForm, type FormContext } from '@/features/RecordForms';
import { RECORD_HELP, RECORD_ICON, RECORD_SHORT, RECORD_TINT, RECORD_TYPE_LABELS, isRecordType, recordSummary } from '@/features/recordMeta';
import { WriteGuard } from '@/features/SubscriptionBanner';
import { cn } from '@/lib/cn';

export function RegisterHubPage() {
  const { path } = useOrgContext();
  useDocumentTitle('Registrar');
  return (
    <>
      <PageHeader title="¿Qué quieres registrar?" subtitle="La fecha y la hora las pone el sistema automáticamente." />
      <ul className="grid gap-3 sm:grid-cols-2">
        {RECORD_TYPES.map((t) => (
          <li key={t}>
            <Link
              to={path(`registrar/${t}`)}
              className="group flex min-h-24 items-center gap-4 rounded-2xl border border-line bg-surface p-4 shadow-card transition-[border-color,transform] hover:-translate-y-0.5 hover:border-brand"
            >
              <span className={cn('grid size-14 shrink-0 place-items-center rounded-2xl', RECORD_TINT[t])}>
                <Icon name={RECORD_ICON[t]} size={30} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-lg font-bold">{RECORD_TYPE_LABELS[t]}</span>
                <span className="block text-ink-muted">{RECORD_HELP[t]}</span>
              </span>
              <Icon name="chevronRight" className="shrink-0 text-ink-muted" />
            </Link>
          </li>
        ))}
      </ul>
      <p className="mt-6 text-ink-muted">
        ¿Hay que corregir un registro ya guardado? Ábrelo en el{' '}
        <Link to={path('historial')} className="font-semibold text-brand-strong underline underline-offset-4 dark:text-brand">
          historial
        </Link>{' '}
        y pulsa «Corregir».
      </p>
    </>
  );
}

/** Carga equipos, planes, proveedores y personal para los formularios. */
export function useFormContext(): { ctx: FormContext | null; error: unknown; retry: () => void } {
  const { orgId, tz } = useOrgContext();
  const eq = useEquipment(orgId);
  const plans = useCleaningPlans(orgId);
  const sup = useSuppliers(orgId);
  const staff = useStaff(orgId);
  const all = [eq, plans, sup, staff];
  const error = all.find((q) => q.isError)?.error ?? null;
  const retry = () => all.forEach((q) => void q.refetch());
  if (!eq.data || !plans.data || !sup.data || !staff.data) return { ctx: null, error, retry };
  return { ctx: { equipment: eq.data, cleaningPlans: plans.data, suppliers: sup.data, staff: staff.data, timezone: tz }, error, retry };
}

export function RegisterTypePage() {
  const { type } = useParams();
  const [params] = useSearchParams();
  const { orgId, path } = useOrgContext();
  const qc = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const { ctx, error, retry } = useFormContext();
  const [staffId, setStaffId] = useState('');
  const [saving, setSaving] = useState(false);
  const [serverError, setServerError] = useState<unknown>(null);
  const [saved, setSaved] = useState<AppRecord | null>(null);
  const [formKey, setFormKey] = useState(0);
  useDocumentTitle(isRecordType(type) ? `Registrar ${RECORD_SHORT[type].toLowerCase()}` : 'Registrar');

  if (!isRecordType(type)) return <Navigate to={path('registrar')} replace />;

  const preset: Record<string, string> = {};
  const eqParam = params.get('equipo');
  const planParam = params.get('plan');
  if (eqParam) preset.equipmentId = eqParam;
  if (planParam) preset.cleaningPlanId = planParam;

  const submit = async (data: unknown) => {
    setSaving(true);
    setServerError(null);
    try {
      const record = await orgApi(orgId).createRecord({ type, data, staffId: staffId || null });
      await qc.invalidateQueries({ queryKey: ['org', orgId] });
      setSaved(record);
      toast.show(record.alert ? 'Registro guardado con alerta' : 'Registro guardado', record.alert ? 'bad' : 'ok');
      window.scrollTo({ top: 0 });
    } catch (err) {
      setServerError(err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Link to={path('registrar')} className="mb-3 inline-flex min-h-11 items-center gap-1 font-semibold text-ink-muted hover:text-ink">
        <Icon name="chevronLeft" size={20} /> Tipos de registro
      </Link>
      <PageHeader
        title={
          <span className="inline-flex items-center gap-3">
            <span className={cn('grid size-12 place-items-center rounded-2xl', RECORD_TINT[type])}>
              <Icon name={RECORD_ICON[type]} size={26} />
            </span>
            {RECORD_TYPE_LABELS[type]}
          </span>
        }
      />
      {saved ? (
        <SavedPanel
          record={saved}
          onAnother={() => {
            setSaved(null);
            setFormKey((k) => k + 1);
            if (eqParam || planParam) navigate(path(`registrar/${type}`), { replace: true });
          }}
        />
      ) : error ? (
        <ErrorState error={error} onRetry={retry} />
      ) : !ctx ? (
        <LoadingBlock rows={4} />
      ) : (
        <Card className="max-w-3xl">
          <WriteGuard what="añadir registros">
            <RecordForm
              key={`${type}-${formKey}`}
              type={type}
              ctx={ctx}
              preset={preset}
              onSubmit={(d) => void submit(d)}
              submitting={saving}
              serverError={serverError}
              footer={
                ctx.staff.filter((s) => s.active !== false).length > 0 ? (
                  <Field label="¿Quién lo ha hecho?" optional hint="Persona del personal que firma el registro. Tú quedas registrado igualmente como usuario.">
                    <Select value={staffId} onChange={(e) => setStaffId(e.target.value)}>
                      <option value="">Solo yo</option>
                      {ctx.staff
                        .filter((s) => s.active !== false)
                        .map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name}
                          </option>
                        ))}
                    </Select>
                  </Field>
                ) : null
              }
            />
          </WriteGuard>
        </Card>
      )}
    </>
  );
}

function SavedPanel({ record, onAnother }: { record: AppRecord; onAnother: () => void }) {
  const { path } = useOrgContext();
  const s = recordSummary(record);
  return (
    <div
      role="status"
      className={cn('max-w-3xl animate-fade-up rounded-3xl border-2 p-6 text-center sm:p-10', record.alert ? 'border-bad/50 bg-bad-soft' : 'border-ok/40 bg-ok-soft')}
      data-testid="record-saved"
    >
      <span className={cn('mx-auto grid size-20 animate-pop place-items-center rounded-3xl text-white shadow-pop', record.alert ? 'bg-bad-solid' : 'bg-ok-solid')}>
        <Icon name={record.alert ? 'alert' : 'check'} size={44} strokeWidth={3} />
      </span>
      <h2 className="mt-5 text-3xl font-extrabold">{record.alert ? 'Guardado, con alerta' : 'Hecho'}</h2>
      <p className="mt-2 text-lg font-semibold">{s.title}</p>
      <p className="text-ink-muted">{s.detail}</p>
      <div className="mx-auto mt-7 grid max-w-md gap-3 sm:grid-cols-2">
        <Button size="lg" icon="plus" onClick={onAnother}>
          Registrar otro
        </Button>
        <LinkButton to={path('hoy')} size="lg" variant="secondary" icon="today">
          Volver a Hoy
        </LinkButton>
      </div>
      <Link to={path(`historial/${record.id}`)} className="mt-4 inline-flex min-h-11 items-center font-semibold underline underline-offset-4">
        Ver el registro
      </Link>
    </div>
  );
}
