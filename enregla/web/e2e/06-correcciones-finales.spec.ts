import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect, createLongNameOrg, createVerifiedAccount, login, apiHeaders, seedInfo, DEMO } from './helpers';
import type { Page } from '@playwright/test';

test.describe.configure({ mode: 'serial' });

// Una sola sesión del demo para todo el fichero: el servidor limita los inicios de sesión por cuenta e IP
// (10 cada 15 min) y toda la suite comparte la cuenta demo.
const STATE = path.join(path.dirname(fileURLToPath(import.meta.url)), '.runtime', 'demo-state.json');
test.beforeAll(async ({ browser }) => {
  const ctx = await browser.newContext({ baseURL: `http://localhost:${process.env.E2E_PORT ?? '3100'}`, locale: 'es-ES', storageState: { cookies: [], origins: [] } });
  await login(await ctx.newPage(), DEMO.email, DEMO.password);
  await ctx.storageState({ path: STATE });
  await ctx.close();
});
test.use({ storageState: STATE });

const SIZES = [
  { width: 320, height: 640 },
  { width: 390, height: 844 },
];

async function noHorizontalOverflow(page: Page, label: string) {
  await page.waitForLoadState('networkidle');
  const m = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  expect.soft(m.sw, `${label}: scrollWidth ${m.sw} > clientWidth ${m.cw}`).toBeLessThanOrEqual(m.cw);
}

/** En la cabecera del modo cocina, el botón del local y el de «¿Quién eres?»/persona no pueden solaparse. */
async function noHeaderOverlap(page: Page, label: string) {
  const name = await page.locator('header button .truncate').first().boundingBox();
  const who = await page.locator('header button').nth(1).boundingBox();
  expect.soft(name && who && name.x + name.width <= who.x + 1, `${label}: el nombre del local se solapa con el botón de persona`).toBe(true);
}

test('nombre de local de 100 caracteres sin espacios: ninguna pantalla desborda a 320 y 390 px', async ({ page }) => {
  test.setTimeout(240_000);
  await page.goto('/app');
  await page.waitForURL(/\/hoy$/);
  const org = await createLongNameOrg(page);
  const base = `/locales/${org.id}`;
  const routes = [
    'hoy',
    'registrar',
    'registrar/temperatura',
    'registrar/recepcion',
    'registrar/aceite',
    'registrar/limpieza',
    'historial',
    'alergenos',
    'alergenos/imprimir',
    'informes',
    'facturacion',
    'ajustes',
    'ajustes/local',
    'ajustes/equipos',
    'ajustes/limpieza',
    'ajustes/proveedores',
    'ajustes/personal',
    'ajustes/cocina',
    'ajustes/equipo',
    'ajustes/auditoria',
    'ajustes/datos',
    'ajustes/cuenta',
  ];
  const kiosk = async () => {
    await page.goto(`/cocina/vincular#token=${org.kioskToken}`);
    await page.waitForURL(/\/cocina$/);
    await expect(page.getByRole('heading', { name: /Nada programado|Quedan|Queda|Todo hecho/ })).toBeVisible();
  };
  for (const size of SIZES) {
    await page.setViewportSize(size);
    for (const r of routes) {
      await page.goto(`${base}/${r}`);
      await page.waitForSelector('main');
      await noHorizontalOverflow(page, `${size.width}px /${r}`);
    }
    // Carta pública
    await page.goto(`/carta/${org.publicMenu.slug}`);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await noHorizontalOverflow(page, `${size.width}px carta pública`);
    // Modo cocina: inicio, ¿Quién eres?, persona elegida (cabecera con nombre del local y botón de persona)
    await kiosk();
    await noHorizontalOverflow(page, `${size.width}px cocina inicio`);
    await noHeaderOverlap(page, `${size.width}px cocina sin persona`);
    await page.getByRole('button', { name: /¿Quién eres\?/ }).click();
    await noHorizontalOverflow(page, `${size.width}px cocina quién eres`);
    // Las tarjetas de personal tienen todas la misma altura (con o sin PIN, con nombre corto o largo)
    const heights = await page.locator('main ul li button').evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().height)));
    expect(heights.length, 'hay al menos dos personas').toBeGreaterThan(1);
    expect(new Set(heights).size, `alturas de tarjetas de personal: ${heights.join(', ')}`).toBe(1);
    await page.getByRole('button', { name: /Ana Prueba/ }).click();
    await noHorizontalOverflow(page, `${size.width}px cocina con persona`);
    await noHeaderOverlap(page, `${size.width}px cocina con persona`);
    await page.goto('/');
    await page.evaluate(() => localStorage.clear());
  }
  // Local pendiente de eliminación (aviso persistente) con el mismo nombre
  await page.setViewportSize(SIZES[0]!);
  const del = await page.request.delete(`/api/orgs/${org.id}`, { data: { password: DEMO.password }, headers: apiHeaders(page) });
  expect(del.status()).toBeLessThan(300);
  for (const r of ['hoy', 'ajustes/datos', 'facturacion']) {
    await page.goto(`${base}/${r}`);
    await page.waitForSelector('main');
    await noHorizontalOverflow(page, `320px pendiente de eliminación /${r}`);
  }
});

const goDemoOrg = async (page: Page) => {
  await page.goto('/app');
  await page.waitForURL(/\/hoy$/);
  return page.url().replace(/\/hoy$/, '');
};

test('historial: «Desde» posterior a «Hasta» muestra el error y NO deja la lista anterior', async ({ page }) => {
  const org = await goDemoOrg(page);
  await page.goto(`${org}/historial`);
  await expect(page.getByRole('list').first()).toBeVisible();
  await expect(page.getByText('No hay más registros.').or(page.getByRole('button', { name: 'Cargar más' }))).toBeVisible();
  await page.getByLabel('Desde').fill('2026-11-05');
  await page.getByLabel('Hasta').fill('2026-11-01');
  await expect(page.getByText('La fecha «desde» debe ser anterior a «hasta»').first()).toBeVisible();
  await expect(page.getByText('Corrige las fechas para ver los registros')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Cargar más' })).toHaveCount(0);
  await expect(page.getByText('No hay más registros.')).toHaveCount(0);
  await expect(page.locator('main a[href*="/historial/"]')).toHaveCount(0);
  // El mensaje persiste al seguir editando la fecha con el mismo error
  await page.getByLabel('Desde').fill('2026-11-06');
  await expect(page.getByText('La fecha «desde» debe ser anterior a «hasta»').first()).toBeVisible();
  await page.getByLabel('Hasta').fill('2026-11-09');
  await expect(page.getByText('Corrige las fechas para ver los registros')).toHaveCount(0);
});

test('temperatura 999 → Backspace → 9: el aviso y el borde de error siguen visibles', async ({ page }) => {
  const org = await goDemoOrg(page);
  await page.goto(`${org}/registrar/temperatura`);
  await page.locator('label').filter({ hasText: 'máx. 4 °C' }).first().click();
  const t = page.getByLabel('Temperatura (°C)');
  await t.pressSequentially('999');
  await expect(page.getByText('La temperatura debe estar entre −60 y 300 °C')).toBeVisible();
  await page.keyboard.press('Backspace');
  await expect(page.getByText('La temperatura debe estar entre')).toHaveCount(0);
  await page.keyboard.type('9');
  await expect(page.getByText('La temperatura debe estar entre −60 y 300 °C')).toBeVisible();
  await expect(t).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByRole('button', { name: /Guardar/ })).toBeDisabled();
  await t.fill('−99');
  await expect(page.getByText('La temperatura debe estar entre −60 y 300 °C')).toBeVisible();
  await t.pressSequentially('9');
  await expect(page.getByText('La temperatura debe estar entre −60 y 300 °C')).toBeVisible();
  await expect(t).toHaveAttribute('aria-invalid', 'true');
});

test('aceite 27,5 % se ve como 27,5 % en el historial y en la confirmación de modo cocina; Hoy refresca al volver', async ({ page, browser }) => {
  const org = await goDemoOrg(page);
  await page.goto(`${org}/registrar/aceite`);
  await page.getByLabel('Freidora').selectOption({ index: 1 });
  await page.getByText('Cambiado', { exact: true }).click();
  await page.getByLabel(/Compuestos polares/).fill('27,5');
  await page.getByRole('button', { name: 'Aceite cambiado' }).click();
  await page.getByRole('button', { name: /Guardar/ }).click();
  await expect(page.getByText('Guardado, con alerta')).toBeVisible();
  await expect(page.getByText(/27,5\u202F% de compuestos polares/)).toBeVisible();
  await page.goto(`${org}/historial?tipo=aceite`);
  await expect(page.getByText(/27,5\u202F% de compuestos polares/).first()).toBeVisible();
  await expect(page.getByText(/28\u202F% de compuestos polares/)).toHaveCount(0);
  await page.locator('main a[href*="/historial/"]').first().click();
  await expect(page.getByText('27,5\u202F%').first()).toBeVisible();

  // Modo cocina (otra persona, sin PIN)
  const ctx = await browser.newContext({ viewport: { width: 1024, height: 768 }, locale: 'es-ES' });
  const k = await ctx.newPage();
  const { kioskToken } = seedInfo();
  await k.goto(`/cocina/vincular#token=${kioskToken}`);
  await k.waitForURL(/\/cocina$/);
  await k.getByRole('button', { name: /Aceite/ }).click();
  await k.getByRole('button', { name: /Luis Pérez/ }).click();
  await k.getByLabel('Freidora').selectOption({ index: 1 });
  await k.getByText('Cambiado', { exact: true }).click();
  await k.getByLabel(/Compuestos polares/).fill('27,5');
  await k.getByRole('button', { name: 'Aceite cambiado' }).click();
  await k.getByRole('button', { name: /Guardar/ }).click();
  await expect(k.getByTestId('kiosk-result')).toContainText('27,5\u202F% de compuestos polares');
  await expect(k.getByTestId('kiosk-result')).not.toContainText('28\u202F%');
  await ctx.close();
});

test('Hoy se refresca al volver a la pestaña (visibilitychange)', async ({ page }) => {
  const org = await goDemoOrg(page);
  await page.goto(`${org}/hoy`);
  await expect(page.getByText(/Quedan \d+ de \d+|Todo hecho|Sin tareas|Nada obligatorio/).first()).toBeVisible();
  await page.waitForLoadState('networkidle');
  const req = page.waitForRequest((r) => /\/tasks\/today/.test(r.url()), { timeout: 5000 });
  await page.evaluate(() => {
    // Igual que el navegador real: el evento burbujea del documento a la ventana.
    document.dispatchEvent(new Event('visibilitychange', { bubbles: true }));
  });
  await req;
});

test('modo cocina: «Queda 1 tarea» en singular', async ({ page }) => {
  const { kioskToken } = seedInfo();
  await page.route('**/api/kiosk/tasks/today', async (route) => {
    const res = await route.fetch();
    const body = await res.json();
    body.summary = { ...body.summary, total: 3, done: 2, pending: 1, percent: 67 };
    await route.fulfill({ response: res, json: body });
  });
  await page.goto(`/cocina/vincular#token=${kioskToken}`);
  await page.waitForURL(/\/cocina$/);
  await expect(page.getByRole('heading', { name: 'Queda 1 tarea' })).toBeVisible();
});

test('recepción: aceptar caducada no sugiere devolver/desechar; rechazar sí', async ({ page }) => {
  const org = await goDemoOrg(page);
  await page.goto(`${org}/registrar/recepcion`);
  await page.getByLabel(/Fecha de caducidad/).fill('2026-01-01');
  await page.getByText('Sí, aceptarla con motivo').click();
  await expect(page.getByRole('button', { name: 'Se devuelve al proveedor' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Se desecha' })).toHaveCount(0);
  await page.getByText('No, rechazada').click();
  await expect(page.getByRole('button', { name: 'Se devuelve al proveedor' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Se desecha' })).toBeVisible();
});

test('local pendiente de eliminación: Hoy deshabilita «Temperatura» y «Otro registro» con explicación', async ({ page }) => {
  await page.goto('/app');
  await page.waitForURL(/\/hoy$/);
  const h = apiHeaders(page);
  const created = await page.request.post('/api/orgs', { data: { name: 'Local para eliminar (Hoy)', businessType: 'bar' }, headers: h });
  const { organization } = (await created.json()) as { organization: { id: string } };
  await page.goto(`/locales/${organization.id}/hoy`);
  await expect(page.getByRole('link', { name: 'Temperatura' }).first()).toBeVisible();
  expect((await page.request.delete(`/api/orgs/${organization.id}`, { data: { password: DEMO.password }, headers: h })).status()).toBeLessThan(300);
  await page.reload();
  await expect(page.getByTestId('deletion-banner')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Temperatura' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Otro registro' })).toBeDisabled();
  await expect(page.getByTestId('hoy-bloqueado')).toContainText('pendiente de eliminación');
  await expect(page.getByRole('link', { name: 'Temperatura' })).toHaveCount(0);
});

test.describe('cuenta nueva', () => {
  test.use({ storageState: { cookies: [], origins: [] } });
  test('segundo local: explica la prueba compartida; el alta a medias se puede retomar desde Hoy; la tablet es opcional', async ({ page }) => {
    const email = `alta-${Date.now()}@example.com`;
    const pw = 'Cocina-Limpia-2026!';
    await createVerifiedAccount(page, email, pw, 'Alta Prueba');
    await login(page, email, pw);
    await expect(page).toHaveURL(/\/nuevo-local/);
    await page.getByLabel('Nombre del local').fill('Primer local');
    await page.getByText('Bar', { exact: true }).click();
    await page.getByRole('button', { name: 'Crear local y continuar' }).click();
    await expect(page.getByRole('heading', { name: 'Revisa tus equipos' })).toBeVisible();
    // Se abandona a medias
    await page.getByRole('link', { name: 'Salir del asistente' }).click();
    await expect(page).toHaveURL(/\/hoy$/);
    const notice = page.getByText('Termina de configurar tu local');
    await expect(notice).toBeVisible();
    await page.getByRole('link', { name: 'Continuar la configuración' }).click();
    await expect(page).toHaveURL(/paso=2/);
    await expect(page.getByRole('heading', { name: 'Revisa tus equipos' })).toBeVisible();
    await page.getByRole('button', { name: 'Siguiente' }).click();
    await page.getByRole('button', { name: 'Siguiente' }).click();
    await page.getByRole('button', { name: 'Terminar' }).click();
    await expect(page.getByRole('heading', { name: '¡Tu local está listo!' })).toBeVisible();
    await expect(page.getByText(/Vincular una tablet o un móvil de cocina es opcional/)).toBeVisible();
    await expect(page.getByRole('link', { name: /Vincular una tablet de cocina \(opcional\)/ })).toBeVisible();
    await page.getByRole('button', { name: 'Ir al panel de hoy' }).click();
    await expect(page.getByText('Termina de configurar tu local')).toHaveCount(0);
    // Segundo local: el texto dice qué pasa con la prueba
    await page.goto('/nuevo-local');
    await expect(page.getByText(/comparte la fecha de fin de prueba de tu cuenta/)).toBeVisible();
  });

});

test('formularios: email inválido se señala en el email; PIN de más de 6 cifras avisa; trazas legibles en papel', async ({ page }) => {
  const org = await goDemoOrg(page);
  await page.goto(`${org}/ajustes/cuenta`);
  await page.getByLabel('Nuevo email').fill('esto-no-es-un-email');
  await page.getByLabel('Contraseña actual').first().fill('lo-que-sea');
  await page.getByRole('button', { name: 'Enviar enlace de confirmación' }).click();
  await expect(page.getByLabel('Nuevo email')).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByText('Escribe un email válido (por ejemplo, nombre@dominio.es)')).toBeVisible();

  await page.goto(`${org}/ajustes/personal`);
  await page.getByRole('button', { name: /Añadir persona/ }).first().click();
  const dlg = page.getByRole('dialog');
  await dlg.getByLabel(/PIN/).pressSequentially('1234567');
  await expect(dlg.getByText('El PIN tiene como máximo 6 cifras.')).toBeVisible();
  await expect(dlg.getByLabel(/PIN/)).toHaveValue('123456');

  await page.goto(`${org}/alergenos/imprimir`);
  await expect(page.getByTestId('print-legend')).toContainText('Puede contener trazas');
  const box = await page.getByTestId('trace-mark').first().boundingBox();
  expect(box!.width, 'el marcador de trazas debe ser legible (≥ 16 px)').toBeGreaterThanOrEqual(16);
  expect(box!.height).toBeGreaterThanOrEqual(16);
});
