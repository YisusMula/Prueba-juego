# Escenarios con bifurcaciones y bestiario con contrajuego

## Why

El juego tiene **un solo mapa**. Una vez que el jugador aprende dónde están los
buenos emplazamientos, todas las partidas son la misma partida: cambia la
dificultad, no el problema. Y ese único mapa es un camino lineal, así que la
decisión de dónde construir se reduce a "cuanto más cerca del camino, mejor".

Los tower defense de referencia resuelven esto por dos vías a la vez:

- **El mapa hace la pregunta.** En *Kingdom Rush* cada nivel plantea un problema
  distinto — dónde está el cuello de botella, qué carril se queda sin cobertura —
  y la disposición correcta de torres es la respuesta. Con carriles que se
  bifurcan, el jugador ya no puede concentrar todo en un punto: tiene que
  decidir si divide su defensa o si acepta perder un carril.
- **Los enemigos exigen contrajuego.** El bestiario actual solo escala en vida y
  velocidad, así que la respuesta óptima siempre es "más daño". Los arquetipos
  clásicos (acorazado, sanador, divisor, enjambre) obligan a cambiar de
  herramienta, no solo a subir números: un acorazado castiga a las torres de
  muchos impactos pequeños, un sanador hay que matarlo *primero*, un divisor
  castiga al daño en área mal colocado.

## What Changes

### Escenarios múltiples con rutas

- El mapa deja de ser un módulo con un único camino y pasa a ser un **catálogo
  de escenarios**. Un escenario define su rejilla y un conjunto de **rutas**;
  cada ruta es un recorrido completo de entrada a meta.
- Este modelo cubre de una vez los tres casos que interesan, sin lógica
  especial para ninguno: **un camino** (una ruta), **una bifurcación que se
  vuelve a juntar** (dos rutas que comparten cabeza y cola) y **dos entradas
  distintas** (dos rutas con origen diferente).
- Cada enemigo se asigna a una ruta al aparecer, de forma determinista, y avanza
  por ella. La simulación sigue siendo reproducible.
- Tres escenarios de salida:
  - **Prado del Molino**: el camino actual. Un carril, muchas curvas. El nivel
    de aprendizaje.
  - **Cruce de los Cuervos**: el camino se parte en dos y se vuelve a unir antes
    de la meta. Hay un cuello de botella común, pero cubrirlo solo no basta.
  - **Los Dos Portones**: dos entradas opuestas hacia una misma meta. Obliga a
    montar dos defensas y a repartir el oro.

### Pantalla de selección de escenario

- Nueva pantalla entre el menú y la partida: elegir escenario, con su nombre,
  su descripción y **su propio récord**. Los récords pasan a guardarse por
  escenario *y* dificultad.

### Bestiario con contrajuego

- **Armadura**: resta una cantidad fija a cada impacto recibido. Castiga a las
  torres de cadencia alta y daño bajo, y premia a las de golpe fuerte.
- **Aura de sanación**: cura a los enemigos cercanos mientras vive. Hay que
  matarla antes que al resto.
- **División**: al morir deja dos crías más pequeñas y rápidas.
- Cinco criaturas nuevas que usan estos rasgos: **Araña** (enjambre rápido),
  **Escarabajo** (acorazado barato), **Limo** (divisor), **Chamán** (sanador) y
  **Golem** (acorazado pesado de gama alta).
- El panel de torre y el aviso de oleada informan de estos rasgos: sin verlos,
  el jugador no puede reaccionar a ellos.

## Impact

- Afecta a las capacidades `battlefield-map`, `wave-system`, `tower-system`,
  `game-shell`, `run-progression` y `hud-controls`.
- `src/game/map.ts` deja de exportar constantes de un único mapa y pasa a
  exportar un catálogo; toda la simulación consulta el escenario de la partida.
  Es un cambio de forma amplio pero mecánico.
- Los récords guardados con el formato anterior se descartan al no encontrar el
  escenario: se acepta perderlos antes que inventar a qué mapa pertenecían.
