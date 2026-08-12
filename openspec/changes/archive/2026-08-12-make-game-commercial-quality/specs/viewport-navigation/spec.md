## ADDED Requirements

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
