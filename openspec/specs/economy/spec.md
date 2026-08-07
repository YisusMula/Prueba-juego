# economy Specification

## Purpose
Gobierna los dos recursos de la partida —vidas y oro— y las reglas que determinan cuándo se ganan, cuándo se gastan y qué acciones puede permitirse el jugador en cada momento.
## Requirements
### Requirement: Vidas del jugador

Toda partida SHALL comenzar con exactamente 20 vidas. Las vidas SHALL disminuir en 1 por cada enemigo que alcance la meta y no SHALL aumentar por ningún medio. Las vidas nunca SHALL mostrarse por debajo de 0.

#### Scenario: Vidas iniciales

- **WHEN** comienza una partida nueva
- **THEN** el jugador tiene 20 vidas

#### Scenario: Las vidas no bajan de cero

- **GIVEN** el jugador tiene 1 vida
- **WHEN** dos enemigos alcanzan la meta en el mismo instante
- **THEN** las vidas mostradas son 0 y la partida termina en derrota

### Requirement: Oro del jugador

Toda partida SHALL comenzar con una cantidad de oro inicial fija. El oro SHALL aumentar únicamente al eliminar enemigos, con la recompensa propia del tipo eliminado, y SHALL disminuir al comprar una torre, al mejorarla o al repararla. El oro nunca SHALL quedar en negativo: cualquier gasto que dejaría el saldo negativo SHALL rechazarse sin efecto.

#### Scenario: Oro inicial

- **WHEN** comienza una partida nueva
- **THEN** el jugador dispone del oro inicial definido para la partida

#### Scenario: El oro no queda en negativo

- **GIVEN** el jugador tiene 10 de oro
- **WHEN** intenta una compra, mejora o reparación de coste 50
- **THEN** la acción se rechaza y el oro sigue siendo 10

#### Scenario: Los enemigos que se escapan no dan oro

- **GIVEN** el jugador tiene 100 de oro
- **WHEN** un enemigo alcanza la meta
- **THEN** el oro sigue siendo 100

### Requirement: Asequibilidad en la barra de compra

La barra de compra SHALL indicar en todo momento qué torres puede pagar el jugador. Una torre cuyo coste supere el oro disponible SHALL mostrarse deshabilitada y NO SHALL poder seleccionarse. Si el oro disminuye por debajo del coste de la torre actualmente seleccionada, esa selección SHALL cancelarse.

#### Scenario: Torre inasequible no seleccionable

- **GIVEN** el jugador tiene 40 de oro y una torre cuesta 75
- **WHEN** pulsa sobre esa torre en la barra de compra
- **THEN** la torre no queda seleccionada y se muestra visualmente como no disponible

#### Scenario: La torre pasa a ser asequible

- **GIVEN** el jugador tiene 40 de oro y una torre cuesta 75
- **WHEN** elimina enemigos hasta alcanzar 80 de oro
- **THEN** esa torre pasa a mostrarse disponible y puede seleccionarse

#### Scenario: Selección cancelada al gastar el oro

- **GIVEN** el jugador tiene 100 de oro y una torre de coste 75 seleccionada
- **WHEN** gasta oro hasta quedarse con 30
- **THEN** la selección de compra se cancela

### Requirement: El oro sobrante no crece sin límite en partidas largas

El equilibrio entre lo que otorgan las oleadas y lo que cuesta defenderse SHALL evitar que, en una partida jugada de forma razonable, se acumule oro muy por encima de lo necesario en oleadas avanzadas: la reparación de torres y la ampliación del nivel máximo de mejora SHALL actuar como sumideros de oro adicionales a medida que la partida avanza.

#### Scenario: Una partida larga sigue teniendo dónde gastar el oro

- **GIVEN** una partida simulada con una estrategia de construcción y mejora razonable que llega a oleadas avanzadas
- **WHEN** se observa el oro acumulado en esas oleadas
- **THEN** permanece dentro de un margen acotado en vez de crecer sin límite, porque sigue habiendo mejoras y reparaciones en las que invertirlo

