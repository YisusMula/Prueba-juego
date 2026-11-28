import { test, expect, login, logout } from './helpers';

test('alérgenos: alta de plato y carta pública con filtro', async ({ page, browser }) => {
  await login(page);
  await page.getByRole('link', { name: 'Alérgenos' }).first().click();
  await page.getByRole('button', { name: 'Añadir plato' }).click();
  const dlg = page.getByRole('dialog');
  await dlg.getByLabel('Nombre del plato').fill('Tarta de queso E2E');
  await dlg.getByLabel(/Categoría/).fill('Postres');
  await expect(dlg.getByTestId('allergen-progress')).toHaveText('Decididos 0 de 14. Faltan 14.');
  await dlg.getByRole('radio', { name: 'Gluten: Contiene' }).click();
  await dlg.getByRole('radio', { name: 'Leche: Contiene' }).click();
  await dlg.getByRole('radio', { name: 'Frutos de cáscara: Puede contener trazas' }).click();
  // Sin decidir los 14, el plato queda pendiente de revisar.
  await dlg.getByRole('button', { name: 'Guardar sin revisar' }).click();
  const item = page.getByTestId('dish').filter({ hasText: 'Tarta de queso E2E' });
  await expect(item).toContainText('Pendiente de revisar · no se muestra en la carta');
  await expect(item).toContainText('Gluten');
  await expect(item).toContainText('Trazas de Frutos de cáscara');

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
  // Pendiente de revisar: NO sale en la carta pública (tampoco el plato pendiente del seed).
  await expect(g.getByText('Croquetas de jamón')).toBeVisible();
  await expect(card).toHaveCount(0);
  await expect(g.getByText('Pulpo a la gallega')).toHaveCount(0);
  // Aviso siempre visible; nunca «Sin alérgenos» tajante.
  await expect(g.getByTestId('menu-notice')).toContainText('contaminación cruzada');
  await expect(g.getByText('No se han declarado alérgenos en este plato').first()).toBeVisible();
  await expect(g.getByText(/Sin alérgenos|No contiene ninguno/)).toHaveCount(0);
  // Categorías en orden de carta, no alfabético.
  const cats = await g.locator('main section[aria-labelledby^="cat-"] h2').allTextContents();
  expect(cats).toEqual(['Entrantes', 'Principales', 'Postres', 'Bebidas']);

  // Se revisa el plato (se deciden los que faltan) y entonces sí aparece.
  await item.getByRole('button', { name: /Revisar Tarta de queso E2E/ }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Marcar los que faltan como «No contiene»' }).click();
  await expect(page.getByRole('dialog').getByTestId('allergen-progress')).toContainText('Revisión completa');
  await page.getByRole('dialog').getByRole('button', { name: 'Guardar plato' }).click();
  await expect(item).not.toContainText('Pendiente de revisar');
  await g.reload();
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
