/* global window, document, getComputedStyle -- usados dentro de page.evaluate (se ejecutan en el navegador) */
/**
 * Prueba de la demo TAL Y COMO SE VERÁ como Artifact:
 *  - sirve dist-demo/ bajo un subdirectorio (http://localhost:4173/a/b/) para demostrar que las rutas son relativas,
 *  - envuelve index.html en el esqueleto que añade el visor y lo carga en un <iframe sandbox="allow-scripts allow-same-origin">
 *    de otra página, con una CSP parecida a la del visor,
 *  - falla ante cualquier error de consola, violación de CSP, petición a otro origen o petición a /api.
 * Recorre la demo (con y sin localStorage, sin window.claude y con un window.claude falso) y hace capturas.
 * Uso: npm run build:demo && npm run demo:check   (opcional: DEMO_SHOTS=<carpeta>, DEMO_ONLY=recorrido|bloqueado|descargas|capturas)
 */
import http from 'node:http';
import { mkdirSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, expect } from '@playwright/test';

const here = path.dirname(fileURLToPath(import.meta.url));
const dist = path.resolve(here, '../dist-demo');
const PORT = Number(process.env.DEMO_PORT ?? 4173);
const ORIGIN = `http://localhost:${PORT}`;
const BASE = '/a/b/';
const SHOTS = path.resolve(process.env.DEMO_SHOTS ?? path.join(here, '../test-results/demo'));
const ONLY = process.env.DEMO_ONLY ?? '';
const CSP =
  "default-src 'self'; script-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com https://cdn.jsdelivr.net https://unpkg.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; worker-src 'self' blob:";
const TYPES = { '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.png': 'image/png', '.pdf': 'application/pdf', '.json': 'application/json', '.svg': 'image/svg+xml' };

if (!existsSync(path.join(dist, 'index.html'))) {
  console.error('Falta dist-demo/: ejecuta antes npm run build:demo');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Servidor estático: página exterior con el iframe y la página de la demo bajo /a/b/
// ---------------------------------------------------------------------------
const unexpected = [];
const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? '/', ORIGIN);
  if (url.pathname === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(
      `<!doctype html><html><head><meta charset="utf8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Visor</title>
<style>html,body{margin:0;height:100%}iframe{display:block;border:0;width:100%;height:100%}</style></head>
<body><iframe src="${BASE}" title="Demo" sandbox="allow-scripts allow-same-origin"></iframe></body></html>`,
    );
    return;
  }
  if (!url.pathname.startsWith(BASE)) {
    unexpected.push(`fuera del subdirectorio: ${url.pathname}`);
    res.writeHead(404).end();
    return;
  }
  const rel = decodeURIComponent(url.pathname.slice(BASE.length)) || 'index.html';
  const file = path.resolve(dist, rel);
  if (!file.startsWith(dist) || !existsSync(file)) {
    unexpected.push(`404: ${url.pathname}`);
    res.writeHead(404, { 'Content-Security-Policy': CSP }).end();
    return;
  }
  if (rel === 'index.html') {
    const body = readFileSync(file, 'utf8');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': CSP });
    res.end(
      `<!doctype html><html><head><meta charset="utf8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"></head><body>${body}</body></html>`,
    );
    return;
  }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] ?? 'application/octet-stream', 'Content-Security-Policy': CSP });
  res.end(readFileSync(file));
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));

const browser = await chromium.launch();
const results = [];

/** Init scripts (se ejecutan en el iframe antes que la app). */
const CSP_RECORDER = `window.__csp = []; document.addEventListener('securitypolicyviolation', (e) => window.__csp.push(e.violatedDirective + ' ' + e.blockedURI));`;
const BLOCK_STORAGE = `for (const k of ['localStorage', 'sessionStorage']) Object.defineProperty(window, k, { configurable: true, get() { throw new DOMException('Bloqueado', 'SecurityError'); } });`;
const FAKE_CLAUDE = `window.__saved = []; window.claude = { use: async (name) => name === 'downloads' ? Object.freeze({ save: async (req) => { const active = navigator.userActivation ? navigator.userActivation.isActive : null; const d = req.data; const text = typeof d === 'string' ? d : d instanceof Blob ? await d.text() : ''; const head = typeof d === 'string' ? d.slice(0, 5) : (d instanceof Blob ? (await d.slice(0, 5).text()) : ''); window.__saved.push({ active, filename: req.filename, size: typeof d === 'string' ? d.length : d.size, head, text: text.slice(0, 400), type: typeof d === 'string' ? 'string' : 'blob' }); return { status: 'saved' }; } }) : null };`;

async function open({ viewport, colorScheme = 'light', init = [], dataTheme = null }) {
  const context = await browser.newContext({ viewport, colorScheme, locale: 'es-ES', timezoneId: 'Europe/Madrid', reducedMotion: 'reduce' });
  for (const s of [CSP_RECORDER, ...init]) await context.addInitScript({ content: s });
  if (dataTheme) {
    // Como el visor: fija data-theme en el elemento raíz de la página de la demo.
    await context.addInitScript({
      content: `if (window !== window.top) { const set = () => document.documentElement && document.documentElement.setAttribute('data-theme', ${JSON.stringify(dataTheme)}); set(); document.addEventListener('readystatechange', set); }`,
    });
  }
  const page = await context.newPage();
  const problems = [];
  current = { page, problems };
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') problems.push(`console.error: ${m.text()}`);
  });
  context.on('request', (r) => {
    const u = new URL(r.url());
    if (u.protocol === 'data:' || u.protocol === 'blob:') return;
    if (u.origin !== ORIGIN) problems.push(`petición a otro origen: ${r.url()}`);
    if (/\/api(\/|$)/.test(u.pathname)) problems.push(`petición de red a la API: ${r.url()}`);
  });
  page.on('popup', (p) => problems.push(`ventana nueva: ${p.url()}`));
  page.on('download', (d) => problems.push(`descarga directa: ${d.suggestedFilename()}`));
  await page.goto(ORIGIN + '/');
  const f = page.frameLocator('iframe');
  const frame = () => page.frames().find((x) => x !== page.mainFrame());
  const check = async (label) => {
    const fr = frame();
    const csp = fr ? await fr.evaluate(() => window.__csp ?? []) : [];
    const all = [...problems, ...csp.map((c) => `CSP: ${c}`), ...unexpected.splice(0)];
    if (all.length) throw new Error(`${label}:\n  ${all.join('\n  ')}`);
  };
  return { context, page, f, frame, check, problems };
}

let aborted = false;
let current = null;
async function step(name, fn) {
  const t0 = Date.now();
  if (aborted) {
    results.push({ name, ok: false, error: 'no ejecutado (falló un paso anterior)' });
    console.log(`  - ${name}: no ejecutado`);
    return;
  }
  try {
    await fn();
    results.push({ name, ok: true, ms: Date.now() - t0 });
    console.log(`  ✓ ${name} (${Date.now() - t0} ms)`);
  } catch (err) {
    results.push({ name, ok: false, error: String(err?.message ?? err) });
    aborted = true;
    if (current) {
      if (current.problems.length) console.log(`      problemas registrados:\n        ${current.problems.join('\n        ')}`);
      mkdirSync(SHOTS, { recursive: true });
      await current.page.screenshot({ path: path.join(SHOTS, `fallo-${results.length}.png`) }).catch(() => undefined);
    }
    console.log(`  ✗ ${name}\n${String(err?.message ?? err)
      .split('\n')
      .slice(0, 25)
      .map((l) => `      ${l}`)
      .join('\n')}`);
  }
}

// ---------------------------------------------------------------------------
// Ayudantes de navegación (escritorio: barra lateral; móvil: barra inferior y «Más»)
// ---------------------------------------------------------------------------
const desktop = (s) => s.page.viewportSize().width >= 1024;
async function nav(s, name) {
  const { f } = s;
  const main = f.getByRole('navigation', { name: 'Principal' });
  if (desktop(s)) return main.getByRole('link', { name, exact: true }).click();
  if (['Hoy', 'Historial', 'Registrar', 'Informes'].includes(name)) return main.getByRole('link', { name, exact: true }).click();
  await main.getByRole('link', { name: 'Más', exact: true }).click();
  if (name === 'Ajustes') return;
  await f.getByRole('link', { name: name === 'Alérgenos' ? /Carta de alérgenos/ : name }).click();
}
const bar = (s) => s.f.getByRole('navigation', { name: 'Demo: ir a' });
async function goFace(s, label) {
  await bar(s).getByRole('button', { name: label }).click();
}
async function settings(s, title) {
  await nav(s, 'Ajustes');
  await s.f.getByRole('link', { name: new RegExp(title) }).filter({ visible: true }).first().click();
}
async function logout(s) {
  if (desktop(s)) await s.f.getByRole('button', { name: 'Cerrar sesión' }).filter({ visible: true }).first().click();
  else {
    await nav(s, 'Ajustes');
    await s.f.getByRole('button', { name: 'Cerrar sesión' }).filter({ visible: true }).first().click();
  }
  await expect(s.f.getByText('Has cerrado sesión')).toBeVisible();
}

// ---------------------------------------------------------------------------
// Recorrido completo
// ---------------------------------------------------------------------------
async function walkthrough(label, opts) {
  console.log(`\n${label}`);
  aborted = false;
  const s = await open(opts);
  const { f } = s;
  const stamp = Date.now() % 100000;

  await step('arranca en Hoy con datos (Panel del dueño)', async () => {
    await expect(f.getByText(/tareas hechas/).filter({ visible: true }).first()).toBeVisible();
    await expect(bar(s).getByRole('button', { name: 'Panel del dueño' })).toHaveAttribute('aria-current', 'page');
    await expect(f.getByText('Restaurante La Demo').filter({ visible: true }).first()).toBeVisible();
    await expect(f.getByText(/Cámara de carnes y pescados/).filter({ visible: true }).first()).toBeVisible();
    await expect(f.getByText('Los datos son de ejemplo y no se guardan')).toBeVisible();
    await s.check('Hoy');
  });

  await step('temperatura normal y fuera de rango con acción correctora → Hoy e Historial', async () => {
    await nav(s, 'Registrar');
    await f.getByRole('link', { name: /Temperatura/ }).filter({ visible: true }).first().click();
    await f.locator('label').filter({ hasText: 'Cámara de verduras y lácteos' }).filter({ visible: true }).first().click();
    await f.getByLabel('Temperatura (°C)').fill('3,2');
    await expect(f.getByText('dentro de rango')).toBeVisible();
    await f.getByRole('button', { name: 'Guardar temperatura' }).click();
    await expect(f.getByTestId('record-saved')).toContainText('Hecho');
    await f.getByRole('button', { name: 'Registrar otro' }).click();
    await f.locator('label').filter({ hasText: 'Cámara de verduras y lácteos' }).filter({ visible: true }).first().click();
    await f.getByLabel('Temperatura (°C)').fill('9,7');
    await expect(f.getByText('está fuera de rango')).toBeVisible();
    await f.getByRole('button', { name: 'Guardar con acción correctora' }).click();
    await expect(f.getByText('Fuera de rango: indica qué has hecho')).toBeVisible();
    await f.getByRole('button', { name: 'Producto desechado' }).click();
    await f.getByRole('button', { name: 'Guardar con acción correctora' }).click();
    await expect(f.getByTestId('record-saved')).toContainText('Guardado, con alerta');
    await f.getByRole('link', { name: 'Volver a Hoy' }).click();
    await expect(f.getByRole('heading', { name: 'Alertas' })).toBeVisible();
    await expect(f.getByText(/9,7/).filter({ visible: true }).first()).toBeVisible();
    await nav(s, 'Historial');
    await expect(f.getByRole('link').filter({ hasText: '3,2 °C' }).filter({ visible: true }).first()).toBeVisible();
    const row = f.getByRole('link').filter({ hasText: '9,7 °C' }).filter({ visible: true }).first();
    await expect(row).toContainText('Alerta');
    await row.click();
    await expect(f.getByText('Producto desechado')).toBeVisible();
    await s.check('temperaturas');
  });

  await step('enmienda (corrección con motivo)', async () => {
    await f.getByRole('button', { name: 'Corregir' }).click();
    await f.getByLabel('Temperatura (°C)').fill('2,5');
    await f.getByLabel('Motivo de la corrección').fill('Se leyó mal el termómetro');
    await f.getByRole('button', { name: 'Guardar corrección' }).click();
    await expect(f.getByText('Corrección guardada')).toBeVisible();
    await expect(f.getByText('Este registro es una corrección')).toBeVisible();
    await expect(f.getByText(/Motivo: Se leyó mal el termómetro/)).toBeVisible();
    await f.getByRole('link', { name: 'Ver el original' }).click();
    await expect(f.getByText('Este registro fue corregido')).toBeVisible();
    await s.check('enmienda');
  });

  await step('limpieza parcial (cuenta como pendiente en Hoy)', async () => {
    await nav(s, 'Registrar');
    await f.getByRole('link', { name: /Limpieza/ }).filter({ visible: true }).first().click();
    await f.getByRole('radio', { name: /Limpieza diaria de cocina/ }).check({ force: true });
    await f.getByText('Superficies y mesas de trabajo').click();
    await f.getByText('Suelos de cocina').click();
    await expect(f.getByText(/Se guardará como/)).toContainText('parcial (2 de 5)');
    await f.getByRole('button', { name: 'Guardar registro' }).click();
    await f.getByRole('dialog').getByRole('button', { name: 'Guardar como parcial' }).click();
    await expect(f.getByTestId('record-saved')).toBeVisible();
    await f.getByRole('link', { name: 'Volver a Hoy' }).click();
    await expect(f.getByText(/Parcial \(2 de 5\)/).filter({ visible: true }).first()).toBeVisible();
    await s.check('limpieza');
  });

  await step('recepción de mercancía con incidencia (caducada aceptada con motivo)', async () => {
    await nav(s, 'Registrar');
    await f.getByRole('link', { name: /Recepción/ }).filter({ visible: true }).first().click();
    await f.getByLabel('Proveedor').selectOption({ label: 'Lácteos La Vaca' });
    await f.getByLabel('Producto').fill('Nata');
    await f.getByLabel(/Fecha de caducidad/).fill('2020-01-02');
    await expect(f.getByText('La fecha de caducidad ya ha pasado')).toBeVisible();
    await f.getByText('Sí, aceptarla con motivo').click();
    await f.getByRole('button', { name: 'Guardar registro' }).click();
    await expect(f.getByText(/indica|motivo/i).filter({ visible: true }).first()).toBeVisible();
    await f.getByLabel('¿Por qué la aceptas?').fill('Uso inmediato en cocción, revisada en buen estado');
    await f.getByRole('button', { name: 'Guardar registro' }).click();
    await expect(f.getByTestId('record-saved')).toContainText(/alerta/i);
    await f.getByRole('link', { name: 'Volver a Hoy' }).click();
    await expect(f.getByText(/Mercancía aceptada caducada: Nata/)).toBeVisible();
    await s.check('recepción');
  });

  await step('alérgenos: plato nuevo pendiente → revisar → aparece en la carta', async () => {
    await nav(s, 'Alérgenos');
    await f.getByRole('button', { name: 'Añadir plato' }).click();
    const dlg = f.getByRole('dialog');
    await dlg.getByLabel('Nombre del plato').fill(`Tarta demo ${stamp}`);
    await dlg.getByLabel(/Categoría/).fill('Postres');
    await dlg.getByRole('radio', { name: 'Gluten: Contiene' }).click();
    await dlg.getByRole('radio', { name: 'Leche: Contiene' }).click();
    await dlg.getByRole('button', { name: 'Guardar sin revisar' }).click();
    const item = f.getByTestId('dish').filter({ hasText: `Tarta demo ${stamp}` });
    await expect(item).toContainText('Pendiente de revisar · no se muestra en la carta');
    await item.getByRole('button', { name: new RegExp(`Revisar Tarta demo ${stamp}`) }).click();
    await f.getByRole('dialog').getByRole('button', { name: 'Marcar los que faltan como «No contiene»' }).click();
    await f.getByRole('dialog').getByRole('button', { name: 'Guardar plato' }).click();
    await expect(item).not.toContainText('Pendiente de revisar');
    // Botones que dentro del visor no funcionan: sustituidos.
    await expect(f.getByTestId('public-menu-url')).toContainText('/carta/');
    await f.getByRole('button', { name: 'Copiar enlace' }).click();
    await expect(f.getByText(/Enlace copiado|cópialo a mano/)).toBeVisible();
    await f.getByRole('link', { name: 'Abrir la carta' }).click();
    await expect(f.getByRole('heading', { name: 'Restaurante La Demo' })).toBeVisible();
    await expect(f.locator('li').filter({ hasText: `Tarta demo ${stamp}` })).toBeVisible();
    await expect(bar(s).getByRole('button', { name: 'Carta de alérgenos' })).toHaveAttribute('aria-current', 'page');
    await s.check('alérgenos');
  });

  await step('carta pública con filtro (como comensal)', async () => {
    await goFace(s, 'Carta de alérgenos');
    await expect(f.getByText('Croquetas de jamón')).toBeVisible();
    await expect(f.getByText('Pulpo a la gallega')).toHaveCount(0);
    await expect(f.getByTestId('menu-notice')).toContainText('contaminación cruzada');
    const card = f.locator('li').filter({ hasText: 'Croquetas de jamón' });
    await f.getByRole('button', { name: 'Gluten', exact: true }).click();
    await expect(card).toContainText('No apto');
    await f.getByLabel('Ocultar platos que lo contienen').check();
    await expect(card).toHaveCount(0);
    await expect(f.getByText('Entrecot a la brasa')).toBeVisible();
    await s.check('carta');
  });

  await step('tabla imprimible sin botón Imprimir', async () => {
    await goFace(s, 'Panel del dueño');
    await nav(s, 'Alérgenos');
    await f.getByRole('link', { name: 'Imprimir tabla' }).click();
    await expect(f.getByRole('heading', { name: 'Información de alérgenos' })).toBeVisible();
    await expect(f.getByRole('button', { name: 'Imprimir' })).toHaveCount(0);
    await expect(f.getByText('En la demo no se puede imprimir')).toBeVisible();
    await f.getByRole('link', { name: 'Volver' }).click();
    await s.check('imprimir');
  });

  await step('Informes: CSV y PDF sin window.claude (vista previa)', async () => {
    await nav(s, 'Informes');
    await expect(f.getByRole('img', { name: /Porcentaje de tareas hechas por día/ })).toBeVisible();
    await expect(f.getByRole('button', { name: 'Informe PDF' })).toHaveCount(0);
    await f.getByRole('button', { name: 'Ver vista previa del CSV' }).click();
    await expect(f.getByTestId('csv-preview')).toContainText('temperatura');
    await expect(f.getByTestId('csv-preview')).toContainText(/filas y 41 columnas/);
    await f.getByRole('button', { name: 'Ver el PDF de ejemplo' }).click();
    await expect(f.getByText(/PDF de ejemplo con los datos iniciales de la demo/).filter({ visible: true }).first()).toBeVisible();
    const img = f.getByTestId('pdf-preview').getByRole('img');
    await expect(img).toBeVisible();
    expect(await img.evaluate((el) => el.complete && el.naturalWidth > 0)).toBe(true);
    await s.check('informes');
  });

  await step('Ajustes: equipo, personal y dispositivos', async () => {
    await settings(s, 'Equipos');
    await f.getByRole('button', { name: 'Añadir equipo' }).click();
    let dlg = f.getByRole('dialog');
    await dlg.getByLabel('Nombre').fill(`Vitrina demo ${stamp}`);
    await dlg.getByLabel('Tipo').selectOption('vitrina');
    await dlg.getByLabel('Máxima').fill('5');
    await dlg.getByRole('button', { name: 'Guardar equipo' }).click();
    await expect(f.getByText(`Vitrina demo ${stamp}`, { exact: true })).toBeVisible();
    await settings(s, 'Personal y PIN');
    await f.getByRole('button', { name: 'Añadir persona' }).click();
    dlg = f.getByRole('dialog');
    await dlg.getByLabel('Nombre').fill(`Rocío ${stamp}`);
    await dlg.getByLabel(/PIN/).fill('2468');
    await dlg.getByRole('button', { name: 'Guardar' }).click();
    await expect(f.locator('li').filter({ hasText: `Rocío ${stamp}` })).toContainText('Con PIN');
    await settings(s, 'Encargados e invitaciones');
    await f.getByLabel('Email').fill(`encargada-${stamp}@example.com`);
    await f.getByRole('button', { name: 'Enviar invitación' }).click();
    await expect(f.getByText(`encargada-${stamp}@example.com`, { exact: true })).toBeVisible();
    await settings(s, 'Dispositivos de cocina');
    await expect(f.locator('li').filter({ hasText: 'Tablet cocina' })).toContainText('Activo');
    await f.getByRole('button', { name: 'Vincular dispositivo' }).filter({ visible: true }).first().click();
    await f.getByLabel('Nombre del dispositivo').fill('Tablet barra');
    await f.getByRole('button', { name: 'Generar código de vinculación' }).click();
    await expect(f.getByText('Solo se muestra esta vez')).toBeVisible();
    await f.getByText('¿No puedes escanear? Copia el código').click();
    await f.getByRole('button', { name: 'Copiar código' }).click();
    await expect(f.getByText(/Copiado|seleccionado el código/)).toBeVisible();
    await f.getByRole('button', { name: 'Hecho' }).click();
    await expect(f.locator('li').filter({ hasText: 'Tablet barra' })).toContainText('Activo');
    await settings(s, 'Facturación');
    await expect(f.getByText('Pagos no disponibles en la demo')).toBeVisible();
    await settings(s, 'Exportar o eliminar datos');
    await f.getByRole('button', { name: 'Ver qué incluiría la exportación' }).click();
    await expect(f.getByTestId('export-preview')).toContainText('registros');
    await settings(s, 'Registro de actividad');
    await expect(f.getByText('Dispositivo de cocina vinculado').filter({ visible: true }).first()).toBeVisible();
    await s.check('ajustes');
  });

  await step('modo cocina: ¿quién eres?, PIN incorrecto y correcto, temperatura', async () => {
    await goFace(s, 'Modo cocina');
    await expect(f.getByRole('heading', { name: /¿Quién eres?/ })).toBeVisible();
    // Pantalla completa: solo se ofrece si el marco la permite, y un rechazo se tolera sin errores.
    const fsEnabled = await s.frame().evaluate(() => document.fullscreenEnabled);
    await expect(f.getByRole('button', { name: 'Pantalla completa' })).toHaveCount(fsEnabled && desktop(s) ? 1 : 0);
    if (fsEnabled && desktop(s)) {
      await f.getByRole('button', { name: 'Pantalla completa' }).click();
      await s.page.waitForTimeout(300);
      await s.frame().evaluate(() => (document.fullscreenElement ? document.exitFullscreen().catch(() => undefined) : undefined));
    }
    await f.getByRole('button', { name: /Marta Gil/ }).click();
    for (const d of '9999') await f.getByRole('button', { name: d, exact: true }).click();
    await f.getByRole('button', { name: 'Entrar' }).click();
    await expect(f.getByText('PIN incorrecto. Prueba otra vez.')).toBeVisible();
    for (const d of '5678') await f.getByRole('button', { name: d, exact: true }).click();
    await f.getByRole('button', { name: 'Entrar' }).click();
    await f.getByRole('button', { name: 'Temperatura', exact: true }).click();
    await f.getByRole('button', { name: /Congelador/ }).click();
    await f.getByRole('button', { name: 'Cambiar signo (negativo)' }).click();
    for (const d of '19') await f.getByRole('button', { name: d, exact: true }).click();
    await expect(f.getByLabel('Temperatura escrita')).toContainText('19 °C');
    await f.getByRole('button', { name: 'Guardar' }).click();
    await expect(f.getByTestId('kiosk-result')).toContainText('Hecho');
    await s.check('cocina');
  });

  await step('PIN bloqueado a los 5 fallos', async () => {
    await goFace(s, 'Modo cocina');
    await f.getByRole('button', { name: /Ana Martín/ }).click();
    for (let i = 0; i < 5; i++) {
      for (const d of '0000') await f.getByRole('button', { name: d, exact: true }).click();
      await f.getByRole('button', { name: 'Entrar' }).click();
      await s.page.waitForTimeout(500); // respuesta de la API simulada (120 ms) y teclado limpio
      if (i < 4) await expect(f.getByText('PIN incorrecto. Prueba otra vez.')).toBeVisible();
    }
    await expect(f.getByText(/bloqueado por demasiados intentos/)).toBeVisible();
    await s.check('pin');
  });

  await step('portada y precios', async () => {
    await goFace(s, 'Portada');
    await expect(f.getByTestId('hero-price')).toBeVisible();
    if (desktop(s)) await f.getByRole('navigation', { name: 'Secciones' }).getByRole('link', { name: 'Precios' }).click();
    else {
      await f.getByRole('button', { name: 'Abrir menú' }).click();
      await f.getByRole('navigation', { name: 'Menú' }).getByRole('link', { name: 'Precios' }).click();
    }
    await expect(f.locator('#precios')).toBeInViewport();
    await expect(f.locator('#precios')).toContainText('€');
    await f.getByRole('link', { name: /Pruébalo/ }).filter({ visible: true }).first().click();
    await expect(f.getByText('En la demo no se envían correos')).toBeVisible();
    await s.check('portada');
  });

  await step('cerrar sesión y volver a entrar (credenciales demo rellenadas)', async () => {
    await goFace(s, 'Panel del dueño');
    await expect(f.getByText('Restaurante La Demo').filter({ visible: true }).first()).toBeVisible();
    await logout(s);
    await expect(f.getByLabel('Email')).toHaveValue('demo@example.com');
    await f.getByRole('button', { name: 'Entrar', exact: true }).click();
    await expect(f.getByText('Restaurante La Demo').filter({ visible: true }).first()).toBeVisible();
    await s.check('login');
  });

  await step('Reiniciar demo', async () => {
    await f.getByRole('button', { name: 'Reiniciar demo' }).click();
    await f.getByRole('button', { name: 'Sí, reiniciar' }).click();
    await expect(f.getByText('Restaurante La Demo').filter({ visible: true }).first()).toBeVisible();
    await nav(s, 'Historial');
    await expect(f.getByRole('link').filter({ hasText: '9,7 °C' })).toHaveCount(0);
    await s.check('reinicio');
  });

  await step('recargar la página', async () => {
    await nav(s, 'Registrar');
    await f.getByRole('link', { name: /Temperatura/ }).filter({ visible: true }).first().click();
    await f.locator('label').filter({ hasText: 'Cámara de carnes y pescados' }).filter({ visible: true }).first().click();
    await f.getByLabel('Temperatura (°C)').fill('1,4');
    await f.getByRole('button', { name: 'Guardar temperatura' }).click();
    await expect(f.getByTestId('record-saved')).toContainText('Hecho');
    await s.page.reload();
    await expect(s.f.getByText('Restaurante La Demo').filter({ visible: true }).first()).toBeVisible();
    await nav(s, 'Historial');
    const persisted = s.f.getByRole('link').filter({ hasText: '1,4 °C' });
    if (opts.expectPersist) await expect(persisted.first()).toBeVisible();
    else await expect(persisted).toHaveCount(0);
    await s.check('recarga');
  });

  await s.context.close();
}

// ---------------------------------------------------------------------------
// Descargas con window.claude falso
// ---------------------------------------------------------------------------
async function downloads() {
  console.log('\nDescargas con window.claude.use("downloads") falso');
  aborted = false;
  const s = await open({ viewport: { width: 1280, height: 800 }, init: [FAKE_CLAUDE] });
  const { f } = s;
  await step('CSV y PDF se entregan con save() dentro del clic', async () => {
    await nav(s, 'Informes');
    await expect(f.getByRole('button', { name: 'Informe PDF' })).toBeVisible();
    await expect(f.getByText(/PDF de ejemplo con los datos iniciales de la demo/).filter({ visible: true }).first()).toBeVisible();
    await f.getByRole('button', { name: 'Hoja de cálculo (CSV)' }).click();
    await expect(f.getByText(/Listo: registros-restaurante-la-demo-.*\.csv/)).toBeVisible();
    await f.getByRole('button', { name: 'Informe PDF' }).click();
    await expect(f.getByText(/Listo: .*\.pdf/)).toBeVisible();
    const saved = await s.frame().evaluate(() => window.__saved);
    if (saved.length !== 2) throw new Error(`save() llamado ${saved.length} veces`);
    if (saved.some((x) => x.active !== true)) throw new Error(`save() fuera del gesto del usuario: ${JSON.stringify(saved.map((x) => x.active))}`);
    if (!saved[0].text.startsWith('﻿"id";"tipo";"fecha_hora"')) throw new Error(`CSV inesperado: ${saved[0].text.slice(0, 60)}`);
    if (saved[1].head !== '%PDF-' || saved[1].size < 10_000) throw new Error(`PDF inesperado: ${JSON.stringify(saved[1]).slice(0, 200)}`);
    await settings(s, 'Exportar o eliminar datos');
    await f.getByRole('button', { name: 'Descargar exportación' }).click();
    await expect(f.getByText(/Listo: exportacion-.*\.json/)).toBeVisible();
    await s.check('descargas');
  });
  await s.context.close();
}

// ---------------------------------------------------------------------------
// Capturas
// ---------------------------------------------------------------------------
async function screenshots() {
  console.log(`\nCapturas en ${SHOTS}`);
  mkdirSync(SHOTS, { recursive: true });
  const variants = [
    { id: 'claro', colorScheme: 'light' },
    { id: 'oscuro-sistema', colorScheme: 'dark' },
    { id: 'oscuro-forzado', colorScheme: 'light', dataTheme: 'dark' },
  ];
  const sizes = [
    { id: '390', viewport: { width: 390, height: 844 } },
    { id: '1280', viewport: { width: 1280, height: 800 } },
  ];
  for (const v of variants) {
    for (const z of sizes) {
      aborted = false;
      await step(`capturas ${z.id} ${v.id}`, async () => {
        const s = await open({ viewport: z.viewport, colorScheme: v.colorScheme, dataTheme: v.dataTheme });
        const { f, page } = s;
        const shot = async (name) => {
          await page.waitForTimeout(250);
          const overflow = await s.frame().evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
          if (overflow > 0) throw new Error(`scroll horizontal de ${overflow}px en ${name}`);
          await page.screenshot({ path: path.join(SHOTS, `${name}-${z.id}-${v.id}.png`) });
        };
        await expect(f.getByText(/Cámara de carnes y pescados/).filter({ visible: true }).first()).toBeVisible();
        if (v.dataTheme) {
          const bg = await s.frame().evaluate(() => getComputedStyle(document.body).backgroundColor);
          if (bg !== 'rgb(13, 20, 24)') throw new Error(`data-theme=dark no aplica el fondo oscuro (${bg})`);
        }
        await shot('hoy');
        await goFace(s, 'Modo cocina');
        await expect(f.getByRole('heading', { name: /¿Quién eres?/ })).toBeVisible();
        await shot('cocina');
        await goFace(s, 'Carta de alérgenos');
        await expect(f.getByText('Croquetas de jamón')).toBeVisible();
        await shot('carta');
        await goFace(s, 'Portada');
        await expect(f.getByTestId('hero-price')).toBeVisible();
        await shot('portada');
        await goFace(s, 'Panel del dueño');
        await nav(s, 'Informes');
        await expect(f.getByRole('img', { name: /Porcentaje de tareas hechas por día/ })).toBeVisible();
        await shot('informes');
        if (v.id === 'claro' || v.id === 'oscuro-forzado') {
          await f.getByRole('button', { name: 'Ver vista previa del CSV' }).click();
          await f.getByRole('button', { name: 'Ver el PDF de ejemplo' }).click();
          await f.getByRole('heading', { name: '3. Descargar' }).scrollIntoViewIfNeeded();
          await f.getByRole('heading', { name: '3. Descargar' }).evaluate((el) => el.scrollIntoView({ block: 'start' }));
          await shot('informes-descargas');
          await nav(s, 'Alérgenos');
          await expect(f.getByTestId('public-menu-url')).toBeVisible();
          await shot('alergenos');
          await settings(s, 'Facturación');
          await expect(f.getByText('Pagos no disponibles en la demo')).toBeVisible();
          await shot('facturacion');
        }
        await s.check('capturas');
        await s.context.close();
      });
    }
  }
}

try {
  if (!ONLY || ONLY === 'recorrido') await walkthrough('Recorrido 1280×800 (localStorage disponible, sin window.claude)', { viewport: { width: 1280, height: 800 }, expectPersist: true });
  if (!ONLY || ONLY === 'bloqueado') await walkthrough('Recorrido 390×844 con localStorage bloqueado', { viewport: { width: 390, height: 844 }, init: [BLOCK_STORAGE], expectPersist: false });
  if (!ONLY || ONLY === 'descargas') await downloads();
  if (!ONLY || ONLY === 'capturas') await screenshots();
} finally {
  await browser.close();
  server.close();
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} pasos correctos${failed.length ? `; fallan: ${failed.map((r) => r.name).join(' | ')}` : ''}`);
process.exit(failed.length ? 1 : 0);
