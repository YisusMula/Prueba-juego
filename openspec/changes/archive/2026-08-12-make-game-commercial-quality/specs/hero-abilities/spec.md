## Purpose

Da al jugador una vía de intervención directa durante la batalla, más allá de construir y esperar, mediante habilidades activas con recarga que permiten responder a una oleada que se está torciendo.

## ADDED Requirements

### Requirement: Catálogo de habilidades

El juego SHALL ofrecer al menos dos habilidades activas: un **meteoro** que inflige daño en área en el punto que el jugador señale del escenario, y una **ventisca** que congela a todos los enemigos presentes. Cada habilidad SHALL declarar su tiempo de recarga y si necesita que el jugador señale un punto del escenario o se activa de inmediato.

#### Scenario: El meteoro daña en área

- **GIVEN** varios enemigos agrupados en una zona del escenario
- **WHEN** el jugador lanza el meteoro sobre esa zona
- **THEN** todos los enemigos dentro del radio del meteoro reciben daño

#### Scenario: La ventisca congela a todos

- **GIVEN** varios enemigos repartidos por el escenario
- **WHEN** el jugador lanza la ventisca
- **THEN** todos ellos quedan congelados durante el tiempo del efecto

#### Scenario: El meteoro alcanza a enemigos aéreos y terrestres

- **GIVEN** un enemigo aéreo y uno terrestre dentro del radio del meteoro
- **WHEN** el meteoro impacta
- **THEN** ambos reciben daño

### Requirement: Recarga de habilidades

Cada habilidad SHALL quedar en recarga tras usarse y NO SHALL poder volver a usarse hasta que su recarga termine. La recarga SHALL avanzar con el tiempo de simulación, de modo que no progrese mientras la partida está en pausa. Una habilidad SHALL empezar la partida lista para usarse.

#### Scenario: Una habilidad recién usada no se puede repetir

- **GIVEN** una habilidad que se acaba de lanzar
- **WHEN** el jugador intenta lanzarla otra vez de inmediato
- **THEN** la acción se rechaza y no se produce ningún efecto

#### Scenario: La habilidad vuelve a estar lista al terminar su recarga

- **GIVEN** una habilidad en recarga
- **WHEN** transcurre su tiempo de recarga
- **THEN** la habilidad vuelve a poder usarse

#### Scenario: La recarga no avanza en pausa

- **GIVEN** una habilidad en recarga
- **WHEN** la partida permanece en pausa un tiempo
- **THEN** la recarga restante no ha disminuido

#### Scenario: Las habilidades empiezan disponibles

- **WHEN** comienza una partida nueva
- **THEN** todas las habilidades están listas para usarse

### Requirement: Apuntado de las habilidades dirigidas

Cuando el jugador selecciona una habilidad que necesita objetivo, el juego SHALL entrar en modo de apuntado: la siguiente pulsación sobre el escenario SHALL lanzar la habilidad en ese punto en lugar de colocar o seleccionar torres. El jugador SHALL poder cancelar el apuntado sin gastar la habilidad. Mientras se apunta, SHALL mostrarse una previsualización del área afectada.

#### Scenario: Apuntar y lanzar

- **GIVEN** el jugador ha seleccionado el meteoro
- **WHEN** pulsa sobre un punto del escenario
- **THEN** el meteoro se lanza en ese punto y la habilidad entra en recarga

#### Scenario: Apuntar no coloca torres

- **GIVEN** el jugador tiene una torre elegida en la tienda y selecciona el meteoro
- **WHEN** pulsa sobre una celda de prado válida
- **THEN** se lanza el meteoro y no se coloca ninguna torre

#### Scenario: Cancelar el apuntado

- **GIVEN** el jugador ha seleccionado una habilidad dirigida
- **WHEN** cancela el apuntado
- **THEN** la habilidad sigue disponible y no ha entrado en recarga

### Requirement: Habilidades solo durante la partida

Las habilidades SHALL poder usarse únicamente con la partida en curso. En el menú principal, en pausa, tras la derrota o tras la victoria, cualquier intento de usarlas SHALL rechazarse sin efecto.

#### Scenario: No se pueden usar habilidades con la partida terminada

- **GIVEN** la partida ha terminado en derrota o en victoria
- **WHEN** el jugador intenta lanzar una habilidad
- **THEN** la acción se rechaza y no se produce ningún efecto
