## MODIFIED Requirements

### Requirement: Menú principal

Al cargar la aplicación el juego SHALL mostrar una pantalla de menú principal ambientada en el mundo del juego (prado y camino de fondo), con el título "Tower Game", un selector de dificultad y un botón de comenzar. El menú SHALL mostrar además el récord del jugador en la dificultad seleccionada, si lo hay. No SHALL simularse ninguna oleada mientras el menú principal esté visible.

#### Scenario: Carga inicial

- **WHEN** el jugador abre la aplicación por primera vez
- **THEN** se muestra la pantalla de menú principal con el título "Tower Game", el selector de dificultad y un botón para comenzar
- **AND** no se muestra el HUD de partida ni hay enemigos en movimiento

#### Scenario: Comenzar partida

- **WHEN** el jugador pulsa el botón de comenzar
- **THEN** el juego pasa al estado de partida en curso con las vidas y el oro iniciales de la dificultad elegida, y la oleada 1 preparada
- **AND** se muestran el HUD superior y la barra de compra inferior

#### Scenario: El récord se muestra por dificultad

- **GIVEN** el jugador tiene un récord registrado en una dificultad
- **WHEN** selecciona esa dificultad en el menú principal
- **THEN** el menú muestra el récord correspondiente a esa dificultad

## ADDED Requirements

### Requirement: Pantalla de victoria

Cuando el jugador supere la oleada final, el juego SHALL mostrar una pantalla de victoria con un resumen de la partida (oleada alcanzada, criaturas eliminadas y vidas conservadas). Desde ella el jugador SHALL poder continuar en modo sin fin o volver al menú principal.

#### Scenario: La victoria ofrece continuar o salir

- **WHEN** se muestra la pantalla de victoria
- **THEN** ofrece continuar en modo sin fin y volver al menú principal

#### Scenario: Volver al menú desde la victoria descarta la partida

- **GIVEN** se muestra la pantalla de victoria
- **WHEN** el jugador vuelve al menú principal
- **THEN** se muestra el menú principal y comenzar de nuevo inicia una partida desde cero
