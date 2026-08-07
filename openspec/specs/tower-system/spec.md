# tower-system Specification

## Purpose
Define el catálogo de torres del juego, cómo se colocan, a qué enemigos pueden atacar cada una, cómo disparan y cómo el jugador las selecciona para subirlas de nivel.
## Requirements
### Requirement: Catálogo de torres

El juego SHALL ofrecer varios tipos de torre que se diferencian en coste, daño, alcance, cadencia de disparo y objetivos válidos. SHALL existir al menos:

- una torre de **cañón**, que dispara bolas de cañón y SHALL atacar únicamente a enemigos terrestres;
- una torre de **arqueras**, que dispara flechas y SHALL atacar tanto a enemigos terrestres como aéreos;
- variantes de mayor precio con mayor potencia (por ejemplo, un mortero de área y una ballesta de largo alcance), de modo que a mayor coste corresponda mayor potencia efectiva;
- una torre **mágica**, que dispara rayos de gran daño y SHALL atacar tanto a enemigos terrestres como aéreos;
- una torre de **hielo**, cuyo daño SHALL ser muy inferior al del resto del catálogo pero que SHALL ralentizar drásticamente al enemigo alcanzado durante un tiempo.

#### Scenario: El cañón ignora a los aéreos

- **GIVEN** una torre de cañón con un enemigo aéreo dentro de su alcance y ningún terrestre
- **WHEN** la torre busca objetivo
- **THEN** no dispara y el enemigo aéreo no recibe daño

#### Scenario: Las arqueras atacan a ambos dominios

- **GIVEN** una torre de arqueras con un enemigo aéreo dentro de su alcance
- **WHEN** la torre busca objetivo
- **THEN** dispara contra el enemigo aéreo y le inflige daño

#### Scenario: Más coste implica más potencia

- **WHEN** se comparan dos torres del catálogo cuyo efecto principal sea el daño directo
- **THEN** la de mayor coste base tiene un daño por segundo efectivo superior al de la más barata

#### Scenario: La torre de hielo prioriza el control sobre el daño

- **WHEN** se compara el daño base de la torre de hielo con el de cualquier otra torre del catálogo
- **THEN** el daño base de la torre de hielo es el menor de todos

### Requirement: Colocación de torres

Colocar una torre SHALL requerir que el jugador la haya seleccionado previamente en la barra de compra y SHALL descontar su coste del oro en el momento de colocarla. Una colocación rechazada por terreno inválido u oro insuficiente no SHALL modificar el oro ni añadir torre alguna.

#### Scenario: Compra y colocación

- **GIVEN** el jugador tiene 100 de oro y una torre de coste 50 seleccionada
- **WHEN** coloca la torre sobre una celda de prado libre
- **THEN** la torre aparece en esa celda y el oro pasa a 50

#### Scenario: Oro insuficiente en el momento de colocar

- **GIVEN** el jugador tiene 30 de oro y una torre de coste 50 seleccionada
- **WHEN** intenta colocarla sobre prado libre
- **THEN** no se coloca ninguna torre y el oro sigue siendo 30

### Requirement: Adquisición de objetivo y disparo

Una torre SHALL disparar solo cuando exista al menos un enemigo vivo dentro de su alcance que sea objetivo válido para su tipo. Entre los candidatos válidos, la torre SHALL elegir el que esté más avanzado en el recorrido hacia la meta. La torre SHALL respetar su cadencia: entre dos disparos consecutivos debe transcurrir al menos su tiempo de recarga.

#### Scenario: Sin enemigos en alcance no dispara

- **GIVEN** una torre sin enemigos válidos dentro de su alcance
- **WHEN** avanza el tiempo de juego
- **THEN** la torre no genera proyectiles

#### Scenario: Prioriza al enemigo más avanzado

- **GIVEN** dos enemigos válidos dentro del alcance de una torre
- **WHEN** la torre elige objetivo
- **THEN** dispara contra el que está más cerca de la meta a lo largo del recorrido

#### Scenario: Respeta la cadencia

- **GIVEN** una torre con una cadencia de un disparo por segundo y un enemigo permanentemente en alcance
- **WHEN** transcurren 2,5 segundos de juego
- **THEN** la torre ha disparado 3 veces como máximo

#### Scenario: El proyectil aplica daño al impactar

- **GIVEN** un proyectil en vuelo hacia un enemigo
- **WHEN** el proyectil alcanza al enemigo
- **THEN** los puntos de vida del enemigo se reducen en el daño del proyectil y el proyectil desaparece

#### Scenario: El daño de área alcanza a varios enemigos

- **GIVEN** una torre con daño de área y dos enemigos terrestres juntos
- **WHEN** su proyectil impacta
- **THEN** ambos enemigos reciben daño

### Requirement: Selección y mejora de torres

El jugador SHALL poder seleccionar una torre ya colocada pulsando sobre ella, lo que SHALL mostrar su nivel, sus estadísticas, su alcance y el coste de la siguiente mejora. Mejorar una torre SHALL aumentar su nivel en 1 y mejorar sus estadísticas (daño y/o alcance). El coste de cada nivel SHALL ser estrictamente mayor que el del nivel anterior. Toda torre SHALL tener un nivel máximo de 8, más allá del cual la mejora no está disponible.

#### Scenario: Seleccionar una torre colocada

- **WHEN** el jugador pulsa sobre una torre existente en el escenario
- **THEN** la torre queda seleccionada, se resalta su radio de alcance y se muestra un panel con su nivel, estadísticas y coste de mejora

#### Scenario: Mejorar una torre

- **GIVEN** una torre de nivel 1 seleccionada, con coste de mejora 40, y el jugador tiene 60 de oro
- **WHEN** el jugador confirma la mejora
- **THEN** la torre pasa a nivel 2 con más daño y/o alcance
- **AND** el oro pasa a 20

#### Scenario: Coste creciente por nivel

- **WHEN** se comparan los costes de mejora de una misma torre
- **THEN** el coste para pasar al nivel N+1 es estrictamente mayor que el coste para pasar al nivel N

#### Scenario: Mejora sin oro suficiente

- **GIVEN** una torre seleccionada con coste de mejora 40 y el jugador tiene 30 de oro
- **WHEN** intenta mejorarla
- **THEN** la torre mantiene su nivel y el oro sigue siendo 30

#### Scenario: Nivel máximo alcanzado

- **GIVEN** una torre en su nivel 8
- **WHEN** el jugador la selecciona
- **THEN** el panel indica que está al nivel máximo y no ofrece la acción de mejorar

#### Scenario: Deseleccionar

- **GIVEN** una torre seleccionada
- **WHEN** el jugador pulsa sobre una zona vacía del prado sin torre de compra seleccionada
- **THEN** la torre se deselecciona y su panel se oculta

### Requirement: Estructura de las torres y reparación

Toda torre colocada SHALL tener puntos de estructura, además de sus puntos de vida en el sentido de daño ofensivo. Cuando un enemigo capaz de dañar torres inflija daño, esos puntos de estructura SHALL disminuir sin bajar de 0. Una torre cuya estructura llegue a 0 SHALL dejar de adquirir objetivos y de disparar hasta que se repare. El jugador SHALL poder reparar la torre seleccionada gastando oro; reparar SHALL restaurar la estructura a su máximo. Una reparación sin oro suficiente SHALL rechazarse sin efecto.

#### Scenario: Una torre dañada deja de disparar al llegar a 0

- **GIVEN** una torre cuya estructura llega a 0 por los golpes de los enemigos
- **WHEN** un enemigo válido para su tipo entra en su alcance
- **THEN** la torre no dispara

#### Scenario: Reparar restaura la estructura y cobra su coste

- **GIVEN** una torre con la estructura por debajo de su máximo, seleccionada, y el jugador con oro suficiente
- **WHEN** el jugador pulsa reparar
- **THEN** la estructura de la torre vuelve a su máximo
- **AND** el oro del jugador disminuye en el coste de la reparación

#### Scenario: Reparar sin oro suficiente no hace nada

- **GIVEN** una torre con la estructura por debajo de su máximo y el jugador sin oro suficiente para repararla
- **WHEN** el jugador intenta repararla
- **THEN** la estructura de la torre no cambia y el oro no cambia

#### Scenario: Una torre reparada vuelve a disparar

- **GIVEN** una torre sin estructura que acaba de ser reparada
- **WHEN** un enemigo válido para su tipo entra en su alcance
- **THEN** la torre vuelve a disparar con normalidad

### Requirement: Efecto de congelación

La torre de hielo SHALL aplicar, al impactar, un efecto de ralentización severa y temporal al enemigo alcanzado. En sus primeros niveles SHALL mantener como máximo un enemigo congelado a la vez; a partir de cierto nivel SHALL poder mantener congelados simultáneamente a más de un enemigo. Refrescar la congelación de un enemigo ya congelado por la misma torre no SHALL contar como un nuevo objetivo a efectos de ese límite.

#### Scenario: Un enemigo congelado avanza mucho más lento

- **GIVEN** un enemigo alcanzado por un proyectil de la torre de hielo
- **WHEN** el efecto se aplica
- **THEN** la velocidad de avance del enemigo se reduce drásticamente durante el tiempo del efecto

#### Scenario: La torre de hielo de nivel bajo no congela a un segundo enemigo

- **GIVEN** una torre de hielo de nivel bajo que ya mantiene un enemigo congelado
- **WHEN** impacta a un enemigo distinto
- **THEN** ese segundo enemigo no queda congelado, aunque reciba el daño del impacto

#### Scenario: La torre de hielo de nivel alto congela a varios enemigos

- **GIVEN** una torre de hielo en uno de sus niveles altos
- **WHEN** impacta a varios enemigos distintos dentro del límite de su nivel
- **THEN** todos ellos quedan congelados a la vez

