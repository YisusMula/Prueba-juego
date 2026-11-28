/**
 * Compilación DEMO (`npm run build:demo`): la interfaz real con el backend simulado de `src/demo/`,
 * como página estática con rutas relativas para publicarla como Artifact.
 *  - Entrada `src/demo/main.tsx` (la compilación normal sigue usando `src/main.tsx` y no incluye nada de la demo).
 *  - Sin PWA ni service worker; sin datos legales (las páginas legales muestran sus marcadores).
 *  - Un único JS (sin trozos dinámicos) y un CSS; fuentes como ficheros.
 *  - `scripts/demo-postbuild.mjs` convierte el index.html al formato del Artifact y escribe files.json.
 */
import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  base: './',
  // Ninguna variable VITE_* del entorno (soporte, datos legales…) entra en la demo.
  envPrefix: 'ENREGLA_DEMO_ONLY_',
  publicDir: fileURLToPath(new URL('./src/demo/public', import.meta.url)),
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@shared/schemas': fileURLToPath(new URL('../server/src/schemas/index.ts', import.meta.url)),
    },
    dedupe: ['zod'],
  },
  build: {
    // Se compila aparte y scripts/demo-postbuild.mjs sustituye dist-demo/ al final: nunca queda a medias.
    outDir: 'dist-demo.tmp',
    emptyOutDir: true,
    target: 'es2022',
    sourcemap: false,
    assetsInlineLimit: 0,
    modulePreload: false,
    chunkSizeWarningLimit: 2000,
    rollupOptions: {
      output: { inlineDynamicImports: true },
    },
  },
  plugins: [
    react(),
    tailwindcss(),
    {
      name: 'enregla-demo-entry',
      transformIndexHtml: {
        order: 'pre',
        handler: (html) =>
          html
            .replace('/src/main.tsx', '/src/demo/main.tsx')
            .replaceAll('%APP_NAME%', 'EnRegla')
            .replace('<!--SEO-->', '')
            // Nada de iconos ni recursos de la raíz del sitio: la demo vive en un subdirectorio.
            .replace(/\s*<link rel="(icon|apple-touch-icon)"[^>]*>/g, ''),
      },
    },
  ],
});
