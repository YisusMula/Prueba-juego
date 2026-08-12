## ADDED Requirements

### Requirement: Catálogo de escenarios

El juego SHALL ofrecer varios escenarios jugables. Cada escenario SHALL tener un
identificador, un nombre, una descripción corta y una o más rutas. Una partida
SHALL desarrollarse sobre un único escenario, elegido antes de empezar, y ese
escenario SHALL permanecer fijo durante toda la partida.

El catálogo SHALL incluir al menos un escenario de una sola ruta, uno con una
bifurcación que se reúne antes de la meta y uno con dos entradas distintas.

#### Scenario: Todo escenario es jugable

- **WHEN** se recorre el catálogo de escenarios
- **THEN** cada escenario tiene al menos una ruta
- **AND** cada ruta empieza en una celda de entrada y termina en una celda de meta
- **AND** cada ruta es continua: cada celda es adyacente en horizontal o vertical a la siguiente

#### Scenario: El catálogo cubre las tres formas

- **WHEN** se consulta el catálogo
- **THEN** existe un escenario con exactamente una ruta
- **AND** existe un escenario cuyas rutas comparten la celda de entrada y la de meta pero difieren en el tramo intermedio
- **AND** existe un escenario cuyas rutas parten de celdas de entrada distintas

#### Scenario: El escenario no cambia a mitad de partida

- **GIVEN** una partida en curso sobre un escenario
- **WHEN** avanzan las oleadas
- **THEN** el escenario de la partida sigue siendo el mismo

### Requirement: Rutas y reparto de enemigos

Un escenario con varias rutas SHALL repartir los enemigos entre ellas de forma
determinista, de modo que dos partidas con la misma secuencia de oleadas
produzcan el mismo reparto. Cada enemigo SHALL avanzar por la ruta que se le
asignó al aparecer y no SHALL cambiar de ruta.

#### Scenario: El reparto es determinista

- **GIVEN** un escenario con dos rutas
- **WHEN** se generan los enemigos de una oleada dos veces desde el mismo estado inicial
- **THEN** cada enemigo recibe la misma ruta en ambas ejecuciones

#### Scenario: Todas las rutas reciben enemigos

- **GIVEN** un escenario con dos rutas
- **WHEN** aparecen al menos dos enemigos
- **THEN** cada ruta ha recibido al menos un enemigo

#### Scenario: El enemigo recorre su ruta

- **GIVEN** un enemigo terrestre asignado a una ruta
- **WHEN** avanza sin abandonar el camino
- **THEN** su posición permanece sobre celdas de esa ruta hasta alcanzar la meta

### Requirement: Construcción prohibida sobre cualquier ruta

Una celda SHALL considerarse camino si pertenece a alguna de las rutas del
escenario. El juego SHALL rechazar la colocación de torres sobre cualquiera de
esas celdas, incluidas las que comparten varias rutas.

#### Scenario: El tramo compartido tampoco es construible

- **GIVEN** un escenario con una bifurcación que se reúne
- **WHEN** el jugador intenta colocar una torre sobre una celda por la que pasan las dos rutas
- **THEN** no se coloca ninguna torre y el oro no cambia

#### Scenario: La rama secundaria tampoco es construible

- **GIVEN** un escenario con una bifurcación
- **WHEN** el jugador intenta colocar una torre sobre una celda que solo pertenece a una de las ramas
- **THEN** no se coloca ninguna torre y el oro no cambia
