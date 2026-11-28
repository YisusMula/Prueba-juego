/**
 * Última ronda de correcciones: validación en vivo que no desaparece, porcentajes y números registrados sin
 * redondear, plurales, sugerencias coherentes al recibir mercancía, «Hoy» que se refresca y mensajes de formulario.
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, renderHook, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider, focusManager } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { api } from '@/api/client';
import { TODAY_REFRESH, useToday } from '@/api/queries';
import { EquipmentDialog } from '@/features/ConfigForms';
import { AceiteForm, FormacionForm, RecepcionForm, TemperaturaForm, type FormContext } from '@/features/RecordForms';
import { recordSummary } from '@/features/recordMeta';
import { Keypad } from '@/components/ui/Keypad';
import { formatCompliance, formatDecimal, formatPercent, formatTemp, numberFieldError, plural, quedan } from '@/lib/format';
import type { AppRecord } from '@/api/types';

const EQ = '11111111-1111-4111-8111-111111111111';
const FRYER = '33333333-3333-4333-8333-333333333333';
const ctx: FormContext = {
  equipment: [
    { id: EQ, name: 'Cámara', type: 'camara', minTemp: null, maxTemp: 4 },
    { id: FRYER, name: 'Freidora', type: 'freidora', minTemp: null, maxTemp: null },
  ],
  cleaningPlans: [],
  suppliers: [],
  staff: [{ id: '44444444-4444-4444-8444-444444444444', name: 'Ana' }],
  timezone: 'Europe/Madrid',
};
const guardar = () => screen.getByRole('button', { name: /Guardar/ });

describe('1. el error de rango en vivo se deriva del valor actual y no desaparece al editar', () => {
  it('temperatura: 999 → Backspace → 9 vuelve a mostrar el mensaje (y el borde de error)', async () => {
    const user = userEvent.setup();
    render(<TemperaturaForm ctx={ctx} onSubmit={() => undefined} />);
    const input = screen.getByLabelText('Temperatura (°C)');
    await user.type(input, '999');
    expect(screen.getByRole('alert')).toHaveTextContent('La temperatura debe estar entre −60 y 300 °C');
    await user.type(input, '{Backspace}');
    expect(screen.queryByText(/debe estar entre/)).toBeNull();
    await user.type(input, '9');
    expect(screen.getByRole('alert')).toHaveTextContent('debe estar entre');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(guardar()).toBeDisabled();
  });

  it('temperatura: −99 y luego −999 (mismo mensaje) sigue mostrándose', async () => {
    const user = userEvent.setup();
    render(<TemperaturaForm ctx={ctx} onSubmit={() => undefined} />);
    const input = screen.getByLabelText('Temperatura (°C)');
    await user.type(input, '-99');
    expect(screen.getByRole('alert')).toHaveTextContent('debe estar entre');
    await user.type(input, '9');
    expect(screen.getByRole('alert')).toHaveTextContent('debe estar entre');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(guardar()).toBeDisabled();
  });

  it('recepción: temperatura y máxima inválidas muestran siempre su motivo mientras Guardar está deshabilitado', async () => {
    const user = userEvent.setup();
    render(<RecepcionForm ctx={ctx} onSubmit={() => undefined} />);
    const t = screen.getByLabelText(/Temperatura al recibir/);
    await user.type(t, '999');
    expect(screen.getAllByRole('alert')[0]).toHaveTextContent('entre −60 y 100 °C');
    await user.type(t, '{Backspace}9');
    expect(t).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getAllByText(/entre −60 y 100 °C/)).toHaveLength(1);
    expect(guardar()).toBeDisabled();
  });

  it('aceite: texto no numérico o fuera de 0–100 explica qué se espera y deshabilita Guardar', async () => {
    const user = userEvent.setup();
    render(<AceiteForm ctx={ctx} onSubmit={() => undefined} />);
    const input = screen.getByLabelText(/Compuestos polares/);
    await user.type(input, 'abc');
    expect(screen.getByRole('alert')).toHaveTextContent('Escribe el porcentaje con números (por ejemplo 18 o 27,5)');
    expect(guardar()).toBeDisabled();
    await user.clear(input);
    await user.type(input, '150');
    expect(screen.getByRole('alert')).toHaveTextContent('deben estar entre 0 y 100 %');
    await user.type(input, '{Backspace}0');
    expect(screen.getByRole('alert')).toHaveTextContent('deben estar entre 0 y 100 %');
    expect(guardar()).toBeDisabled();
  });

  it('formación: horas inválidas explican el formato y deshabilitan Guardar', async () => {
    const user = userEvent.setup();
    render(<FormacionForm ctx={ctx} onSubmit={() => undefined} />);
    const input = screen.getByLabelText(/Horas/);
    await user.type(input, 'dos');
    expect(screen.getByRole('alert')).toHaveTextContent('Escribe las horas con números (por ejemplo 2 o 1,5)');
    expect(guardar()).toBeDisabled();
    await user.clear(input);
    await user.type(input, '5000');
    expect(screen.getByRole('alert')).toHaveTextContent('Las horas deben estar entre 0 y 1000');
    await user.type(input, '{Backspace}0');
    expect(screen.getByRole('alert')).toHaveTextContent('Las horas deben estar entre 0 y 1000');
  });

  it('equipo: mínima y máxima fuera de −60…300 o no numéricas dicen qué se espera (sin «Número no válido»)', async () => {
    const user = userEvent.setup();
    render(<EquipmentDialog orgId="o" open onClose={() => undefined} onSaved={() => undefined} />);
    const max = screen.getByLabelText(/Máxima/);
    await user.clear(max);
    await user.type(max, '999');
    expect(screen.getByRole('alert')).toHaveTextContent('La temperatura debe estar entre −60 y 300 °C');
    await user.type(max, '{Backspace}9');
    expect(screen.getByRole('alert')).toHaveTextContent('debe estar entre');
    expect(screen.getByRole('button', { name: 'Guardar equipo' })).toBeDisabled();
    await user.clear(max);
    await user.type(max, 'x');
    expect(screen.getByRole('alert')).toHaveTextContent('Escribe la temperatura con números (por ejemplo 4 o −18)');
    expect(screen.queryByText(/Número no válido|Valor no válido/)).toBeNull();
  });

  it('numberFieldError', () => {
    const o = { notNumber: 'N', min: 0, max: 10, outOfRange: 'R' };
    expect(numberFieldError('', o)).toBeNull();
    expect(numberFieldError('5,5', o)).toBeNull();
    expect(numberFieldError('x', o)).toBe('N');
    expect(numberFieldError('11', o)).toBe('R');
  });
});

describe('2. los datos registrados no se redondean al mostrarlos', () => {
  it('formateador único de porcentajes: conserva decimales; el cumplimiento calculado sí es entero', () => {
    expect(formatPercent(27.5)).toBe('27,5\u202F%');
    expect(formatPercent(25)).toBe('25\u202F%');
    expect(formatPercent(null)).toBe('—');
    expect(formatCompliance(27.5)).toBe('28\u202F%');
    expect(formatCompliance(66.666)).toBe('67\u202F%');
  });

  it('temperaturas y horas tal como se introdujeron (también con 2 decimales)', () => {
    expect(formatTemp(3.25)).toBe('3,25 °C');
    expect(formatTemp(-18.5)).toBe('−18,5 °C');
    expect(formatDecimal(1.25)).toBe('1,25');
  });

  it('el resumen de un registro de aceite (historial y confirmación de cocina) dice 27,5 %', () => {
    const rec = { id: 'r', type: 'aceite', data: { fryerName: 'Freidora', action: 'cambiado', polarCompounds: 27.5, overLimit: true } } as unknown as AppRecord;
    expect(recordSummary(rec).detail).toContain('27,5\u202F%');
    expect(recordSummary(rec).detail).not.toContain('28');
  });
});

describe('4. plurales', () => {
  it('«Queda 1 tarea» / «Quedan 2 tareas» y el helper plural', () => {
    expect(quedan(1, 'tarea', 'tareas')).toBe('Queda 1 tarea');
    expect(quedan(3, 'tarea', 'tareas')).toBe('Quedan 3 tareas');
    expect(plural(1, 'día', 'días')).toBe('1 día');
    expect(plural(1, 'alerta', 'alertas')).toBe('1 alerta');
    expect(plural(0, 'zona', 'zonas')).toBe('0 zonas');
  });
});

describe('5. recepción: sugerencias coherentes con aceptar o rechazar', () => {
  const pastDate = '2020-01-01';
  it('al ACEPTAR un producto caducado no se ofrece devolver ni desechar', async () => {
    const user = userEvent.setup();
    render(<RecepcionForm ctx={ctx} onSubmit={() => undefined} />);
    await user.type(screen.getByLabelText(/Fecha de caducidad/), pastDate);
    await user.click(screen.getByRole('radio', { name: /Sí, aceptarla con motivo/ }));
    expect(screen.queryByRole('button', { name: 'Se devuelve al proveedor' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Se desecha' })).toBeNull();
    expect(screen.getByRole('button', { name: /Error en la etiqueta/ })).toBeInTheDocument();
  });
  it('al RECHAZAR sí se ofrecen devolver o desechar', async () => {
    const user = userEvent.setup();
    render(<RecepcionForm ctx={ctx} onSubmit={() => undefined} />);
    await user.type(screen.getByLabelText(/Fecha de caducidad/), pastDate);
    await user.click(screen.getByRole('radio', { name: /No, rechazada/ }));
    expect(screen.getByRole('button', { name: 'Se devuelve al proveedor' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Se desecha' })).toBeInTheDocument();
  });
});

describe('7. «Hoy» se refresca al volver a la pestaña o a la app', () => {
  it('useToday refetch al recuperar el foco aunque los datos sean recientes', async () => {
    const get = vi.spyOn(api, 'get').mockResolvedValue({ date: '2026-11-10', summary: {}, temperatures: [], cleaning: [], alerts: [] });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 60_000, refetchOnWindowFocus: false } } });
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
    renderHook(() => useToday('org-1'), { wrapper });
    await waitFor(() => expect(get).toHaveBeenCalledTimes(1));
    await act(async () => {
      focusManager.setFocused(false);
      focusManager.setFocused(true);
    });
    await waitFor(() => expect(get).toHaveBeenCalledTimes(2));
    expect(TODAY_REFRESH.refetchOnWindowFocus).toBe('always');
    get.mockRestore();
  });
});

describe('11. el PIN de cocina avisa cuando no caben más cifras', () => {
  it('Keypad llama a onLimit en vez de ignorar la cifra en silencio', async () => {
    const user = userEvent.setup();
    const onLimit = vi.fn();
    render(<Keypad value="123456" onChange={() => undefined} mode="pin" maxLength={6} onLimit={onLimit} />);
    await user.click(screen.getByRole('button', { name: '7' }));
    expect(onLimit).toHaveBeenCalledTimes(1);
  });
});

