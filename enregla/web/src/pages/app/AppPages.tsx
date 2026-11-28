import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { RECORD_TYPES, RECORD_TYPE_LABELS } from '@shared/schemas';
import { useSearchParams } from 'react-router';
import { orgApi, useCompliance, useOrgMutation, useToday, useVerificationPreview, useVerifications } from '@/api/queries';
import { api, errorMessage } from '@/api/client';
import type { Compliance, MissingTask, RecordType, TodayTasks, Verification, VerificationSnapshot } from '@/api/types';
import { Dialog, useToast } from '@/components/ui/Overlay';
import { ChoiceGroup, Textarea } from '@/components/ui/Form';
import { useOrgContext } from '@/hooks/useOrgContext';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { remeasureDue, useNow } from '@/hooks/useNow';
import { Button, LinkButton, buttonClasses } from '@/components/ui/Button';
import { Badge, Callout, EmptyState, ErrorState, ProgressRing, Skeleton } from '@/components/ui/Feedback';
import { Card, PageHeader, SectionTitle } from '@/components/ui/Layout';
import { Checkbox, Field, Input } from '@/components/ui/Form';
import { Icon } from '@/components/icons/Icon';
import { ALERT_LABELS, RECORD_ICON, RECORD_TINT } from '@/features/recordMeta';
import { DownloadButton } from '@/features/DownloadButton';
import { periodDueText, startedAtText, plural, addDaysIso, formatLocalDate, formatLongDate, formatCompliance, formatRange, formatTemp, formatTime, localDateIn, relativeDays } from '@/lib/format';
import { cn } from '@/lib/cn';
import { storage } from '@/lib/storage';

// ===========================================================================
// HOY
// ===========================================================================
export function TodayPage() {
  const { orgId, org, tz, path } = useOrgContext();
  useDocumentTitle('Hoy');
  const q = useToday(orgId);
  const [setupStep, setSetupStep] = useState(() => storage.getOnboarding(orgId));
  // Pendiente de eliminación: no se puede registrar, así que los accesos directos se muestran deshabilitados y explicados.
  const blocked = !!org.deletionScheduledAt;
  const blockedWhy = 'Este local está pendiente de eliminación: ahora no se pueden añadir registros. Puedes consultar el historial y descargar informes.';

  return (
    <>
      <PageHeader
        eyebrow={org.name}
        title={q.data ? <span className="inline-block first-letter:uppercase">{formatLongDate(q.data.date)}</span> : 'Hoy'}
        actions={
          blocked ? (
            <>
              <Button icon="thermometer" size="lg" className="max-sm:flex-1" disabled aria-describedby="hoy-bloqueado">
                Temperatura
              </Button>
              <Button icon="plus" variant="secondary" size="lg" className="max-sm:flex-1" disabled aria-describedby="hoy-bloqueado">
                Otro registro
              </Button>
            </>
          ) : (
            <>
              <LinkButton to={path('registrar/temperatura')} icon="thermometer" size="lg" className="max-sm:flex-1">
                Temperatura
              </LinkButton>
              <LinkButton to={path('registrar')} icon="plus" variant="secondary" size="lg" className="max-sm:flex-1">
                Otro registro
              </LinkButton>
            </>
          )
        }
      />
      {blocked ? (
        <p id="hoy-bloqueado" className="-mt-3 mb-5 text-ink-muted sm:-mt-4" data-testid="hoy-bloqueado">
          {blockedWhy}
        </p>
      ) : null}
      {setupStep ? (
        <Callout
          tone="info"
          icon="settings"
          title="Termina de configurar tu local"
          className="mb-5"
          action={
            <div className="flex flex-wrap gap-2">
              <LinkButton to={`/nuevo-local?local=${orgId}&paso=${setupStep}`} size="md" iconRight="arrowRight">
                Continuar la configuración
              </LinkButton>
              <Button
                variant="ghost"
                onClick={() => {
                  storage.setOnboarding(orgId, null);
                  setSetupStep(null);
                }}
              >
                Ya está configurado
              </Button>
            </div>
          }
        >
          Dejaste el alta guiada a medias (equipos, limpieza y personal). Puedes retomarla donde la dejaste.
        </Callout>
      ) : null}
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

/** «1 completada con una corrección posterior» / «3 completadas con una corrección posterior». */
export const correctedLaterText = (n: number) => `${n} ${n === 1 ? 'completada' : 'completadas'} con una corrección posterior`;

function TodayContent({ data, tz }: { data: TodayTasks; tz: string }) {
  const { path } = useOrgContext();
  const today = data.date;
  // Lo dado de alta (o reactivado) hoy se muestra aparte: no es exigible hasta mañana ni cuenta en el progreso.
  const counted = { temps: data.temperatures.filter((t) => t.countsToday !== false), clean: data.cleaning.filter((c) => c.countsToday !== false) };
  const custom = data.custom ?? [];
  const coolings = data.coolings ?? [];
  // H-A2: las semanales y mensuales se ven todo su periodo; las que aún no tocan van aparte.
  const later = (c: { dueToday?: boolean; dueDate?: string | null }) => c.dueToday === false && !!c.dueDate && c.dueDate > today;
  const pendingCustom = custom.filter((c) => c.countsToday !== false && c.status === 'pending' && !later(c));
  const laterCustom = custom.filter((c) => c.countsToday !== false && c.status === 'pending' && later(c));
  const doneCustom = custom.filter((c) => c.countsToday !== false && c.status === 'done');
  const notYetCustom = custom.filter((c) => c.countsToday === false);
  // 1.12: un equipo cuya última lectura de hoy está fuera de rango vuelve a «Pendiente» como «Volver a medir».
  const pendingTemps = data.temperatures.filter((t) => (t.countsToday !== false && t.status === 'pending') || t.remeasure);
  const now = useNow();
  const doneTemps = counted.temps.filter((t) => t.status === 'done');
  const remeasureCount = data.temperatures.filter((t) => t.remeasure).length;
  const pendingClean = counted.clean.filter((c) => c.status === 'pending' && !later(c));
  const laterClean = counted.clean.filter((c) => c.status === 'pending' && later(c));
  const doneClean = counted.clean.filter((c) => c.status === 'done');
  const notYetTemps = data.temperatures.filter((t) => t.countsToday === false);
  const notYetClean = data.cleaning.filter((c) => c.countsToday === false);
  const notYetCount = notYetTemps.length + notYetClean.length + notYetCustom.length;
  const { summary } = data;
  const allDone = summary.total > 0 && summary.pending === 0 && remeasureCount === 0;
  const subCard = useSubscriptionNotice();

  return (
    <div className="space-y-8">
      <section aria-labelledby="resumen" className={cn('grid gap-4', subCard && 'lg:grid-cols-[1.4fr_1fr]')}>
        <Card className="flex items-center gap-5">
          {summary.total > 0 ? (
            <ProgressRing percent={summary.percent} label={`${formatCompliance(summary.percent)} de las tareas de hoy hechas`} />
          ) : (
            <span className="grid size-28 shrink-0 place-items-center rounded-full bg-surface-2 text-ink-muted" aria-hidden="true">
              <Icon name="today" size={40} />
            </span>
          )}
          <div className="min-w-0">
            <h2 id="resumen" className="text-2xl font-extrabold">
              {summary.total === 0
                ? notYetCount > 0
                  ? 'Nada obligatorio hoy'
                  : 'Sin tareas programadas'
                : allDone
                  ? '¡Todo hecho por hoy!'
                  : summary.pending === 0
                    ? `Falta volver a medir ${remeasureCount === 1 ? '1 equipo' : `${remeasureCount} equipos`}`
                    : `Quedan ${summary.pending} de ${summary.total}`}
            </h2>
            <p className="mt-1 text-ink-muted">
              {summary.total === 0
                ? notYetCount > 0
                  ? 'Lo dado de alta hoy empieza a contar mañana. Puedes ir registrándolo.'
                  : 'No hay controles de temperatura ni limpiezas previstos para hoy.'
                : `${summary.done} ${summary.done === 1 ? 'tarea hecha' : 'tareas hechas'}${(summary.doneWithAlert ?? 0) > 0 ? ` (${summary.doneWithAlert} con alerta)` : ''} · ${data.alerts.length === 0 ? 'sin alertas' : `${data.alerts.length} ${data.alerts.length === 1 ? 'alerta' : 'alertas'}`}`}
            </p>
            {(summary.correctedLater ?? 0) > 0 ? (
              <p className="mt-0.5 text-sm text-ink-muted" data-testid="corrected-later-summary">
                {correctedLaterText(summary.correctedLater ?? 0)}
              </p>
            ) : null}
            {allDone ? (
              <Badge tone="ok" icon="check" className="mt-2">
                Al día
              </Badge>
            ) : null}
          </div>
        </Card>
        {subCard ? <SubscriptionCard notice={subCard} /> : null}
      </section>

      <ReviewNotice review={data.review} />

      {coolings.length > 0 ? (
        <section aria-labelledby="en-curso">
          <SectionTitle id="en-curso">
            <span className="inline-flex items-center gap-2">
              <Icon name="snowflake" className="text-brand" /> Enfriamientos en curso
            </span>
          </SectionTitle>
          <ul className="grid gap-3 sm:grid-cols-2" data-testid="coolings">
            {coolings.map((c) => (
              <TaskCard
                key={c.recordId}
                to={path(`registrar/enfriamiento?enfriamiento=${c.recordId}`)}
                type="enfriamiento"
                title={c.product}
                detail={`Empezó ${startedAtText(c.startedAt, tz)} a ${formatTemp(c.startTemp)} · criterio ${formatTemp(c.targetTemp)} en menos de ${c.maxMinutes} min`}
                extra={c.overdue ? `Han pasado ${c.maxMinutes} min o más: termínalo y anota qué haces con el producto` : `Termina antes de las ${formatTime(c.deadline, tz)}`}
                warn={c.overdue}
                due={c.overdue}
                dueLabel="Fuera de tiempo"
                badge="En curso"
              />
            ))}
          </ul>
        </section>
      ) : null}

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
                  to={path(a.kind === 'registro_personalizado_vencido' ? `registrar/personalizado?registro=${a.recordId}` : `historial/${a.recordId}`)}
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
                      {a.kind === 'registro_personalizado_vencido'
                        ? 'Toca para registrarlo'
                        : a.kind === 'incidencia_abierta'
                          ? `Desde el ${formatLocalDate(localDateIn(tz, new Date(a.createdAt)))}`
                          : localDateIn(tz, new Date(a.createdAt)) === today
                            ? `A las ${formatTime(a.createdAt, tz)}`
                            : `El ${formatLocalDate(localDateIn(tz, new Date(a.createdAt)), { day: 'numeric', month: 'short' })} a las ${formatTime(a.createdAt, tz)}`}
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

      {summary.total === 0 && notYetCount > 0 ? null : summary.total === 0 ? (
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
            {pendingTemps.length + pendingClean.length + pendingCustom.length === 0 ? (
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
                    due={remeasureDue(t, now)}
                    title={remeasureDue(t, now) ? `Ya toca volver a medir: ${t.name}` : t.remeasure ? `Volver a medir: ${t.name}` : t.name}
                    detail={`${t.done} de ${t.required} ${t.required === 1 ? 'control' : 'controles'} · ${formatRange(t.minTemp, t.maxTemp)}`}
                    extra={
                      t.lastReading
                        ? t.remeasure
                          ? `Última: ${formatTemp(t.lastReading.value)} a las ${formatTime(t.lastReading.at, tz)}, fuera de rango. ${t.remeasureFrom ? `Vuelve a medir a partir de las ${formatTime(t.remeasureFrom, tz)}.` : 'Mide otra vez para comprobar que se ha corregido.'}`
                          : `Última: ${formatTemp(t.lastReading.value)} a las ${formatTime(t.lastReading.at, tz)}`
                        : undefined
                    }
                    warn={t.lastReading?.outOfRange}
                    badge={t.remeasure ? 'Volver a medir' : 'Pendiente'}
                  />
                ))}
                {pendingClean.map((c) => (
                  <TaskCard
                    key={c.cleaningPlanId}
                    to={path(`registrar/limpieza?plan=${c.cleaningPlanId}`)}
                    type="limpieza"
                    title={c.name}
                    detail={c.frequency === 'daily' ? 'Limpieza de hoy' : periodDueText(c.frequency, c.dueDate, today)}
                    extra={c.partial ? `Parcial (${c.partial.done} de ${c.partial.total}) ${startedAtText(c.partial.at, tz)}: falta completarla` : undefined}
                    warn={!!c.partial}
                  />
                ))}
                {pendingCustom.map((c) => (
                  <TaskCard
                    key={c.templateId}
                    to={path(`registrar/personalizado?registro=${c.templateId}`)}
                    type="personalizado"
                    title={c.name}
                    detail={c.frequency === 'daily' ? `${c.done} de ${c.required} ${c.required === 1 ? 'vez' : 'veces'} hoy` : periodDueText(c.frequency, c.dueDate, today)}
                  />
                ))}
              </ul>
            )}
          </section>
          {laterClean.length + laterCustom.length > 0 ? (
            <section aria-labelledby="mas-adelante">
              <SectionTitle id="mas-adelante">Más adelante en la semana o el mes</SectionTitle>
              <p className="-mt-2 mb-3 text-sm text-ink-muted">Cuenta si se hace cualquier día de su semana o su mes. Puedes adelantarlo.</p>
              <ul className="grid gap-3 sm:grid-cols-2" data-testid="later-tasks">
                {laterClean.map((c) => (
                  <TaskCard key={c.cleaningPlanId} to={path(`registrar/limpieza?plan=${c.cleaningPlanId}`)} type="limpieza" title={c.name} detail={periodDueText(c.frequency, c.dueDate, today)} badge="Más adelante" />
                ))}
                {laterCustom.map((c) => (
                  <TaskCard key={c.templateId} to={path(`registrar/personalizado?registro=${c.templateId}`)} type="personalizado" title={c.name} detail={periodDueText(c.frequency, c.dueDate, today)} badge="Más adelante" />
                ))}
              </ul>
            </section>
          ) : null}
          {doneTemps.length + doneClean.length + doneCustom.length > 0 ? (
            <section aria-labelledby="hechas">
              <SectionTitle id="hechas">Hecho</SectionTitle>
              <ul className="divide-y divide-line rounded-2xl border border-line bg-surface">
                {doneTemps.map((t) => (
                  <li key={t.equipmentId} className="flex items-center gap-3 px-4 py-3" data-testid={t.withAlert ? 'done-with-alert' : undefined}>
                    {t.withAlert ? <Icon name="alert" className="shrink-0 text-bad" /> : <Icon name="check" className="shrink-0 text-ok" strokeWidth={2.5} />}
                    <span className="min-w-0 flex-1">
                      <span className="block font-semibold">{t.name}</span>
                      <span className="block text-sm text-ink-muted">
                        {t.done} de {t.required} {t.required === 1 ? 'control' : 'controles'}
                        {t.lastReading ? ` · última ${formatTemp(t.lastReading.value)} a las ${formatTime(t.lastReading.at, tz)}` : ''}
                        {(t.correctedLater ?? 0) > 0 ? ` · ${t.correctedLater === 1 ? '1 con una corrección posterior' : `${t.correctedLater} con una corrección posterior`}` : ''}
                      </span>
                    </span>
                    {t.withAlert || t.lastReading?.outOfRange ? (
                      <Badge tone="bad" icon="alert">
                        Hecho con alerta
                      </Badge>
                    ) : (
                      <Badge tone="ok" icon="check">
                        Hecho
                      </Badge>
                    )}
                  </li>
                ))}
                {doneClean.map((c) => (
                  <li key={c.cleaningPlanId} className="flex items-center gap-3 px-4 py-3">
                    <Icon name="check" className="shrink-0 text-ok" strokeWidth={2.5} />
                    <span className="min-w-0 flex-1">
                      <span className="block font-semibold">{c.name}</span>
                      <span className="block text-sm text-ink-muted">{c.completedAt ? `Hecha el ${formatLocalDate(localDateIn(tz, new Date(c.completedAt)))} a las ${formatTime(c.completedAt, tz)}` : 'Hecha'}{c.correctedLater ? ' · completada con una corrección posterior' : ''}</span>
                    </span>
                    <Badge tone="ok" icon="check">Hecho</Badge>
                  </li>
                ))}
                {doneCustom.map((c) => (
                  <li key={c.templateId} className="flex items-center gap-3 px-4 py-3">
                    {c.withAlert ? <Icon name="alert" className="shrink-0 text-bad" /> : <Icon name="check" className="shrink-0 text-ok" strokeWidth={2.5} />}
                    <span className="min-w-0 flex-1">
                      <span className="block font-semibold [overflow-wrap:anywhere]">{c.name}</span>
                      <span className="block text-sm text-ink-muted">{c.lastAt ? `Último a las ${formatTime(c.lastAt, tz)}` : 'Hecho'}</span>
                    </span>
                    {c.withAlert ? <Badge tone="bad" icon="alert">Hecho con alerta</Badge> : <Badge tone="ok" icon="check">Hecho</Badge>}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </>
      )}

      {notYetCount > 0 ? (
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
            {notYetCustom.map((c) => (
              <TaskCard key={c.templateId} to={path(`registrar/personalizado?registro=${c.templateId}`)} type="personalizado" title={c.name} detail={c.status === 'done' ? 'Hecho' : 'Sin hacer'} badge="Opcional hoy" />
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

function TaskCard({
  to,
  type,
  title,
  detail,
  extra,
  warn,
  due,
  badge = 'Pendiente',
  dueLabel = 'Ya toca',
}: {
  to: string;
  type: RecordType;
  title: string;
  detail: string;
  extra?: string;
  warn?: boolean;
  /** #14: ya ha llegado la hora de volver a medir (resaltado, sin notificación). */
  due?: boolean;
  badge?: 'Pendiente' | 'Volver a medir' | 'Opcional hoy' | 'En curso' | 'Más adelante';
  dueLabel?: string;
}) {
  const { readOnly } = useOrgContext();
  return (
    <li>
      <Link
        to={to}
        aria-disabled={readOnly || undefined}
        data-due={due || undefined}
        className={cn(
          'group flex min-h-24 min-w-0 items-center gap-3 rounded-2xl border bg-surface p-4 shadow-card transition-[border-color,transform] hover:-translate-y-0.5 hover:border-brand',
          due ? 'border-2 border-bad-solid ring-4 ring-bad-solid/25' : 'border-line',
        )}
      >
        <span className={cn('grid size-12 shrink-0 place-items-center rounded-2xl', RECORD_TINT[type])}>
          <Icon name={RECORD_ICON[type]} size={26} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block font-bold [overflow-wrap:anywhere]">{title}</span>
          <span className="block text-sm text-ink-muted">{detail}</span>
          {extra ? <span className={cn('mt-0.5 block text-sm', warn ? 'font-semibold text-bad' : 'text-ink-muted')}>{extra}</span> : null}
          <span
            className={cn(
              'mt-1 inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-sm font-bold',
              badge === 'Pendiente' || badge === 'En curso' ? 'bg-warn-soft text-warn' : badge === 'Volver a medir' ? 'bg-bad-soft text-bad' : 'bg-surface-2 text-ink-muted',
            )}
          >
            {badge === 'Volver a medir' ? <Icon name="refresh" size={14} /> : badge === 'En curso' ? <Icon name="clock" size={14} /> : null}
            {badge}
          </span>
          {due ? (
            <span className="mt-1 ml-2 inline-flex items-center gap-1 rounded-full bg-bad-solid px-2.5 py-0.5 text-sm font-bold text-white" data-testid="remeasure-due">
              <Icon name="clock" size={14} /> {dueLabel}
            </span>
          ) : null}
        </span>
        <Icon name="chevronRight" className="shrink-0 text-ink-muted transition-transform group-hover:translate-x-0.5" />
      </Link>
    </li>
  );
}

/** Aviso en Hoy si la semana anterior no está marcada como revisada por el responsable (fase 2). */
function ReviewNotice({ review }: { review: TodayTasks['review'] }) {
  const { path, readOnly } = useOrgContext();
  if (!review || !review.due || review.verified) return null;
  return (
    <Callout
      tone="info"
      icon="shield"
      title="La semana pasada está sin revisar"
      action={
        readOnly ? undefined : (
          <LinkButton to={`${path('informes')}?revisar=semana-pasada`} size="md" variant="secondary" icon="check">
            Revisar y marcar
          </LinkButton>
        )
      }
    >
      <span data-testid="review-notice">
        Del {formatLocalDate(review.from)} al {formatLocalDate(review.to)}. Revisa los registros y márcala como revisada: así consta en el PDF «Verificado por…».
      </span>
    </Callout>
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
  if (sub.paymentFailed) return { tone: 'bad', title: 'Pago pendiente', text: 'No hemos podido cobrar la suscripción. Puedes seguir registrando unos días más; si no se resuelve, el local pasará a solo lectura.', cta: isOwner ? 'Ver facturación' : null };
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
  const { orgId, tz, org, readOnly } = useOrgContext();
  useDocumentTitle('Informes');
  const today = localDateIn(tz);
  const [params, setParams] = useSearchParams();
  const [reviewOpen, setReviewOpen] = useState(() => params.get('revisar') != null);
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
      <div className="grid items-start gap-6 xl:grid-cols-[1fr_1.1fr]">
        <div className="space-y-6">
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
              Del {formatLocalDate(range.from)} al {formatLocalDate(range.to)} ({plural(days, 'día', 'días')})
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
            <DownloadButton disabled={!canDownload} url={`/api/orgs/${orgId}/reports/pdf?${query}`} fallbackName="registros.pdf" icon="report" variant="primary" busyLabel="Generando el informe…">
              Informe PDF
            </DownloadButton>
            <DownloadButton disabled={!canDownload} url={`/api/orgs/${orgId}/reports/csv?${query}`} fallbackName="registros.csv">
              Hoja de cálculo (CSV)
            </DownloadButton>
          </div>
          <p className="mt-3 text-sm text-ink-muted">
            El PDF incluye una portada con los datos de {org.name} y un resumen del periodo, una tabla por tipo (agrupada por equipo, plan o registro), lo que está fuera de rango señalado, las correcciones con su motivo, las tareas sin registrar, la verificación del responsable y un espacio para su firma. Si el periodo tiene demasiados registros para un PDF, acota las fechas o usa el CSV.
          </p>
        </Card>
        <ReviewCard
          range={rangeError ? null : range}
          today={today}
          readOnly={readOnly}
          open={reviewOpen}
          initialChoice={params.get('revisar') === 'semana-pasada' ? 'week' : undefined}
          onOpenChange={(v) => {
            setReviewOpen(v);
            if (!v && params.get('revisar') != null) {
              params.delete('revisar');
              setParams(params, { replace: true });
            }
          }}
        />
        </div>
        <Card>
          <h2 className="text-xl font-bold">Resumen de tareas hechas</h2>
          <p className="text-sm text-ink-muted">
            Controles de temperatura, limpiezas y registros personalizados previstos frente a hechos
            {days > 92 && !rangeError ? ` (últimos 92 días del periodo: desde el ${formatLocalDate(compFrom)})` : ''}. Cada día cuenta con la configuración que estaba vigente ese día.
          </p>
          <div className="mt-4">
            {rangeError ? (
              <p className="text-ink-muted">Elige un periodo válido.</p>
            ) : compliance.isPending ? (
              <Skeleton className="h-56" />
            ) : compliance.isError ? (
              <ErrorState error={compliance.error} onRetry={() => void compliance.refetch()} />
            ) : (
              <>
                <ComplianceChart data={compliance.data} />
                <MissingByDay data={compliance.data} />
              </>
            )}
          </div>
        </Card>
      </div>
    </>
  );
}

/** Texto de una tarea sin registrar (el mismo que en el PDF). */
export function missingLabel(m: MissingTask): { task: string; what: string } {
  const kind = m.kind === 'temperatura' ? 'Temperatura' : m.kind === 'limpieza' ? 'Limpieza' : m.kind === 'enfriamiento' ? 'Enfriamiento' : 'Registro';
  if (m.kind === 'enfriamiento') return { task: `${kind}: ${m.name}`, what: 'Sin cerrar: no consta el final ni la temperatura alcanzada' };
  const periodic = m.frequency === 'weekly' || m.frequency === 'monthly';
  // H-A2: mientras la semana o el mes no terminan, es «pendiente», nunca «no consta».
  if (periodic && !m.partial) {
    const what = m.pending
      ? `Pendiente ${m.frequency === 'weekly' ? 'esta semana' : 'este mes'}`
      : `No consta en ${m.frequency === 'weekly' ? 'toda la semana' : 'todo el mes'}${m.periodEnd ? ` (hasta el ${formatLocalDate(m.periodEnd, { day: 'numeric', month: 'long' })})` : ''}`;
    return { task: `${kind}: ${m.name}`, what };
  }
  const base =
    m.kind === 'limpieza'
      ? m.partial
        ? 'Solo una limpieza parcial: falta completarla'
        : 'Sin registrar'
      : m.expected > 1
        ? `${m.done} de ${m.expected} ${m.kind === 'temperatura' ? 'controles' : 'veces'}`
        : 'Sin registrar';
  return { task: `${kind}: ${m.name}`, what: m.pending && !periodic ? `${base} (pendiente: el día aún no ha terminado)` : base };
}

/** Qué tarea faltó cada día (fase 2): días con huecos, desplegables. */
export function MissingByDay({ data }: { data: Compliance }) {
  const days = data.days.filter((d) => (d.missing?.length ?? 0) > 0).reverse();
  const gapDays = days.filter((d) => d.missing!.some((m) => !m.pending)).length;
  return (
    <section aria-labelledby="sin-registrar" className="mt-6 border-t border-line pt-4">
      <h3 id="sin-registrar" className="text-lg font-bold">
        Tareas sin registrar
      </h3>
      {days.length === 0 ? (
        <p className="mt-1 text-ink-muted" data-testid="no-gaps">
          No falta ninguna tarea exigible en este periodo.
        </p>
      ) : (
        <>
          <p className="mt-1 text-sm text-ink-muted">
            {gapDays > 0 ? `${plural(gapDays, 'día', 'días')} con alguna tarea sin registrar o incompleta. ` : 'Nada sin registrar en periodos ya terminados. '}
            {gapDays < days.length ? 'Lo marcado como pendiente aún está a tiempo. ' : ''}Toca un día para ver qué falta.
          </p>
          <ul className="mt-2 max-h-[28rem] divide-y divide-line overflow-y-auto rounded-xl border border-line" data-testid="missing-days">
            {days.map((d) => (
              <li key={d.date}>
                <details className="group">
                  <summary className="flex min-h-12 cursor-pointer list-none items-center gap-2 px-3 py-2 font-semibold [&::-webkit-details-marker]:hidden">
                    <Icon name="chevronRight" size={18} className="shrink-0 transition-transform group-open:rotate-90" />
                    <span className="flex-1 first-letter:uppercase">{formatLocalDate(d.date, { weekday: 'long', day: 'numeric', month: 'long' })}</span>
                    {d.missing!.some((m) => !m.pending) ? <Badge tone="warn">{plural(d.missing!.filter((m) => !m.pending).length, 'tarea', 'tareas')}</Badge> : null}
                    {d.missing!.some((m) => m.pending) ? <Badge tone="info">{plural(d.missing!.filter((m) => m.pending).length, 'pendiente', 'pendientes')}</Badge> : null}
                  </summary>
                  <ul className="space-y-1.5 px-3 pb-3 pl-9">
                    {d.missing!.map((m) => {
                      const l = missingLabel(m);
                      return (
                        <li key={`${m.kind}-${m.id}`} className="text-sm">
                          <span className="font-semibold [overflow-wrap:anywhere]">{l.task}</span> <span className={m.partial || m.kind === 'enfriamiento' ? 'text-warn' : 'text-ink-muted'}>· {l.what}</span>
                        </li>
                      );
                    })}
                  </ul>
                </details>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

/** Lunes de la semana de una fecha ISO. */
const mondayOf = (iso: string) => {
  const d = new Date(`${iso}T00:00:00Z`);
  const wd = (d.getUTCDay() + 6) % 7;
  return addDaysIso(iso, -wd);
};
const roleLabel = (r: string) => (r === 'owner' ? 'propietario/a' : 'encargado/a');

/** Verificación del responsable (fase 2): quién revisó el periodo y «Marcar como revisado». */
function ReviewCard({
  range,
  today,
  readOnly,
  open,
  onOpenChange,
  initialChoice,
}: {
  range: { from: string; to: string } | null;
  today: string;
  readOnly: boolean;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  initialChoice?: 'week';
}) {
  const { orgId, tz } = useOrgContext();
  const q = useVerifications(orgId, range?.from ?? today, range?.to ?? today, !!range);
  const lastMon = addDaysIso(mondayOf(today), -7);
  const lastWeek = { from: lastMon, to: addDaysIso(lastMon, 6), kind: 'week' as const };
  const firstThis = `${today.slice(0, 8)}01`;
  const lastPrev = addDaysIso(firstThis, -1);
  const lastMonth = { from: `${lastPrev.slice(0, 8)}01`, to: lastPrev, kind: 'month' as const };
  // H-M1: solo periodos ya terminados (como muy tarde, hasta ayer).
  const selected = range && range.to < today ? { ...range, kind: 'custom' as const } : null;
  const covers = (v: Verification) => range != null && v.from <= range.from && v.to >= range.to;
  return (
    <Card data-testid="review-card">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-xl font-bold">Revisión del responsable</h2>
          <p className="text-sm text-ink-muted">
            Un propietario o encargado revisa los registros de una semana o un mes y lo marca como revisado. Queda guardado (no se puede borrar ni cambiar; una revisión posterior se añade) y aparece en el PDF como «Verificado por… el…».
          </p>
        </div>
        <Button icon="check" onClick={() => onOpenChange(true)} disabled={readOnly}>
          Marcar como revisado
        </Button>
      </div>
      <div className="mt-3">
        {!range ? null : q.isPending ? (
          <Skeleton className="h-16" />
        ) : q.isError ? (
          <ErrorState error={q.error} onRetry={() => void q.refetch()} />
        ) : q.data.length === 0 ? (
          <p className="text-ink-muted" data-testid="no-verifications">
            Nadie ha marcado como revisado ninguna parte de este periodo.
          </p>
        ) : (
          <ul className="space-y-2" data-testid="verifications">
            {q.data.map((v) => (
              <li key={v.id} className="flex items-start gap-3 rounded-xl border border-line px-3 py-2">
                <Icon name="shield" className="mt-0.5 shrink-0 text-ok" />
                <span className="min-w-0">
                  <span className="block font-semibold">
                    Verificado por {v.user.name} ({roleLabel(v.user.role)}) el {formatLocalDate(localDateIn(tz, new Date(v.createdAt)))} a las {formatTime(v.createdAt, tz)}
                  </span>
                  <span className="block text-sm text-ink-muted">
                    {v.kind === 'week' ? 'Semana' : v.kind === 'month' ? 'Mes' : 'Periodo'} del {formatLocalDate(v.from)} al {formatLocalDate(v.to)}
                    {covers(v) ? ' · cubre todo el periodo elegido' : ' · cubre parte del periodo elegido'}
                  </span>
                  {v.snapshot ? (
                    <span className="block text-sm text-ink-muted" data-testid="verification-snapshot">
                      En ese momento: {plural(v.snapshot.gapTasks, 'tarea sin registrar', 'tareas sin registrar')}, {v.snapshot.alertsWithoutAction} {v.snapshot.alertsWithoutAction === 1 ? 'alerta' : 'alertas'} sin acción
                      {v.snapshot.openCoolings > 0 ? `, ${plural(v.snapshot.openCoolings, 'enfriamiento sin cerrar', 'enfriamientos sin cerrar')}` : ''}
                    </span>
                  ) : null}
                  {v.comment ? <span className="mt-0.5 block text-sm [overflow-wrap:anywhere]">«{v.comment}»</span> : null}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
      {open ? <ReviewDialog options={[lastWeek, lastMonth, ...(selected ? [selected] : [])]} initial={initialChoice === 'week' ? 0 : undefined} onClose={() => onOpenChange(false)} /> : null}
    </Card>
  );
}

function ReviewDialog({ options, initial, onClose }: { options: { from: string; to: string; kind: 'week' | 'month' | 'custom' }[]; initial?: number; onClose: () => void }) {
  const { orgId } = useOrgContext();
  const toast = useToast();
  const [choice, setChoice] = useState<string | null>(initial != null ? String(initial) : null);
  const [comment, setComment] = useState('');
  const [error, setError] = useState<string | null>(null);
  const m = useOrgMutation(orgId, (body: { from: string; to: string; kind: string; comment: string | null }) => api.post(`${orgApi(orgId).base}/verifications`, body), [['verifications'], ['today']]);
  const sel = choice != null ? options[Number(choice)] : undefined;
  const preview = useVerificationPreview(orgId, sel?.from ?? '', sel?.to ?? '', !!sel);
  const label = (o: { from: string; to: string; kind: string }) =>
    `${o.kind === 'week' ? 'La semana pasada' : o.kind === 'month' ? 'El mes pasado' : 'El periodo elegido'} (del ${formatLocalDate(o.from)} al ${formatLocalDate(o.to)})`;
  const save = async () => {
    if (choice == null) return setError('Elige qué periodo has revisado');
    const o = options[Number(choice)]!;
    try {
      await m.mutateAsync({ from: o.from, to: o.to, kind: o.kind, comment: comment.trim() || null });
      toast.show('Periodo marcado como revisado');
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    }
  };
  return (
    <Dialog
      open
      onClose={onClose}
      title="Marcar como revisado"
      description="Confirma que has revisado los registros de ese periodo (temperaturas, limpiezas, alertas y sus acciones correctoras). Queda a tu nombre, con la fecha y la hora, y no se puede deshacer."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button icon="check" loading={m.isPending} onClick={() => void save()}>
            Marcar como revisado
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <ChoiceGroup
          legend="¿Qué periodo has revisado?"
          value={choice}
          onChange={(v) => {
            setChoice(v);
            setError(null);
          }}
          columns={2}
          error={error}
          options={options.map((o, i) => ({ value: String(i), label: label(o) }))}
        />
        {sel ? (
          preview.isPending ? (
            <Skeleton className="h-20" />
          ) : preview.isError ? (
            <ErrorState error={preview.error} onRetry={() => void preview.refetch()} />
          ) : (
            <SnapshotSummary s={preview.data} />
          )
        ) : null}
        <Field label="Comentario" optional hint="Por ejemplo: revisadas las alertas de la cámara con el equipo.">
          <Textarea value={comment} onChange={(e) => setComment(e.target.value)} maxLength={1000} rows={2} />
        </Field>
      </div>
    </Dialog>
  );
}

/** Lo que hay en el periodo antes de confirmar (y lo que se guarda con la verificación). */
function SnapshotSummary({ s }: { s: VerificationSnapshot }) {
  const clean = s.gapTasks === 0 && s.alertsWithoutAction === 0 && s.openCoolings === 0;
  return (
    <Callout tone={clean ? 'ok' : 'warn'} title={clean ? 'Sin huecos ni alertas pendientes' : 'Antes de confirmar, revisa esto'} live="polite">
      <ul className="mt-1 space-y-0.5" data-testid="review-snapshot">
        <li>{s.gapTasks === 0 ? 'Ninguna tarea sin registrar' : `${plural(s.gapTasks, 'tarea sin registrar', 'tareas sin registrar')} (en ${plural(s.gapDays, 'día', 'días')})`}</li>
        <li>
          {plural(s.alerts, 'alerta', 'alertas')}
          {s.alerts > 0 ? `, ${s.alertsWithoutAction === 0 ? 'todas con acción correctora' : `${s.alertsWithoutAction} sin acción correctora`}` : ''}
        </li>
        {s.openCoolings > 0 ? <li>{plural(s.openCoolings, 'enfriamiento sin cerrar', 'enfriamientos sin cerrar')}</li> : null}
        <li>{plural(s.records, 'registro', 'registros')} en el periodo</li>
      </ul>
      <p className="mt-1 text-sm">Estos recuentos se guardan con tu verificación y salen en el PDF. Lo que se añada o corrija después también constará.</p>
    </Callout>
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
  const anyCorrected = days.some((d) => (d.correctedLater ?? 0) > 0);
  const overall = data.overall.percent;
  return (
    <div>
      <div className="mb-4 flex flex-wrap items-end gap-x-6 gap-y-2">
        <p>
          <span className="block font-display text-5xl font-extrabold tabular">{formatCompliance(overall)}</span>
          <span className="text-ink-muted">
            {data.overall.done} de {plural(data.overall.expected, 'tarea hecha', 'tareas hechas')}
          </span>
          {(data.overall.correctedLater ?? 0) > 0 ? (
            <span className="block text-sm text-ink-muted" data-testid="overall-corrected-later">
              {correctedLaterText(data.overall.correctedLater ?? 0)}
            </span>
          ) : null}
        </p>
        <p className="text-ink-muted">
          {summary.full} de {plural(summary.withData, 'día completo', 'días completos')}
        </p>
      </div>
      <figure>
        <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={`Porcentaje de tareas hechas por día, del ${formatLocalDate(data.from)} al ${formatLocalDate(data.to)}. Media: ${overall == null ? 'sin datos' : formatCompliance(overall)}.`}>
          {[0, 50, 100].map((g) => {
            const y = pad.t + innerH - (g / 100) * innerH;
            return (
              <g key={g}>
                <line x1={pad.l} x2={W - pad.r} y1={y} y2={y} stroke="var(--line)" strokeDasharray={g === 0 ? undefined : '3 4'} />
                <text x={pad.l - 6} y={y + 4} textAnchor="end" fontSize="13" fill="var(--ink-muted)">
                  {formatCompliance(g)}
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
                    <title>{`${formatLocalDate(d.date)}: ${formatCompliance(p)} (${d.done} de ${d.expected})${(d.correctedLater ?? 0) > 0 ? `; ${correctedLaterText(d.correctedLater ?? 0)}` : ''}`}</title>
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
          <span className="inline-flex items-center gap-1.5"><span className="size-3 rounded-sm bg-ok-solid" /> {formatCompliance(100)}</span>
          <span className="inline-flex items-center gap-1.5"><span className="size-3 rounded-sm bg-brand" /> 75–99{'\u202F'}%</span>
          <span className="inline-flex items-center gap-1.5"><span className="size-3 rounded-sm bg-warn-solid" /> 50–74{'\u202F'}%</span>
          <span className="inline-flex items-center gap-1.5"><span className="size-3 rounded-sm bg-bad-solid" /> menos del {formatCompliance(50)}</span>
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
                {anyCorrected ? <th scope="col" className="px-3 py-2">Con corrección posterior</th> : null}
              </tr>
            </thead>
            <tbody>
              {days.map((d) => (
                <tr key={d.date} className="border-t border-line">
                  <td className="px-3 py-1.5">{formatLocalDate(d.date)}</td>
                  <td className="px-3 py-1.5 tabular">{d.done}</td>
                  <td className="px-3 py-1.5 tabular">{d.expected}</td>
                  <td className="px-3 py-1.5 tabular">{formatCompliance(d.percent)}</td>
                  {anyCorrected ? <td className="px-3 py-1.5 tabular">{d.correctedLater ? d.correctedLater : '–'}</td> : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}

