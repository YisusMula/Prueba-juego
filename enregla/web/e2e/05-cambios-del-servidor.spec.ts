import { mkdirSync } from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { test, expect, apiHeaders, createVerifiedAccount, lastEmailLink, login, sql, DEMO } from './helpers';

test.describe.configure({ mode: 'serial' });

const stamp = Date.now();
const SHOTS = process.env.SHOTS_DIR;
async function shot(page: Page, name: string) {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: true });
}

/** Crea un local nuevo del demo (para no tocar el principal) y devuelve su id y nombre. */
async function newOrg(page: Page, label: string) {
  const name = `${label} ${stamp}`;
  const created = await page.request.post('/api/orgs', { data: { name, businessType: 'bar' }, headers: apiHeaders(page) });
  expect(created.status()).toBe(201);
  const { organization } = (await created.json()) as { organization: { id: string } };
  return { id: organization.id, name };
}

test('cambio de email: sin sesión lleva al login con mensaje; con sesión se queda', async ({ page, browser }) => {
  const a = `cambio-a-${stamp}@example.com`;
  const b = `cambio-b-${stamp}@example.com`;
  const pw = 'Cocina-Segura-2026';
  await createVerifiedAccount(page, a, pw, 'Ulises Prueba');
  await login(page, a, pw);
  const req = await page.request.post('/api/account/email', { data: { password: pw, newEmail: b }, headers: apiHeaders(page) });
  expect(req.status()).toBe(202);
  const link = await lastEmailLink(b, '/confirmar-email');

  // Otro navegador sin sesión: el servidor cierra todas las sesiones y la web lleva al login.
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const p2 = await ctx.newPage();
  await p2.goto(link);
  await expect(p2).toHaveURL(/\/entrar\?emailActualizado=1/);
  await expect(p2.getByText('Email actualizado. Entra con tu nuevo email.')).toBeVisible();
  await shot(p2, 'login-email-actualizado');
  await p2.getByLabel('Email').fill(b);
  await p2.getByLabel('Contraseña', { exact: true }).fill(pw);
  await p2.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(p2).toHaveURL(/\/nuevo-local|\/locales\//);
  await ctx.close();

  // Con la sesión del titular (cuenta nueva, su propio cambio): se queda en la confirmación.
  const c = `cambio-c-${stamp}@example.com`;
  const d = `cambio-d-${stamp}@example.com`;
  await createVerifiedAccount(page, c, pw, 'Ulises Prueba');
  await login(page, c, pw);
  expect((await page.request.post('/api/account/email', { data: { password: pw, newEmail: d }, headers: apiHeaders(page) })).status()).toBe(202);
  await page.goto(await lastEmailLink(d, '/confirmar-email'));
  await expect(page.getByRole('heading', { name: 'Email actualizado' }).or(page.getByText('Email actualizado', { exact: true }))).toBeVisible();
  await expect(page.getByRole('link', { name: 'Ir a mi panel' })).toBeVisible();
});

test('informe PDF: «Generando el informe…», botón deshabilitado y mensajes del servidor tal cual', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  await page.getByRole('link', { name: 'Informes' }).first().click();
  const msg429 = 'Ya estás generando otro informe PDF. Espera a que termine y vuelve a intentarlo.';
  await page.route('**/reports/pdf**', async (route) => {
    await new Promise((r) => setTimeout(r, 1500));
    await route.fulfill({ status: 429, headers: { 'Retry-After': '30', 'Content-Type': 'application/json' }, body: JSON.stringify({ error: { code: 'RATE_LIMITED', message: msg429 } }) });
  });
  await page.getByRole('button', { name: 'Informe PDF' }).click();
  const busy = page.getByRole('button', { name: /Generando el informe/ });
  await expect(busy).toBeDisabled();
  await expect(page.getByRole('progressbar', { name: 'Generando el informe…' })).toBeVisible();
  await shot(page, 'informe-generando');
  await expect(page.getByText(msg429)).toBeVisible();
  await expect(page.getByText('Podrás volver a intentarlo en 30 segundos')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Informe PDF' })).toBeEnabled();
  await shot(page, 'informe-429');

  await page.unroute('**/reports/pdf**');
  const tooLarge = 'El informe PDF es demasiado grande. Acota el periodo o los tipos de registro, o descarga el CSV.';
  await page.route('**/reports/pdf**', (route) =>
    route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: { code: 'REPORT_TOO_LARGE', message: tooLarge } }) }),
  );
  await page.getByRole('button', { name: 'Informe PDF' }).click();
  await expect(page.getByText(tooLarge)).toBeVisible();

  // Con la cola real (retardo antes de responder) se descarga igualmente.
  await page.unroute('**/reports/pdf**');
  await page.route('**/reports/pdf**', async (route) => {
    await new Promise((r) => setTimeout(r, 1200));
    await route.continue();
  });
  const dl = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Informe PDF' }).click();
  await expect(page.getByRole('progressbar')).toBeVisible();
  expect((await dl).suggestedFilename()).toMatch(/\.pdf$/);
  await expect(page.getByRole('progressbar')).toHaveCount(0);
});

test('correctedLater: Hoy y Resumen de Informes lo indican de forma discreta', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route('**/tasks/today', async (route) => {
    const res = await route.fetch();
    const data = await res.json();
    data.summary.correctedLater = 1;
    await route.fulfill({ response: res, json: data });
  });
  await page.route('**/tasks/compliance**', async (route) => {
    const res = await route.fetch();
    const data = await res.json();
    data.overall.correctedLater = 2;
    if (data.days[0]) data.days[0].correctedLater = 2;
    await route.fulfill({ response: res, json: data });
  });
  await login(page);
  await expect(page.getByTestId('corrected-later-summary')).toHaveText('1 completada con una corrección posterior');
  await shot(page, 'hoy-corregida');
  await page.getByRole('link', { name: 'Informes' }).first().click();
  await expect(page.getByTestId('overall-corrected-later')).toHaveText('2 completadas con una corrección posterior');
  await shot(page, 'informes-corregida');
});

test('cobro fallido: el aviso dice que se puede seguir unos días, sin inventar fecha límite', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  const org = await newOrg(page, 'Local impago');
  await sql(`UPDATE organizations SET subscription_status = 'past_due', past_due_since = now() - interval '3 days' WHERE id = $1`, [org.id]);
  await page.goto(`/locales/${org.id}/hoy`);
  const banner = page.getByTestId('payment-failed-banner');
  await expect(banner).toContainText('No hemos podido cobrar la suscripción');
  await expect(banner).toContainText('durante unos días más');
  await expect(banner).toContainText('Lleva fallando desde el');
  await expect(banner).not.toContainText('21');
  await shot(page, 'pago-fallido');
});

test('facturación: checkout 409 y 502 muestran el mensaje del servidor y dejan la pantalla usable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  const org = await newOrg(page, 'Local checkout');
  await page.route(`**/api/orgs/${org.id}/billing`, async (route) => {
    const res = await route.fetch();
    const data = await res.json();
    data.billingEnabled = true;
    await route.fulfill({ response: res, json: data });
  });
  const m409 = 'Ya hay un pago en curso para este local. Espera unos segundos y recarga.';
  const m502 = 'No se ha podido anular el intento de pago anterior. Inténtalo de nuevo.';
  let n = 0;
  await page.route(`**/api/orgs/${org.id}/billing/checkout`, (route) => {
    n++;
    return route.fulfill({
      status: n === 1 ? 409 : 502,
      contentType: 'application/json',
      body: JSON.stringify({ error: { code: n === 1 ? 'CONFLICT' : 'BILLING_ERROR', message: n === 1 ? m409 : m502 } }),
    });
  });
  await page.goto(`/locales/${org.id}/facturacion`);
  await page.getByRole('button', { name: 'Continuar al pago seguro' }).click();
  await expect(page.getByText(m409)).toBeVisible();
  await shot(page, 'checkout-409');
  await expect(page.getByRole('button', { name: 'Continuar al pago seguro' })).toBeEnabled();
  await page.getByRole('button', { name: 'Continuar al pago seguro' }).click();
  await expect(page.getByText(m502)).toBeVisible();
  await expect(page.getByText(m409)).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Continuar al pago seguro' })).toBeEnabled();
});

async function scheduleDeletion(page: Page, id: string) {
  const r = await page.request.delete(`/api/orgs/${id}`, { data: { password: DEMO.password }, headers: apiHeaders(page) });
  expect(r.status()).toBe(204);
}

test('local pendiente de eliminación: restaurar 404 y eliminar ya 502/503/404', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);

  // Eliminar ya: 502 y 503 → el mensaje del servidor en el diálogo, el local sigue pendiente y se puede reintentar.
  const a = await newOrg(page, 'Local purga');
  await scheduleDeletion(page, a.id);
  await page.goto(`/locales/${a.id}/hoy`);
  const m502 = 'No se ha podido cancelar la suscripción en Stripe: el local NO se ha eliminado. Inténtalo de nuevo.';
  const m503 = 'Los pagos no están configurados en este servidor: el local NO se ha eliminado.';
  let n = 0;
  await page.route(`**/api/orgs/${a.id}/permanent`, (route) => {
    n++;
    if (n <= 2) {
      return route.fulfill({
        status: n === 1 ? 502 : 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: { code: n === 1 ? 'BILLING_ERROR' : 'BILLING_NOT_CONFIGURED', message: n === 1 ? m502 : m503 } }),
      });
    }
    return route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: { code: 'NOT_FOUND', message: 'No lo encontramos.' } }) });
  });
  await page.getByTestId('deletion-banner').getByRole('button', { name: 'Eliminar ya definitivamente' }).click();
  const dlg = page.getByRole('dialog');
  await dlg.getByLabel(/para confirmar/).fill(a.name);
  await dlg.getByLabel('Tu contraseña').fill(DEMO.password);
  await dlg.getByRole('button', { name: 'Eliminar definitivamente' }).click();
  await expect(dlg.getByText(m502)).toBeVisible();
  await shot(page, 'permanent-502');
  await expect(dlg.getByRole('button', { name: 'Eliminar definitivamente' })).toBeEnabled();
  await dlg.getByRole('button', { name: 'Eliminar definitivamente' }).click();
  await expect(dlg.getByText(m503)).toBeVisible();
  await expect(dlg.getByText(m502)).toHaveCount(0);
  // 404: ya estaba borrado → de vuelta al panel, sin quedarse en un local que no existe.
  await dlg.getByRole('button', { name: 'Eliminar definitivamente' }).click();
  await expect(page).toHaveURL(/\/locales\/[0-9a-f-]+\/hoy|\/app|\/nuevo-local/);
  await expect(page.getByTestId('deletion-banner')).toHaveCount(0);
  await expect(page.getByText(a.name)).toHaveCount(0);

  // Restaurar: 404 (la purga lo borró a la vez).
  const b = await newOrg(page, 'Local restaurar');
  await scheduleDeletion(page, b.id);
  await page.goto(`/locales/${b.id}/hoy`);
  await page.route(`**/api/orgs/${b.id}/restore`, (route) =>
    route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: { code: 'NOT_FOUND', message: 'No lo encontramos.' } }) }),
  );
  await page.getByTestId('deletion-banner').getByRole('button', { name: 'Restaurar' }).click();
  await expect(page.getByText('El local ya se había eliminado.')).toBeVisible();
  await expect(page.getByTestId('deletion-banner')).toHaveCount(0);
  await expect(page).not.toHaveURL(new RegExp(b.id));
});

test('invitación a un local pendiente de eliminación: INVALID_TOKEN claro y sin bucle', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const invited = `inv-elim-${stamp}@example.com`;
  await createVerifiedAccount(page, invited, 'Cocina-Segura-2026', 'Irene Prueba');
  await login(page);
  const org = await newOrg(page, 'Local invitador');
  const inv = await page.request.post(`/api/orgs/${org.id}/invitations`, { data: { email: invited, role: 'manager' }, headers: apiHeaders(page) });
  expect(inv.status()).toBe(201);
  const link = await lastEmailLink(invited, '/invitacion');
  await scheduleDeletion(page, org.id);
  await page.goto(link);
  const callout = page.getByText('No se puede usar esta invitación');
  await expect(callout).toBeVisible();
  await expect(page.getByRole('link', { name: 'Ir a mi panel' })).toBeVisible();
  await shot(page, 'invitacion-invalida');
});
