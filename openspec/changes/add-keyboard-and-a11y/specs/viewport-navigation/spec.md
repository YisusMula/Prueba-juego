## ADDED Requirements

### Requirement: La vista sigue al cursor de teclado

Cuando el cursor de teclado quede fuera del área visible, la cámara SHALL
desplazarse lo justo para que esa celda entre en pantalla, en lugar de centrarse
en ella: centrar en cada pulsación haría saltar el escenario a cada flecha.

Si la celda ya está visible, la cámara no SHALL moverse.

#### Scenario: Salir de la vista arrastra la cámara

- **GIVEN** el cursor en el borde del área visible
- **WHEN** el jugador lo mueve fuera de ella
- **THEN** la cámara se desplaza y la celda queda visible

#### Scenario: Dentro de la vista la cámara no se mueve

- **GIVEN** el cursor en el centro del área visible
- **WHEN** el jugador lo mueve una celda
- **THEN** la cámara no cambia
