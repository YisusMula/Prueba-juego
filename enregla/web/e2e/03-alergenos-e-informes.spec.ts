import { test, expect, login, logout } from './helpers';

test('alérgenos: alta de plato y carta pública con filtro', async ({ page, browser }) => {
  await login(page);
  await page.getByRole('link', { name: 'Alérgenos' }).first().click();
  await page.getByRole('button', { name: 'Añadir plato' }).click();
  const dlg = page.getByRole('dialog');
  await dlg.getByLabel('Nombre del plato').fill('Tarta de queso E2E');
  await dlg.getByLabel(/Categoría/).fill('Postres');
  await dlg.getByRole('radio', { name: 'Cereales que contienen gluten: Contiene' }).click();
  await dlg.getByRole('radio', { name: 'Leche: Contiene' }).click();
  await dlg.getByRole('radio', { name: 'Frutos de cáscara: Puede contener trazas' }).click();
  await dlg.getByRole('button', { name: 'Guardar plato' }).click();
  const item = page.locator('li').filter({ hasText: 'Tarta de queso E2E' });
  await expect(item).toContainText('Gluten');
  await expect(item).toContainText('Trazas: frutos de cáscara');

  await expect(page.getByRole('img', { name: 'Código QR de la carta pública' })).toBeVisible();
  const url = (await page.getByTestId('public-menu-url').textContent())!.trim();
  expect(url).toMatch(/\/carta\/[A-Za-z0-9_-]+$/);

  const guest = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'es-ES' });
  const g = await guest.newPage();
  const external: string[] = [];
  g.on('request', (r) => {
    if (!r.url().startsWith('http://localhost')) external.push(r.url());
  });
  await g.goto(url);
  await expect(g.getByRole('heading', { name: 'Restaurante La Demo' })).toBeVisible();
  const card = g.locator('li').filter({ hasText: 'Tarta de queso E2E' });
  await expect(card).toBeVisible();
  await g.getByRole('button', { name: 'Gluten', exact: true }).click();
  await expect(card).toContainText('No apto');
  await g.getByLabel('Ocultar platos que lo contienen').check();
  await expect(card).toHaveCount(0);
  expect(external).toEqual([]);
  await guest.close();

  await page.getByRole('link', { name: 'Imprimir tabla' }).click();
  await expect(page.getByRole('heading', { name: 'Información de alérgenos' })).toBeVisible();
  await expect(page.getByRole('rowheader', { name: /Tarta de queso E2E/ })).toBeVisible();
});

test('informes: descarga de PDF y CSV y resumen de cumplimiento', async ({ page }) => {
  await login(page);
  await page.getByRole('link', { name: 'Informes' }).first().click();
  await expect(page.getByText(/tareas hechas/).first()).toBeVisible();
  await expect(page.getByRole('img', { name: /Porcentaje de tareas hechas por día/ })).toBeVisible();

  let dl = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Informe PDF' }).click();
  let file = await dl;
  expect(file.suggestedFilename()).toMatch(/^registros-.*\.pdf$/);
  const pdfPath = await file.path();
  const { readFileSync } = await import('node:fs');
  expect(readFileSync(pdfPath).subarray(0, 5).toString()).toBe('%PDF-');

  await page.getByRole('radio', { name: 'Últimos 7 días' }).click();
  await page.getByRole('button', { name: 'Ninguno' }).click();
  await expect(page.getByText('Elige al menos un tipo')).toBeVisible();
  await page.getByText('Temperaturas', { exact: true }).click();
  dl = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Hoja de cálculo (CSV)' }).click();
  file = await dl;
  expect(file.suggestedFilename()).toMatch(/\.csv$/);
  const csv = readFileSync(await file.path(), 'utf8');
  expect(csv).toContain('"temperatura"');
  expect(csv).not.toContain('"limpieza"');
  await logout(page);
});

test('404 y sesión caducada conservan el destino', async ({ page, context }) => {
  await page.goto('/esto-no-existe');
  await expect(page.getByRole('heading', { name: 'Esta página no existe' })).toBeVisible();
  await login(page);
  const target = page.url().replace(/\/hoy$/, '/historial');
  await context.clearCookies();
  await page.goto(target);
  await expect(page).toHaveURL(/\/entrar\?next=/);
  await page.getByLabel('Email').fill('demo@example.com');
  await page.getByLabel('Contraseña', { exact: true }).fill('Demo-EnRegla-2026');
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(page).toHaveURL(target);
  // Redirección abierta bloqueada: tras entrar se queda en la app.
  await logout(page);
  await page.goto('/entrar?next=//evil.example.com/robar');
  await page.getByLabel('Email').fill('demo@example.com');
  await page.getByLabel('Contraseña', { exact: true }).fill('Demo-EnRegla-2026');
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(page).toHaveURL(/^http:\/\/localhost:\d+\/locales\/[0-9a-f-]+\/hoy$/);
});
