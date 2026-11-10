import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { EQUIPMENT_TYPE_LABELS, RECORD_TYPES, RECORD_TYPE_LABELS } from '@shared/schemas';
import { errorMessage, formatWait, isApiError } from '@/api/client';
import type { AppRecord, KioskContext, RecordType, TodayTasks } from '@/api/types';
import { Button } from '@/components/ui/Button';
import { Callout, Skeleton } from '@/components/ui/Feedback';
import { Keypad, keypadDisplay, keypadToNumber } from '@/components/ui/Keypad';
import { ConfirmDialog } from '@/components/ui/Overlay';
import { LogoMark } from '@/components/ui/Logo';
import { Icon } from '@/components/icons/Icon';
import { RecordForm, TEMP_ACTIONS, type FormContext } from '@/features/RecordForms';
import { RECORD_ICON, RECORD_SHORT, RECORD_TINT, recordSummary } from '@/features/recordMeta';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { useOnline } from '@/hooks/useOnline';
import { formatRange, formatTemp, formatTime, isOutOfRange } from '@/lib/format';
import { storage } from '@/lib/storage';
import { cn } from '@/lib/cn';
import { kioskApi } from './kioskApi';
import { KioskPairPage } from './KioskPair';

/** Persona que está registrando. El PIN vive SOLO en memoria y caduca por inactividad. */
type Person = { id: string; name: string; hasPin: boolean; pin?: string };
type Target = { kind: 'temp'; equipmentId: string } | { kind: 'form'; type: RecordType; preset?: Record<string, string> };
type Screen =
  | { name: 'home' }
  | { name: 'who'; then: Target | null }
  | { name: 'pin'; person: Person; then: Target | null; error?: string; retry?: Pending }
  | { name: 'temp'; equipmentId: string }
  | { name: 'pick-equipment' }
  | { name: 'form'; type: RecordType; preset?: Record<string, string> }
  | { name: 'result'; record: AppRecord };
type Pending = { type: RecordType; data: unknown };

const IDLE_MS = 3 * 60_000;

export function KioskPage() {
  useDocumentTitle('Modo cocina');
  const [token, setToken] = useState<string | null>(() => storage.getKioskToken());
  const [revoked, setRevoked] = useState(false);

  if (revoked) {
    return (
      <KioskFrame>
        <div className="mx-auto max-w-xl py-16 text-center">
          <span className="mx-auto grid size-20 place-items-center rounded-3xl bg-bad-soft text-bad">
            <Icon name="lock" size={40} />
          </span>
          <h1 className="mt-6 text-4xl font-extrabold">Esta tablet se ha desvinculado</h1>
          <p className="mt-3 text-xl text-ink-muted">Un encargado la ha desvinculado o el código ya no es válido. Pide que la vuelvan a vincular desde Ajustes → Dispositivos de cocina.</p>
          <Button size="xl" className="mt-8" icon="link" onClick={() => setRevoked(false)}>
            Vincular de nuevo
          </Button>
        </div>
      </KioskFrame>
    );
  }
  if (!token) return <KioskPairPage />;
  return (
    <KioskApp
      token={token}
      onRevoked={() => {
        storage.setKioskToken(null);
        setToken(null);
        setRevoked(true);
      }}
      onUnpair={() => {
        storage.setKioskToken(null);
        setToken(null);
      }}
    />
  );
}

function KioskFrame({ children }: { children: ReactNode }) {
  return (
    <main id="main" tabIndex={-1} className="min-h-dvh bg-paper px-4 py-4 outline-none sm:px-6">
      {children}
    </main>
  );
}

function useClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 15_000);
    return () => window.clearInterval(id);
  }, []);
  return now;
}

function KioskApp({ token, onRevoked, onUnpair }: { token: string; onRevoked: () => void; onUnpair: () => void }) {
  const qc = useQueryClient();
  const online = useOnline();
  const now = useClock();
  const ctxQ = useQuery({ queryKey: ['kiosk', 'context'], queryFn: () => kioskApi.context(token), refetchInterval: 5 * 60_000 });
  const todayQ = useQuery({ queryKey: ['kiosk', 'today'], queryFn: () => kioskApi.today(token), refetchInterval: 60_000 });
  const [screen, setScreen] = useState<Screen>({ name: 'home' });
  const [person, setPerson] = useState<Person | null>(null);
  const [saving, setSaving] = useState(false);
  const [serverError, setServerError] = useState<unknown>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [unpairOpen, setUnpairOpen] = useState(false);
  const idleTimer = useRef<number | undefined>(undefined);

  const unauthorized = [ctxQ.error, todayQ.error].some((e) => isApiError(e) && e.code === 'UNAUTHENTICATED');
  useEffect(() => {
    if (unauthorized) onRevoked();
  }, [unauthorized, onRevoked]);

  // Inactividad: se olvida a la persona (y su PIN) y se vuelve al inicio.
  const touch = useCallback(() => {
    window.clearTimeout(idleTimer.current);
    idleTimer.current = window.setTimeout(() => {
      setPerson(null);
      setScreen({ name: 'home' });
    }, IDLE_MS);
  }, []);
  useEffect(() => {
    touch();
    window.addEventListener('pointerdown', touch);
    window.addEventListener('keydown', touch);
    return () => {
      window.clearTimeout(idleTimer.current);
      window.removeEventListener('pointerdown', touch);
      window.removeEventListener('keydown', touch);
    };
  }, [touch]);

  const ctx = ctxQ.data;
  const readOnly = ctx?.organization.readOnly ?? false;

  const goTarget = (t: Target | null) => {
    if (!t) return setScreen({ name: 'home' });
    if (t.kind === 'temp') setScreen({ name: 'temp', equipmentId: t.equipmentId });
    else setScreen({ name: 'form', type: t.type, preset: t.preset });
  };

  const start = (t: Target) => {
    setServerError(null);
    setNotice(null);
    if (!person) setScreen({ name: 'who', then: t });
    else goTarget(t);
  };

  const submit = async (pending: Pending, who: Person | null = person) => {
    if (!who) return setScreen({ name: 'who', then: null });
    setSaving(true);
    setServerError(null);
    try {
      const record = await kioskApi.createRecord(token, { staffId: who.id, pin: who.pin, type: pending.type, data: pending.data });
      setPerson(who);
      setScreen({ name: 'result', record });
      void qc.invalidateQueries({ queryKey: ['kiosk', 'today'] });
    } catch (err) {
      if (isApiError(err)) {
        if (err.code === 'UNAUTHENTICATED') return onRevoked();
        if (err.code === 'PIN_REQUIRED' || err.code === 'INVALID_PIN') {
          const p = { ...who, pin: undefined };
          setPerson(null);
          setScreen({ name: 'pin', person: p, then: null, error: err.code === 'INVALID_PIN' ? 'PIN incorrecto. Prueba otra vez.' : 'Introduce tu PIN', retry: pending });
          return;
        }
        if (err.code === 'PIN_LOCKED') {
          setPerson(null);
          setNotice(`El PIN de ${who.name} está bloqueado por demasiados intentos.${err.retryAfter ? ` Inténtalo en ${formatWait(err.retryAfter)}` : ''} o pide a un encargado que lo desbloquee.`);
          setScreen({ name: 'home' });
          return;
        }
        if (err.code === 'READ_ONLY') {
          void qc.invalidateQueries({ queryKey: ['kiosk', 'context'] });
        }
      }
      setServerError(err);
    } finally {
      setSaving(false);
    }
  };

  const formCtx: FormContext | null = ctx
    ? { equipment: ctx.equipment, cleaningPlans: ctx.cleaningPlans, suppliers: ctx.suppliers, staff: ctx.staff, timezone: ctx.organization.timezone }
    : null;

  return (
    <div className="flex min-h-dvh flex-col bg-paper">
      <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-line bg-surface/95 px-4 py-2.5 backdrop-blur sm:px-6">
        <button type="button" onClick={() => setScreen({ name: 'home' })} className="flex min-h-16 items-center gap-3 rounded-2xl pr-3" aria-label="Inicio del modo cocina">
          <LogoMark size={40} />
          <span className="text-left">
            <span className="block text-xl leading-tight font-extrabold">{ctx?.organization.name ?? 'Modo cocina'}</span>
            <span className="block text-sm text-ink-muted tabular">
              {now.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', timeZone: ctx?.organization.timezone })} · {ctx?.device.name ?? ''}
            </span>
          </span>
        </button>
        <div className="ml-auto flex items-center gap-2">
          {person ? (
            <button
              type="button"
              onClick={() => {
                setPerson(null);
                setScreen({ name: 'who', then: null });
              }}
              className="flex min-h-16 items-center gap-2 rounded-2xl border-2 border-brand bg-brand-soft px-4 font-bold"
            >
              <Icon name="user" size={24} />
              <span className="max-w-[10rem] truncate">{person.name}</span>
              <span className="hidden text-sm font-semibold text-ink-muted sm:inline">· cambiar</span>
            </button>
          ) : (
            <button type="button" onClick={() => setScreen({ name: 'who', then: null })} className="flex min-h-16 items-center gap-2 rounded-2xl border-2 border-line-strong px-4 font-bold">
              <Icon name="user" size={24} /> ¿Quién eres?
            </button>
          )}
          <button
            type="button"
            className="hidden size-16 place-items-center rounded-2xl hover:bg-surface-2 sm:grid"
            aria-label="Pantalla completa"
            onClick={() => {
              if (document.fullscreenElement) void document.exitFullscreen();
              else void document.documentElement.requestFullscreen?.().catch(() => undefined);
            }}
          >
            <Icon name="maximize" size={28} />
          </button>
        </div>
      </header>

      {!online ? (
        <div role="status" className="bg-ink px-4 py-3 text-center text-lg font-semibold text-paper">
          <Icon name="wifiOff" size={22} className="mr-2 inline" /> Sin internet: no se puede guardar. Anótalo y regístralo cuando vuelva.
        </div>
      ) : null}
      {readOnly ? (
        <div role="status" className="bg-bad-solid px-4 py-3 text-center text-lg font-semibold text-white">
          <Icon name="lock" size={22} className="mr-2 inline" /> Local en solo lectura: ahora no se pueden guardar registros. Avisa al encargado.
        </div>
      ) : null}

      <main id="main" tabIndex={-1} className="mx-auto w-full max-w-5xl flex-1 px-4 py-5 outline-none sm:px-6">
        {notice ? (
          <Callout tone="bad" className="mb-4 text-lg" live="assertive" action={<Button variant="ghost" onClick={() => setNotice(null)}>Cerrar</Button>}>
            {notice}
          </Callout>
        ) : null}
        {ctxQ.isPending || todayQ.isPending ? (
          <div role="status" className="grid gap-4 sm:grid-cols-2">
            <span className="sr-only">Cargando…</span>
            <Skeleton className="h-28" />
            <Skeleton className="h-28" />
            <Skeleton className="h-28" />
            <Skeleton className="h-28" />
          </div>
        ) : ctxQ.isError || todayQ.isError || !ctx || !todayQ.data || !formCtx ? (
          <div className="py-12 text-center" role="alert">
            <h1 className="text-3xl font-extrabold">No se puede conectar</h1>
            <p className="mt-2 text-xl text-ink-muted">{errorMessage(ctxQ.error ?? todayQ.error)}</p>
            <Button
              size="xl"
              className="mt-6"
              icon="refresh"
              onClick={() => {
                void ctxQ.refetch();
                void todayQ.refetch();
              }}
            >
              Reintentar
            </Button>
          </div>
        ) : screen.name === 'home' ? (
          <KioskHome ctx={ctx} today={todayQ.data} readOnly={readOnly} onStart={start} onUnpair={() => setUnpairOpen(true)} />
        ) : screen.name === 'who' ? (
          <WhoScreen
            ctx={ctx}
            onBack={() => setScreen({ name: 'home' })}
            onPick={(s) => {
              const p: Person = { id: s.id, name: s.name, hasPin: s.hasPin };
              if (s.hasPin) setScreen({ name: 'pin', person: p, then: screen.then });
              else {
                setPerson(p);
                goTarget(screen.then);
              }
            }}
          />
        ) : screen.name === 'pin' ? (
          <PinScreen
            key={`${screen.person.id}-${screen.error ?? ''}`}
            person={screen.person}
            error={screen.error}
            busy={saving}
            onBack={() => setScreen({ name: 'home' })}
            onDone={(pin) => {
              const p = { ...screen.person, pin };
              if (screen.retry) void submit(screen.retry, p);
              else {
                setPerson(p);
                goTarget(screen.then);
              }
            }}
          />
        ) : screen.name === 'pick-equipment' ? (
          <PickEquipment ctx={ctx} onBack={() => setScreen({ name: 'home' })} onPick={(id) => setScreen({ name: 'temp', equipmentId: id })} />
        ) : screen.name === 'temp' ? (
          <TempScreen
            key={screen.equipmentId}
            ctx={ctx}
            equipmentId={screen.equipmentId}
            saving={saving}
            serverError={serverError}
            disabled={readOnly}
            onBack={() => setScreen({ name: 'home' })}
            onSubmit={(data) => void submit({ type: 'temperatura', data })}
          />
        ) : screen.name === 'form' ? (
          <section aria-labelledby="kform">
            <BackButton onClick={() => setScreen({ name: 'home' })} />
            <h1 id="kform" className="mb-5 flex items-center gap-3 text-3xl font-extrabold">
              <span className={cn('grid size-14 place-items-center rounded-2xl', RECORD_TINT[screen.type])}>
                <Icon name={RECORD_ICON[screen.type]} size={30} />
              </span>
              {RECORD_TYPE_LABELS[screen.type]}
            </h1>
            <div className="rounded-3xl border border-line bg-surface p-4 sm:p-6">
              <fieldset disabled={readOnly}>
                <RecordForm type={screen.type} ctx={formCtx} preset={screen.preset} large onSubmit={(d) => void submit({ type: screen.type, data: d })} submitting={saving} serverError={serverError} />
              </fieldset>
            </div>
          </section>
        ) : (
          <ResultScreen record={screen.record} tz={ctx.organization.timezone} onDone={() => setScreen({ name: 'home' })} />
        )}
      </main>
      <ConfirmDialog open={unpairOpen} onClose={() => setUnpairOpen(false)} onConfirm={onUnpair} title="¿Desvincular esta tablet?" confirmLabel="Desvincular">
        Se borrará el código de este dispositivo. Para volver a usarlo habrá que vincularlo de nuevo desde Ajustes. Para revocarlo del todo, hazlo también desde Ajustes → Dispositivos de cocina.
      </ConfirmDialog>
    </div>
  );
}

function BackButton({ onClick, label = 'Volver' }: { onClick: () => void; label?: string }) {
  return (
    <button type="button" onClick={onClick} className="mb-4 inline-flex min-h-16 items-center gap-2 rounded-2xl px-3 text-xl font-bold hover:bg-surface-2">
      <Icon name="arrowLeft" size={28} /> {label}
    </button>
  );
}

function KioskHome({ ctx, today, readOnly, onStart, onUnpair }: { ctx: KioskContext; today: TodayTasks; readOnly: boolean; onStart: (t: Target) => void; onUnpair: () => void }) {
  const tz = ctx.organization.timezone;
  const pendingTemps = today.temperatures.filter((t) => t.status === 'pending');
  const pendingClean = today.cleaning.filter((c) => c.status === 'pending');
  const { summary } = today;
  return (
    <div className="space-y-7">
      <section aria-labelledby="khoy" className="flex flex-wrap items-center gap-4 rounded-3xl bg-brand-strong p-5 text-white dark:bg-[#0a2f33]">
        <div className="min-w-0 flex-1">
          <h1 id="khoy" className="text-3xl font-extrabold">
            {summary.total === 0 ? 'Nada programado hoy' : summary.pending === 0 ? '¡Todo hecho por hoy!' : `Quedan ${summary.pending} tareas`}
          </h1>
          <p className="text-lg text-white/85">
            {summary.done} de {summary.total} hechas
          </p>
        </div>
        <div className="font-display text-5xl font-extrabold tabular" aria-hidden="true">
          {summary.percent}%
        </div>
      </section>

      {today.alerts.length > 0 ? (
        <section aria-labelledby="kalert" className="rounded-3xl border-2 border-bad/50 bg-bad-soft p-4">
          <h2 id="kalert" className="flex items-center gap-2 text-xl font-bold text-bad">
            <Icon name="alert" /> {today.alerts.length === 1 ? 'Hay 1 alerta' : `Hay ${today.alerts.length} alertas`}
          </h2>
          <ul className="mt-2 space-y-1 text-lg">
            {today.alerts.slice(0, 4).map((a) => (
              <li key={a.recordId}>• {a.message}</li>
            ))}
          </ul>
        </section>
      ) : null}

      {pendingTemps.length + pendingClean.length > 0 ? (
        <section aria-labelledby="kpend">
          <h2 id="kpend" className="mb-3 text-2xl font-extrabold">
            Pendiente ahora
          </h2>
          <ul className="grid gap-3 sm:grid-cols-2">
            {pendingTemps.map((t) => (
              <li key={t.equipmentId}>
                <BigTile
                  disabled={readOnly}
                  onClick={() => onStart({ kind: 'temp', equipmentId: t.equipmentId })}
                  type="temperatura"
                  title={t.name}
                  subtitle={`${t.done}/${t.required} · ${formatRange(t.minTemp, t.maxTemp)}`}
                  extra={t.lastReading ? `Última: ${formatTemp(t.lastReading.value)} (${formatTime(t.lastReading.at, tz)})` : undefined}
                />
              </li>
            ))}
            {pendingClean.map((c) => (
              <li key={c.cleaningPlanId}>
                <BigTile
                  disabled={readOnly}
                  onClick={() => onStart({ kind: 'form', type: 'limpieza', preset: { cleaningPlanId: c.cleaningPlanId } })}
                  type="limpieza"
                  title={c.name}
                  subtitle="Limpieza pendiente"
                />
              </li>
            ))}
          </ul>
        </section>
      ) : summary.total > 0 ? (
        <p className="flex items-center gap-2 rounded-3xl bg-ok-soft p-5 text-xl font-bold text-ok">
          <Icon name="check" size={28} strokeWidth={3} /> No queda nada pendiente. ¡Buen trabajo!
        </p>
      ) : null}

      <section aria-labelledby="kotros">
        <h2 id="kotros" className="mb-3 text-2xl font-extrabold">
          Registrar
        </h2>
        <ul className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {RECORD_TYPES.map((t) => (
            <li key={t}>
              <button
                type="button"
                disabled={readOnly}
                onClick={() => (t === 'temperatura' ? onStart({ kind: 'temp', equipmentId: '' }) : onStart({ kind: 'form', type: t }))}
                className="flex min-h-32 w-full flex-col items-center justify-center gap-2 rounded-3xl border border-line bg-surface p-3 text-center shadow-card transition-transform active:scale-[0.97] disabled:opacity-50"
              >
                <span className={cn('grid size-14 place-items-center rounded-2xl', RECORD_TINT[t])}>
                  <Icon name={RECORD_ICON[t]} size={32} />
                </span>
                <span className="text-lg font-bold">{RECORD_SHORT[t]}</span>
              </button>
            </li>
          ))}
        </ul>
      </section>
      <div className="flex justify-between gap-3 border-t border-line pt-4 text-ink-muted">
        <Link to="/" className="inline-flex min-h-12 items-center underline underline-offset-4">
          Salir del modo cocina
        </Link>
        <button type="button" onClick={onUnpair} className="inline-flex min-h-12 items-center underline underline-offset-4">
          Desvincular esta tablet
        </button>
      </div>
    </div>
  );
}

function BigTile({ onClick, type, title, subtitle, extra, disabled }: { onClick: () => void; type: RecordType; title: string; subtitle: string; extra?: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex min-h-28 w-full items-center gap-4 rounded-3xl border-2 border-warn-solid/60 bg-surface p-4 text-left shadow-card transition-transform active:scale-[0.98] disabled:opacity-50"
    >
      <span className={cn('grid size-16 shrink-0 place-items-center rounded-2xl', RECORD_TINT[type])}>
        <Icon name={RECORD_ICON[type]} size={34} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-xl font-extrabold">{title}</span>
        <span className="block text-ink-muted">{subtitle}</span>
        {extra ? <span className="block text-sm text-ink-muted">{extra}</span> : null}
      </span>
      <Icon name="chevronRight" size={30} className="shrink-0 text-ink-muted" />
    </button>
  );
}

function WhoScreen({ ctx, onPick, onBack }: { ctx: KioskContext; onPick: (s: KioskContext['staff'][number]) => void; onBack: () => void }) {
  return (
    <section aria-labelledby="kwho">
      <BackButton onClick={onBack} />
      <h1 id="kwho" className="mb-5 text-4xl font-extrabold">
        ¿Quién eres?
      </h1>
      {ctx.staff.length === 0 ? (
        <Callout tone="warn" title="No hay personal dado de alta">
          Pide al encargado que añada al personal en Ajustes → Personal.
        </Callout>
      ) : (
        <ul className="grid grid-cols-2 gap-3 md:grid-cols-3">
          {ctx.staff.map((s) => (
            <li key={s.id}>
              <button
                type="button"
                onClick={() => onPick(s)}
                className="flex min-h-28 w-full flex-col items-center justify-center gap-2 rounded-3xl border-2 border-line bg-surface p-4 shadow-card transition-transform active:scale-[0.97]"
              >
                <span className="grid size-14 place-items-center rounded-full bg-brand-soft font-display text-2xl font-extrabold text-brand-strong dark:text-brand" aria-hidden="true">
                  {s.name.trim().charAt(0).toUpperCase()}
                </span>
                <span className="text-xl font-bold">{s.name}</span>
                {s.hasPin ? (
                  <span className="inline-flex items-center gap-1 text-sm text-ink-muted">
                    <Icon name="lock" size={14} /> con PIN
                  </span>
                ) : null}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function PinScreen({ person, error, busy, onDone, onBack }: { person: Person; error?: string; busy: boolean; onDone: (pin: string) => void; onBack: () => void }) {
  const [pin, setPin] = useState('');
  return (
    <section aria-labelledby="kpin" className="mx-auto max-w-md">
      <BackButton onClick={onBack} label="Cancelar" />
      <h1 id="kpin" className="text-center text-3xl font-extrabold">
        Hola, {person.name}
      </h1>
      <p className="mt-1 text-center text-xl text-ink-muted">Escribe tu PIN</p>
      <div className={cn('my-5 flex justify-center gap-3', error && 'animate-shake')} aria-live="polite" aria-label={`${pin.length} cifras escritas`}>
        {Array.from({ length: Math.max(4, pin.length) }, (_, i) => (
          <span key={i} className={cn('size-5 rounded-full border-2', i < pin.length ? 'border-ink bg-ink' : 'border-line-strong')} />
        ))}
      </div>
      {error ? (
        <p role="alert" className="mb-4 text-center text-xl font-bold text-bad">
          {error}
        </p>
      ) : null}
      <Keypad value={pin} onChange={setPin} mode="pin" maxLength={6} />
      <Button size="xl" block className="mt-4" disabled={pin.length < 4} loading={busy} onClick={() => onDone(pin)} icon="check">
        Entrar
      </Button>
    </section>
  );
}

function PickEquipment({ ctx, onPick, onBack }: { ctx: KioskContext; onPick: (id: string) => void; onBack: () => void }) {
  const list = ctx.equipment.filter((e) => e.type !== 'freidora');
  return (
    <section aria-labelledby="kpick">
      <BackButton onClick={onBack} />
      <h1 id="kpick" className="mb-5 text-3xl font-extrabold">
        ¿Qué equipo?
      </h1>
      <ul className="grid gap-3 sm:grid-cols-2">
        {list.map((e) => (
          <li key={e.id}>
            <button type="button" onClick={() => onPick(e.id)} className="flex min-h-24 w-full items-center gap-4 rounded-3xl border-2 border-line bg-surface p-4 text-left shadow-card active:scale-[0.98]">
              <Icon name="thermometer" size={32} className="text-brand" />
              <span>
                <span className="block text-xl font-bold">{e.name}</span>
                <span className="block text-ink-muted">{formatRange(e.minTemp, e.maxTemp)}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function TempScreen({
  ctx,
  equipmentId,
  saving,
  serverError,
  disabled,
  onSubmit,
  onBack,
}: {
  ctx: KioskContext;
  equipmentId: string;
  saving: boolean;
  serverError: unknown;
  disabled: boolean;
  onSubmit: (data: { equipmentId: string; value: number; correctiveAction: string | null }) => void;
  onBack: () => void;
}) {
  const [eqId, setEqId] = useState(equipmentId);
  const [value, setValue] = useState('');
  const [step, setStep] = useState<'value' | 'action'>('value');
  const [action, setAction] = useState('');
  const eq = ctx.equipment.find((e) => e.id === eqId);
  if (!eq) return <PickEquipment ctx={ctx} onBack={onBack} onPick={setEqId} />;
  const num = keypadToNumber(value);
  const out = num != null && isOutOfRange(num, eq.minTemp, eq.maxTemp);
  const err = serverError ? errorMessage(serverError) : null;

  if (step === 'action') {
    return (
      <section aria-labelledby="kact" className="mx-auto max-w-3xl">
        <BackButton onClick={() => setStep('value')} label="Cambiar temperatura" />
        <div className="rounded-3xl border-2 border-bad bg-bad-soft p-5" role="alert">
          <p className="flex items-center gap-2 text-xl font-bold text-bad">
            <Icon name="alert" size={28} /> Fuera de rango
          </p>
          <p className="mt-1 text-2xl font-extrabold">
            {eq.name}: {formatTemp(num)} <span className="text-lg font-semibold text-ink-muted">(correcto: {formatRange(eq.minTemp, eq.maxTemp)})</span>
          </p>
        </div>
        <h1 id="kact" className="mt-6 mb-3 text-3xl font-extrabold">
          ¿Qué has hecho?
        </h1>
        <div className="grid gap-3 sm:grid-cols-2">
          {TEMP_ACTIONS.map((a) => (
            <button
              key={a}
              type="button"
              aria-pressed={action === a}
              onClick={() => setAction(a)}
              className={cn('flex min-h-18 items-center gap-3 rounded-2xl border-2 px-5 text-left text-lg font-bold', action === a ? 'border-ink bg-ink text-paper' : 'border-line-strong bg-surface')}
            >
              {action === a ? <Icon name="check" size={24} strokeWidth={3} /> : null}
              {a}
            </button>
          ))}
        </div>
        <label className="mt-4 block text-lg font-semibold" htmlFor="kother">
          U otra cosa:
        </label>
        <input
          id="kother"
          value={TEMP_ACTIONS.includes(action) ? '' : action}
          onChange={(e) => setAction(e.target.value)}
          maxLength={1000}
          className="mt-1 min-h-16 w-full rounded-2xl border-2 border-line-strong bg-surface px-4 text-lg"
        />
        {err ? (
          <Callout tone="bad" className="mt-4" live="assertive">
            {err}
          </Callout>
        ) : null}
        <Button
          size="xl"
          block
          variant="danger"
          className="mt-5"
          disabled={!action.trim() || disabled}
          loading={saving}
          icon="check"
          onClick={() => num != null && onSubmit({ equipmentId: eq.id, value: num, correctiveAction: action.trim() })}
        >
          Guardar con esta acción
        </Button>
      </section>
    );
  }

  return (
    <section aria-labelledby="ktemp" className="mx-auto grid max-w-4xl gap-6 md:grid-cols-2">
      <div>
        <BackButton onClick={onBack} />
        <p className="text-lg font-semibold text-ink-muted">{EQUIPMENT_TYPE_LABELS[eq.type]}</p>
        <h1 id="ktemp" className="text-4xl font-extrabold">
          {eq.name}
        </h1>
        <p className="mt-1 text-xl text-ink-muted">Correcto: {formatRange(eq.minTemp, eq.maxTemp)}</p>
        <output
          aria-live="polite"
          aria-label="Temperatura escrita"
          className={cn(
            'mt-6 flex min-h-28 items-center justify-end rounded-3xl border-4 px-6 font-display text-6xl font-extrabold tabular transition-colors',
            num == null ? 'border-line bg-surface' : out ? 'border-bad-solid bg-bad-soft text-bad' : 'border-ok-solid bg-ok-soft text-ok',
          )}
        >
          {value ? `${keypadDisplay(value)} °C` : <span className="text-ink-muted/50">— °C</span>}
        </output>
        <p className="mt-3 min-h-8 text-xl font-bold" aria-live="polite">
          {num == null ? '' : out ? (
            <span className="text-bad">
              <Icon name="alert" className="mr-1 inline" /> Fuera de rango
            </span>
          ) : (
            <span className="text-ok">
              <Icon name="check" className="mr-1 inline" strokeWidth={3} /> Dentro de rango
            </span>
          )}
        </p>
        {err ? (
          <Callout tone="bad" className="mt-2" live="assertive">
            {err}
          </Callout>
        ) : null}
      </div>
      <div>
        <Keypad value={value} onChange={setValue} mode="decimal" maxLength={4} />
        <Button
          size="xl"
          block
          className="mt-3"
          variant={out ? 'danger' : 'ok'}
          disabled={num == null || disabled}
          loading={saving}
          icon={out ? 'arrowRight' : 'check'}
          onClick={() => {
            if (num == null) return;
            if (out) setStep('action');
            else onSubmit({ equipmentId: eq.id, value: num, correctiveAction: null });
          }}
        >
          {out ? 'Siguiente' : 'Guardar'}
        </Button>
      </div>
    </section>
  );
}

function ResultScreen({ record, tz, onDone }: { record: AppRecord; tz: string; onDone: () => void }) {
  const s = recordSummary(record);
  useEffect(() => {
    const id = window.setTimeout(onDone, record.alert ? 8000 : 3500);
    return () => window.clearTimeout(id);
  }, [onDone, record.alert]);
  return (
    <section role="status" className="mx-auto max-w-xl py-8 text-center" data-testid="kiosk-result">
      <span className={cn('mx-auto grid size-32 animate-pop place-items-center rounded-[2.5rem] text-white shadow-pop', record.alert ? 'bg-bad-solid' : 'bg-ok-solid')}>
        <Icon name={record.alert ? 'alert' : 'check'} size={72} strokeWidth={3} />
      </span>
      <h1 className="mt-6 text-5xl font-extrabold">{record.alert ? 'Guardado con alerta' : 'Hecho'}</h1>
      <p className="mt-3 text-2xl font-semibold">{s.title}</p>
      <p className="text-xl text-ink-muted">
        {s.detail} · {formatTime(record.createdAt, tz)}
      </p>
      <Button size="xl" className="mt-8" onClick={onDone}>
        Volver al inicio
      </Button>
    </section>
  );
}
