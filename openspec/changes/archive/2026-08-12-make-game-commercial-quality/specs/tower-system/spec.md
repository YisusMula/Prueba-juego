## MODIFIED Requirements

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

## ADDED Requirements

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
