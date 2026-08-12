# Diseño

## La guía observa el estado; no lo dirige

La decisión central. Un tutorial puede implementarse de dos formas.

**Guionizado**: la guía toma el control —pausa la partida, deshabilita lo que no
toca, obliga a pulsar en un sitio concreto y avanza cuando lo pulsas. Es lo que
hacen muchos juegos, y tiene dos costes serios aquí. Uno de diseño: convierte
los primeros minutos en un trámite, y quien ya sabe jugar no puede saltárselo
sin saltarse también la partida. Otro técnico: mete condicionales de tutorial
por toda la simulación y la interfaz, justo en el código que más cuesta mantener
correcto.

**Observado**, elegido: cada paso es un **predicado puro sobre `GameState`**. La
guía no llama a ninguna acción, no pausa nada y no deshabilita nada; solo mira
el estado y decide qué pista enseñar. La simulación no se entera de que existe.

Esto tiene tres consecuencias que valen mucho:

- El jugador puede ignorar la guía por completo y jugar. La pista es
  información, no un peaje.
- Un paso que ya está cumplido cuando le llega el turno se marca al instante,
  así que quien construye una torre antes de leer nada no ve luego "coloca una
  torre".
- Los pasos se prueban en Node sobre un `GameState` montado a mano, sin
  navegador ni DOM.

El coste es que la guía no puede garantizar que el jugador haga las cosas *en
orden*, ni enseñar algo que el estado no delate. Para lo que se quiere enseñar
—comprar, colocar, seleccionar, mejorar, especializar— el estado lo delata todo.

## Un solo paso a la vez, el primero sin cumplir

La pista visible es siempre **el primer paso cuya condición aún no se cumple**.
No hay índice guardado ni avance que mantener sincronizado: el paso actual es
una consulta sobre el estado, igual que el desbloqueo de escenarios es una
consulta sobre los récords.

Esto también hace que la guía sea robusta ante lo inesperado. Si el jugador
vende la torre que acababa de colocar, la guía vuelve sola a pedirle que coloque
una: no se queda pidiendo que mejore una torre que ya no existe.

## Qué se enseña y qué no

Cinco pasos: elegir torre, colocarla, seleccionarla, mejorarla y
especializarla. Es la cadena mínima que lleva de "no sé qué hacer" a "sé cómo
crece un puesto", y termina justo en la decisión más interesante del juego.

Se dejan fuera a propósito las habilidades, las prioridades, la reparación, la
venta y la llamada anticipada. Todas ellas son **respuestas a una situación**
que el jugador aún no ha vivido en la oleada 1: explicar la reparación antes de
que nada le haya roto una torre es ruido. El aviso de oleada ya avisa de los
rasgos cuando aparecen, que es el momento en que significan algo.

## Cuándo aparece

Se muestra sola la primera vez, y luego no. Guardar "ya la he visto" en
`localStorage` junto a la preferencia de silencio, con el mismo envoltorio
tolerante a fallos: si el almacenamiento no está disponible, la guía sale cada
vez, que es peor que no salir nunca pero mejor que romperse.

Se puede saltar en cualquier momento, y volver a activar desde el menú. Saltar
cuenta como haberla visto: quien la salta ha decidido que no la necesita.

## Por qué no es un modal

La pista vive en una tarjeta pequeña, fuera del área de juego, con la misma
regla que el resto de la interfaz: no puede tapar celdas jugables. Un modal
obligaría a cerrarlo antes de cada acción y convertiría cinco pasos en cinco
interrupciones.
