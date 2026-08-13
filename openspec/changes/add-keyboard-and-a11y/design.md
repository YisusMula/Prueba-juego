# Diseño

## El cursor es presentación, no simulación

El cursor de teclado podría vivir en `GameState`, junto a la torre seleccionada.
No se hace: es una intención del jugador a medio formar, igual que la posición
del puntero del ratón, que tampoco está ahí.

Meterlo en el estado tendría dos costes concretos. Se guardaría con la partida,
y al reanudar aparecería un cursor donde el jugador lo dejó hace una hora. Y
haría que dos partidas idénticas divergieran por un movimiento de cursor, que es
justo lo que los tests de determinismo comprueban que no pasa.

Vive por tanto en el mismo sitio que la velocidad, el silencio y el puntero: el
estado de presentación de `main.ts`.

## Enter hace lo mismo que un toque

`Enter` sobre el cursor llama a la **misma** función que un toque en el lienzo,
con el centro de la celda como coordenada. No hay una segunda ruta de
"colocación por teclado" que mantener en paralelo.

De ahí sale gratis todo el comportamiento: colocar si hay torre elegida,
seleccionar la que ya está puesta, lanzar la habilidad si se está apuntando, y
rechazar el camino. Si mañana cambia lo que hace un toque, el teclado cambia con
él.

## La cámara sigue al cursor

Mover el cursor fuera de la vista y no ver nada sería peor que no tener cursor.
Cuando la celda seleccionada queda fuera del área visible, la cámara se desplaza
lo justo para que entre, en vez de centrarse en ella: centrar en cada
pulsación haría saltar el escenario entero a cada flecha y marearía.

## Los anuncios se limitan a los hechos

La región de anuncios dice lo que un jugador vidente capta de un vistazo:
empieza la oleada N, has perdido una vida, has ganado, has perdido. No narra el
combate.

Un lector de pantalla lee lo que aparece en la región, y el juego cambia sesenta
veces por segundo: sin límite, hablaría sin parar y taparía cualquier cosa útil.
Por eso los anuncios son eventos discretos —transiciones que ocurren de vez en
cuando— y no un volcado del estado.

`aria-live="polite"` y no `assertive`: interrumpir lo que el jugador esté
oyendo para decirle que ha empezado la oleada 7 no le ayuda.

## Nada de esto cambia el juego con ratón

Todo es aditivo. El cursor solo se dibuja después de la primera flecha, así que
quien juegue con ratón no ve nada nuevo, y la región de anuncios es invisible
salvo para las tecnologías de asistencia.
