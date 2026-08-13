## ADDED Requirements

### Requirement: Composición consultable de una oleada

El sistema de oleadas SHALL permitir consultar la composición de cualquier oleada sin generarla: los tipos de criatura que la forman, cuántas hay de cada uno, y si incluye enemigos aéreos o enemigos capaces de dañar torres. Esta consulta NO SHALL alterar el estado de la partida.

#### Scenario: Consultar la próxima oleada no la genera

- **GIVEN** una partida en la pausa entre oleadas
- **WHEN** se consulta la composición de la oleada siguiente
- **THEN** se obtienen sus tipos y cantidades
- **AND** no aparece ningún enemigo nuevo en el escenario

#### Scenario: La consulta detecta amenazas aéreas

- **WHEN** se consulta una oleada que incluye criaturas voladoras
- **THEN** la consulta indica que la oleada trae enemigos aéreos

#### Scenario: La consulta detecta enemigos que dañan torres

- **WHEN** se consulta una oleada que incluye criaturas capaces de dañar torres
- **THEN** la consulta lo indica

### Requirement: Escalado por dificultad

La vida de los enemigos de una oleada SHALL escalarse además por el multiplicador de la dificultad elegida, sobre el escalado que ya aplica el número de oleada. El resto de la composición de la oleada (tipos y cantidades) SHALL ser la misma en todas las dificultades, de modo que la dificultad cambie la dureza y no el guion de la partida.

#### Scenario: La misma oleada es más dura en la dificultad alta

- **GIVEN** la misma oleada consultada en dos dificultades distintas
- **WHEN** se compara la vida total de sus enemigos
- **THEN** en la dificultad más alta es mayor

#### Scenario: La composición no cambia con la dificultad

- **GIVEN** la misma oleada consultada en dos dificultades distintas
- **WHEN** se comparan sus tipos de criatura y sus cantidades
- **THEN** son idénticos
