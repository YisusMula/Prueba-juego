import { test, expect, login, logout } from './helpers';

test('ajustes clave: equipo, personal e invitación', async ({ page }) => {
  await login(page);
  await page.getByRole('link', { name: 'Ajustes' }).first().click();

  await page.getByRole('link', { name: /Equipos/ }).click();
  await page.getByRole('button', { name: 'Añadir equipo' }).click();
  let dlg = page.getByRole('dialog');
  await dlg.getByLabel('Nombre').fill('Vitrina E2E');
  await dlg.getByLabel('Tipo').selectOption('vitrina');
  await dlg.getByLabel('Máxima').fill('5');
  await dlg.getByRole('button', { name: 'Guardar equipo' }).click();
  await expect(page.getByText('Vitrina E2E', { exact: true })).toBeVisible();
  await expect(page.getByText(/Vitrina refrigerada · máx. 5 °C/)).toBeVisible();

  await page.goto(page.url().replace('/equipos', '/personal'));
  await page.getByRole('button', { name: 'Añadir persona' }).click();
  dlg = page.getByRole('dialog');
  await dlg.getByLabel('Nombre').fill('Rocío E2E');
  await dlg.getByLabel(/PIN/).fill('2468');
  await dlg.getByRole('button', { name: 'Guardar' }).click();
  await expect(page.locator('li').filter({ hasText: 'Rocío E2E' })).toContainText('Con PIN');

  await page.goto(page.url().replace('/personal', '/equipo'));
  await page.getByLabel('Email').fill('encargada-e2e@example.com');
  await page.getByRole('button', { name: 'Enviar invitación' }).click();
  await expect(page.getByText('encargada-e2e@example.com', { exact: true })).toBeVisible();
  await logout(page);
});

test('modo cocina: crear dispositivo, PIN incorrecto y correcto, revocar', async ({ page, browser }) => {
  await login(page);
  const orgUrl = page.url().replace(/\/hoy$/, '');
  await page.goto(`${orgUrl}/ajustes/cocina`);
  await page.getByRole('button', { name: 'Vincular dispositivo' }).first().click();
  await page.getByLabel('Nombre del dispositivo').fill('Tablet E2E');
  await page.getByRole('button', { name: 'Generar código de vinculación' }).click();
  await expect(page.getByText('Solo se muestra esta vez')).toBeVisible();
  await expect(page.getByRole('img', { name: /Código QR para vincular/ })).toBeVisible();
  await page.getByText('¿No puedes escanear? Copia el código').click();
  const token = (await page.getByTestId('device-token').textContent())!.trim();
  expect(token).toMatch(/^kd_/);
  await page.getByRole('button', { name: 'Hecho' }).click();
  await expect(page.locator('li').filter({ hasText: 'Tablet E2E' })).toContainText('Activo');
  await expect(page.locator('li').filter({ hasText: 'Tablet E2E' })).toContainText('por Usuario Demo');

  // La tablet: otro contexto, sin sesión de usuario
  const tablet = await browser.newContext({ viewport: { width: 1024, height: 768 }, locale: 'es-ES' });
  const k = await tablet.newPage();
  const requests: string[] = [];
  k.on('request', (r) => requests.push(r.url()));
  await k.goto(`/cocina/vincular#token=${token}`);
  await expect(k).toHaveURL(/\/cocina$/);
  await expect(k.getByRole('heading', { name: 'Pendiente ahora' }).or(k.getByRole('heading', { name: 'Registrar' })).first()).toBeVisible();

  await k.getByRole('button', { name: 'Temperatura', exact: true }).click();
  await k.getByRole('button', { name: /Ana Martín/ }).click();
  for (const d of '9999') await k.getByRole('button', { name: d, exact: true }).click();
  await k.getByRole('button', { name: 'Entrar' }).click();
  await k.getByRole('button', { name: /Cámara de carnes/ }).click();
  for (const d of '3') await k.getByRole('button', { name: d, exact: true }).click();
  await k.getByRole('button', { name: 'Coma decimal' }).click();
  await k.getByRole('button', { name: '1', exact: true }).click();
  await expect(k.getByLabel('Temperatura escrita')).toContainText('3,1 °C');
  await k.getByRole('button', { name: 'Guardar' }).click();
  await expect(k.getByText('PIN incorrecto. Prueba otra vez.')).toBeVisible();
  for (const d of '1234') await k.getByRole('button', { name: d, exact: true }).click();
  await k.getByRole('button', { name: 'Entrar' }).click();
  await expect(k.getByTestId('kiosk-result')).toContainText('Hecho');
  await expect(k.getByTestId('kiosk-result')).toContainText('3,1 °C');
  // El token nunca viaja en la URL
  expect(requests.filter((u) => u.includes('kd_') && !u.includes('#'))).toEqual([]);

  // Revocar desde la web → la tablet pide volver a vincular
  await page.reload();
  await page.locator('li').filter({ hasText: 'Tablet E2E' }).getByRole('button', { name: /Desvincular/ }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Desvincular' }).click();
  await expect(page.locator('li').filter({ hasText: 'Tablet E2E' }).getByRole('button', { name: /Desvincular/ })).toHaveCount(0);
  await k.reload();
  await expect(k.getByRole('heading', { name: 'Esta tablet se ha desvinculado' })).toBeVisible();
  expect(await k.evaluate(() => localStorage.getItem('enregla.kiosk.deviceToken'))).toBeNull();
  await tablet.close();
});
