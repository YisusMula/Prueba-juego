import { beforeEach, describe, expect, it } from 'vitest';
import '@shared/schemas';
import { handle } from '../server';
import { resetDb } from '../server/store';
import { DEMO_EMAIL, DEMO_PASSWORD } from '../server/seed';
import type { Account, Equipment, Page, Staff, TodayTasks, Dish, PublicMenu, AppRecord } from '@/api/types';

const get = <T,>(url: string, headers?: HeadersInit) => handle('GET', url, { headers }) as { status: number; json: T; text?: string };
const send = <T,>(method: string, url: string, body?: unknown, headers?: HeadersInit) =>
  handle(method, url, { body: body === undefined ? undefined : JSON.stringify(body), headers }) as { status: number; json: T; headers?: Record<string, string> };

describe('API de la demo', () => {
  let orgId = '';
  beforeEach(() => {
    resetDb();
    orgId = get<Account>('/api/account').json.organizations[0]!.id;
  });

  it('arranca con la sesión del dueño demo y 30 días de datos', () => {
    const acc = get<Account>('/api/account');
    expect(acc.status).toBe(200);
    expect(acc.json.user.email).toBe(DEMO_EMAIL);
    const today = get<TodayTasks>(`/api/orgs/${orgId}/tasks/today`).json;
    expect(today.temperatures.length).toBeGreaterThan(0);
    const recs = get<Page<AppRecord>>(`/api/orgs/${orgId}/records?limit=200`).json;
    expect(recs.items.length).toBe(200);
    expect(recs.nextCursor).not.toBeNull();
  });

  it('valida en español y exige acción correctora fuera de rango', () => {
    const eq = get<Page<Equipment>>(`/api/orgs/${orgId}/equipment`).json.items.find((e) => e.type === 'camara')!;
    const bad = send<{ error: { code: string; details: { path: string; message: string }[] } }>('POST', `/api/orgs/${orgId}/records`, { type: 'temperatura', data: { equipmentId: eq.id, value: 9 } });
    expect(bad.status).toBe(400);
    expect(bad.json.error.details[0]!.path).toBe('data.correctiveAction');
    const r = send<{ record: AppRecord }>('POST', `/api/orgs/${orgId}/records`, { type: 'temperatura', data: { equipmentId: eq.id, value: 9, correctiveAction: 'Revisada' } });
    expect(r.status).toBe(201);
    expect(r.json.record.alert).toBe(true);
    const alerts = get<TodayTasks>(`/api/orgs/${orgId}/tasks/today`).json.alerts;
    expect(alerts.some((a) => a.recordId === r.json.record.id)).toBe(true);
    // Enmienda: misma fecha del hecho, y solo una por registro.
    const am = send<{ record: AppRecord }>('POST', `/api/orgs/${orgId}/records/${r.json.record.id}/amendments`, { reason: 'Error', data: { equipmentId: eq.id, value: 3 } });
    expect(am.status).toBe(201);
    expect(am.json.record.effectiveAt).toBe(r.json.record.effectiveAt);
    expect(send('POST', `/api/orgs/${orgId}/records/${r.json.record.id}/amendments`, { reason: 'Otra', data: { equipmentId: eq.id, value: 3 } }).status).toBe(409);
  });

  it('bloquea el PIN a los 5 fallos en el modo cocina', () => {
    const token = (send<{ token: string }>('POST', `/api/orgs/${orgId}/devices`, { name: 'Prueba' }).json).token;
    const auth = { Authorization: `Bearer ${token}` };
    const ana = get<Page<Staff>>(`/api/orgs/${orgId}/staff`).json.items.find((s) => s.name === 'Ana Martín')!;
    for (let i = 0; i < 4; i++) expect(send('POST', '/api/kiosk/verify-pin', { staffId: ana.id, pin: '0000' }, auth).status).toBe(401);
    const locked = send<{ error: { code: string } }>('POST', '/api/kiosk/verify-pin', { staffId: ana.id, pin: '0000' }, auth);
    expect(locked.status).toBe(429);
    expect(locked.json.error.code).toBe('PIN_LOCKED');
    expect(locked.headers?.['Retry-After']).toBeTruthy();
    expect(send('POST', '/api/kiosk/verify-pin', { staffId: ana.id, pin: '1234' }, auth).status).toBe(429);
    send('POST', `/api/orgs/${orgId}/staff/${ana.id}/unlock`);
    expect(send('POST', '/api/kiosk/verify-pin', { staffId: ana.id, pin: '1234' }, auth).status).toBe(200);
  });

  it('solo publica en la carta los platos revisados', () => {
    const slug = get<{ publicMenu: { slug: string } }>(`/api/orgs/${orgId}/public-menu`).json.publicMenu.slug;
    const names = () => get<PublicMenu>(`/api/public/menu/${slug}`).json.dishes.map((d) => d.name);
    expect(names()).not.toContain('Pulpo a la gallega');
    const pulpo = get<Page<Dish>>(`/api/orgs/${orgId}/dishes`).json.items.find((d) => d.name === 'Pulpo a la gallega')!;
    send('PATCH', `/api/orgs/${orgId}/dishes/${pulpo.id}`, { allergensReviewed: true });
    expect(names()).toContain('Pulpo a la gallega');
  });

  it('cierra sesión y vuelve a entrar con las credenciales demo', () => {
    expect(send('POST', '/api/auth/logout').status).toBe(204);
    expect(get('/api/account').status).toBe(401);
    expect(send('POST', '/api/auth/login', { email: DEMO_EMAIL, password: 'mala' }).status).toBe(401);
    expect(send('POST', '/api/auth/login', { email: DEMO_EMAIL, password: DEMO_PASSWORD }).status).toBe(200);
    expect(get('/api/account').status).toBe(200);
  });

  it('borrado diferido: solo lectura y restauración', () => {
    expect(send('DELETE', `/api/orgs/${orgId}`, { password: DEMO_PASSWORD }).status).toBe(204);
    const org = get<{ organization: { subscription: { readOnly: boolean }; deletionScheduledAt: string | null } }>(`/api/orgs/${orgId}`).json.organization;
    expect(org.deletionScheduledAt).not.toBeNull();
    expect(org.subscription.readOnly).toBe(true);
    expect(send('POST', `/api/orgs/${orgId}/staff`, { name: 'X' }).status).toBe(402);
    expect(send('POST', `/api/orgs/${orgId}/restore`).status).toBe(200);
    expect(send('POST', `/api/orgs/${orgId}/staff`, { name: 'X' }).status).toBe(201);
  });

  it('genera el CSV con la cabecera del servidor', () => {
    const r = handle('GET', `/api/orgs/${orgId}/reports/csv?from=2000-01-01&to=2000-01-31`);
    expect(r.status).toBe(200);
    expect(r.text?.startsWith('\uFEFF"id";"tipo"')).toBe(true);
  });
});
