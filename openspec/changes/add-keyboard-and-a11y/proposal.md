# Jugar con teclado y anuncios accesibles

## Why

El juego no se puede jugar sin ratón ni pantalla táctil. Los botones del HUD sí
son alcanzables con el tabulador —son botones de verdad—, pero **colocar una
torre exige apuntar a un píxel del lienzo**, y no hay ninguna forma de hacerlo
con el teclado. Eso deja fuera a quien no puede usar un ratón, y también a quien
simplemente prefiere el teclado.

Es además el único punto del juego donde falta: comprar, mejorar, vender,
especializar, cambiar prioridad, llamar a la oleada, lanzar habilidades y
cambiar de velocidad ya funcionan con teclado o con el tabulador. Falta el
gesto central.

Y hay un segundo hueco: quien usa un lector de pantalla no se entera de nada de
lo que pasa. Las vidas, el oro y la oleada están en el HUD, pero **cambian sin
avisar**: no hay ninguna región que anuncie que empieza una oleada, que una
criatura ha llegado al castillo o que la partida ha terminado.

## What Changes

### Un cursor de celda manejable con el teclado

- Las flechas mueven un **cursor sobre la rejilla**, que aparece en cuanto se
  usa y se dibuja resaltando la celda.
- `Enter` o `Espacio` actúan sobre la celda del cursor exactamente igual que un
  toque: colocan la torre elegida, seleccionan una ya puesta o lanzan la
  habilidad que esté apuntando.
- La **cámara sigue al cursor** cuando se sale de la vista: moverlo fuera de
  pantalla y no ver nada sería peor que no tenerlo.
- El cursor no sale de los límites del mapa.

### Anuncios para lectores de pantalla

- Una región de anuncios comunica los hechos que el jugador vidente ve de un
  vistazo: empieza una oleada, se pierde una vida, se queda sin ellas, gana.
- Los anuncios son **cortos y espaciados**: una región que hable en cada
  fotograma es peor que una que calle.

### Lo que ya funciona se documenta

- El resto de acciones ya son alcanzables por tabulador o tienen atajo. Se
  añaden los que faltan al README, para que se sepa que están.

## Impact

- Afecta a `hud-controls` y `viewport-navigation`.
- El cursor vive en el estado de presentación, no en la simulación: es una
  intención del jugador, como el puntero del ratón, no parte de la partida.
- Aditivo: quien juegue con ratón no nota ningún cambio.
