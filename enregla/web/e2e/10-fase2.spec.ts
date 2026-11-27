/**
 * Fase 2 (A1 y A2) de punta a punta: datos del establecimiento y PDF de inspección (portada, resumen,
 * verificación y «Página X de Y»), verificación del responsable desde Hoy e Informes, tareas sin
 * registrar por día, registros personalizados (sugerido con un toque y propio), cocinado y enfriamiento
 * en la web y en la tablet (teclado grande).
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect, login, apiHeaders, DEMO, expectNoSeriousA11yViolations } from './helpers';
import type { Browser, Page } from '@playwright/test';

test.describe.configure({ mode: 'serial' });

const RUNTIME = path.join(path.dirname(fileURLToPath(import.meta.url)), '.runtime');
const SHARED = path.join(RUNTIME, 'demo-state.json');
const STATE = path.join(RUNTIME, 'demo-state-10.json');
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

const shot = (p: Page, name: string) => p.screenshot({ path: path.join(RUNTIME, `10-${name}.png`), fullPage: false });

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
  const k = await tablet.newPage();
  await k.goto(`/cocina/vincular#token=${token}`);
  await expect(k.getByRole('heading', { name: 'Registrar' })).toBeVisible();
  return { tablet, k };
}
const keypad = async (k: Page, keys: string) => {
  for (const d of keys) await k.getByRole('button', { name: d === ',' ? 'Coma decimal' : d, exact: true }).click();
};

function pdfText(file: string): string {
  return execFileSync('pdftotext', ['-raw', '-enc', 'UTF-8', file, '-'], { encoding: 'utf8' }).replace(/\s+/g, ' ');
}

test('datos del establecimiento → PDF con portada, resumen, verificación, huecos, firma y «Página X de Y»', async ({ page }) => {
  const { base } = await demoOrg(page);
  // Hoy avisa de que la semana pasada está sin revisar (el seed deja la última semana sin revisar).
  await expect(page.getByTestId('review-notice')).toBeVisible();
  await shot(page, 'hoy-revision');
  await page.getByRole('link', { name: 'Revisar y marcar' }).click();
  await expect(page).toHaveURL(/informes/);
  const dlg = page.getByRole('dialog');
  await expect(dlg.getByRole('heading', { name: 'Marcar como revisado' })).toBeVisible();
  await expect(dlg.getByRole('radio', { name: /La semana pasada/ })).toBeChecked();
  await dlg.getByLabel(/Comentario/).fill('Revisadas las alertas con el equipo');
  await dlg.getByRole('button', { name: 'Marcar como revisado' }).click();
  await expect(page.getByText('Periodo marcado como revisado')).toBeVisible();
  await expect(page.getByTestId('verifications')).toContainText('Revisadas las alertas con el equipo');
  // Tareas sin registrar por día, desplegables.
  const days = page.getByTestId('missing-days');
  await expect(days).toBeVisible();
  await days.locator('summary').first().click();
  await expect(days.getByText(/^(Temperatura|Limpieza|Registro): /).first()).toBeVisible();
  await shot(page, 'informes');
  // axe, sin el aviso flotante a medio animar.
  await expect(page.getByText('Periodo marcado como revisado')).toHaveCount(0, { timeout: 8000 });
  await expectNoSeriousA11yViolations(page, 'Informes (fase 2)');
  // Hoy ya no avisa.
  await page.goto(`${base}/hoy`);
  await expect(page.getByRole('heading', { name: /Quedan|Todo hecho|Falta volver/ }).first()).toBeVisible();
  await expect(page.getByTestId('review-notice')).toHaveCount(0);

  // Datos del establecimiento: NIF con letra de control.
  await page.goto(`${base}/ajustes/local`);
  const form = page.getByTestId('establishment-form');
  await form.getByLabel('NIF / CIF').fill('B12345675');
  await form.getByRole('button', { name: 'Guardar datos del establecimiento' }).click();
  await expect(form.getByText('El carácter de control del CIF no es correcto')).toBeVisible();
  await form.getByLabel('NIF / CIF').fill('B12345674');
  await form.getByLabel('Razón social').fill('Restauración E2E S.L.');
  await form.getByRole('button', { name: 'Guardar datos del establecimiento' }).click();
  await expect(page.getByText('Datos del establecimiento guardados')).toBeVisible();
  await expect(page.getByText('Datos del establecimiento guardados')).toHaveCount(0, { timeout: 8000 });
  await expectNoSeriousA11yViolations(page, 'Ajustes del local (fase 2)');

  // PDF del último mes.
  await page.goto(`${base}/informes`);
  await page.getByRole('radio', { name: 'Últimos 30 días' }).click();
  const dl = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Informe PDF' }).click();
  const download = await dl;
  const dir = mkdtempSync(path.join(tmpdir(), 'enregla-e2e-pdf-'));
  try {
    const file = path.join(dir, 'r.pdf');
    await download.saveAs(file);
    const text = pdfText(file);
    expect(text).toContain('Razón social Restauración E2E S.L.');
    expect(text).toContain('NIF / CIF B12345674');
    expect(text).toContain('Resumen del periodo');
    expect(text).toMatch(/Verificado por .* · Comentario: «Revisadas las alertas con el equipo»/);
    expect(text).toContain('Tareas sin registrar');
    expect(text).toContain('Revisión y firma del responsable');
    expect(text).toMatch(/Página 1 de (\d+)/);
    const total = /Página 1 de (\d+)/.exec(text)![1];
    expect(text).toContain(`Página ${total} de ${total}`);
    expect(text).toContain('Cocinado y regeneración');
    expect(text).toContain('Enfriamiento rápido');
    expect(text).toContain('Registros personalizados');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('registros personalizados: sugerido con un toque, propio, y registro desde Hoy', async ({ page }) => {
  const { base } = await demoOrg(page);
  await page.goto(`${base}/ajustes/registros`);
  await expect(page.getByRole('heading', { name: 'Registros personalizados', level: 1 })).toBeVisible();
  // El seed ya trae el cloro; se activa «Mantenimiento» con un toque.
  const sug = page.getByTestId('suggestion-mantenimiento');
  await sug.getByRole('button', { name: 'Activar' }).click();
  await expect(page.getByText('«Mantenimiento de instalaciones y equipos» activado')).toBeVisible();
  await expect(sug.getByText('Activado')).toBeVisible();
  // Uno propio: sí/no diario.
  await page.getByRole('button', { name: 'Nuevo registro' }).click();
  const dlg = page.getByRole('dialog');
  await dlg.getByLabel('Nombre').fill('¿Hay jabón y papel en el lavamanos?');
  await dlg.getByText('Sí / No', { exact: true }).click();
  await dlg.getByRole('button', { name: 'Guardar' }).click();
  await expect(page.getByTestId('custom-templates')).toContainText('¿Hay jabón y papel en el lavamanos?');
  await expect(page.getByText('Registro personalizado creado')).toHaveCount(0, { timeout: 8000 });
  await shot(page, 'registros-personalizados');
  await expectNoSeriousA11yViolations(page, 'Registros personalizados');
  // Registrar: «No» exige acción correctora y deja alerta.
  await page.goto(`${base}/registrar/personalizado`);
  await page.getByLabel('Registro').selectOption({ label: '¿Hay jabón y papel en el lavamanos?' });
  await page.getByText('No', { exact: true }).click();
  await page.getByRole('button', { name: 'Corregido en el momento' }).click();
  await page.getByRole('button', { name: 'Guardar con acción correctora' }).click();
  await expect(page.getByTestId('record-saved')).toContainText('Guardado, con alerta');
});

test('cocinado y enfriamiento en la web: alerta por debajo de la referencia; enfriamiento en curso en Hoy y cierre', async ({ page }) => {
  const { base } = await demoOrg(page);
  await page.goto(`${base}/registrar/cocinado`);
  await page.getByLabel('Producto', { exact: true }).fill('Pollo asado e2e');
  await page.getByText('Cocinado', { exact: true }).click();
  await page.getByLabel(/Temperatura en el centro del producto/).fill('60');
  await expect(page.getByText('60 °C: no llega a 65 °C')).toBeVisible();
  await page.getByRole('button', { name: 'Se prolongó la cocción hasta alcanzar la temperatura' }).click();
  await page.getByRole('button', { name: 'Guardar con acción correctora' }).click();
  await expect(page.getByTestId('record-saved')).toContainText('Guardado, con alerta');

  await page.goto(`${base}/registrar/enfriamiento`);
  const nueva = page.getByText('Empezar un enfriamiento nuevo');
  await expect(page.getByLabel('Producto', { exact: true }).or(nueva)).toBeVisible();
  if (await nueva.isVisible()) await nueva.click();
  await page.getByLabel('Producto', { exact: true }).fill('Caldo e2e');
  await page.getByLabel(/Temperatura al empezar/).fill('78');
  await page.getByRole('button', { name: 'Empezar el enfriamiento' }).click();
  await expect(page.getByTestId('cooling-started')).toBeVisible();
  await page.goto(`${base}/hoy`);
  const card = page.getByTestId('coolings').getByRole('link', { name: /Caldo e2e/ });
  await expect(card).toBeVisible();
  await shot(page, 'hoy-enfriamiento');
  await card.click();
  await page.getByLabel(/Temperatura al terminar/).fill('6');
  await expect(page.getByText(/cumple el criterio/)).toBeVisible();
  await page.getByRole('button', { name: 'Terminar el enfriamiento' }).click();
  await expect(page.getByTestId('record-saved')).toContainText('Hecho');
  await page.goto(`${base}/hoy`);
  await expect(page.getByTestId('coolings').getByText('Caldo e2e')).toHaveCount(0);
});

test('tablet: cocinado con el teclado grande y enfriamiento en curso hasta cerrarlo', async ({ page, browser }) => {
  const { id } = await demoOrg(page);
  const { tablet, k } = await openTablet(page, browser, id, `Tablet fase 2 ${Date.now()}`);
  await k.getByRole('button', { name: 'Cocinado', exact: true }).click();
  await k.getByRole('button', { name: /Ana Martín/ }).click();
  await keypad(k, '1234');
  await k.getByRole('button', { name: 'Entrar' }).click();
  await k.getByLabel('Producto', { exact: true }).fill('Croquetas tablet');
  await k.getByText('Cocinado', { exact: true }).click();
  await keypad(k, '72,5');
  await expect(k.getByTestId('value-coreTemp')).toContainText('72,5');
  await k.getByRole('button', { name: 'Guardar' }).click();
  await expect(k.getByTestId('kiosk-result')).toContainText('Croquetas tablet');
  await expect(k.getByTestId('kiosk-saved-by')).toContainText('Ana Martín');
  await k.getByRole('button', { name: 'Seguir' }).click();
  // Enfriamiento: empezar en la tablet y aparece «en curso» en la pantalla de inicio.
  await k.getByRole('button', { name: 'Enfriamiento', exact: true }).click();
  const nueva = k.getByText('Empezar un enfriamiento nuevo');
  await expect(k.getByLabel('Producto', { exact: true }).or(nueva)).toBeVisible();
  if (await nueva.isVisible()) await nueva.click();
  await k.getByLabel('Producto', { exact: true }).fill('Fondo tablet');
  await keypad(k, '80');
  await k.getByRole('button', { name: 'Empezar el enfriamiento' }).click();
  await expect(k.getByTestId('kiosk-result')).toContainText('Enfriamiento empezado');
  await k.getByRole('button', { name: 'Seguir' }).click();
  const tile = k.getByTestId('kiosk-coolings').getByRole('button', { name: /Terminar: Fondo tablet/ });
  await expect(tile).toBeVisible();
  await k.screenshot({ path: path.join(RUNTIME, '10-tablet-inicio.png') });
  await tile.click();
  // La persona sigue identificada unos segundos («Seguir como…») o se vuelve a pedir.
  const who = k.getByRole('heading', { name: '¿Quién eres?' });
  if (await who.isVisible().catch(() => false)) {
    await k.getByRole('button', { name: /Luis Pérez/ }).click();
  }
  await keypad(k, '5');
  await k.getByRole('button', { name: 'Terminar el enfriamiento' }).click();
  await expect(k.getByTestId('kiosk-result')).toContainText('Fondo tablet');
  await k.getByRole('button', { name: 'Seguir' }).click();
  await expect(k.getByTestId('kiosk-coolings').getByText('Fondo tablet')).toHaveCount(0);
  await tablet.close();
});
