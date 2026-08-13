## 1. Serialización (`run-progression`)

- [x] 1.1 `src/storage/savegame.ts`: `saveRun`, `loadRun`, `clearRun`, con versión de formato
- [x] 1.2 Descartar efectos y cola de sonidos al guardar; restaurarlos vacíos
- [x] 1.3 Validar al leer: versión, escenario y dificultad existentes, contenido interpretable, partida no terminada
- [x] 1.4 Tests: ida y vuelta conserva la partida, sigue igual al avanzar, guardar no la altera, efectos y sonidos no se restauran

## 2. Validez (`run-progression`)

- [x] 2.1 Tests: versión distinta se descarta, escenario inexistente se descarta, contenido ilegible se descarta, partida terminada no se reanuda, sin almacenamiento no revienta

## 3. Continuar (`game-shell`)

- [x] 3.1 Guardado automático por temporizador y en `visibilitychange`
- [x] 3.2 Descartar al terminar, al salir al menú y al empezar otra partida
- [x] 3.3 Botón de continuar en el menú, con escenario y oleada, oculto si no hay guardado
- [x] 3.4 Continuar restaura en pausa, sin pasar por la selección ni activar la guía

## 4. Verificación

- [x] 4.1 `npm run typecheck`, `npm test` y `npm run build` en verde
- [x] 4.2 Verificación en navegador: se guarda al ocultar la pestaña, recargar ofrece continuar, continuar restaura la oleada y las torres, y perder lo descarta
- [x] 4.3 Actualizar `README.md`
