import { useState, type ReactNode } from 'react';
import { errorMessage } from '@/api/client';
import { Button, type ButtonVariant } from '@/components/ui/Button';
import { Callout } from '@/components/ui/Feedback';
import type { IconName } from '@/components/icons/Icon';
import { downloadFile } from '@/lib/download';

/** Botón de descarga con estado de carga y errores legibles (p. ej. "inténtalo en 2 minutos"). */
export function DownloadButton({
  url,
  fallbackName,
  children,
  icon = 'download',
  variant = 'secondary',
  disabled,
  className,
}: {
  url: string;
  fallbackName: string;
  children: ReactNode;
  icon?: IconName;
  variant?: ButtonVariant;
  disabled?: boolean;
  className?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
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
          setBusy(true);
          setError(null);
          try {
            await downloadFile(url, fallbackName);
          } catch (err) {
            setError(errorMessage(err));
          } finally {
            setBusy(false);
          }
        }}
      >
        {children}
      </Button>
      {error ? (
        <Callout tone="bad" className="mt-2" live="assertive">
          {error}
        </Callout>
      ) : null}
    </div>
  );
}
