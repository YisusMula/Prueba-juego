# game-shell Specification

## Purpose
Define las pantallas del juego (menú principal, partida, pausa y derrota), sus transiciones y el ciclo de vida de una partida, de forma que el jugador siempre sepa en qué estado está y pueda empezar, pausar, salir o reintentar.
## Requirements
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

### Requirement: La guía aparece la primera vez y se puede repetir

La guía de primeros pasos SHALL mostrarse automáticamente la primera vez que el
jugador empieza una partida, y no en las siguientes.

El jugador SHALL poder **saltarla** en cualquier momento; saltarla SHALL contar
como haberla visto. SHALL poder **volver a activarla** desde el menú principal.

La preferencia SHALL conservarse entre sesiones. Si el almacenamiento no está
disponible, el juego SHALL seguir funcionando con normalidad.

#### Scenario: La primera partida la muestra

- **GIVEN** un jugador que nunca ha jugado
- **WHEN** empieza su primera partida
- **THEN** la guía está activa

#### Scenario: Las partidas siguientes no la muestran

- **GIVEN** un jugador que ya ha visto la guía
- **WHEN** empieza otra partida
- **THEN** la guía no está activa

#### Scenario: Saltarla cuenta como vista

- **GIVEN** la guía activa en una partida
- **WHEN** el jugador la salta
- **THEN** deja de mostrarse en esa partida y tampoco aparece en la siguiente

#### Scenario: Se puede volver a activar desde el menú

- **GIVEN** un jugador que ya la había visto
- **WHEN** la reactiva desde el menú principal y empieza una partida
- **THEN** la guía vuelve a estar activa

#### Scenario: Sin almacenamiento el juego sigue funcionando

- **GIVEN** un navegador en el que el almacenamiento local no está disponible
- **WHEN** el jugador empieza una partida
- **THEN** la partida transcurre con normalidad y no se produce ningún error

### Requirement: Continuar la partida guardada

Cuando exista una partida guardada válida, el menú principal SHALL ofrecer
**continuarla**, indicando el escenario y la oleada en que se quedó. Cuando no
la haya, esa opción no SHALL aparecer.

Continuar SHALL restaurar la partida sin pasar por la selección de escenario, y
SHALL dejarla **en pausa**: volver mucho después y encontrarse la oleada ya en
marcha no da tiempo a reconocer el tablero. El jugador ve dónde estaba y arranca
cuando quiere.

La guía de primeros pasos no SHALL activarse al continuar: en una partida a
medias sus primeros pasos ya están cumplidos y solo enseñaría el último fuera de
contexto.

#### Scenario: Sin partida guardada no se ofrece continuar

- **GIVEN** un jugador sin ninguna partida guardada
- **WHEN** se muestra el menú principal
- **THEN** no se ofrece continuar

#### Scenario: Con partida guardada se ofrece continuar

- **GIVEN** una partida guardada en un escenario y una oleada
- **WHEN** se muestra el menú principal
- **THEN** se ofrece continuar, indicando ese escenario y esa oleada

#### Scenario: Continuar restaura la partida en pausa

- **GIVEN** una partida guardada
- **WHEN** el jugador continúa
- **THEN** se restaura el estado guardado y la partida queda en pausa
- **AND** no se muestra la selección de escenario

#### Scenario: Reanudar desde la pausa pone la partida en marcha

- **GIVEN** una partida recién continuada, en pausa
- **WHEN** el jugador pulsa reanudar
- **THEN** la partida se pone en marcha

#### Scenario: Continuar no activa la guía

- **GIVEN** una partida guardada de un jugador que nunca ha visto la guía
- **WHEN** continúa esa partida
- **THEN** la guía no está activa

### Requirement: Descarte de la partida guardada

El guardado SHALL descartarse al terminar la partida en victoria o en derrota,
al salir al menú principal desde la pausa y al empezar una partida nueva.

Salir al menú SHALL descartar el guardado en lugar de conservarlo: es una
decisión explícita de abandonar, y conservarlo haría reaparecer la opción de
continuar justo después de haber elegido irse.

#### Scenario: Perder descarta el guardado

- **GIVEN** una partida guardada en curso
- **WHEN** el jugador pierde
- **THEN** ya no hay partida que continuar

#### Scenario: Ganar descarta el guardado

- **GIVEN** una partida guardada en curso
- **WHEN** el jugador gana
- **THEN** ya no hay partida que continuar

#### Scenario: Salir al menú descarta el guardado

- **GIVEN** una partida guardada en curso
- **WHEN** el jugador sale al menú principal desde la pausa
- **THEN** ya no hay partida que continuar

#### Scenario: Empezar otra partida descarta la anterior

- **GIVEN** una partida guardada
- **WHEN** el jugador empieza una partida nueva
- **THEN** el guardado pasa a ser el de la partida nueva

