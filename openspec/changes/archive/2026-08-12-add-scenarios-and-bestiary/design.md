# Diseño

## El modelo: un escenario es un conjunto de rutas

La decisión central. El mapa actual expone constantes de módulo (`PATH_CELLS`,
`WAYPOINTS`, `PATH_LENGTH`, `positionAtDistance`) que describen **un** camino.
Para tener varios escenarios y bifurcaciones hay que elegir cómo se representa
un camino que se parte.

### Alternativas consideradas

**Grafo de nodos con bifurcaciones explícitas.** El camino sería un grafo
dirigido y el enemigo elegiría rama en cada nodo. Es el modelo más general —
permite bifurcaciones anidadas y bucles — pero obliga a reescribir el avance del
enemigo, que hoy es una simple distancia acumulada sobre una polilínea, y a
sustituir `positionAtDistance` por un recorrido del grafo. Mucha maquinaria para
un juego que solo necesita partir el camino en dos.

**Rutas completas, elegida.** Una ruta es un recorrido entero de entrada a meta.
Un escenario tiene una o varias. El enemigo se asigna a una ruta al aparecer y
recorre su polilínea exactamente igual que hoy.

Lo que hace atractiva esta opción es que **los tres casos que queremos son el
mismo caso**:

| Lo que ve el jugador | Rutas |
| --- | --- |
| Un camino | 1 ruta |
| Bifurcación que se reúne | 2 rutas con el mismo principio y el mismo final |
| Dos entradas | 2 rutas con origen distinto |

No hay código de "bifurcación": hay código de "rutas", y la bifurcación emerge
de que dos rutas compartan celdas. El avance del enemigo, el cálculo de
`progress` para la prioridad *primero/último*, las fugas y el daño a torres
siguen funcionando sin tocarse; solo cambian de "la ruta" a "su ruta".

El coste es que no se pueden expresar bifurcaciones anidadas sin enumerar todas
las combinaciones. Con dos ramas son dos rutas; con dos bifurcaciones
independientes serían cuatro. Es un techo aceptable: ningún escenario del
catálogo se acerca.

### Asignación de ruta

Determinista, como el resto de la simulación: `routeIndex = enemyId % routes.length`.
Reparte a partes iguales y alterna, que es justo lo que interesa visualmente —
el jugador ve el flujo dividirse — y mantiene los tests reproducibles. Nada de
`Math.random()`.

## Terreno: la unión de las rutas

Una celda es camino si pertenece a **cualquier** ruta. Así, la construcción
sigue prohibida sobre todo el trazado sin ninguna regla nueva, y el tramo
compartido de una bifurcación es camino una sola vez.

Las celdas de entrada son las primeras de cada ruta; las de meta, las últimas.
Un escenario con dos entradas tiene dos celdas de entrada, y el terreno lo
refleja para que el render las dibuje como cuevas.

## El escenario vive en el estado, no en el módulo

Hoy `map.ts` calcula sus tablas al importarse. Con varios escenarios eso ya no
vale: hay que precalcular **cada** escenario y que la partida sepa cuál usa.

`GameState` gana `scenarioId`, y las funciones que antes eran globales pasan a
recibir el escenario. Para que esto no obligue a pasar el escenario por quince
sitios, se precalcula todo lo derivado (celdas, terreno, polilíneas, longitudes
acumuladas) **una vez por escenario al cargar el módulo** y se guarda en el
propio objeto del escenario. Consultar sigue siendo una lectura de tabla, igual
de barata que ahora.

## Armadura: resta fija, no porcentaje

La armadura resta una cantidad **fija** por impacto, con un mínimo garantizado
de 1 de daño. Frente al porcentaje, la resta fija:

- Distingue de verdad entre torres. Una arquera de 9 de daño contra 6 de
  armadura hace 3; una ballesta de 55 hace 49. El porcentaje afectaría a ambas
  por igual y no cambiaría qué torre conviene.
- Nunca vuelve un enemigo inmune, porque el mínimo de 1 garantiza que cualquier
  defensa acabe matándolo. Un enemigo inmune a la torre que el jugador ya ha
  construido es una derrota que no puede leer.

El daño de las habilidades **ignora la armadura**: son recursos limitados por
recarga, y su valor está en resolver justo la situación que las torres no pueden.

## División: crías, no clones

Un divisor deja dos crías al morir. Para que no sea una bola de nieve:

- Las crías son de un tipo distinto y más débil, no copias del padre.
- Solo el padre otorga su recompensa completa; las crías dan poco.
- Las crías **no se dividen**, lo cual corta la recursión por construcción en
  vez de por un contador de generación.

Las crías heredan la ruta y la distancia recorrida del padre, así que aparecen
donde murió y no retroceden.

## Sanación: aura, no objetivo

El sanador cura por área en vez de elegir a quién curar. Es más legible — el
jugador ve el grupo entero recuperándose y entiende que el problema es *ese*
bicho — y evita tener que decidir y dibujar un vínculo sanador-objetivo. La cura
no revive: solo afecta a enemigos vivos, y nunca por encima de su vida máxima.

## Récords por escenario

La clave del récord pasa de `dificultad` a `escenario + dificultad`. Los récords
guardados con el formato antiguo se ignoran al leer: no hay forma honesta de
adivinar en qué escenario se hicieron, y mantener una migración inventada sería
peor que empezar de cero. La versión de la clave de `localStorage` sube para que
un formato viejo no se interprete como nuevo.
