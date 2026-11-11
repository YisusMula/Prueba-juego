/**
 * Ronda de correcciones previa al lanzamiento (frontend): validación en español, formatos,
 * idempotencia y timeouts, errores que se limpian, foco de diálogos, PIN numérico, temperaturas
 * imposibles, limpieza parcial, recepción y comprobación de datos legales del build.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { createOrgBody, temperaturaData } from '@shared/schemas';
import { api, ApiError } from '@/api/client';
import { Field, Input, PinInput } from '@/components/ui/Form';
import { Dialog } from '@/components/ui/Overlay';
import { LimpiezaForm, RecepcionForm, TemperaturaForm, type FormContext } from '@/features/RecordForms';
import { cleaningResult } from '@/features/recordMeta';
import { IdempotencyKeys, newIdempotencyKey } from '@/lib/idempotency';
import { formatNumber, formatPercent, formatRange } from '@/lib/format';
import { checkLegalEnv, missingLegalEnv } from '../../scripts/legal-env.mjs';

const ctx: FormContext = {
  equipment: [{ id: '11111111-1111-4111-8111-111111111111', name: 'Cámara', type: 'camara', minTemp: null, maxTemp: 4 }],
  cleaningPlans: [
    { id: 'p-m', name: 'Mensual profunda', frequency: 'monthly', weekday: null, monthDay: 1, items: [{ id: 'm1', area: 'Campana', product: null, method: null }] },
    {
      id: '22222222-2222-4222-8222-222222222222',
      name: 'Diaria de cocina con un nombre muy largo que antes se cortaba en el selector',
      frequency: 'daily',
      weekday: null,
      monthDay: null,
      items: [
        { id: 'a', area: 'Encimeras', product: null, method: null },
        { id: 'b', area: 'Suelos', product: null, method: null },
        { id: 'c', area: 'Fregaderos', product: null, method: null },
      ],
    },
    { id: 'p-w', name: 'Semanal', frequency: 'weekly', weekday: 1, monthDay: null, items: [{ id: 'w1', area: 'Cámaras', product: null, method: null }] },
  ],
  suppliers: [],
  staff: [],
  timezone: 'Europe/Madrid',
};

describe('validación en español (mismo mapa de errores que el servidor)', () => {
  it('ningún mensaje en inglés', () => {
    const r = createOrgBody.safeParse({ name: '', businessType: 'bar' });
    expect(r.error!.issues[0]!.message).toBe('Escribe el nombre');
    const t = temperaturaData.safeParse({ equipmentId: 'x', value: 999 });
    expect(t.error!.issues.map((i) => i.message)).toEqual(['Elige el equipo', 'La temperatura debe estar entre −60 y 300 °C']);
  });
});

describe('formatos es-ES', () => {
  it('coma decimal, menos tipográfico, porcentaje y mín./máx.', () => {
    expect(formatNumber(-18.5)).toBe('−18,5');
    expect(formatPercent(75)).toBe('75 %');
    expect(formatPercent(null)).toBe('—');
    expect(formatRange(null, 4)).toBe('máx. 4 °C');
    expect(formatRange(63, null)).toBe('mín. 63 °C');
    expect(cleaningResult([{ done: true }, { done: false }, { done: true }])).toBe('Parcial (2 de 3)');
    expect(cleaningResult([{ done: true }])).toBe('Completa (1 de 1)');
  });
});

describe('idempotencia y timeouts', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('una clave por registro, reutilizada en los reintentos mientras el cuerpo no cambie', () => {
    const k = new IdempotencyKeys();
    const a = k.keyFor({ v: 1 });
    expect(a).toMatch(/^[0-9a-f-]{36}$/);
    expect(k.keyFor({ v: 1 })).toBe(a);
    const b = k.keyFor({ v: 2 });
    expect(b).not.toBe(a);
    k.reset();
    expect(k.keyFor({ v: 2 })).not.toBe(b);
    expect(newIdempotencyKey()).not.toBe(newIdempotencyKey());
  });

  it('envía Idempotency-Key, trata 200 como éxito y convierte el tiempo agotado en un error claro', async () => {
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      expect((init.headers as Record<string, string>)['Idempotency-Key']).toBe('k-1');
      expect(init.signal).toBeInstanceOf(AbortSignal);
      return new Response(JSON.stringify({ record: { id: 'r1' } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    });
    vi.stubGlobal('fetch', fetchMock);
    await expect(api.post('/api/x', { a: 1 }, { idempotencyKey: 'k-1' })).resolves.toEqual({ record: { id: 'r1' } });

    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new DOMException('t', 'TimeoutError'))));
    const err = await api.get('/api/y').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).code).toBe('TIMEOUT');
    expect((err as ApiError).retryable).toBe(true);
    expect((err as ApiError).message).toMatch(/tardando demasiado/);
  });
});

describe('formularios', () => {
  it('el error de un campo desaparece al cambiar el valor y vuelve si se envía otra vez mal', async () => {
    function F() {
      const [v, setV] = useState('');
      const [err, setErr] = useState<string | null>(null);
      return (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setErr(v ? null : 'Escribe el nombre');
          }}
        >
          <Field label="Nombre" error={err}>
            <Input value={v} onChange={(e) => setV(e.target.value)} />
          </Field>
          <button type="submit">Guardar</button>
        </form>
      );
    }
    const user = userEvent.setup();
    render(<F />);
    await user.click(screen.getByRole('button', { name: 'Guardar' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Escribe el nombre');
    await user.type(screen.getByLabelText('Nombre'), 'A');
    expect(screen.queryByRole('alert')).toBeNull();
    await user.clear(screen.getByLabelText('Nombre'));
    await user.click(screen.getByRole('button', { name: 'Guardar' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Escribe el nombre');
  });

  it('contador de caracteres al acercarse al límite', async () => {
    function F() {
      const [v, setV] = useState('x'.repeat(95));
      return (
        <Field label="Nombre">
          <Input value={v} onChange={(e) => setV(e.target.value)} maxLength={100} />
        </Field>
      );
    }
    render(<F />);
    expect(screen.getByText('95/100')).toBeInTheDocument();
  });

  it('PIN: las letras no se descartan en silencio', async () => {
    function F() {
      const [v, setV] = useState('');
      return (
        <Field label="PIN">
          <PinInput value={v} onChange={setV} />
        </Field>
      );
    }
    const user = userEvent.setup();
    render(<F />);
    await user.type(screen.getByLabelText('PIN'), '12a');
    expect(screen.getByLabelText('PIN')).toHaveValue('12');
    expect(screen.getByRole('status')).toHaveTextContent('solo admite números');
  });

  it('temperatura imposible: mensaje en el momento, sin «dentro/fuera de rango» y Guardar deshabilitado', async () => {
    const user = userEvent.setup();
    render(<TemperaturaForm ctx={ctx} onSubmit={() => {}} />);
    const input = screen.getByLabelText('Temperatura (°C)');
    await user.type(input, '999');
    expect(screen.getByText('La temperatura debe estar entre −60 y 300 °C')).toBeInTheDocument();
    expect(screen.queryByText(/fuera de rango|dentro de rango/)).toBeNull();
    expect(screen.getByRole('button', { name: /Guardar/ })).toBeDisabled();
    await user.clear(input);
    await user.type(input, '-99');
    expect(screen.getByText('La temperatura debe estar entre −60 y 300 °C')).toBeInTheDocument();
    expect(screen.queryByText(/dentro de rango/)).toBeNull();
    await user.clear(input);
    await user.type(input, '9');
    expect(screen.getByText(/está fuera de rango/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Guardar/ })).toBeEnabled();
  });

  it('limpieza: exige una zona, ordena los planes y pide confirmación si es parcial', async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(<LimpiezaForm ctx={ctx} onSubmit={onSubmit} />);
    const radios = screen.getAllByRole('radio').map((r) => r.closest('label')!.textContent);
    expect(radios[0]).toMatch(/^Diaria/);
    expect(radios[1]).toMatch(/^Semanal/);
    expect(radios[2]).toMatch(/^Mensual/);
    await user.click(screen.getByText(/Diaria de cocina/));
    await user.click(screen.getByRole('button', { name: 'Guardar registro' }));
    expect(screen.getByText('Marca al menos una zona hecha')).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
    await user.click(screen.getByText('Encimeras'));
    expect(screen.queryByText('Marca al menos una zona hecha')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Guardar registro' }));
    expect(await screen.findByRole('heading', { name: 'Quedan 2 zonas sin hacer' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Guardar como parcial' }));
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ items: [{ itemId: 'a', done: true }, { itemId: 'b', done: false }, { itemId: 'c', done: false }] }));
  });

  it('recepción: caducidad pasada exige decidir y la temperatura máxima avisa', async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(<RecepcionForm ctx={{ ...ctx, suppliers: [{ id: '33333333-3333-4333-8333-333333333333', name: 'Prov', products: [] }] }} onSubmit={onSubmit} />);
    await user.selectOptions(screen.getByLabelText('Proveedor'), 'Prov');
    await user.type(screen.getByLabelText('Producto'), 'Pollo');
    await user.type(screen.getByLabelText(/Fecha de caducidad/), '2020-01-01');
    expect(screen.getByText('La fecha de caducidad ya ha pasado')).toBeInTheDocument();
    await user.type(screen.getByLabelText(/Temperatura al recibir/), '12');
    await user.click(screen.getByRole('button', { name: /Refrigerado/ }));
    expect(screen.getByText(/supera la máxima admisible/)).toBeInTheDocument();
    await user.click(screen.getByText('Sí, aceptarla con motivo'));
    await user.click(screen.getByRole('button', { name: 'Guardar registro' }));
    expect(screen.getByText(/Está caducada: indica por qué la aceptas/)).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });
});

describe('diálogos', () => {
  beforeEach(() => {
    HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
      this.setAttribute('open', '');
    };
    HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
      this.removeAttribute('open');
    };
  });
  it('al cerrar, el foco vuelve al botón que lo abrió', async () => {
    function F() {
      const [open, setOpen] = useState(false);
      return (
        <MemoryRouter>
          <button type="button" onClick={() => setOpen(true)}>
            Abrir
          </button>
          <Dialog open={open} onClose={() => setOpen(false)} title="Hola">
            contenido
          </Dialog>
        </MemoryRouter>
      );
    }
    const user = userEvent.setup();
    render(<F />);
    const opener = screen.getByRole('button', { name: 'Abrir' });
    await user.click(opener);
    await user.click(screen.getByRole('button', { name: 'Cerrar' }));
    await waitFor(() => expect(document.activeElement).toBe(opener));
  });
});

describe('datos legales del build', () => {
  const full = {
    VITE_LEGAL_OWNER_NAME: 'Ejemplo SL',
    VITE_LEGAL_TAX_ID: 'B00000000',
    VITE_LEGAL_ADDRESS: 'Calle 1',
    VITE_LEGAL_CONTACT_EMAIL: 'legal@example.com',
    VITE_LEGAL_HOSTING_PROVIDER: 'Proveedor',
    VITE_LEGAL_LAST_UPDATED: '10 de noviembre de 2026',
  };
  it('falla con la lista de lo que falta, salvo VITE_ALLOW_PLACEHOLDER_LEGAL=true', () => {
    expect(checkLegalEnv(full)).toBeNull();
    const err = checkLegalEnv({ ...full, VITE_LEGAL_TAX_ID: ' ', VITE_LEGAL_ADDRESS: undefined });
    expect(err).toMatch(/VITE_LEGAL_TAX_ID/);
    expect(err).toMatch(/VITE_LEGAL_ADDRESS/);
    expect(err).not.toMatch(/VITE_LEGAL_OWNER_NAME/);
    expect(missingLegalEnv({})).toHaveLength(6);
    expect(checkLegalEnv({ VITE_ALLOW_PLACEHOLDER_LEGAL: 'true' })).toBeNull();
  });
});
