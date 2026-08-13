# Dos escenarios más

## Why

La campaña son tres mapas. Con la profundidad que tiene ya el juego —seis
torres con dos ramas cada una, cuatro prioridades, dos habilidades y un
bestiario con cinco rasgos— tres escenarios se quedan cortos: el jugador agota
el catálogo antes que las combinaciones.

Y añadir mapas es ahora **barato**. Un escenario es una lista de esquinas por
ruta; todo lo demás —terreno, reparto de enemigos, miniatura, récords,
estrellas, desbloqueo— sale de ahí sin tocar una línea. Es el momento de cobrar
ese diseño.

Los dos que faltan cubren huecos concretos del catálogo actual, no son "más de
lo mismo":

- Los tres mapas existentes tienen recorridos de longitud parecida. Falta uno
  **largo**, donde compense concentrar la inversión en pocos puestos muy
  subidos en vez de repartirla.
- El modelo de rutas admite cualquier número de ramas, pero el catálogo se
  queda en dos. Falta uno de **tres**, que es donde la decisión de repartir se
  vuelve de verdad incómoda.

## What Changes

- **Sendero del Faro**: un solo carril, mucho más largo y sinuoso que el resto.
  Cada enemigo pasa mucho tiempo bajo fuego, así que premia pocos puestos muy
  mejorados.
- **Tres Senderos**: el camino se parte en **tres** ramas de igual longitud y
  se vuelve a juntar. Con el mismo oro hay que cubrir tres carriles, y dejar uno
  desatendido cuesta un tercio de cada oleada.
- Los dos entran en la campaña detrás de los actuales, con su desbloqueo y sus
  estrellas.

## Impact

- Afecta a `battlefield-map`.
- Solo añade entradas al catálogo de `src/game/scenarios.ts`. El máximo de
  estrellas pasa de 9 a 15 por sí solo, porque se calcula del catálogo.
- El reparto de enemigos ya funciona con cualquier número de rutas; el mapa de
  tres ramas es la primera vez que se ejercita con más de dos.
