# wave-system Specification

## Purpose
Define cómo llegan los enemigos al escenario: la composición y progresión de las oleadas, los tipos de criatura (terrestre y aérea) con sus atributos, y qué ocurre cuando un enemigo muere o alcanza la meta.
## Requirements
### Requirement: Progresión de oleadas

El juego SHALL avanzar por oleadas numeradas empezando en la 1. Cada oleada SHALL generar un conjunto definido de enemigos separados por un intervalo de aparición. Una oleada SHALL considerarse terminada cuando todos sus enemigos han muerto o han alcanzado la meta; entonces el juego SHALL preparar la siguiente oleada tras una pausa entre oleadas. Las oleadas SHALL ser progresivamente más difíciles: a mayor número de oleada, más enemigos y/o más resistentes.

#### Scenario: Aparición escalonada

- **WHEN** comienza una oleada
- **THEN** sus enemigos aparecen en la entrada de uno en uno, separados por el intervalo de aparición de esa oleada

#### Scenario: Fin de oleada

- **GIVEN** todos los enemigos de la oleada actual han muerto o han llegado a la meta
- **WHEN** transcurre la pausa entre oleadas
- **THEN** el contador de oleada aumenta en 1 y comienza la siguiente oleada

#### Scenario: Dificultad creciente

- **WHEN** se comparan dos oleadas cualesquiera
- **THEN** la de número mayor tiene una vida total de enemigos igual o superior a la de número menor, y estrictamente superior cada varias oleadas

#### Scenario: Aparición de enemigos aéreos

- **WHEN** el juego alcanza la oleada en la que se introducen las criaturas aéreas
- **THEN** la oleada incluye al menos un enemigo de tipo aéreo

### Requirement: Tipos de enemigo

Cada enemigo SHALL tener un tipo con: dominio (terrestre o aéreo), puntos de vida, velocidad de avance y recompensa de oro. SHALL existir al menos un tipo terrestre básico, uno terrestre rápido, uno terrestre resistente y uno aéreo. Los enemigos aéreos SHALL ser objetivo válido únicamente para torres capaces de atacar al aire.

#### Scenario: Enemigo con atributos propios

- **WHEN** se genera un enemigo de un tipo concreto
- **THEN** recibe los puntos de vida, la velocidad y la recompensa definidos para ese tipo

#### Scenario: Enemigo resistente frente a rápido

- **WHEN** se comparan el tipo terrestre resistente y el terrestre rápido
- **THEN** el resistente tiene más puntos de vida y menor velocidad que el rápido

### Requirement: Muerte de un enemigo

Cuando los puntos de vida de un enemigo lleguen a 0 o menos, el enemigo SHALL retirarse del escenario y el jugador SHALL recibir la recompensa de oro correspondiente a su tipo. Un enemigo muerto no SHALL restar vidas.

#### Scenario: Enemigo eliminado otorga oro

- **GIVEN** un enemigo cuya recompensa es 15 de oro
- **WHEN** recibe daño suficiente para dejar sus puntos de vida en 0 o menos
- **THEN** desaparece del escenario y el oro del jugador aumenta en 15
- **AND** las vidas del jugador no cambian

#### Scenario: Recompensas distintas por tipo

- **WHEN** se eliminan enemigos de tipos distintos
- **THEN** cada uno otorga la cantidad de oro definida para su propio tipo

### Requirement: Enemigo que alcanza la meta

Cuando un enemigo alcance la celda de meta, SHALL retirarse del escenario, SHALL restar exactamente una vida al jugador y NO SHALL otorgar oro, con independencia de su tipo o de la vida que le quedara.

#### Scenario: Fuga resta una vida

- **GIVEN** el jugador tiene 20 vidas y 100 de oro
- **WHEN** un enemigo alcanza la meta
- **THEN** el jugador pasa a tener 19 vidas
- **AND** el oro sigue siendo 100

#### Scenario: Varias fugas restan una vida cada una

- **GIVEN** el jugador tiene 20 vidas
- **WHEN** tres enemigos alcanzan la meta
- **THEN** el jugador pasa a tener 17 vidas

