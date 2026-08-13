## MODIFIED Requirements

### Requirement: Pantalla de selección de escenario

Entre el menú principal y la partida el juego SHALL mostrar una pantalla de
selección de escenario. La pantalla SHALL listar todos los escenarios del
catálogo con su nombre, su descripción y el récord del jugador en ese escenario
con la dificultad seleccionada. Desde ella el jugador SHALL poder empezar la
partida en el escenario elegido o volver al menú principal.

La pantalla SHALL mostrar además, por cada escenario, sus **estrellas** sobre el
máximo, y SHALL indicar cuáles están **bloqueados** junto con lo que hace falta
para abrirlos. Un escenario bloqueado SHALL aparecer en la lista pero no SHALL
poder elegirse. La pantalla SHALL mostrar el total de estrellas conseguidas.

No SHALL simularse ninguna oleada mientras la pantalla de selección esté visible.

#### Scenario: Comenzar lleva a la selección de escenario

- **GIVEN** el jugador está en el menú principal
- **WHEN** pulsa el botón de comenzar
- **THEN** se muestra la pantalla de selección de escenario
- **AND** la partida todavía no ha empezado

#### Scenario: La selección lista todos los escenarios

- **WHEN** se muestra la pantalla de selección de escenario
- **THEN** aparece una entrada por cada escenario del catálogo, con su nombre y su descripción
- **AND** los escenarios bloqueados también aparecen, señalados como tales

#### Scenario: Elegir un escenario empieza la partida

- **GIVEN** el jugador está en la pantalla de selección de escenario
- **WHEN** elige un escenario desbloqueado
- **THEN** la partida empieza sobre ese escenario, con las vidas y el oro iniciales de la dificultad elegida
- **AND** se muestran el HUD superior y la barra de compra inferior

#### Scenario: Un escenario bloqueado no se puede elegir

- **GIVEN** un escenario bloqueado en la pantalla de selección
- **WHEN** el jugador pulsa sobre él
- **THEN** no empieza ninguna partida y se sigue mostrando la selección

#### Scenario: Volver desde la selección

- **GIVEN** el jugador está en la pantalla de selección de escenario
- **WHEN** pulsa el botón de volver
- **THEN** se muestra el menú principal y no hay ninguna partida en curso

#### Scenario: Cada escenario muestra su récord

- **GIVEN** el jugador tiene un récord en un escenario y una dificultad
- **WHEN** abre la pantalla de selección con esa dificultad
- **THEN** la entrada de ese escenario muestra ese récord

#### Scenario: Cada escenario muestra sus estrellas

- **GIVEN** el jugador ha ganado un escenario
- **WHEN** abre la pantalla de selección
- **THEN** la entrada de ese escenario muestra las estrellas conseguidas sobre el máximo

### Requirement: Menú principal

Al cargar la aplicación el juego SHALL mostrar una pantalla de menú principal ambientada en el mundo del juego (prado y camino de fondo), con el título "Tower Game", un selector de dificultad y un botón de comenzar. El menú SHALL mostrar además el mejor récord del jugador en la dificultad seleccionada entre todos los escenarios, si lo hay, y su **total de estrellas sobre el máximo posible**. No SHALL simularse ninguna oleada mientras el menú principal esté visible.

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

#### Scenario: El menú muestra el progreso de la campaña

- **WHEN** se muestra el menú principal
- **THEN** indica el total de estrellas conseguidas sobre el máximo posible

### Requirement: Pantalla de victoria

Cuando el jugador supere la oleada final, el juego SHALL mostrar una pantalla de victoria con un resumen de la partida (oleada alcanzada, criaturas eliminadas y vidas conservadas). Desde ella el jugador SHALL poder continuar en modo sin fin o volver al menú principal.

La pantalla SHALL indicar las **estrellas** que tiene el escenario tras la victoria y, si la partida ha **desbloqueado** un escenario nuevo, SHALL decirlo.

#### Scenario: La victoria ofrece continuar o salir

- **WHEN** se muestra la pantalla de victoria
- **THEN** ofrece continuar en modo sin fin y volver al menú principal

#### Scenario: Volver al menú desde la victoria descarta la partida

- **GIVEN** se muestra la pantalla de victoria
- **WHEN** el jugador vuelve al menú principal
- **THEN** se muestra el menú principal y comenzar de nuevo inicia una partida desde cero

#### Scenario: La victoria informa de las estrellas

- **WHEN** se muestra la pantalla de victoria
- **THEN** indica cuántas estrellas tiene ese escenario sobre el máximo

#### Scenario: La victoria anuncia el desbloqueo

- **GIVEN** una victoria que abre un escenario que estaba bloqueado
- **WHEN** se muestra la pantalla de victoria
- **THEN** informa de que ese escenario ha quedado desbloqueado
