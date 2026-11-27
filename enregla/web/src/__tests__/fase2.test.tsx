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
import { periodDueText } from '@/lib/format';
import { handle } from '@/demo/server';
import { resetDb } from '@/demo/server/store';
import { supplierKey } from '@/demo/server/records';
import type { Account, AppRecord, Compliance, CustomTemplate, Organization, TodayTasks, Verification, VerificationSnapshot } from '@/api/types';

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
    expect(onStart).toHaveBeenCalledWith({ phase: 'inicio', product: 'Caldo', startTemp: 75, startReason: null, notes: null });
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
    // H-A2: mientras la semana no termina, «pendiente»; terminada, «no consta».
    expect(missingLabel({ kind: 'personalizado', id: 'z', name: 'Cloro', expected: 1, done: 0, frequency: 'weekly', pending: true, periodEnd: '2026-11-15' }).what).toBe('Pendiente esta semana');
    expect(missingLabel({ kind: 'personalizado', id: 'z', name: 'Cloro', expected: 1, done: 0, frequency: 'weekly', pending: false, periodEnd: '2026-11-08' }).what).toBe('No consta en toda la semana (hasta el 8 de noviembre)');
    expect(missingLabel({ kind: 'limpieza', id: 'm', name: 'Mensual', expected: 1, done: 0, frequency: 'monthly', pending: true, periodEnd: '2026-11-30' }).what).toBe('Pendiente este mes');
    // H-A3: un enfriamiento sin cerrar sale como tarea sin registrar.
    expect(missingLabel({ kind: 'enfriamiento', id: 'c', name: 'Arroz', expected: 1, done: 0, frequency: 'once', pending: false })).toEqual({ task: 'Enfriamiento: Arroz', what: 'Sin cerrar: no consta el final ni la temperatura alcanzada' });
    expect(missingLabel({ kind: 'temperatura', id: 'x', name: 'Cámara', expected: 2, done: 1, frequency: 'daily', pending: true }).what).toBe('1 de 2 controles (pendiente: el día aún no ha terminado)');
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

describe('evaluación de la fase 2 (interfaz)', () => {
  it('H-A1: cocinado a 70 °C por defecto y 75 °C si lleva huevo fresco', async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(<CocinadoForm ctx={ctx} onSubmit={onSubmit} />);
    await user.type(screen.getByLabelText('Producto'), 'Tortilla');
    await user.click(screen.getByText('Cocinado'));
    expect(screen.getByText(/Valor de referencia orientativo: 70 °C o más/)).toBeInTheDocument();
    await user.type(screen.getByLabelText(/Temperatura en el centro del producto/), '72');
    expect(screen.getByText('72 °C: alcanza la referencia')).toBeInTheDocument();
    await user.click(screen.getByLabelText(/Lleva huevo fresco/));
    expect(screen.getByText('72 °C: no llega a 75 °C')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Producto desechado' }));
    await user.click(screen.getByRole('button', { name: 'Guardar con acción correctora' }));
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ freshEgg: true, coreTemp: 72, correctiveAction: 'Producto desechado' }));
  });

  it('H-M3: un enfriamiento que empieza por debajo de 60 °C pide el motivo', async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(<EnfriamientoForm ctx={ctx} onSubmit={onSubmit} />);
    await user.type(screen.getByLabelText('Producto'), 'Arroz');
    await user.type(screen.getByLabelText(/Temperatura al empezar/), '50');
    expect(screen.getByText('50 °C: por debajo de 60 °C')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Empezar el enfriamiento' }));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText('Empieza por debajo de 60 °C: indica el motivo')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Ya venía templado' }));
    await user.click(screen.getByRole('button', { name: 'Empezar el enfriamiento' }));
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ startTemp: 50, startReason: 'Ya venía templado' }));
  });

  it('tablet: el registro personalizado se elige con botones grandes, no con un desplegable', () => {
    render(<PersonalizadoForm ctx={ctx} onSubmit={vi.fn()} large />);
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(screen.getByRole('group', { name: '¿Qué registro?' })).toBeInTheDocument();
    expect(screen.getAllByText('Diario').length).toBeGreaterThan(0);
  });

  it('H-A2: «toca el jueves» y «tocaba el lunes» para las semanales', () => {
    // 2026-11-10 es martes.
    expect(periodDueText('weekly', '2026-11-12', '2026-11-10')).toBe('Toca el jueves (cuenta si se hace cualquier día de esta semana)');
    expect(periodDueText('weekly', '2026-11-09', '2026-11-10')).toBe('Tocaba el lunes: aún a tiempo esta semana');
    expect(periodDueText('monthly', '2026-11-10', '2026-11-10')).toBe('Toca hoy (cuenta si se hace este mes)');
    expect(periodDueText('monthly', '2026-11-20', '2026-11-10')).toBe('Toca el día 20 (cuenta si se hace cualquier día de este mes)');
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

  it('evaluación: hoy no se verifica, la vista previa se guarda como foto y el enfriamiento sin cerrar es un hueco', () => {
    const tz = 'Europe/Madrid';
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date());
    const t = get<TodayTasks>(`/api/orgs/${orgId}/tasks/today`).json.review!;
    expect(send('POST', `/api/orgs/${orgId}/verifications`, { from: t.from, to: today, kind: 'custom' }).status).toBe(400);
    const prev = get<VerificationSnapshot>(`/api/orgs/${orgId}/verifications/preview?from=${t.from}&to=${t.to}`).json;
    expect(prev.records).toBeGreaterThan(0);
    const v = send<{ verification: Verification }>('POST', `/api/orgs/${orgId}/verifications`, { from: t.from, to: t.to, kind: 'week' });
    expect(v.json.verification.snapshot).toEqual(prev);
    // Las del seed también llevan su foto.
    expect(get<{ items: Verification[] }>(`/api/orgs/${orgId}/verifications?from=2000-01-01&to=${today}`).json.items.every((x) => x.snapshot != null)).toBe(true);
  });

  it('evaluación: cocinado a 70/75 °C, motivo bajo 60 °C y cierre justo en el máximo fuera de tiempo', () => {
    const low = send<{ error: { details: { path: string; message: string }[] } }>('POST', `/api/orgs/${orgId}/records`, { type: 'cocinado', data: { product: 'Pollo', process: 'cocinado', coreTemp: 66 } });
    expect(low.json.error.details[0]!.message).toMatch(/70 °C/);
    const egg = send<{ record: AppRecord }>('POST', `/api/orgs/${orgId}/records`, { type: 'cocinado', data: { product: 'Tortilla', process: 'cocinado', freshEgg: true, coreTemp: 76 } });
    expect(egg.json.record.data).toMatchObject({ referenceTemp: 75, freshEgg: true, outOfRange: false });
    const cold = send<{ error: { details: { path: string }[] } }>('POST', `/api/orgs/${orgId}/records`, { type: 'enfriamiento', data: { phase: 'inicio', product: 'Arroz', startTemp: 50 } });
    expect(cold.json.error.details[0]!.path).toBe('data.startReason');
    const okCold = send<{ record: AppRecord }>('POST', `/api/orgs/${orgId}/records`, { type: 'enfriamiento', data: { phase: 'inicio', product: 'Arroz', startTemp: 50, startReason: 'Ya venía templado' } });
    expect(okCold.json.record.data).toMatchObject({ belowStartReference: true, startReferenceTemp: 60, startReason: 'Ya venía templado' });
  });

  it('evaluación: semanal hecha más tarde en la semana cuenta; Hoy la muestra todo el periodo', () => {
    const today = get<TodayTasks>(`/api/orgs/${orgId}/tasks/today`).json;
    const weekly = today.cleaning.filter((c) => c.frequency === 'weekly');
    expect(weekly.length).toBeGreaterThan(0);
    for (const w of weekly) expect(w.dueDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const from = new Date(Date.now() - 20 * 86_400_000).toISOString().slice(0, 10);
    const comp = get<Compliance>(`/api/orgs/${orgId}/tasks/compliance?from=${from}&to=${today.date}`).json;
    const all = comp.days.flatMap((d) => d.missing ?? []);
    expect(all.every((m) => typeof m.pending === 'boolean')).toBe(true);
    // Nada «no consta» de un periodo que aún no ha terminado.
    expect(all.filter((m) => (m.frequency === 'weekly' || m.frequency === 'monthly') && !m.pending).every((m) => m.periodEnd! < today.date)).toBe(true);
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
