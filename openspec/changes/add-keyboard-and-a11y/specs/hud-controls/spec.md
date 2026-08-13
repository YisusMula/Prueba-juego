## ADDED Requirements

### Requirement: Colocar torres con el teclado

El juego SHALL ofrecer un cursor de celda manejable con las flechas del teclado.
El cursor SHALL aparecer al usarse por primera vez y SHALL dibujarse resaltando
la celda sobre la que está.

`Enter` y `Espacio` sobre el cursor SHALL producir el **mismo efecto que un
toque** en el centro de esa celda: colocar la torre elegida, seleccionar una ya
colocada o lanzar la habilidad que se esté apuntando.

El cursor no SHALL poder salir de los límites del mapa.

Los atajos de teclado del juego —incluidos los del cursor— no SHALL actuar
mientras el foco esté sobre un control que ya responde al teclado. `Enter` y
`Espacio` son la forma estándar de activar un botón, y cancelarlos dejaría toda
la interfaz inservible para quien navega con el tabulador.

#### Scenario: Las flechas mueven el cursor

- **GIVEN** una partida en curso
- **WHEN** el jugador pulsa una flecha
- **THEN** el cursor aparece y se desplaza una celda en esa dirección

#### Scenario: El cursor no sale del mapa

- **GIVEN** el cursor en el borde del mapa
- **WHEN** el jugador pulsa la flecha que apunta hacia fuera
- **THEN** el cursor permanece en la misma celda

#### Scenario: Confirmar coloca la torre elegida

- **GIVEN** una torre elegida en la barra de compra y el cursor sobre prado libre
- **WHEN** el jugador confirma con el teclado
- **THEN** la torre se coloca en esa celda

#### Scenario: Confirmar sobre una torre la selecciona

- **GIVEN** el cursor sobre una torre ya colocada y ninguna torre elegida en la barra
- **WHEN** el jugador confirma con el teclado
- **THEN** esa torre queda seleccionada y se muestra su panel

#### Scenario: Con el foco en un botón, la tecla es del botón

- **GIVEN** el foco sobre un botón de la barra de compra
- **WHEN** el jugador pulsa Enter o Espacio
- **THEN** se activa ese botón
- **AND** no se actúa sobre la celda del cursor

#### Scenario: Confirmar sobre el camino no coloca nada

- **GIVEN** una torre elegida y el cursor sobre una celda de camino
- **WHEN** el jugador confirma con el teclado
- **THEN** no se coloca ninguna torre y el oro no cambia

### Requirement: Anuncios para lectores de pantalla

El juego SHALL disponer de una región de anuncios que comunique los hechos que
un jugador vidente capta de un vistazo: el comienzo de cada oleada, la pérdida
de una vida y el final de la partida.

Los anuncios SHALL ser hechos discretos, no un volcado del estado: la región no
SHALL actualizarse en cada fotograma. SHALL usar una cortesía que no interrumpa
lo que el lector esté leyendo.

#### Scenario: Se anuncia el comienzo de una oleada

- **GIVEN** una partida en la pausa de preparación
- **WHEN** arranca la oleada siguiente
- **THEN** la región de anuncios comunica qué oleada empieza

#### Scenario: Se anuncia perder una vida

- **GIVEN** una partida en curso
- **WHEN** una criatura llega al castillo
- **THEN** la región de anuncios comunica que se ha perdido una vida y cuántas quedan

#### Scenario: Se anuncia el final de la partida

- **WHEN** la partida termina en victoria o en derrota
- **THEN** la región de anuncios lo comunica

#### Scenario: La región no repite lo mismo sin parar

- **GIVEN** una partida en curso sin hechos nuevos
- **WHEN** pasan varios fotogramas
- **THEN** el contenido de la región de anuncios no cambia
