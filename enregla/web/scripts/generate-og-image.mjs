/* global document */
/**
 * Genera la imagen social (Open Graph / Twitter) de la portada: public/og-image.png, 1200×630.
 * Composición propia (sin fotos de terceros) con las fuentes autoalojadas del proyecto.
 *   node scripts/generate-og-image.mjs
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Fuentes incrustadas como data: (setContent no puede leer file://).
const font = (p) =>
  `data:font/woff2;base64,${readFileSync(fileURLToPath(new URL(`../node_modules/@fontsource-variable/${p}`, import.meta.url))).toString('base64')}`;
const OUT = fileURLToPath(new URL('../public/og-image.png', import.meta.url));
const name = process.env.VITE_APP_NAME || 'EnRegla';

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
@font-face{font-family:B;src:url('${font('bricolage-grotesque/files/bricolage-grotesque-latin-wght-normal.woff2')}');font-weight:200 800}
@font-face{font-family:A;src:url('${font('atkinson-hyperlegible-next/files/atkinson-hyperlegible-next-latin-wght-normal.woff2')}');font-weight:200 800}
@font-face{font-family:A;src:url('${font('bricolage-grotesque/files/bricolage-grotesque-latin-wght-normal.woff2')}');unicode-range:U+0030-0039}
*{box-sizing:border-box;margin:0}
body{width:1200px;height:630px;background:#f6f4ef;font-family:A,sans-serif;color:#15232d;display:flex;overflow:hidden}
.l{flex:1.15;padding:64px 56px 56px 72px;display:flex;flex-direction:column}
.brand{display:flex;align-items:center;gap:16px;font-family:B;font-weight:800;font-size:40px}
h1{font-family:B;font-weight:800;font-size:62px;line-height:1.04;letter-spacing:-.02em;margin-top:44px}
h1 span{color:#0d5c63}
.sub{margin-top:22px;font-size:27px;color:#4c5a63;line-height:1.35}
.price{margin-top:auto;display:inline-flex;align-self:flex-start;background:#0d5c63;color:#fff;font-weight:700;font-size:28px;padding:14px 26px;border-radius:18px}
.r{width:430px;background:#08454b;position:relative;display:flex;align-items:center;justify-content:center}
.card{width:340px;background:#fff;border-radius:28px;padding:26px;box-shadow:0 20px 50px rgba(0,0,0,.3);transform:rotate(-2deg)}
.k{font-size:15px;font-weight:700;color:#0d5c63;letter-spacing:.06em;text-transform:uppercase}
.t{font-family:B;font-weight:800;font-size:26px;margin-top:2px}
.row{display:flex;align-items:center;justify-content:space-between;border:1px solid #d9d4c8;border-radius:16px;padding:12px 14px;margin-top:12px;font-weight:700;font-size:19px;background:#f6f4ef}
.ok{background:#dcf1e3;color:#1b7340;border-radius:999px;padding:3px 12px;font-size:17px}
.bad{background:#c8321f;color:#fff;border-radius:999px;padding:3px 12px;font-size:17px}
.row.b{background:#fde3df;border-color:#e9a79c}
</style></head><body>
<div class="l">
  <div class="brand"><svg width="56" height="56" viewBox="0 0 48 48"><rect x="2" y="2" width="44" height="44" rx="13" fill="#0d5c63"/><path d="M12 25.5l7.5 7.5L35 15" fill="none" stroke="#fff" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/><circle cx="35" cy="15" r="4.2" fill="#9fdccf" stroke="#fff" stroke-width="2.5"/></svg>${name}</div>
  <h1>Los registros de higiene de tu cocina, <span>al día y sin papeles</span></h1>
  <p class="sub">Temperaturas, limpieza, recepción, aceite, plagas y alérgenos. Para bares, restaurantes, cafeterías y obradores.</p>
  <div class="price">12 €/mes por local · 14 días gratis</div>
</div>
<div class="r"><div class="card">
  <div class="k">Hoy</div><div class="t">Bar La Esquina</div>
  <div class="row"><span>Cámara de carnes</span><span class="ok">2,8 °C</span></div>
  <div class="row"><span>Congelador</span><span class="ok">−19 °C</span></div>
  <div class="row b"><span>Vitrina de postres</span><span class="bad">7,1 °C</span></div>
  <div class="row"><span>Limpieza diaria</span><span class="ok">Hecha</span></div>
</div></div>
</body></html>`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
await page.setContent(html, { waitUntil: 'load' });
await page.evaluate(() => document.fonts.ready);
await page.screenshot({ path: OUT, type: 'png' });
await browser.close();
console.log(`Imagen social guardada en ${OUT}`);
