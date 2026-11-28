/**
 * Segunda evaluación de la fase 1 en la interfaz: «¿Eres Ana?» tras 20 s sin tocar la tablet, botón
 * «He terminado», «Corregir» pide el PIN antes de abrir el formulario, motivo para «ambiente» cuando el
 * proveedor suele traer frío o caliente, y el aviso «Ya toca volver a medir» (#14).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router';
import { RecepcionForm, type FormContext } from '@/features/RecordForms';
import { KioskPage, CONFIRM_ARM_MS, CONFIRM_MS, IDLE_MS, RESULT_MS } from '@/pages/kiosk/Kiosk';
import { remeasureDue } from '@/hooks/useNow';
import { storage } from '@/lib/storage';
import { handle, toResponse } from '@/demo/server';
import { getDb, resetDb } from '@/demo/server/store';

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

function renderKiosk() {
  resetDb();
  const db = getDb();
  const org = db.orgs[0]!;
  const token = 'kd_' + 'U'.repeat(43);
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
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { db, calls };
}

async function typeDigits(user: ReturnType<typeof userEvent.setup>, digits: string) {
  for (const d of digits) await user.click(screen.getByRole('button', { name: d }));
}

async function saveTemperature(user: ReturnType<typeof userEvent.setup>, who: RegExp, digits: string, pin?: string) {
  await user.click(await screen.findByRole('button', { name: 'Temperatura' }));
  await user.click(await screen.findByRole('button', { name: who }));
  if (pin) {
    await typeDigits(user, pin);
    await user.click(screen.getByRole('button', { name: 'Entrar' }));
  }
  await user.click(await screen.findByRole('button', { name: /Cámara de carnes/ }));
  await typeDigits(user, digits);
  await user.click(screen.getByRole('button', { name: 'Guardar' }));
  return screen.findByTestId('kiosk-result');
}

describe('N4: tablet, persona que firma', () => {
  it('tras 20 s sin tocar, pantalla completa «¿Eres Luis?»: «Sí» sigue con un toque y «No» pregunta quién es', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderKiosk();
    await saveTemperature(user, /Luis Pérez/, '2');
    await act(async () => {
      vi.advanceTimersByTime(RESULT_MS + 500);
    });
    await screen.findByRole('heading', { name: '¿Qué equipo?' });
    // Antes de los 20 s no pregunta nada.
    await act(async () => {
      vi.advanceTimersByTime(CONFIRM_MS - RESULT_MS - 2_000);
    });
    expect(screen.queryByTestId('kiosk-confirm-person')).toBeNull();
    await act(async () => {
      vi.advanceTimersByTime(3_000);
    });
    const overlay = screen.getByTestId('kiosk-confirm-person');
    expect(overlay).toHaveAttribute('aria-modal', 'true');
    expect(within(overlay).getByRole('heading', { name: '¿Eres Luis Pérez?' })).toBeInTheDocument();
    // R5: al aparecer, los toques no cuentan (botones inactivos); y la zona central (donde estaban los
    // equipos) es neutra.
    expect(within(overlay).getByRole('button', { name: 'Sí, soy Luis Pérez' })).toBeDisabled();
    await user.click(within(overlay).getByRole('button', { name: 'Sí, soy Luis Pérez' }));
    expect(screen.getByTestId('kiosk-confirm-person')).toBeInTheDocument();
    await act(async () => {
      vi.advanceTimersByTime(CONFIRM_ARM_MS + 50);
    });
    await user.click(screen.getByTestId('kiosk-confirm-neutral'));
    expect(screen.getByTestId('kiosk-confirm-person')).toBeInTheDocument();
    await user.click(within(overlay).getByRole('button', { name: 'Sí, soy Luis Pérez' }));
    expect(screen.queryByTestId('kiosk-confirm-person')).toBeNull();
    expect(screen.getByTestId('kiosk-signing-as')).toHaveTextContent('Registrando como Luis Pérez');
    expect(screen.getByRole('heading', { name: '¿Qué equipo?' })).toBeInTheDocument();
    // Otra pausa de 25 s: ahora es otra persona.
    await act(async () => {
      vi.advanceTimersByTime(25_000);
    });
    await act(async () => {
      vi.advanceTimersByTime(CONFIRM_ARM_MS + 50);
    });
    await user.click(within(screen.getByTestId('kiosk-confirm-person')).getByRole('button', { name: 'No, soy otra persona' }));
    expect(screen.queryByTestId('kiosk-signing-as')).toBeNull();
    expect(await screen.findByRole('heading', { name: '¿Quién eres?' })).toBeInTheDocument();
  });

  it('a los 60 s se olvida a la persona como antes (también con la pregunta en pantalla)', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderKiosk();
    await saveTemperature(user, /Luis Pérez/, '2');
    await act(async () => {
      vi.advanceTimersByTime(IDLE_MS + 1_000);
    });
    expect(screen.queryByTestId('kiosk-confirm-person')).toBeNull();
    expect(screen.queryByTestId('kiosk-signing-as')).toBeNull();
  });

  it('«He terminado» en la franja olvida a la persona y vuelve al inicio', async () => {
    const user = userEvent.setup();
    renderKiosk();
    await saveTemperature(user, /Luis Pérez/, '2');
    const bar = screen.getByTestId('kiosk-signing-as');
    await user.click(within(bar).getByRole('button', { name: 'He terminado' }));
    expect(screen.queryByTestId('kiosk-signing-as')).toBeNull();
    expect(await screen.findByRole('button', { name: /¿Quién eres\?/ })).toBeInTheDocument();
  });

  it('«Corregir» pide el PIN de Ana ANTES de abrir el formulario y lo comprueba el servidor', async () => {
    const user = userEvent.setup();
    const { db, calls } = renderKiosk();
    await saveTemperature(user, /Ana Martín/, '2', '1234');
    const original = db.records[db.records.length - 1]!;
    calls.length = 0;
    await user.click(screen.getByRole('button', { name: 'Corregir este registro' }));
    // Primero el PIN: todavía no se ven los motivos.
    expect(screen.getByRole('heading', { name: '¿Eres Ana Martín?' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Me equivoqué de número' })).toBeNull();
    await typeDigits(user, '0000');
    await user.click(screen.getByRole('button', { name: 'Corregir' }));
    expect(await screen.findByText('PIN incorrecto. Prueba otra vez.')).toBeInTheDocument();
    expect(calls.some((c) => c.includes('/api/kiosk/verify-pin'))).toBe(true);
    expect(screen.queryByRole('button', { name: 'Me equivoqué de número' })).toBeNull();
    await typeDigits(user, '1234');
    await user.click(screen.getByRole('button', { name: 'Corregir' }));
    await user.click(await screen.findByRole('button', { name: 'Me equivoqué de número' }));
    await typeDigits(user, '3');
    // No vuelve a pedir el PIN: «Guardar corrección» directamente.
    await user.click(screen.getByRole('button', { name: 'Guardar corrección' }));
    expect(await screen.findByTestId('kiosk-result')).toHaveTextContent('Corrección guardada');
    const amended = db.records[db.records.length - 1]!;
    expect(amended).toMatchObject({ amendsRecordId: original.id, staffName: 'Ana Martín' });
    expect(amended.data.value).toBe(3);
  });
});

describe('N9: recepción «ambiente» de un proveedor de frío', () => {
  const SUP = '33333333-3333-4333-8333-333333333333';
  const ctx: FormContext = {
    equipment: [],
    cleaningPlans: [],
    suppliers: [{ id: SUP, name: 'Pescados del Puerto', products: ['Merluza'], defaultCategory: 'refrigerado' }],
    staff: [],
    timezone: 'Europe/Madrid',
  };
  it('pide el motivo y lo envía', async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(<RecepcionForm ctx={ctx} onSubmit={onSubmit} />);
    await user.selectOptions(screen.getByLabelText('Proveedor'), SUP);
    await user.type(screen.getByLabelText('Producto'), 'Conservas');
    expect(screen.queryByLabelText(/¿Por qué es ambiente\?/)).toBeNull();
    await user.click(screen.getByRole('radio', { name: /Ambiente/ }));
    const reason = screen.getByLabelText(/¿Por qué es ambiente\?/);
    expect(screen.getByText(/Pescados del Puerto suele traer producto refrigerado/)).toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: 'Sí, aceptada' }));
    await user.click(screen.getByRole('button', { name: /Guardar/ }));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText('Explica por qué lo registras como ambiente')).toBeInTheDocument();
    await user.type(reason, 'Hoy trae latas');
    await user.click(screen.getByRole('button', { name: /Guardar/ }));
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ category: 'ambiente', categoryReason: 'Hoy trae latas' }));
  });
});

describe('#14: «Ya toca volver a medir»', () => {
  it('solo cuando ha llegado la hora indicada', () => {
    const now = Date.parse('2026-11-26T10:30:00Z');
    expect(remeasureDue({ remeasure: true, remeasureFrom: '2026-11-26T10:45:00Z' }, now)).toBe(false);
    expect(remeasureDue({ remeasure: true, remeasureFrom: '2026-11-26T10:30:00Z' }, now)).toBe(true);
    expect(remeasureDue({ remeasure: true, remeasureFrom: null }, now)).toBe(true);
    expect(remeasureDue({ remeasure: false, remeasureFrom: '2026-11-26T10:00:00Z' }, now)).toBe(false);
  });
});
