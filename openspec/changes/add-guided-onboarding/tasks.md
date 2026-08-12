## 1. Pasos de la guía (`hud-controls`)

- [x] 1.1 `src/game/tutorial.ts`: secuencia de pasos, cada uno con texto y un predicado puro sobre `GameState`
- [x] 1.2 `currentTutorialStep(state)`: el primer paso sin cumplir, o null si están todos
- [x] 1.3 Cuatro pasos: elegir torre, colocarla, mejorarla, especializarla (colocar ya abre el panel, así que no hay paso de seleccionar)
- [x] 1.4 Tests: empieza por el primero, avanza al hacerlo, salta los ya cumplidos, retrocede al deshacer, termina al completarlos, la guía no altera la simulación

## 2. Activación y persistencia (`game-shell`)

- [x] 2.1 `loadTutorialSeen` / `saveTutorialSeen` en `src/storage/records.ts`, con el mismo envoltorio tolerante a fallos
- [x] 2.2 La guía se activa sola en la primera partida; saltarla la marca como vista
- [x] 2.3 Botón en el menú principal para volver a activarla
- [x] 2.4 Tests: primera partida sí, siguientes no, saltar cuenta como vista, reactivar funciona

## 3. Interfaz (`hud-controls`)

- [x] 3.1 Tarjeta de pista con el texto del paso y el número de paso sobre el total
- [x] 3.2 Botón de saltar en la tarjeta
- [x] 3.3 Colocada fuera del área jugable, sin tapar celdas ni solaparse con el aviso de oleada
- [x] 3.4 Estilos legibles en móvil y en apaisado

## 4. Verificación

- [x] 4.1 `npm run typecheck`, `npm test` y `npm run build` en verde
- [x] 4.2 Verificación en navegador (escritorio y móvil): la guía sale, avanza al construir, se salta, y no vuelve
- [x] 4.3 Actualizar `README.md`
