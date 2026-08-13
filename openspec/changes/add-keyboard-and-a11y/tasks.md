## 1. Cursor de teclado (`hud-controls`)

- [x] 1.1 Cursor de celda en el estado de presentación, no en la simulación
- [x] 1.2 Flechas lo mueven y lo hacen visible; acotado a los límites del mapa
- [x] 1.3 Enter y Espacio llaman a la misma función que un toque, con el centro de la celda
- [x] 1.4 Dibujarlo resaltando la celda

## 2. La vista lo sigue (`viewport-navigation`)

- [x] 2.1 `ensureVisible(camera, viewport, punto)`: desplaza lo justo, no centra
- [x] 2.2 Tests: fuera de la vista la arrastra, dentro no la mueve, nunca se sale del mapa

## 3. Anuncios (`hud-controls`)

- [x] 3.1 Región `aria-live="polite"` visualmente oculta pero legible por el lector
- [x] 3.2 Anunciar comienzo de oleada, pérdida de vida y final de partida
- [x] 3.3 Solo al cambiar el hecho, nunca en cada fotograma

## 4. Verificación

- [x] 4.1 `npm run typecheck`, `npm test` y `npm run build` en verde
- [x] 4.2 Verificación en navegador solo con teclado: mover, colocar, seleccionar y que la vista siga
- [x] 4.3 Actualizar `README.md` con los controles de teclado
