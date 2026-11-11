/**
 * Cambios del servidor: confirmación de email que cierra sesiones, informes PDF en cola (estado «Generando…»,
 * 429 y REPORT_TOO_LARGE tal cual), correcciones posteriores y plazo de un cobro fallido.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router';
import { ConfirmEmailChangePage, LoginPage } from '@/pages/auth/AuthPages';
import { ComplianceChart, correctedLaterText } from '@/pages/app/AppPages';
import { DownloadButton } from '@/features/DownloadButton';
import { pastDueDeadlineText } from '@/features/SubscriptionBanner';
import type { Compliance } from '@/api/types';

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });

afterEach(() => vi.unstubAllGlobals());

describe('confirmar cambio de email', () => {
  beforeEach(() => window.history.replaceState(null, '', '/'));
  const renderPage = (token: string) => {
    window.history.replaceState(null, '', `/confirmar-email#token=${token}`);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={['/confirmar-email']}>
          <Routes>
            <Route path="/confirmar-email" element={<ConfirmEmailChangePage />} />
            <Route path="/entrar" element={<LoginPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
  };

  it('si la sesión ya no vale, lleva al login con «Email actualizado. Entra con tu nuevo email.»', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        url.includes('email-change/confirm')
          ? json(200, { message: 'Email actualizado.' })
          : json(401, { error: { code: 'UNAUTHENTICATED', message: 'Necesitas iniciar sesión' } }),
      ),
    );
    renderPage('tokenSinSesionAAAAAAAAAAAAAAAAAAAAAAAAAAAA');
    expect(await screen.findByText('Email actualizado. Entra con tu nuevo email.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Entrar' })).toBeInTheDocument();
  });

  it('si la sesión sigue valiendo, se queda en la confirmación', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        url.includes('email-change/confirm')
          ? json(200, { message: 'Email actualizado.' })
          : json(200, { user: { id: 'u', email: 'nuevo@x.es', name: 'Ana' }, organizations: [] }),
      ),
    );
    renderPage('tokenConSesionBBBBBBBBBBBBBBBBBBBBBBBBBBBB');
    expect(await screen.findByText('Email actualizado')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Ir a mi panel' })).toBeInTheDocument();
  });
});

describe('informe PDF', () => {
  const renderButton = () =>
    render(
      <DownloadButton url="/api/orgs/o/reports/pdf" fallbackName="registros.pdf" busyLabel="Generando el informe…">
        Informe PDF
      </DownloadButton>,
    );

  it('muestra «Generando el informe…» con barra indeterminada, deshabilita el botón y usa un solo envío', async () => {
    let finish!: (r: Response) => void;
    const fetchMock = vi.fn(() => new Promise<Response>((res) => (finish = res)));
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    renderButton();
    await user.click(screen.getByRole('button', { name: 'Informe PDF' }));
    const btn = await screen.findByRole('button', { name: /Generando el informe/ });
    expect(btn).toBeDisabled();
    const bar = screen.getByRole('progressbar', { name: 'Generando el informe…' });
    expect(bar).not.toHaveAttribute('aria-valuenow');
    await user.click(btn);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    finish(json(500, { error: { code: 'INTERNAL_ERROR', message: 'Fallo' } }));
    await screen.findByText('Fallo');
    expect(screen.queryByRole('progressbar')).toBeNull();
    expect(screen.getByRole('button', { name: 'Informe PDF' })).toBeEnabled();
  });

  it.each([
    ['Ya se está generando un informe PDF de este local. Espera a que termine y vuelve a intentarlo.'],
    ['Ya estás generando otro informe PDF. Espera a que termine y vuelve a intentarlo.'],
    ['El servidor está generando muchos informes ahora mismo (cola llena). Inténtalo en unos segundos.'],
    ['Este local ha agotado el tiempo de generación de informes PDF de esta hora. Inténtalo más tarde o descarga el CSV.'],
  ])('429: muestra el mensaje del servidor tal cual (%s)', async (message) => {
    vi.stubGlobal('fetch', vi.fn(async () => json(429, { error: { code: 'RATE_LIMITED', message } }, { 'Retry-After': '90' })));
    const user = userEvent.setup();
    renderButton();
    await user.click(screen.getByRole('button', { name: 'Informe PDF' }));
    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(screen.getByText(/Podrás volver a intentarlo en 2 minutos/)).toBeInTheDocument();
  });

  it('REPORT_TOO_LARGE: mensaje tal cual', async () => {
    const message = 'El informe PDF es demasiado grande. Acota el periodo o los tipos de registro, o descarga el CSV.';
    vi.stubGlobal('fetch', vi.fn(async () => json(400, { error: { code: 'REPORT_TOO_LARGE', message } })));
    const user = userEvent.setup();
    renderButton();
    await user.click(screen.getByRole('button', { name: 'Informe PDF' }));
    expect(await screen.findByText(message)).toBeInTheDocument();
  });
});

describe('correcciones posteriores', () => {
  it('texto discreto y en singular/plural', () => {
    expect(correctedLaterText(1)).toBe('1 completada con una corrección posterior');
    expect(correctedLaterText(3)).toBe('3 completadas con una corrección posterior');
  });

  it('el resumen de cumplimiento lo indica en el total y por día', async () => {
    const data: Compliance = {
      from: '2026-11-01',
      to: '2026-11-02',
      days: [
        { date: '2026-11-01', expected: 4, done: 4, percent: 100, correctedLater: 1 },
        { date: '2026-11-02', expected: 4, done: 3, percent: 75, correctedLater: 0 },
      ],
      overall: { expected: 8, done: 7, percent: 87.5, correctedLater: 1 },
    };
    render(<ComplianceChart data={data} />);
    expect(screen.getByTestId('overall-corrected-later')).toHaveTextContent('1 completada con una corrección posterior');
    await userEvent.click(screen.getByRole('button', { name: 'Ver como tabla' }));
    expect(screen.getByRole('columnheader', { name: 'Con corrección posterior' })).toBeInTheDocument();
  });

  it('sin correcciones no aparece nada', () => {
    const data: Compliance = { from: '2026-11-01', to: '2026-11-01', days: [{ date: '2026-11-01', expected: 1, done: 1, percent: 100 }], overall: { expected: 1, done: 1, percent: 100 } };
    render(<ComplianceChart data={data} />);
    expect(screen.queryByTestId('overall-corrected-later')).toBeNull();
  });
});

describe('cobro fallido', () => {
  it('dice desde cuándo y que el plazo es de unos días, sin inventar una fecha límite', () => {
    const t = pastDueDeadlineText('2026-11-03T10:00:00Z', 'Europe/Madrid');
    expect(t).toMatch(/durante unos días más/);
    expect(t).toMatch(/solo lectura/);
    expect(t).toMatch(/desde el 3 nov/);
    expect(t).not.toMatch(/21/);
    expect(pastDueDeadlineText(null, 'Europe/Madrid')).not.toMatch(/desde el/);
  });
});

