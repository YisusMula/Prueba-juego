import { api } from '@/api/client';
import type { KioskCorrectionReason } from '@shared/schemas';
import type { AppRecord, KioskContext, RecordType, TodayTasks } from '@/api/types';

/**
 * Cliente del modo cocina. El token del dispositivo viaja SOLO en la cabecera
 * Authorization (nunca en la URL) y no se registra en consola.
 */
const auth = (token: string) => ({ headers: { Authorization: `Bearer ${token}` }, silentAuth: true });

export const kioskApi = {
  context: (token: string) => api.get<KioskContext>('/api/kiosk/context', auth(token)),
  today: (token: string) => api.get<TodayTasks>('/api/kiosk/tasks/today', auth(token)),
  /** `idempotencyKey`: la misma en todos los reintentos del mismo registro (cola con mala cobertura). */
  createRecord: (token: string, body: { staffId: string; pin?: string; type: RecordType; data: unknown }, idempotencyKey?: string) =>
    api.post<{ record: AppRecord }>('/api/kiosk/records', body, { ...auth(token), idempotencyKey }).then((r) => r.record),
  /** Comprueba el PIN al identificarse (mismos bloqueos que el alta). */
  verifyPin: (token: string, body: { staffId: string; pin: string }) =>
    api.post<{ staff: { id: string; name: string; hasPin: boolean } }>('/api/kiosk/verify-pin', body, auth(token)),
  /** Corrige el registro recién hecho (2 minutos; misma persona y tablet). Crea una corrección, nunca borra. */
  amend: (
    token: string,
    recordId: string,
    body: { staffId: string; pin?: string; reason: KioskCorrectionReason; reasonText?: string | null; data?: unknown; newStaffId?: string; newStaffPin?: string },
    idempotencyKey?: string,
  ) => api.post<{ record: AppRecord }>(`/api/kiosk/records/${encodeURIComponent(recordId)}/amendments`, body, { ...auth(token), idempotencyKey }).then((r) => r.record),
  /** Salir del modo cocina: contraseña de un propietario o encargado (verificada en el servidor). */
  exit: (token: string, body: { email: string; password: string }) => api.post<{ ok: true; by: { name: string } }>('/api/kiosk/exit', body, auth(token)),
  /** Desvincular la tablet: revoca el dispositivo en el servidor. */
  unpair: (token: string, body: { email: string; password: string }) => api.post<{ ok: true; by: { name: string } }>('/api/kiosk/unpair', body, auth(token)),
};
