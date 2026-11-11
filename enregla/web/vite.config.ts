/// <reference types="vitest/config" />
import { fileURLToPath, URL } from 'node:url';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
import { checkLegalEnv } from './scripts/legal-env.mjs';

/** Rutas públicas indexables (portada y páginas legales). El resto de la app no se indexa. */
const INDEXABLE = ['/', '/aviso-legal', '/privacidad', '/terminos', '/cookies'];
const NOINDEX = [
  '/app',
  '/locales/',
  '/nuevo-local',
  '/cocina',
  '/carta/',
  '/api/',
  '/entrar',
  '/registro',
  '/revisa-tu-correo',
  '/verificar-email',
  '/recuperar-contrasena',
  '/restablecer-contrasena',
  '/confirmar-email',
  '/invitacion',
];

const escapeAttr = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  const appName = env.VITE_APP_NAME || 'EnRegla';
  const publicUrl = (env.VITE_PUBLIC_URL || '').trim().replace(/\/+$/, '');
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
        // Un build de producción sin los datos legales del titular FALLA con la lista de lo que falta.
        name: 'enregla-legal-check',
        apply: 'build',
        configResolved(c) {
          if (c.mode !== 'production') return;
          const error = checkLegalEnv(env);
          if (error) throw new Error(`\n\n${error}\n`);
        },
      },
      {
        name: 'enregla-html-app-name',
        transformIndexHtml: (html) => {
          const abs = (p: string) => (publicUrl ? `${publicUrl}${p}` : p);
          const seo = [
            publicUrl ? `<link rel="canonical" href="${escapeAttr(abs('/'))}" />` : '',
            `<meta property="og:url" content="${escapeAttr(abs('/'))}" />`,
            `<meta property="og:image" content="${escapeAttr(abs('/og-image.png'))}" />`,
            `<meta name="twitter:image" content="${escapeAttr(abs('/og-image.png'))}" />`,
          ]
            .filter(Boolean)
            .join('\n    ');
          return html.replaceAll('%APP_NAME%', escapeAttr(appName)).replace('<!--SEO-->', seo);
        },
      },
      {
        // robots.txt y sitemap.xml: indexables la portada y las páginas legales; nunca la app,
        // el modo cocina ni las cartas públicas (además el servidor envía X-Robots-Tag: noindex).
        name: 'enregla-seo-files',
        apply: 'build',
        generateBundle() {
          const robots = [
            'User-agent: *',
            ...NOINDEX.map((p) => `Disallow: ${p}`),
            'Allow: /',
            ...(publicUrl ? ['', `Sitemap: ${publicUrl}/sitemap.xml`] : []),
            '',
          ].join('\n');
          this.emitFile({ type: 'asset', fileName: 'robots.txt', source: robots });
          if (publicUrl) {
            const today = new Date().toISOString().slice(0, 10);
            const urls = INDEXABLE.map((p) => `  <url><loc>${publicUrl}${p}</loc><lastmod>${today}</lastmod></url>`).join('\n');
            this.emitFile({
              type: 'asset',
              fileName: 'sitemap.xml',
              source: `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`,
            });
          } else {
            this.warn('VITE_PUBLIC_URL no está definida: no se genera sitemap.xml ni enlace canonical.');
          }
        },
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
          globIgnores: ['og-image.png'],
          navigateFallback: '/index.html',
          // Nunca se sirve la SPA (ni nada de caché) para la API, descargas ni salud.
          navigateFallbackDenylist: [/^\/api(\/|$)/, /^\/healthz$/, /^\/readyz$/, /^\/robots\.txt$/, /^\/sitemap\.xml$/],
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
