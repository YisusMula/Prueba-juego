/**
 * Fase 1 del plan de comercialización, de punta a punta contra el servidor real:
 * corregir en la tablet, «Seguir como», salir del modo cocina con contraseña, recepción fuera de
 * límite, «Hecho con alerta» / «Volver a medir» y la firma «anotado por» y el autor de la
 * corrección en el PDF.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect, login, apiHeaders, DEMO } from './helpers';
import type { Browser, Page } from '@playwright/test';

test.describe.configure({ mode: 'serial' });

// Se reutiliza la sesión del demo de 06 si sigue valiendo: el servidor limita los inicios de sesión
// por cuenta e IP (10 / 15 min) y toda la suite comparte la cuenta demo.
const RUNTIME = path.join(path.dirname(fileURLToPath(import.meta.url)), '.runtime');
const SHARED = path.join(RUNTIME, 'demo-state.json');
const STATE = path.join(RUNTIME, 'demo-state-07.json');
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

const goDemoOrg = async (page: Page) => {
  await page.goto('/app');
  await page.waitForURL(/\/hoy$/);
  const base = page.url().replace(/\/hoy$/, '');
  return { base, id: base.split('/locales/')[1]! };
};

/** Tablet nueva (sin sesión de usuario) vinculada al local demo. */
async function openTablet(page: Page, browser: Browser, orgId: string, name: string) {
  const dev = await page.request.post(`/api/orgs/${orgId}/devices`, { data: { name }, headers: apiHeaders(page) });
  expect(dev.status()).toBe(201);
  const { token } = (await dev.json()) as { token: string };
  const tablet = await browser.newContext({ viewport: { width: 1024, height: 768 }, locale: 'es-ES', storageState: { cookies: [], origins: [] } });
  const k = await tablet.newPage();
  await k.goto(`/cocina/vincular#token=${token}`);
  await expect(k).toHaveURL(/\/cocina$/);
  await expect(k.getByRole('heading', { name: 'Registrar' })).toBeVisible();
  return { tablet, k };
}

const keypad = async (k: Page, digits: string) => {
  for (const d of digits) await k.getByRole('button', { name: d, exact: true }).click();
};

function pdfText(buf: Buffer): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'enregla-e2e-'));
  try {
    const f = path.join(dir, 'r.pdf');
    writeFileSync(f, buf);
    return execFileSync('pdftotext', ['-raw', '-enc', 'UTF-8', f, '-'], { encoding: 'utf8' }).replace(/\s+/g, ' ');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('tablet: «Guardado por», varias acciones, «Hecho con alerta» / «Volver a medir» y «Corregir» durante 2 minutos', async ({ page, browser }) => {
  const { base, id } = await goDemoOrg(page);
  const { tablet, k } = await openTablet(page, browser, id, 'Tablet fase 1');

  // Luis (sin PIN) registra 9 °C en la cámara: fuera de rango, con dos acciones a la vez.
  await k.getByRole('button', { name: 'Temperatura', exact: true }).click();
  await k.getByRole('button', { name: /Luis Pérez/ }).click();
  await expect(k.getByTestId('kiosk-signing-as')).toContainText('Registrando como Luis Pérez');
  await k.getByRole('button', { name: /Cámara de verduras/ }).click();
  await keypad(k, '9');
  await k.getByRole('button', { name: 'Siguiente' }).click();
  await k.getByRole('button', { name: 'Puerta cerrada y revisada' }).click();
  await k.getByRole('button', { name: 'Repetiré la medición en 30 min' }).click();
  await k.getByRole('button', { name: 'Guardar con esta acción' }).click();
  const result = k.getByTestId('kiosk-result');
  await expect(result).toContainText('Guardado con alerta');
  await expect(result.getByTestId('kiosk-saved-by')).toHaveText('Guardado por Luis Pérez');
  await expect(result.getByRole('button', { name: /Seguir como Luis Pérez/ })).toBeVisible();

  // Inicio de la tablet: el equipo pide «Volver a medir» y en la web sale «Hecho con alerta» o pendiente.
  await result.getByRole('button', { name: /Seguir como Luis Pérez/ }).click();
  await expect(k.getByRole('button', { name: /Volver a medir: Cámara de verduras/ })).toBeVisible();
  await page.goto(`${base}/hoy`);
  await expect(page.getByRole('link', { name: /Volver a medir: Cámara de verduras/ })).toBeVisible();

  // «Corregir» (2 minutos): me equivoqué de número → 2,9 °C. No se borra: queda una corrección.
  await expect(k.getByTestId('kiosk-recent')).toContainText('Cámara de verduras');
  await k.getByTestId('kiosk-recent').getByRole('button', { name: 'Corregir' }).click();
  await k.getByRole('button', { name: 'Me equivoqué de número' }).click();
  await keypad(k, '2');
  await k.getByRole('button', { name: 'Coma decimal' }).click();
  await keypad(k, '9');
  await k.getByRole('button', { name: 'Guardar corrección' }).click();
  await expect(k.getByTestId('kiosk-result')).toContainText('Corrección guardada');
  await expect(k.getByTestId('kiosk-result')).toContainText('Me equivoqué de número');

  // La web: «Volver a medir» desaparece (la versión vigente está en rango) y el historial enlaza las dos versiones.
  await page.reload();
  await expect(page.getByRole('link', { name: /Volver a medir: Cámara de verduras/ })).toHaveCount(0);
  const recs = (await (await page.request.get(`/api/orgs/${id}/records?type=temperatura&limit=5`)).json()) as { items: { id: string; amendsRecordId: string | null; correctedBy: string | null; data: { value: number } }[] };
  const amended = recs.items.find((r) => r.amendsRecordId)!;
  expect(amended.data.value).toBe(2.9);
  expect(amended.correctedBy).toBe('Luis Pérez');
  expect(recs.items.findIndex((r) => r.id === amended.amendsRecordId)).toBeLessThan(recs.items.indexOf(amended));
  await tablet.close();
});

test('tablet: salir del modo cocina pide la contraseña de un responsable y no lleva a la portada', async ({ page, browser }) => {
  const { id } = await goDemoOrg(page);
  const { tablet, k } = await openTablet(page, browser, id, 'Tablet salida');
  await k.getByRole('button', { name: /Salir del modo cocina/ }).click();
  await k.getByLabel(/Email del propietario o encargado/).fill(DEMO.email);
  await k.getByLabel('Contraseña').fill('no-es-la-contraseña');
  await k.getByRole('button', { name: 'Salir del modo cocina' }).click();
  await expect(k.getByText(/Email o contraseña incorrectos/)).toBeVisible();
  await k.getByLabel('Contraseña').fill(DEMO.password);
  await k.getByRole('button', { name: 'Salir del modo cocina' }).click();
  await expect(k.getByTestId('kiosk-exited')).toContainText('Modo cocina cerrado');
  await expect(k).toHaveURL(/\/cocina$/);
  await expect(k.getByRole('link', { name: /Entrar como encargado/ })).toHaveAttribute('href', '/entrar');
  await k.getByRole('button', { name: 'Volver al modo cocina' }).click();
  await expect(k.getByRole('heading', { name: 'Registrar' })).toBeVisible();
  // Desvincular también exige la contraseña y revoca el dispositivo en el servidor.
  await k.getByRole('button', { name: /Desvincular esta tablet/ }).click();
  await k.getByLabel(/Email del propietario o encargado/).fill(DEMO.email);
  await k.getByLabel('Contraseña').fill(DEMO.password);
  await k.getByRole('button', { name: 'Desvincular' }).click();
  await expect(k.getByRole('heading', { name: 'Vincular esta tablet', exact: true })).toBeVisible();
  const devices = (await (await page.request.get(`/api/orgs/${id}/devices`)).json()) as { items: { name: string; active: boolean }[] };
  expect(devices.items.find((d) => d.name === 'Tablet salida')!.active).toBe(false);
  await tablet.close();
});

test('web: recepción a 6 °C de un proveedor refrigerado: aviso, acción obligatoria y alerta', async ({ page }) => {
  const { base } = await goDemoOrg(page);
  await page.goto(`${base}/registrar/recepcion`);
  await page.getByLabel('Proveedor').selectOption({ label: 'Pescados del Puerto' });
  await expect(page.getByRole('radio', { name: /Refrigerado/ })).toBeChecked();
  await expect(page.getByLabel(/Temperatura máxima admisible/)).toHaveValue('4');
  await page.getByLabel('Producto').fill('Merluza');
  await page.getByLabel(/Temperatura al recibir/).fill('6');
  await expect(page.getByText('6 °C está fuera del límite (máx. 4 °C)')).toBeVisible();
  await page.getByText('Sí, aceptarla con motivo').click();
  await page.getByRole('button', { name: 'Guardar registro' }).click();
  await expect(page.getByText(/indica qué has hecho o por qué la aceptas/)).toBeVisible();
  await page.getByRole('button', { name: 'Se usa de inmediato' }).click();
  await page.getByRole('button', { name: 'Guardar registro' }).click();
  await expect(page.getByTestId('record-saved')).toContainText('Guardado, con alerta');
  await expect(page.getByTestId('record-saved')).toContainText('Aceptada con alerta');
});

test('PDF: «Ana Martín (anotado por Usuario Demo)», «Firmó · Corrigió» y la nota exacta de conservación', async ({ page }) => {
  const { base, id } = await goDemoOrg(page);
  // Registro web a nombre de una empleada (sin su PIN): consta quién lo anotó.
  await page.goto(`${base}/registrar/temperatura`);
  await page.getByText('Mesa caliente').click();
  await page.getByLabel('Temperatura (°C)').fill('70');
  await page.getByLabel(/¿Quién lo ha hecho\?/).selectOption({ label: 'Ana Martín' });
  await page.getByRole('button', { name: 'Guardar temperatura' }).click();
  await expect(page.getByTestId('record-saved')).toBeVisible();
  await page.getByRole('link', { name: 'Ver el registro' }).click();
  await expect(page.getByTestId('record-signature')).toHaveText('Ana Martín (anotado por Usuario Demo)');
  // Corrección web cambiando el firmante (con motivo).
  await page.getByRole('button', { name: 'Corregir' }).click();
  await page.locator('select[name="amend-staff"]').selectOption({ label: 'Marta Gil' });
  await page.getByLabel('Motivo de la corrección').fill('La medición la hizo Marta');
  await page.getByRole('button', { name: 'Guardar corrección' }).click();
  await expect(page.getByText('Corrección guardada')).toBeVisible();
  await expect(page.getByText(/Firmó: Marta Gil · Corrigió: Usuario Demo/)).toBeVisible();

  const today = (await (await page.request.get(`/api/orgs/${id}/tasks/today`)).json()) as { date: string };
  const res = await page.request.get(`/api/orgs/${id}/reports/pdf?from=${today.date}&to=${today.date}`);
  expect(res.status()).toBe(200);
  const text = pdfText(await res.body());
  expect(text).toContain('Ana Martín (anotado por Usuario Demo)');
  expect(text).toMatch(/Firmó: Marta Gil · Corrigió: Usuario Demo el \d/);
  expect(text).toContain('Firmante anterior: Ana Martín');
  expect(text).toMatch(/Firmó: Luis Pérez · Corrigió: Luis Pérez el .* Motivo: Me equivoqué de número/);
  expect(text).toContain('6 °C (Refrigerado, máx. 4 °C)');
  expect(text).toContain('La aplicación no permite modificar ni borrar registros');
  expect(text).not.toContain('Los registros no se pueden modificar ni borrar');
  // Original antes que su corrección (comparten la hora del hecho).
  expect(text.indexOf('Ana Martín (anotado por Usuario Demo)')).toBeLessThan(text.indexOf('Firmó: Marta Gil'));
  expect(text.indexOf('Motivo: Me equivoqué de número')).toBeGreaterThan(-1);
});
