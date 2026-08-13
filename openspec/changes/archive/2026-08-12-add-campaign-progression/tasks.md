## 1. Registro de la victoria (`run-progression`)

- [x] 1.1 `won` en el récord de cada escenario y dificultad; subir la versión de la clave de `localStorage`
- [x] 1.2 `recordRun` recibe si la partida se ganó; una derrota posterior no borra la victoria
- [x] 1.3 `main.ts` pasa el resultado real al registrar el fin de partida
- [x] 1.4 Tests: la victoria queda registrada, una derrota posterior no la borra, el formato antiguo se descarta

## 2. Estrellas y desbloqueo (`run-progression`)

- [x] 2.1 `src/game/campaign.ts`: `starsFor`, `isScenarioUnlocked`, `totalStars`, `maxStars`, derivadas de los récords sin estado propio
- [x] 2.2 Estrellas por dificultad más alta ganada (1/2/3); cero si nunca se ganó
- [x] 2.3 Desbloqueo secuencial: el primero siempre abierto, cada uno con una estrella en el anterior
- [x] 2.4 `startGame` rechaza un escenario bloqueado
- [x] 2.5 Tests: cada dificultad da sus estrellas, perder en la oleada final no da ninguna, una partida peor no las quita, el sin fin no añade, el desbloqueo no salta escenarios, un bloqueado no se puede empezar

## 3. Interfaz de la campaña (`game-shell`)

- [x] 3.1 Estrellas y candado en cada tarjeta de escenario; las bloqueadas deshabilitadas y con el requisito visible
- [x] 3.2 Total de estrellas en la pantalla de selección y en el menú principal
- [x] 3.3 Estrellas conseguidas y aviso de desbloqueo en la pantalla de victoria
- [x] 3.4 Estilos de estrella, candado y tarjeta bloqueada, legibles en móvil

## 4. Verificación

- [x] 4.1 `npm run typecheck`, `npm test` y `npm run build` en verde
- [x] 4.2 Verificación en navegador (escritorio y móvil): bloqueo inicial, tarjeta bloqueada no arranca partida, estrellas tras ganar
- [x] 4.3 Actualizar `README.md` con la campaña
