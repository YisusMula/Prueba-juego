# Reanudar la partida en curso

## Why

Una partida completa son treinta oleadas: entre quince y veinticinco minutos.
Ahora mismo, **cualquier cosa que cierre la pestaña se lo lleva todo**. En un
móvil eso no es un caso raro: basta con atender una llamada, cambiar de app un
momento o que el sistema recicle la pestaña en segundo plano. El jugador vuelve
y está en el menú principal, con la oleada 22 perdida.

Es la peor forma de perder que tiene el juego, porque no es una derrota: no
enseña nada, no se puede evitar jugando mejor y desmotiva más que cualquier
oleada difícil. Y afecta justo a las partidas más valiosas, las largas.

La simulación ya está en la forma que hace esto barato: `GameState` es un objeto
de datos planos, sin funciones, sin clases y sin referencias circulares, porque
todo el juego se diseñó para poder probarse en Node. Guardarlo es serializarlo.

## What Changes

### Guardado automático

- La partida en curso se guarda sola cada pocos segundos y, sobre todo, **al
  perder el foco la pestaña**: es el momento exacto en que el móvil está a punto
  de llevársela.
- Se guarda el estado de la simulación, no la presentación: los efectos
  visuales y la cola de sonidos se descartan, porque restaurarlos repetiría
  números de daño y pitidos de hace media hora.

### Reanudar desde el menú

- Si hay una partida guardada, el menú principal ofrece **Continuar**, diciendo
  en qué escenario y oleada se quedó.
- Empezar una partida nueva descarta la guardada, con la advertencia previa
  correspondiente en el propio botón.

### Cuándo se descarta

- Al terminar la partida, en victoria o en derrota: ya no hay nada que reanudar.
- Al salir al menú desde la pausa, que es una decisión explícita de abandonar.
- Al empezar otra partida.

### Formato con versión

- El guardado lleva versión. Un guardado de otra versión se descarta al leerlo,
  igual que se hace con los récords: reanudar una partida con campos que ya no
  significan lo mismo es peor que no reanudarla.

## Impact

- Afecta a `game-shell` y `run-progression`.
- `src/storage/savegame.ts` reúne serializar, validar y descartar.
- No cambia ninguna mecánica ni la forma de `GameState`: es aditivo, y una
  partida se comporta igual se guarde o no.
