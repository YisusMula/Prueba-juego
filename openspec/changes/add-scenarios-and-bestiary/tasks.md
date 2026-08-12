## 1. Modelo de escenarios y rutas (`battlefield-map`)

- [x] 1.1 `src/game/scenarios.ts`: tipo `Scenario` (id, nombre, descripción, rejilla, rutas) y precálculo por escenario de celdas, terreno, polilíneas y longitudes acumuladas
- [x] 1.2 Reescribir `src/game/map.ts` como consultas sobre un escenario: `pathCells`, `terrainAt`, `isBuildableTerrain`, `positionAtDistance`, `routeLength`
- [x] 1.3 Tres escenarios: Prado del Molino (1 ruta), Cruce de los Cuervos (bifurcación que se reúne), Los Dos Portones (dos entradas)
- [x] 1.4 `scenarioId` en `GameState`; asignación determinista de ruta al aparecer (`id % rutas`) y avance del enemigo por su ruta
- [x] 1.5 Adaptar cámara, render de terreno y render de escena a las dimensiones y rutas del escenario activo
- [x] 1.6 Tests: todo escenario es jugable y continuo, el catálogo cubre las tres formas, el reparto es determinista, todas las rutas reciben enemigos, no se construye sobre ninguna rama ni sobre el tramo compartido

## 2. Pantalla de selección de escenario (`game-shell`)

- [x] 2.1 Estado `scenarios` en la máquina de pantallas, entre el menú y la partida
- [x] 2.2 `startGame` recibe el escenario; comenzar desde el menú lleva a la selección, no a la partida
- [x] 2.3 Pantalla con una tarjeta por escenario (nombre, descripción, récord) y botón de volver
- [x] 2.4 Miniatura del trazado de cada escenario dibujada a partir de sus rutas
- [x] 2.5 Tests: comenzar abre la selección, elegir empieza la partida en ese escenario, volver regresa al menú, no se simula nada en la selección

## 3. Récords por escenario (`run-progression`)

- [x] 3.1 Clave de récord por escenario y dificultad; subir la versión de la clave de `localStorage`
- [x] 3.2 Descartar los récords en formato anterior al leer
- [x] 3.3 Mejor récord de la dificultad entre escenarios en el menú principal; récord por escenario en la selección
- [x] 3.4 Tests: independencia por escenario, independencia por dificultad, el formato antiguo se descarta, sin almacenamiento no revienta

## 4. Rasgos del bestiario (`wave-system`, `tower-system`)

- [x] 4.1 `armor` en `EnemyType`: resta fija con mínimo de 1, aplicada al daño de torre y de área, ignorada por las habilidades
- [x] 4.2 `healAura` y `healPerSecond`: cura por área a los enemigos vivos cercanos, sin superar la vida máxima
- [x] 4.3 `splitsInto`: dos crías en el punto de muerte, con la ruta y la distancia del padre; las crías no se dividen; una fuga no genera crías
- [x] 4.4 Tests de armadura: reduce, nunca vuelve inmune, las habilidades la atraviesan, sin armadura el daño es íntegro, el área también se reduce, la cadencia alta rinde peor
- [x] 4.5 Tests de sanación: cura a los cercanos, no supera el máximo, fuera del radio no cura, matar al sanador la detiene
- [x] 4.6 Tests de división: deja dos crías en su sitio, las crías no se dividen, una fuga no deja crías

## 5. Criaturas nuevas (`wave-system`)

- [x] 5.1 Araña (enjambre rápido), Escarabajo (acorazado ligero), Limo y Limillo (divisor y cría), Chamán (sanador), Golem (acorazado pesado)
- [x] 5.2 Oleada de entrada de cada una y presencia acumulativa en las siguientes
- [x] 5.3 Banderas de armadura, sanación y división en `describeWave`
- [x] 5.4 Sprites de las criaturas nuevas
- [x] 5.5 Tests: cada criatura tiene su oleada de entrada y se mantiene, la dificultad sigue creciendo, las banderas se activan y se apagan bien

## 6. Interfaz (`hud-controls`)

- [x] 6.1 Avisos de armadura, sanación y división en la previsualización de oleada
- [x] 6.2 Barra de vida distinta para los acorazados y aura visible en los sanadores
- [x] 6.3 Tests: las banderas nuevas llegan a la previsualización

## 7. Balance y verificación

- [x] 7.1 Reajustar el balance con el simulador para los tres escenarios: la victoria en la oleada 30 debe seguir siendo alcanzable en Normal
- [x] 7.2 Caso de balance por escenario en `tests/balance.test.ts`
- [x] 7.3 `npm run typecheck`, `npm test` y `npm run build` en verde
- [x] 7.4 Verificación en navegador (escritorio y móvil): selección de escenario, bifurcaciones, criaturas nuevas
- [x] 7.5 Actualizar `README.md` con los escenarios y el bestiario
