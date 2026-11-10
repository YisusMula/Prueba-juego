import { test, expect, apiHeaders, createVerifiedAccount, expectNoSeriousA11yViolations, lastEmailLink, login, logout, seedInfo, DEMO } from './helpers';

test.describe.configure({ mode: 'serial' });

const stamp = Date.now();

test('borrado diferido de un local: aviso, solo lectura, restaurar y eliminar ya definitivamente', async ({ page }) => {
  await login(page);
  const created = await page.request.post('/api/orgs', { data: { name: `Local para borrar ${stamp}`, businessType: 'bar' }, headers: apiHeaders(page) });
  expect(created.status()).toBe(201);
  const { organization } = (await created.json()) as { organization: { id: string; name: string } };
  await page.goto(`/locales/${organization.id}/ajustes/datos`);
  await page.getByRole('button', { name: `Eliminar «${organization.name}»` }).click();
  const dlg = page.getByRole('dialog');
  await expect(dlg).toContainText('Tendrás 30 días para arrepentirte');
  await dlg.getByLabel(/para confirmar/).fill(organization.name);
  await dlg.getByLabel('Tu contraseña').fill(DEMO.password);
  await dlg.getByRole('button', { name: 'Programar la eliminación' }).click();

  const banner = page.getByTestId('deletion-banner');
  await expect(banner).toContainText('Este local se eliminará definitivamente el');
  // Sigue existiendo, en solo lectura y sin opción de contratar.
  await page.goto(`/locales/${organization.id}/registrar/temperatura`);
  await expect(page.getByTestId('write-guard')).toContainText('pendiente de eliminación');
  await page.goto(`/locales/${organization.id}/facturacion`);
  await expect(page.getByText('Mientras el local esté pendiente de eliminación no se puede contratar')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Continuar al pago seguro' })).toHaveCount(0);
  // El selector de locales lo indica.
  await page.getByRole('button', { name: /Local actual/ }).first().click();
  await expect(page.getByRole('dialog').getByText('Pendiente de eliminación · solo lectura')).toBeVisible();
  await page.keyboard.press('Escape');
  // El foco vuelve al botón que abrió el diálogo.
  await expect(page.getByRole('button', { name: /Local actual/ }).first()).toBeFocused();

  // Restaurar
  await page.getByTestId('deletion-banner').getByRole('button', { name: 'Restaurar' }).click();
  await expect(page.getByTestId('deletion-banner')).toHaveCount(0);
  await page.goto(`/locales/${organization.id}/ajustes/datos`);
  await expect(page.getByRole('button', { name: `Eliminar «${organization.name}»` })).toBeVisible();

  // Programar de nuevo y eliminar ya, definitivamente.
  await page.getByRole('button', { name: `Eliminar «${organization.name}»` }).click();
  await page.getByRole('dialog').getByLabel(/para confirmar/).fill(organization.name);
  await page.getByRole('dialog').getByLabel('Tu contraseña').fill(DEMO.password);
  await page.getByRole('dialog').getByRole('button', { name: 'Programar la eliminación' }).click();
  await page.getByTestId('deletion-banner').getByRole('button', { name: 'Eliminar ya definitivamente' }).click();
  const perm = page.getByRole('dialog');
  await perm.getByLabel(/para confirmar/).fill('otro nombre');
  await perm.getByLabel('Tu contraseña').fill(DEMO.password);
  await perm.getByRole('button', { name: 'Eliminar definitivamente' }).click();
  await expect(perm.getByText('Escribe el nombre del local exactamente como aparece')).toBeVisible();
  await perm.getByLabel(/para confirmar/).fill(organization.name);
  await perm.getByRole('button', { name: 'Eliminar definitivamente' }).click();
  await expect(page).toHaveURL(/\/locales\/[0-9a-f-]+\/hoy/);
  expect((await page.request.get(`/api/orgs/${organization.id}`)).status()).toBe(404);
});

test('limpieza parcial y validación de 999 °C en la web', async ({ page }) => {
  await login(page);
  const org = page.url().replace(/\/hoy$/, '');
  await page.goto(`${org}/registrar/temperatura`);
  await page.locator('label').filter({ hasText: 'máx. 4 °C' }).first().click();
  await page.getByLabel('Temperatura (°C)').fill('999');
  await expect(page.getByText('La temperatura debe estar entre −60 y 300 °C')).toBeVisible();
  await expect(page.getByText(/fuera de rango|dentro de rango/)).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Guardar/ })).toBeDisabled();

  await page.goto(`${org}/registrar/limpieza`);
  await page.getByText('Limpieza semanal', { exact: false }).first().click();
  const zones = page.locator('fieldset').filter({ hasText: 'Zonas limpiadas' }).getByRole('checkbox');
  const total = await zones.count();
  expect(total).toBeGreaterThan(1);
  await page.getByRole('button', { name: 'Guardar registro' }).click();
  await expect(page.getByText('Marca al menos una zona hecha')).toBeVisible();
  await zones.first().check({ force: true });
  await expect(page.getByText('Marca al menos una zona hecha')).toHaveCount(0);
  await page.getByRole('button', { name: 'Guardar registro' }).click();
  await expect(page.getByRole('heading', { name: total - 1 === 1 ? 'Queda 1 zona sin hacer' : `Quedan ${total - 1} zonas sin hacer` })).toBeVisible();
  await page.getByRole('button', { name: 'Guardar como parcial' }).click();
  await expect(page.getByTestId('record-saved')).toContainText('Guardado como parcial');
  await expect(page.getByTestId('record-saved')).toContainText(`Parcial (1 de ${total})`);
  await page.getByRole('link', { name: 'Ver el registro' }).click();
  await expect(page.getByText(`Parcial (1 de ${total})`).first()).toBeVisible();
  await logout(page);
});

const resetEmail = `reset-${stamp}@example.com`;
const invitedEmail = `invitada-${stamp}@example.com`;
const NEW_PASSWORD = 'Otra-Clave-Nueva-2026';

test('recuperación de contraseña completa', async ({ page }) => {
  await createVerifiedAccount(page, resetEmail, 'Clave-Inicial-2026', 'Rita Reset');
  await page.goto('/entrar');
  await page.getByRole('link', { name: '¿Has olvidado la contraseña?' }).click();
  await expect(page.getByRole('heading', { name: 'Recuperar contraseña' })).toBeVisible();
  await page.getByLabel('Email').fill(resetEmail);
  await page.getByRole('button', { name: 'Enviar enlace' }).click();
  await expect(page.getByText('Revisa tu correo')).toBeVisible();
  const link = await lastEmailLink(resetEmail, '/restablecer-contrasena');
  await page.goto(link);
  await expect(page.getByLabel('Nueva contraseña')).toBeVisible();
  await expect(page).not.toHaveURL(/token=/);
  await page.getByLabel('Nueva contraseña').fill('qwertyuiop');
  await page.getByRole('button', { name: 'Guardar contraseña' }).click();
  await expect(page.getByText(/más usadas/).first()).toBeVisible();
  await page.getByLabel('Nueva contraseña').fill(NEW_PASSWORD);
  await page.getByRole('button', { name: 'Guardar contraseña' }).click();
  await expect(page.getByText('Contraseña cambiada')).toBeVisible();
  // El enlace ya usado no sirve: un único mensaje claro.
  await page.goto('/entrar');
  await page.goto(link);
  await page.getByLabel('Nueva contraseña').fill('Una-Mas-Distinta-2026');
  await page.getByRole('button', { name: 'Guardar contraseña' }).click();
  await expect(page.getByText('Este enlace no es válido: puede que haya caducado o que ya se haya usado.')).toBeVisible();
  await login(page, resetEmail, NEW_PASSWORD);
  await expect(page).toHaveURL(/\/nuevo-local/);
});

test('invitación abierta con otra cuenta: cerrar sesión, entrar con la invitada y aceptar', async ({ page }) => {
  await createVerifiedAccount(page, invitedEmail, 'Cocina-Segura-2026', 'Irene Invitada');
  await login(page);
  const inv = await page.request.post(`${page.url().replace(/\/locales\/([0-9a-f-]+)\/hoy$/, '/api/orgs/$1')}/invitations`, {
    data: { email: invitedEmail, role: 'manager' },
    headers: apiHeaders(page),
  });
  expect(inv.status()).toBe(201);
  await logout(page);
  // Abre el enlace estando dentro con OTRA cuenta (la del test anterior).
  await login(page, resetEmail, NEW_PASSWORD);
  await page.goto(await lastEmailLink(invitedEmail, '/invitacion'));
  await expect(page.getByText('Has entrado con otra cuenta')).toBeVisible();
  await page.getByRole('button', { name: `Cerrar sesión y entrar con ${invitedEmail}` }).click();
  await expect(page).toHaveURL(/\/entrar\?next=%2Finvitacion/);
  await expect(page.getByLabel('Email')).toHaveValue(invitedEmail);
  await page.getByLabel('Contraseña', { exact: true }).fill('Cocina-Segura-2026');
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(page).toHaveURL(/\/invitacion/);
  await page.getByRole('button', { name: /Aceptar y entrar en Restaurante La Demo/ }).click();
  await expect(page).toHaveURL(/\/locales\/[0-9a-f-]+\/hoy/);
  await expect(page.getByRole('button', { name: /Local actual/ }).first()).toContainText('Restaurante La Demo');
});

test('portada: precio y público en la primera pantalla del móvil; SEO y páginas legales', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'es-ES' });
  const page = await ctx.newPage();
  await page.goto('/');
  const price = page.getByTestId('hero-price');
  await expect(price).toHaveText('12 €/mes por local · 14 días gratis, sin tarjeta');
  const box = (await price.boundingBox())!;
  expect(box.y + box.height).toBeLessThanOrEqual(844);
  await expect(page.getByText('Para bares, restaurantes, cafeterías y obradores')).toBeInViewport();
  expect(await page.locator('meta[property="og:image"]').getAttribute('content')).toMatch(/\/og-image\.png$/);
  expect(await page.locator('link[rel="canonical"]').getAttribute('href')).toBe('http://localhost:3100/');
  const robots = await page.request.get('/robots.txt');
  expect(robots.status()).toBe(200);
  const robotsText = await robots.text();
  expect(robotsText).toContain('Disallow: /cocina');
  expect(robotsText).toContain('Disallow: /carta/');
  expect(robotsText).toContain('Sitemap: http://localhost:3100/sitemap.xml');
  const sitemap = await (await page.request.get('/sitemap.xml')).text();
  expect(sitemap).toContain('<loc>http://localhost:3100/privacidad</loc>');
  expect(sitemap).not.toContain('/cocina');
  const og = await page.request.get('/og-image.png');
  expect(og.headers()['content-type']).toContain('image/png');

  await page.goto('/privacidad');
  await expect(page.getByText(/protegida mediante un hash irreversible/)).toBeVisible();
  // Sin datos reales en este build de pruebas: marcadores resaltados y ninguna mención a ficheros internos.
  await expect(page.getByTestId('legal-placeholder').first()).toBeVisible();
  await expect(page.locator('body')).not.toContainText('legal.ts');
  await expect(page.locator('body')).not.toContainText('src/config');
  await expect(page.getByRole('link', { name: /soporte@example.com/ })).toBeVisible();
  await ctx.close();
});

test('accesibilidad (axe): pantallas principales en claro y oscuro', async ({ browser }) => {
  for (const colorScheme of ['light', 'dark'] as const) {
    const ctx = await browser.newContext({ colorScheme, locale: 'es-ES', viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    await page.goto('/');
    await expectNoSeriousA11yViolations(page, `${colorScheme} portada`);
    await page.goto('/entrar');
    await expectNoSeriousA11yViolations(page, `${colorScheme} entrar`);
    await login(page);
    const org = page.url().replace(/\/hoy$/, '');
    await page.getByText(/Quedan \d+ de \d+|Todo hecho|Sin tareas/).first().waitFor();
    await expectNoSeriousA11yViolations(page, `${colorScheme} hoy`);
    for (const [path, name] of [
      ['registrar/temperatura', 'registrar'],
      ['historial', 'historial'],
      ['alergenos', 'alérgenos'],
      ['informes', 'informes'],
      ['ajustes', 'ajustes'],
      ['ajustes/cuenta', 'cuenta'],
      ['facturacion', 'facturación'],
    ] as const) {
      await page.goto(`${org}/${path}`);
      await page.waitForLoadState('networkidle');
      await page.waitForFunction(() => !document.querySelector('.skeleton'));
      await expectNoSeriousA11yViolations(page, `${colorScheme} ${name}`);
    }
    await page.goto(`/carta/${seedInfo().menuSlug}`);
    await page.getByRole('heading', { name: 'Restaurante La Demo' }).waitFor();
    await expectNoSeriousA11yViolations(page, `${colorScheme} carta pública`);
    await page.goto(`/cocina/vincular#token=${seedInfo().kioskToken}`);
    await expect(page).toHaveURL(/\/cocina$/);
    await page.getByRole('heading', { name: 'Registrar' }).waitFor();
    await expectNoSeriousA11yViolations(page, `${colorScheme} cocina`);
    await ctx.close();
  }
});
