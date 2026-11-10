import { test, expect, lastEmailLink, login, logout, sql } from './helpers';

const email = `e2e-${Date.now()}@example.com`;
const password = 'Cocina-Limpia-2026!';

test.describe.configure({ mode: 'serial' });

test('registro → verificación por email → login → alta guiada del local', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('link', { name: /Pruébalo 14 días gratis/ }).first().click();
  await expect(page).toHaveURL(/\/registro/);
  await page.getByLabel('Tu nombre').fill('Prueba E2E');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Contraseña', { exact: true }).fill('corta');
  await expect(page.getByText('Entre 10 y 128 caracteres')).toBeVisible();
  await page.getByLabel('Contraseña', { exact: true }).fill(password);
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Crear cuenta gratis' }).click();
  await expect(page.getByRole('heading', { name: 'Revisa tu correo' })).toBeVisible();

  // Sin verificar no se puede entrar
  await page.goto('/entrar');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Contraseña', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(page.getByText('Confirma tu email para entrar')).toBeVisible();

  const link = await lastEmailLink(email, '/verificar-email');
  await page.goto(link);
  await expect(page.getByText('¡Email confirmado!')).toBeVisible();
  // Sin el texto repetido («¡Email confirmado!» + «Email confirmado.»)
  await expect(page.getByText('Email confirmado. Ya puedes')).toHaveCount(0);
  // El token se quita de la barra de direcciones
  expect(page.url()).not.toContain('token=');
  await page.getByRole('link', { name: 'Entrar y configurar mi local' }).click();
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Contraseña', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();

  await expect(page).toHaveURL(/\/nuevo-local/);
  await expect(page.getByText('Son 4 pasos')).toBeVisible();
  await expect(page.locator('ol[aria-label="Pasos del alta"] > li')).toHaveCount(4);
  await page.getByLabel('Nombre del local').fill('Bar E2E');
  await page.getByText('Bar', { exact: true }).click();
  await page.getByRole('button', { name: 'Crear local y continuar' }).click();
  await expect(page.getByRole('heading', { name: 'Revisa tus equipos' })).toBeVisible();
  // El segundo paso es paso=2 en la URL.
  await expect(page).toHaveURL(/paso=2/);
  await expect(page.getByText('Paso 2 de 4')).toBeVisible();
  await expect(page.getByText(/Cámara|Congelador|Vitrina/).first()).toBeVisible();
  await page.getByRole('button', { name: 'Siguiente' }).click();
  await expect(page.getByRole('heading', { name: 'Revisa la limpieza' })).toBeVisible();
  await page.getByRole('button', { name: 'Siguiente' }).click();
  await expect(page.getByRole('heading', { name: 'Añade a tu equipo de cocina' })).toBeVisible();
  await page.getByRole('button', { name: 'Añadir persona' }).click();
  const dlg = page.getByRole('dialog');
  await dlg.getByLabel('Nombre').fill('Pepa Ruiz');
  await dlg.getByLabel(/PIN/).fill('4321');
  await dlg.getByRole('button', { name: 'Guardar' }).click();
  await expect(page.getByText('Pepa Ruiz', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Terminar' }).click();
  await expect(page.getByRole('heading', { name: '¡Tu local está listo!' })).toBeVisible();
  await page.getByRole('button', { name: 'Ir al panel de hoy' }).click();
  await expect(page).toHaveURL(/\/locales\/[0-9a-f-]+\/hoy/);
  // Todo se ha dado de alta hoy: se muestra, pero empieza a contar mañana (fuera del progreso).
  await expect(page.getByRole('heading', { name: 'Nada obligatorio hoy' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Empieza a contar mañana' })).toBeVisible();
  await expect(page.getByText('Opcional hoy').first()).toBeVisible();
  // Con todo en orden y más de una semana de prueba, no hay tarjeta de suscripción en Hoy.
  await expect(page.getByTestId('subscription-card')).toHaveCount(0);
});

test('temperatura normal y fuera de rango con acción correctora → Hoy → Historial → enmienda', async ({ page }) => {
  await login(page, email, password);
  await page.getByRole('link', { name: 'Temperatura' }).first().click();
  const fridge = page.locator('label').filter({ hasText: 'máx. 4 °C' }).first();
  await fridge.click();
  await page.getByLabel('Temperatura (°C)').fill('3,2');
  await expect(page.getByText('dentro de rango')).toBeVisible();
  await page.getByRole('button', { name: 'Guardar temperatura' }).click();
  await expect(page.getByTestId('record-saved')).toContainText('Hecho');

  await page.getByRole('button', { name: 'Registrar otro' }).click();
  await page.locator('label').filter({ hasText: 'máx. 4 °C' }).first().click();
  await page.getByLabel('Temperatura (°C)').fill('9,5');
  await expect(page.getByText('está fuera de rango')).toBeVisible();
  await page.getByRole('button', { name: 'Guardar con acción correctora' }).click();
  await expect(page.getByText('Fuera de rango: indica qué has hecho')).toBeVisible();
  await page.getByRole('button', { name: 'Producto desechado' }).click();
  await page.getByRole('button', { name: 'Guardar con acción correctora' }).click();
  await expect(page.getByTestId('record-saved')).toContainText('Guardado, con alerta');

  await page.getByRole('link', { name: 'Volver a Hoy' }).click();
  await expect(page.getByRole('heading', { name: 'Alertas' })).toBeVisible();
  await expect(page.getByText(/9,5/).first()).toBeVisible();

  await page.getByRole('navigation', { name: 'Principal' }).getByRole('link', { name: 'Historial' }).click();
  const row = page.getByRole('link').filter({ hasText: '9,5 °C' }).first();
  await expect(row).toContainText('Alerta');
  await expect(page.getByRole('link').filter({ hasText: '3,2 °C' }).first()).toBeVisible();
  await row.click();
  await expect(page.getByText('Producto desechado')).toBeVisible();

  await page.getByRole('button', { name: 'Corregir' }).click();
  await page.getByLabel('Temperatura (°C)').fill('2,5');
  await page.getByRole('button', { name: 'Guardar corrección' }).click();
  await expect(page.getByText('Indica el motivo de la corrección')).toBeVisible();
  await page.getByLabel('Motivo de la corrección').fill('Se leyó mal el termómetro');
  // El valor corregido está en rango: no se pide acción correctora.
  await expect(page.getByText('¿Qué has hecho para corregirlo?')).toHaveCount(0);
  await page.getByRole('button', { name: 'Guardar corrección' }).click();
  await expect(page.getByText('Corrección guardada')).toBeVisible();
  await expect(page.getByText('Este registro es una corrección')).toBeVisible();
  await expect(page.getByText(/Motivo: Se leyó mal el termómetro/)).toBeVisible();
  // Tras guardar, el formulario queda cerrado y se ve el detalle.
  await expect(page.getByRole('button', { name: 'Guardar corrección' })).toHaveCount(0);
  await expect(page.getByText(/Corregido el .+ por Prueba E2E/).first()).toBeVisible();
  await page.getByRole('link', { name: 'Ver el original' }).click();
  await expect(page.getByText('Este registro fue corregido')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Corregir' })).toHaveCount(0);

  await logout(page);
});

test('solo lectura: aviso persistente, formularios deshabilitados e informes disponibles', async ({ page }) => {
  await sql(
    `UPDATE organizations SET subscription_status = 'trialing', trial_ends_at = now() - interval '1 day', stripe_subscription_id = NULL
     WHERE id IN (SELECT m.organization_id FROM memberships m JOIN users u ON u.id = m.user_id WHERE u.email = $1)`,
    [email],
  );
  await login(page, email, password);
  await expect(page.getByTestId('read-only-banner')).toContainText('Modo solo lectura');
  await page.getByRole('link', { name: 'Temperatura' }).first().click();
  await expect(page.getByTestId('write-guard')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Guardar temperatura' })).toBeDisabled();
  await page.getByRole('navigation', { name: 'Principal' }).getByRole('link', { name: 'Informes' }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Informe PDF' }).click();
  expect((await download).suggestedFilename()).toMatch(/\.pdf$/);
  await page.getByRole('link', { name: 'Activar suscripción' }).click();
  await expect(page.getByRole('heading', { name: 'Facturación' })).toBeVisible();
  await logout(page);
});
