# Diseño

## El progreso se deriva, no se guarda aparte

La tentación es guardar una lista de escenarios desbloqueados junto a los
récords. Se descarta: serían dos verdades sobre lo mismo, y en cuanto una se
escribiera sin la otra —un fallo a mitad de guardado, un formato antiguo, una
partida que termina sin llegar a persistir— el jugador podría tener un escenario
abierto que no se ha ganado, o cerrado uno que sí.

En su lugar, `campaign.ts` **deriva** las estrellas y el desbloqueo de los
récords con funciones puras. Solo hay una cosa guardada —lo que has conseguido—
y todo lo demás es una consulta sobre ella. No hay estado que sincronizar.

El coste es recalcular en cada consulta, que sobre tres escenarios y tres
dificultades es irrelevante.

## Estrellas por dificultad más alta, no acumuladas

Un escenario podría dar una estrella por cada dificultad ganada, sumando hasta
tres. Se elige en cambio **la dificultad más alta ganada**, mapeada a 1, 2 o 3.

La diferencia importa: con estrellas acumuladas, ganar en Difícil dejaría dos
tareas pendientes (repetirlo en Fácil y en Normal) que no enseñan nada y que el
jugador haría solo por completismo. Con la dificultad más alta, ganar en Difícil
concede las tres directamente, y las estrellas dicen **cómo de bien** has
resuelto el escenario en vez de cuántas veces lo has repetido.

## Hace falta registrar la victoria

Hoy el récord guarda `bestWave`, y superar la oleada 30 marca 30 igual que morir
en ella. El simulador de balance lo enseña bien: en Difícil el jugador
automático **muere en la oleada 30**. Deducir la victoria de `bestWave >= 30`
daría estrellas por perder en el último asalto.

Así que el registro gana un `won` explícito, que solo se pone a cierto cuando la
partida termina en victoria. Como no se puede recuperar de los datos guardados
con el formato anterior, la versión de la clave sube y lo viejo se descarta —el
mismo criterio que ya se aplicó al pasar a récords por escenario.

## Desbloqueo estrictamente secuencial

Cada escenario se abre con **una estrella** en el anterior, no con un número
mayor. Una estrella es "lo has ganado en Fácil", que es exactamente el listón
para decir que has entendido el mapa. Pedir dos obligaría a jugar en Normal para
avanzar, y convertiría la dificultad en un peaje en vez de en una elección.

El primer escenario está siempre abierto: sin eso, una partida nueva no tendría
por dónde empezar.

## Los bloqueados se ven

Un escenario bloqueado aparece en la lista, atenuado y con lo que hace falta
para abrirlo. Ocultarlo escondería que hay más juego, que es justo lo contrario
de lo que una campaña pretende: la lista completa es la promesa.

## Modo sin fin y estrellas

Continuar en modo sin fin tras ganar no da estrellas adicionales. La victoria ya
se registró al alcanzarla, y el sin fin es un epílogo sin condición de victoria:
si contara, habría que decidir en qué momento "vuelve a ganar", y no hay ninguno.
