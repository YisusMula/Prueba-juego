# game-shell Specification

## Purpose
Define las pantallas del juego (menú principal, partida, pausa y derrota), sus transiciones y el ciclo de vida de una partida, de forma que el jugador siempre sepa en qué estado está y pueda empezar, pausar, salir o reintentar.
## Requirements
### Requirement: Menú principal

Al cargar la aplicación el juego SHALL mostrar una pantalla de menú principal ambientada en el mundo del juego (prado y camino de fondo), con el título "Tower Game", un selector de dificultad y un botón de comenzar. El menú SHALL mostrar además el mejor récord del jugador en la dificultad seleccionada entre todos los escenarios, si lo hay. No SHALL simularse ninguna oleada mientras el menú principal esté visible.

#### Scenario: Carga inicial

- **WHEN** el jugador abre la aplicación por primera vez
- **THEN** se muestra la pantalla de menú principal con el título "Tower Game", el selector de dificultad y un botón para comenzar
- **AND** no se muestra el HUD de partida ni hay enemigos en movimiento

#### Scenario: Comenzar partida

- **WHEN** el jugador pulsa el botón de comenzar
- **THEN** el juego pasa a la pantalla de selección de escenario

#### Scenario: El récord se muestra por dificultad

- **GIVEN** el jugador tiene un récord registrado en una dificultad
- **WHEN** selecciona esa dificultad en el menú principal
- **THEN** el menú muestra el mejor récord de esa dificultad entre todos los escenarios

### Requirement: Pausa desde el botón de menú

Durante la partida el juego SHALL ofrecer un botón de menú. Al pulsarlo, el juego SHALL pausarse: el tiempo de simulación se detiene y ni enemigos, ni proyectiles, ni oleadas avanzan. Desde la pausa el jugador SHALL poder reanudar la partida o salir al menú principal.

#### Scenario: Pausar la partida

- **WHEN** el jugador pulsa el botón de menú durante la partida
- **THEN** la simulación se detiene y se muestra un panel de pausa con opciones de reanudar y salir al menú principal

#### Scenario: Reanudar la partida

- **GIVEN** la partida está en pausa
- **WHEN** el jugador elige reanudar
- **THEN** la simulación continúa exactamente desde el mismo estado (vidas, oro, torres, enemigos y progreso de oleada intactos)

#### Scenario: Salir al menú principal

- **GIVEN** la partida está en pausa
- **WHEN** el jugador elige salir al menú principal
- **THEN** se muestra el menú principal
- **AND** la partida en curso se descarta, de modo que comenzar de nuevo inicia una partida desde cero

### Requirement: Pantalla de derrota

Cuando las vidas del jugador lleguen a 0 el juego SHALL terminar la partida y mostrar una pantalla de derrota con el texto "Has perdido" y un botón de reintentar. Tras la derrota la simulación SHALL detenerse y no SHALL aceptarse ninguna compra, mejora ni colocación de torres.

#### Scenario: Vidas agotadas

- **GIVEN** el jugador tiene 1 vida
- **WHEN** un enemigo alcanza la meta
- **THEN** las vidas pasan a 0, la simulación se detiene y se muestra la pantalla "Has perdido" con un botón de reintentar

#### Scenario: Reintentar

- **GIVEN** se muestra la pantalla de derrota
- **WHEN** el jugador pulsa el botón de reintentar
- **THEN** comienza una partida nueva con 20 vidas, el oro inicial, sin torres y desde la oleada 1

#### Scenario: Interacción bloqueada tras perder

- **GIVEN** se muestra la pantalla de derrota
- **WHEN** el jugador toca el prado o la barra de compra
- **THEN** no se coloca ninguna torre ni se modifica el oro

### Requirement: Pantalla de victoria

Cuando el jugador supere la oleada final, el juego SHALL mostrar una pantalla de victoria con un resumen de la partida (oleada alcanzada, criaturas eliminadas y vidas conservadas). Desde ella el jugador SHALL poder continuar en modo sin fin o volver al menú principal.

#### Scenario: La victoria ofrece continuar o salir

- **WHEN** se muestra la pantalla de victoria
- **THEN** ofrece continuar en modo sin fin y volver al menú principal

#### Scenario: Volver al menú desde la victoria descarta la partida

- **GIVEN** se muestra la pantalla de victoria
- **WHEN** el jugador vuelve al menú principal
- **THEN** se muestra el menú principal y comenzar de nuevo inicia una partida desde cero

### Requirement: Pantalla de selección de escenario

Entre el menú principal y la partida el juego SHALL mostrar una pantalla de
selección de escenario. La pantalla SHALL listar todos los escenarios del
catálogo con su nombre, su descripción y el récord del jugador en ese escenario
con la dificultad seleccionada. Desde ella el jugador SHALL poder empezar la
partida en el escenario elegido o volver al menú principal.

No SHALL simularse ninguna oleada mientras la pantalla de selección esté visible.

#### Scenario: Comenzar lleva a la selección de escenario

- **GIVEN** el jugador está en el menú principal
- **WHEN** pulsa el botón de comenzar
- **THEN** se muestra la pantalla de selección de escenario
- **AND** la partida todavía no ha empezado

#### Scenario: La selección lista todos los escenarios

- **WHEN** se muestra la pantalla de selección de escenario
- **THEN** aparece una entrada por cada escenario del catálogo, con su nombre y su descripción

#### Scenario: Elegir un escenario empieza la partida

- **GIVEN** el jugador está en la pantalla de selección de escenario
- **WHEN** elige un escenario
- **THEN** la partida empieza sobre ese escenario, con las vidas y el oro iniciales de la dificultad elegida
- **AND** se muestran el HUD superior y la barra de compra inferior

#### Scenario: Volver desde la selección

- **GIVEN** el jugador está en la pantalla de selección de escenario
- **WHEN** pulsa el botón de volver
- **THEN** se muestra el menú principal y no hay ninguna partida en curso

#### Scenario: Cada escenario muestra su récord

- **GIVEN** el jugador tiene un récord en un escenario y una dificultad
- **WHEN** abre la pantalla de selección con esa dificultad
- **THEN** la entrada de ese escenario muestra ese récord

