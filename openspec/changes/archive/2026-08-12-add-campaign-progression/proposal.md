# Campaña: desbloqueo progresivo y estrellas

## Why

Los tres escenarios están sueltos. El jugador entra, ve tres tarjetas
equivalentes y elige una al azar; nada le dice por dónde empezar, nada cambia
cuando gana, y nada le da un motivo para volver al día siguiente.

Es un problema de retención, no de mecánicas: el juego ya tiene profundidad de
sobra para varias partidas, pero no tiene **memoria de lo que has conseguido**.
Ganar en Fácil y ganar en Difícil dejan exactamente el mismo rastro — una marca
de "oleada 30" que ni siquiera distingue haber ganado de haber muerto en la
última oleada.

Los tower defense de referencia resuelven esto con una campaña: los niveles se
abren en orden, y cada uno se puntúa según lo bien que lo has hecho. Eso da tres
cosas de golpe: una ruta clara para el que empieza, una razón para repetir un
nivel ya superado, y un número que resume tu progreso.

## What Changes

### Estrellas por escenario

- Cada escenario otorga **estrellas según la dificultad más alta en la que se
  haya ganado**: 1 en Fácil, 2 en Normal, 3 en Difícil.
- Solo cuenta **ganar**. Hoy el récord guarda la mejor oleada, que no distingue
  haber superado la oleada 30 de haber muerto en ella: hay que registrar la
  victoria de forma explícita.
- Las estrellas son la mejor marca de siempre: volver a jugar y perder no las
  quita.

### Desbloqueo progresivo

- El primer escenario está siempre disponible. Cada uno de los demás se
  desbloquea al conseguir **al menos una estrella** en el anterior.
- Un escenario bloqueado aparece en la lista, con candado y con lo que hace
  falta para abrirlo. Ocultarlo escondería el propio hecho de que hay más juego.

### Lo que ve el jugador

- La pantalla de selección muestra las estrellas de cada escenario, el candado
  de los bloqueados y el total de estrellas conseguidas.
- El menú principal muestra el total de estrellas sobre el máximo.
- La pantalla de victoria dice cuántas estrellas ha dado la partida, si ha
  desbloqueado un escenario nuevo y qué dificultad haría falta para conseguir
  más.

## Impact

- Afecta a `run-progression` y `game-shell`.
- El registro de partida gana un `won`; la clave de `localStorage` sube de
  versión y el formato anterior se descarta, como ya se hizo al pasar a récords
  por escenario.
- `src/game/campaign.ts` reúne las consultas de estrellas y desbloqueo como
  funciones puras sobre los récords, sin estado propio: así el desbloqueo no
  puede desincronizarse de lo que el jugador ha conseguido de verdad.
