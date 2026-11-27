/**
 * Segunda evaluación de la fase 1, de punta a punta contra el servidor real: «¿Eres Ana?» tras 20 s sin
 * tocar la tablet, «He terminado», «Corregir» pide el PIN antes del formulario, «Ya toca volver a
 * medir» (#14) en la tablet y en «Hoy», y el motivo de «ambiente» para un proveedor de frío (N9).
 */
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect, login, apiHeaders, DEMO } from './helpers';
import type { Browser, Page } from '@playwright/test';

test.describe.configure({ mode: 'serial' });

const RUNTIME = path.join(path.dirname(fileURLToPath(import.meta.url)), '.runtime');
const SHARED = path.join(RUNTIME, 'demo-state.json');
const STATE = path.join(RUNTIME, 'demo-state-08.json');
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

const shot = (p: Page, name: string) => p.screenshot({ path: path.join(RUNTIME, `08-${name}.png`), fullPage: false });

async function demoOrg(page: Page) {
  await page.goto('/app');
  await page.waitForURL(/\/hoy$/);
  const base = page.url().replace(/\/hoy$/, '');
  return { base, id: base.split('/locales/')[1]! };
}

/** Tablet con reloj simulado (para adelantar los 20 s / 30 min sin esperar). */
async function openTablet(page: Page, browser: Browser, orgId: string, name: string, viewport = { width: 1024, height: 768 }) {
  const dev = await page.request.post(`/api/orgs/${orgId}/devices`, { data: { name }, headers: apiHeaders(page) });
  expect(dev.status()).toBe(201);
  const { token } = (await dev.json()) as { token: string };
  const tablet = await browser.newContext({ viewport, locale: 'es-ES', storageState: { cookies: [], origins: [] } });
  await tablet.clock.install();
  const k = await tablet.newPage();
  await k.goto(`/cocina/vincular#token=${token}`);
  await expect(k).toHaveURL(/\/cocina$/);
  await expect(k.getByRole('heading', { name: 'Registrar' })).toBeVisible();
  return { tablet, k };
}
const keypad = async (k: Page, digits: string) => {
  for (const d of digits) await k.getByRole('button', { name: d, exact: true }).click();
};

test('N4: «¿Eres Ana?» tras 20 s, «He terminado» y «Corregir» con PIN', async ({ page, browser }) => {
  const { id } = await demoOrg(page);
  const { tablet, k } = await openTablet(page, browser, id, `Tablet N4 ${Date.now()}`);
  await k.getByRole('button', { name: 'Temperatura', exact: true }).click();
  await k.getByRole('button', { name: /Ana Martín/ }).click();
  await keypad(k, '1234');
  await k.getByRole('button', { name: 'Entrar' }).click();
  await k.getByRole('button', { name: /Cámara de carnes/ }).click();
  await keypad(k, '2');
  await k.getByRole('button', { name: 'Guardar' }).click();
  await expect(k.getByTestId('kiosk-result')).toContainText('Guardado por Ana Martín');
  await expect(k.getByTestId('kiosk-signing-as').getByRole('button', { name: 'He terminado' })).toBeVisible();
  await k.clock.fastForward(3_000);
  await expect(k.getByRole('heading', { name: '¿Qué equipo?' })).toBeVisible();

  // 20 s sin tocar: pantalla completa «¿Eres Ana Martín?».
  await k.clock.fastForward(21_000);
  const ov = k.getByTestId('kiosk-confirm-person');
  await expect(ov.getByRole('heading', { name: '¿Eres Ana Martín?' })).toBeVisible();
  await shot(k, 'eres-ana-1024');
  await ov.getByRole('button', { name: 'Sí, soy Ana Martín' }).click();
  await expect(ov).toHaveCount(0);
  await expect(k.getByTestId('kiosk-signing-as')).toContainText('Registrando como Ana Martín');

  // «Corregir» pide el PIN antes de abrir el formulario.
  await k.getByRole('button', { name: 'Volver', exact: true }).click();
  await k.getByTestId('kiosk-recent').getByRole('button', { name: 'Corregir' }).click();
  await expect(k.getByRole('heading', { name: '¿Eres Ana Martín?' })).toBeVisible();
  await expect(k.getByRole('button', { name: 'Me equivoqué de número' })).toHaveCount(0);
  await shot(k, 'corregir-pin-1024');
  await keypad(k, '9999');
  await k.getByRole('button', { name: 'Corregir', exact: true }).click();
  await expect(k.getByText('PIN incorrecto. Prueba otra vez.')).toBeVisible();
  await keypad(k, '1234');
  await k.getByRole('button', { name: 'Corregir', exact: true }).click();
  await k.getByRole('button', { name: 'Me equivoqué de número' }).click();
  await keypad(k, '3');
  await k.getByRole('button', { name: 'Guardar corrección' }).click();
  await expect(k.getByTestId('kiosk-result')).toContainText('Corrección guardada');

  // «He terminado»: se olvida a la persona.
  await k.getByRole('button', { name: /Inicio del modo cocina/ }).click();
  await k.getByRole('button', { name: 'Temperatura', exact: true }).click();
  await k.getByRole('button', { name: /Luis Pérez/ }).click();
  await k.getByTestId('kiosk-signing-as').getByRole('button', { name: 'He terminado' }).click();
  await expect(k.getByTestId('kiosk-signing-as')).toHaveCount(0);
  await expect(k.getByRole('heading', { name: 'Registrar' })).toBeVisible();
  await tablet.close();
});

test('#14: llegada la hora de volver a medir se resalta en la tablet y en «Hoy» (sin notificación)', async ({ page, browser }) => {
  const { base, id } = await demoOrg(page);
  const { tablet, k } = await openTablet(page, browser, id, `Tablet 14 ${Date.now()}`);
  await k.getByRole('button', { name: 'Temperatura', exact: true }).click();
  await k.getByRole('button', { name: /Luis Pérez/ }).click();
  await k.getByRole('button', { name: /Cámara de carnes/ }).click();
  await keypad(k, '9');
  await k.getByRole('button', { name: 'Siguiente' }).click();
  await k.getByRole('button', { name: 'Repetiré la medición en 30 min' }).click();
  await k.getByRole('button', { name: 'Guardar con esta acción' }).click();
  await expect(k.getByTestId('kiosk-result')).toContainText('Guardado con alerta');
  await k.getByRole('button', { name: /Inicio del modo cocina/ }).click();
  const tile = k.getByRole('button', { name: /volver a medir: Cámara de carnes/i });
  await expect(tile).toBeVisible();
  await expect(tile.getByTestId('remeasure-due')).toHaveCount(0);
  // 31 min después (el reloj de la tablet avanza; los datos vienen del servidor).
  await k.clock.fastForward(31 * 60_000);
  await expect(k.getByRole('button', { name: /Ya toca volver a medir: Cámara de carnes/ }).getByTestId('remeasure-due')).toBeVisible();
  await shot(k, 'ya-toca-1024');
  await tablet.close();

  // «Hoy» en la web, también con el reloj adelantado.
  const web = await browser.newContext({ storageState: STATE, viewport: { width: 390, height: 844 }, locale: 'es-ES' });
  await web.clock.install({ time: Date.now() + 31 * 60_000 });
  const w = await web.newPage();
  await w.goto(`${base}/hoy`);
  const card = w.getByRole('link', { name: /Ya toca volver a medir: Cámara de carnes/ });
  await expect(card.getByTestId('remeasure-due')).toBeVisible();
  await shot(w, 'ya-toca-hoy-390');
  await web.close();
});

test('N9: «ambiente» para un proveedor de refrigerado pide motivo y el historial lo muestra', async ({ page }) => {
  const { base, id } = await demoOrg(page);
  const sup = await page.request.post(`/api/orgs/${id}/suppliers`, { data: { name: `Frío ${Date.now()}`, defaultCategory: 'refrigerado' }, headers: apiHeaders(page) });
  expect(sup.status()).toBe(201);
  const { supplier } = (await sup.json()) as { supplier: { id: string; name: string } };
  await page.goto(`${base}/registrar/recepcion`);
  await page.getByLabel('Proveedor').selectOption(supplier.id);
  await page.getByLabel('Producto').fill('Conservas');
  await page.getByRole('radio', { name: /Ambiente/ }).check({ force: true });
  await expect(page.getByText(`${supplier.name} suele traer producto refrigerado`)).toBeVisible();
  await page.getByRole('radio', { name: 'Sí, aceptada' }).check({ force: true });
  await page.getByRole('button', { name: /Guardar/ }).click();
  await expect(page.getByText('Explica por qué lo registras como ambiente')).toBeVisible();
  await page.getByLabel(/¿Por qué es ambiente\?/).fill('Hoy trae latas');
  await page.getByRole('button', { name: /Guardar/ }).click();
  await expect(page.getByRole('heading', { name: 'Hecho' })).toBeVisible();
  const recs = (await (await page.request.get(`/api/orgs/${id}/records?type=recepcion&limit=1`)).json()) as { items: { data: Record<string, unknown> }[] };
  expect(recs.items[0]!.data).toMatchObject({ category: 'ambiente', categoryDiffersFromSupplier: true, categoryReason: 'Hoy trae latas' });
});
