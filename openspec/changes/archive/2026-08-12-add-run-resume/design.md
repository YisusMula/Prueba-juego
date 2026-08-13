# Diseño

## Serializar el estado entero, no un resumen

La alternativa sería guardar un resumen —oleada, oro, vidas y la lista de
torres— y reconstruir el resto. Es más pequeño, pero pierde lo que hace que una
partida sea *esa* partida: los enemigos que van por el camino, cuánto han
avanzado, cuáles están congelados, qué torres están dañadas y en qué punto de su
recarga está cada habilidad. Reanudar así no es continuar: es empezar la oleada
otra vez con tus torres.

Se guarda el `GameState` completo. Esto es barato precisamente por cómo está
hecho el juego: `GameState` es un objeto de datos planos, sin funciones, sin
clases, sin `Map` ni `Set` y sin referencias circulares, porque toda la
simulación se diseñó para poder ejecutarse y probarse en Node. Serializarlo es
`JSON.stringify`.

## Menos la presentación

Dos campos se descartan al guardar: los **efectos** y la **cola de sonidos**.

No es una optimización, es corrección. Los efectos son números de daño,
explosiones y destellos con un tiempo de vida de décimas de segundo; la cola de
sonidos es lo que la capa de audio aún no ha reproducido. Restaurarlos haría que
al reanudar aparecieran números de daño de impactos de hace media hora y sonaran
disparos que ya ocurrieron. Ambos se restauran vacíos, que es exactamente su
estado correcto en el instante de volver.

## Cuándo se guarda

Un temporizador cada pocos segundos cubre el caso general, pero el que importa
de verdad es **`visibilitychange`**: en un móvil, el momento en que el jugador
cambia de app es el último aviso antes de que el sistema pueda reciclar la
pestaña. El juego ya escucha ese evento para pausarse, así que guardar ahí no
añade una segunda ruta que mantener.

No se guarda en cada paso de simulación: sesenta escrituras por segundo a
`localStorage` es un trabajo síncrono que se notaría en los fotogramas, y no
compra nada frente a guardar cada pocos segundos.

## Versión, y descartar en vez de migrar

El guardado lleva una versión. Al leerlo, si no coincide se descarta.

Migrar el estado de una partida entre versiones del juego es un problema
distinto —y mucho peor— que migrar récords: un récord es un número, pero una
partida a medias tiene enemigos con campos que quizá ya no existan, torres con
ramas que quizá se hayan renombrado y una oleada generada con una fórmula que
quizá haya cambiado. Reanudar una partida así no da un error visible: da una
partida sutilmente rota, y el jugador no tiene forma de saberlo.

Además, la validación al leer no se limita a la versión: se comprueba que el
escenario y la dificultad guardados sigan existiendo en el catálogo. Si un
escenario desapareciera, el guardado apuntaría a un mapa inexistente.

## Cuándo se descarta

Al terminar la partida —victoria o derrota—, al salir al menú desde la pausa y
al empezar otra. Los tres son momentos en que ya no hay nada que reanudar, y
dejar el guardado ahí haría que "Continuar" ofreciera una partida muerta.

Salir al menú **descarta**, y no guarda: es una decisión explícita de abandonar.
Si guardara, el botón de Continuar reaparecería tras haber elegido irse, que
contradice lo que el jugador acaba de pedir.

## Continuar entra en pausa

Reanudar deja la partida pausada en vez de arrancarla. Quien vuelve una hora
después no recuerda dónde tenía las torres ni por qué carril venían los
enemigos; soltarle la oleada 22 en marcha mientras se orienta es perder vidas
por un motivo que no tiene que ver con jugar.

Además, hace que reanudar se comporte igual se hubiera guardado en marcha o en
pausa, en vez de heredar el estado del momento del guardado.

## Continuar no revive la guía

Reanudar entra directamente a la partida, sin pasar por el selector de
escenario ni la guía de primeros pasos. La guía se apoya en observar el estado,
y en una partida a medias sus primeros pasos ya están cumplidos: enseñaría el
último paso pendiente fuera de contexto. Quien reanuda ya está jugando.
