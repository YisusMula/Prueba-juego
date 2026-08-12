# wave-system Specification

## Purpose
Define cómo llegan los enemigos al escenario: la composición y progresión de las oleadas, los tipos de criatura (terrestre y aérea) con sus atributos, y qué ocurre cuando un enemigo muere o alcanza la meta.
## Requirements
### Requirement: Progresión de oleadas

El juego SHALL avanzar por oleadas numeradas empezando en la 1. Cada oleada SHALL generar un conjunto definido de enemigos separados por un intervalo de aparición. Una oleada SHALL considerarse terminada cuando todos sus enemigos han muerto o han alcanzado la meta; entonces el juego SHALL preparar la siguiente oleada tras una pausa entre oleadas. Las oleadas SHALL ser progresivamente más difíciles: a mayor número de oleada, más enemigos, más resistentes y más rápidos.

#### Scenario: Aparición escalonada

- **WHEN** comienza una oleada
- **THEN** sus enemigos aparecen en la entrada de uno en uno, separados por el intervalo de aparición de esa oleada

#### Scenario: Fin de oleada

- **GIVEN** todos los enemigos de la oleada actual han muerto o han llegado a la meta
- **WHEN** transcurre la pausa entre oleadas
- **THEN** el contador de oleada aumenta en 1 y comienza la siguiente oleada

#### Scenario: Dificultad creciente

- **WHEN** se comparan dos oleadas cualesquiera
- **THEN** la de número mayor tiene una vida total de enemigos igual o superior a la de número menor, y estrictamente superior cada varias oleadas

#### Scenario: Aparición de enemigos aéreos

- **WHEN** el juego alcanza la oleada en la que se introducen las criaturas aéreas
- **THEN** la oleada incluye al menos un enemigo de tipo aéreo

#### Scenario: Los enemigos son cada vez más rápidos

- **WHEN** se comparan la velocidad de generación de un mismo tipo de enemigo en dos oleadas cualesquiera
- **THEN** la velocidad en la oleada de número mayor es igual o superior a la de la oleada de número menor

### Requirement: Tipos de enemigo

Cada enemigo SHALL tener un tipo con: dominio (terrestre o aéreo), puntos de vida, velocidad de avance y recompensa de oro. El bestiario SHALL seguir una progresión temática reconocible por tamaño y amenaza:

- terrestres, de menor a mayor: **rata** (básica, numerosa), **zorro** (rápida), **perro** (intermedia), **jabalí** (resistente, embiste torres);
- aéreas, de menor a mayor: **murciélago** (básica), **águila** (rápida y resistente), **buitre** (embiste torres);
- gama alta: **goblin** (puede abandonar el camino a partir de cierta oleada), **orco** (resistente, embiste torres) y un **jefe orco** como enemigo de oleada especial, que embiste torres.

Los enemigos aéreos SHALL ser objetivo válido únicamente para torres capaces de atacar al aire. Cada tipo SHALL declarar si es capaz de dañar torres al pasar cerca y si es capaz de abandonar el camino; estas capacidades SHALL introducirse solo a partir de la oleada correspondiente a cada tipo, nunca desde la oleada 1.

#### Scenario: Enemigo con atributos propios

- **WHEN** se genera un enemigo de un tipo concreto
- **THEN** recibe los puntos de vida, la velocidad y la recompensa definidos para ese tipo

#### Scenario: Progresión de resistencia terrestre

- **WHEN** se comparan la rata, el perro y el jabalí
- **THEN** cada uno tiene más puntos de vida y menor o igual velocidad que el anterior en esa progresión

#### Scenario: Enemigo resistente frente a rápido

- **WHEN** se comparan el jabalí (resistente) y el zorro (rápido)
- **THEN** el jabalí tiene más puntos de vida y menor velocidad que el zorro

#### Scenario: Progresión de resistencia aérea

- **WHEN** se comparan el murciélago, el águila y el buitre
- **THEN** cada uno tiene más puntos de vida que el anterior en esa progresión

#### Scenario: Solo la gama alta amenaza a las torres o abandona el camino

- **WHEN** se consulta la capacidad de dañar torres o de abandonar el camino de la rata, el zorro, el perro, el murciélago y el águila
- **THEN** ninguno de esos tipos tiene ninguna de las dos capacidades

### Requirement: Muerte de un enemigo

Cuando los puntos de vida de un enemigo lleguen a 0 o menos, el enemigo SHALL retirarse del escenario y el jugador SHALL recibir la recompensa de oro correspondiente a su tipo. Un enemigo muerto no SHALL restar vidas.

#### Scenario: Enemigo eliminado otorga oro

- **GIVEN** un enemigo cuya recompensa es 15 de oro
- **WHEN** recibe daño suficiente para dejar sus puntos de vida en 0 o menos
- **THEN** desaparece del escenario y el oro del jugador aumenta en 15
- **AND** las vidas del jugador no cambian

#### Scenario: Recompensas distintas por tipo

- **WHEN** se eliminan enemigos de tipos distintos
- **THEN** cada uno otorga la cantidad de oro definida para su propio tipo

### Requirement: Enemigo que alcanza la meta

Cuando un enemigo alcance la celda de meta, SHALL retirarse del escenario, SHALL restar exactamente una vida al jugador y NO SHALL otorgar oro, con independencia de su tipo, de la vida que le quedara o de si ha seguido el camino o lo ha abandonado.

#### Scenario: Fuga resta una vida

- **GIVEN** el jugador tiene 20 vidas y 100 de oro
- **WHEN** un enemigo alcanza la meta
- **THEN** el jugador pasa a tener 19 vidas
- **AND** el oro sigue siendo 100

#### Scenario: Varias fugas restan una vida cada una

- **GIVEN** el jugador tiene 20 vidas
- **WHEN** tres enemigos alcanzan la meta
- **THEN** el jugador pasa a tener 17 vidas

### Requirement: Enemigos que abandonan el camino

A partir de la oleada en la que se introduce esa capacidad, los tipos de enemigo que la posean SHALL poder abandonar el trazado del camino en algún punto de su recorrido y continuar en línea recta a través del prado hasta la meta, en lugar de seguir el resto del trazado. Un enemigo que abandona el camino SHALL seguir avanzando a su velocidad y SHALL seguir siendo objetivo legítimo de las torres mientras cruza el prado.

#### Scenario: Un enemigo capaz abandona el trazado

- **GIVEN** un enemigo de un tipo capaz de abandonar el camino, generado en una oleada igual o posterior a la que introduce esa capacidad
- **WHEN** alcanza el punto de su recorrido en el que abandona el trazado
- **THEN** su posición deja de corresponder a una celda de camino y avanza en línea recta hacia la meta

#### Scenario: Antes de esa oleada nadie abandona el camino

- **GIVEN** una oleada anterior a la que introduce la capacidad de abandonar el camino
- **WHEN** se genera cualquiera de sus enemigos
- **THEN** ninguno abandona el trazado; todos siguen el camino hasta la meta

#### Scenario: Un enemigo fuera de camino sigue siendo objetivo válido

- **GIVEN** un enemigo que ha abandonado el camino y está dentro del alcance de una torre compatible con su dominio
- **WHEN** la torre busca objetivo
- **THEN** lo considera un candidato válido igual que si siguiera sobre el camino

### Requirement: Enemigos que dañan torres

A partir de la oleada en la que se introduce esa capacidad, los tipos de enemigo que la posean SHALL infligir daño a una torre cuando su posición quede dentro del alcance de golpe de esa torre. Al entrar en ese alcance, el enemigo SHALL detenerse brevemente mientras inflige el daño y después SHALL reanudar su avance.

#### Scenario: Un enemigo capaz daña una torre cercana

- **GIVEN** una torre colocada y un enemigo de un tipo capaz de dañar torres, generado en una oleada igual o posterior a la que introduce esa capacidad
- **WHEN** el enemigo entra en el alcance de golpe de la torre
- **THEN** la estructura de la torre disminuye

#### Scenario: Antes de esa oleada nadie daña torres

- **GIVEN** una oleada anterior a la que introduce la capacidad de dañar torres
- **WHEN** cualquiera de sus enemigos pasa junto a una torre
- **THEN** la estructura de la torre no cambia

#### Scenario: El enemigo reanuda su avance tras el golpe

- **GIVEN** un enemigo que ha terminado de golpear una torre
- **WHEN** transcurre el tiempo del golpe
- **THEN** el enemigo continúa avanzando hacia la meta

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

