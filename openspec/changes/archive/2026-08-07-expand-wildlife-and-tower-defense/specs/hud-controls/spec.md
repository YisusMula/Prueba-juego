## MODIFIED Requirements

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
