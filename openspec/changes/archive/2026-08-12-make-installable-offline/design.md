# Diseño

## Dos estrategias de caché, porque hay dos clases de recurso

Un *service worker* que cachee todo igual acaba en uno de dos fallos conocidos:
o sirve para siempre una versión vieja del juego, o no sirve de nada sin red.
La salida no es elegir una estrategia, sino ver que hay **dos clases de recurso
con propiedades distintas**.

**Los recursos con hash en el nombre** (`index-Bm1DhOPk.js`) son inmutables por
construcción: si el contenido cambia, el nombre cambia. Uno cacheado no puede
estar desfasado, así que se sirven **de la caché primero** y solo se va a la red
si no están. Es lo más rápido y lo que hace posible jugar sin conexión.

**El documento** (`index.html`) tiene siempre el mismo nombre y es quien apunta
a los recursos con hash. Se pide **a la red primero**, con la copia guardada
como respaldo. Al revés, un jugador que ya hubiera abierto el juego una vez no
recibiría nunca una versión nueva.

Esa asimetría es toda la lógica del *service worker*. No hace falta una lista de
recursos a precachear ni un paso de construcción que la genere: lo que el
jugador use se guarda al usarlo, y a partir de la segunda visita ya está todo.

## La primera carga la declara la página

Un detalle que solo aparece al probarlo de verdad: el *service worker* se
registra después de `load`, así que **no controla la carga en la que se
instala**. Sus recursos no pasan por él y no se guardan. Un jugador que abre el
juego una vez y se queda sin red no podría jugar, porque en la caché no habría
ni el documento ni el código.

Lo resuelve la página diciéndole qué ha cargado, tomado de las entradas de
`performance`. Se hace así, y no leyendo el HTML desde el *service worker* ni
manteniendo una lista precacheada, porque **la página sabe lo que ha cargado**:
no hay que adivinarlo ni mantener nada en paralelo con lo que genera la
construcción, que además cambia de nombre en cada despliegue.

## Solo el mismo origen, solo GET

El *service worker* ignora cualquier petición que no sea `GET` y del mismo
origen. El juego no hace peticiones externas —lleva varias iteraciones
verificado— así que esta regla no quita nada hoy; existe para que si algún día
se añade una, no acabe cacheada por accidente y sirviendo datos viejos.

## Fallar en silencio

Todo el registro va envuelto: si el navegador no soporta *service workers*, si
el registro falla o si la página se sirve por HTTP sin ser `localhost`, el juego
sigue funcionando igual que hoy. Un juego que no arranca porque no pudo
instalarse el modo sin conexión sería mucho peor que uno que simplemente no
tiene modo sin conexión.

Por el mismo motivo el registro se hace **después** de cargar la página, no
durante: instalar el *service worker* compite por ancho de banda con los
recursos que hacen falta para jugar ya.

## Los iconos salen del dibujo que ya existe

El favicon es un SVG en línea con el castillo y el camino. Los iconos del
manifiesto se generan del mismo dibujo, para que el icono de la pantalla de
inicio y el de la pestaña sean el mismo y no haya dos verdades sobre la imagen
del juego.

Se incluye una variante **maskable** con el dibujo reducido dentro de la zona
segura. Android recorta el icono a la forma del lanzador —círculo, cuadrado
redondeado, gota— y sin esa variante el castillo aparecería mordido por los
bordes.

## La versión de la caché se borra al cambiar

La caché lleva un nombre con versión. Al activarse un *service worker* nuevo,
se borran todas las cachés del juego que no sean la suya. Sin eso, cada
despliegue dejaría una caché huérfana ocupando espacio para siempre en el
dispositivo del jugador.
