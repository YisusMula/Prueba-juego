## ADDED Requirements

### Requirement: Enemigos acorazados

Un tipo de enemigo PUEDE tener armadura. La armadura SHALL restar una cantidad
fija al daño de cada impacto recibido desde una torre. El daño resultante SHALL
ser como mínimo 1, de modo que ninguna torre quede incapaz de matar a un enemigo.

El daño de las habilidades del comandante SHALL ignorar la armadura.

#### Scenario: La armadura reduce el daño de la torre

- **GIVEN** un enemigo con 6 de armadura
- **WHEN** recibe un impacto de 20 de daño desde una torre
- **THEN** pierde 14 puntos de vida

#### Scenario: La armadura nunca vuelve inmune al enemigo

- **GIVEN** un enemigo con 6 de armadura
- **WHEN** recibe un impacto de 2 de daño desde una torre
- **THEN** pierde 1 punto de vida

#### Scenario: Las habilidades atraviesan la armadura

- **GIVEN** un enemigo con 6 de armadura dentro del radio de un meteoro
- **WHEN** se lanza la habilidad
- **THEN** pierde el daño completo de la habilidad, sin reducción

#### Scenario: Un enemigo sin armadura recibe el daño íntegro

- **GIVEN** un enemigo sin armadura
- **WHEN** recibe un impacto de 20 de daño desde una torre
- **THEN** pierde 20 puntos de vida

### Requirement: Enemigos sanadores

Un tipo de enemigo PUEDE curar a los enemigos cercanos. Mientras viva, SHALL
restaurar vida por segundo a todos los enemigos vivos dentro de su radio de aura,
sin superar la vida máxima de cada uno. La cura no SHALL afectar a enemigos ya
eliminados ni al propio contador de fugas.

#### Scenario: El aura cura a los enemigos cercanos

- **GIVEN** un sanador vivo y un enemigo dañado dentro de su radio
- **WHEN** transcurre un segundo de simulación
- **THEN** el enemigo dañado ha recuperado vida

#### Scenario: La cura no supera la vida máxima

- **GIVEN** un sanador vivo y un enemigo intacto dentro de su radio
- **WHEN** transcurre un segundo de simulación
- **THEN** la vida del enemigo intacto sigue siendo su vida máxima

#### Scenario: Fuera del radio no hay cura

- **GIVEN** un sanador vivo y un enemigo dañado fuera de su radio
- **WHEN** transcurre un segundo de simulación
- **THEN** la vida del enemigo dañado no cambia

#### Scenario: Matar al sanador detiene la cura

- **GIVEN** un sanador y un enemigo dañado dentro de su radio
- **WHEN** el sanador es eliminado y transcurre un segundo
- **THEN** la vida del enemigo dañado no cambia

### Requirement: Enemigos que se dividen

Un tipo de enemigo PUEDE dividirse al morir. Al ser eliminado SHALL generar dos
enemigos de un tipo menor, situados en el punto donde murió y sobre la misma ruta
y la misma distancia recorrida que el padre. Las crías no SHALL dividirse a su
vez. Un divisor que llega a la meta no SHALL generar crías.

#### Scenario: Al morir deja dos crías

- **GIVEN** un enemigo divisor en el escenario
- **WHEN** es eliminado
- **THEN** aparecen dos enemigos del tipo menor
- **AND** ambos están en la misma posición en la que murió el divisor

#### Scenario: Las crías no vuelven a dividirse

- **GIVEN** una cría generada por un divisor
- **WHEN** es eliminada
- **THEN** no aparece ningún enemigo nuevo

#### Scenario: Un divisor que se fuga no deja crías

- **GIVEN** un enemigo divisor a punto de alcanzar la meta
- **WHEN** llega a la meta
- **THEN** resta una vida y no aparece ninguna cría

### Requirement: Criaturas nuevas del bestiario

El catálogo de criaturas SHALL incluir, además de las existentes, una criatura de
enjambre rápida, una acorazada ligera, una divisora, una sanadora y una acorazada
pesada. Cada una SHALL aparecer a partir de su propia oleada y SHALL mantenerse
en las oleadas posteriores.

#### Scenario: Cada criatura nueva tiene su oleada de entrada

- **WHEN** se consulta la composición de las oleadas en orden
- **THEN** cada criatura nueva aparece por primera vez en una oleada concreta
- **AND** sigue apareciendo en todas las oleadas posteriores

#### Scenario: La dificultad sigue creciendo

- **WHEN** se comparan dos oleadas consecutivas
- **THEN** la vida total de la segunda es mayor que la de la primera

### Requirement: Aviso de rasgos de la oleada

La descripción de una oleada SHALL indicar si trae criaturas acorazadas,
sanadoras o divisoras, además de las banderas ya existentes.

#### Scenario: El aviso señala la armadura

- **GIVEN** una oleada que incluye una criatura acorazada
- **WHEN** se consulta su descripción
- **THEN** la descripción indica que la oleada trae criaturas acorazadas

#### Scenario: El aviso señala al sanador

- **GIVEN** una oleada que incluye una criatura sanadora
- **WHEN** se consulta su descripción
- **THEN** la descripción indica que la oleada trae criaturas sanadoras

#### Scenario: Una oleada sin rasgos especiales no los anuncia

- **GIVEN** una oleada compuesta solo por criaturas sin rasgos especiales
- **WHEN** se consulta su descripción
- **THEN** ninguna de las banderas de rasgo está activa
