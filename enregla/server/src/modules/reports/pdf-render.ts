import { Worker } from 'node:worker_threads';
import { AppError } from '../../lib/errors.js';
import type { RecordType } from '../../schemas/index.js';
import type { Organization } from '../../db/types.js';
import type { ReportRecord } from './format.js';
import { createReportPdf, type DayNote } from './pdf.js';

/** Tope defensivo de tamaño de un PDF en memoria (5.000 filas ocupan bastante menos). */
export const MAX_PDF_BYTES = 64 * 1024 * 1024;
/** Memoria máxima del heap de cada worker de PDF (MB). */
export const PDF_WORKER_HEAP_MB = 256;

/** Datos ya cargados (los registros, como mucho maxRows) que necesita la generación. */
export interface PdfJob {
  appName: string;
  org: Organization;
  from: string;
  to: string;
  types: RecordType[];
  records: Partial<Record<RecordType, ReportRecord[]>>;
  maxRows: number;
  dayNotes: DayNote[];
  maxBytes: number;
}

export type PdfWorkerReply = { ok: true; pdf: Uint8Array } | { ok: false; tooLarge: boolean; message: string };

const tooLarge = () => new AppError(400, 'REPORT_TOO_LARGE', 'El informe PDF es demasiado grande. Acota el periodo o los tipos de registro, o descarga el CSV.');

async function* once<T>(value: T): AsyncGenerator<T> {
  if (Array.isArray(value) && value.length === 0) return;
  yield value;
}

/** Genera el PDF en este hilo (lo usan el worker y, si se desactiva, la propia API). */
export function renderPdfInProcess(job: PdfJob, signal?: AbortSignal): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let settled = false;
    const done = (err: Error | null, buf?: Buffer) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener('abort', onAbort);
      if (err) reject(err);
      else resolve(buf!);
    };
    const doc = createReportPdf(
      {
        appName: job.appName,
        org: job.org,
        from: job.from,
        to: job.to,
        types: job.types,
        records: (type) => once(job.records[type] ?? []),
        maxRows: job.maxRows,
        dayNotes: job.dayNotes,
      },
      () => undefined,
    );
    const onAbort = () => {
      if (!doc.readableEnded) {
        doc.destroy();
        done(new Error('Petición cancelada durante la generación del PDF'));
      }
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    doc.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > job.maxBytes) {
        doc.destroy();
        done(tooLarge());
        return;
      }
      chunks.push(chunk);
    });
    doc.once('end', () => done(null, Buffer.concat(chunks, size)));
    doc.once('error', (err: Error) => done(err));
    doc.once('close', () => done(new Error('La generación del PDF se interrumpió')));
  });
}

/**
 * Fichero del worker: en producción, el .js compilado junto a este; en desarrollo y tests (tsx /
 * vitest) el .ts, cargado con el loader de tsx.
 */
function workerSpec(): { url: URL; execArgv: string[] } {
  const isTs = import.meta.url.endsWith('.ts');
  return {
    url: new URL(isTs ? './pdf-worker.ts' : './pdf-worker.js', import.meta.url),
    execArgv: isTs ? ['--import', 'tsx'] : [],
  };
}

/**
 * Genera el PDF en un worker_thread nuevo: el trabajo de CPU (maquetación, fuentes, compresión)
 * no compite con el event loop de la API. El worker tiene el heap acotado y se termina si el
 * cliente cancela la petición.
 */
export function renderPdfInWorker(job: PdfJob, signal?: AbortSignal): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const spec = workerSpec();
    const worker = new Worker(spec.url, {
      workerData: job,
      execArgv: spec.execArgv,
      resourceLimits: { maxOldGenerationSizeMb: PDF_WORKER_HEAP_MB },
    });
    let settled = false;
    const finish = (err: Error | null, buf?: Buffer) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener('abort', onAbort);
      void worker.terminate();
      if (err) reject(err);
      else resolve(buf!);
    };
    const onAbort = () => finish(new Error('Petición cancelada durante la generación del PDF'));
    signal?.addEventListener('abort', onAbort, { once: true });
    worker.once('message', (msg: PdfWorkerReply) => {
      if (msg.ok) finish(null, Buffer.from(msg.pdf.buffer, msg.pdf.byteOffset, msg.pdf.byteLength));
      else finish(msg.tooLarge ? tooLarge() : new Error(msg.message));
    });
    worker.once('error', (err) => finish(err));
    worker.once('exit', (code) => finish(new Error(`El worker de PDF terminó sin resultado (código ${code})`)));
  });
}
