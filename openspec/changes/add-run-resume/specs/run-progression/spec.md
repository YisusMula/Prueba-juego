## ADDED Requirements

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
