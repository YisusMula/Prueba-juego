/*
 * Service worker: hace el juego jugable sin conexión.
 *
 * Hay dos clases de recurso con propiedades distintas, y por eso hay dos
 * estrategias:
 *
 * - Los recursos con hash en el nombre (`index-Bm1DhOPk.js`) son inmutables por
 *   construcción: si el contenido cambia, el nombre cambia. Uno cacheado no
 *   puede estar desfasado, así que se sirven **de la caché primero**.
 * - El documento tiene siempre el mismo nombre y es quien apunta a los recursos
 *   con hash. Se pide **a la red primero**, con la copia como respaldo. Al
 *   revés, quien ya hubiera abierto el juego una vez no recibiría nunca una
 *   versión nueva.
 *
 * No hay lista de recursos a precachear ni paso de construcción que la genere:
 * lo que el jugador usa se guarda al usarlo, y a partir de la segunda visita
 * está todo.
 */

const CACHE = 'tower-game-v1';

/** Un recurso con hash en el nombre es inmutable: nunca hace falta revalidarlo. */
function isHashed(url) {
  return /-[A-Za-z0-9_-]{8,}\.(?:js|css|png|svg|woff2?)$/.test(url.pathname);
}

function isDocument(request, url) {
  return request.mode === 'navigate' || url.pathname.endsWith('/') || url.pathname.endsWith('.html');
}

self.addEventListener('install', (event) => {
  // Sin lista que precachear: activarse cuanto antes es lo único que interesa.
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // Las cachés de versiones anteriores se borran: sin esto, cada despliegue
      // dejaría una huérfana ocupando espacio para siempre en el dispositivo.
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((name) => name.startsWith('tower-game-') && name !== CACHE)
          .map((name) => caches.delete(name)),
      );
      await self.clients.claim();
    })(),
  );
});

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;

  const response = await fetch(request);
  if (response.ok) {
    const cache = await caches.open(CACHE);
    cache.put(request, response.clone());
  }
  return response;
}

async function networkFirst(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE);
      cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    const cached = await caches.match(request);
    if (cached) return cached;
    throw error;
  }
}

/**
 * La página avisa de lo que ha cargado para que se guarde.
 *
 * El service worker se registra después de `load`, así que **no controla la
 * primera carga**: sus recursos no pasan por él y no se guardan solos. Sin
 * esto, un jugador que abre el juego una vez y se queda sin red no puede
 * jugar, porque en la caché no hay ni el documento ni el código.
 *
 * Lo dice la página y no lo deduce el service worker leyendo el HTML porque la
 * página *sabe* lo que ha cargado: no hay que adivinarlo ni mantener una lista
 * en paralelo con lo que genera la construcción.
 */
self.addEventListener('message', (event) => {
  const data = event.data;
  if (!data || data.type !== 'cache-shell' || !Array.isArray(data.urls)) return;

  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      await Promise.all(
        data.urls.map(async (url) => {
          try {
            const response = await fetch(url, { cache: 'no-cache' });
            if (response.ok) await cache.put(url, response);
          } catch {
            // Un recurso que no se pueda guardar no debe tumbar a los demás.
          }
        }),
      );
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  // Solo el mismo origen. El juego no hace peticiones externas, así que hoy
  // esta regla no quita nada; existe para que si alguna vez se añade una, no
  // acabe cacheada por accidente sirviendo datos viejos.
  if (url.origin !== self.location.origin) return;

  if (isDocument(request, url)) {
    event.respondWith(networkFirst(request));
    return;
  }
  if (isHashed(url)) {
    event.respondWith(cacheFirst(request));
    return;
  }
  // El resto (manifiesto, iconos) cambia poco pero puede cambiar: se prefiere
  // la red y se cae a la caché si no hay.
  event.respondWith(networkFirst(request));
});
