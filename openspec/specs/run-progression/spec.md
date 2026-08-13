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

### Requirement: Guardado de la partida en curso

El juego SHALL guardar la partida en curso de forma automática, de modo que
cerrar la pestaña o cambiar de aplicación no la pierda.

El guardado SHALL contener el estado completo de la simulación: oleada, fase,
temporizadores, oro, vidas, enemigos con su recorrido y sus efectos, torres con
su nivel, estructura, prioridad y especialización, proyectiles en vuelo,
recargas de habilidades y estadísticas.

El guardado no SHALL contener los efectos visuales ni la cola de sonidos
pendientes: son presentación de un instante ya pasado, y restaurarlos mostraría
números de daño y reproduciría sonidos de impactos anteriores al guardado.

#### Scenario: Guardar y restaurar reproduce la partida

- **GIVEN** una partida avanzada con torres, enemigos y proyectiles
- **WHEN** se guarda y se vuelve a cargar
- **THEN** la oleada, la fase, el oro, las vidas, las torres y los enemigos son los mismos

#### Scenario: Los efectos y los sonidos no se restauran

- **GIVEN** una partida con efectos visuales y sonidos pendientes
- **WHEN** se guarda y se vuelve a cargar
- **THEN** la partida restaurada no tiene efectos ni sonidos pendientes

#### Scenario: La partida restaurada continúa igual

- **GIVEN** una partida guardada y restaurada
- **WHEN** ambas avanzan el mismo tiempo de simulación
- **THEN** llegan al mismo estado

#### Scenario: Los valores infinitos sobreviven a la ida y vuelta

- **GIVEN** una partida con enemigos cuya distancia de fuga es infinita
- **WHEN** se guarda y se vuelve a cargar
- **THEN** esa distancia sigue siendo infinita

#### Scenario: Guardar no altera la partida

- **GIVEN** una partida en curso
- **WHEN** se guarda
- **THEN** su estado no cambia

### Requirement: Validez del guardado

El guardado SHALL llevar una versión de formato. Al leerlo, el juego SHALL
descartarlo si la versión no coincide, si el escenario o la dificultad guardados
ya no existen en el catálogo, o si el contenido no se puede interpretar.

Un guardado de una partida ya terminada no SHALL ofrecerse para reanudar.

Si el almacenamiento no está disponible, el juego SHALL seguir funcionando con
normalidad y sin partida guardada.

#### Scenario: Una versión distinta se descarta

- **GIVEN** un guardado con una versión de formato distinta
- **WHEN** el juego lo lee
- **THEN** no hay partida que reanudar

#### Scenario: Un escenario inexistente se descarta

- **GIVEN** un guardado cuyo escenario no está en el catálogo
- **WHEN** el juego lo lee
- **THEN** no hay partida que reanudar

#### Scenario: Un contenido ilegible se descarta

- **GIVEN** un guardado con contenido que no se puede interpretar
- **WHEN** el juego lo lee
- **THEN** no hay partida que reanudar y no se produce ningún error

#### Scenario: Una partida terminada no se reanuda

- **GIVEN** un guardado de una partida en derrota o en victoria
- **WHEN** el juego lo lee
- **THEN** no hay partida que reanudar

#### Scenario: Sin almacenamiento el juego sigue funcionando

- **GIVEN** un navegador en el que el almacenamiento local no está disponible
- **WHEN** el jugador juega
- **THEN** la partida transcurre con normalidad y no se produce ningún error

