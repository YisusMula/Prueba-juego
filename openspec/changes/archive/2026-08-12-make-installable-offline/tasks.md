## 1. Instalable (`app-delivery`)

- [x] 1.1 `public/manifest.webmanifest` con nombre, descripción, colores, `display: standalone` e iconos
- [x] 1.2 Iconos SVG y PNG (192 y 512) generados del mismo dibujo que el favicon, con variante maskable
- [x] 1.3 Enlazar el manifiesto y el icono de Apple desde `index.html`

## 2. Sin conexión (`app-delivery`)

- [x] 2.1 `public/sw.js`: caché primero para recursos con hash, red primero para el documento
- [x] 2.2 Ignorar lo que no sea GET del mismo origen
- [x] 2.3 Borrar las cachés de versiones anteriores al activarse
- [x] 2.4 Registro tras `load`, envuelto en try/catch
- [x] 2.5 La página declara al service worker lo que cargó, porque él no controló la primera carga

## 3. Verificación

- [x] 3.1 `npm run typecheck`, `npm test` y `npm run build` en verde
- [x] 3.2 Test del manifiesto: campos obligatorios, icono grande y maskable
- [x] 3.3 Verificación en navegador: el service worker se activa, y con la red cortada el juego carga y se juega
- [x] 3.4 Actualizar `README.md`
