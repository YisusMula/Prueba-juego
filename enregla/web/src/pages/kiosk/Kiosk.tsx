import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  EQUIPMENT_TYPE_LABELS,
  KIOSK_CORRECTION_MINUTES,
  KIOSK_CORRECTION_REASON_LABELS,
  RECORD_TYPES,
  RECORD_TYPE_LABELS,
  TEMP_RANGE_MESSAGE,
  type KioskCorrectionReason,
} from '@shared/schemas';
import { TODAY_REFRESH } from '@/api/queries';
import { errorMessage, formatWait, isApiError } from '@/api/client';
import type { AppRecord, KioskContext, RecordType, TodayTasks } from '@/api/types';
import { Button } from '@/components/ui/Button';
import { Callout, Skeleton } from '@/components/ui/Feedback';
import { Field, Input } from '@/components/ui/Form';
import { Keypad, keypadDisplay, keypadToNumber } from '@/components/ui/Keypad';
import { LogoMark } from '@/components/ui/Logo';
import { Icon } from '@/components/icons/Icon';
import { RecordForm, TEMP_ACTIONS, physicallyValidTemp, type FormContext } from '@/features/RecordForms';
import { IdempotencyKeys } from '@/lib/idempotency';
import { RECORD_ICON, RECORD_SHORT, RECORD_TINT, recordSummary, signer } from '@/features/recordMeta';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { useOnline } from '@/hooks/useOnline';
import { remeasureDue, useNow } from '@/hooks/useNow';
import { formatCompliance, formatRange, formatTemp, formatTime, isOutOfRange, plural, quedan } from '@/lib/format';
import { storage } from '@/lib/storage';
import { cn } from '@/lib/cn';
import { kioskApi } from './kioskApi';
import { KioskPairPage } from './KioskPair';

/** Persona que está registrando. El PIN vive SOLO en memoria y caduca por inactividad. */
type Person = { id: string; name: string; hasPin: boolean; pin?: string };
type Target = { kind: 'temp'; equipmentId: string } | { kind: 'form'; type: RecordType; preset?: Record<string, string> };
/** Último registro guardado en esta tablet: se puede corregir durante 2 minutos (1.5). */
type Recent = { record: AppRecord; person: Person; savedAt: number };
type Screen =
  | { name: 'home' }
  | { name: 'who'; then: Target | null }
  | { name: 'pin'; person: Person; then: Target | null; error?: string; retry?: Pending; attempt?: number }
  | { name: 'temp'; equipmentId: string }
  | { name: 'pick-equipment' }
  | { name: 'form'; type: RecordType; preset?: Record<string, string> }
  | { name: 'result'; record: AppRecord; person: Person; corrected?: boolean }
  | { name: 'correct'; recent: Recent }
  | { name: 'manager'; action: 'exit' | 'unpair' | 'unlock'; staff?: { id: string; name: string } };
type Pending = { type: RecordType; data: unknown };

/** Inactividad: se olvida a la persona (y su PIN) y se vuelve al inicio. */
export const IDLE_MS = 60_000;
/**
 * N4: tras CONFIRM_MS sin tocar la pantalla con una persona elegida, la tablet pasa a pantalla completa
 * «¿Eres Ana?» (Sí, soy Ana / No, soy otra persona): el siguiente toque cae siempre en esa pregunta, así
 * nadie firma como Ana sin darse cuenta. A los IDLE_MS se olvida a la persona como siempre.
 */
export const CONFIRM_MS = 20_000;
/**
 * R5: durante este tiempo tras aparecer «¿Eres Ana?» no se acepta ningún toque (quien tocaba a ciegas la
 * rejilla de equipos no responde sin querer). Las respuestas están ARRIBA, en la franja de la cabecera,
 * y el resto de la pantalla es neutro: tocar donde estaban los equipos no hace nada.
 */
export const CONFIRM_ARM_MS = 700;
/**
 * Tras guardar se muestra «Guardado por Ana» este tiempo (más si hay alerta) y se vuelve solo a la lista
 * de equipos (temperaturas) o al inicio, con la persona elegida y la franja «Registrando como Ana»
 * siempre visible. La persona se olvida tras IDLE_MS sin tocar la pantalla, al tocar el logo o al salir.
 */
export const RESULT_MS = 2_500;
export const RESULT_ALERT_MS = 6_000;
const CORRECTION_MS = KIOSK_CORRECTION_MINUTES * 60_000;

export function KioskPage() {
  useDocumentTitle('Modo cocina');
  const [token, setToken] = useState<string | null>(() => storage.getKioskToken());
  const [revoked, setRevoked] = useState(false);
  const [exited, setExited] = useState<string | null>(null);
  // Al entrar con `{ kioskStart: 'who' }` se empieza de cero (aunque ya se estuviera en el modo cocina).
  const location = useLocation();
  const startKey = (location.state as { kioskStart?: string } | null)?.kioskStart ? location.key : 'kiosk';

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
  if (exited && token) return <KioskExited by={exited} onBack={() => setExited(null)} />;
  if (!token) return <KioskPairPage />;
  return (
    <KioskApp
      key={startKey}
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
      onExit={(by) => setExited(by)}
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

/**
 * Pantalla neutra tras «Salir del modo cocina» (1.10): no lleva a la web comercial. La tablet sigue
 * vinculada: «Volver al modo cocina» no pide nada; «Entrar como encargado» abre el acceso normal.
 */
function KioskExited({ by, onBack }: { by: string; onBack: () => void }) {
  useDocumentTitle('Modo cocina cerrado');
  return (
    <KioskFrame>
      <div className="mx-auto flex min-h-[80dvh] max-w-xl flex-col justify-center py-10 text-center" data-testid="kiosk-exited">
        <LogoMark size={56} className="mx-auto" />
        <h1 className="mt-6 text-4xl font-extrabold">Modo cocina cerrado</h1>
        <p className="mt-3 text-xl text-ink-muted">Lo ha cerrado {by}. La tablet sigue vinculada a este local.</p>
        <div className="mt-8 grid gap-3">
          <Button size="xl" icon="chef" onClick={onBack}>
            Volver al modo cocina
          </Button>
          <Link
            to="/entrar"
            className="inline-flex min-h-16 items-center justify-center gap-2 rounded-2xl border-2 border-line-strong bg-surface px-5 text-xl font-bold hover:border-ink"
          >
            <Icon name="user" size={24} /> Entrar como encargado
          </Link>
        </div>
      </div>
    </KioskFrame>
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

/** Segundos que quedan hasta `until` (se actualiza cada segundo mientras queda tiempo). */
function useSecondsLeft(until: number | null): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (until == null) return;
    const tick = () => {
      const n = Date.now();
      setNow(n);
      if (n >= until) window.clearInterval(id);
    };
    const first = window.setTimeout(tick, 0);
    const id = window.setInterval(tick, 1000);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(id);
    };
  }, [until]);
  return until == null ? 0 : Math.max(0, Math.ceil((until - now) / 1000));
}

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

function KioskApp({ token, onRevoked, onUnpair, onExit }: { token: string; onRevoked: () => void; onUnpair: () => void; onExit: (by: string) => void }) {
  const qc = useQueryClient();
  const online = useOnline();
  const now = useClock();
  const ctxQ = useQuery({ queryKey: ['kiosk', 'context'], queryFn: () => kioskApi.context(token), refetchInterval: 5 * 60_000, ...TODAY_REFRESH });
  const todayQ = useQuery({ queryKey: ['kiosk', 'today'], queryFn: () => kioskApi.today(token), refetchInterval: 60_000, ...TODAY_REFRESH });
  // Se puede abrir directamente en «¿Quién eres?» (estado de navegación `{ kioskStart: 'who' }`).
  const location = useLocation();
  const [screen, setScreen] = useState<Screen>(() =>
    (location.state as { kioskStart?: string } | null)?.kioskStart === 'who' ? { name: 'who', then: null } : { name: 'home' },
  );
  const [person, setPerson] = useState<Person | null>(null);
  const [recent, setRecent] = useState<Recent | null>(null);
  const [saving, setSaving] = useState(false);
  const [serverError, setServerError] = useState<unknown>(null);
  const [notice, setNotice] = useState<string | null>(null);
  /** R7: persona con el PIN bloqueado: un responsable puede desbloquearlo aquí mismo. */
  const [lockedStaff, setLockedStaff] = useState<{ id: string; name: string } | null>(null);
  const [verifying, setVerifying] = useState(false);
  const idleTimer = useRef<number | undefined>(undefined);
  const confirmTimer = useRef<number | undefined>(undefined);
  const personRef = useRef<Person | null>(null);
  const [confirmWho, setConfirmWho] = useState(false);
  const [confirmArmed, setConfirmArmed] = useState(false);
  useEffect(() => {
    if (!confirmWho) return setConfirmArmed(false);
    const t = window.setTimeout(() => setConfirmArmed(true), CONFIRM_ARM_MS);
    return () => window.clearTimeout(t);
  }, [confirmWho]);
  // Clave de idempotencia por registro: se reutiliza en los reintentos (también los automáticos al volver la conexión).
  const [keys] = useState(() => new IdempotencyKeys());
  /** Último envío que falló por red o tiempo agotado: se reintenta solo al volver `online`. */
  const [failed, setFailedState] = useState<{ pending: Pending; who: Person } | null>(null);
  const failedRef = useRef<{ pending: Pending; who: Person } | null>(null);
  const setFailed = (f: { pending: Pending; who: Person } | null) => {
    failedRef.current = f;
    setFailedState(f);
  };

  const unauthorized = [ctxQ.error, todayQ.error].some((e) => isApiError(e) && e.code === 'UNAUTHENTICATED');
  useEffect(() => {
    if (unauthorized) onRevoked();
  }, [unauthorized, onRevoked]);

  // Inactividad: se olvida a la persona (y su PIN) y se vuelve al inicio.
  const touch = useCallback(() => {
    window.clearTimeout(idleTimer.current);
    window.clearTimeout(confirmTimer.current);
    confirmTimer.current = window.setTimeout(() => {
      if (personRef.current) setConfirmWho(true);
    }, CONFIRM_MS);
    idleTimer.current = window.setTimeout(() => {
      setConfirmWho(false);
      setPerson(null);
      setScreen({ name: 'home' });
    }, IDLE_MS);
  }, []);
  useEffect(() => {
    personRef.current = person;
    if (!person) setConfirmWho(false);
  }, [person]);
  useEffect(() => {
    touch();
    window.addEventListener('pointerdown', touch);
    window.addEventListener('keydown', touch);
    return () => {
      window.clearTimeout(idleTimer.current);
      window.clearTimeout(confirmTimer.current);
      window.removeEventListener('pointerdown', touch);
      window.removeEventListener('keydown', touch);
    };
  }, [touch]);

  // El registro reciente deja de poder corregirse a los 2 minutos.
  const correctionLeft = useSecondsLeft(recent ? recent.savedAt + CORRECTION_MS : null);
  const canCorrect = recent != null && correctionLeft > 0;

  const ctx = ctxQ.data;
  const readOnly = ctx?.organization.readOnly ?? false;

  const goTarget = (t: Target | null) => {
    if (!t) return setScreen({ name: 'home' });
    if (t.kind === 'temp') setScreen(t.equipmentId ? { name: 'temp', equipmentId: t.equipmentId } : { name: 'pick-equipment' });
    else setScreen({ name: 'form', type: t.type, preset: t.preset });
  };

  const start = (t: Target) => {
    setServerError(null);
    setNotice(null);
    if (!person) setScreen({ name: 'who', then: t });
    else goTarget(t);
  };

  const forgetPerson = () => {
    setPerson(null);
    setScreen({ name: 'who', then: null });
  };
  /** «He terminado»: se olvida a la persona y se vuelve al inicio. */
  const finish = () => {
    setPerson(null);
    setScreen({ name: 'home' });
  };
  /** «No, soy otra persona» tras la pausa: se pregunta quién es y se sigue con lo que había en pantalla. */
  const someoneElse = () => {
    setConfirmWho(false);
    setPerson(null);
    setScreen((sc) => ({
      name: 'who',
      then: sc.name === 'temp' ? { kind: 'temp', equipmentId: sc.equipmentId } : sc.name === 'form' ? { kind: 'form', type: sc.type, preset: sc.preset } : sc.name === 'pick-equipment' ? { kind: 'temp', equipmentId: '' } : null,
    }));
  };

  const submit = async (pending: Pending, who: Person | null = person) => {
    if (!who) return setScreen({ name: 'who', then: null });
    setSaving(true);
    setServerError(null);
    setFailed(null);
    try {
      const record = await kioskApi.createRecord(token, { staffId: who.id, pin: who.pin, type: pending.type, data: pending.data }, keys.keyFor({ staffId: who.id, ...pending }));
      keys.reset();
      setPerson(who);
      setRecent({ record, person: { id: who.id, name: who.name, hasPin: who.hasPin }, savedAt: Date.now() });
      setScreen({ name: 'result', record, person: who });
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
          setLockedStaff({ id: who.id, name: who.name });
          setNotice(`El PIN de ${who.name} está bloqueado por demasiados intentos.${err.retryAfter ? ` Inténtalo en ${formatWait(err.retryAfter)}` : ''} o pide a un encargado que lo desbloquee.`);
          setScreen({ name: 'home' });
          return;
        }
        if (err.code === 'READ_ONLY') {
          void qc.invalidateQueries({ queryKey: ['kiosk', 'context'] });
        }
        if (err.retryable) setFailed({ pending, who });
      }
      setServerError(err);
    } finally {
      setSaving(false);
    }
  };

  // Al volver la conexión: se refrescan los datos y se reintenta el registro que falló (misma clave).
  const submitRef = useRef(submit);
  useEffect(() => {
    submitRef.current = submit;
  });
  useEffect(() => {
    const onOnline = () => {
      void qc.invalidateQueries({ queryKey: ['kiosk'] });
      const f = failedRef.current;
      failedRef.current = null;
      setFailedState(null);
      if (f) void submitRef.current(f.pending, f.who);
    };
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, [qc]);

  /** Identificación con PIN: se comprueba en el servidor ANTES de dejar registrar. */
  const verify = async (p: Person, pin: string, then: Target | null, retry?: Pending) => {
    setVerifying(true);
    try {
      await kioskApi.verifyPin(token, { staffId: p.id, pin });
      const who = { ...p, pin };
      if (retry) {
        setVerifying(false);
        void submit(retry, who);
        return;
      }
      setPerson(who);
      goTarget(then);
    } catch (err) {
      if (isApiError(err) && err.code === 'UNAUTHENTICATED') return onRevoked();
      if (isApiError(err) && err.code === 'PIN_LOCKED') {
        setLockedStaff({ id: p.id, name: p.name });
        setNotice(`El PIN de ${p.name} está bloqueado por demasiados intentos.${err.retryAfter ? ` Inténtalo en ${formatWait(err.retryAfter)}` : ''} o pide a un encargado que lo desbloquee.`);
        setScreen({ name: 'home' });
      } else {
        setScreen((s) => ({
          name: 'pin',
          person: p,
          then,
          retry,
          error: isApiError(err) && err.code === 'INVALID_PIN' ? 'PIN incorrecto. Prueba otra vez.' : errorMessage(err),
          attempt: (s.name === 'pin' ? (s.attempt ?? 0) : 0) + 1,
        }));
      }
    } finally {
      setVerifying(false);
    }
  };

  const formCtx: FormContext | null = ctx
    ? {
        equipment: ctx.equipment,
        cleaningPlans: ctx.cleaningPlans,
        suppliers: ctx.suppliers,
        staff: ctx.staff,
        timezone: ctx.organization.timezone,
        customTemplates: ctx.customTemplates ?? [],
        referenceValues: ctx.referenceValues,
        coolings: todayQ.data?.coolings ?? [],
      }
    : null;
  const showRecent = canCorrect && (screen.name === 'home' || screen.name === 'who' || screen.name === 'pick-equipment');

  return (
    <div className="flex min-h-dvh flex-col bg-paper">
      <header className="sticky top-[var(--app-top,0px)] z-20 border-b border-line bg-surface/95 backdrop-blur">
        <div className="flex items-center gap-3 px-4 py-2.5 sm:px-6">
          <button
            type="button"
            onClick={() => {
              // Volver al inicio desde el logo olvida a la persona: nadie sigue firmando como ella sin querer.
              setPerson(null);
              setScreen({ name: 'home' });
            }}
            className="flex min-h-16 min-w-0 flex-1 items-center gap-3 rounded-2xl pr-3"
          >
            <span className="sr-only">Inicio del modo cocina: </span>
            <LogoMark size={40} className="shrink-0" />
            <span className="min-w-0 text-left">
              <span className="block truncate text-xl leading-tight font-extrabold" title={ctx?.organization.name}>
                {ctx?.organization.name ?? 'Modo cocina'}
              </span>
              <span className="block text-sm text-ink-muted tabular">
                {now.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', timeZone: ctx?.organization.timezone })} · {ctx?.device.name ?? ''}
              </span>
            </span>
          </button>
          <div className="ml-auto flex shrink-0 items-center gap-2">
            {person ? (
              <button type="button" onClick={forgetPerson} className="flex min-h-16 items-center gap-2 rounded-2xl border-2 border-brand bg-brand-soft px-4 font-bold">
                <Icon name="user" size={24} />
                <span className="max-w-[10rem] truncate">{person.name}</span>
                <span className="hidden text-sm font-semibold text-ink-muted sm:inline">· cambiar</span>
              </button>
            ) : (
              <button type="button" onClick={() => setScreen({ name: 'who', then: null })} className="flex min-h-16 items-center gap-2 rounded-2xl border-2 border-line-strong px-4 font-bold whitespace-nowrap">
                <Icon name="user" size={24} /> ¿Quién eres?
              </button>
            )}
            {/* Solo si el navegador permite pantalla completa aquí (p. ej. no dentro de un marco que no la autoriza). */}
            {document.fullscreenEnabled ? (
              <button
                type="button"
                className="hidden size-16 place-items-center rounded-2xl hover:bg-surface-2 sm:grid"
                aria-label="Pantalla completa"
                onClick={() => {
                  if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
                  else void document.documentElement.requestFullscreen?.().catch(() => undefined);
                }}
              >
                <Icon name="maximize" size={28} />
              </button>
            ) : null}
          </div>
        </div>
        {/* 1.4: mientras hay una persona elegida, se ve en grande quién firma y cómo cambiarlo. */}
        {person ? (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-brand/30 bg-brand-soft px-4 py-2 sm:px-6" data-testid="kiosk-signing-as">
            <p className="min-w-0 text-xl [overflow-wrap:anywhere]">
              Registrando como <strong className="font-extrabold">{person.name}</strong>
            </p>
            <button type="button" onClick={forgetPerson} className="min-h-12 rounded-xl px-2 text-lg font-bold underline underline-offset-4">
              Cambiar de persona
            </button>
            <Button size="lg" icon="check" className="ml-auto min-h-14 px-6 text-xl" onClick={finish} data-testid="kiosk-finish">
              He terminado
            </Button>
          </div>
        ) : null}
      </header>
      {confirmWho && person ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="kconfirm"
          aria-describedby="kconfirm-help"
          className="fixed inset-0 z-50 flex flex-col bg-paper"
          data-testid="kiosk-confirm-person"
          data-armed={confirmArmed || undefined}
        >
          {/* Respuestas en la franja de arriba (donde está la cabecera, no la rejilla de equipos). */}
          <div className="grid grid-cols-2 gap-3 border-b-2 border-line-strong bg-surface p-3 sm:p-4">
            <Button
              size="xl"
              block
              icon="check"
              disabled={!confirmArmed}
              onClick={() => setConfirmWho(false)}
              className="min-h-20 text-xl [overflow-wrap:anywhere]"
            >
              Sí, soy {person.name}
            </Button>
            <Button
              size="xl"
              block
              variant="secondary"
              icon="users"
              disabled={!confirmArmed}
              onClick={someoneElse}
              className="min-h-20 text-xl"
            >
              No, soy otra persona
            </Button>
          </div>
          {/* Zona neutra: tocar aquí (donde estaban los equipos) no responde nada. */}
          <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center" data-testid="kiosk-confirm-neutral">
            <Icon name="user" size={64} className="text-brand" />
            <h1 id="kconfirm" className="text-4xl font-extrabold [overflow-wrap:anywhere] sm:text-5xl">
              ¿Eres {person.name}?
            </h1>
            <p id="kconfirm-help" className="max-w-xl text-xl text-ink-muted">
              Hace un rato que nadie toca la tablet. Responde <strong>arriba</strong>: tocar aquí no hace nada.
            </p>
          </div>
        </div>
      ) : null}

      {!online ? (
        <div role="status" className="bg-ink px-4 py-3 text-center text-lg font-semibold text-paper">
          <Icon name="wifiOff" size={22} className="mr-2 inline" />
          {failed ? 'Sin internet: el último registro se guardará solo en cuanto vuelva la conexión.' : 'Sin internet: no se puede guardar. Anótalo y regístralo cuando vuelva.'}
        </div>
      ) : null}
      {readOnly ? (
        <div role="status" className="bg-bad-solid px-4 py-3 text-center text-lg font-semibold text-white">
          <Icon name="lock" size={22} className="mr-2 inline" /> Local en solo lectura: ahora no se pueden guardar registros. Avisa al encargado.
        </div>
      ) : null}

      <main id="main" tabIndex={-1} className="mx-auto w-full max-w-5xl flex-1 px-4 py-5 outline-none sm:px-6">
        {notice ? (
          <Callout
            tone="bad"
            className="mb-4 text-lg"
            live="assertive"
            action={
              <div className="flex flex-wrap gap-2">
                {lockedStaff ? (
                  <Button icon="lock" onClick={() => setScreen({ name: 'manager', action: 'unlock', staff: lockedStaff })}>
                    Desbloquear (responsable)
                  </Button>
                ) : null}
                <Button
                  variant="ghost"
                  onClick={() => {
                    setNotice(null);
                    setLockedStaff(null);
                  }}
                >
                  Cerrar
                </Button>
              </div>
            }
          >
            {notice}
          </Callout>
        ) : null}
        {showRecent && recent ? (
          <RecentBanner recent={recent} secondsLeft={correctionLeft} tz={ctx?.organization.timezone ?? 'Europe/Madrid'} onCorrect={() => setScreen({ name: 'correct', recent })} />
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
          <KioskHome
            ctx={ctx}
            today={todayQ.data}
            readOnly={readOnly}
            onStart={start}
            onExit={() => setScreen({ name: 'manager', action: 'exit' })}
            onUnpair={() => setScreen({ name: 'manager', action: 'unpair' })}
          />
        ) : screen.name === 'who' ? (
          <WhoScreen
            ctx={ctx}
            refreshing={ctxQ.isFetching}
            onRefresh={() => void ctxQ.refetch()}
            onBack={() => setScreen({ name: 'home' })}
            onPick={(s) => {
              setNotice(null);
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
            key={`${screen.person.id}-${screen.attempt ?? 0}-${screen.error ?? ''}`}
            person={screen.person}
            error={screen.error}
            busy={saving || verifying}
            onBack={() => setScreen({ name: 'home' })}
            onDone={(pin) => void verify(screen.person, pin, screen.then, screen.retry)}
          />
        ) : screen.name === 'pick-equipment' ? (
          <PickEquipment ctx={ctx} today={todayQ.data} onBack={() => setScreen({ name: 'home' })} onPick={(id) => setScreen({ name: 'temp', equipmentId: id })} />
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
        ) : screen.name === 'correct' ? (
          <CorrectionFlow
            key={screen.recent.record.id}
            token={token}
            ctx={ctx}
            formCtx={formCtx}
            recent={screen.recent}
            secondsLeft={correctionLeft}
            onCancel={() => setScreen({ name: 'home' })}
            onRevoked={onRevoked}
            onDone={(amended, who) => {
              setRecent(null);
              setPerson(null);
              void qc.invalidateQueries({ queryKey: ['kiosk', 'today'] });
              setScreen({ name: 'result', record: amended, person: who, corrected: true });
            }}
          />
        ) : screen.name === 'manager' ? (
          <ManagerAuthScreen
            token={token}
            action={screen.action}
            staff={screen.staff}
            onCancel={() => setScreen({ name: 'home' })}
            onRevoked={onRevoked}
            onDone={(by) => {
              if (screen.action === 'unlock') {
                setLockedStaff(null);
                setNotice(`PIN de ${screen.staff?.name ?? ''} desbloqueado por ${by}. Ya puede volver a identificarse.`);
                setScreen({ name: 'home' });
                return;
              }
              setPerson(null);
              setRecent(null);
              if (screen.action === 'unpair') onUnpair();
              else onExit(by);
            }}
          />
        ) : (
          <ResultScreen
            key={screen.record.id}
            record={screen.record}
            person={screen.person}
            corrected={screen.corrected}
            tz={ctx.organization.timezone}
            canCorrect={!screen.corrected && canCorrect && recent?.record.id === screen.record.id}
            onContinue={() => {
              setPerson(screen.corrected ? null : screen.person);
              // De temperatura en temperatura: directamente a la lista de equipos, con la persona elegida.
              setScreen(!screen.corrected && screen.record.type === 'temperatura' ? { name: 'pick-equipment' } : { name: 'home' });
            }}
            onSomeoneElse={forgetPerson}
            onCorrect={() => recent && setScreen({ name: 'correct', recent })}
          />
        )}
      </main>
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

/** Aviso del último registro, con «Corregir» mientras quedan los 2 minutos (1.5). */
function RecentBanner({ recent, secondsLeft, tz, onCorrect }: { recent: Recent; secondsLeft: number; tz: string; onCorrect: () => void }) {
  const s = recordSummary(recent.record);
  return (
    <div className="mb-5 flex flex-wrap items-center gap-3 rounded-3xl border-2 border-line-strong bg-surface p-4" role="status" data-testid="kiosk-recent">
      <span className={cn('grid size-12 shrink-0 place-items-center rounded-2xl', RECORD_TINT[recent.record.type])}>
        <Icon name={RECORD_ICON[recent.record.type]} size={26} />
      </span>
      <p className="min-w-0 flex-1 text-lg [overflow-wrap:anywhere]">
        Último registro: <strong>{s.title}</strong> · {recent.person.name} · {formatTime(recent.record.effectiveAt, tz)}
        <span className="block text-base text-ink-muted">¿Te has equivocado? Puedes corregirlo durante {mmss(secondsLeft)}.</span>
      </p>
      <Button size="lg" variant="secondary" icon="pencil" onClick={onCorrect}>
        Corregir
      </Button>
    </div>
  );
}

function KioskHome({
  ctx,
  today,
  readOnly,
  onStart,
  onExit,
  onUnpair,
}: {
  ctx: KioskContext;
  today: TodayTasks;
  readOnly: boolean;
  onStart: (t: Target) => void;
  onExit: () => void;
  onUnpair: () => void;
}) {
  const tz = ctx.organization.timezone;
  // 1.12: un equipo cuya última lectura está fuera de rango sigue pendiente como «Volver a medir».
  const pendingTemps = today.temperatures.filter((t) => (t.status === 'pending' && t.countsToday !== false) || t.remeasure);
  const pendingClean = today.cleaning.filter((c) => c.status === 'pending' && c.countsToday !== false);
  const doneTemps = today.temperatures.filter((t) => t.status === 'done' && t.countsToday !== false);
  const doneClean = today.cleaning.filter((c) => c.status === 'done' && c.countsToday !== false);
  const pendingCustom = (today.custom ?? []).filter((c) => c.status === 'pending' && c.countsToday !== false);
  const doneCustom = (today.custom ?? []).filter((c) => c.status === 'done' && c.countsToday !== false);
  const coolings = today.coolings ?? [];
  const { summary } = today;
  const remeasure = today.temperatures.filter((t) => t.remeasure).length;
  const nowMs = useNow();
  const [allAlerts, setAllAlerts] = useState(false);
  const shownAlerts = allAlerts ? today.alerts : today.alerts.slice(0, 4);
  return (
    <div className="space-y-7">
      <section aria-labelledby="khoy" className="flex flex-wrap items-center gap-4 rounded-3xl bg-brand-strong p-5 text-white dark:bg-[#0a2f33]">
        <div className="min-w-0 flex-1">
          <h1 id="khoy" className="text-3xl font-extrabold">
            {summary.total === 0
              ? 'Nada programado hoy'
              : summary.pending === 0
                ? remeasure > 0
                  ? `Falta volver a medir ${remeasure === 1 ? '1 equipo' : `${remeasure} equipos`}`
                  : '¡Todo hecho por hoy!'
                : quedan(summary.pending, 'tarea', 'tareas')}
          </h1>
          <p className="text-lg text-white/85">
            {summary.done} de {summary.total} hechas
            {(summary.doneWithAlert ?? 0) > 0 ? ` · ${summary.doneWithAlert} con alerta` : ''}
          </p>
        </div>
        <div className="font-display text-5xl font-extrabold tabular" aria-hidden="true">
          {formatCompliance(summary.percent)}
        </div>
      </section>

      {today.alerts.length > 0 ? (
        <section aria-labelledby="kalert" className="rounded-3xl border-2 border-bad/50 bg-bad-soft p-4">
          <h2 id="kalert" className="flex items-center gap-2 text-xl font-bold text-bad">
            <Icon name="alert" /> {today.alerts.length === 1 ? 'Hay 1 alerta' : `Hay ${plural(today.alerts.length, 'alerta', 'alertas')}`}
          </h2>
          <ul className="mt-2 space-y-1 text-lg">
            {shownAlerts.map((a) => (
              <li key={`${a.kind}-${a.recordId}`}>• {a.message}</li>
            ))}
          </ul>
          {today.alerts.length > 4 ? (
            <button type="button" onClick={() => setAllAlerts((v) => !v)} className="mt-2 min-h-12 font-bold text-bad underline underline-offset-4" aria-expanded={allAlerts}>
              {allAlerts ? 'Ver menos' : `Ver las ${today.alerts.length} alertas`}
            </button>
          ) : null}
        </section>
      ) : null}

      {coolings.length > 0 ? (
        <section aria-labelledby="kcool">
          <h2 id="kcool" className="mb-3 text-2xl font-extrabold">
            Enfriamientos en curso
          </h2>
          <ul className="grid gap-3 sm:grid-cols-2" data-testid="kiosk-coolings">
            {coolings.map((c) => (
              <li key={c.recordId}>
                <BigTile
                  disabled={readOnly}
                  onClick={() => onStart({ kind: 'form', type: 'enfriamiento', preset: { startRecordId: c.recordId } })}
                  type="enfriamiento"
                  title={`Terminar: ${c.product}`}
                  subtitle={`Empezó a las ${formatTime(c.startedAt, tz)} a ${formatTemp(c.startTemp)}`}
                  extra={c.overdue ? `Han pasado más de ${c.maxMinutes} min` : `Antes de las ${formatTime(c.deadline, tz)}: ${formatTemp(c.targetTemp)} o menos`}
                  alert={c.overdue}
                  due={c.overdue}
                />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {pendingTemps.length + pendingClean.length + pendingCustom.length > 0 ? (
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
                  title={remeasureDue(t, nowMs) ? `Ya toca volver a medir: ${t.name}` : t.remeasure ? `Volver a medir: ${t.name}` : t.name}
                  due={remeasureDue(t, nowMs)}
                  subtitle={`${t.done} de ${t.required} · ${formatRange(t.minTemp, t.maxTemp)}`}
                  extra={
                    t.lastReading
                      ? `Última: ${formatTemp(t.lastReading.value)} (${formatTime(t.lastReading.at, tz)})${t.remeasure ? `, fuera de rango${t.remeasureFrom ? `. Vuelve a medir desde las ${formatTime(t.remeasureFrom, tz)}` : ''}` : ''}`
                      : undefined
                  }
                  alert={t.remeasure}
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
                  subtitle={c.partial ? `Parcial (${c.partial.done} de ${c.partial.total}): falta completarla` : 'Limpieza pendiente'}
                />
              </li>
            ))}
            {pendingCustom.map((c) => (
              <li key={c.templateId}>
                <BigTile
                  disabled={readOnly}
                  onClick={() => onStart({ kind: 'form', type: 'personalizado', preset: { templateId: c.templateId } })}
                  type="personalizado"
                  title={c.name}
                  subtitle={c.required > 1 ? `${c.done} de ${c.required} hoy` : 'Pendiente'}
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

      {doneTemps.length + doneClean.length + doneCustom.length > 0 ? (
        <section aria-labelledby="kdone">
          <h2 id="kdone" className="mb-3 text-2xl font-extrabold">
            Hecho hoy
          </h2>
          <ul className="grid gap-2 sm:grid-cols-2">
            {doneTemps.map((t) => (
              <li key={t.equipmentId} className="flex min-h-14 items-center gap-3 rounded-2xl border border-line bg-surface px-4 py-2">
                {t.withAlert ? <Icon name="alert" size={24} className="shrink-0 text-bad" /> : <Icon name="check" size={24} strokeWidth={3} className="shrink-0 text-ok" />}
                <span className="min-w-0 flex-1 text-lg font-semibold [overflow-wrap:anywhere]">{t.name}</span>
                <span className={cn('shrink-0 font-bold', t.withAlert ? 'text-bad' : 'text-ok')}>{t.withAlert ? 'Hecho con alerta' : 'Hecho'}</span>
              </li>
            ))}
            {doneClean.map((c) => (
              <li key={c.cleaningPlanId} className="flex min-h-14 items-center gap-3 rounded-2xl border border-line bg-surface px-4 py-2">
                <Icon name="check" size={24} strokeWidth={3} className="shrink-0 text-ok" />
                <span className="min-w-0 flex-1 text-lg font-semibold [overflow-wrap:anywhere]">{c.name}</span>
                <span className="shrink-0 font-bold text-ok">Hecho</span>
              </li>
            ))}
            {doneCustom.map((c) => (
              <li key={c.templateId} className="flex min-h-14 items-center gap-3 rounded-2xl border border-line bg-surface px-4 py-2">
                {c.withAlert ? <Icon name="alert" size={24} className="shrink-0 text-bad" /> : <Icon name="check" size={24} strokeWidth={3} className="shrink-0 text-ok" />}
                <span className="min-w-0 flex-1 text-lg font-semibold [overflow-wrap:anywhere]">{c.name}</span>
                <span className={cn('shrink-0 font-bold', c.withAlert ? 'text-bad' : 'text-ok')}>{c.withAlert ? 'Hecho con alerta' : 'Hecho'}</span>
              </li>
            ))}
          </ul>
        </section>
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
      {/* 1.10: salir y desvincular piden la contraseña de un propietario o encargado (en el servidor). */}
      <div className="flex flex-wrap justify-between gap-3 border-t border-line pt-4 text-ink-muted">
        <button type="button" onClick={onExit} className="inline-flex min-h-12 items-center gap-2 underline underline-offset-4">
          <Icon name="lock" size={18} /> Salir del modo cocina
        </button>
        <button type="button" onClick={onUnpair} className="inline-flex min-h-12 items-center gap-2 underline underline-offset-4">
          <Icon name="lock" size={18} /> Desvincular esta tablet
        </button>
      </div>
    </div>
  );
}

function BigTile({
  onClick,
  type,
  title,
  subtitle,
  extra,
  disabled,
  alert,
  due,
}: {
  onClick: () => void;
  type: RecordType;
  title: string;
  subtitle: string;
  extra?: string;
  disabled?: boolean;
  alert?: boolean;
  /** #14: ya ha llegado la hora de volver a medir (resaltado en pantalla; no hay notificación). */
  due?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      data-due={due || undefined}
      className={cn(
        'flex min-h-28 w-full items-center gap-4 rounded-3xl border-2 bg-surface p-4 text-left shadow-card transition-transform active:scale-[0.98] disabled:opacity-50',
        alert ? 'border-bad-solid' : 'border-warn-solid/60',
        due && 'border-4 bg-bad-soft ring-4 ring-bad-solid/30',
      )}
    >
      <span className={cn('grid size-16 shrink-0 place-items-center rounded-2xl', alert ? 'bg-bad-soft text-bad' : RECORD_TINT[type])}>
        <Icon name={alert ? 'refresh' : RECORD_ICON[type]} size={34} />
      </span>
      <span className="min-w-0 flex-1">
        {due ? (
          <span className="mb-1 inline-flex items-center gap-1 rounded-full bg-bad-solid px-3 py-0.5 text-base font-bold text-white" data-testid="remeasure-due">
            <Icon name="clock" size={16} /> Ya toca
          </span>
        ) : null}
        <span className="block text-xl font-extrabold [overflow-wrap:anywhere]">{title}</span>
        <span className="block text-ink-muted">{subtitle}</span>
        {extra ? <span className={cn('block text-sm', alert ? 'font-semibold text-bad' : 'text-ink-muted')}>{extra}</span> : null}
      </span>
      <Icon name="chevronRight" size={30} className="shrink-0 text-ink-muted" />
    </button>
  );
}

/** «¿Quién eres?»: la lista se refresca al abrirla (1.11) y hay ayuda para quien no aparece. */
function WhoScreen({
  ctx,
  onPick,
  onBack,
  onRefresh,
  refreshing,
  exclude,
  title = '¿Quién eres?',
  back = true,
}: {
  ctx: KioskContext;
  onPick: (s: KioskContext['staff'][number]) => void;
  onBack: () => void;
  onRefresh: () => void;
  refreshing: boolean;
  exclude?: string;
  title?: string;
  back?: boolean;
}) {
  const [help, setHelp] = useState(false);
  // Al mostrar la lista se piden los datos de nuevo: una persona recién dada de alta aparece ya.
  const refreshRef = useRef(onRefresh);
  useEffect(() => {
    refreshRef.current();
  }, []);
  const staff = ctx.staff.filter((s) => s.id !== exclude);
  return (
    <section aria-labelledby="kwho">
      {back ? <BackButton onClick={onBack} /> : null}
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <h1 id="kwho" className="text-4xl font-extrabold">
          {title}
        </h1>
        <span className="min-h-6 text-lg text-ink-muted" role="status">
          {refreshing ? 'Actualizando la lista…' : ''}
        </span>
      </div>
      {staff.length === 0 ? (
        <Callout tone="warn" title="No hay personal dado de alta">
          Pide al encargado que añada al personal en Ajustes → Personal.
        </Callout>
      ) : (
        <ul className="grid grid-cols-2 gap-3 md:grid-cols-3">
          {staff.map((s) => (
            <li key={s.id}>
              <button
                type="button"
                onClick={() => onPick(s)}
                className="flex h-full min-h-28 w-full flex-col items-center justify-center gap-2 rounded-3xl border-2 border-line bg-surface p-4 shadow-card transition-transform active:scale-[0.97]"
              >
                <span className="grid size-14 place-items-center rounded-full bg-brand-soft font-display text-2xl font-extrabold text-brand-strong dark:text-brand" aria-hidden="true">
                  {s.name.trim().charAt(0).toUpperCase()}
                </span>
                <span className="text-xl font-bold [overflow-wrap:anywhere]">{s.name}</span>
                {s.hasPin ? (
                  <span className="inline-flex items-center gap-1 text-sm text-ink-muted">
                    <Icon name="lock" size={14} /> con PIN
                  </span>
                ) : (
                  <span className="text-sm text-ink-muted">sin PIN</span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-5">
        <button
          type="button"
          onClick={() => setHelp((v) => !v)}
          aria-expanded={help}
          className="inline-flex min-h-14 items-center gap-2 rounded-2xl border-2 border-line-strong bg-surface px-5 text-lg font-bold hover:border-ink"
        >
          <Icon name="info" size={22} /> No estoy en la lista
        </button>
        {help ? (
          <div className="mt-3 rounded-3xl border-2 border-warn-solid/60 bg-warn-soft p-5 text-lg" data-testid="kiosk-not-listed">
            <p className="font-bold">No registres con el nombre de otra persona.</p>
            <ol className="mt-2 list-decimal space-y-1 pl-6">
              <li>Pide a tu encargado que te dé de alta en la web: Ajustes → Personal → Añadir persona (con tu PIN).</li>
              <li>En cuanto lo haga, toca «Actualizar la lista» y aparecerás aquí.</li>
              <li>Mientras tanto, apunta la temperatura o la tarea en papel y regístrala después.</li>
            </ol>
            <Button size="lg" className="mt-4" icon="refresh" loading={refreshing} onClick={onRefresh}>
              Actualizar la lista
            </Button>
          </div>
        ) : null}
      </div>
    </section>
  );
}

function PinScreen({
  person,
  error,
  busy,
  onDone,
  onBack,
  title,
  subtitle = 'Escribe tu PIN',
  submitLabel = 'Entrar',
}: {
  person: Person;
  error?: string;
  busy: boolean;
  onDone: (pin: string) => void;
  onBack: () => void;
  title?: string;
  subtitle?: string;
  submitLabel?: string;
}) {
  const [pin, setPin] = useState('');
  const [limit, setLimit] = useState(false);
  return (
    <section aria-labelledby="kpin" className="mx-auto max-w-md">
      <BackButton onClick={onBack} label="Cancelar" />
      <h1 id="kpin" className="text-center text-3xl font-extrabold">
        {title ?? `Hola, ${person.name}`}
      </h1>
      <p className="mt-1 text-center text-xl text-ink-muted">{subtitle}</p>
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
      {limit ? (
        <p role="status" className="mb-3 text-center text-lg font-bold text-warn">
          El PIN tiene como máximo 6 cifras.
        </p>
      ) : null}
      <Keypad
        value={pin}
        onChange={(v) => {
          setLimit(false);
          setPin(v);
        }}
        onLimit={() => setLimit(true)}
        mode="pin"
        maxLength={6}
      />
      <Button size="xl" block className="mt-4" disabled={pin.length < 4} loading={busy} onClick={() => onDone(pin)} icon="check">
        {submitLabel}
      </Button>
    </section>
  );
}

function PickEquipment({ ctx, today, onPick, onBack }: { ctx: KioskContext; today?: TodayTasks; onPick: (id: string) => void; onBack: () => void }) {
  const list = ctx.equipment.filter((e) => e.type !== 'freidora');
  const tz = ctx.organization.timezone;
  return (
    <section aria-labelledby="kpick">
      <BackButton onClick={onBack} />
      <h1 id="kpick" className="mb-5 text-3xl font-extrabold">
        ¿Qué equipo?
      </h1>
      <ul className="grid gap-3 sm:grid-cols-2">
        {list.map((e) => {
          const t = today?.temperatures.find((x) => x.equipmentId === e.id);
          const state = !t ? null : t.remeasure ? 'Volver a medir' : t.status === 'done' ? (t.withAlert ? 'Hecho con alerta' : 'Hecho') : `${t.done} de ${t.required}`;
          return (
            <li key={e.id}>
              <button type="button" onClick={() => onPick(e.id)} className="flex min-h-24 w-full items-center gap-4 rounded-3xl border-2 border-line bg-surface p-4 text-left shadow-card active:scale-[0.98]">
                <Icon name="thermometer" size={32} className="shrink-0 text-brand" />
                <span className="min-w-0 flex-1">
                  <span className="block text-xl font-bold [overflow-wrap:anywhere]">{e.name}</span>
                  <span className="block text-ink-muted">
                    {formatRange(e.minTemp, e.maxTemp)}
                    {t?.lastReading ? ` · última ${formatTemp(t.lastReading.value)} (${formatTime(t.lastReading.at, tz)})` : ''}
                  </span>
                </span>
                {state ? (
                  <span
                    className={cn(
                      'shrink-0 rounded-full px-3 py-1 text-sm font-bold',
                      t?.remeasure || t?.withAlert ? 'bg-bad-soft text-bad' : t?.status === 'done' ? 'bg-ok-soft text-ok' : 'bg-warn-soft text-warn',
                    )}
                  >
                    {state}
                  </span>
                ) : null}
              </button>
            </li>
          );
        })}
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
  heading,
  submitLabel,
  backLabel,
}: {
  ctx: KioskContext;
  equipmentId: string;
  saving: boolean;
  serverError: unknown;
  disabled: boolean;
  onSubmit: (data: { equipmentId: string; value: number; correctiveAction: string | null }) => void;
  onBack: () => void;
  /** Título encima del equipo (p. ej. «Escribe el valor correcto» al corregir). */
  heading?: string;
  submitLabel?: string;
  backLabel?: string;
}) {
  const [eqId, setEqId] = useState(equipmentId);
  const [value, setValue] = useState('');
  const [step, setStep] = useState<'value' | 'action'>('value');
  // 1.12: varias acciones rápidas a la vez, más texto libre.
  const [actions, setActions] = useState<string[]>([]);
  const [other, setOther] = useState('');
  const eq = ctx.equipment.find((e) => e.id === eqId);
  if (!eq) return <PickEquipment ctx={ctx} onBack={onBack} onPick={setEqId} />;
  const num = keypadToNumber(value);
  // Rango físico admitido (−60…300 °C): fuera de él no se evalúa «dentro/fuera de rango» y no se puede guardar.
  const valid = physicallyValidTemp(num);
  const invalid = num != null && !valid;
  const out = valid && isOutOfRange(num!, eq.minTemp, eq.maxTemp);
  const err = serverError ? errorMessage(serverError) : null;
  const retryable = isApiError(serverError) && serverError.retryable;
  const action = [...actions, other.trim()].filter(Boolean).join('; ');
  const toggle = (a: string) => setActions((l) => (l.includes(a) ? l.filter((x) => x !== a) : [...l, a]));

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
        <h1 id="kact" className="mt-6 mb-1 text-3xl font-extrabold">
          ¿Qué has hecho?
        </h1>
        <p className="mb-3 text-lg text-ink-muted">Puedes marcar varias.</p>
        <div className="grid gap-3 sm:grid-cols-2">
          {TEMP_ACTIONS.map((a) => (
            <button
              key={a}
              type="button"
              aria-pressed={actions.includes(a)}
              onClick={() => toggle(a)}
              className={cn('flex min-h-18 items-center gap-3 rounded-2xl border-2 px-5 text-left text-lg font-bold', actions.includes(a) ? 'border-ink bg-ink text-paper' : 'border-line-strong bg-surface')}
            >
              {actions.includes(a) ? <Icon name="check" size={24} strokeWidth={3} /> : null}
              {a}
            </button>
          ))}
        </div>
        <label className="mt-4 block text-lg font-semibold" htmlFor="kother">
          Otra cosa (opcional)
        </label>
        <input
          id="kother"
          value={other}
          onChange={(e) => setOther(e.target.value)}
          maxLength={800}
          className="mt-1 min-h-16 w-full rounded-2xl border-2 border-line-strong bg-surface px-4 text-lg"
        />
        {err ? (
          <Callout tone="bad" className="mt-4" live="assertive" action={retryable ? <Button variant="secondary" icon="refresh" loading={saving} onClick={() => num != null && onSubmit({ equipmentId: eq.id, value: num, correctiveAction: action })}>Reintentar</Button> : undefined}>
            {err}
          </Callout>
        ) : null}
        <Button
          size="xl"
          block
          variant="danger"
          className="mt-5"
          disabled={!action || disabled}
          loading={saving}
          icon="check"
          onClick={() => num != null && onSubmit({ equipmentId: eq.id, value: num, correctiveAction: action })}
        >
          {submitLabel ? `${submitLabel} con esta acción` : 'Guardar con esta acción'}
        </Button>
      </section>
    );
  }

  return (
    <section aria-labelledby="ktemp" className="mx-auto grid max-w-4xl gap-6 md:grid-cols-2">
      <div>
        <BackButton onClick={onBack} label={backLabel} />
        {heading ? <p className="text-xl font-bold text-brand-strong dark:text-brand">{heading}</p> : null}
        <p className="text-lg font-semibold text-ink-muted">{EQUIPMENT_TYPE_LABELS[eq.type]}</p>
        <h1 id="ktemp" className="text-4xl font-extrabold [overflow-wrap:anywhere]">
          {eq.name}
        </h1>
        <p className="mt-1 text-xl text-ink-muted">Correcto: {formatRange(eq.minTemp, eq.maxTemp)}</p>
        <output
          aria-live="polite"
          aria-label="Temperatura escrita"
          className={cn(
            'mt-6 flex min-h-28 items-center justify-end rounded-3xl border-4 px-6 font-display text-6xl font-extrabold tabular transition-colors',
            num == null ? 'border-line bg-surface' : invalid ? 'border-warn-solid bg-warn-soft text-warn' : out ? 'border-bad-solid bg-bad-soft text-bad' : 'border-ok-solid bg-ok-soft text-ok',
          )}
        >
          {value ? `${keypadDisplay(value)} °C` : <span className="text-ink-muted/50">— °C</span>}
        </output>
        <p className="mt-3 min-h-8 text-xl font-bold" aria-live="polite">
          {num == null ? '' : invalid ? (
            <span className="text-warn" role="alert">
              <Icon name="alert" className="mr-1 inline" /> {TEMP_RANGE_MESSAGE}
            </span>
          ) : out ? (
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
          <Callout
            tone="bad"
            className="mt-2"
            live="assertive"
            action={retryable && num != null && !out ? <Button variant="secondary" icon="refresh" loading={saving} onClick={() => onSubmit({ equipmentId: eq.id, value: num, correctiveAction: null })}>Reintentar</Button> : undefined}
          >
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
          disabled={num == null || invalid || disabled}
          loading={saving}
          icon={out ? 'arrowRight' : 'check'}
          onClick={() => {
            if (num == null || invalid) return;
            if (out) setStep('action');
            else onSubmit({ equipmentId: eq.id, value: num, correctiveAction: null });
          }}
        >
          {out ? 'Siguiente' : (submitLabel ?? 'Guardar')}
        </Button>
      </div>
    </section>
  );
}

/**
 * Resultado: «Guardado por Ana» un instante y vuelta sola a la lista de equipos (o al inicio), con la
 * persona elegida y la franja «Registrando como Ana · Cambiar de persona». «Corregir» durante 2 minutos.
 */
function ResultScreen({
  record,
  person,
  corrected,
  tz,
  canCorrect,
  onContinue,
  onSomeoneElse,
  onCorrect,
}: {
  record: AppRecord;
  person: Person;
  corrected?: boolean;
  tz: string;
  canCorrect: boolean;
  onContinue: () => void;
  onSomeoneElse: () => void;
  onCorrect: () => void;
}) {
  const s = recordSummary(record);
  const [until] = useState(() => Date.now() + (record.alert || corrected ? RESULT_ALERT_MS : RESULT_MS));
  const left = useSecondsLeft(until);
  const done = useRef(onContinue);
  useEffect(() => {
    done.current = onContinue;
  });
  useEffect(() => {
    if (left <= 0) done.current();
  }, [left]);
  const partial = record.type === 'limpieza' && !record.data.completed;
  return (
    <section role="status" className="mx-auto max-w-xl py-6 text-center" data-testid="kiosk-result">
      <span className={cn('mx-auto grid size-28 animate-pop place-items-center rounded-[2.5rem] text-white shadow-pop', record.alert ? 'bg-bad-solid' : 'bg-ok-solid')}>
        <Icon name={record.alert ? 'alert' : 'check'} size={64} strokeWidth={3} />
      </span>
      <h1 className="mt-5 text-5xl font-extrabold">
        {corrected
          ? 'Corrección guardada'
          : record.alert
            ? 'Guardado con alerta'
            : partial
              ? 'Guardado como parcial'
              : record.type === 'enfriamiento' && record.data.phase === 'inicio'
                ? 'Enfriamiento empezado'
                : 'Hecho'}
      </h1>
      <p className="mt-3 text-2xl font-semibold [overflow-wrap:anywhere]">{s.title}</p>
      <p className="text-xl text-ink-muted">
        {s.detail} · {formatTime(record.effectiveAt, tz)}
      </p>
      <p className="mt-3 text-2xl" data-testid="kiosk-saved-by">
        {corrected ? 'Firma: ' : 'Guardado por '}
        <strong>{corrected ? signer(record) : person.name}</strong>
      </p>
      {corrected ? (
        <p className="mt-1 text-lg text-ink-muted">El registro original se conserva enlazado. Motivo: {record.amendmentReason}</p>
      ) : null}
      {!corrected && record.type === 'enfriamiento' && record.data.phase === 'inicio' ? (
        <p className="mt-2 text-xl font-semibold">Queda «en curso» en la pantalla de inicio: termínalo allí cuando lo saques del abatidor.</p>
      ) : null}
      <div className="mt-7 grid gap-3">
        <Button size="xl" icon={record.type === 'temperatura' && !corrected ? 'thermometer' : 'home'} onClick={onContinue}>
          {record.type === 'temperatura' && !corrected ? 'Siguiente equipo' : 'Seguir'}
        </Button>
        {canCorrect ? (
          <Button size="xl" variant="secondary" icon="pencil" onClick={onCorrect}>
            Corregir este registro
          </Button>
        ) : null}
        {!corrected ? (
          <Button size="xl" variant="secondary" onClick={onSomeoneElse}>
            Cambiar de persona
          </Button>
        ) : null}
      </div>
    </section>
  );
}

type CorrStep =
  | { name: 'verify'; error?: string; attempt?: number }
  | { name: 'reason' }
  | { name: 'other' }
  | { name: 'value' }
  | { name: 'person' }
  | { name: 'newpin'; error?: string; attempt?: number }
  | { name: 'pin'; error?: string; attempt?: number };

/**
 * Corrección desde la tablet (1.5): crea una CORRECCIÓN del registro recién hecho, nunca lo borra.
 * Motivo de un toque; la misma persona confirma con su PIN (si lo tiene) y, si cambia la persona,
 * la persona correcta con el suyo. El servidor comprueba plazo, dispositivo, persona y local.
 */
function CorrectionFlow({
  token,
  ctx,
  formCtx,
  recent,
  secondsLeft,
  onCancel,
  onDone,
  onRevoked,
}: {
  token: string;
  ctx: KioskContext;
  formCtx: FormContext;
  recent: Recent;
  secondsLeft: number;
  onCancel: () => void;
  onDone: (amended: AppRecord, signerPerson: Person) => void;
  onRevoked: () => void;
}) {
  const { record, person } = recent;
  // N4: «Corregir» pide SIEMPRE el PIN de quien registró (si lo tiene) ANTES de abrir el formulario, y
  // el servidor lo comprueba: nadie corrige un registro ajeno porque la tablet siguiera abierta.
  const [step, setStep] = useState<CorrStep>(person.hasPin ? { name: 'verify' } : { name: 'reason' });
  const [verifiedPin, setVerifiedPin] = useState<string | undefined>(undefined);
  const [reason, setReason] = useState<KioskCorrectionReason | null>(null);
  const [reasonText, setReasonText] = useState('');
  const [data, setData] = useState<unknown>(undefined);
  const [newPerson, setNewPerson] = useState<Person | null>(null);
  const [newPin, setNewPin] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [keys] = useState(() => new IdempotencyKeys());
  const s = recordSummary(record);

  const send = async (pin: string | undefined, np = newPin, d = data) => {
    if (!reason) return;
    setBusy(true);
    setError(null);
    const base = {
      staffId: person.id,
      reason,
      ...(reasonText.trim() ? { reasonText: reasonText.trim() } : {}),
      ...(d !== undefined ? { data: d } : {}),
      ...(reason === 'wrong_person' && newPerson ? { newStaffId: newPerson.id } : {}),
    };
    try {
      // El PIN no forma parte de la clave de idempotencia (un reintento con el PIN corregido es la misma corrección).
      const amended = await kioskApi.amend(token, record.id, { ...base, ...(pin ? { pin } : {}), ...(np && reason === 'wrong_person' ? { newStaffPin: np } : {}) }, keys.keyFor(base));
      keys.reset();
      onDone(amended, reason === 'wrong_person' && newPerson ? newPerson : person);
    } catch (err) {
      if (isApiError(err)) {
        if (err.code === 'UNAUTHENTICATED') return onRevoked();
        if (err.code === 'INVALID_PIN' || err.code === 'PIN_REQUIRED') {
          // El servidor indica si el PIN que falla es el de la persona correcta (`newStaffPin`).
          const forNew = err.details.some((x) => x.path === 'newStaffPin');
          const msg = err.code === 'INVALID_PIN' ? 'PIN incorrecto. Prueba otra vez.' : err.message;
          if (forNew) setStep((st) => ({ name: 'newpin', error: msg, attempt: (st.name === 'newpin' ? (st.attempt ?? 0) : 0) + 1 }));
          else setStep((st) => ({ name: 'pin', error: msg, attempt: (st.name === 'pin' ? (st.attempt ?? 0) : 0) + 1 }));
          return;
        }
        if (err.code === 'PIN_LOCKED' || err.code === 'CORRECTION_NOT_ALLOWED' || err.code === 'CONFLICT') setStep({ name: 'reason' });
      }
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  /** Tras elegir los datos o la persona: se envía con el PIN ya comprobado al empezar. */
  const confirm = (np?: string, d?: unknown) => {
    if (person.hasPin && !verifiedPin) setStep({ name: 'pin' });
    else void send(verifiedPin, np, d);
  };

  const verifyFirst = async (pin: string) => {
    setBusy(true);
    try {
      await kioskApi.verifyPin(token, { staffId: person.id, pin });
      setVerifiedPin(pin);
      setStep({ name: 'reason' });
    } catch (err) {
      if (isApiError(err) && err.code === 'UNAUTHENTICATED') return onRevoked();
      const msg = isApiError(err) && err.code === 'INVALID_PIN' ? 'PIN incorrecto. Prueba otra vez.' : errorMessage(err);
      setStep((st) => ({ name: 'verify', error: msg, attempt: (st.name === 'verify' ? (st.attempt ?? 0) : 0) + 1 }));
    } finally {
      setBusy(false);
    }
  };

  const header = (
    <div className="mb-5 rounded-3xl border-2 border-line-strong bg-surface p-4">
      <p className="text-lg text-ink-muted">Corregir el registro de {person.name}</p>
      <p className="text-2xl font-extrabold [overflow-wrap:anywhere]">{s.title}</p>
      <p className="text-lg text-ink-muted">
        {s.detail} · queda {mmss(secondsLeft)} para corregirlo
      </p>
    </div>
  );
  const errorBox = error ? (
    <Callout tone="bad" className="mb-4 text-lg" live="assertive" title="No se ha podido corregir">
      {errorMessage(error)}
    </Callout>
  ) : null;

  if (step.name === 'verify') {
    return (
      <PinScreen
        key={`verify-${step.attempt ?? 0}`}
        person={person}
        error={step.error}
        busy={busy}
        title={`¿Eres ${person.name}?`}
        subtitle="Para corregir este registro, escribe tu PIN"
        submitLabel="Corregir"
        onBack={onCancel}
        onDone={(pin) => void verifyFirst(pin)}
      />
    );
  }
  if (step.name === 'pin') {
    return (
      <PinScreen
        key={`pin-${step.attempt ?? 0}`}
        person={person}
        error={step.error}
        busy={busy}
        title={`Confirma, ${person.name}`}
        subtitle="Escribe tu PIN para guardar la corrección"
        submitLabel="Guardar corrección"
        onBack={onCancel}
        onDone={(pin) => {
          setVerifiedPin(pin);
          void send(pin);
        }}
      />
    );
  }
  if (step.name === 'newpin' && newPerson) {
    return (
      <PinScreen
        key={`newpin-${step.attempt ?? 0}`}
        person={newPerson}
        error={step.error}
        busy={busy}
        title={`Hola, ${newPerson.name}`}
        subtitle="Escribe tu PIN: el registro pasará a tu nombre"
        submitLabel={person.hasPin && !verifiedPin ? 'Siguiente' : 'Guardar corrección'}
        onBack={() => setStep({ name: 'person' })}
        onDone={(pin) => {
          setNewPin(pin);
          confirm(pin);
        }}
      />
    );
  }
  if (step.name === 'person') {
    return (
      <div>
        {header}
        {errorBox}
        <WhoScreen
          ctx={ctx}
          exclude={person.id}
          refreshing={false}
          onRefresh={() => undefined}
          title="¿Quién lo hizo de verdad?"
          onBack={() => setStep({ name: 'reason' })}
          onPick={(st) => {
            const np: Person = { id: st.id, name: st.name, hasPin: st.hasPin };
            setNewPerson(np);
            if (st.hasPin) setStep({ name: 'newpin' });
            else confirm();
          }}
        />
      </div>
    );
  }
  if (step.name === 'value') {
    return (
      <div>
        {header}
        {errorBox}
        {record.type === 'temperatura' ? (
          <TempScreen
            ctx={ctx}
            equipmentId={record.data.equipmentId}
            saving={busy}
            serverError={null}
            disabled={false}
            heading="Escribe el valor correcto"
            submitLabel={person.hasPin && !verifiedPin ? 'Siguiente' : 'Guardar corrección'}
            backLabel="Atrás"
            onBack={() => setStep({ name: 'reason' })}
            onSubmit={(d) => {
              setData(d);
              confirm(undefined, d);
            }}
          />
        ) : (
          <section aria-labelledby="kcorr-form">
            <BackButton onClick={() => setStep({ name: 'reason' })} label="Atrás" />
            <h1 id="kcorr-form" className="mb-4 text-3xl font-extrabold">
              Escribe los datos correctos
            </h1>
            <div className="rounded-3xl border border-line bg-surface p-4 sm:p-6">
              <RecordForm
                type={record.type}
                ctx={formCtx}
                initial={record.data as never}
                large
                submitLabel={person.hasPin && !verifiedPin ? 'Siguiente' : 'Guardar corrección'}
                submitting={busy}
                onSubmit={(d) => {
                  setData(d);
                  confirm(undefined, d);
                }}
              />
            </div>
          </section>
        )}
      </div>
    );
  }
  if (step.name === 'other') {
    return (
      <section aria-labelledby="kcorr-other" className="mx-auto max-w-3xl">
        {header}
        <BackButton onClick={() => setStep({ name: 'reason' })} label="Atrás" />
        <h1 id="kcorr-other" className="mb-3 text-3xl font-extrabold">
          ¿Qué ha pasado?
        </h1>
        <label htmlFor="kcorr-text" className="text-lg font-semibold">
          Motivo de la corrección
        </label>
        <input
          id="kcorr-text"
          value={reasonText}
          onChange={(e) => setReasonText(e.target.value)}
          maxLength={500}
          className="mt-1 min-h-16 w-full rounded-2xl border-2 border-line-strong bg-surface px-4 text-lg"
        />
        <Button size="xl" block className="mt-5" icon="arrowRight" disabled={!reasonText.trim()} onClick={() => setStep({ name: 'value' })}>
          Siguiente: datos correctos
        </Button>
      </section>
    );
  }

  // Paso 1: motivo de un toque.
  return (
    <section aria-labelledby="kcorr" className="mx-auto max-w-3xl">
      <BackButton onClick={onCancel} label="Cancelar" />
      {header}
      {errorBox}
      <h1 id="kcorr" className="mb-3 text-3xl font-extrabold">
        ¿Qué quieres corregir?
      </h1>
      <p className="mb-4 text-lg text-ink-muted">El registro original no se borra: se guarda una corrección con el motivo y la hora.</p>
      <div className="grid gap-3">
        {(['wrong_value', 'wrong_person', 'other'] as const).map((r) => (
          <button
            key={r}
            type="button"
            onClick={() => {
              setReason(r);
              setError(null);
              setStep(r === 'wrong_value' ? { name: 'value' } : r === 'wrong_person' ? { name: 'person' } : { name: 'other' });
            }}
            className="flex min-h-20 items-center gap-4 rounded-3xl border-2 border-line-strong bg-surface px-5 text-left text-xl font-bold hover:border-ink"
          >
            <Icon name={r === 'wrong_value' ? 'thermometer' : r === 'wrong_person' ? 'users' : 'pencil'} size={30} className="shrink-0" />
            {KIOSK_CORRECTION_REASON_LABELS[r]}
          </button>
        ))}
      </div>
    </section>
  );
}

/**
 * Salir del modo cocina o desvincular la tablet (1.10): email y contraseña de un propietario o
 * encargado del local, comprobados en el servidor (con límite de intentos).
 */
function ManagerAuthScreen({
  token,
  action,
  staff,
  onCancel,
  onDone,
  onRevoked,
}: {
  token: string;
  action: 'exit' | 'unpair' | 'unlock';
  staff?: { id: string; name: string };
  onCancel: () => void;
  onDone: (by: string) => void;
  onRevoked: () => void;
}) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password) return setError('Escribe el email y la contraseña de un propietario o encargado del local.');
    setBusy(true);
    setError(null);
    try {
      const body = { email: email.trim(), password };
      const r =
        action === 'exit'
          ? await kioskApi.exit(token, body)
          : action === 'unlock' && staff
            ? await kioskApi.unlockStaff(token, staff.id, body)
            : await kioskApi.unpair(token, body);
      onDone(r.by.name);
    } catch (err) {
      if (isApiError(err) && err.code === 'UNAUTHENTICATED') return onRevoked();
      setPassword('');
      setError(
        isApiError(err) && err.code === 'RATE_LIMITED'
          ? `Demasiados intentos en esta tablet.${err.retryAfter ? ` Espera ${formatWait(err.retryAfter)}.` : ' Espera unos minutos.'}`
          : errorMessage(err),
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <section aria-labelledby="kmgr" className="mx-auto max-w-xl">
      <BackButton onClick={onCancel} label="Cancelar" />
      <h1 id="kmgr" className="text-3xl font-extrabold">
        {action === 'exit' ? 'Salir del modo cocina' : action === 'unlock' ? `Desbloquear el PIN de ${staff?.name ?? ''}` : 'Desvincular esta tablet'}
      </h1>
      <p className="mt-2 text-lg text-ink-muted">
        {action === 'exit'
          ? 'Solo un propietario o encargado del local puede cerrar el modo cocina. La tablet seguirá vinculada.'
          : action === 'unlock'
            ? 'Un propietario o encargado del local puede desbloquearlo ahora mismo. Quedará registrado quién lo hizo.'
            : 'Solo un propietario o encargado del local puede desvincularla. Dejará de funcionar hasta que se vuelva a vincular desde Ajustes → Dispositivos de cocina.'}
      </p>
      <form onSubmit={onSubmit} noValidate className="mt-5 space-y-4 text-lg">
        <Field label="Email del propietario o encargado">
          <Input type="email" autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} className="min-h-14 text-lg" maxLength={254} />
        </Field>
        <Field label="Contraseña">
          <Input type="password" autoComplete="off" value={password} onChange={(e) => setPassword(e.target.value)} className="min-h-14 text-lg" maxLength={128} />
        </Field>
        {error ? (
          <Callout tone="bad" live="assertive">
            {error}
          </Callout>
        ) : null}
        <Button type="submit" size="xl" block loading={busy} variant={action === 'unpair' ? 'danger' : 'primary'} icon="lock">
          {action === 'exit' ? 'Salir del modo cocina' : action === 'unlock' ? 'Desbloquear' : 'Desvincular'}
        </Button>
      </form>
    </section>
  );
}
