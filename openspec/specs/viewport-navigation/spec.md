# viewport-navigation Specification

## Purpose
Permite jugar cómodamente en pantallas de cualquier tamaño mediante un lienzo que se adapta al dispositivo y una cámara que el jugador puede desplazar y acercar con ratón o con los dedos.
## Requirements
### Requirement: Lienzo adaptable

El área de juego SHALL ocupar el espacio disponible entre el HUD superior y la barra inferior, y SHALL redimensionarse cuando cambie el tamaño de la ventana o la orientación del dispositivo, manteniendo la escena nítida en pantallas de alta densidad y sin deformar las proporciones del escenario.

#### Scenario: Cambio de tamaño de ventana

- **WHEN** el jugador redimensiona la ventana o rota el dispositivo
- **THEN** el lienzo se ajusta al nuevo espacio disponible y la escena se sigue viendo sin deformación

### Requirement: Desplazamiento de la cámara

El jugador SHALL poder desplazar la vista del escenario arrastrando sobre el área de juego (con el ratón o con un dedo). La cámara SHALL mantenerse dentro de los límites del mapa, sin permitir desplazarse a zonas vacías más allá del escenario.

#### Scenario: Arrastre con el dedo

- **WHEN** el jugador arrastra un dedo sobre el área de juego
- **THEN** la vista se desplaza siguiendo el movimiento

#### Scenario: Límites de la cámara

- **WHEN** el jugador intenta desplazar la vista más allá del borde del mapa
- **THEN** la cámara se detiene en el borde y no muestra espacio vacío fuera del escenario

#### Scenario: Un arrastre no coloca torre

- **GIVEN** una torre seleccionada para comprar
- **WHEN** el jugador arrastra la vista y suelta
- **THEN** la vista se desplaza y no se coloca ninguna torre

#### Scenario: Una pulsación sin arrastre sí actúa

- **GIVEN** una torre seleccionada para comprar
- **WHEN** el jugador pulsa y suelta en el mismo punto, sin arrastrar
- **THEN** la acción se interpreta como colocación en esa celda

### Requirement: Zoom de la cámara

El jugador SHALL poder acercar y alejar la vista mediante la rueda del ratón, un gesto de pellizco con dos dedos o los controles de zoom en pantalla. El zoom SHALL estar acotado entre un mínimo que muestre el mapa completo y un máximo definido, y SHALL mantener aproximadamente fijo el punto del escenario bajo el cursor o el centro del pellizco.

#### Scenario: Zoom con rueda del ratón

- **WHEN** el jugador gira la rueda del ratón sobre el área de juego
- **THEN** la vista se acerca o se aleja dentro de los límites de zoom permitidos

#### Scenario: Zoom con pellizco

- **WHEN** el jugador junta o separa dos dedos sobre el área de juego
- **THEN** la vista se aleja o se acerca proporcionalmente al gesto

#### Scenario: Límites de zoom

- **WHEN** el jugador intenta alejar más allá del zoom mínimo
- **THEN** el nivel de zoom se detiene en el mínimo y el mapa completo permanece visible

### Requirement: Coordenadas de pantalla a escenario

Toda interacción del jugador con el área de juego SHALL traducirse a coordenadas del escenario teniendo en cuenta el desplazamiento y el zoom actuales de la cámara, de modo que la celda afectada sea siempre la que se encuentra bajo el dedo o el cursor.

#### Scenario: Colocación tras desplazar y hacer zoom

- **GIVEN** el jugador ha desplazado la cámara y ha aplicado zoom
- **WHEN** pulsa sobre una celda de prado visible
- **THEN** la torre se coloca en esa misma celda y no en otra

### Requirement: Aviso de enemigos fuera de la vista

Cuando haya enemigos vivos fuera del área visible, el juego SHALL indicarlo en el borde de la pantalla en la dirección en la que se encuentran, para que desplazar el mapa no obligue al jugador a vigilar a ciegas lo que queda fuera de cuadro. Si no hay ningún enemigo fuera de la vista, NO SHALL mostrarse ningún aviso.

#### Scenario: Se avisa de un enemigo fuera de cuadro

- **GIVEN** un enemigo vivo fuera del área visible
- **WHEN** se dibuja la escena
- **THEN** aparece un indicador en el borde de la pantalla, en la dirección de ese enemigo

#### Scenario: Sin enemigos fuera de cuadro no hay aviso

- **GIVEN** todos los enemigos vivos dentro del área visible
- **WHEN** se dibuja la escena
- **THEN** no se muestra ningún indicador de borde

#### Scenario: El aviso desaparece al encuadrar al enemigo

- **GIVEN** un indicador de borde por un enemigo fuera de cuadro
- **WHEN** el jugador desplaza la cámara hasta dejarlo dentro del área visible
- **THEN** ese indicador deja de mostrarse

