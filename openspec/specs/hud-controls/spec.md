# hud-controls Specification

## Purpose
Define la interfaz con la que el jugador lee el estado de la partida y actúa sobre ella: el HUD superior con vidas y oro, la barra de compra inferior, el panel de la torre seleccionada y el botón de menú.
## Requirements
### Requirement: HUD superior

Durante la partida el juego SHALL mostrar en la parte superior de la pantalla, de forma permanente y legible, las vidas restantes, el oro disponible y el número de oleada actual. Estos valores SHALL actualizarse inmediatamente cuando cambie el estado de la partida.

#### Scenario: El HUD refleja el estado

- **WHEN** el jugador elimina un enemigo que otorga 15 de oro
- **THEN** el indicador de oro del HUD superior aumenta en 15 sin necesidad de ninguna otra acción

#### Scenario: El HUD refleja la pérdida de vidas

- **WHEN** un enemigo alcanza la meta
- **THEN** el indicador de vidas del HUD superior disminuye en 1

### Requirement: Barra de compra inferior

Durante la partida el juego SHALL mostrar en la parte inferior una barra con todas las torres disponibles, cada una con su nombre, su coste y una indicación de a qué enemigos ataca. Al pulsar una torre asequible, esa torre SHALL quedar seleccionada y resaltada hasta que el jugador la coloque, seleccione otra o cancele la selección.

#### Scenario: Seleccionar una torre para comprar

- **GIVEN** el jugador tiene oro suficiente para una torre
- **WHEN** pulsa sobre ella en la barra inferior
- **THEN** esa torre queda marcada como seleccionada en la barra

#### Scenario: La selección persiste hasta colocar

- **GIVEN** una torre seleccionada en la barra
- **WHEN** el jugador desplaza la cámara sin colocarla
- **THEN** la torre continúa seleccionada

#### Scenario: Cancelar la selección

- **GIVEN** una torre seleccionada en la barra
- **WHEN** el jugador vuelve a pulsar sobre esa misma torre en la barra
- **THEN** la selección se cancela y ningún elemento de la barra queda resaltado

#### Scenario: Previsualización de colocación

- **GIVEN** una torre seleccionada en la barra
- **WHEN** el puntero o el dedo se sitúa sobre una celda del escenario
- **THEN** se muestra una previsualización de la torre y de su alcance, indicando si la celda es válida o inválida

### Requirement: Panel de torre seleccionada

Al seleccionar una torre colocada, el juego SHALL mostrar un panel con su nombre, su nivel actual, su daño y alcance, su estructura actual sobre su máximo, el coste de la siguiente mejora y un botón de mejora. El botón de mejora SHALL aparecer deshabilitado cuando el jugador no tenga oro suficiente o la torre esté en su nivel máximo. Cuando la estructura de la torre esté por debajo de su máximo, el panel SHALL mostrar además un botón de reparar con su coste, deshabilitado cuando el jugador no tenga oro suficiente. El panel SHALL incluir también un **selector de prioridad de objetivo** y un **botón de vender** que muestre el reembolso que se obtendría.

#### Scenario: Panel con datos de la torre

- **WHEN** el jugador selecciona una torre colocada
- **THEN** el panel muestra nombre, nivel, daño, alcance, estructura y coste de la siguiente mejora

#### Scenario: Mejora deshabilitada por falta de oro

- **GIVEN** una torre seleccionada cuya mejora cuesta 60 y el jugador tiene 20 de oro
- **WHEN** se muestra el panel
- **THEN** el botón de mejora aparece deshabilitado

#### Scenario: El botón de reparar solo aparece si la torre está dañada

- **GIVEN** una torre seleccionada con su estructura al máximo
- **WHEN** se muestra el panel
- **THEN** no se ofrece la acción de reparar

#### Scenario: Reparar deshabilitado por falta de oro

- **GIVEN** una torre seleccionada con la estructura por debajo de su máximo, cuya reparación cuesta 30, y el jugador tiene 10 de oro
- **WHEN** se muestra el panel
- **THEN** el botón de reparar aparece deshabilitado

#### Scenario: El panel ofrece vender con su reembolso

- **WHEN** el jugador selecciona una torre colocada
- **THEN** el panel muestra un botón de vender con la cantidad de oro que devolvería

#### Scenario: El panel permite cambiar la prioridad de objetivo

- **GIVEN** una torre seleccionada
- **WHEN** el jugador elige otra prioridad de objetivo en el panel
- **THEN** esa torre pasa a usar la prioridad elegida

### Requirement: Botón de menú en partida

Durante la partida el juego SHALL mostrar un botón de menú accesible en todo momento desde el HUD. Pulsarlo SHALL pausar la partida y abrir el menú de pausa.

#### Scenario: Acceso al menú desde la partida

- **WHEN** el jugador pulsa el botón de menú del HUD
- **THEN** la partida se pausa y se abre el menú de pausa

### Requirement: Interfaz responsive

La interfaz SHALL adaptarse al tamaño y la orientación de la pantalla, de modo que el HUD superior y la barra inferior sean utilizables tanto en móvil como en escritorio. Los controles táctiles SHALL tener un área de pulsación de al menos 44×44 px. El HUD y la barra de compra NO SHALL solaparse con el área jugable de forma que impidan colocar torres bajo ellos: una pulsación sobre un control de la interfaz nunca SHALL colocar una torre en el escenario.

#### Scenario: Pantalla estrecha

- **WHEN** el juego se muestra en una pantalla de 360 px de ancho
- **THEN** el HUD superior y la barra de compra siguen siendo visibles y utilizables sin desbordamiento horizontal

#### Scenario: Pulsación sobre la interfaz no coloca torre

- **GIVEN** una torre seleccionada para comprar
- **WHEN** el jugador pulsa sobre un botón del HUD o de la barra inferior
- **THEN** no se coloca ninguna torre en el escenario

### Requirement: Control de la velocidad de juego

El HUD SHALL ofrecer un control para cambiar la velocidad de la simulación entre al menos 1×, 2× y 3×. La velocidad elegida SHALL afectar por igual a todo lo que avanza con el tiempo de juego (enemigos, disparos, recargas de torres y de habilidades, temporizadores de oleada) y NO SHALL alterar ningún resultado del juego más allá del ritmo. La velocidad SHALL mostrarse siempre en pantalla y SHALL conservarse al pausar y reanudar.

#### Scenario: Cambiar la velocidad acelera la partida por igual

- **GIVEN** la partida a velocidad 1×
- **WHEN** el jugador la pone a 2×
- **THEN** en el mismo tiempo real transcurre aproximadamente el doble de tiempo de juego

#### Scenario: La velocidad sobrevive a la pausa

- **GIVEN** la partida a velocidad 2×
- **WHEN** el jugador pausa y reanuda
- **THEN** la partida continúa a 2×

#### Scenario: La velocidad se ve en pantalla

- **WHEN** la partida está en curso
- **THEN** el HUD indica la velocidad activa

### Requirement: Llamar a la siguiente oleada

Durante la pausa de preparación entre oleadas, el HUD SHALL mostrar un botón para llamar a la siguiente oleada de inmediato, indicando el oro de bonus que se obtendría. El botón SHALL desaparecer o deshabilitarse cuando no haya ninguna oleada pendiente de empezar.

#### Scenario: El botón aparece durante la preparación

- **GIVEN** la partida está en la pausa entre oleadas
- **WHEN** se muestra el HUD
- **THEN** hay un botón para llamar a la siguiente oleada con su bonus indicado

#### Scenario: El botón no está disponible con la oleada en marcha

- **GIVEN** una oleada que ya está generando enemigos
- **WHEN** se muestra el HUD
- **THEN** el botón de llamar a la oleada no está disponible

### Requirement: Previsualización de la próxima oleada

Durante la pausa de preparación, el HUD SHALL mostrar de qué se compone la oleada que viene: los tipos de criatura y cuántas de cada una. SHALL destacar de forma visible si la oleada incluye enemigos aéreos, enemigos capaces de dañar torres, enemigos acorazados, enemigos sanadores o enemigos que se dividen al morir, para que el jugador pueda prepararse.

#### Scenario: La previsualización enumera la composición

- **GIVEN** la partida está en la pausa entre oleadas
- **WHEN** se muestra la previsualización
- **THEN** indica los tipos de criatura de la próxima oleada y cuántas hay de cada uno

#### Scenario: Se avisa de las amenazas especiales

- **GIVEN** una próxima oleada que incluye enemigos aéreos
- **WHEN** se muestra la previsualización
- **THEN** se señala de forma destacada que vienen enemigos aéreos

#### Scenario: Se avisa de los rasgos del bestiario

- **GIVEN** una próxima oleada que incluye enemigos acorazados
- **WHEN** se muestra la previsualización
- **THEN** se señala de forma destacada que vienen enemigos acorazados

### Requirement: Progreso de la oleada en curso

Mientras una oleada está en marcha, el HUD SHALL mostrar su progreso: cuántos enemigos han sido despachados de los que componen la oleada.

#### Scenario: El progreso avanza al eliminar enemigos

- **GIVEN** una oleada en marcha
- **WHEN** mueren o se escapan varios de sus enemigos
- **THEN** el indicador de progreso de la oleada avanza en consecuencia

### Requirement: Control de sonido en el HUD

El HUD SHALL ofrecer en todo momento un control para silenciar y reactivar el sonido, cuyo estado visual SHALL reflejar si el sonido está activo o silenciado.

#### Scenario: El control refleja el estado del sonido

- **WHEN** el jugador silencia el sonido desde el HUD
- **THEN** el control pasa a mostrar el estado silenciado

### Requirement: Barra de habilidades

Durante la partida el HUD SHALL mostrar las habilidades disponibles con su estado de recarga. Una habilidad en recarga SHALL mostrarse claramente como no disponible, con una indicación de cuánto le queda. La habilidad seleccionada para apuntar SHALL mostrarse resaltada.

#### Scenario: Una habilidad en recarga se ve no disponible

- **GIVEN** una habilidad que se acaba de usar
- **WHEN** se muestra la barra de habilidades
- **THEN** esa habilidad aparece como no disponible con su recarga restante

#### Scenario: La habilidad en apuntado se resalta

- **GIVEN** el jugador ha seleccionado una habilidad dirigida
- **WHEN** se muestra la barra de habilidades
- **THEN** esa habilidad aparece resaltada

### Requirement: Rasgos del enemigo visibles en la interfaz

La interfaz SHALL permitir al jugador conocer los rasgos de un enemigo antes de
tener que reaccionar a ellos. La barra de vida de un enemigo acorazado SHALL
distinguirse de la de uno sin armadura, y un enemigo sanador SHALL mostrar de
forma visible el alcance de su aura.

#### Scenario: Un acorazado se distingue a simple vista

- **WHEN** se dibuja un enemigo con armadura
- **THEN** su representación lo distingue de un enemigo sin armadura

#### Scenario: El aura del sanador es visible

- **WHEN** se dibuja un enemigo sanador
- **THEN** se representa el alcance de su aura de sanación

