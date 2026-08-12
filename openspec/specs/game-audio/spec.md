# game-audio Specification

## Purpose
Da retorno sonoro a las acciones del juego —disparos, impactos, muertes, fugas, construcción y final de partida— mediante síntesis en el navegador, sin ficheros de audio, y permite al jugador silenciarlo de forma permanente.
## Requirements
### Requirement: Efectos de sonido de los eventos del juego

El juego SHALL emitir un efecto de sonido distinguible para, al menos: el disparo de una torre, el impacto sobre un enemigo, la muerte de un enemigo, la llegada de un enemigo a la meta, la construcción de una torre, la mejora de una torre, el uso de una habilidad, la victoria y la derrota. Los sonidos SHALL generarse por síntesis en el propio navegador, sin descargar ningún recurso externo.

#### Scenario: Los eventos suenan distinto entre sí

- **WHEN** se comparan los sonidos de disparo, muerte y fuga
- **THEN** cada uno tiene sus propios parámetros de síntesis y no son idénticos

#### Scenario: El sonido no descarga recursos externos

- **WHEN** el juego reproduce cualquiera de sus efectos
- **THEN** no se solicita ningún fichero de audio a la red

### Requirement: Silencio persistente

El jugador SHALL poder silenciar y reactivar el sonido en cualquier momento desde la interfaz. Con el sonido silenciado NO SHALL emitirse ningún efecto. La preferencia SHALL conservarse entre sesiones, y si el almacenamiento no está disponible el juego SHALL seguir funcionando con el sonido activado.

#### Scenario: Silenciar detiene todos los efectos

- **GIVEN** el sonido está silenciado
- **WHEN** ocurre cualquier evento sonoro del juego
- **THEN** no se emite ningún sonido

#### Scenario: La preferencia sobrevive a recargar la página

- **GIVEN** el jugador ha silenciado el sonido
- **WHEN** vuelve a abrir el juego más tarde
- **THEN** el sonido sigue silenciado

### Requirement: Arranque del audio conforme a las políticas del navegador

El motor de audio NO SHALL intentar sonar antes de la primera interacción del jugador, porque los navegadores bloquean la reproducción automática. SHALL inicializarse en la primera interacción y, si el navegador no soporta la síntesis de audio, el juego SHALL seguir siendo plenamente jugable sin sonido.

#### Scenario: Sin soporte de audio el juego sigue funcionando

- **GIVEN** un navegador sin soporte para la síntesis de audio
- **WHEN** el jugador juega una partida completa
- **THEN** la partida transcurre con normalidad y no se produce ningún error

#### Scenario: No suena nada antes de interactuar

- **WHEN** la página acaba de cargarse y el jugador no ha interactuado todavía
- **THEN** el juego no intenta reproducir ningún sonido

