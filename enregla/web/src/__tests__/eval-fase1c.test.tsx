/**
 * Tercera evaluación de la fase 1 en la interfaz y la demo: motivo de «ambiente» con proveedor escrito
 * a mano o en una corrección (R6), PIN bloqueado que un responsable desbloquea en la tablet y bloqueo
 * progresivo (R7), y aviso de personal sin PIN.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router';
import { RecepcionForm, type FormContext } from '@/features/RecordForms';
import { KioskPage } from '@/pages/kiosk/Kiosk';
import { storage } from '@/lib/storage';
import { handle, toResponse } from '@/demo/server';
import { getDb, resetDb } from '@/demo/server/store';
import { DEMO_PASSWORD, DEMO_EMAIL } from '@/demo/server/seed';
import type { Account } from '@/api/types';

beforeEach(() => {
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
    this.removeAttribute('open');
  };
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const SUP = '33333333-3333-4333-8333-333333333333';
const ctx: FormContext = {
  equipment: [],
  cleaningPlans: [],
  suppliers: [{ id: SUP, name: 'Frío Norte', products: [], defaultCategory: 'refrigerado' }],
  staff: [],
  timezone: 'Europe/Madrid',
};

describe('R6 «ambiente» en la web', () => {
  it('con el proveedor escrito a mano (mismo nombre que uno de frío) pide el motivo', async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(<RecepcionForm ctx={ctx} onSubmit={onSubmit} />);
    await user.selectOptions(screen.getByLabelText('Proveedor'), '__other');
    await user.type(screen.getByLabelText('Nombre del proveedor'), ' frío norte ');
    await user.type(screen.getByLabelText('Producto'), 'Pollo');
    await user.click(screen.getByRole('radio', { name: /Ambiente/ }));
    expect(screen.getByText(/Frío Norte suele traer producto refrigerado/)).toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: 'Sí, aceptada' }));
    await user.click(screen.getByRole('button', { name: /Guardar/ }));
    expect(onSubmit).not.toHaveBeenCalled();
    await user.type(screen.getByLabelText(/¿Por qué es ambiente\?/), 'Envasado');
    await user.click(screen.getByRole('button', { name: /Guardar/ }));
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ category: 'ambiente', categoryReason: 'Envasado' }));
  });

  it('al corregir un registro refrigerado y pasarlo a ambiente pide el motivo', async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    const initial = { supplierId: null, supplierName: 'Ocasional', product: 'Pollo', lot: null, temperature: 2, category: 'refrigerado' as const, expiryDate: null, accepted: true, rejectionReason: null, correctiveAction: null };
    render(<RecepcionForm ctx={ctx} initial={initial as never} onSubmit={onSubmit} />);
    expect(screen.queryByLabelText(/¿Por qué es ambiente\?/)).toBeNull();
    await user.click(screen.getByRole('radio', { name: /Ambiente/ }));
    expect(screen.getByText(/El registro original era producto refrigerado/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Guardar/ }));
    expect(onSubmit).not.toHaveBeenCalled();
  });
});

describe('R6 / R7 en la demo (como el servidor)', () => {
  const get = <T,>(url: string, headers?: HeadersInit) => handle('GET', url, { headers }) as { status: number; json: T };
  const send = <T,>(method: string, url: string, body?: unknown, headers?: HeadersInit) => handle(method, url, { body: body === undefined ? undefined : JSON.stringify(body), headers }) as { status: number; json: T };
  it('proveedor escrito a mano y corrección a ambiente exigen motivo; bloqueo progresivo y desbloqueo en la tablet', () => {
    resetDb();
    const orgId = get<Account>('/api/account').json.organizations[0]!.id;
    send('POST', `/api/orgs/${orgId}/suppliers`, { name: 'Frío Norte', defaultCategory: 'refrigerado' });
    const base = { supplierName: 'FRÍO NORTE', product: 'Pollo', category: 'ambiente', accepted: true };
    expect(send('POST', `/api/orgs/${orgId}/records`, { type: 'recepcion', data: base }).status).toBe(400);
    const orig = send<{ record: { id: string } }>('POST', `/api/orgs/${orgId}/records`, { type: 'recepcion', data: { supplierName: 'Otro', product: 'Pollo', category: 'refrigerado', temperature: 2, accepted: true } }).json.record;
    const am = send<{ error: { details: { path: string; message: string }[] } }>('POST', `/api/orgs/${orgId}/records/${orig.id}/amendments`, {
      reason: 'Error',
      data: { supplierName: 'Otro', product: 'Pollo', category: 'ambiente', accepted: true },
    });
    expect(am.status).toBe(400);
    expect(am.json.error.details[0]!.message).toMatch(/original era producto refrigerado/);
    // Bloqueo progresivo y desbloqueo por un responsable en la tablet.
    const db = getDb();
    const token = 'kd_' + 'P'.repeat(43);
    db.devices.push({ id: crypto.randomUUID(), orgId, name: 'T', token, createdBy: db.users[0]!.id, createdAt: Date.now(), lastUsedAt: null, revokedAt: null });
    const auth = { Authorization: `Bearer ${token}` };
    const marta = db.staff.find((s) => s.orgId === orgId && s.name === 'Marta Gil')!;
    for (let i = 0; i < 5; i++) send('POST', '/api/kiosk/verify-pin', { staffId: marta.id, pin: '0000' }, auth);
    expect(marta.lockedUntil! - Date.now()).toBeLessThanOrEqual(60_000);
    expect(send('POST', `/api/kiosk/staff/${marta.id}/unlock`, { email: DEMO_EMAIL, password: 'mala' }, auth).status).toBe(401);
    expect(send('POST', `/api/kiosk/staff/${marta.id}/unlock`, { email: DEMO_EMAIL, password: DEMO_PASSWORD }, auth).status).toBe(200);
    expect(send('POST', '/api/kiosk/verify-pin', { staffId: marta.id, pin: '5678' }, auth).status).toBe(200);
  });
});

describe('R7 en la tablet', () => {
  it('PIN bloqueado: «Desbloquear (responsable)» con email y contraseña, y la persona puede volver a entrar', async () => {
    resetDb();
    const db = getDb();
    const org = db.orgs[0]!;
    const token = 'kd_' + 'Q'.repeat(43);
    db.devices.push({ id: crypto.randomUUID(), orgId: org.id, name: 'Tablet', token, createdBy: db.users[0]!.id, createdAt: Date.now(), lastUsedAt: null, revokedAt: null });
    const marta = db.staff.find((s) => s.orgId === org.id && s.name === 'Marta Gil')!;
    marta.failed = 5;
    marta.lockedUntil = Date.now() + 60_000;
    storage.setKioskToken(token);
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit = {}) => toResponse(handle((init.method ?? 'GET').toUpperCase(), url, { headers: init.headers, body: init.body }))),
    );
    const user = userEvent.setup();
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter initialEntries={['/cocina']}>
          <Routes>
            <Route path="/cocina" element={<KioskPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    await user.click(await screen.findByRole('button', { name: 'Temperatura' }));
    await user.click(await screen.findByRole('button', { name: /Marta Gil/ }));
    for (const d of '5678') await user.click(screen.getByRole('button', { name: d }));
    await user.click(screen.getByRole('button', { name: 'Entrar' }));
    expect(await screen.findByText(/está bloqueado/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Desbloquear (responsable)' }));
    expect(screen.getByRole('heading', { name: 'Desbloquear el PIN de Marta Gil' })).toBeInTheDocument();
    await user.type(screen.getByLabelText('Email del propietario o encargado'), DEMO_EMAIL);
    await user.type(screen.getByLabelText('Contraseña'), DEMO_PASSWORD);
    await user.click(screen.getByRole('button', { name: 'Desbloquear' }));
    expect(await screen.findByText(/PIN de Marta Gil desbloqueado por/)).toBeInTheDocument();
    expect(marta.lockedUntil).toBeNull();
    expect(db.audit.some((a) => a.event === 'staff.pin_unlocked')).toBe(true);
  });
});
