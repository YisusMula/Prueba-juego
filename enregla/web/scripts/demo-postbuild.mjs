/**
 * Post-compilación de la demo: convierte dist-demo/index.html al formato que exige un Artifact
 * (sin <!doctype>, <html>, <head> ni <body>; empieza por <title>; rutas relativas sin barra inicial)
 * y escribe dist-demo/files.json con los ficheros de apoyo (todo menos index.html).
 */
import { existsSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const web = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// Vite compila en dist-demo.tmp/; aquí se transforma y, solo si todo está bien, sustituye a dist-demo/.
const root = path.join(web, 'dist-demo.tmp');
const finalDir = path.join(web, 'dist-demo');
const html = readFileSync(path.join(root, 'index.html'), 'utf8');

const rel = (p) => p.replace(/^\.\//, '');
const scripts = [...html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"[^>]*><\/script>/g)].map((m) => rel(m[1]));
const styles = [...html.matchAll(/<link\b[^>]*rel="stylesheet"[^>]*href="([^"]+)"[^>]*>/g)].map((m) => rel(m[1]));
if (scripts.length !== 1 || styles.length !== 1) {
  console.error(`Se esperaba 1 script y 1 hoja de estilos en index.html; hay ${scripts.length} y ${styles.length}.`);
  process.exit(1);
}
for (const p of [...scripts, ...styles]) {
  if (p.startsWith('/') || /^[a-z]+:/i.test(p)) {
    console.error(`Ruta no relativa en index.html: ${p}`);
    process.exit(1);
  }
}

const page = [
  '<title>EnRegla Demo</title>',
  ...styles.map((s) => `<link rel="stylesheet" href="${s}">`),
  '<div id="root"></div>',
  ...scripts.map((s) => `<script type="module" src="${s}"></script>`),
  '',
].join('\n');
writeFileSync(path.join(root, 'index.html'), page);

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}
const all = walk(root).map((f) => path.relative(root, f).split(path.sep).join('/'));
const files = all.filter((f) => f !== 'index.html' && f !== 'files.json').sort();
writeFileSync(path.join(root, 'files.json'), `${JSON.stringify(files, null, 2)}\n`);

// Comprobaciones del contrato: referencias relativas existentes, límites de ficheros y tamaño.
for (const p of [...scripts, ...styles]) {
  if (!files.includes(p)) {
    console.error(`index.html referencia ${p}, que no existe`);
    process.exit(1);
  }
}
const sizeOf = (f) => statSync(path.join(root, f)).size;
const total = files.reduce((a, f) => a + sizeOf(f), 0) + sizeOf('index.html');
const MB = 1024 * 1024;
if (files.length > 255) {
  console.error(`Demasiados ficheros de apoyo: ${files.length} (máximo 255)`);
  process.exit(1);
}
const big = files.filter((f) => sizeOf(f) > 15 * MB);
if (big.length) {
  console.error(`Ficheros demasiado grandes: ${big.join(', ')}`);
  process.exit(1);
}
const old = path.join(web, 'dist-demo.old');
rmSync(old, { recursive: true, force: true });
if (existsSync(finalDir)) renameSync(finalDir, old);
renameSync(root, finalDir);
rmSync(old, { recursive: true, force: true });
console.log(`dist-demo listo: index.html + ${files.length} ficheros de apoyo, ${(total / 1024).toFixed(0)} KB en total.`);
