## ADDED Requirements

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
