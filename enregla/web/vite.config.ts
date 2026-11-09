/// <reference types="vitest/config" />
import { fileURLToPath, URL } from 'node:url';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  const appName = env.VITE_APP_NAME || 'EnRegla';
  const apiTarget = process.env.ENREGLA_API_URL || 'http://localhost:3000';

  return {
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
        '@shared/schemas': fileURLToPath(new URL('../server/src/schemas/index.ts', import.meta.url)),
      },
      // El fichero de esquemas del servidor importa `zod`: se usa siempre la copia de web/.
      dedupe: ['zod'],
    },
    server: {
      port: 5173,
      strictPort: true,
      proxy: {
        // Mismo origen para la SPA y la API: la cookie de sesión funciona sin CORS y el
        // navegador envía Origin http://localhost:5173, que coincide con APP_URL del .env de desarrollo.
        '/api': { target: apiTarget, changeOrigin: false },
        '/healthz': { target: apiTarget },
      },
    },
    build: {
      target: 'es2022',
      sourcemap: false,
      // Sin módulos inline en base64 que pudieran chocar con la CSP (fuentes/imágenes como ficheros).
      assetsInlineLimit: 0,
    },
    plugins: [
      react(),
      tailwindcss(),
      {
        name: 'enregla-html-app-name',
        transformIndexHtml: (html) => html.replaceAll('%APP_NAME%', appName),
      },
      VitePWA({
        registerType: 'autoUpdate',
        injectRegister: false,
        includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
        manifest: {
          name: appName,
          short_name: appName,
          description: 'Registros de higiene alimentaria (APPCC) en el móvil y la tablet de cocina.',
          lang: 'es-ES',
          start_url: '/app',
          scope: '/',
          display: 'standalone',
          background_color: '#f6f4ef',
          theme_color: '#0d5c63',
          icons: [
            { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
            { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
            { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          ],
        },
        workbox: {
          globPatterns: ['**/*.{js,css,html,svg,png,woff2,webmanifest}'],
          navigateFallback: '/index.html',
          // Nunca se sirve la SPA (ni nada de caché) para la API, descargas ni salud.
          navigateFallbackDenylist: [/^\/api(\/|$)/, /^\/healthz$/, /^\/readyz$/],
          runtimeCaching: [],
          cleanupOutdatedCaches: true,
        },
      }),
    ],
    test: {
      environment: 'jsdom',
      globals: false,
      setupFiles: ['./src/test/setup.ts'],
      include: ['src/**/*.test.{ts,tsx}'],
      css: false,
    },
  };
});
