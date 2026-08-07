# battlefield-map Specification

## Purpose
Define el escenario de juego: un prado con un camino sinuoso desde la entrada hasta la meta, y las reglas que determinan en qué parte del terreno se pueden construir torres y por dónde circulan los enemigos.
## Requirements
### Requirement: Prado con camino sinuoso

El mapa SHALL representarse como una rejilla de celdas con apariencia de prado, atravesada por un camino desde una celda de entrada hasta una celda de meta. El camino SHALL contener al menos cuatro cambios de dirección, de modo que los enemigos no recorran una línea recta entre entrada y meta.

#### Scenario: El camino tiene curvas

- **WHEN** se carga el mapa
- **THEN** el trazado del camino contiene al menos cuatro cambios de dirección entre la entrada y la meta

#### Scenario: Camino continuo

- **WHEN** se carga el mapa
- **THEN** cada celda del camino es adyacente en horizontal o vertical a la siguiente, sin saltos ni diagonales
- **AND** la primera celda es la entrada y la última es la meta

### Requirement: Construcción restringida al prado

Una torre SHALL poder colocarse únicamente sobre una celda de prado libre. El juego SHALL rechazar la colocación sobre celdas de camino, sobre la entrada, sobre la meta, sobre una celda ya ocupada por otra torre y sobre cualquier posición fuera de los límites del mapa. Un intento rechazado no SHALL descontar oro.

#### Scenario: Colocación válida sobre prado

- **GIVEN** el jugador tiene una torre seleccionada para comprar y oro suficiente
- **WHEN** pulsa sobre una celda de prado libre
- **THEN** la torre se coloca en esa celda y se descuenta su coste del oro

#### Scenario: Colocación sobre el camino rechazada

- **GIVEN** el jugador tiene una torre seleccionada para comprar
- **WHEN** pulsa sobre una celda que forma parte del camino
- **THEN** no se coloca ninguna torre y el oro no cambia

#### Scenario: Colocación sobre celda ocupada rechazada

- **GIVEN** ya existe una torre en una celda de prado
- **WHEN** el jugador intenta colocar otra torre en esa misma celda
- **THEN** no se coloca ninguna torre y el oro no cambia

#### Scenario: Colocación fuera del mapa rechazada

- **WHEN** el jugador pulsa en una posición que cae fuera de los límites de la rejilla
- **THEN** no se coloca ninguna torre y el oro no cambia

### Requirement: Recorrido de los enemigos

El mapa SHALL exponer una ruta de puntos de paso derivada del camino. Los enemigos terrestres SHALL seguir esa ruta celda a celda. Los enemigos aéreos SHALL seguir la misma secuencia de puntos de paso pero sin quedar limitados por el terreno, y SHALL representarse visualmente por encima del escenario.

#### Scenario: Enemigo terrestre sigue el camino

- **WHEN** un enemigo terrestre avanza
- **THEN** su posición permanece sobre celdas del camino hasta alcanzar la meta

#### Scenario: Enemigo aéreo sobrevuela el escenario

- **WHEN** un enemigo aéreo avanza
- **THEN** recorre la ruta hacia la meta y se dibuja por encima del terreno y de las torres

