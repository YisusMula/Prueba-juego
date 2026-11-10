import { api } from '@/api/client';
import type { AppRecord, KioskContext, RecordType, TodayTasks } from '@/api/types';

/**
 * Cliente del modo cocina. El token del dispositivo viaja SOLO en la cabecera
 * Authorization (nunca en la URL) y no se registra en consola.
 */
const auth = (token: string) => ({ headers: { Authorization: `Bearer ${token}` }, silentAuth: true });

export const kioskApi = {
  context: (token: string) => api.get<KioskContext>('/api/kiosk/context', auth(token)),
  today: (token: string) => api.get<TodayTasks>('/api/kiosk/tasks/today', auth(token)),
  createRecord: (token: string, body: { staffId: string; pin?: string; type: RecordType; data: unknown }) =>
    api.post<{ record: AppRecord }>('/api/kiosk/records', body, auth(token)).then((r) => r.record),
};
