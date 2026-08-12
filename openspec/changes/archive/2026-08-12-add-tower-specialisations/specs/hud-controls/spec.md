## ADDED Requirements

### Requirement: Elección de especialización en el panel de torre

Cuando una torre seleccionada pueda especializarse y aún no lo haya hecho, el
panel SHALL ofrecer sus dos ramas, cada una con su nombre y una descripción de
lo que cambia, de modo que el jugador pueda decidir sin probar.

El panel SHALL avisar de que la elección es permanente.

Una vez elegida, el panel SHALL mostrar la especialización de la torre y ya no
SHALL ofrecer la elección.

#### Scenario: El panel ofrece las dos ramas cuando toca

- **GIVEN** una torre seleccionada que ha alcanzado el nivel de especialización y no está especializada
- **WHEN** se muestra el panel
- **THEN** aparecen las dos especializaciones con su nombre y su descripción

#### Scenario: Antes de tiempo no se ofrece

- **GIVEN** una torre seleccionada por debajo del nivel de especialización
- **WHEN** se muestra el panel
- **THEN** no se ofrece ninguna especialización

#### Scenario: Ya especializada, el panel la muestra en lugar de la elección

- **GIVEN** una torre seleccionada ya especializada
- **WHEN** se muestra el panel
- **THEN** el panel muestra el nombre de su especialización
- **AND** no ofrece elegir ninguna rama

### Requirement: Una torre especializada se distingue en el escenario

Una torre con especialización SHALL representarse de forma distinguible de una
torre del mismo tipo sin especializar, para que el jugador reconozca de un
vistazo qué papel cumple cada puesto.

#### Scenario: La torre especializada se ve distinta

- **WHEN** se dibuja una torre especializada
- **THEN** su representación la distingue de una del mismo tipo y nivel sin especializar
