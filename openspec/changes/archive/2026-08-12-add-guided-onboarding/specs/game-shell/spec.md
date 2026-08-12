## ADDED Requirements

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
