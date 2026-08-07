## Why

Con la partida real ya jugada, el ritmo económico se rompe a partir de cierta oleada: el oro entra más rápido de lo que hay dónde gastarlo (torres al nivel máximo, mapa lleno) y la partida deja de suponer un reto. Además el bestiario es genérico (duendes/corredores/ogros/murciélagos/señor de la guerra) y no transmite una progresión reconocible. El juego necesita más profundidad táctica —enemigos que amenacen directamente a las torres, enemigos que obliguen a cubrir todo el prado y no solo el camino, más variedad de torres— y un sumidero de oro natural en el propio combate, no solo en subir de nivel.

## What Changes

- **BREAKING**: se sustituye por completo el catálogo de enemigos. Los identificadores `grunt`, `runner`, `brute` y `warlord` desaparecen; el bestiario pasa a una progresión temática: rata → zorro → perro → jabalí (tierra) y murciélago → águila → buitre (aire), con goblin, orco y un jefe orco como gama alta. `bat` se conserva como identificador pero se retunean sus estadísticas.
- Las oleadas introducen los nuevos tipos de forma escalonada y, a partir de cierto número de oleada, aplican un multiplicador de velocidad creciente además del ya existente de vida, de modo que los enemigos no solo son más numerosos y resistentes, también más rápidos.
- Algunos enemigos (jabalí, buitre, orco, jefe orco) pueden golpear una torre cercana al pasar junto a ella: se detienen un instante, le restan puntos de estructura y siguen su camino. Las torres ganan una barra de estructura independiente de su nivel.
- Nuevo botón **Reparar** en el panel de torre seleccionada: gastando oro, restaura la estructura de la torre a su máximo. Una torre sin estructura deja de disparar hasta que se repara.
- Algunos enemigos (goblin, jefe orco) pueden abandonar el camino a partir de cierta oleada y cruzar el prado en línea recta hacia la meta, en lugar de seguir el trazado.
- Dos torres nuevas: **Torre Mágica** (rayos, gran daño, alcanza tierra y aire) y **Torre de Hielo** (daño mínimo, pero ralentiza casi a la inmovilidad al enemigo alcanzado; solo puede mantener congelado a un enemigo a la vez salvo en sus niveles más altos, donde puede congelar a varios).
- El nivel máximo de todas las torres sube de 5 a 8, para que la inversión en mejoras siga siendo un sumidero de oro válido en partidas largas.
- Reequilibrado de recompensas de oro y costes de mejora acorde al nuevo bestiario y a los dos sumideros nuevos (reparación, niveles adicionales), verificado con la misma simulación de balance ya existente en `tests/balance.test.ts`.

## Capabilities

### Modified Capabilities

- `wave-system`: nuevo catálogo de enemigos, multiplicador de velocidad por oleada, capacidad de abandonar el camino a partir de cierta oleada.
- `tower-system`: estructura (puntos de vida) de las torres, daño de enemigos sobre torres, reparación, dos torres nuevas (mágica y de hielo) con el efecto de congelación, nivel máximo ampliado a 8.
- `economy`: coste de reparación como gasto válido, reequilibrado de recompensas y costes para que el oro sobrante no crezca sin límite en oleadas avanzadas.
- `hud-controls`: botón de reparar en el panel de torre seleccionada, indicador de estructura de la torre.

### New Capabilities

Ninguna: todo lo anterior extiende capacidades ya existentes; no se introduce ninguna pantalla, sistema de cámara ni mecánica de mapa nueva.

## Impact

- Código afectado: `src/game/enemies.ts` (catálogo nuevo), `src/game/waves.ts` (introducción escalonada, multiplicador de velocidad), `src/game/towers.ts` (torres nuevas, fórmulas de nivel hasta 8, estructura), `src/game/state.ts` (estructura de torre, reparación, congelación), `src/game/step.ts` (daño a torres, movimiento fuera de camino, aplicación de congelación), `src/render/sprites.ts` (dibujo de los nuevos enemigos y torres), `src/ui/hud.ts` (botón reparar, indicador de estructura).
- Tests afectados: prácticamente toda la suite de `tests/` referencia los identificadores de enemigo actuales (`grunt`, `runner`, `brute`, `warlord`) y debe actualizarse al nuevo catálogo; se añaden tests para daño a torres, reparación, movimiento fuera de camino y congelación.
- No hay cambios de infraestructura, despliegue ni dependencias.
