import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { errorMessage, isApiError } from '@/api/client';
import { Button } from '@/components/ui/Button';
import { Callout, Spinner } from '@/components/ui/Feedback';
import { Field, Textarea } from '@/components/ui/Form';
import { Logo } from '@/components/ui/Logo';
import { Icon } from '@/components/icons/Icon';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { takeHashToken } from '@/lib/hashToken';
import { KIOSK_TOKEN_RE, storage } from '@/lib/storage';
import { kioskApi } from './kioskApi';

/** Comprueba el token contra la API y, si vale, lo guarda en este dispositivo. */
async function pair(token: string): Promise<string> {
  const ctx = await kioskApi.context(token);
  storage.setKioskToken(token);
  return ctx.organization.name;
}

export function KioskPairPage() {
  useDocumentTitle('Vincular tablet de cocina');
  const navigate = useNavigate();
  const [hashToken] = useState(() => takeHashToken());
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(!!hashToken);

  useEffect(() => {
    if (!hashToken) return;
    let alive = true;
    pair(hashToken).then(
      () => alive && navigate('/cocina', { replace: true }),
      (err: unknown) => {
        if (!alive) return;
        setBusy(false);
        setError(isApiError(err) && err.code === 'UNAUTHENTICATED' ? 'Este código no es válido o el dispositivo ya se desvinculó. Genera uno nuevo en Ajustes.' : errorMessage(err));
      },
    );
    return () => {
      alive = false;
    };
  }, [hashToken, navigate]);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const raw = value.trim();
    // Admite pegar el código o el enlace completo de vinculación.
    const token = raw.includes('#token=') ? (new URLSearchParams(raw.split('#')[1]).get('token') ?? '') : raw;
    if (!KIOSK_TOKEN_RE.test(token)) return setError('El código no tiene el formato correcto. Empieza por «kd_».');
    setBusy(true);
    setError(null);
    try {
      await pair(token);
      navigate('/cocina', { replace: true });
    } catch (err) {
      setBusy(false);
      setError(isApiError(err) && err.code === 'UNAUTHENTICATED' ? 'Este código no es válido o el dispositivo ya se desvinculó.' : errorMessage(err));
    }
  };

  return (
    <main id="main" tabIndex={-1} className="mx-auto flex min-h-dvh max-w-xl flex-col justify-center px-4 py-10 outline-none">
      <Logo />
      <h1 className="mt-8 text-4xl font-extrabold">Vincular esta tablet</h1>
      {busy && hashToken ? (
        <p className="mt-6 flex items-center gap-3 text-xl" role="status">
          <Spinner size={28} /> Vinculando…
        </p>
      ) : (
        <>
          <p className="mt-3 text-lg text-ink-muted">
            En el móvil o el ordenador del encargado: <strong>Ajustes → Dispositivos de cocina → Vincular dispositivo</strong>. Escanea el QR con esta tablet o pega
            aquí el código.
          </p>
          <form onSubmit={onSubmit} noValidate className="mt-6 space-y-4">
            <Field label="Código del dispositivo" error={error}>
              <Textarea value={value} onChange={(e) => setValue(e.target.value)} rows={2} autoComplete="off" spellCheck={false} className="font-mono" placeholder="kd_…" />
            </Field>
            <Button type="submit" size="xl" block loading={busy} icon="link">
              Vincular
            </Button>
          </form>
          {error && hashToken ? <Callout tone="bad" className="mt-4">{error}</Callout> : null}
          <p className="mt-6 flex items-start gap-2 text-sm text-ink-muted">
            <Icon name="shield" size={18} className="mt-0.5 shrink-0" />
            El código se guarda solo en este dispositivo y solo permite ver las tareas de hoy y añadir registros. Se puede desvincular en cualquier momento.
          </p>
          <Link to="/" className="mt-6 font-semibold underline underline-offset-4">
            Volver al inicio
          </Link>
        </>
      )}
    </main>
  );
}
