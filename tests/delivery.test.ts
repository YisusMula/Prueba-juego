/**
 * Entrega de la aplicación: manifiesto e iconos.
 *
 * El service worker se comprueba en navegador (no tiene sentido simular
 * `caches` en Node); aquí se valida lo que sí es un dato: el manifiesto.
 */

import { describe, expect, it } from 'vitest';
// Los ficheros se leen con los importadores de Vite en vez de con `fs`: así el
// test no necesita los tipos de Node y falla en compilación si alguno de estos
// ficheros desaparece.
import manifestSource from '../public/manifest.webmanifest?raw';
import swSource from '../public/sw.js?raw';
import htmlSource from '../index.html?raw';

/** Ficheros presentes en `public/`, para comprobar que los iconos existen. */
const publicFiles = new Set(
  Object.keys(import.meta.glob('../public/*', { eager: false })).map((path) =>
    path.replace('../public/', ''),
  ),
);

const manifest = JSON.parse(manifestSource) as {
  name: string;
  short_name: string;
  description: string;
  display: string;
  theme_color: string;
  background_color: string;
  icons: { src: string; sizes: string; type: string; purpose: string }[];
};

describe('app-delivery: manifiesto', () => {
  it('describe la aplicación', () => {
    expect(manifest.name.length).toBeGreaterThan(0);
    expect(manifest.short_name.length).toBeGreaterThan(0);
    expect(manifest.description.length).toBeGreaterThan(0);
    expect(manifest.display).toBe('standalone');
    expect(manifest.theme_color).toMatch(/^#[0-9a-f]{6}$/i);
    expect(manifest.background_color).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it('tiene un icono grande y uno maskable', () => {
    const sizeOf = (icon: { sizes: string }): number =>
      Number.parseInt(icon.sizes.split('x')[0] ?? '0', 10) || 0;

    expect(manifest.icons.some((icon) => sizeOf(icon) >= 512)).toBe(true);
    expect(manifest.icons.some((icon) => icon.purpose === 'maskable')).toBe(true);
  });

  it('todos los iconos declarados existen', () => {
    for (const icon of manifest.icons) {
      expect(publicFiles.has(icon.src.replace('./', '')), icon.src).toBe(true);
    }
  });

  it('el documento enlaza el manifiesto y el color de tema', () => {
    expect(htmlSource).toContain('rel="manifest"');
    expect(htmlSource).toContain('name="theme-color"');
    expect(htmlSource).toContain('rel="apple-touch-icon"');
  });
});

describe('app-delivery: service worker', () => {
  const sw = swSource;

  it('ignora lo que no es GET del mismo origen', () => {
    expect(sw).toContain("request.method !== 'GET'");
    expect(sw).toContain('url.origin !== self.location.origin');
  });

  it('borra las cachés de versiones anteriores', () => {
    expect(sw).toContain('caches.delete');
    expect(sw).toContain('name !== CACHE');
  });

  it('guarda lo que la página declara haber cargado', () => {
    // El service worker se registra tras `load`, así que no controla la primera
    // carga: sin este mensaje, la caché se quedaría sin el documento ni el
    // código y el juego no arrancaría sin red.
    expect(sw).toContain("'cache-shell'");
  });

  it('usa caché primero solo para recursos con hash', () => {
    expect(sw).toContain('cacheFirst');
    expect(sw).toContain('networkFirst');
    // La regla de "tiene hash" debe reconocer un nombre de recurso real de Vite.
    const hashed = /-[A-Za-z0-9_-]{8,}\.(?:js|css|png|svg|woff2?)$/;
    expect(hashed.test('/assets/index-BaVm6F-y.js')).toBe(true);
    expect(hashed.test('/assets/index-BxvFYs7q.css')).toBe(true);
    expect(hashed.test('/index.html')).toBe(false);
    expect(hashed.test('/manifest.webmanifest')).toBe(false);
  });
});
