## MODIFIED Requirements

### Requirement: Récords persistentes

El juego SHALL registrar, por cada combinación de escenario y dificultad, la mejor oleada alcanzada y la mejor puntuación obtenida, y SHALL conservarlos entre sesiones. Al terminar una partida, en victoria o en derrota, el récord de ese escenario y esa dificultad SHALL actualizarse únicamente si el resultado lo supera. Si el almacenamiento no está disponible, el juego SHALL seguir funcionando con normalidad sin récords.

Los récords guardados con un formato anterior SHALL descartarse al leerse, en lugar de atribuirse a un escenario arbitrario.

#### Scenario: Un resultado mejor actualiza el récord

- **GIVEN** un récord previo de oleada 12 en un escenario y una dificultad
- **WHEN** el jugador termina una partida de ese escenario y esa dificultad en la oleada 18
- **THEN** el récord de esa combinación pasa a ser 18

#### Scenario: Un resultado peor no empeora el récord

- **GIVEN** un récord previo de oleada 18 en un escenario y una dificultad
- **WHEN** el jugador termina una partida de esa combinación en la oleada 9
- **THEN** el récord de esa combinación sigue siendo 18

#### Scenario: Los récords son independientes por dificultad

- **GIVEN** un récord en una dificultad
- **WHEN** el jugador termina una partida en otra dificultad
- **THEN** solo se actualiza el récord de la dificultad jugada

#### Scenario: Los récords son independientes por escenario

- **GIVEN** un récord en un escenario con una dificultad
- **WHEN** el jugador termina una partida en otro escenario con la misma dificultad
- **THEN** solo se actualiza el récord del escenario jugado

#### Scenario: Un formato antiguo se descarta

- **GIVEN** un almacenamiento con récords en el formato anterior, sin escenario
- **WHEN** el juego carga los récords
- **THEN** no se atribuye ningún récord a ningún escenario y el juego arranca sin marcas

#### Scenario: Sin almacenamiento el juego sigue funcionando

- **GIVEN** un navegador en el que el almacenamiento local no está disponible
- **WHEN** el jugador juega y termina una partida
- **THEN** la partida transcurre con normalidad y no se produce ningún error
