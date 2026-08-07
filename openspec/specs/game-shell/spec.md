# game-shell Specification

## Purpose
Define las pantallas del juego (menú principal, partida, pausa y derrota), sus transiciones y el ciclo de vida de una partida, de forma que el jugador siempre sepa en qué estado está y pueda empezar, pausar, salir o reintentar.
## Requirements
### Requirement: Menú principal

Al cargar la aplicación el juego SHALL mostrar una pantalla de menú principal ambientada en el mundo del juego (prado y camino de fondo), con el título "Tower Game" y un botón de comenzar. No SHALL simularse ninguna oleada mientras el menú principal esté visible.

#### Scenario: Carga inicial

- **WHEN** el jugador abre la aplicación por primera vez
- **THEN** se muestra la pantalla de menú principal con el título "Tower Game" y un botón para comenzar
- **AND** no se muestra el HUD de partida ni hay enemigos en movimiento

#### Scenario: Comenzar partida

- **WHEN** el jugador pulsa el botón de comenzar
- **THEN** el juego pasa al estado de partida en curso con 20 vidas, el oro inicial y la oleada 1 preparada
- **AND** se muestran el HUD superior y la barra de compra inferior

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

