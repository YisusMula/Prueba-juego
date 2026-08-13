## MODIFIED Requirements

### Requirement: Previsualización de la próxima oleada

Durante la pausa de preparación, el HUD SHALL mostrar de qué se compone la oleada que viene: los tipos de criatura y cuántas de cada una. SHALL destacar de forma visible si la oleada incluye enemigos aéreos, enemigos capaces de dañar torres, enemigos acorazados, enemigos sanadores o enemigos que se dividen al morir, para que el jugador pueda prepararse.

#### Scenario: La previsualización enumera la composición

- **GIVEN** la partida está en la pausa entre oleadas
- **WHEN** se muestra la previsualización
- **THEN** indica los tipos de criatura de la próxima oleada y cuántas hay de cada uno

#### Scenario: Se avisa de las amenazas especiales

- **GIVEN** una próxima oleada que incluye enemigos aéreos
- **WHEN** se muestra la previsualización
- **THEN** se señala de forma destacada que vienen enemigos aéreos

#### Scenario: Se avisa de los rasgos del bestiario

- **GIVEN** una próxima oleada que incluye enemigos acorazados
- **WHEN** se muestra la previsualización
- **THEN** se señala de forma destacada que vienen enemigos acorazados

## ADDED Requirements

### Requirement: Rasgos del enemigo visibles en la interfaz

La interfaz SHALL permitir al jugador conocer los rasgos de un enemigo antes de
tener que reaccionar a ellos. La barra de vida de un enemigo acorazado SHALL
distinguirse de la de uno sin armadura, y un enemigo sanador SHALL mostrar de
forma visible el alcance de su aura.

#### Scenario: Un acorazado se distingue a simple vista

- **WHEN** se dibuja un enemigo con armadura
- **THEN** su representación lo distingue de un enemigo sin armadura

#### Scenario: El aura del sanador es visible

- **WHEN** se dibuja un enemigo sanador
- **THEN** se representa el alcance de su aura de sanación
