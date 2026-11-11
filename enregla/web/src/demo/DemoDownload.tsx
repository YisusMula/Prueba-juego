/**
 * Descargas en la demo. Dentro de un Artifact no se puede descargar con <a download> ni con blobs:
 * solo con la capacidad `downloads` del visor, y siempre desde el clic de la persona. Si el visor
 * no la ofrece, en lugar del botón se muestra una vista previa en pantalla.
 *  - CSV y exportación: se generan aquí mismo con los datos actuales de la demo.
 *  - PDF: el PDF real lo maqueta el servidor; la demo entrega un PDF de ejemplo generado con el
 *    servidor de verdad a partir de los datos iniciales.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/Button';
import { Callout } from '@/components/ui/Feedback';
import { filenameFromDisposition } from '@/lib/download';
import type { DownloadButtonProps } from '@/lib/platform';
import { cn } from '@/lib/cn';
import { handle } from './server';
import { disableDownloads, UNAVAILABLE_CODES, useDownloads, type DownloadsError, type SaveRequest } from './downloads';

export const SAMPLE_PDF = 'informe-ejemplo.pdf';
export const SAMPLE_PDF_PREVIEW = 'informe-ejemplo-p1.png';
const SAMPLE_PDF_NAME = 'registros-restaurante-la-demo-ejemplo.pdf';
export const SAMPLE_PDF_LABEL = 'PDF de ejemplo con los datos iniciales de la demo';

type Kind = 'pdf' | 'csv' | 'json';
const kindOf = (url: string): Kind => (/\/reports\/pdf(\?|$)/.test(url) ? 'pdf' : /\/reports\/csv(\?|$)/.test(url) ? 'csv' : 'json');

async function fetchSamplePdf(): Promise<Blob> {
  const res = await window.fetch(SAMPLE_PDF);
  if (!res.ok) throw new Error('No se encontró el PDF de ejemplo');
  return res.blob();
}

/** Genera el fichero con la API de la demo (CSV o exportación JSON). */
function generate(url: string, fallbackName: string): { ok: true; file: SaveRequest & { data: string } } | { ok: false; message: string } {
  const r = handle('GET', url);
  if (r.status !== 200 || r.text === undefined) {
    const message = (r.json as { error?: { message?: string } } | undefined)?.error?.message ?? 'No se pudo generar el fichero.';
    return { ok: false, message };
  }
  return { ok: true, file: { filename: filenameFromDisposition(r.headers?.['Content-Disposition'] ?? null, fallbackName), data: r.text } };
}

export function DemoDownload({ url, fallbackName, children, icon = 'download', variant = 'secondary', disabled, className }: DownloadButtonProps) {
  const downloads = useDownloads();
  const kind = kindOf(url);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'bad' | 'info'; text: string } | null>(null);
  const pdf = useRef<Blob | null>(null);

  // El PDF se trae antes del clic para poder entregarlo sin esperas dentro del gesto de la persona.
  useEffect(() => {
    if (kind !== 'pdf' || downloads.status !== 'ready' || pdf.current) return;
    fetchSamplePdf().then(
      (b) => {
        pdf.current = b;
      },
      () => undefined,
    );
  }, [kind, downloads.status]);

  const save = async () => {
    const api = downloads.api;
    if (!api || busy) return;
    setMsg(null);
    let file: SaveRequest;
    if (kind === 'pdf') {
      if (!pdf.current) {
        setBusy(true);
        try {
          pdf.current = await fetchSamplePdf();
        } catch {
          setBusy(false);
          setMsg({ tone: 'bad', text: 'No se pudo cargar el PDF de ejemplo.' });
          return;
        }
      }
      file = { filename: SAMPLE_PDF_NAME, data: pdf.current };
    } else {
      const g = generate(url, fallbackName);
      if (!g.ok) {
        setMsg({ tone: 'bad', text: g.message });
        return;
      }
      file = g.file;
    }
    setBusy(true);
    try {
      const r = await api.save(file);
      setMsg({ tone: 'ok', text: r.status === 'saved' ? `Listo: ${file.filename}` : 'Fichero entregado.' });
    } catch (err) {
      const code = (err as DownloadsError | null)?.code ?? 'unavailable';
      if (code === 'declined') setMsg({ tone: 'info', text: 'Descarga cancelada.' });
      else if (code === 'rate_limited') setMsg({ tone: 'info', text: 'Ya hay una descarga pendiente de confirmar. Espera un momento y vuelve a probar.' });
      else if (UNAVAILABLE_CODES.has(code)) disableDownloads();
      else setMsg({ tone: 'bad', text: 'No se pudo descargar el fichero en este visor.' });
    } finally {
      setBusy(false);
    }
  };

  if (downloads.status === 'ready') {
    return (
      <div className={cn('min-w-0', className)} data-demo-download={kind}>
        <Button variant={variant} size="lg" block icon={icon} loading={busy} disabled={disabled} onClick={() => void save()}>
          {children}
        </Button>
        {kind === 'pdf' ? <p className="mt-1.5 text-sm text-ink-muted">{SAMPLE_PDF_LABEL} (últimos 30 días); no incluye lo que registres en la demo.</p> : null}
        {msg ? (
          <Callout tone={msg.tone} className="mt-2" live="polite">
            {msg.text}
          </Callout>
        ) : null}
      </div>
    );
  }
  return <Preview kind={kind} url={url} fallbackName={fallbackName} label={children} disabled={disabled} className={className} />;
}

// ---------------------------------------------------------------------------
// Vistas previas (cuando el visor no permite descargar)
// ---------------------------------------------------------------------------
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  for (const line of text.replace(/^\uFEFF/, '').split('\r\n')) {
    if (!line) continue;
    const cells: string[] = [];
    const re = /"((?:[^"]|"")*)"(;|$)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(line))) {
      cells.push(m[1]!.replace(/""/g, '"').replace(/^'(?=[=+\-@])/, ''));
      if (!m[2]) break;
    }
    rows.push(cells);
  }
  return rows;
}

const PREVIEW_ROWS = 8;

function CsvPreview({ url, fallbackName }: { url: string; fallbackName: string }) {
  const g = generate(url, fallbackName);
  if (!g.ok) return <Callout tone="bad">{g.message}</Callout>;
  const [header = [], ...rows] = parseCsv(g.file.data);
  const col = (r: string[], name: string) => r[header.indexOf(name)] ?? '';
  const first = (r: string[], names: string[]) => names.map((n) => col(r, n)).find(Boolean) ?? '';
  return (
    <div data-testid="csv-preview">
      <p className="text-sm text-ink-muted">
        {g.file.filename} · {rows.length} {rows.length === 1 ? 'fila' : 'filas'} y {header.length} columnas. Primeras {Math.min(PREVIEW_ROWS, rows.length)}:
      </p>
      <div className="mt-2 max-w-full overflow-x-auto rounded-xl border border-line">
        <table className="w-full min-w-[34rem] border-collapse text-left text-sm">
          <thead className="bg-surface-2">
            <tr>
              {['Fecha y hora', 'Tipo', 'Firma', 'Qué', 'Resultado', 'Alerta'].map((h) => (
                <th key={h} scope="col" className="px-2 py-1.5 font-semibold">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, PREVIEW_ROWS).map((r, i) => (
              <tr key={i} className="border-t border-line">
                <td className="px-2 py-1.5 whitespace-nowrap tabular">{col(r, 'fecha_hora')}</td>
                <td className="px-2 py-1.5">{col(r, 'tipo')}</td>
                <td className="px-2 py-1.5">{first(r, ['firmado_por_personal', 'firmado_por_usuario'])}</td>
                <td className="px-2 py-1.5">{first(r, ['equipo', 'plan_limpieza', 'producto', 'descripcion', 'curso'])}</td>
                <td className="px-2 py-1.5 tabular">
                  {(() => {
                    const v = col(r, 'valor_c') || col(r, 'compuestos_polares_pct');
                    if (v) return col(r, 'valor_c') ? `${v} °C` : `${v} %`;
                    return first(r, ['estado_limpieza', 'resultado', 'estado', 'horas']);
                  })()}
                </td>
                <td className="px-2 py-1.5">{col(r, 'alerta')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ExportPreview({ url, fallbackName }: { url: string; fallbackName: string }) {
  const g = generate(url, fallbackName);
  if (!g.ok) return <Callout tone="bad">{g.message}</Callout>;
  const data = JSON.parse(g.file.data) as Record<string, unknown>;
  const count = (k: string) => (Array.isArray(data[k]) ? (data[k] as unknown[]).length : 0);
  const parts: [string, string][] = [
    ['records', 'registros'],
    ['staff', 'personas del personal'],
    ['equipment', 'equipos'],
    ['cleaningPlans', 'planes de limpieza'],
    ['suppliers', 'proveedores'],
    ['dishes', 'platos'],
    ['devices', 'dispositivos de cocina'],
    ['members', 'miembros'],
    ['auditEvents', 'eventos de actividad'],
  ];
  return (
    <div data-testid="export-preview">
      <p className="text-sm text-ink-muted">
        {g.file.filename} ({Math.round(g.file.data.length / 1024)} KB) contendría:
      </p>
      <ul className="mt-2 grid gap-1 text-sm sm:grid-cols-2">
        {parts.map(([k, label]) => (
          <li key={k}>
            <span className="font-semibold tabular">{count(k)}</span> {label}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Preview({ kind, url, fallbackName, label, disabled, className }: { kind: Kind; url: string; fallbackName: string; label: ReactNode; disabled?: boolean; className?: string }) {
  const [open, setOpen] = useState(false);
  const what = kind === 'pdf' ? 'Ver el PDF de ejemplo' : kind === 'csv' ? 'Ver vista previa del CSV' : 'Ver qué incluiría la exportación';
  return (
    <div className={cn('min-w-0 max-w-full rounded-2xl border border-line bg-surface-2/60 p-3', className)} data-demo-preview={kind}>
      <p className="font-bold">{label}</p>
      <p className="mt-0.5 text-sm text-ink-muted">
        {kind === 'pdf' ? `${SAMPLE_PDF_LABEL}. ` : ''}Este visor no permite descargar ficheros: puedes verlo aquí.
      </p>
      <Button variant="secondary" icon={open ? 'eyeOff' : 'eye'} className="mt-2" disabled={disabled} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {open ? 'Ocultar' : what}
      </Button>
      {open && !disabled ? (
        <div className="mt-3">
          {kind === 'csv' ? (
            <CsvPreview url={url} fallbackName={fallbackName} />
          ) : kind === 'json' ? (
            <ExportPreview url={url} fallbackName={fallbackName} />
          ) : (
            <figure data-testid="pdf-preview">
              <img
                src={SAMPLE_PDF_PREVIEW}
                alt="Primera página del informe PDF de ejemplo: cabecera con el local y el periodo, y tabla de temperaturas."
                className="w-full rounded-lg border border-line bg-white"
                loading="lazy"
              />
              <figcaption className="mt-1 text-sm text-ink-muted">Primera página del PDF de ejemplo con los datos iniciales de la demo (últimos 30 días).</figcaption>
            </figure>
          )}
        </div>
      ) : null}
    </div>
  );
}
