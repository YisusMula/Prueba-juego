## Why

El juego ya es sólido mecánicamente, pero comparado con los referentes comerciales del género (Kingdom Rush, Bloons TD, Plants vs. Zombies) le faltan las piezas que separan un prototipo funcional de un producto que la gente quiere seguir jugando. La investigación del género apunta a cuatro carencias concretas:

1. **No hay control del tiempo.** El jugador espera 7 segundos entre oleadas sin poder hacer nada, y no puede acelerar cuando ya tiene su defensa montada. Es la queja número uno en los foros de cualquier TD que no lo incluye, y el propio diseñador de *Defender's Quest* señala que el control total del tiempo elimina la espera forzada sin quitar dificultad, porque el coste de los recursos ya limita el ritmo de acciones por sí solo.
2. **La partida no se puede ganar.** Solo se puede perder. Sin una condición de victoria no hay logro, no hay cierre y no hay razón para volver a jugar de otra forma.
3. **Faltan decisiones informadas.** El jugador no sabe qué trae la oleada siguiente, no puede decidir a quién dispara cada torre y no puede vender una torre mal colocada. Son tres decisiones estándar del género que ahora mismo no existen.
4. **No hay retorno sensorial ni memoria.** Sin sonido, sin números de daño y sin récords guardados, ni los aciertos ni el progreso se sienten.

Además, esa misma fuente advierte de que "los mapas con scroll son enemigos del foco": preocuparse por lo que pasa fuera de pantalla fragmenta la atención. En móvil, nuestro mapa no cabe entero, así que hace falta al menos avisar de las amenazas que quedan fuera de la vista.

## What Changes

- **Control del tiempo**: velocidad de juego a 1×, 2× y 3×, y botón para **llamar a la siguiente oleada antes de tiempo** que otorga oro extra proporcional al tiempo de preparación que el jugador renuncia a usar.
- **Condición de victoria**: la partida se gana al superar la oleada 30. Aparece una pantalla de victoria con el resumen, y desde ahí se puede **continuar en modo sin fin** para batir el récord propio.
- **Niveles de dificultad** (Fácil / Normal / Difícil) elegibles en el menú principal, que ajustan vidas iniciales, oro inicial y el escalado de las oleadas.
- **Récords persistentes** en el navegador: mejor oleada alcanzada y mejor puntuación por dificultad, visibles en el menú principal.
- **Vender torres**, con reembolso parcial del total invertido en ella (compra + mejoras).
- **Prioridad de objetivo por torre**: primero, último, más fuerte o más cercano, elegible desde el panel de la torre.
- **Previsualización de la próxima oleada**: qué tipos vienen, cuántos y si incluye enemigos aéreos o que dañan torres.
- **Indicador de amenazas fuera de pantalla**, para que el scroll del mapa no obligue a vigilar a ciegas.
- **Habilidades del comandante** con recarga: un meteoro que hace daño en área donde el jugador pulse, y una ventisca que congela a todos los enemigos del escenario.
- **Sonido** generado por síntesis con Web Audio (sin ficheros de audio): disparos por tipo de torre, impactos, muertes, fugas, construcción, mejora, habilidades, victoria y derrota, con botón de silencio persistente.
- **Retorno visual**: números de daño flotantes, destello del enemigo al recibir daño, sacudida de pantalla al perder una vida y barra de progreso de la oleada.

## Capabilities

### New Capabilities

- `run-progression`: dificultad, condición de victoria, modo sin fin y récords persistentes entre partidas.
- `hero-abilities`: habilidades activas del comandante con recarga y coste, y su modo de apuntado.
- `game-audio`: síntesis de efectos de sonido, silenciado y su persistencia.

### Modified Capabilities

- `game-shell`: pantalla de victoria, selección de dificultad al empezar y continuación en modo sin fin.
- `hud-controls`: controles de velocidad, botón de llamar oleada, venta de torre, selector de prioridad de objetivo, previsualización de oleada, barra de progreso y botón de silencio.
- `economy`: reembolso por venta, bonus de oro por llamar la oleada antes de tiempo y ajuste de recursos iniciales según dificultad.
- `tower-system`: prioridad de objetivo configurable, venta con reembolso e inversión acumulada por torre.
- `wave-system`: composición consultable de la próxima oleada y escalado dependiente de la dificultad.
- `viewport-navigation`: indicadores de enemigos fuera del área visible.

## Impact

- Código afectado: casi todos los módulos de `src/game/`, más `src/render/`, `src/ui/` e `index.html`/`style.css`. Se añaden `src/game/abilities.ts`, `src/game/progression.ts`, `src/game/difficulty.ts` y `src/audio/`.
- Dependencias: ninguna nueva. El sonido se sintetiza con la Web Audio API del navegador y los récords usan `localStorage`, ambos nativos.
- Compatibilidad: las partidas no se guardan a medias, así que no hay migración de datos. Los récords son nuevos y empiezan vacíos.
- La simulación sigue siendo pura y probable en Node: el audio y `localStorage` quedan detrás de adaptadores para no contaminar `src/game/`.
