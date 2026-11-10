import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { RECORD_TYPES, RECORD_TYPE_LABELS } from '@shared/schemas';
import { useCompliance, useToday } from '@/api/queries';
import type { Compliance, RecordType, TodayTasks } from '@/api/types';
import { useOrgContext } from '@/hooks/useOrgContext';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { LinkButton, buttonClasses } from '@/components/ui/Button';
import { Badge, Callout, EmptyState, ErrorState, ProgressRing, Skeleton } from '@/components/ui/Feedback';
import { Card, PageHeader, SectionTitle } from '@/components/ui/Layout';
import { Checkbox, Field, Input } from '@/components/ui/Form';
import { Icon } from '@/components/icons/Icon';
import { ALERT_LABELS, RECORD_ICON, RECORD_TINT } from '@/features/recordMeta';
import { DownloadButton } from '@/features/DownloadButton';
import { addDaysIso, formatLocalDate, formatLongDate, formatPercent, formatRange, formatTemp, formatTime, localDateIn, relativeDays } from '@/lib/format';
import { cn } from '@/lib/cn';

// ===========================================================================
// HOY
// ===========================================================================
export function TodayPage() {
  const { orgId, org, tz, path } = useOrgContext();
  useDocumentTitle('Hoy');
  const q = useToday(orgId);

  return (
    <>
      <PageHeader
        eyebrow={org.name}
        title={q.data ? <span className="inline-block first-letter:uppercase">{formatLongDate(q.data.date)}</span> : 'Hoy'}
        actions={
          <>
            <LinkButton to={path('registrar/temperatura')} icon="thermometer" size="lg" className="max-sm:flex-1">
              Temperatura
            </LinkButton>
            <LinkButton to={path('registrar')} icon="plus" variant="secondary" size="lg" className="max-sm:flex-1">
              Otro registro
            </LinkButton>
          </>
        }
      />
      {q.isPending ? (
        <div role="status" className="space-y-4">
          <span className="sr-only">Cargando las tareas de hoy…</span>
          <Skeleton className="h-40" />
          <div className="grid gap-3 sm:grid-cols-2">
            <Skeleton className="h-24" />
            <Skeleton className="h-24" />
            <Skeleton className="h-24" />
            <Skeleton className="h-24" />
          </div>
        </div>
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} title="No hemos podido cargar las tareas de hoy" />
      ) : (
        <TodayContent data={q.data} tz={tz} />
      )}
    </>
  );
}

function TodayContent({ data, tz }: { data: TodayTasks; tz: string }) {
  const { path } = useOrgContext();
  // Lo dado de alta (o reactivado) hoy se muestra aparte: no es exigible hasta mañana ni cuenta en el progreso.
  const counted = { temps: data.temperatures.filter((t) => t.countsToday !== false), clean: data.cleaning.filter((c) => c.countsToday !== false) };
  const pendingTemps = counted.temps.filter((t) => t.status === 'pending');
  const doneTemps = counted.temps.filter((t) => t.status === 'done');
  const pendingClean = counted.clean.filter((c) => c.status === 'pending');
  const doneClean = counted.clean.filter((c) => c.status === 'done');
  const notYetTemps = data.temperatures.filter((t) => t.countsToday === false);
  const notYetClean = data.cleaning.filter((c) => c.countsToday === false);
  const { summary } = data;
  const allDone = summary.total > 0 && summary.pending === 0;
  const subCard = useSubscriptionNotice();

  return (
    <div className="space-y-8">
      <section aria-labelledby="resumen" className={cn('grid gap-4', subCard && 'lg:grid-cols-[1.4fr_1fr]')}>
        <Card className="flex items-center gap-5">
          {summary.total > 0 ? (
            <ProgressRing percent={summary.percent} label={`${formatPercent(summary.percent)} de las tareas de hoy hechas`} />
          ) : (
            <span className="grid size-28 shrink-0 place-items-center rounded-full bg-surface-2 text-ink-muted" aria-hidden="true">
              <Icon name="today" size={40} />
            </span>
          )}
          <div className="min-w-0">
            <h2 id="resumen" className="text-2xl font-extrabold">
              {summary.total === 0
                ? notYetTemps.length + notYetClean.length > 0
                  ? 'Nada obligatorio hoy'
                  : 'Sin tareas programadas'
                : allDone
                  ? '¡Todo hecho por hoy!'
                  : `Quedan ${summary.pending} de ${summary.total}`}
            </h2>
            <p className="mt-1 text-ink-muted">
              {summary.total === 0
                ? notYetTemps.length + notYetClean.length > 0
                  ? 'Lo dado de alta hoy empieza a contar mañana. Puedes ir registrándolo.'
                  : 'No hay controles de temperatura ni limpiezas previstos para hoy.'
                : `${summary.done} ${summary.done === 1 ? 'tarea hecha' : 'tareas hechas'} · ${data.alerts.length === 0 ? 'sin alertas' : `${data.alerts.length} ${data.alerts.length === 1 ? 'alerta' : 'alertas'}`}`}
            </p>
            {allDone ? (
              <Badge tone="ok" icon="check" className="mt-2">
                Al día
              </Badge>
            ) : null}
          </div>
        </Card>
        {subCard ? <SubscriptionCard notice={subCard} /> : null}
      </section>

      {data.alerts.length > 0 ? (
        <section aria-labelledby="alertas">
          <SectionTitle id="alertas">
            <span className="inline-flex items-center gap-2">
              <Icon name="alert" className="text-bad" /> Alertas
            </span>
          </SectionTitle>
          <ul className="space-y-2.5">
            {data.alerts.map((a) => (
              <li key={`${a.kind}-${a.recordId}`}>
                <Link
                  to={path(`historial/${a.recordId}`)}
                  className="flex items-center gap-3 rounded-2xl border-2 border-bad/40 bg-bad-soft p-4 transition-colors hover:border-bad"
                >
                  <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-bad-solid text-white">
                    <Icon name="alert" size={22} />
                  </span>
                  <span className="min-w-0 flex-1">
                    {/* Prefijo para lectores de pantalla, salvo que el mensaje ya lo diga (evita «Incidencia abierta: Incidencia abierta:»). */}
                    {a.message.toLowerCase().startsWith(ALERT_LABELS[a.kind].toLowerCase()) ? null : <span className="sr-only">{ALERT_LABELS[a.kind]}: </span>}
                    <span className="block font-bold">{a.message}</span>
                    <span className="block text-sm text-ink-muted">
                      {a.kind === 'incidencia_abierta' ? `Desde el ${formatLocalDate(localDateIn(tz, new Date(a.createdAt)))}` : `A las ${formatTime(a.createdAt, tz)}`}
                      {a.kind === 'incidencia_abierta' ? ' · toca para cerrarla' : ''}
                    </span>
                  </span>
                  <Icon name="chevronRight" className="shrink-0 text-ink-muted" />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {summary.total === 0 && notYetTemps.length + notYetClean.length > 0 ? null : summary.total === 0 ? (
        <EmptyState
          icon="thermometer"
          title="Nada programado para hoy"
          action={
            <LinkButton to={path('ajustes/equipos')} variant="secondary">
              Revisar equipos y limpieza
            </LinkButton>
          }
        >
          Las tareas salen de los equipos con controles diarios y de los planes de limpieza que tocan hoy.
        </EmptyState>
      ) : (
        <>
          <section aria-labelledby="pendientes">
            <SectionTitle id="pendientes">Pendiente</SectionTitle>
            {pendingTemps.length + pendingClean.length === 0 ? (
              <Callout tone="ok" title="No queda nada pendiente">
                Buen trabajo. Si surge algo, regístralo desde «Otro registro».
              </Callout>
            ) : (
              <ul className="grid gap-3 sm:grid-cols-2">
                {pendingTemps.map((t) => (
                  <TaskCard
                    key={t.equipmentId}
                    to={path(`registrar/temperatura?equipo=${t.equipmentId}`)}
                    type="temperatura"
                    title={t.name}
                    detail={`${t.done} de ${t.required} ${t.required === 1 ? 'control' : 'controles'} · ${formatRange(t.minTemp, t.maxTemp)}`}
                    extra={t.lastReading ? `Última: ${formatTemp(t.lastReading.value)} a las ${formatTime(t.lastReading.at, tz)}` : undefined}
                    warn={t.lastReading?.outOfRange}
                  />
                ))}
                {pendingClean.map((c) => (
                  <TaskCard
                    key={c.cleaningPlanId}
                    to={path(`registrar/limpieza?plan=${c.cleaningPlanId}`)}
                    type="limpieza"
                    title={c.name}
                    detail={c.frequency === 'daily' ? 'Limpieza de hoy' : c.frequency === 'weekly' ? 'Toca esta semana' : 'Toca este mes'}
                    extra={c.partial ? `Parcial (${c.partial.done} de ${c.partial.total}) a las ${formatTime(c.partial.at, tz)}: falta completarla` : undefined}
                    warn={!!c.partial}
                  />
                ))}
              </ul>
            )}
          </section>
          {doneTemps.length + doneClean.length > 0 ? (
            <section aria-labelledby="hechas">
              <SectionTitle id="hechas">Hecho</SectionTitle>
              <ul className="divide-y divide-line rounded-2xl border border-line bg-surface">
                {doneTemps.map((t) => (
                  <li key={t.equipmentId} className="flex items-center gap-3 px-4 py-3">
                    <Icon name="check" className="shrink-0 text-ok" strokeWidth={2.5} />
                    <span className="min-w-0 flex-1">
                      <span className="block font-semibold">{t.name}</span>
                      <span className="block text-sm text-ink-muted">
                        {t.done} de {t.required} {t.required === 1 ? 'control' : 'controles'}
                        {t.lastReading ? ` · última ${formatTemp(t.lastReading.value)} a las ${formatTime(t.lastReading.at, tz)}` : ''}
                      </span>
                    </span>
                    {t.lastReading?.outOfRange ? <Badge tone="bad" icon="alert">Fuera de rango</Badge> : <Badge tone="ok" icon="check">Hecho</Badge>}
                  </li>
                ))}
                {doneClean.map((c) => (
                  <li key={c.cleaningPlanId} className="flex items-center gap-3 px-4 py-3">
                    <Icon name="check" className="shrink-0 text-ok" strokeWidth={2.5} />
                    <span className="min-w-0 flex-1">
                      <span className="block font-semibold">{c.name}</span>
                      <span className="block text-sm text-ink-muted">{c.completedAt ? `Hecha el ${formatLocalDate(localDateIn(tz, new Date(c.completedAt)))} a las ${formatTime(c.completedAt, tz)}` : 'Hecha'}</span>
                    </span>
                    <Badge tone="ok" icon="check">Hecho</Badge>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </>
      )}

      {notYetTemps.length + notYetClean.length > 0 ? (
        <section aria-labelledby="manana">
          <SectionTitle id="manana">Empieza a contar mañana</SectionTitle>
          <p className="-mt-2 mb-3 text-sm text-ink-muted">Dado de alta o reactivado hoy: puedes registrarlo ya, pero no cuenta en el progreso de hoy.</p>
          <ul className="grid gap-3 sm:grid-cols-2">
            {notYetTemps.map((t) => (
              <TaskCard
                key={t.equipmentId}
                to={path(`registrar/temperatura?equipo=${t.equipmentId}`)}
                type="temperatura"
                title={t.name}
                detail={`${t.done} de ${t.required} · ${formatRange(t.minTemp, t.maxTemp)}`}
                badge="Opcional hoy"
              />
            ))}
            {notYetClean.map((c) => (
              <TaskCard key={c.cleaningPlanId} to={path(`registrar/limpieza?plan=${c.cleaningPlanId}`)} type="limpieza" title={c.name} detail={c.status === 'done' ? 'Hecha' : 'Sin hacer'} badge="Opcional hoy" />
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

function TaskCard({ to, type, title, detail, extra, warn, badge = 'Pendiente' }: { to: string; type: RecordType; title: string; detail: string; extra?: string; warn?: boolean; badge?: string }) {
  const { readOnly } = useOrgContext();
  return (
    <li>
      <Link
        to={to}
        aria-disabled={readOnly || undefined}
        className="group flex min-h-24 min-w-0 items-center gap-3 rounded-2xl border border-line bg-surface p-4 shadow-card transition-[border-color,transform] hover:-translate-y-0.5 hover:border-brand"
      >
        <span className={cn('grid size-12 shrink-0 place-items-center rounded-2xl', RECORD_TINT[type])}>
          <Icon name={RECORD_ICON[type]} size={26} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block font-bold [overflow-wrap:anywhere]">{title}</span>
          <span className="block text-sm text-ink-muted">{detail}</span>
          {extra ? <span className={cn('mt-0.5 block text-sm', warn ? 'font-semibold text-bad' : 'text-ink-muted')}>{extra}</span> : null}
        </span>
        <span className={cn('hidden shrink-0 rounded-full px-2.5 py-0.5 text-sm font-bold min-[420px]:inline', badge === 'Pendiente' ? 'bg-warn-soft text-warn' : 'bg-surface-2 text-ink-muted')}>{badge}</span>
        <Icon name="chevronRight" className="shrink-0 text-ink-muted transition-transform group-hover:translate-x-0.5" />
      </Link>
    </li>
  );
}

type SubNotice = { tone: 'warn' | 'bad'; title: string; text: string; cta: string | null };

/**
 * La tarjeta de suscripción solo aparece cuando hay algo que decir: prueba a punto de acabar,
 * pago fallido o solo lectura. Si todo está en orden no ocupa sitio en «Hoy».
 */
function useSubscriptionNotice(): SubNotice | null {
  const { org, isOwner } = useOrgContext();
  const sub = org.subscription;
  if (org.deletionScheduledAt) return null; // ya hay un aviso persistente de eliminación
  if (sub.readOnly) return { tone: 'bad', title: 'Solo lectura', text: 'No se pueden añadir registros hasta activar la suscripción.', cta: isOwner ? 'Elegir plan' : null };
  if (sub.paymentFailed) return { tone: 'bad', title: 'Pago pendiente', text: 'No hemos podido cobrar la suscripción.', cta: isOwner ? 'Ver facturación' : null };
  if (sub.status === 'trialing' && !sub.hasBillingAccount) {
    const days = relativeDays(sub.trialEndsAt);
    if (days <= 7) {
      return {
        tone: 'warn',
        title: 'Prueba gratuita',
        text: days > 0 ? `Te ${days === 1 ? 'queda 1 día' : `quedan ${days} días`} de prueba.` : 'La prueba termina hoy.',
        cta: isOwner ? 'Elegir plan' : null,
      };
    }
  }
  return null;
}

function SubscriptionCard({ notice }: { notice: SubNotice }) {
  const { path } = useOrgContext();
  return (
    <Card className="flex flex-col justify-center gap-2" data-testid="subscription-card">
      <Badge tone={notice.tone} icon={notice.tone === 'bad' ? 'lock' : 'clock'} className="self-start">
        {notice.title}
      </Badge>
      <p className="text-ink-muted">{notice.text}</p>
      {notice.cta ? (
        <Link to={path('facturacion')} className={buttonClasses(notice.tone === 'bad' ? 'danger' : 'secondary', 'md', 'self-start')}>
          {notice.cta}
        </Link>
      ) : null}
    </Card>
  );
}

// ===========================================================================
// INFORMES
// ===========================================================================
type Preset = '7' | '30' | 'month' | 'prev-month' | '90' | 'custom';

function presetRange(preset: Preset, today: string): { from: string; to: string } {
  switch (preset) {
    case '7':
      return { from: addDaysIso(today, -6), to: today };
    case '30':
      return { from: addDaysIso(today, -29), to: today };
    case '90':
      return { from: addDaysIso(today, -89), to: today };
    case 'month':
      return { from: `${today.slice(0, 8)}01`, to: today };
    case 'prev-month': {
      const firstThis = `${today.slice(0, 8)}01`;
      const lastPrev = addDaysIso(firstThis, -1);
      return { from: `${lastPrev.slice(0, 8)}01`, to: lastPrev };
    }
    default:
      return { from: addDaysIso(today, -29), to: today };
  }
}

const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;

export function ReportsPage() {
  const { orgId, tz, org } = useOrgContext();
  useDocumentTitle('Informes');
  const today = localDateIn(tz);
  const [preset, setPreset] = useState<Preset>('30');
  const [custom, setCustom] = useState(() => presetRange('30', today));
  const range = preset === 'custom' ? custom : presetRange(preset, today);
  const [types, setTypes] = useState<Set<RecordType>>(new Set(RECORD_TYPES));

  const days = daysBetween(range.from, range.to);
  const rangeError = !range.from || !range.to ? 'Elige las dos fechas' : range.from > range.to ? 'La fecha inicial debe ser anterior a la final' : days > 366 ? 'El periodo máximo es de un año' : null;

  const compFrom = days > 92 ? addDaysIso(range.to, -91) : range.from;
  const compliance = useCompliance(orgId, compFrom, range.to, !rangeError);

  const typeParam = types.size === RECORD_TYPES.length ? '' : [...types].join(',');
  const query = new URLSearchParams({ from: range.from, to: range.to, ...(typeParam ? { types: typeParam } : {}) }).toString();
  const canDownload = !rangeError && types.size > 0;

  const presets: { v: Preset; label: string }[] = [
    { v: '7', label: 'Últimos 7 días' },
    { v: '30', label: 'Últimos 30 días' },
    { v: 'month', label: 'Este mes' },
    { v: 'prev-month', label: 'Mes pasado' },
    { v: '90', label: 'Últimos 3 meses' },
    { v: 'custom', label: 'Otras fechas' },
  ];

  return (
    <>
      <PageHeader title="Informes" subtitle="Descarga tus registros para la inspección o para tu asesor. También funciona en modo solo lectura." />
      <div className="grid gap-6 xl:grid-cols-[1fr_1.1fr]">
        <Card>
          <h2 className="text-xl font-bold">1. Periodo</h2>
          <div className="mt-3 flex flex-wrap gap-2" role="radiogroup" aria-label="Periodo">
            {presets.map((p) => (
              <button
                key={p.v}
                type="button"
                role="radio"
                aria-checked={preset === p.v}
                onClick={() => {
                  if (p.v === 'custom') setCustom(range);
                  setPreset(p.v);
                }}
                className={cn(
                  'min-h-12 rounded-xl border-2 px-4 font-semibold',
                  preset === p.v ? 'border-brand bg-brand-soft' : 'border-line bg-surface hover:border-line-strong',
                )}
              >
                {p.label}
              </button>
            ))}
          </div>
          {preset === 'custom' ? (
            <div className="mt-4 grid grid-cols-2 gap-3">
              <Field label="Desde">
                <Input type="date" value={custom.from} max={today} onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value }))} />
              </Field>
              <Field label="Hasta">
                <Input type="date" value={custom.to} max={today} onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value }))} />
              </Field>
            </div>
          ) : (
            <p className="mt-3 text-ink-muted">
              Del {formatLocalDate(range.from)} al {formatLocalDate(range.to)} ({days} días)
            </p>
          )}
          {rangeError ? (
            <p role="alert" className="mt-2 font-semibold text-bad">
              {rangeError}
            </p>
          ) : null}

          <h2 className="mt-6 text-xl font-bold">2. Qué registros</h2>
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" className="min-h-10 rounded-lg px-2 font-semibold text-brand-strong underline underline-offset-4 dark:text-brand" onClick={() => setTypes(new Set(RECORD_TYPES))}>
              Todos
            </button>
            <button type="button" className="min-h-10 rounded-lg px-2 font-semibold text-brand-strong underline underline-offset-4 dark:text-brand" onClick={() => setTypes(new Set())}>
              Ninguno
            </button>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-2">
            {RECORD_TYPES.map((t) => (
              <Checkbox
                key={t}
                checked={types.has(t)}
                onChange={(v) =>
                  setTypes((s) => {
                    const n = new Set(s);
                    if (v) n.add(t);
                    else n.delete(t);
                    return n;
                  })
                }
                label={RECORD_TYPE_LABELS[t]}
              />
            ))}
          </div>
          {types.size === 0 ? (
            <p role="alert" className="font-semibold text-bad">
              Elige al menos un tipo
            </p>
          ) : null}

          <h2 className="mt-6 text-xl font-bold">3. Descargar</h2>
          <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-1">
            <DownloadButton disabled={!canDownload} url={`/api/orgs/${orgId}/reports/pdf?${query}`} fallbackName="registros.pdf" icon="report" variant="primary">
              Informe PDF
            </DownloadButton>
            <DownloadButton disabled={!canDownload} url={`/api/orgs/${orgId}/reports/csv?${query}`} fallbackName="registros.csv">
              Hoja de cálculo (CSV)
            </DownloadButton>
          </div>
          <p className="mt-3 text-sm text-ink-muted">
            El PDF incluye los datos de {org.name}, una tabla por tipo, lo que está fuera de rango señalado y las correcciones con su motivo. Si el periodo tiene demasiados registros para un PDF, acota las fechas o usa el CSV.
          </p>
        </Card>
        <Card>
          <h2 className="text-xl font-bold">Resumen de tareas hechas</h2>
          <p className="text-sm text-ink-muted">
            Controles de temperatura y limpiezas previstos frente a hechos
            {days > 92 && !rangeError ? ` (últimos 92 días del periodo: desde el ${formatLocalDate(compFrom)})` : ''}. Usa la configuración actual de equipos y planes.
          </p>
          <div className="mt-4">
            {rangeError ? (
              <p className="text-ink-muted">Elige un periodo válido.</p>
            ) : compliance.isPending ? (
              <Skeleton className="h-56" />
            ) : compliance.isError ? (
              <ErrorState error={compliance.error} onRetry={() => void compliance.refetch()} />
            ) : (
              <ComplianceChart data={compliance.data} />
            )}
          </div>
        </Card>
      </div>
    </>
  );
}

/** Gráfico de barras propio (SVG): % de tareas hechas por día. Con tabla accesible. */
export function ComplianceChart({ data }: { data: Compliance }) {
  const [showTable, setShowTable] = useState(false);
  const days = data.days;
  const W = 640;
  const H = 200;
  const pad = { l: 40, r: 8, t: 10, b: 28 };
  const innerW = W - pad.l - pad.r;
  const innerH = H - pad.t - pad.b;
  const bw = days.length ? innerW / days.length : innerW;
  const labelEvery = Math.max(1, Math.ceil(days.length / 8));
  const summary = useMemo(() => {
    const withData = days.filter((d) => d.percent != null);
    const full = withData.filter((d) => (d.percent ?? 0) >= 100).length;
    return { withData: withData.length, full };
  }, [days]);

  if (days.length === 0) return <p className="text-ink-muted">No hay días en este periodo.</p>;
  const overall = data.overall.percent;
  return (
    <div>
      <div className="mb-4 flex flex-wrap items-end gap-x-6 gap-y-2">
        <p>
          <span className="block font-display text-5xl font-extrabold tabular">{formatPercent(overall)}</span>
          <span className="text-ink-muted">
            {data.overall.done} de {data.overall.expected} tareas hechas
          </span>
        </p>
        <p className="text-ink-muted">
          {summary.full} de {summary.withData} días completos
        </p>
      </div>
      <figure>
        <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={`Porcentaje de tareas hechas por día, del ${formatLocalDate(data.from)} al ${formatLocalDate(data.to)}. Media: ${overall == null ? 'sin datos' : formatPercent(overall)}.`}>
          {[0, 50, 100].map((g) => {
            const y = pad.t + innerH - (g / 100) * innerH;
            return (
              <g key={g}>
                <line x1={pad.l} x2={W - pad.r} y1={y} y2={y} stroke="var(--line)" strokeDasharray={g === 0 ? undefined : '3 4'} />
                <text x={pad.l - 6} y={y + 4} textAnchor="end" fontSize="13" fill="var(--ink-muted)">
                  {formatPercent(g)}
                </text>
              </g>
            );
          })}
          {days.map((d, i) => {
            const p = d.percent ?? 0;
            const h = d.percent == null ? 0 : Math.max(2, (p / 100) * innerH);
            const x = pad.l + i * bw + bw * 0.15;
            const color = d.percent == null ? 'var(--surface-3)' : p >= 100 ? 'var(--ok-solid)' : p >= 75 ? 'var(--brand)' : p >= 50 ? 'var(--warn-solid)' : 'var(--bad-solid)';
            return (
              <g key={d.date}>
                {d.percent == null ? (
                  <rect x={x} y={pad.t + innerH - 3} width={bw * 0.7} height={3} rx={1} fill={color} />
                ) : (
                  <rect x={x} y={pad.t + innerH - h} width={bw * 0.7} height={h} rx={Math.min(3, bw * 0.2)} fill={color}>
                    <title>{`${formatLocalDate(d.date)}: ${formatPercent(p)} (${d.done} de ${d.expected})`}</title>
                  </rect>
                )}
                {i % labelEvery === 0 ? (
                  <text x={x + bw * 0.35} y={H - 8} textAnchor="middle" fontSize="13" fill="var(--ink-muted)">
                    {formatLocalDate(d.date, { day: 'numeric', month: 'short' }).replace('.', '')}
                  </text>
                ) : null}
              </g>
            );
          })}
        </svg>
        <figcaption className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-ink-muted">
          <span className="inline-flex items-center gap-1.5"><span className="size-3 rounded-sm bg-ok-solid" /> {formatPercent(100)}</span>
          <span className="inline-flex items-center gap-1.5"><span className="size-3 rounded-sm bg-brand" /> 75–99{'\u202F'}%</span>
          <span className="inline-flex items-center gap-1.5"><span className="size-3 rounded-sm bg-warn-solid" /> 50–74{'\u202F'}%</span>
          <span className="inline-flex items-center gap-1.5"><span className="size-3 rounded-sm bg-bad-solid" /> menos del {formatPercent(50)}</span>
        </figcaption>
      </figure>
      <button type="button" onClick={() => setShowTable((s) => !s)} aria-expanded={showTable} className="mt-3 min-h-11 font-semibold text-brand-strong underline underline-offset-4 dark:text-brand">
        {showTable ? 'Ocultar tabla' : 'Ver como tabla'}
      </button>
      {showTable ? (
        <div className="mt-2 max-h-72 overflow-auto rounded-xl border border-line">
          <table className="w-full text-left text-sm">
            <thead className="sticky top-0 bg-surface-2">
              <tr>
                <th scope="col" className="px-3 py-2">Día</th>
                <th scope="col" className="px-3 py-2">Hechas</th>
                <th scope="col" className="px-3 py-2">Previstas</th>
                <th scope="col" className="px-3 py-2">%</th>
              </tr>
            </thead>
            <tbody>
              {days.map((d) => (
                <tr key={d.date} className="border-t border-line">
                  <td className="px-3 py-1.5">{formatLocalDate(d.date)}</td>
                  <td className="px-3 py-1.5 tabular">{d.done}</td>
                  <td className="px-3 py-1.5 tabular">{d.expected}</td>
                  <td className="px-3 py-1.5 tabular">{formatPercent(d.percent)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}

