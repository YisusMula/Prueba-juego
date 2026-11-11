import type { FastifyReply } from 'fastify';

/** Sin progreso de escritura durante este tiempo, la descarga se aborta. */
export const DOWNLOAD_IDLE_TIMEOUT_MS = 60_000;

/**
 * Timeout de inactividad para respuestas grandes (PDF, CSV, exportación): si el cliente deja de
 * leer y el socket no progresa en `ms`, se cierra la conexión y se liberan los recursos.
 */
export function guardSlowDownload(reply: FastifyReply, ms = DOWNLOAD_IDLE_TIMEOUT_MS): void {
  reply.raw.setTimeout(ms, () => {
    reply.request.log.warn('Descarga abortada: el cliente no progresa');
    reply.raw.destroy();
  });
}
