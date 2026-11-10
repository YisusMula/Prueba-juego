/* global document */
/**
 * Capturas de las pantallas principales en móvil, tablet y escritorio, contra un servidor
 * de EnRegla que sirva el build de producción (por defecto el de e2e: http://localhost:3100).
 * Además falla si detecta errores de consola, violaciones de CSP o desbordamiento horizontal.
 *
 *   node e2e/start-server.mjs &   # (tras `npx vite build`)
 *   npm run screenshots           # → ../docs/capturas/*.png
 */
import { chromium } from 'playwright';
import { mkdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const BASE = process.env.BASE ?? 'http://localhost:3100';
const OUT = fileURLToPath(new URL('../../docs/capturas/', import.meta.url));
mkdirSync(OUT, { recursive: true });
const seed = readFileSync(fileURLToPath(new URL('../e2e/.runtime/seed.txt', import.meta.url)), 'utf8');
const KIOSK = seed.match(/kd_[A-Za-z0-9_-]{43}/)[0];
const SLUG = seed.match(/menu\/([A-Za-z0-9_-]+)/)[1];

const SIZES = [
  { name: 'movil', width: 390, height: 844 },
  { name: 'tablet', width: 1024, height: 768 },
  { name: 'escritorio', width: 1440, height: 900 },
];

const problems = [];
const browser = await chromium.launch();

for (const size of SIZES) {
  const ctx = await browser.newContext({ viewport: { width: size.width, height: size.height }, locale: 'es-ES', timezoneId: 'Europe/Madrid', deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  page.on('console', (m) => {
    if (m.type() === 'error' && !/status of 4\d\d/.test(m.text())) problems.push(`[${size.name}] ${page.url()} consola: ${m.text()}`);
  });
  page.on('pageerror', (e) => problems.push(`[${size.name}] ${page.url()} error: ${e.message}`));

  const shot = async (name) => {
    await page.waitForLoadState('networkidle');
    await page.waitForFunction(() => !document.querySelector('.skeleton, [aria-busy="true"]'), null, { timeout: 15000 });
    await page.waitForTimeout(1500);
    const sw = await page.evaluate(() => document.documentElement.scrollWidth);
    if (sw > size.width) problems.push(`[${size.name}] ${name}: desplazamiento horizontal (${sw}px)`);
    await page.screenshot({ path: path.join(OUT, `${name}-${size.name}.png`) });
  };

  await page.goto(`${BASE}/`);
  await shot('01-portada');
  await page.goto(`${BASE}/entrar`);
  await shot('02-entrar');
  await page.getByLabel('Email').fill('demo@example.com');
  await page.getByLabel('Contraseña', { exact: true }).fill('Demo-EnRegla-2026');
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await page.waitForURL(/\/hoy$/);
  await page.getByText(/Quedan \d+ de \d+|Todo hecho|Sin tareas/).first().waitFor();
  const org = page.url().replace(/\/hoy$/, '');
  await shot('03-hoy');
  await page.goto(`${org}/registrar/temperatura`);
  await page.locator('label').filter({ hasText: 'máx. 4 °C' }).first().click();
  await page.getByLabel('Temperatura (°C)').fill('7,5');
  await page.getByText('está fuera de rango').waitFor();
  await shot('04-registrar-fuera-de-rango');
  await page.goto(`${org}/historial`);
  await shot('05-historial');
  await page.goto(`${org}/alergenos`);
  await shot('06-alergenos');
  await page.goto(`${org}/informes`);
  await shot('07-informes');
  await page.goto(`${org}/ajustes`);
  await shot('08-ajustes');
  await page.goto(`${org}/facturacion`);
  await shot('09-facturacion');
  await page.goto(`${BASE}/carta/${SLUG}`);
  await shot('10-carta-publica');
  await page.goto(`${BASE}/cocina/vincular#token=${KIOSK}`);
  await page.waitForURL(/\/cocina$/);
  await shot('11-cocina-inicio');
  await page.getByRole('button', { name: /Cámara de carnes/ }).first().click();
  await page.getByRole('button', { name: /Luis Pérez/ }).click();
  await page.getByRole('button', { name: '2', exact: true }).click();
  await page.getByRole('button', { name: 'Coma decimal' }).click();
  await page.getByRole('button', { name: '8', exact: true }).click();
  await shot('12-cocina-temperatura');
  await ctx.close();
}
await browser.close();

if (problems.length) {
  console.error(problems.join('\n'));
  process.exit(1);
}
console.log(`Capturas guardadas en ${OUT} sin errores de consola ni CSP.`);
