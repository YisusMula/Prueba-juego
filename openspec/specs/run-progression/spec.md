# run-progression Specification

## Purpose
Da forma de producto a la partida: define en qué consiste ganar, qué dificultad elige el jugador antes de empezar y qué queda registrado de una partida a otra para que volver a jugar tenga sentido.
## Requirements
### Requirement: Condición de victoria

La partida SHALL tener una oleada final definida. Al completarse esa oleada —es decir, cuando todos sus enemigos han muerto o alcanzado la meta y el jugador conserva al menos una vida— el juego SHALL declarar la victoria y mostrar una pantalla de victoria con el resumen de la partida. Al ganar, la simulación SHALL detenerse igual que al perder.

#### Scenario: Superar la oleada final gana la partida

- **GIVEN** el jugador está jugando la oleada final con al menos una vida
- **WHEN** el último enemigo de esa oleada muere o alcanza la meta
- **THEN** se muestra la pantalla de victoria con el resumen de la partida
- **AND** la simulación se detiene

#### Scenario: Perder antes de la oleada final no da la victoria

- **GIVEN** el jugador se queda sin vidas antes de completar la oleada final
- **WHEN** se comprueba el resultado de la partida
- **THEN** se muestra la pantalla de derrota, no la de victoria

#### Scenario: Tras ganar no se puede seguir interactuando con el escenario

- **GIVEN** se muestra la pantalla de victoria
- **WHEN** el jugador intenta comprar, colocar o mejorar una torre
- **THEN** la acción se rechaza sin efecto

### Requirement: Modo sin fin tras la victoria

Desde la pantalla de victoria el jugador SHALL poder continuar la misma partida en modo sin fin, conservando sus torres, su oro y sus vidas. En modo sin fin las oleadas SHALL seguir generándose indefinidamente y ya NO SHALL existir una nueva condición de victoria: la partida solo puede terminar en derrota.

#### Scenario: Continuar conserva el estado de la partida

- **GIVEN** se muestra la pantalla de victoria con unas torres, un oro y unas vidas concretos
- **WHEN** el jugador elige continuar en modo sin fin
- **THEN** la partida se reanuda con exactamente esas mismas torres, ese oro y esas vidas

#### Scenario: En modo sin fin ya no se vuelve a ganar

- **GIVEN** una partida en modo sin fin
- **WHEN** se superan más oleadas que la oleada final
- **THEN** no se muestra ninguna pantalla de victoria y la partida continúa

### Requirement: Niveles de dificultad

Antes de empezar, el jugador SHALL poder elegir entre al menos tres dificultades. Cada dificultad SHALL definir sus vidas iniciales, su oro inicial y un multiplicador aplicado a la vida de los enemigos. A mayor dificultad, las vidas y el oro iniciales SHALL ser menores o iguales y el multiplicador de vida de los enemigos SHALL ser mayor o igual.

#### Scenario: La dificultad elegida determina los recursos iniciales

- **WHEN** el jugador comienza una partida con una dificultad concreta
- **THEN** empieza con las vidas y el oro iniciales definidos para esa dificultad

#### Scenario: Las dificultades están ordenadas de forma coherente

- **WHEN** se comparan dos dificultades cualesquiera
- **THEN** la más difícil no da más vidas ni más oro inicial que la más fácil, y sus enemigos no tienen menos vida

#### Scenario: La dificultad afecta a la vida de los enemigos

- **GIVEN** la misma oleada generada en dos dificultades distintas
- **WHEN** se compara la vida de un enemigo del mismo tipo
- **THEN** en la dificultad más alta su vida es mayor o igual

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

