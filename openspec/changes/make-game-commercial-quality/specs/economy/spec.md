## MODIFIED Requirements

### Requirement: Vidas del jugador

Toda partida SHALL comenzar con las vidas iniciales que defina la dificultad elegida. Las vidas SHALL disminuir en 1 por cada enemigo que alcance la meta y no SHALL aumentar por ningún medio. Las vidas nunca SHALL mostrarse por debajo de 0.

#### Scenario: Vidas iniciales

- **WHEN** comienza una partida nueva en la dificultad normal
- **THEN** el jugador tiene 20 vidas

#### Scenario: Las vidas iniciales dependen de la dificultad

- **WHEN** comienza una partida nueva
- **THEN** el jugador tiene exactamente las vidas iniciales definidas por la dificultad elegida

#### Scenario: Las vidas no bajan de cero

- **GIVEN** el jugador tiene 1 vida
- **WHEN** dos enemigos alcanzan la meta en el mismo instante
- **THEN** las vidas mostradas son 0 y la partida termina en derrota

### Requirement: Oro del jugador

Toda partida SHALL comenzar con el oro inicial que defina la dificultad elegida. El oro SHALL aumentar al eliminar enemigos (con la recompensa propia del tipo eliminado), al vender una torre y al llamar a una oleada antes de tiempo, y SHALL disminuir al comprar una torre, al mejorarla o al repararla. El oro nunca SHALL quedar en negativo: cualquier gasto que dejaría el saldo negativo SHALL rechazarse sin efecto.

#### Scenario: Oro inicial

- **WHEN** comienza una partida nueva
- **THEN** el jugador dispone del oro inicial definido por la dificultad elegida

#### Scenario: El oro no queda en negativo

- **GIVEN** el jugador tiene 10 de oro
- **WHEN** intenta una compra, mejora o reparación de coste 50
- **THEN** la acción se rechaza y el oro sigue siendo 10

#### Scenario: Los enemigos que se escapan no dan oro

- **GIVEN** el jugador tiene 100 de oro
- **WHEN** un enemigo alcanza la meta
- **THEN** el oro sigue siendo 100

## ADDED Requirements

### Requirement: Reembolso por vender una torre

Vender una torre SHALL devolver al jugador una fracción fija de todo el oro invertido en ella, contando su compra y todas sus mejoras. El reembolso SHALL ser estrictamente menor que lo invertido, de modo que vender nunca sea una forma de ganar oro. La torre vendida SHALL desaparecer del escenario y su celda SHALL quedar libre para volver a construir.

#### Scenario: Vender devuelve parte de lo invertido

- **GIVEN** una torre en la que el jugador ha invertido 100 de oro entre compra y mejoras
- **WHEN** la vende
- **THEN** recibe un reembolso mayor que 0 y menor que 100

#### Scenario: Vender libera la celda

- **GIVEN** una torre colocada en una celda de prado
- **WHEN** el jugador la vende
- **THEN** la torre desaparece y esa celda vuelve a admitir una torre nueva

#### Scenario: Las mejoras cuentan en el reembolso

- **GIVEN** dos torres iguales, una sin mejorar y otra mejorada varias veces
- **WHEN** se venden ambas
- **THEN** la mejorada devuelve más oro que la que no se mejoró

### Requirement: Bonus por llamar a la oleada antes de tiempo

Cuando el jugador llame a la siguiente oleada durante la pausa de preparación, SHALL recibir oro extra proporcional al tiempo de preparación al que renuncia: cuanto antes la llame, mayor el bonus. Llamar a la oleada cuando no hay ninguna pendiente de empezar NO SHALL otorgar oro.

#### Scenario: Llamar antes da más oro que llamar tarde

- **GIVEN** dos partidas idénticas en la pausa entre oleadas
- **WHEN** en una se llama a la oleada nada más empezar la pausa y en la otra casi al final
- **THEN** la primera recibe más oro de bonus que la segunda

#### Scenario: Llamar a la oleada la arranca de inmediato

- **GIVEN** la partida está en la pausa de preparación entre oleadas
- **WHEN** el jugador llama a la siguiente oleada
- **THEN** la oleada empieza a generar enemigos sin esperar al resto de la pausa

#### Scenario: No se puede llamar a una oleada ya en marcha

- **GIVEN** una oleada que ya está generando enemigos
- **WHEN** el jugador intenta llamarla
- **THEN** la acción se rechaza y el oro no cambia
