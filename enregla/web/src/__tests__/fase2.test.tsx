/**
 * Fase 2 (A1 y A2) en la interfaz y en el servidor simulado de la demo: formularios de cocinado,
 * enfriamiento y registros personalizados (web y teclado grande de la tablet), tareas sin registrar
 * por día, datos del establecimiento y verificación del responsable.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { REFERENCE_DEFAULTS } from '@shared/schemas';
import { CocinadoForm, EnfriamientoForm, PersonalizadoForm, type FormContext } from '@/features/RecordForms';
import { MissingByDay, missingLabel } from '@/pages/app/AppPages';
import { handle } from '@/demo/server';
import { resetDb } from '@/demo/server/store';
import { supplierKey } from '@/demo/server/records';
import type { Account, AppRecord, Compliance, CustomTemplate, Organization, TodayTasks, Verification } from '@/api/types';

const TPL = '55555555-5555-4555-8555-555555555555';
const COOL = '66666666-6666-4666-8666-666666666666';
const checklist: CustomTemplate = {
  id: TPL,
  name: 'Apertura',
  kind: 'checklist',
  items: [
    { id: 'a', label: 'Luces' },
    { id: 'b', label: 'Mosquiteras' },
  ],
  unit: null,
  min: null,
  max: null,
  frequency: 'daily',
  timesPerDay: 1,
  weekday: null,
  monthDay: null,
  instructions: 'Al abrir el local',
  suggestionKey: null,
  source: null,
  active: true,
  createdAt: '2026-11-01T08:00:00Z',
};
const ctx: FormContext = {
  equipment: [],
  cleaningPlans: [],
  suppliers: [],
  staff: [],
  timezone: 'Europe/Madrid',
  referenceValues: REFERENCE_DEFAULTS,
  customTemplates: [checklist, { ...checklist, id: '77777777-7777-4777-8777-777777777777', name: 'Cloro', kind: 'numeric', items: [], unit: 'mg/l', min: 0.2, max: 1, instructions: null }],
  coolings: [],
};

beforeEach(() => {
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
    this.removeAttribute('open');
  };
});
afterEach(() => vi.useRealTimers());

describe('cocinado y regeneración', () => {
  it('por debajo de la referencia orientativa pide acción correctora; la regeneración usa 74 °C', async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(<CocinadoForm ctx={ctx} onSubmit={onSubmit} />);
    await user.type(screen.getByLabelText('Producto'), 'Lentejas');
    await user.click(screen.getByText('Regeneración (recalentamiento)'));
    expect(screen.getByText(/Valor de referencia orientativo: 74 °C o más/)).toBeInTheDocument();
    await user.type(screen.getByLabelText(/Temperatura en el centro del producto/), '70');
    expect(screen.getByText('70 °C: no llega a 74 °C')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Guardar con acción correctora' }));
    expect(onSubmit).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Se volvió a calentar y a medir' }));
    await user.click(screen.getByRole('button', { name: 'Guardar con acción correctora' }));
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ product: 'Lentejas', process: 'regeneracion', coreTemp: 70, correctiveAction: 'Se volvió a calentar y a medir' }));
  });

  it('en la tablet se usa el teclado grande con ±', async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(<CocinadoForm ctx={ctx} onSubmit={onSubmit} large />);
    await user.type(screen.getByLabelText('Producto'), 'Pollo');
    await user.click(screen.getByText('Cocinado'));
    for (const k of ['7', '2', 'Coma decimal', '5']) await user.click(screen.getByRole('button', { name: k }));
    expect(screen.getByTestId('value-coreTemp')).toHaveTextContent('72,5');
    await user.click(screen.getByRole('button', { name: 'Guardar' }));
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ coreTemp: 72.5, process: 'cocinado' }));
  });
});

describe('enfriamiento rápido', () => {
  it('sin enfriamientos en curso empieza uno nuevo; con uno en curso se cierra con la temperatura final', async () => {
    const user = userEvent.setup();
    const onStart = vi.fn();
    const { unmount } = render(<EnfriamientoForm ctx={ctx} onSubmit={onStart} />);
    await user.type(screen.getByLabelText('Producto'), 'Caldo');
    await user.type(screen.getByLabelText(/Temperatura al empezar/), '75');
    await user.click(screen.getByRole('button', { name: 'Empezar el enfriamiento' }));
    expect(onStart).toHaveBeenCalledWith({ phase: 'inicio', product: 'Caldo', startTemp: 75, notes: null });
    unmount();
    // En curso desde hace 150 minutos: fuera de tiempo, pide acción correctora.
    const startedAt = new Date(Date.now() - 150 * 60_000).toISOString();
    const withOpen = { ...ctx, coolings: [{ recordId: COOL, product: 'Caldo', startTemp: 75, startedAt, deadline: startedAt, minutesElapsed: 150, overdue: true, targetTemp: 10, maxMinutes: 120 }] };
    const onClose = vi.fn();
    render(<EnfriamientoForm ctx={withOpen} preset={{ startRecordId: COOL }} onSubmit={onClose} />);
    await user.type(screen.getByLabelText(/Temperatura al terminar/), '8');
    expect(screen.getByText(/Han pasado \d+ min: supera los 120 min/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Terminar con acción correctora' }));
    expect(onClose).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Producto desechado' }));
    await user.click(screen.getByRole('button', { name: 'Terminar con acción correctora' }));
    expect(onClose).toHaveBeenCalledWith({ phase: 'fin', startRecordId: COOL, endTemp: 8, discarded: false, correctiveAction: 'Producto desechado' });
  });
});

describe('registros personalizados', () => {
  it('lista de comprobación: hay que contestar todos los puntos y uno «No» pide acción', async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(<PersonalizadoForm ctx={ctx} preset={{ templateId: TPL }} onSubmit={onSubmit} />);
    expect(screen.getByText('Al abrir el local')).toBeInTheDocument();
    const luces = screen.getByRole('group', { name: 'Luces' });
    await user.click(within(luces).getByRole('button', { name: 'Correcto' }));
    await user.click(screen.getByRole('button', { name: 'Guardar' }));
    expect(screen.getByText('Marca cada punto como correcto o no')).toBeInTheDocument();
    await user.click(within(screen.getByRole('group', { name: 'Mosquiteras' })).getByRole('button', { name: 'No' }));
    expect(screen.getByText('1 punto no se cumple')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Avisado el responsable' }));
    await user.click(screen.getByRole('button', { name: 'Guardar con acción correctora' }));
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ templateId: TPL, items: [{ itemId: 'a', ok: true }, { itemId: 'b', ok: false }], correctiveAction: 'Avisado el responsable' }));
  });
});

describe('tareas sin registrar por día', () => {
  it('textos iguales que en el PDF y lista desplegable por día', async () => {
    expect(missingLabel({ kind: 'temperatura', id: 'x', name: 'Cámara', expected: 2, done: 1, frequency: 'daily' })).toEqual({ task: 'Temperatura: Cámara', what: '1 de 2 controles' });
    expect(missingLabel({ kind: 'limpieza', id: 'y', name: 'Diaria', expected: 1, done: 0, partial: true, frequency: 'daily' }).what).toBe('Solo una limpieza parcial: falta completarla');
    expect(missingLabel({ kind: 'personalizado', id: 'z', name: 'Cloro', expected: 1, done: 0, frequency: 'weekly' }).what).toBe('Sin registrar en toda la semana');
    const data: Compliance = {
      from: '2026-11-09',
      to: '2026-11-10',
      days: [
        { date: '2026-11-09', expected: 3, done: 2, percent: 67, missing: [{ kind: 'temperatura', id: 'x', name: 'Cámara', expected: 2, done: 1, frequency: 'daily' }] },
        { date: '2026-11-10', expected: 3, done: 3, percent: 100, missing: [] },
      ],
      overall: { expected: 6, done: 5, percent: 83 },
    };
    render(<MissingByDay data={data} />);
    const list = screen.getByTestId('missing-days');
    expect(within(list).getAllByRole('listitem').filter((li) => li.parentElement === list)).toHaveLength(1);
    expect(within(list).getByText(/lunes, 9 de noviembre/i)).toBeInTheDocument();
    expect(within(list).getByText('Temperatura: Cámara')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Servidor simulado de la demo (mismas reglas que el servidor)
// ---------------------------------------------------------------------------
const get = <T,>(url: string, headers?: HeadersInit) => handle('GET', url, { headers }) as { status: number; json: T };
const send = <T,>(method: string, url: string, body?: unknown, headers?: HeadersInit) =>
  handle(method, url, { body: body === undefined ? undefined : JSON.stringify(body), headers }) as { status: number; json: T };

describe('demo: fase 2', () => {
  let orgId = '';
  beforeEach(() => {
    resetDb();
    orgId = get<Account>('/api/account').json.organizations[0]!.id;
  });

  it('el seed trae datos del establecimiento, registros nuevos, verificaciones y un enfriamiento en curso o cerrados', () => {
    const org = get<{ organization: Organization }>(`/api/orgs/${orgId}`).json.organization;
    expect(org.establishment).toMatchObject({ legalName: 'Restauración La Demo S.L.', taxId: 'B12345674', sanitaryRegistry: '26.012345/M', sanitaryRegistryFormatOk: true });
    const recs = get<{ items: AppRecord[] }>(`/api/orgs/${orgId}/records?limit=200&type=enfriamiento`).json.items;
    expect(recs.some((r) => r.type === 'enfriamiento' && r.data.phase === 'fin')).toBe(true);
    expect(get<{ items: AppRecord[] }>(`/api/orgs/${orgId}/records?limit=5&type=cocinado`).json.items.length).toBeGreaterThan(0);
    expect(get<{ items: AppRecord[] }>(`/api/orgs/${orgId}/records?limit=5&type=personalizado`).json.items.length).toBeGreaterThan(0);
    const today = get<TodayTasks>(`/api/orgs/${orgId}/tasks/today`).json;
    expect(today.custom?.map((c) => c.name)).toContain('Cloro libre del agua');
    expect(today.review).toMatchObject({ due: true, verified: false });
  });

  it('enfriamiento: inicio, en curso en Hoy, cierre enlazado y un solo cierre', () => {
    const s = send<{ record: AppRecord }>('POST', `/api/orgs/${orgId}/records`, { type: 'enfriamiento', data: { phase: 'inicio', product: 'Crema', startTemp: 80 } });
    expect(s.status).toBe(201);
    expect(get<TodayTasks>(`/api/orgs/${orgId}/tasks/today`).json.coolings?.some((c) => c.recordId === s.json.record.id)).toBe(true);
    const c = send<{ record: AppRecord }>('POST', `/api/orgs/${orgId}/records`, { type: 'enfriamiento', data: { phase: 'fin', startRecordId: s.json.record.id, endTemp: 5 } });
    expect(c.status).toBe(201);
    expect(c.json.record.data).toMatchObject({ phase: 'fin', product: 'Crema', startTemp: 80, endTemp: 5, minutes: 0 });
    expect(get<TodayTasks>(`/api/orgs/${orgId}/tasks/today`).json.coolings?.some((x) => x.recordId === s.json.record.id)).toBe(false);
    expect(send('POST', `/api/orgs/${orgId}/records`, { type: 'enfriamiento', data: { phase: 'fin', startRecordId: s.json.record.id, endTemp: 5 } }).status).toBe(409);
  });

  it('plantillas: sugerida con un toque, registro con alerta y huecos en el cumplimiento', () => {
    const t = send<{ template: CustomTemplate }>('POST', `/api/orgs/${orgId}/custom-templates/suggestions`, { key: 'mantenimiento' });
    expect(t.status).toBe(201);
    const items = t.json.template.items.map((i, n) => ({ itemId: i.id, ok: n > 0 }));
    const bad = send<{ error: { details: { path: string }[] } }>('POST', `/api/orgs/${orgId}/records`, { type: 'personalizado', data: { templateId: t.json.template.id, items } });
    expect(bad.json.error.details[0]!.path).toBe('data.correctiveAction');
    const ok = send<{ record: AppRecord }>('POST', `/api/orgs/${orgId}/records`, { type: 'personalizado', data: { templateId: t.json.template.id, items, correctiveAction: 'Avisado el técnico' } });
    expect(ok.json.record.alert).toBe(true);
    const from = new Date(Date.now() - 20 * 86_400_000).toISOString().slice(0, 10);
    const comp = get<Compliance>(`/api/orgs/${orgId}/tasks/compliance?from=${from}&to=${new Date().toISOString().slice(0, 10)}`).json;
    expect(comp.days.some((d) => (d.missing ?? []).length > 0)).toBe(true);
  });

  it('verificación: se añade, no se puede poner fecha futura, y Hoy deja de avisar', () => {
    const t = get<TodayTasks>(`/api/orgs/${orgId}/tasks/today`).json.review!;
    expect(send('POST', `/api/orgs/${orgId}/verifications`, { from: t.from, to: '2100-01-01', kind: 'custom' }).status).toBe(400);
    const v = send<{ verification: Verification }>('POST', `/api/orgs/${orgId}/verifications`, { from: t.from, to: t.to, kind: 'week', comment: 'Todo bien' });
    expect(v.status).toBe(201);
    expect(v.json.verification).toMatchObject({ kind: 'week', comment: 'Todo bien', user: { role: 'owner' } });
    expect(get<TodayTasks>(`/api/orgs/${orgId}/tasks/today`).json.review?.verified).toBe(true);
    expect(get<{ items: Verification[] }>(`/api/orgs/${orgId}/verifications?from=${t.from}&to=${t.to}`).json.items).toHaveLength(1);
  });

  it('datos del establecimiento: NIF con letra de control y RGSEAA con aviso', () => {
    expect(send('PATCH', `/api/orgs/${orgId}`, { taxId: '12345678A' }).status).toBe(400);
    const r = send<{ organization: Organization }>('PATCH', `/api/orgs/${orgId}`, { taxId: '12345678z', sanitaryRegistry: 'AUT-123' });
    expect(r.json.organization.establishment).toMatchObject({ taxId: '12345678Z', sanitaryRegistryFormatOk: false });
  });

  it('el proveedor escrito a mano se reconoce sin tildes, con espacios dobles y puntuación', () => {
    expect(supplierKey('  FRÍO  Norte. ')).toBe(supplierKey('frio norte'));
    expect(supplierKey('Frío Norteño')).not.toBe(supplierKey('Frío Norte'));
  });
});
