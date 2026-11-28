/**
 * Tercera evaluación de la fase 1, de punta a punta: toques a ciegas sobre la rejilla tras «¿Eres Ana?»
 * no firman como Ana (R5); PIN bloqueado que un responsable desbloquea en la tablet y aviso de personal
 * sin PIN en Ajustes (R7).
 */
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect, login, apiHeaders, DEMO } from './helpers';
import type { Browser, Page } from '@playwright/test';

test.describe.configure({ mode: 'serial' });

const RUNTIME = path.join(path.dirname(fileURLToPath(import.meta.url)), '.runtime');
const SHARED = path.join(RUNTIME, 'demo-state.json');
const STATE = path.join(RUNTIME, 'demo-state-09.json');
test.beforeAll(async ({ browser }) => {
  const baseURL = `http://localhost:${process.env.E2E_PORT ?? '3100'}`;
  if (existsSync(SHARED)) {
    const ctx = await browser.newContext({ baseURL, storageState: SHARED });
    const ok = (await ctx.request.get('/api/account')).status() === 200;
    if (ok) await ctx.storageState({ path: STATE });
    await ctx.close();
    if (ok) return;
  }
  const ctx = await browser.newContext({ baseURL, locale: 'es-ES', storageState: { cookies: [], origins: [] } });
  await login(await ctx.newPage(), DEMO.email, DEMO.password);
  await ctx.storageState({ path: STATE });
  await ctx.close();
});
test.use({ storageState: STATE });

const shot = (p: Page, name: string) => p.screenshot({ path: path.join(RUNTIME, `09-${name}.png`) });

async function demoOrg(page: Page) {
  await page.goto('/app');
  await page.waitForURL(/\/hoy$/);
  const base = page.url().replace(/\/hoy$/, '');
  return { base, id: base.split('/locales/')[1]! };
}

async function openTablet(page: Page, browser: Browser, orgId: string, name: string) {
  const dev = await page.request.post(`/api/orgs/${orgId}/devices`, { data: { name }, headers: apiHeaders(page) });
  expect(dev.status()).toBe(201);
  const { token } = (await dev.json()) as { token: string };
  const tablet = await browser.newContext({ viewport: { width: 1024, height: 768 }, locale: 'es-ES', hasTouch: true, storageState: { cookies: [], origins: [] } });
  await tablet.clock.install();
  const k = await tablet.newPage();
  await k.goto(`/cocina/vincular#token=${token}`);
  await expect(k.getByRole('heading', { name: 'Registrar' })).toBeVisible();
  return { tablet, k };
}
const keypad = async (k: Page, digits: string) => {
  for (const d of digits) await k.getByRole('button', { name: d, exact: true }).click();
};

test('R5: dos toques a ciegas donde estaba el Congelador tras «¿Eres Ana?» no firman como Ana', async ({ page, browser }) => {
  const { id } = await demoOrg(page);
  const { tablet, k } = await openTablet(page, browser, id, `Tablet R5 ${Date.now()}`);
  await k.getByRole('button', { name: 'Temperatura', exact: true }).click();
  await k.getByRole('button', { name: /Ana Martín/ }).click();
  await keypad(k, '1234');
  await k.getByRole('button', { name: 'Entrar' }).click();
  const tile = k.getByRole('button', { name: /Congelador/ });
  const bb = (await tile.boundingBox())!;
  // Ana se va sin registrar; 30 s después llega Marta y toca dos veces, a ciegas, donde estaba el Congelador.
  await k.clock.fastForward(30_000);
  await expect(k.getByTestId('kiosk-confirm-person')).toBeVisible();
  await shot(k, 'eres-ana-1024');
  await k.touchscreen.tap(bb.x + bb.width / 2, bb.y + bb.height / 2);
  await k.clock.fastForward(1_000);
  await k.touchscreen.tap(bb.x + bb.width / 2, bb.y + bb.height / 2);
  // Sigue preguntando: ningún toque fuera de las respuestas cuenta.
  await expect(k.getByTestId('kiosk-confirm-person')).toBeVisible();
  // No se ha abierto el Congelador (ni ningún otro equipo): no hay teclado ni «Guardar».
  await expect(k.getByRole('button', { name: 'Guardar' })).toHaveCount(0);
  // Las respuestas están arriba, fuera de la rejilla de equipos.
  const yes = (await k.getByRole('button', { name: 'Sí, soy Ana Martín' }).boundingBox())!;
  expect(yes.y + yes.height).toBeLessThan(bb.y);
  await k.getByRole('button', { name: 'No, soy otra persona' }).click();
  await expect(k.getByRole('heading', { name: '¿Quién eres?' })).toBeVisible();
  await tablet.close();
});

test('R7: PIN bloqueado 1 minuto; un responsable lo desbloquea en la tablet; Ajustes avisa del personal sin PIN', async ({ page, browser }) => {
  const { base, id } = await demoOrg(page);
  const { tablet, k } = await openTablet(page, browser, id, `Tablet R7 ${Date.now()}`);
  await k.getByRole('button', { name: 'Temperatura', exact: true }).click();
  await k.getByRole('button', { name: /Marta Gil/ }).click();
  for (let i = 0; i < 5; i++) {
    await keypad(k, '0000');
    await k.getByRole('button', { name: 'Entrar' }).click();
    if (i < 4) await expect(k.getByText('PIN incorrecto. Prueba otra vez.')).toBeVisible();
  }
  await expect(k.getByText(/El PIN de Marta Gil está bloqueado/)).toBeVisible();
  await expect(k.getByText(/Inténtalo en (1 minuto|\d+ segundos)/)).toBeVisible();
  await k.getByRole('button', { name: 'Desbloquear (responsable)' }).click();
  await expect(k.getByRole('heading', { name: 'Desbloquear el PIN de Marta Gil' })).toBeVisible();
  await shot(k, 'desbloquear-1024');
  await k.getByLabel('Email del propietario o encargado').fill(DEMO.email);
  await k.getByLabel('Contraseña').fill(DEMO.password);
  await k.getByRole('button', { name: 'Desbloquear', exact: true }).click();
  await expect(k.getByText(/PIN de Marta Gil desbloqueado por/)).toBeVisible();
  await k.getByRole('button', { name: 'Temperatura', exact: true }).click();
  await k.getByRole('button', { name: /Marta Gil/ }).click();
  await keypad(k, '5678');
  await k.getByRole('button', { name: 'Entrar' }).click();
  await expect(k.getByTestId('kiosk-signing-as')).toContainText('Registrando como Marta Gil');
  await tablet.close();
  // Ajustes → Personal: aviso de quien no tiene PIN (Luis Pérez en la demo).
  await page.goto(`${base}/ajustes/personal`);
  await expect(page.getByText('Recomendado: que todo el personal tenga PIN')).toBeVisible();
  await expect(page.getByText(/Luis Pérez no tiene PIN/)).toBeVisible();
  await shot(page, 'personal-sin-pin');
});
