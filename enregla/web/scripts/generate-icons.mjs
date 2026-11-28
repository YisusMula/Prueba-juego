// Genera los iconos PNG de la PWA a partir del logotipo SVG (usa el Chromium de Playwright).
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const out = fileURLToPath(new URL('../public/', import.meta.url));
const mark = (pad) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" width="100%" height="100%">
  <rect width="48" height="48" fill="#0d5c63"/>
  <g transform="translate(${pad} ${pad}) scale(${(48 - 2 * pad) / 48})">
    <path d="M12 25.5l7.5 7.5L35 15" fill="none" stroke="#fff" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>
    <circle cx="35" cy="15" r="4.2" fill="#9fdccf" stroke="#fff" stroke-width="2.5"/>
  </g></svg>`;
const rounded = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" width="100%" height="100%"><rect x="0" y="0" width="48" height="48" rx="11" fill="#0d5c63"/><path d="M12 25.5l7.5 7.5L35 15" fill="none" stroke="#fff" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/><circle cx="35" cy="15" r="4.2" fill="#9fdccf" stroke="#fff" stroke-width="2.5"/></svg>`;

const jobs = [
  { file: 'icon-192.png', size: 192, svg: rounded, transparent: true },
  { file: 'icon-512.png', size: 512, svg: rounded, transparent: true },
  { file: 'icon-maskable-512.png', size: 512, svg: mark(8) },
  { file: 'apple-touch-icon.png', size: 180, svg: mark(4) },
];

const browser = await chromium.launch();
for (const j of jobs) {
  const page = await browser.newPage({ viewport: { width: j.size, height: j.size } });
  await page.setContent(`<html><body style="margin:0;background:transparent">${j.svg}</body></html>`);
  await page.screenshot({ path: path.join(out, j.file), omitBackground: !!j.transparent });
  await page.close();
}
await browser.close();
console.log('Iconos generados en public/');
