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

Al seleccionar una torre colocada, el juego SHALL mostrar un panel con su nombre, su nivel actual, su daño y alcance, su estructura actual sobre su máximo, el coste de la siguiente mejora y un botón de mejora. El botón de mejora SHALL aparecer deshabilitado cuando el jugador no tenga oro suficiente o la torre esté en su nivel máximo. Cuando la estructura de la torre esté por debajo de su máximo, el panel SHALL mostrar además un botón de reparar con su coste, deshabilitado cuando el jugador no tenga oro suficiente.

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

