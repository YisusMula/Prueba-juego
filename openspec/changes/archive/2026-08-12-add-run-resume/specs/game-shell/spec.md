## ADDED Requirements

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
