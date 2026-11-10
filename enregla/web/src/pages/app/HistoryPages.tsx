import { useMemo, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { RECORD_TYPES, RECORD_TYPE_LABELS } from '@shared/schemas';
import { orgApi, useRecord, useRecords, type RecordFilters } from '@/api/queries';
import { isApiError } from '@/api/client';
import type { AppRecord, RecordType } from '@/api/types';
import { useOrgContext } from '@/hooks/useOrgContext';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { Button } from '@/components/ui/Button';
import { Badge, Callout, EmptyState, ErrorState, LoadingBlock } from '@/components/ui/Feedback';
import { Card, DetailList, PageHeader } from '@/components/ui/Layout';
import { Field, Input, Select, Switch, Textarea } from '@/components/ui/Form';
import { useToast } from '@/components/ui/Overlay';
import { Icon } from '@/components/icons/Icon';
import { RECORD_ICON, RECORD_SHORT, RECORD_TINT, isRecordType, recordSummary, signer } from '@/features/recordMeta';
import { RecordForm } from '@/features/RecordForms';
import { WriteGuard } from '@/features/SubscriptionBanner';
import { useFormContext } from './RecordPages';
import { formatDateTime, formatLocalDate, formatLongDate, formatNumber, formatRange, formatTemp, formatTime, localDateIn } from '@/lib/format';
import { cn } from '@/lib/cn';

// ===========================================================================
// LISTADO
// ===========================================================================
export function HistoryPage() {
  const { orgId, tz, path } = useOrgContext();
  useDocumentTitle('Historial');
  const [params, setParams] = useSearchParams();
  const filters: RecordFilters = {
    type: isRecordType(params.get('tipo') ?? undefined) ? (params.get('tipo') as RecordType) : '',
    from: params.get('desde') ?? '',
    to: params.get('hasta') ?? '',
    alert: params.get('alertas') === '1' ? 'true' : '',
  };
  const setFilter = (k: string, v: string) => {
    const n = new URLSearchParams(params);
    if (v) n.set(k, v);
    else n.delete(k);
    setParams(n, { replace: true });
  };
  const dateError = filters.from && filters.to && filters.from > filters.to ? 'La fecha «desde» debe ser anterior a «hasta»' : null;
  const q = useRecords(orgId, dateError ? { ...filters, from: '', to: '' } : filters);
  const items = useMemo(() => q.data?.pages.flatMap((p) => p.items) ?? [], [q.data]);
  const groups = useMemo(() => {
    const m = new Map<string, AppRecord[]>();
    for (const r of items) {
      const d = localDateIn(tz, new Date(r.createdAt));
      m.set(d, [...(m.get(d) ?? []), r]);
    }
    return [...m.entries()];
  }, [items, tz]);
  const anyFilter = !!(filters.type || filters.from || filters.to || filters.alert);

  return (
    <>
      <PageHeader title="Historial" subtitle="Todos los registros, del más reciente al más antiguo. Los registros no se borran: las correcciones quedan enlazadas." />
      <Card className="mb-6">
        <h2 className="sr-only">Filtros</h2>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Field label="Tipo" className="col-span-2 lg:col-span-1">
            <Select value={filters.type} onChange={(e) => setFilter('tipo', e.target.value)}>
              <option value="">Todos</option>
              {RECORD_TYPES.map((t) => (
                <option key={t} value={t}>
                  {RECORD_TYPE_LABELS[t]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Desde" error={dateError}>
            <Input type="date" value={filters.from} onChange={(e) => setFilter('desde', e.target.value)} />
          </Field>
          <Field label="Hasta">
            <Input type="date" value={filters.to} onChange={(e) => setFilter('hasta', e.target.value)} />
          </Field>
          <div className="col-span-2 flex items-end lg:col-span-1">
            <Switch checked={filters.alert === 'true'} onChange={(v) => setFilter('alertas', v ? '1' : '')} label="Solo alertas" />
          </div>
        </div>
        {anyFilter ? (
          <button type="button" onClick={() => setParams({}, { replace: true })} className="mt-3 min-h-11 font-semibold text-brand-strong underline underline-offset-4 dark:text-brand">
            Quitar filtros
          </button>
        ) : null}
      </Card>

      {q.isPending ? (
        <LoadingBlock rows={6} label="Cargando registros…" />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : items.length === 0 ? (
        <EmptyState
          icon="history"
          title={anyFilter ? 'No hay registros con estos filtros' : 'Todavía no hay registros'}
          action={
            anyFilter ? (
              <Button variant="secondary" onClick={() => setParams({}, { replace: true })}>
                Quitar filtros
              </Button>
            ) : (
              <Link to={path('registrar')} className="font-semibold text-brand-strong underline underline-offset-4 dark:text-brand">
                Hacer el primer registro
              </Link>
            )
          }
        >
          {anyFilter ? 'Prueba con otras fechas u otro tipo.' : 'Los registros que hagáis desde la web o la tablet de cocina aparecerán aquí.'}
        </EmptyState>
      ) : (
        <div className="space-y-6" aria-live="polite">
          {groups.map(([date, list]) => (
            <section key={date} aria-labelledby={`d-${date}`}>
              <h2 id={`d-${date}`} className="mb-2 text-base font-bold text-ink-muted first-letter:uppercase">
                {formatLongDate(date)}
              </h2>
              <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface shadow-card">
                {list.map((r) => (
                  <RecordRow key={r.id} record={r} tz={tz} to={path(`historial/${r.id}`)} />
                ))}
              </ul>
            </section>
          ))}
          {q.hasNextPage ? (
            <div className="text-center">
              <Button variant="secondary" size="lg" onClick={() => void q.fetchNextPage()} loading={q.isFetchingNextPage}>
                Cargar más
              </Button>
            </div>
          ) : (
            <p className="text-center text-sm text-ink-muted">No hay más registros.</p>
          )}
        </div>
      )}
    </>
  );
}

function RecordRow({ record: r, tz, to }: { record: AppRecord; tz: string; to: string }) {
  const s = recordSummary(r);
  return (
    <li>
      <Link to={to} className="flex items-center gap-3 px-4 py-3.5 transition-colors hover:bg-surface-2">
        <span className={cn('grid size-11 shrink-0 place-items-center rounded-xl', RECORD_TINT[r.type])}>
          <Icon name={RECORD_ICON[r.type]} size={22} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block font-semibold break-words">{s.title}</span>
          <span className="block text-sm text-ink-muted">
            {formatTime(r.createdAt, tz)} · {RECORD_SHORT[r.type]} · {signer(r)}
          </span>
          <span className={cn('block text-sm', r.alert ? 'font-semibold text-bad' : 'text-ink-muted')}>{s.detail}</span>
        </span>
        <span className="flex shrink-0 flex-col items-end gap-1">
          {r.alert ? <Badge tone="bad" icon="alert">Alerta</Badge> : null}
          {r.amendedByRecordId ? <Badge tone="warn" icon="pencil">Corregido</Badge> : null}
          {r.amendsRecordId ? <Badge tone="info" icon="pencil">Corrección</Badge> : null}
        </span>
        <Icon name="chevronRight" className="hidden shrink-0 text-ink-muted sm:block" />
      </Link>
    </li>
  );
}

// ===========================================================================
// DETALLE
// ===========================================================================
function RecordDetails({ record: r }: { record: AppRecord }) {
  const items: { label: ReactNode; value: ReactNode }[] = [];
  switch (r.type) {
    case 'temperatura':
      items.push(
        { label: 'Equipo', value: r.data.equipmentName },
        { label: 'Temperatura', value: <span className="font-display text-2xl tabular">{formatTemp(r.data.value)}</span> },
        { label: 'Rango del equipo', value: formatRange(r.data.minTemp, r.data.maxTemp) },
        { label: 'Resultado', value: r.data.outOfRange ? <Badge tone="bad" icon="alert">Fuera de rango</Badge> : <Badge tone="ok" icon="check">Dentro de rango</Badge> },
        { label: 'Acción correctora', value: r.data.correctiveAction ?? '—' },
      );
      break;
    case 'limpieza':
      items.push(
        { label: 'Plan', value: r.data.planName },
        { label: 'Estado', value: r.data.completed ? <Badge tone="ok" icon="check">Completa</Badge> : <Badge tone="warn">Incompleta</Badge> },
        {
          label: 'Zonas',
          value: (
            <ul className="space-y-1 font-normal">
              {r.data.items.map((i) => (
                <li key={i.itemId} className="flex items-center gap-2">
                  <Icon name={i.done ? 'check' : 'x'} size={18} className={i.done ? 'text-ok' : 'text-bad'} strokeWidth={2.5} />
                  {i.area}
                  <span className="sr-only">{i.done ? 'hecha' : 'no hecha'}</span>
                </li>
              ))}
            </ul>
          ),
        },
        { label: 'Observaciones', value: r.data.observations ?? '—' },
      );
      break;
    case 'recepcion':
      items.push(
        { label: 'Proveedor', value: r.data.supplierName },
        { label: 'Producto', value: r.data.product },
        { label: 'Lote', value: r.data.lot ?? '—' },
        { label: 'Temperatura', value: formatTemp(r.data.temperature) },
        { label: 'Caducidad', value: r.data.expiryDate ? formatLocalDate(r.data.expiryDate) : '—' },
        { label: 'Resultado', value: r.data.accepted ? <Badge tone="ok" icon="check">Aceptada</Badge> : <Badge tone="bad" icon="x">Rechazada</Badge> },
        ...(r.data.accepted ? [] : [{ label: 'Motivo del rechazo', value: r.data.rejectionReason ?? '—' }]),
      );
      break;
    case 'aceite':
      items.push(
        { label: 'Freidora', value: r.data.fryerName },
        { label: 'Acción', value: r.data.action === 'cambiado' ? 'Aceite cambiado' : 'Aceite revisado' },
        { label: 'Compuestos polares', value: r.data.polarCompounds != null ? `${formatNumber(r.data.polarCompounds)} %` : '—' },
        { label: 'Resultado', value: r.data.overLimit ? <Badge tone="bad" icon="alert">Por encima del límite</Badge> : <Badge tone="ok" icon="check">Correcto</Badge> },
        { label: 'Acción correctora', value: r.data.correctiveAction ?? '—' },
      );
      break;
    case 'plagas':
      items.push(
        { label: 'Resultado', value: r.data.result === 'sin_indicios' ? <Badge tone="ok" icon="check">Sin indicios</Badge> : <Badge tone="bad" icon="alert">Con indicios</Badge> },
        { label: 'Descripción', value: r.data.description ?? '—' },
        { label: 'Acción', value: r.data.action ?? '—' },
      );
      break;
    case 'incidencia':
      items.push(
        { label: 'Descripción', value: r.data.description },
        { label: 'Acción correctora', value: r.data.correctiveAction ?? '—' },
        { label: 'Estado', value: r.data.closed ? <Badge tone="ok" icon="check">Cerrada</Badge> : <Badge tone="warn" icon="clock">Abierta</Badge> },
      );
      break;
    case 'formacion':
      items.push(
        { label: 'Persona', value: r.data.traineeName },
        { label: 'Curso', value: r.data.course },
        { label: 'Fecha', value: formatLocalDate(r.data.trainingDate) },
        { label: 'Formador', value: r.data.trainer ?? '—' },
        { label: 'Horas', value: r.data.hours != null ? formatNumber(r.data.hours) : '—' },
      );
      break;
  }
  return <DetailList items={items} />;
}

export function RecordDetailPage() {
  const { recordId = '' } = useParams();
  const { orgId, tz, path } = useOrgContext();
  const q = useRecord(orgId, recordId);
  const [mode, setMode] = useState<'view' | 'amend' | 'close'>('view');
  useDocumentTitle('Detalle del registro');

  if (q.isPending) return <LoadingBlock rows={4} />;
  if (q.isError) {
    if (isApiError(q.error) && q.error.code === 'NOT_FOUND') {
      return (
        <EmptyState icon="history" title="Registro no encontrado" action={<Link to={path('historial')} className="font-semibold underline">Volver al historial</Link>}>
          Puede que el enlace no sea correcto.
        </EmptyState>
      );
    }
    return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  }
  const { record: r, amends, amendedBy } = q.data;
  const s = recordSummary(r);
  const openIncident = r.type === 'incidencia' && !r.data.closed && !r.amendedByRecordId;

  return (
    <>
      <Link to={path('historial')} className="mb-3 inline-flex min-h-11 items-center gap-1 font-semibold text-ink-muted hover:text-ink">
        <Icon name="chevronLeft" size={20} /> Historial
      </Link>
      <PageHeader
        eyebrow={RECORD_TYPE_LABELS[r.type]}
        title={s.title}
        subtitle={`${formatDateTime(r.createdAt, tz)} · ${signer(r)}`}
        actions={
          mode === 'view' && !r.amendedByRecordId ? (
            <>
              {openIncident ? (
                <Button variant="ok" icon="check" onClick={() => setMode('close')}>
                  Cerrar incidencia
                </Button>
              ) : null}
              <Button variant="secondary" icon="pencil" onClick={() => setMode('amend')}>
                Corregir
              </Button>
            </>
          ) : null
        }
      />
      <div className="space-y-4">
        {amendedBy ? (
          <Callout
            tone="warn"
            icon="pencil"
            title="Este registro fue corregido"
            action={
              <Link to={path(`historial/${amendedBy.id}`)} className="font-semibold underline underline-offset-4">
                Ver la versión corregida
              </Link>
            }
          >
            Motivo: {amendedBy.amendmentReason} · {formatDateTime(amendedBy.createdAt, tz)} · {signer(amendedBy)}
          </Callout>
        ) : null}
        {amends ? (
          <Callout
            tone="info"
            icon="pencil"
            title="Este registro es una corrección"
            action={
              <Link to={path(`historial/${amends.id}`)} className="font-semibold underline underline-offset-4">
                Ver el original
              </Link>
            }
          >
            Motivo: {r.amendmentReason}. Original del {formatDateTime(amends.createdAt, tz)}: {recordSummary(amends).title}.
          </Callout>
        ) : null}
        {mode === 'view' ? (
          <Card>
            <div className="mb-4 flex items-center gap-3">
              <span className={cn('grid size-12 place-items-center rounded-2xl', RECORD_TINT[r.type])}>
                <Icon name={RECORD_ICON[r.type]} size={26} />
              </span>
              {r.alert ? <Badge tone="bad" icon="alert">Alerta</Badge> : <Badge tone="ok" icon="check">Sin alerta</Badge>}
            </div>
            <RecordDetails record={r} />
            <dl className="mt-6 grid gap-x-6 gap-y-3 border-t border-line pt-4 text-sm sm:grid-cols-3">
              <div>
                <dt className="text-ink-muted">Firmado por (personal)</dt>
                <dd className="font-semibold">{r.staff?.name ?? '—'}</dd>
              </div>
              <div>
                <dt className="text-ink-muted">Usuario</dt>
                <dd className="font-semibold">{r.user?.name ?? (r.deviceId ? 'Tablet de cocina' : '—')}</dd>
              </div>
              <div>
                <dt className="text-ink-muted">Hora del servidor</dt>
                <dd className="font-semibold">{formatDateTime(r.createdAt, tz)}</dd>
              </div>
            </dl>
          </Card>
        ) : (
          <AmendForm record={r} close={mode === 'close'} onCancel={() => setMode('view')} />
        )}
      </div>
    </>
  );
}

function AmendForm({ record, close, onCancel }: { record: AppRecord; close: boolean; onCancel: () => void }) {
  const { orgId, path } = useOrgContext();
  const { ctx, error, retry } = useFormContext();
  const qc = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const [reason, setReason] = useState(close ? 'Incidencia resuelta' : '');
  const [reasonError, setReasonError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [serverError, setServerError] = useState<unknown>(null);

  const submit = async (data: unknown) => {
    if (!reason.trim()) {
      setReasonError('Indica el motivo de la corrección');
      document.getElementById('amend-reason')?.focus();
      return;
    }
    setReasonError(null);
    setSaving(true);
    setServerError(null);
    try {
      const amended = await orgApi(orgId).amend(record.id, { reason: reason.trim(), data, staffId: record.staff?.id ?? null });
      await qc.invalidateQueries({ queryKey: ['org', orgId] });
      toast.show(close ? 'Incidencia cerrada' : 'Corrección guardada');
      navigate(path(`historial/${amended.id}`));
    } catch (err) {
      setServerError(err);
      if (isApiError(err)) {
        const r = err.details.find((d) => d.path === 'reason');
        if (r) setReasonError(r.message);
      }
    } finally {
      setSaving(false);
    }
  };

  // Para corregir se usa la entrada completa: los datos almacenados sirven de valores iniciales.
  // El firmante del original se conserva si sigue activo.
  return (
    <Card>
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold">{close ? 'Cerrar la incidencia' : 'Corregir el registro'}</h2>
          <p className="text-ink-muted">
            {close
              ? 'Se guarda como una corrección con el estado «cerrada»; el registro original se conserva.'
              : 'El registro original no se borra: se guarda una versión corregida con el motivo, tu nombre y la hora.'}
          </p>
        </div>
        <Button variant="ghost" onClick={onCancel}>
          Cancelar
        </Button>
      </div>
      {error ? (
        <ErrorState error={error} onRetry={retry} />
      ) : !ctx ? (
        <LoadingBlock />
      ) : (
        <WriteGuard what="corregir registros">
          <RecordForm
            type={record.type}
            ctx={ctx}
            initial={record.data as never}
            forceClosed={close}
            onSubmit={(d) => void submit(d)}
            submitting={saving}
            serverError={serverError}
            submitLabel={close ? 'Cerrar incidencia' : 'Guardar corrección'}
            footer={
              <Field label="Motivo de la corrección" error={reasonError} id="amend-reason">
                <Textarea value={reason} onChange={(e) => setReason(e.target.value)} maxLength={1000} rows={2} placeholder="Ej.: se apuntó en el equipo equivocado" />
              </Field>
            }
          />
        </WriteGuard>
      )}
    </Card>
  );
}
