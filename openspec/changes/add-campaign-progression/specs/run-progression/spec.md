## ADDED Requirements

### Requirement: Estrellas por escenario

Cada escenario SHALL otorgar estrellas según la **dificultad más alta en la que
el jugador haya ganado** en él: una en la más fácil, dos en la intermedia y tres
en la más difícil. Un escenario en el que nunca se haya ganado SHALL tener cero
estrellas.

Alcanzar la oleada final sin ganar no SHALL otorgar estrellas: solo cuenta
terminar la partida en victoria.

Las estrellas SHALL ser la mejor marca de siempre: una partida posterior peor no
SHALL reducirlas.

#### Scenario: Ganar en la dificultad más fácil da una estrella

- **GIVEN** un escenario sin estrellas
- **WHEN** el jugador gana en la dificultad más fácil
- **THEN** ese escenario pasa a tener una estrella

#### Scenario: Ganar en la dificultad más alta da tres

- **GIVEN** un escenario sin estrellas
- **WHEN** el jugador gana en la dificultad más difícil
- **THEN** ese escenario pasa a tener tres estrellas

#### Scenario: Perder en la oleada final no da estrellas

- **GIVEN** un escenario sin estrellas
- **WHEN** el jugador pierde en la oleada final de ese escenario
- **THEN** ese escenario sigue con cero estrellas

#### Scenario: Una partida peor no quita estrellas

- **GIVEN** un escenario con tres estrellas
- **WHEN** el jugador vuelve a jugarlo y pierde
- **THEN** ese escenario sigue con tres estrellas

#### Scenario: Las estrellas son independientes por escenario

- **GIVEN** el jugador gana en un escenario
- **WHEN** se consultan las estrellas de otro escenario
- **THEN** ese otro escenario sigue con las que tuviera

#### Scenario: El modo sin fin no otorga estrellas adicionales

- **GIVEN** una partida ganada en la dificultad intermedia, con dos estrellas
- **WHEN** el jugador continúa en modo sin fin y termina más adelante
- **THEN** ese escenario sigue con dos estrellas

### Requirement: Desbloqueo progresivo de escenarios

El primer escenario del catálogo SHALL estar siempre disponible. Cada uno de los
demás SHALL desbloquearse al conseguir **al menos una estrella** en el escenario
inmediatamente anterior.

Un escenario bloqueado no SHALL poder iniciarse.

#### Scenario: El primer escenario está siempre disponible

- **GIVEN** un jugador sin ningún récord
- **WHEN** consulta el catálogo
- **THEN** el primer escenario está desbloqueado

#### Scenario: Los demás empiezan bloqueados

- **GIVEN** un jugador sin ningún récord
- **WHEN** consulta el catálogo
- **THEN** todos los escenarios salvo el primero están bloqueados

#### Scenario: Ganar abre el siguiente

- **GIVEN** un jugador que solo tiene desbloqueado el primer escenario
- **WHEN** gana en él en cualquier dificultad
- **THEN** el segundo escenario queda desbloqueado

#### Scenario: El desbloqueo no salta escenarios

- **GIVEN** un jugador que gana el primer escenario
- **WHEN** consulta el tercero
- **THEN** sigue bloqueado

#### Scenario: Un escenario bloqueado no se puede empezar

- **GIVEN** un escenario bloqueado
- **WHEN** se intenta empezar una partida en él
- **THEN** la partida no empieza

### Requirement: Total de estrellas

El juego SHALL poder informar del total de estrellas conseguidas y del máximo
posible, para que el jugador tenga una medida única de su progreso.

#### Scenario: El total suma las de cada escenario

- **GIVEN** un jugador con dos estrellas en un escenario y tres en otro
- **WHEN** consulta su total
- **THEN** el total es cinco

#### Scenario: El máximo son tres por escenario

- **WHEN** se consulta el máximo de estrellas
- **THEN** es tres veces el número de escenarios del catálogo

## MODIFIED Requirements

### Requirement: Récords persistentes

El juego SHALL registrar, por cada combinación de escenario y dificultad, la mejor oleada alcanzada, la mejor puntuación obtenida y **si se ha llegado a ganar**, y SHALL conservarlos entre sesiones. Al terminar una partida, en victoria o en derrota, el récord de ese escenario y esa dificultad SHALL actualizarse únicamente si el resultado lo supera; una victoria registrada no SHALL borrarse por una partida posterior perdida. Si el almacenamiento no está disponible, el juego SHALL seguir funcionando con normalidad sin récords.

Los récords guardados con un formato anterior SHALL descartarse al leerse, en lugar de interpretarse como si fueran del formato actual.

#### Scenario: Un resultado mejor actualiza el récord

- **GIVEN** un récord previo de oleada 12 en un escenario y una dificultad
- **WHEN** el jugador termina una partida de ese escenario y esa dificultad en la oleada 18
- **THEN** el récord de esa combinación pasa a ser 18

#### Scenario: Un resultado peor no empeora el récord

- **GIVEN** un récord previo de oleada 18 en un escenario y una dificultad
- **WHEN** el jugador termina una partida de esa combinación en la oleada 9
- **THEN** el récord de esa combinación sigue siendo 18

#### Scenario: La victoria queda registrada

- **GIVEN** un escenario y una dificultad sin victoria previa
- **WHEN** el jugador gana una partida en esa combinación
- **THEN** el récord de esa combinación queda marcado como ganado

#### Scenario: Una derrota posterior no borra la victoria

- **GIVEN** un récord marcado como ganado
- **WHEN** el jugador vuelve a jugar esa combinación y pierde
- **THEN** el récord sigue marcado como ganado

#### Scenario: Los récords son independientes por dificultad

- **GIVEN** un récord en una dificultad
- **WHEN** el jugador termina una partida en otra dificultad
- **THEN** solo se actualiza el récord de la dificultad jugada

#### Scenario: Los récords son independientes por escenario

- **GIVEN** un récord en un escenario con una dificultad
- **WHEN** el jugador termina una partida en otro escenario con la misma dificultad
- **THEN** solo se actualiza el récord del escenario jugado

#### Scenario: Un formato antiguo se descarta

- **GIVEN** un almacenamiento con récords en un formato anterior
- **WHEN** el juego carga los récords
- **THEN** no se atribuye ningún récord a ningún escenario y el juego arranca sin marcas

#### Scenario: Sin almacenamiento el juego sigue funcionando

- **GIVEN** un navegador en el que el almacenamiento local no está disponible
- **WHEN** el jugador juega y termina una partida
- **THEN** la partida transcurre con normalidad y no se produce ningún error
