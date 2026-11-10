import { useRef, useState, type ReactNode } from 'react';
import { errorMessage, formatWait, isApiError } from '@/api/client';
import { Button, type ButtonVariant } from '@/components/ui/Button';
import { Callout } from '@/components/ui/Feedback';
import type { IconName } from '@/components/icons/Icon';
import { downloadFile } from '@/lib/download';

/**
 * Mensaje de un fallo de descarga. Los 429 (informe en curso, cola llena, presupuesto horario agotado) y
 * REPORT_TOO_LARGE se muestran tal cual los redacta el servidor, que ya explica el motivo.
 */
export function downloadErrorMessage(err: unknown): string {
  if (isApiError(err) && (err.status === 429 || err.code === 'REPORT_TOO_LARGE')) return err.message;
  return errorMessage(err);
}

/** Botón de descarga con estado de carga y errores legibles (p. ej. "inténtalo en 2 minutos"). */
export function DownloadButton({
  url,
  fallbackName,
  children,
  icon = 'download',
  variant = 'secondary',
  disabled,
  className,
  busyLabel,
}: {
  url: string;
  fallbackName: string;
  children: ReactNode;
  icon?: IconName;
  variant?: ButtonVariant;
  disabled?: boolean;
  className?: string;
  /** Texto mientras se prepara (p. ej. «Generando el informe…»): activa además el aviso con barra de progreso indeterminada. */
  busyLabel?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ message: string; wait: number | null } | null>(null);
  const running = useRef(false);
  return (
    <div className={className}>
      <Button
        variant={variant}
        size="lg"
        block
        icon={icon}
        loading={busy}
        disabled={disabled}
        onClick={async () => {
          if (running.current) return;
          running.current = true;
          setBusy(true);
          setError(null);
          try {
            await downloadFile(url, fallbackName);
          } catch (err) {
            setError({ message: downloadErrorMessage(err), wait: isApiError(err) && err.status === 429 ? err.retryAfter : null });
          } finally {
            running.current = false;
            setBusy(false);
          }
        }}
      >
        {busy && busyLabel ? busyLabel : children}
      </Button>
      {busy && busyLabel ? (
        <div className="mt-2" data-testid="download-progress">
          <div role="progressbar" aria-label={busyLabel} className="indeterminate-bar h-2 overflow-hidden rounded-full bg-surface-3" />
          <p role="status" className="mt-1.5 text-sm text-ink-muted">
            {busyLabel} Si hay otros informes en marcha, puede tardar hasta medio minuto. No cierres esta página.
          </p>
        </div>
      ) : null}
      {error ? (
        <Callout tone="bad" className="mt-2" live="assertive">
          {error.message}
          {error.wait ? <span className="mt-1 block text-sm text-ink-muted">Podrás volver a intentarlo en {formatWait(error.wait)}.</span> : null}
        </Callout>
      ) : null}
    </div>
  );
}
