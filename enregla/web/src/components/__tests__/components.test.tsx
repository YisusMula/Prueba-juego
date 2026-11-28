import { describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Keypad } from '../ui/Keypad';
import { passwordRules } from '@shared/schemas';
import { PasswordMeter } from '@/features/PasswordMeter';
import { QrCode } from '../ui/QrCode';
import { AllergenIcon } from '../icons/AllergenIcon';
import { Badge } from '../ui/Feedback';
import { recordSummary } from '@/features/recordMeta';
import type { AppRecord } from '@/api/types';

function KeypadHarness({ mode }: { mode: 'decimal' | 'pin' }) {
  const [v, setV] = useState('');
  return (
    <>
      <output data-testid="v">{v}</output>
      <Keypad value={v} onChange={setV} mode={mode} maxLength={mode === 'pin' ? 6 : 4} />
    </>
  );
}

describe('Keypad', () => {
  it('escribe negativos con coma decimal (un decimal)', async () => {
    const user = userEvent.setup();
    render(<KeypadHarness mode="decimal" />);
    await user.click(screen.getByRole('button', { name: '1' }));
    await user.click(screen.getByRole('button', { name: '8' }));
    await user.click(screen.getByRole('button', { name: 'Cambiar signo (negativo)' }));
    await user.click(screen.getByRole('button', { name: 'Coma decimal' }));
    await user.click(screen.getByRole('button', { name: '5' }));
    await user.click(screen.getByRole('button', { name: '7' }));
    expect(screen.getByTestId('v')).toHaveTextContent('-18,5');
    await user.click(screen.getAllByRole('button', { name: 'Borrar' })[0]!);
    expect(screen.getByTestId('v')).toHaveTextContent('-18,');
  });
  it('PIN: solo dígitos y máximo 6', async () => {
    const user = userEvent.setup();
    render(<KeypadHarness mode="pin" />);
    for (const d of '12345678') await user.click(screen.getByRole('button', { name: d }));
    expect(screen.getByTestId('v')).toHaveTextContent('123456');
    expect(screen.queryByRole('button', { name: 'Coma decimal' })).toBeNull();
  });
});

describe('PasswordMeter', () => {
  it('anuncia cada requisito con texto', () => {
    render(<PasswordMeter password="corta" email="a@b.es" />);
    expect(screen.getByText('Entre 10 y 128 caracteres')).toBeInTheDocument();
    expect(screen.getAllByText(/: pendiente/).length).toBeGreaterThan(0);
  });
});

describe('PasswordMeter (regla de datos personales)', () => {
  it('muestra la etiqueta y el mensaje del módulo compartido', () => {
    render(<PasswordMeter password="ana.martin2" email="ana.martin@x.es" />);
    expect(screen.getByText('No contiene tu email ni tu nombre')).toBeInTheDocument();
    expect(screen.getByText(/ni contenerlos/)).toBeInTheDocument();
    expect(screen.getByText(/ni contenerlos/)).toHaveTextContent(passwordRules('ana.martin2', { email: 'ana.martin@x.es' }).find((r) => r.id === 'personal')!.message);
  });
  it('sin datos personales el requisito se cumple', () => {
    render(<PasswordMeter password="Cocina-Limpia-2026" email="ana.martin@x.es" />);
    expect(screen.queryByText(/ni contenerlos/)).toBeNull();
  });
});

describe('Pictogramas y estados accesibles', () => {
  it('el QR es una imagen con nombre', () => {
    render(<QrCode value="https://example.com/carta/abc" label="QR de la carta" />);
    expect(screen.getByRole('img', { name: 'QR de la carta' })).toBeInTheDocument();
  });
  it('el alérgeno no decorativo tiene nombre', () => {
    render(<AllergenIcon id="gluten" decorative={false} />);
    expect(screen.getByRole('img', { name: 'Cereales que contienen gluten' })).toBeInTheDocument();
  });
  it('el estado se transmite con texto, no solo color', () => {
    render(<Badge tone="bad" icon="alert">Fuera de rango</Badge>);
    expect(screen.getByText('Fuera de rango')).toBeVisible();
  });
});

describe('recordSummary', () => {
  it('resume una temperatura fuera de rango', () => {
    const r = {
      id: '1', type: 'temperatura', staff: null, user: null, deviceId: null, alert: true, amendsRecordId: null, amendmentReason: null, amendedByRecordId: null,
      createdAt: '2026-11-09T10:00:00Z',
      data: { equipmentId: 'e', equipmentName: 'Cámara', value: 9.5, minTemp: null, maxTemp: 4, outOfRange: true, correctiveAction: 'Producto desechado' },
    } as AppRecord;
    expect(recordSummary(r)).toEqual({ title: 'Cámara: 9,5 °C', detail: 'Fuera de rango · Producto desechado' });
  });
});

vi.mock('virtual:pwa-register', () => ({ registerSW: () => undefined }));
