/**
 * Fase 1 (integridad y seguridad alimentaria) en la interfaz: botón «±» de temperatura, varias acciones
 * correctoras, tipo de producto en la recepción, firma «anotado por», carta pública neutra, PIN por
 * defecto y, en el modo cocina (contra el servidor simulado de la demo): «Seguir como Ana» durante
 * 15 s, «Corregir» el registro recién hecho, salir con contraseña de encargado y «No estoy en la lista».
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router';
import { recordSignature } from '@shared/schemas';
import { RecepcionForm, TemperaturaForm, type FormContext } from '@/features/RecordForms';
import { EquipmentDialog, StaffDialog } from '@/features/ConfigForms';
import { corrector, signer } from '@/features/recordMeta';
import { toggleTemperatureSign } from '@/components/ui/TemperatureInput';
import { PublicMenuPage } from '@/pages/public/PublicMenu';
import { KioskPage, CONTINUE_SECONDS } from '@/pages/kiosk/Kiosk';
import { storage } from '@/lib/storage';
import { handle, toResponse } from '@/demo/server';
import { getDb, resetDb } from '@/demo/server/store';
import type { AppRecord, PublicMenu } from '@/api/types';

const EQ = '11111111-1111-4111-8111-111111111111';
const FREEZER = '22222222-2222-4222-8222-222222222222';
const SUP = '33333333-3333-4333-8333-333333333333';
const ctx: FormContext = {
  equipment: [
    { id: EQ, name: 'Cámara', type: 'camara', minTemp: null, maxTemp: 4 },
    { id: FREEZER, name: 'Congelador', type: 'congelador', minTemp: null, maxTemp: -18 },
  ],
  cleaningPlans: [],
  suppliers: [{ id: SUP, name: 'Pescados del Puerto', products: ['Merluza'], defaultCategory: 'refrigerado' }],
  staff: [{ id: '44444444-4444-4444-8444-444444444444', name: 'Ana' }],
  timezone: 'Europe/Madrid',
};

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

describe('1.9 temperaturas negativas sin tecla «−» (iPhone)', () => {
  it('el botón «±» cambia el signo y el registro se envía con −20', async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(<TemperaturaForm ctx={ctx} preset={{ equipmentId: FREEZER }} onSubmit={onSubmit} />);
    const input = screen.getByLabelText('Temperatura (°C)');
    expect(input).toHaveAttribute('inputmode', 'decimal');
    await user.type(input, '20');
    await user.click(screen.getByRole('button', { name: /Poner signo menos/ }));
    expect(input).toHaveValue('−20');
    expect(screen.getByRole('button', { name: /Quitar el signo menos/ })).toHaveAttribute('aria-pressed', 'true');
    await user.click(screen.getByRole('button', { name: /Guardar temperatura/ }));
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ equipmentId: FREEZER, value: -20 }));
  });

  it('también en la recepción (temperatura y límite) y en los límites de los equipos', async () => {
    const user = userEvent.setup();
    render(<RecepcionForm ctx={ctx} onSubmit={() => undefined} />);
    await user.click(screen.getByRole('radio', { name: /Congelado/ }));
    const signs = screen.getAllByRole('button', { name: /signo menos/ });
    expect(signs).toHaveLength(2);
    await user.type(screen.getByLabelText(/Temperatura al recibir/), '15');
    await user.click(signs[0]!);
    expect(screen.getByLabelText(/Temperatura al recibir/)).toHaveValue('−15');
    // −15 °C supera la máxima de congelado (−18 °C).
    expect(screen.getByText(/−15 °C está fuera del límite \(máx\. −18 °C\)/)).toBeInTheDocument();
  });

  it('formulario de equipo: mínima y máxima con «±»', async () => {
    const user = userEvent.setup();
    render(<EquipmentDialog orgId="o" open onClose={() => undefined} onSaved={() => undefined} />);
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getAllByRole('button', { name: /signo menos/ })).toHaveLength(2);
    const max = within(dialog).getByLabelText(/Máxima/);
    await user.clear(max);
    await user.type(max, '18');
    await user.click(within(dialog).getAllByRole('button', { name: /signo menos/ })[1]!);
    expect(max).toHaveValue('−18');
  });

  it('toggleTemperatureSign', () => {
    expect(toggleTemperatureSign('3,5')).toBe('−3,5');
    expect(toggleTemperatureSign('−3,5')).toBe('3,5');
    expect(toggleTemperatureSign('-3')).toBe('3');
    expect(toggleTemperatureSign('')).toBe('−');
  });
});

describe('1.12 varias acciones correctoras', () => {
  it('se pueden marcar varias acciones rápidas además del texto libre', async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(<TemperaturaForm ctx={ctx} preset={{ equipmentId: EQ }} onSubmit={onSubmit} />);
    await user.type(screen.getByLabelText('Temperatura (°C)'), '9');
    await user.click(screen.getByRole('button', { name: 'Puerta cerrada y revisada' }));
    await user.click(screen.getByRole('button', { name: 'Repetiré la medición en 30 min' }));
    expect(screen.getByRole('button', { name: 'Puerta cerrada y revisada' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Repetiré la medición en 30 min' })).toHaveAttribute('aria-pressed', 'true');
    await user.click(screen.getByRole('button', { name: /Guardar con acción correctora/ }));
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ value: 9, correctiveAction: 'Puerta cerrada y revisada; Repetiré la medición en 30 min' }));
  });
});

describe('1.6 recepción: tipo de producto obligatorio y límite por defecto', () => {
  it('sin tipo no se guarda; el proveedor preselecciona el suyo; 6 °C refrigerado exige acción', async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(<RecepcionForm ctx={{ ...ctx, suppliers: [{ id: SUP, name: 'Otro', products: [] }] }} onSubmit={onSubmit} />);
    await user.selectOptions(screen.getByLabelText('Proveedor'), 'Otro');
    await user.type(screen.getByLabelText('Producto'), 'Merluza');
    await user.click(screen.getByText('Sí, aceptada'));
    await user.click(screen.getByRole('button', { name: 'Guardar registro' }));
    expect(screen.getByText('Elige el tipo de producto: fija la temperatura límite')).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('la categoría habitual del proveedor fija 4 °C y 6 °C pide qué se ha hecho', async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(<RecepcionForm ctx={ctx} onSubmit={onSubmit} />);
    await user.selectOptions(screen.getByLabelText('Proveedor'), 'Pescados del Puerto');
    expect(screen.getByRole('radio', { name: /Refrigerado/ })).toBeChecked();
    expect(screen.getByLabelText(/Temperatura máxima admisible/)).toHaveValue('4');
    await user.type(screen.getByLabelText('Producto'), 'Merluza');
    await user.type(screen.getByLabelText(/Temperatura al recibir/), '6');
    expect(screen.getByText(/6 °C está fuera del límite \(máx\. 4 °C\)/)).toBeInTheDocument();
    await user.click(screen.getByText('Sí, aceptarla con motivo'));
    await user.click(screen.getByRole('button', { name: 'Guardar registro' }));
    expect(onSubmit).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Se usa de inmediato' }));
    await user.click(screen.getByRole('button', { name: 'Guardar registro' }));
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ category: 'refrigerado', temperature: 6, maxTemperature: 4, correctiveAction: 'Se usa de inmediato' }));
  });

  it('caliente: límite mínimo de 63 °C', async () => {
    const user = userEvent.setup();
    render(<RecepcionForm ctx={ctx} onSubmit={() => undefined} />);
    await user.click(screen.getByRole('radio', { name: /Caliente/ }));
    expect(screen.getByLabelText(/Temperatura mínima admisible/)).toHaveValue('63');
    await user.type(screen.getByLabelText(/Temperatura al recibir/), '58');
    expect(screen.getByText(/58 °C está fuera del límite \(mín\. 63 °C\)/)).toBeInTheDocument();
  });
});

describe('1.1 / 1.2 firma y autor de la corrección en la app', () => {
  const base = { id: 'r', type: 'plagas', data: { result: 'sin_indicios', description: null, action: null }, alert: false, amendsRecordId: null, amendmentReason: null, amendedByRecordId: null, effectiveAt: '', createdAt: '' } as const;
  it('«Ana (anotado por Laura)», el empleado desde la tablet y el usuario si no indicó a nadie', () => {
    expect(signer({ ...base, staff: { id: 's', name: 'Ana' }, user: { id: 'u', name: 'Laura' }, deviceId: null } as AppRecord)).toBe('Ana (anotado por Laura)');
    expect(signer({ ...base, staff: { id: 's', name: 'Ana' }, user: null, deviceId: 'd' } as AppRecord)).toBe('Ana');
    expect(signer({ ...base, staff: null, user: { id: 'u', name: 'Laura' }, deviceId: null } as AppRecord)).toBe('Laura');
    expect(recordSignature({ staffName: 'Ana', userName: 'Laura' })).toBe('Ana (anotado por Laura)');
  });
  it('en una corrección web, corrige el usuario aunque firme el empleado', () => {
    const am = { ...base, amendsRecordId: 'o', amendmentReason: 'x', staff: { id: 's', name: 'Luis' }, user: { id: 'u', name: 'Laura' }, deviceId: null } as AppRecord;
    expect(signer(am)).toBe('Luis');
    expect(corrector(am)).toBe('Laura');
  });
});

describe('1.4 PIN propuesto por defecto al dar de alta personal', () => {
  it('la casilla viene marcada con su explicación y sin PIN no deja guardar salvo que se desmarque', async () => {
    const post = vi.fn(async () => new Response(JSON.stringify({ staff: { id: 's', name: 'Pepe', hasPin: false, active: true, lockedUntil: null, createdAt: '' } }), { status: 201, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', post);
    const onSaved = vi.fn();
    const user = userEvent.setup();
    render(<StaffDialog orgId="o" open onClose={() => undefined} onSaved={onSaved} />);
    const box = screen.getByRole('checkbox', { name: /Proteger con PIN \(recomendado\)/ });
    expect(box).toBeChecked();
    expect(screen.getByText(/nadie puede firmar por otra persona/)).toBeInTheDocument();
    await user.type(screen.getByLabelText('Nombre'), 'Pepe');
    await user.click(screen.getByRole('button', { name: 'Guardar' }));
    expect(screen.getByText(/Escribe un PIN de 4 a 6 cifras/)).toBeInTheDocument();
    expect(post).not.toHaveBeenCalled();
    await user.click(box);
    await user.click(screen.getByRole('button', { name: 'Guardar' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    const body = JSON.parse(String((post.mock.calls[0] as unknown as [string, RequestInit])[1].body)) as Record<string, unknown>;
    expect(body).toEqual({ name: 'Pepe' });
  });
});

describe('1.7 carta pública: tono neutro', () => {
  it('un plato sin los alérgenos elegidos no lleva ✓ ni verde y pide confirmarlo con el personal', async () => {
    const menu: PublicMenu = {
      organization: { name: 'Bar' },
      allergens: [{ id: 'peanuts', label: 'Cacahuetes', name: 'Cacahuetes' }],
      statuses: { contains: 'Contiene', traces: 'Puede contener trazas', no: 'No contiene' },
      dishes: [{ name: 'Agua mineral', category: 'Bebidas', description: null, allergens: Object.fromEntries(['gluten', 'crustaceans', 'eggs', 'fish', 'peanuts', 'soybeans', 'milk', 'nuts', 'celery', 'mustard', 'sesame', 'sulphites', 'lupin', 'molluscs'].map((a) => [a, 'no'])) as PublicMenu['dishes'][number]['allergens'] }],
      updatedAt: null,
      notice: 'Consulta al personal.',
    };
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(menu), { status: 200, headers: { 'Content-Type': 'application/json' } })));
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/carta/abc']}>
        <Routes>
          <Route path="/carta/:slug" element={<PublicMenuPage />} />
        </Routes>
      </MemoryRouter>,
    );
    await screen.findByText('Agua mineral');
    await user.click(screen.getByRole('button', { name: /Cacahuetes/ }));
    const note = screen.getByTestId('not-declared-note');
    expect(note).toHaveTextContent('No se han declarado tus alérgenos en este plato. Confírmalo con el personal antes de pedir.');
    expect(note.className).not.toMatch(/ok/);
    expect(screen.queryByText(/No declara tus alérgenos/)).toBeNull();
    const card = screen.getByText('Agua mineral').closest('li')!;
    expect(card.className).not.toMatch(/border-ok/);
  });
});

// ---------------------------------------------------------------------------
// Modo cocina contra el servidor simulado de la demo (misma lógica que el servidor real)
// ---------------------------------------------------------------------------
function renderKiosk() {
  resetDb();
  const db = getDb();
  const org = db.orgs[0]!;
  const token = 'kd_' + 'T'.repeat(43);
  db.devices.push({ id: crypto.randomUUID(), orgId: org.id, name: 'Tablet test', token, createdBy: db.users[0]!.id, createdAt: Date.now(), lastUsedAt: null, revokedAt: null });
  storage.setKioskToken(token);
  const calls: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit = {}) => {
      const method = (init.method ?? 'GET').toUpperCase();
      calls.push(`${method} ${url}`);
      return toResponse(handle(method, url, { headers: init.headers, body: init.body }));
    }),
  );
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/cocina']}>
        <Routes>
          <Route path="/cocina" element={<KioskPage />} />
          <Route path="/entrar" element={<p>Pantalla de acceso</p>} />
          <Route path="/" element={<p>Portada comercial</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { db, org, calls };
}

async function saveTemperature(user: ReturnType<typeof userEvent.setup>, who: RegExp, digits: string) {
  await user.click(await screen.findByRole('button', { name: 'Temperatura', exact: true }));
  await user.click(await screen.findByRole('button', { name: who }));
  await user.click(await screen.findByRole('button', { name: /Cámara de carnes/ }));
  for (const d of digits) await user.click(screen.getByRole('button', { name: d, exact: true }));
  await user.click(screen.getByRole('button', { name: 'Guardar' }));
  return screen.findByTestId('kiosk-result');
}

describe('modo cocina', () => {
  it('1.4: «Guardado por Luis», cabecera «Registrando como» y vuelta a «¿Quién eres?» si no se pulsa «Seguir como»', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderKiosk();
    const result = await saveTemperature(user, /Luis Pérez/, '2');
    expect(within(result).getByTestId('kiosk-saved-by')).toHaveTextContent('Guardado por Luis Pérez');
    expect(within(result).getByRole('button', { name: /Seguir como Luis Pérez/ })).toBeInTheDocument();
    // «Seguir como»: se mantiene la persona y la cabecera lo dice en grande.
    await user.click(within(result).getByRole('button', { name: /Seguir como Luis Pérez/ }));
    expect(screen.getByTestId('kiosk-signing-as')).toHaveTextContent('Registrando como Luis Pérez');
    expect(screen.getByRole('button', { name: '¿No eres Luis Pérez?' })).toBeInTheDocument();
    // Otro registro y, esta vez, nadie toca nada: a los 15 s se olvida a la persona.
    await user.click(screen.getByRole('button', { name: 'Temperatura', exact: true }));
    await user.click(await screen.findByRole('button', { name: /Cámara de carnes/ }));
    await user.click(screen.getByRole('button', { name: '3', exact: true }));
    await user.click(screen.getByRole('button', { name: 'Guardar' }));
    await screen.findByTestId('kiosk-result');
    await act(async () => {
      vi.advanceTimersByTime((CONTINUE_SECONDS + 1) * 1000);
    });
    expect(await screen.findByRole('heading', { name: '¿Quién eres?' })).toBeInTheDocument();
    expect(screen.queryByTestId('kiosk-signing-as')).toBeNull();
  });

  it('1.5: corregir el número recién tecleado en la tablet', async () => {
    const user = userEvent.setup();
    const { db } = renderKiosk();
    await saveTemperature(user, /Luis Pérez/, '2');
    const original = db.records[db.records.length - 1]!;
    await user.click(screen.getByRole('button', { name: 'Corregir este registro' }));
    await user.click(screen.getByRole('button', { name: 'Me equivoqué de número' }));
    await user.click(screen.getByRole('button', { name: '3', exact: true }));
    await user.click(screen.getByRole('button', { name: 'Guardar corrección' }));
    const res = await screen.findByTestId('kiosk-result');
    expect(res).toHaveTextContent('Corrección guardada');
    const amended = db.records[db.records.length - 1]!;
    expect(amended).toMatchObject({ amendsRecordId: original.id, amendmentReason: 'Me equivoqué de número', staffName: 'Luis Pérez', userId: null });
    expect(amended.data.value).toBe(3);
    expect(db.records.find((r) => r.id === original.id)!.data.value).toBe(2);
  });

  it('1.5: «Me equivoqué de persona» pide el PIN de la persona correcta', async () => {
    const user = userEvent.setup();
    const { db } = renderKiosk();
    await saveTemperature(user, /Luis Pérez/, '2');
    await user.click(screen.getByRole('button', { name: 'Corregir este registro' }));
    await user.click(screen.getByRole('button', { name: 'Me equivoqué de persona' }));
    await user.click(await screen.findByRole('button', { name: /Marta Gil/ }));
    for (const d of '0000') await user.click(screen.getByRole('button', { name: d, exact: true }));
    await user.click(screen.getByRole('button', { name: 'Guardar corrección' }));
    expect(await screen.findByText('PIN incorrecto. Prueba otra vez.')).toBeInTheDocument();
    for (const d of '5678') await user.click(screen.getByRole('button', { name: d, exact: true }));
    await user.click(screen.getByRole('button', { name: 'Guardar corrección' }));
    expect(await screen.findByTestId('kiosk-result')).toHaveTextContent('Firma: Marta Gil');
    expect(db.records[db.records.length - 1]!).toMatchObject({ staffName: 'Marta Gil', amendmentReason: 'Me equivoqué de persona (figuraba Luis Pérez)' });
  });

  it('1.10: salir pide la contraseña de un responsable y lleva a una pantalla neutra, no a la portada', async () => {
    const user = userEvent.setup();
    renderKiosk();
    await user.click(await screen.findByRole('button', { name: /Salir del modo cocina/ }));
    await user.type(screen.getByLabelText(/Email del propietario o encargado/), 'demo@example.com');
    await user.type(screen.getByLabelText('Contraseña'), 'incorrecta');
    await user.click(screen.getByRole('button', { name: 'Salir del modo cocina' }));
    expect(await screen.findByText(/Email o contraseña incorrectos/)).toBeInTheDocument();
    await user.type(screen.getByLabelText('Contraseña'), 'Demo-EnRegla-2026');
    await user.click(screen.getByRole('button', { name: 'Salir del modo cocina' }));
    expect(await screen.findByTestId('kiosk-exited')).toBeInTheDocument();
    expect(screen.queryByText('Portada comercial')).toBeNull();
    expect(screen.getByRole('link', { name: /Entrar como encargado/ })).toHaveAttribute('href', '/entrar');
    await user.click(screen.getByRole('button', { name: 'Volver al modo cocina' }));
    expect(await screen.findByRole('heading', { name: 'Registrar' })).toBeInTheDocument();
  });

  it('1.10: desvincular revoca la tablet con la contraseña de un responsable', async () => {
    const user = userEvent.setup();
    const { db } = renderKiosk();
    await user.click(await screen.findByRole('button', { name: /Desvincular esta tablet/ }));
    await user.type(screen.getByLabelText(/Email del propietario o encargado/), 'demo@example.com');
    await user.type(screen.getByLabelText('Contraseña'), 'Demo-EnRegla-2026');
    await user.click(screen.getByRole('button', { name: 'Desvincular' }));
    expect(await screen.findByRole('heading', { name: 'Vincular esta tablet' })).toBeInTheDocument();
    expect(db.devices.find((d) => d.name === 'Tablet test')!.revokedAt).not.toBeNull();
    expect(storage.getKioskToken()).toBeNull();
  });

  it('1.11: «¿Quién eres?» vuelve a pedir la lista (aparece quien se acaba de dar de alta) y explica qué hacer si no estás', async () => {
    const user = userEvent.setup();
    const { db, org, calls } = renderKiosk();
    await screen.findByRole('heading', { name: 'Registrar' });
    // Alta en la web mientras la tablet ya estaba abierta.
    db.staff.push({ id: crypto.randomUUID(), orgId: org.id, name: 'Jonathan Nuevo', pin: null, active: true, failed: 0, lockedUntil: null, createdAt: Date.now() });
    const before = calls.filter((c) => c.endsWith('/api/kiosk/context')).length;
    await user.click(screen.getByRole('button', { name: /¿Quién eres\?/ }));
    expect(await screen.findByRole('button', { name: /Jonathan Nuevo/ })).toBeInTheDocument();
    expect(calls.filter((c) => c.endsWith('/api/kiosk/context')).length).toBeGreaterThan(before);
    await user.click(screen.getByRole('button', { name: 'No estoy en la lista' }));
    expect(screen.getByTestId('kiosk-not-listed')).toHaveTextContent('No registres con el nombre de otra persona');
    expect(screen.getByTestId('kiosk-not-listed')).toHaveTextContent('Ajustes → Personal');
  });
});
