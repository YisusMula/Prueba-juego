## ADDED Requirements

### Requirement: Guía de primeros pasos

El juego SHALL ofrecer una guía de primeros pasos formada por una secuencia
ordenada de pasos. Cada paso SHALL tener un texto de pista y una condición que
se evalúa sobre el estado de la partida.

La guía SHALL mostrar el **primer paso cuya condición no se cumpla todavía**. Un
paso cuya condición ya se cumple SHALL considerarse completado sin intervención
del jugador. Cuando todos los pasos estén completados, la guía SHALL terminar.

La guía no SHALL modificar el estado de la partida ni impedir ninguna acción: es
información en pantalla, no un peaje.

#### Scenario: Al empezar se muestra el primer paso

- **GIVEN** una partida recién empezada con la guía activa
- **WHEN** se consulta el paso actual
- **THEN** es el primero de la secuencia

#### Scenario: Hacer lo que pide avanza la guía

- **GIVEN** la guía mostrando un paso
- **WHEN** el jugador hace lo que ese paso pide
- **THEN** la guía pasa a mostrar el siguiente paso pendiente

#### Scenario: Un paso ya cumplido no se pide

- **GIVEN** un jugador que ya ha colocado una torre antes de que la guía llegue a ese paso
- **WHEN** se consulta el paso actual
- **THEN** no es el de colocar una torre

#### Scenario: La guía retrocede si el jugador deshace

- **GIVEN** la guía pidiendo que se mejore la torre colocada
- **WHEN** el jugador vende esa torre y no le queda ninguna
- **THEN** la guía vuelve a pedir que coloque una torre

#### Scenario: Completar todos los pasos termina la guía

- **GIVEN** un estado que cumple la condición de todos los pasos
- **WHEN** se consulta el paso actual
- **THEN** no hay ninguno y la guía se da por terminada

#### Scenario: La guía no altera la partida

- **GIVEN** dos partidas idénticas, una con la guía activa y otra sin ella
- **WHEN** avanzan el mismo tiempo de simulación
- **THEN** su estado es el mismo

### Requirement: Contenido de la guía

La guía SHALL enseñar, en este orden, a elegir una torre en la barra de compra,
a colocarla sobre el prado, a subirla de nivel y a especializarla.

No SHALL haber un paso para seleccionar la torre colocada, porque colocarla ya
abre su panel: un paso que el juego cumple solo no le pide nada al jugador. La
forma de reabrir el panel SHALL explicarse dentro del paso de mejora.

Cada paso SHALL tener un texto no vacío que diga qué hacer.

#### Scenario: Los pasos cubren la cadena de construcción

- **WHEN** se consulta la secuencia de pasos
- **THEN** incluye elegir torre, colocarla, mejorarla y especializarla
- **AND** cada paso tiene un texto no vacío

#### Scenario: Ningún paso está cumplido de antemano en una partida nueva

- **GIVEN** una partida recién empezada, sin torres
- **WHEN** se recorre la secuencia de pasos
- **THEN** ninguno tiene su condición ya cumplida
