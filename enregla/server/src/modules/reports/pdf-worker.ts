/**
 * worker_thread que genera un informe PDF (B-2). Recibe los registros ya cargados en `workerData`
 * y devuelve el PDF completo (o el motivo del fallo) por mensaje.
 */
import { parentPort, workerData } from 'node:worker_threads';
import { AppError } from '../../lib/errors.js';
import { renderPdfInProcess, type PdfJob, type PdfWorkerReply } from './pdf-render.js';

const job = workerData as PdfJob;

renderPdfInProcess(job)
  .then((buf) => {
    const pdf = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
    const reply: PdfWorkerReply = { ok: true, pdf };
    // Se transfiere el búfer (sin copiarlo) solo si no es un trozo del pool compartido.
    const transferable = buf.byteOffset === 0 && buf.byteLength === buf.buffer.byteLength;
    parentPort!.postMessage(reply, transferable ? [buf.buffer as ArrayBuffer] : []);
  })
  .catch((err: unknown) => {
    const reply: PdfWorkerReply = {
      ok: false,
      tooLarge: err instanceof AppError && err.code === 'REPORT_TOO_LARGE',
      message: err instanceof Error ? err.message : String(err),
    };
    parentPort!.postMessage(reply);
  });
