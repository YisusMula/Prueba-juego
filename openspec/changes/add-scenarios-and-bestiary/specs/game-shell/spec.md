## ADDED Requirements

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

## MODIFIED Requirements

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
