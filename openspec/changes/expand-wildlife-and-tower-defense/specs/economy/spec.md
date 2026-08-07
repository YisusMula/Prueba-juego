## MODIFIED Requirements

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

## ADDED Requirements

### Requirement: El oro sobrante no crece sin límite en partidas largas

El equilibrio entre lo que otorgan las oleadas y lo que cuesta defenderse SHALL evitar que, en una partida jugada de forma razonable, se acumule oro muy por encima de lo necesario en oleadas avanzadas: la reparación de torres y la ampliación del nivel máximo de mejora SHALL actuar como sumideros de oro adicionales a medida que la partida avanza.

#### Scenario: Una partida larga sigue teniendo dónde gastar el oro

- **GIVEN** una partida simulada con una estrategia de construcción y mejora razonable que llega a oleadas avanzadas
- **WHEN** se observa el oro acumulado en esas oleadas
- **THEN** permanece dentro de un margen acotado en vez de crecer sin límite, porque sigue habiendo mejoras y reparaciones en las que invertirlo
