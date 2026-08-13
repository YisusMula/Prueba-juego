# Primeros pasos guiados

## Why

El juego tiene ya seis torres con dos ramas cada una, cuatro prioridades de
objetivo, dos habilidades, reparación, venta, llamada anticipada de oleada,
tres velocidades y un bestiario con cinco rasgos distintos. Todo eso se le
presenta a un jugador nuevo de golpe, y **nada de ello se explica**: la barra de
compra da un coste y tres palabras, y el resto hay que descubrirlo pulsando.

Es el hueco más grande que queda. Las últimas iteraciones han añadido
profundidad; esta hace que esa profundidad sea alcanzable. Un jugador que no
entiende los primeros sesenta segundos no llega a ver nada de lo demás, por
bueno que sea.

Lo que falta no es un manual —el README ya lo tiene— sino que el juego enseñe
**mientras se juega**, que es como lo hacen los tower defense de referencia:
el primer nivel es el tutorial, sin salirse del nivel.

## What Changes

### Una guía que observa, no que dirige

- Una secuencia corta de pasos: elegir una torre, colocarla junto al camino,
  seleccionarla, subirla de nivel y especializarla.
- Cada paso muestra una pista y **se marca solo cuando el jugador hace la
  cosa**. La guía no toca la simulación ni fuerza nada: lee el estado y decide
  qué pista enseñar.
- Un paso que ya esté cumplido cuando le llega el turno se salta al instante,
  así que un jugador que va por delante de la guía nunca la ve pedirle algo que
  ya ha hecho.

### Aparece cuando hace falta y no vuelve

- Se muestra automáticamente la primera vez que se juega, y no más.
- Se puede **saltar** en cualquier momento con un botón.
- Se puede **volver a ver** desde el menú principal, para quien vuelva después
  de meses o quiera repasar.

### Sin bloquear la partida

- La guía es una pista en pantalla, no un modal: el jugador puede ignorarla y
  seguir jugando. Un tutorial que exige pulsar donde le dicen convierte los
  primeros minutos en un trámite.

## Impact

- Afecta a `hud-controls` y `game-shell`.
- `src/game/tutorial.ts` define los pasos como predicados puros sobre el estado
  de la partida, así que se prueban en Node sin navegador y sin DOM.
- La preferencia de "ya la he visto" va a `localStorage`, junto al silencio.
- No cambia ninguna mecánica: es aditivo y la partida se comporta igual con la
  guía activa o sin ella.
