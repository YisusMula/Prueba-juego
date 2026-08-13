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

Una torre SHALL disparar solo cuando exista al menos un enemigo vivo dentro de su alcance que sea objetivo válido para su tipo. Entre los candidatos válidos, la torre SHALL elegir el que corresponda a su **prioridad de objetivo** configurada, que por defecto es el más avanzado en el recorrido hacia la meta. La torre SHALL respetar su cadencia: entre dos disparos consecutivos debe transcurrir al menos su tiempo de recarga.

#### Scenario: Sin enemigos en alcance no dispara

- **GIVEN** una torre sin enemigos válidos dentro de su alcance
- **WHEN** avanza el tiempo de juego
- **THEN** la torre no genera proyectiles

#### Scenario: Prioriza al enemigo más avanzado

- **GIVEN** una torre con la prioridad por defecto y dos enemigos válidos dentro de su alcance
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

### Requirement: Prioridad de objetivo configurable

Cada torre colocada SHALL tener una prioridad de objetivo que el jugador puede cambiar desde su panel. SHALL existir al menos: **primero** (el más avanzado hacia la meta), **último** (el menos avanzado), **más fuerte** (el de más vida actual) y **más cercano** (el que está a menor distancia de la torre). La prioridad SHALL aplicarse solo entre los candidatos que ya son válidos por alcance y por dominio; cambiarla nunca SHALL permitir a una torre disparar a un enemigo que su tipo no puede atacar.

#### Scenario: La prioridad "último" invierte la elección

- **GIVEN** una torre con prioridad "último" y dos enemigos válidos en su alcance
- **WHEN** elige objetivo
- **THEN** dispara contra el menos avanzado en el recorrido

#### Scenario: La prioridad "más fuerte" elige por vida

- **GIVEN** una torre con prioridad "más fuerte" y dos enemigos válidos en su alcance con vidas distintas
- **WHEN** elige objetivo
- **THEN** dispara contra el que más vida tiene en ese momento

#### Scenario: La prioridad "más cercano" elige por distancia

- **GIVEN** una torre con prioridad "más cercano" y dos enemigos válidos a distancias distintas
- **WHEN** elige objetivo
- **THEN** dispara contra el que está más cerca de la torre

#### Scenario: La prioridad no salta las reglas de dominio

- **GIVEN** una torre que solo ataca a tierra, con cualquier prioridad configurada, y únicamente un enemigo aéreo en su alcance
- **WHEN** busca objetivo
- **THEN** no encuentra ninguno y no dispara

#### Scenario: Una torre nueva empieza con la prioridad por defecto

- **WHEN** el jugador coloca una torre
- **THEN** su prioridad de objetivo es "primero"

### Requirement: Inversión acumulada y venta de una torre

Cada torre SHALL registrar el oro total invertido en ella, sumando su coste de compra y el de cada mejora aplicada. El jugador SHALL poder vender la torre seleccionada desde su panel. Vender SHALL retirar la torre del escenario y devolver el reembolso correspondiente a esa inversión acumulada.

#### Scenario: La inversión crece con cada mejora

- **GIVEN** una torre recién colocada cuya inversión es su coste de compra
- **WHEN** el jugador la mejora
- **THEN** su inversión acumulada aumenta en el coste de esa mejora

#### Scenario: Vender retira la torre y deselecciona

- **GIVEN** una torre seleccionada
- **WHEN** el jugador la vende
- **THEN** la torre ya no está en el escenario y su panel deja de mostrarse

#### Scenario: No se puede vender con la partida terminada

- **GIVEN** la partida ha terminado en derrota o en victoria
- **WHEN** el jugador intenta vender una torre
- **THEN** la acción se rechaza y el oro no cambia

### Requirement: El daño de la torre se resuelve contra la armadura

Cuando una torre alcanza a un enemigo, el daño aplicado SHALL ser el daño de la
torre menos la armadura del enemigo, con un mínimo de 1. Esto SHALL aplicarse
tanto al impacto directo como al daño en área de las torres que lo tengan.

La consecuencia buscada es que una torre de muchos impactos pequeños rinda peor
contra enemigos acorazados que una de pocos impactos grandes con el mismo daño
por segundo nominal.

#### Scenario: El daño en área también se reduce por armadura

- **GIVEN** un mortero que alcanza a un enemigo acorazado dentro de su radio de área
- **WHEN** se aplica el daño
- **THEN** el enemigo pierde el daño de área menos su armadura

#### Scenario: La torre de cadencia alta rinde peor contra armadura

- **GIVEN** dos torres con el mismo daño por segundo nominal, una de impactos pequeños y frecuentes y otra de impactos grandes y espaciados
- **WHEN** ambas atacan al mismo enemigo acorazado durante el mismo tiempo
- **THEN** la torre de impactos grandes le ha quitado más vida

### Requirement: Especialización de torre

Cada tipo de torre SHALL ofrecer exactamente dos especializaciones. Una torre
SHALL poder especializarse al alcanzar el nivel 4, y no antes. Una vez elegida,
la especialización SHALL mantenerse durante el resto de la partida y no SHALL
poder cambiarse ni retirarse.

Especializarse no SHALL ser requisito para seguir subiendo de nivel: una torre
sin especializar SHALL poder mejorarse hasta el nivel máximo.

Una torre sin especializar SHALL comportarse exactamente igual que antes de
existir las especializaciones.

#### Scenario: Antes del nivel de especialización no se puede elegir

- **GIVEN** una torre de nivel 3
- **WHEN** el jugador intenta especializarla
- **THEN** la torre sigue sin especialización

#### Scenario: Al llegar al nivel se ofrecen dos ramas

- **GIVEN** una torre que alcanza el nivel 4
- **WHEN** se consultan sus especializaciones disponibles
- **THEN** se ofrecen exactamente dos, cada una con su nombre y su descripción

#### Scenario: La elección se conserva

- **GIVEN** una torre de nivel 4 sin especializar
- **WHEN** el jugador elige una de sus dos especializaciones
- **THEN** la torre queda con esa especialización

#### Scenario: La elección es irreversible

- **GIVEN** una torre ya especializada
- **WHEN** el jugador intenta elegir la otra especialización
- **THEN** la torre conserva la que ya tenía

#### Scenario: Se puede llegar al nivel máximo sin especializarse

- **GIVEN** una torre sin especializar con oro suficiente
- **WHEN** el jugador la mejora repetidamente
- **THEN** alcanza el nivel máximo y sigue sin especialización

#### Scenario: Una especialización de otra torre se rechaza

- **GIVEN** una torre de arqueras de nivel 4
- **WHEN** el jugador intenta aplicarle una especialización del cañón
- **THEN** la torre sigue sin especialización

#### Scenario: Vender una torre descarta su especialización

- **GIVEN** una torre especializada
- **WHEN** el jugador la vende y construye otra del mismo tipo en su sitio
- **THEN** la torre nueva empieza en el nivel 1 y sin especialización

### Requirement: Efecto de las especializaciones sobre las estadísticas

Una especialización SHALL poder modificar el daño, el alcance, la cadencia y el
radio de área de la torre. Estos modificadores SHALL aplicarse sobre las
estadísticas del nivel actual, de modo que la escalada por nivel siga siendo la
misma.

Las dos ramas de un mismo tipo SHALL diferenciarse en algo más que la magnitud:
cada par SHALL cambiar el comportamiento de la torre en direcciones distintas.

#### Scenario: La rama modifica las estadísticas

- **GIVEN** dos torres del mismo tipo y nivel, una con una rama de más cadencia y otra sin especializar
- **WHEN** se comparan sus estadísticas
- **THEN** la especializada tiene mayor cadencia de disparo

#### Scenario: La escalada por nivel se mantiene

- **GIVEN** una torre especializada
- **WHEN** sube de nivel
- **THEN** sus estadísticas crecen respecto al nivel anterior

#### Scenario: Sin especialización las estadísticas no cambian

- **GIVEN** una torre sin especializar
- **WHEN** se consultan sus estadísticas
- **THEN** son las del tipo y nivel, sin modificación alguna

### Requirement: Perforación de armadura

Una especialización SHALL poder conceder perforación. Los disparos de una torre
con perforación SHALL ignorar por completo la armadura del enemigo, tanto en el
impacto directo como en el daño en área.

Al menos una especialización de cada torre cuyo papel sea el daño SHALL conceder
perforación, de modo que todo jugador tenga una respuesta a los acorazados sin
cambiar de tipo de torre.

#### Scenario: La torre perforante ignora la armadura

- **GIVEN** una torre con perforación y un enemigo con armadura
- **WHEN** el disparo impacta
- **THEN** el enemigo pierde el daño completo de la torre, sin reducción

#### Scenario: Sin perforación la armadura sigue contando

- **GIVEN** una torre sin perforación y un enemigo con armadura
- **WHEN** el disparo impacta
- **THEN** el enemigo pierde el daño de la torre menos su armadura

### Requirement: Disparo encadenado

Una especialización SHALL poder conceder saltos en cadena. Un disparo encadenado
SHALL alcanzar, además de su objetivo, hasta un número dado de enemigos cercanos,
con el daño reducido en cada salto.

Un salto SHALL respetar el dominio de la torre: una torre que no puede atacar a
un dominio tampoco SHALL encadenar hacia un enemigo de ese dominio. Cada enemigo
SHALL recibir como máximo un impacto por disparo.

#### Scenario: El rayo salta a los enemigos cercanos

- **GIVEN** una torre con cadena de dos saltos y tres enemigos agrupados
- **WHEN** dispara contra uno de ellos
- **THEN** los tres reciben daño

#### Scenario: Cada salto pega menos

- **GIVEN** un disparo encadenado que alcanza a dos enemigos idénticos
- **WHEN** se comparan los daños recibidos
- **THEN** el segundo enemigo ha recibido menos daño que el primero

#### Scenario: La cadena respeta el dominio de la torre

- **GIVEN** una torre que solo ataca a tierra, con cadena, un enemigo terrestre y uno aéreo juntos
- **WHEN** dispara contra el terrestre
- **THEN** el enemigo aéreo no recibe daño

#### Scenario: Un enemigo no se alcanza dos veces con el mismo disparo

- **GIVEN** una torre con cadena y dos enemigos juntos
- **WHEN** dispara
- **THEN** ninguno de los dos recibe más de un impacto de ese disparo

### Requirement: Fragilidad de los congelados

Una especialización de la torre de hielo SHALL hacer que los enemigos que
congela reciban más daño de **todas** las torres mientras dure la congelación,
no solo de la torre que los congeló. El multiplicador SHALL aplicarse antes que
la reducción por armadura.

#### Scenario: Otra torre aprovecha la fragilidad

- **GIVEN** un enemigo congelado por una torre de hielo con fragilidad
- **WHEN** otra torre distinta le dispara
- **THEN** recibe más daño del que recibiría sin la fragilidad

#### Scenario: Sin fragilidad la congelación no aumenta el daño

- **GIVEN** un enemigo congelado por una torre de hielo sin esa especialización
- **WHEN** otra torre le dispara
- **THEN** recibe el daño normal

#### Scenario: La fragilidad se acaba con la congelación

- **GIVEN** un enemigo que estuvo congelado por una torre con fragilidad
- **WHEN** la congelación termina y otra torre le dispara
- **THEN** recibe el daño normal

