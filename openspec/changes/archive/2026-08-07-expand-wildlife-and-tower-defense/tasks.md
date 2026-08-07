## 1. Catálogo de enemigos (`wave-system`)

- [x] 1.1 Sustituir el catálogo de `src/game/enemies.ts`: rat, fox, dog, boar, bat, eagle, vulture, goblin, orc, warlord (jefe orco), cada uno con dominio, vida, velocidad, recompensa y las capacidades `canDamageTowers` / `canSkipPath` que corresponda
- [x] 1.2 Actualizar `src/game/waves.ts`: introducción escalonada de cada tipo por oleada, multiplicador de velocidad creciente por oleada (además del ya existente de vida), boss (jefe orco) acumulativo cada 10 oleadas como hasta ahora
- [x] 1.3 Tests: progresión de resistencia terrestre y aérea, ninguna capacidad especial antes de su oleada de introducción, velocidad creciente por oleada, dificultad total (vida × cantidad) sigue siendo monótona creciente

## 2. Enemigos fuera de camino (`wave-system`)

- [x] 2.1 Punto de fuga determinista por id de enemigo y cambio a interpolación en línea recta hacia la meta al alcanzarlo
- [x] 2.2 Un enemigo fuera de camino sigue siendo objetivo válido para las torres (alcance, dominio, prioridad al más avanzado)
- [x] 2.3 Tests: un enemigo capaz abandona el trazado en su oleada correspondiente, nadie lo hace antes de esa oleada, un enemigo fuera de camino puede recibir disparos y llegar a la meta

## 3. Enemigos que dañan torres y estructura de torre (`tower-system`)

- [x] 3.1 Añadir `hp`/`maxHp` a la torre (por tipo y nivel) en `src/game/state.ts` y `src/game/towers.ts`
- [x] 3.2 Lógica de golpe pasivo en `src/game/step.ts`: enemigo con `canDamageTowers` se detiene junto a una torre en su alcance de golpe, le resta estructura durante su duración y reanuda la marcha
- [x] 3.3 Una torre con `hp <= 0` no adquiere objetivo ni dispara
- [x] 3.4 Tests: golpe reduce estructura, nadie golpea antes de su oleada, torre sin estructura no dispara, el enemigo reanuda el avance tras el golpe

## 4. Reparación de torres (`tower-system`, `economy`, `hud-controls`)

- [x] 4.1 Acción `repairSelectedTower` en `src/game/state.ts`: coste proporcional al daño, rechazo sin efecto si falta oro, restaura a `maxHp`
- [x] 4.2 Botón de reparar en el panel de torre (`src/ui/hud.ts` + `index.html`/`style.css`), visible solo si la torre está dañada, deshabilitado si falta oro
- [x] 4.3 Tests: reparar restaura estructura y cobra su coste, reparar sin oro no hace nada, una torre reparada vuelve a disparar

## 5. Torres nuevas: mágica y de hielo (`tower-system`)

- [x] 5.1 Añadir `magic` y `frost` a `src/game/towers.ts`: coste, daño, alcance, cadencia, domin, y para hielo el límite de objetivos congelados por nivel
- [x] 5.2 Efecto de congelación en `src/game/step.ts`: `frozenTargets` por torre, ralentización severa temporal al enemigo alcanzado, cupo por nivel, refresco sin gastar cupo
- [x] 5.3 Ampliar el nivel máximo de todo el catálogo de torres de 5 a 8, manteniendo el coste de mejora estrictamente creciente
- [x] 5.4 Tests: daño base de la torre de hielo es el menor del catálogo, torre de hielo de nivel bajo no congela a un segundo enemigo, torre de hielo de nivel alto congela a varios, coste de mejora sigue siendo creciente en los 8 niveles

## 6. Render

- [x] 6.1 Sprites procedurales para rat, fox, dog, boar, eagle, vulture, goblin, orc (silueta reconocible y distinta por tipo, siguiendo el estilo ya usado en `src/render/sprites.ts`)
- [x] 6.2 Sprites de la torre mágica y de la torre de hielo, con efecto visual de rayo y de escarcha/congelación en el enemigo afectado
- [x] 6.3 Indicador visual de estructura dañada en una torre y de enemigo congelado
- [x] 6.4 Indicador visual (aunque sea sutil) de que un enemigo está fuera de camino

## 7. Reequilibrado y verificación de balance (`economy`)

- [x] 7.1 Ajustar recompensas de oro y costes de mejora/reparación al nuevo bestiario y a los sumideros nuevos
- [x] 7.2 Adaptar `tests/balance.test.ts` al catálogo nuevo y comprobar que, con una estrategia razonable, el oro no crece sin límite en oleadas avanzadas
- [x] 7.3 Iterar sobre los números hasta que la simulación no muestre excedentes de oro desbocados ni una dificultad imposible

## 8. Verificación completa

- [x] 8.1 Revisar y actualizar toda la suite existente que referencia los ids de enemigo antiguos (`tests/waves.test.ts`, `tests/towers.test.ts`, `tests/economy.test.ts`, `tests/shell.test.ts`, `tests/balance.test.ts`, `tests/helpers.ts`)
- [x] 8.2 `npm run typecheck`, `npm test`, `npm run build` en verde
- [x] 8.3 Verificación en navegador: enemigo fuera de camino visible, torre dañada y reparación funcionando, torre mágica y de hielo disparando y congelando, en escritorio y móvil
