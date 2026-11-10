import { useEffect, useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { emailBody, loginBody, registerBody } from '@shared/schemas';
import { api, ApiError, errorMessage, isApiError } from '@/api/client';
import { keys, useAccount } from '@/api/queries';
import type { InvitationPreview } from '@/api/types';
import { AuthLayout } from '@/layouts/AuthLayout';
import { Button, LinkButton } from '@/components/ui/Button';
import { Callout, Spinner } from '@/components/ui/Feedback';
import { Field, Input, PasswordInput, detailsToFieldErrors, zodToFieldErrors } from '@/components/ui/Form';
import { PasswordMeter } from '@/features/PasswordMeter';
import { Icon } from '@/components/icons/Icon';
import { takeHashToken } from '@/lib/hashToken';
import { safeNext } from '@/lib/redirect';
import { storage } from '@/lib/storage';
import { passwordProblem } from '@/lib/password';
import { LIMITS } from '@shared/schemas';
import { APP_NAME } from '@/config/brand';

/** Token de invitación pendiente, solo en memoria (no se persiste en ningún almacenamiento). */
let pendingInvitationToken: string | null = null;

/** Un token de un solo uso se envía una sola vez aunque React monte el efecto dos veces. */
const oneShot = new Map<string, Promise<unknown>>();
function postOnce<T>(url: string, token: string): Promise<T> {
  const key = `${url}|${token}`;
  if (!oneShot.has(key)) oneShot.set(key, api.post<T>(url, { token }));
  return oneShot.get(key) as Promise<T>;
}

const linkClass = 'font-semibold text-brand-strong underline underline-offset-4 hover:no-underline dark:text-brand';

// ---------------------------------------------------------------------------
export function LoginPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const location = useLocation();
  const prefill = (location.state as { email?: string } | null)?.email ?? '';
  const [email, setEmail] = useState(prefill);
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(false);
  const next = safeNext(params.get('next'));

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const parsed = loginBody.safeParse({ email, password });
    if (!parsed.success) {
      setErrors(zodToFieldErrors(parsed.error.issues));
      return;
    }
    setErrors({});
    setLoading(true);
    try {
      await api.post('/api/auth/login', parsed.data, { silentAuth: true });
      storage.setSessionHint(true);
      await qc.invalidateQueries({ queryKey: keys.account });
      navigate(next, { replace: true });
    } catch (err) {
      setError(isApiError(err) ? err : new ApiError(0, 'INTERNAL_ERROR', errorMessage(err)));
      setLoading(false);
    }
  };

  return (
    <AuthLayout title="Entrar" subtitle="Accede a los registros de tu local." docTitle="Entrar">
      {params.get('caducada') ? (
        <Callout tone="warn" className="mb-5" title="Tu sesión ha caducado">
          Vuelve a entrar para seguir donde lo dejaste.
        </Callout>
      ) : null}
      {params.get('emailActualizado') ? <Callout tone="ok" className="mb-5" title={EMAIL_UPDATED_MESSAGE} live="polite" /> : null}
      {params.get('salida') ? <Callout tone="ok" className="mb-5" title="Has cerrado sesión" live="polite" /> : null}
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        <Field label="Email" error={errors.email}>
          <Input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </Field>
        <Field label="Contraseña" error={errors.password}>
          <PasswordInput autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </Field>
        <div className="flex justify-end">
          <Link to="/recuperar-contrasena" className={linkClass}>
            ¿Has olvidado la contraseña?
          </Link>
        </div>
        {error ? (
          error.code === 'EMAIL_NOT_VERIFIED' ? (
            <Callout tone="warn" live="assertive" title="Confirma tu email para entrar">
              Te hemos vuelto a enviar el enlace de confirmación. Revisa tu bandeja de entrada (y la carpeta de spam).
            </Callout>
          ) : (
            <Callout tone="bad" live="assertive">
              {errorMessage(error)}
            </Callout>
          )
        ) : null}
        <Button type="submit" size="lg" block loading={loading}>
          Entrar
        </Button>
      </form>
      <p className="mt-8 text-center text-ink-muted">
        ¿Aún no tienes cuenta?{' '}
        <Link to="/registro" className={linkClass}>
          Pruébalo 14 días gratis
        </Link>
      </p>
    </AuthLayout>
  );
}

// ---------------------------------------------------------------------------
export function RegisterPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const invitedEmail = (location.state as { email?: string } | null)?.email ?? '';
  const [name, setName] = useState('');
  const [email, setEmail] = useState(invitedEmail);
  const [password, setPassword] = useState('');
  const [accept, setAccept] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const parsed = registerBody.safeParse({ email, password, name });
    const errs = parsed.success ? {} : zodToFieldErrors(parsed.error.issues);
    const problem = passwordProblem(password, email, name);
    if (!errs.password && problem) errs.password = problem;
    if (!accept) errs.accept = 'Debes aceptar los términos y la política de privacidad';
    setErrors(errs);
    if (Object.keys(errs).length > 0 || !parsed.success) return;
    setLoading(true);
    try {
      await api.post('/api/auth/register', parsed.data);
      navigate('/revisa-tu-correo', { state: { email: parsed.data.email } });
    } catch (err) {
      if (isApiError(err) && err.details.length) setErrors(detailsToFieldErrors(err.details));
      else setError(errorMessage(err));
      setLoading(false);
    }
  };

  return (
    <AuthLayout title="Crea tu cuenta" subtitle="14 días gratis, sin tarjeta. Configuras tu local en 5 minutos." docTitle="Crear cuenta">
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        <Field label="Tu nombre" error={errors.name}>
          <Input autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} maxLength={LIMITS.userName} />
        </Field>
        <Field label="Email" error={errors.email}>
          <Input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={254} />
        </Field>
        <Field label="Contraseña" error={errors.password}>
          <PasswordInput autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} maxLength={128} />
        </Field>
        <PasswordMeter password={password} email={email} name={name} />
        <div>
          <label className="flex cursor-pointer items-start gap-3 py-2">
            <input
              type="checkbox"
              checked={accept}
              onChange={(e) => setAccept(e.target.checked)}
              className="mt-0.5 size-6 shrink-0 accent-[var(--brand)]"
              aria-invalid={!!errors.accept || undefined}
              aria-describedby={errors.accept ? 'accept-err' : undefined}
            />
            <span>
              Acepto los{' '}
              <Link to="/terminos" className={linkClass} target="_blank">
                términos
              </Link>{' '}
              y la{' '}
              <Link to="/privacidad" className={linkClass} target="_blank">
                política de privacidad
              </Link>
              .
            </span>
          </label>
          {errors.accept ? (
            <p id="accept-err" role="alert" className="text-sm font-semibold text-bad">
              {errors.accept}
            </p>
          ) : null}
        </div>
        {error ? <Callout tone="bad" live="assertive">{error}</Callout> : null}
        <Button type="submit" size="lg" block loading={loading}>
          Crear cuenta gratis
        </Button>
      </form>
      <p className="mt-8 text-center text-ink-muted">
        ¿Ya tienes cuenta?{' '}
        <Link to="/entrar" className={linkClass}>
          Entra
        </Link>
      </p>
    </AuthLayout>
  );
}

// ---------------------------------------------------------------------------
export function CheckEmailPage() {
  const location = useLocation();
  const email = (location.state as { email?: string } | null)?.email ?? '';
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [msg, setMsg] = useState('');
  const resend = async () => {
    setState('sending');
    try {
      const r = await api.post<{ message: string }>('/api/auth/resend-verification', { email });
      setMsg(r.message);
      setState('sent');
    } catch (err) {
      setMsg(errorMessage(err));
      setState('error');
    }
  };
  return (
    <AuthLayout title="Revisa tu correo" docTitle="Revisa tu correo">
      <div className="rounded-3xl border border-line bg-surface p-6 text-center shadow-card">
        <span className="mx-auto mb-4 grid size-16 place-items-center rounded-2xl bg-brand-soft text-brand-strong dark:text-brand">
          <Icon name="mail" size={32} />
        </span>
        <p className="text-lg">
          Si los datos son correctos, te habrá llegado un email {email ? <strong className="break-all">a {email}</strong> : null} con un enlace para
          confirmar tu cuenta. Caduca en 24 horas.
        </p>
        <p className="mt-3 text-ink-muted">¿No lo ves? Mira en la carpeta de spam o promociones.</p>
      </div>
      {email && emailBody.safeParse({ email }).success ? (
        <div className="mt-5">
          <Button variant="secondary" block onClick={() => void resend()} loading={state === 'sending'} disabled={state === 'sent'}>
            Reenviar el email
          </Button>
          {state === 'sent' || state === 'error' ? (
            <Callout tone={state === 'sent' ? 'ok' : 'bad'} className="mt-3" live="polite">
              {msg}
            </Callout>
          ) : null}
        </div>
      ) : null}
      <p className="mt-6 text-center">
        <Link to="/entrar" className={linkClass}>
          Ir a entrar
        </Link>
      </p>
    </AuthLayout>
  );
}

// ---------------------------------------------------------------------------
function useHashTokenOnce() {
  const [token] = useState<string | null>(() => takeHashToken());
  return token;
}

function TokenActionPage({
  title,
  docTitle,
  url,
  successTitle,
  successText,
  successAction,
  afterSuccess,
}: {
  title: string;
  docTitle: string;
  url: string;
  successTitle: string;
  /** Texto propio del éxito (evita repetir el título con el mensaje del servidor). */
  successText: string;
  successAction: { to: string; label: string };
  /** Se ejecuta tras confirmar; si devuelve una ruta, se navega a ella (p. ej. al login si la sesión ya no vale). */
  afterSuccess?: () => Promise<string | null>;
}) {
  const navigate = useNavigate();
  const token = useHashTokenOnce();
  const [state, setState] = useState<{ status: 'loading' | 'ok' | 'error'; message?: string }>({
    status: token ? 'loading' : 'error',
    message: token ? undefined : 'Este enlace está incompleto. Ábrelo de nuevo desde el email, sin cortarlo.',
  });
  useEffect(() => {
    if (!token) return;
    postOnce<{ message: string }>(url, token)
      .then(
        async () => {
          const redirect = afterSuccess ? await afterSuccess().catch(() => null) : null;
          if (redirect) navigate(redirect, { replace: true });
          else setState({ status: 'ok' });
        },
        (err: unknown) => setState({ status: 'error', message: errorMessage(err) }),
      );
    // afterSuccess es estable por página (definida a nivel de módulo o memoizada).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, url]);
  return (
    <AuthLayout title={title} docTitle={docTitle}>
      {state.status === 'loading' ? (
        <div className="flex items-center gap-3 text-lg" role="status">
          <Spinner /> Comprobando el enlace…
        </div>
      ) : state.status === 'ok' ? (
        <div className="space-y-5">
          <Callout tone="ok" title={successTitle} live="polite">
            {successText}
          </Callout>
          <LinkButton to={successAction.to} size="lg" block>
            {successAction.label}
          </LinkButton>
        </div>
      ) : (
        <div className="space-y-5">
          <Callout tone="bad" title="No hemos podido usar este enlace" live="assertive">
            {state.message}
          </Callout>
          <LinkButton to="/entrar" variant="secondary" block>
            Ir a entrar
          </LinkButton>
        </div>
      )}
    </AuthLayout>
  );
}

export function VerifyEmailPage() {
  return (
    <TokenActionPage
      title="Confirmar email"
      docTitle="Confirmar email"
      url="/api/auth/verify-email"
      successTitle="¡Email confirmado!"
      successText="Ya puedes entrar con tu email y tu contraseña."
      successAction={{ to: '/entrar?next=%2Fapp', label: 'Entrar y configurar mi local' }}
    />
  );
}

export const EMAIL_UPDATED_MESSAGE = 'Email actualizado. Entra con tu nuevo email.';

export function ConfirmEmailChangePage() {
  const qc = useQueryClient();
  // El servidor cierra las demás sesiones (y todas si se confirma sin sesión o con otra cuenta):
  // si la actual ya no vale, se lleva al login con un mensaje claro en vez de dejar un estado roto.
  const afterSuccess = async (): Promise<string | null> => {
    try {
      await api.get('/api/account', { silentAuth: true });
      await qc.invalidateQueries({ queryKey: keys.account });
      return null;
    } catch (err) {
      if (isApiError(err) && err.code === 'UNAUTHENTICATED') {
        storage.setSessionHint(false);
        qc.clear();
        return '/entrar?emailActualizado=1';
      }
      return null;
    }
  };
  return (
    <TokenActionPage
      title="Confirmar nuevo email"
      docTitle="Confirmar nuevo email"
      url="/api/auth/email-change/confirm"
      successTitle="Email actualizado"
      successText="A partir de ahora entrarás con tu nuevo email. Hemos avisado también a la dirección anterior."
      successAction={{ to: '/app', label: 'Ir a mi panel' }}
      afterSuccess={afterSuccess}
    />
  );
}

// ---------------------------------------------------------------------------
export function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const parsed = emailBody.safeParse({ email });
    if (!parsed.success) return setError('Escribe un email válido');
    setError(null);
    setLoading(true);
    try {
      const r = await api.post<{ message: string }>('/api/auth/password-reset/request', parsed.data);
      setDone(r.message);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  };
  return (
    <AuthLayout title="Recuperar contraseña" subtitle="Te enviaremos un enlace para elegir una nueva." docTitle="Recuperar contraseña">
      {done ? (
        <div className="space-y-5">
          <Callout tone="ok" title="Revisa tu correo" live="polite">
            {done} El enlace caduca en 1 hora.
          </Callout>
          <LinkButton to="/entrar" variant="secondary" block>
            Volver a entrar
          </LinkButton>
        </div>
      ) : (
        <form onSubmit={onSubmit} noValidate className="space-y-4">
          <Field label="Email" error={error}>
            <Input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Button type="submit" size="lg" block loading={loading}>
            Enviar enlace
          </Button>
          <p className="text-center">
            <Link to="/entrar" className={linkClass}>
              Volver a entrar
            </Link>
          </p>
        </form>
      )}
    </AuthLayout>
  );
}

export function ResetPasswordPage() {
  const token = useHashTokenOnce();
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [tokenError, setTokenError] = useState<string | null>(token ? null : 'Este enlace está incompleto. Ábrelo de nuevo desde el email, sin cortarlo.');
  const [done, setDone] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const problem = passwordProblem(password);
    if (problem) return setError(problem);
    setError(null);
    setLoading(true);
    try {
      const r = await api.post<{ message: string }>('/api/auth/password-reset/confirm', { token, password });
      setDone(r.message);
    } catch (err) {
      if (isApiError(err) && err.code === 'INVALID_TOKEN') setTokenError(err.message);
      else if (isApiError(err) && err.details.length) setError(err.details[0]!.message);
      else setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  };
  return (
    <AuthLayout title="Nueva contraseña" docTitle="Nueva contraseña">
      {done ? (
        <div className="space-y-5">
          <Callout tone="ok" title="Contraseña cambiada" live="polite">
            Ya puedes entrar con la nueva contraseña. Por seguridad, hemos cerrado todas tus sesiones abiertas.
          </Callout>
          <LinkButton to="/entrar" size="lg" block>
            Entrar
          </LinkButton>
        </div>
      ) : tokenError ? (
        <div className="space-y-5">
          <Callout tone="bad" title="Este enlace ya no sirve" live="assertive">
            {tokenError.replace(/\.?$/, '.')} Pide uno nuevo: los enlaces caducan en 1 hora y solo se pueden usar una vez.
          </Callout>
          <LinkButton to="/recuperar-contrasena" block>
            Pedir otro enlace
          </LinkButton>
        </div>
      ) : (
        <form onSubmit={onSubmit} noValidate className="space-y-4">
          <Field label="Nueva contraseña" error={error}>
            <PasswordInput autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} maxLength={128} />
          </Field>
          <PasswordMeter password={password} />
          <Button type="submit" size="lg" block loading={loading}>
            Guardar contraseña
          </Button>
        </form>
      )}
    </AuthLayout>
  );
}

// ---------------------------------------------------------------------------
export function InvitationPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const hashToken = useHashTokenOnce();
  const [token] = useState<string | null>(() => hashToken ?? pendingInvitationToken);
  const account = useAccount();
  const [preview, setPreview] = useState<InvitationPreview | null>(null);
  const [error, setError] = useState<string | null>(token ? null : 'El enlace de invitación no es válido o está incompleto. Ábrelo de nuevo desde el email.');
  const [accepting, setAccepting] = useState(false);

  useEffect(() => {
    if (!token) return;
    pendingInvitationToken = token;
    api.post<{ invitation: InvitationPreview }>('/api/invitations/preview', { token }).then(
      (r) => setPreview(r.invitation),
      (err: unknown) => {
        pendingInvitationToken = null;
        setError(errorMessage(err));
      },
    );
  }, [token]);

  const accept = async () => {
    if (!token) return;
    setAccepting(true);
    try {
      const r = await api.post<{ organizationId: string }>('/api/invitations/accept', { token });
      pendingInvitationToken = null;
      await qc.invalidateQueries({ queryKey: keys.account });
      navigate(`/locales/${r.organizationId}/hoy`, { replace: true });
    } catch (err) {
      // Token inválido (caducado, revocado, local pendiente de eliminar…): no tiene sentido reintentarlo tras un login.
      if (isApiError(err) && err.code === 'INVALID_TOKEN') pendingInvitationToken = null;
      setError(errorMessage(err));
      setAccepting(false);
    }
  };

  const [switching, setSwitching] = useState(false);
  const switchAccount = async () => {
    if (!preview) return;
    setSwitching(true);
    try {
      await api.post('/api/auth/logout');
    } catch {
      // aunque falle, se limpia el estado local
    }
    storage.setSessionHint(false);
    // El token sigue en memoria (pendingInvitationToken): tras entrar se vuelve a esta página.
    qc.removeQueries();
    navigate('/entrar?next=%2Finvitacion', { replace: true, state: { email: preview.email } });
  };

  const loggedIn = account.isSuccess;
  const sameEmail = loggedIn && preview && account.data.user.email.toLowerCase() === preview.email.toLowerCase();

  return (
    <AuthLayout title="Invitación" docTitle="Invitación">
      {error ? (
        <div className="space-y-5">
          <Callout tone="bad" title="No se puede usar esta invitación" live="assertive">
            {error}
          </Callout>
          <LinkButton to="/app" variant="secondary" block>
            Ir a mi panel
          </LinkButton>
        </div>
      ) : !preview ? (
        <div className="flex items-center gap-3 text-lg" role="status">
          <Spinner /> Cargando invitación…
        </div>
      ) : (
        <div className="space-y-5">
          <div className="rounded-3xl border border-line bg-surface p-6 shadow-card">
            <p className="text-lg">
              {preview.invitedBy ? <strong>{preview.invitedBy}</strong> : 'Alguien'} te invita a colaborar en{' '}
              <strong>«{preview.organizationName}»</strong> como <strong>{preview.role === 'owner' ? 'propietario/a' : 'encargado/a'}</strong>.
            </p>
            <p className="mt-2 text-ink-muted">
              Invitación para <span className="break-all">{preview.email}</span>.
            </p>
          </div>
          {loggedIn ? (
            sameEmail ? (
              <Button size="lg" block onClick={() => void accept()} loading={accepting}>
                Aceptar y entrar en {preview.organizationName}
              </Button>
            ) : (
              <div className="space-y-3">
                <Callout tone="warn" title="Has entrado con otra cuenta">
                  Esta invitación es para {preview.email} y ahora estás dentro como {account.data.user.email}. Cierra sesión y entra con la cuenta
                  invitada para aceptarla (la invitación se conserva).
                </Callout>
                <Button size="lg" block icon="logout" loading={switching} onClick={() => void switchAccount()}>
                  Cerrar sesión y entrar con {preview.email}
                </Button>
              </div>
            )
          ) : (
            <div className="grid gap-3">
              <LinkButton to="/entrar?next=%2Finvitacion" state={{ email: preview.email }} size="lg" block>
                Ya tengo cuenta: entrar
              </LinkButton>
              <LinkButton to="/registro" state={{ email: preview.email }} variant="secondary" size="lg" block>
                Crear cuenta con {preview.email}
              </LinkButton>
              <p className="text-sm text-ink-muted">
                Si creas la cuenta, tendrás que confirmar tu email y volver a abrir este enlace de invitación para aceptarla.
              </p>
            </div>
          )}
        </div>
      )}
      <p className="mt-8 text-sm text-ink-muted">
        {APP_NAME} · <Link to="/" className={linkClass}>Inicio</Link>
      </p>
    </AuthLayout>
  );
}
