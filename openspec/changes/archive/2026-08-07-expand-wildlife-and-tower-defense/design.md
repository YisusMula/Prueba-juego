## Context

El juego base (`add-tower-defense-game`) ya está desplegado y jugado de verdad. La partida real reveló un problema de balance concreto: en oleadas avanzadas el jugador acumula más oro del que puede gastar (torres al nivel máximo, mapa lleno), lo que quita tensión al juego. El bestiario también resultaba genérico. Esta iteración añade contenido y dos sumideros de oro nuevos —reparación y niveles de mejora ampliados— que nacen directamente de una mecánica de juego (torres dañables) en vez de ser un simple ajuste de números.

Restricciones que se mantienen del diseño original: `src/game/` sigue siendo simulación pura sin DOM ni canvas; catálogos de datos en vez de lógica dispersa; todo se sigue verificando con Vitest en Node y con una comprobación de balance simulando partidas completas.

## Goals / Non-Goals

**Goals:**

- Bestiario con progresión reconocible (rata → zorro/perro/jabalí; murciélago → águila/buitre; goblin/orco/jefe orco en la gama alta), manteniendo el catálogo como datos.
- Dos mecánicas de amenaza nuevas —enemigos que abandonan el camino y enemigos que dañan torres— implementadas sin pathfinding: la primera como interpolación en línea recta, la segunda como una zona de golpe pasiva.
- Reparación de torres como acción de jugador con su propio coste, y estructura de torre como recurso independiente del nivel.
- Dos torres nuevas (mágica, hielo) que amplíen el espacio táctico sin reescribir el bucle de disparo existente.
- Verificar el nuevo equilibrio con la misma simulación de partidas ya usada en `tests/balance.test.ts`, ajustada al nuevo bestiario.

**Non-Goals:**

- Pathfinding real para los enemigos que abandonan el camino: no rodean torres ni terreno, cruzan en línea recta.
- Destrucción permanente de una torre: llegar a 0 de estructura la desactiva, nunca la elimina del mapa.
- Reequilibrar el mapa o añadir mapas nuevos.
- Sonido, animaciones de "muerte" elaboradas para los nuevos enemigos más allá del estilo procedural ya existente.

## Decisions

### El bestiario reemplaza, no coexiste

**Decisión**: se eliminan los identificadores `grunt`, `runner`, `brute` y `warlord` del catálogo y se sustituyen por `rat`, `fox`, `dog`, `boar`, `bat` (retunado), `eagle`, `vulture`, `goblin`, `orc`, `warlord` (reskinado como jefe orco, conserva el id por ser ya un enemigo de oleada especial).

**Motivo**: el pedido es una progresión temática completa, no una ampliación del catálogo anterior; mantener los tipos viejos en paralelo duplicaría conceptos (dos "básicos terrestres", dos "resistentes") sin aportar nada. Es un cambio **BREAKING** ya declarado en la propuesta.

**Impacto en tests**: toda la suite que referencia esos ids por nombre debe actualizarse. Se hace explícito en las tareas.

### Enemigos que abandonan el camino: interpolación en línea recta, no pathfinding

**Decisión**: cada enemigo capaz de esta habilidad recibe, al generarse, una distancia de "punto de fuga" derivada de forma determinista de su id (`0.2 + (id % 7) / 7 * 0.4` del recorrido total). Al alcanzar esa distancia sobre la polilínea del camino dejan de usar `positionAtDistance` y pasan a interpolar en línea recta desde su posición de fuga hasta el punto de meta, a la misma velocidad.

**Motivo**: el juego no tiene ni necesita un sistema de navegación; las torres nunca bloquean el paso (son objetivos, no obstáculos), así que cruzar el prado en línea recta hacia la meta es tan válido como seguir el camino y no exige resolver colisiones con el terreno. Derivar el punto de fuga del id en vez de un número aleatorio real mantiene la simulación determinista y las pruebas reproducibles, con variedad suficiente entre enemigos de la misma oleada.

**Alternativa descartada**: A* sobre la rejilla. Correcto pero muy por encima de lo que pide la funcionalidad ("cruzar el prado", no "esquivar torres inteligentemente").

### Daño a torres: zona de golpe pasiva con pausa, no un enemigo que ataca activamente

**Decisión**: los tipos con `canDamageTowers` llevan `meleeRange`, `meleeDps` y `meleeDuration`. En cada paso de simulación, si el enemigo no está ya golpeando algo, se busca una torre viva dentro de `meleeRange` de su posición actual; si la hay, el enemigo se congela (velocidad efectiva 0) durante `meleeDuration` mientras se resta `meleeDps · dt` a la estructura de esa torre. Al terminar la pausa, el enemigo reanuda su avance normal.

**Motivo**: como el enemigo se aleja de la zona de golpe en cuanto retoma el movimiento, y el alcance es pequeño (del orden de una celda), no hace falta llevar un registro de "torres ya golpeadas por este enemigo" para evitar que se enganche en bucle: al reanudar la marcha sale del alcance en un instante. Este diseño reutiliza el mismo patrón que ya existe para la adquisición de objetivo de las torres (buscar el candidato más cercano dentro de un radio), así que no introduce un concepto nuevo en la simulación.

**Por qué también con enemigos que siguen el camino**: el ancho del camino y el de una celda de prado hacen que una torre en la celda adyacente al camino ya caiga dentro de un alcance de golpe razonable (~50–60 px). No hace falta que el enemigo abandone el camino para amenazar una torre cercana; los que sí lo abandonan (jabalí, buitre, orco no llevan esta combinación salvo el jefe orco) simplemente tienen más probabilidad de pasar cerca de más torres.

### Estructura de la torre: recurso independiente del nivel, con reparación a máximo

**Decisión**: cada torre tiene `hp` y `maxHp` (calculado por tipo y nivel, igual que el resto de estadísticas). Con `hp <= 0` la torre no participa en la adquisición de objetivo (no dispara). Reparar es una acción binaria: cuesta oro proporcional al daño acumulado y siempre restaura al máximo, sin estados intermedios.

**Motivo**: un sistema de "cuanta menos estructura, menos daño hace" añadiría una curva de degradación a comunicar en la interfaz sin que el pedido lo exija; "deja de disparar / se repara y vuelve a funcionar" es la lectura más simple para el jugador y ya se apoya en un patrón que el juego usa en todas partes (algo funciona o no funciona, sin grises): igual que el oro insuficiente bloquea una acción entera en vez de degradarla.

### Torre de hielo: contador de objetivos congelados propio de cada torre

**Decisión**: cada torre de hielo lleva `frozenTargets: number[]`, la lista de ids de enemigos que ella misma mantiene congelados. Al impactar, si el objetivo ya está en esa lista se refresca el temporizador de congelación sin coste de cupo; si no está y `frozenTargets.length` es menor que el límite del nivel actual, se añade y se congela; si el cupo está lleno, el impacto solo aplica su daño (bajo) sin efecto de control. La lista se depura en cada paso quitando ids cuyo temporizador de congelación ya haya expirado o que ya no estén vivos.

**Motivo**: el límite es "por torre", no global, porque así cada torre de hielo colocada aporta valor de forma independiente y el jugador puede razonar sobre ella sin conocer el estado de las demás. Guardar solo ids (no referencias) mantiene el estado serializable y coherente con el resto de `GameState`.

**Nivel que amplía el cupo**: el cupo pasa de 1 a 2 en el nivel 5 (mitad del nuevo nivel máximo de 8), y de 2 a 3 en el nivel 8. Así "solo los niveles más altos" es literal: hace falta invertir bastante en la torre para que congele a más de un enemigo a la vez.

### Nivel máximo de 5 a 8, y por qué resuelve el problema de oro sobrante

**Decisión**: se sube el máximo de nivel de todas las torres de 5 a 8, manteniendo la misma fórmula de coste de mejora (geométrica, cada nivel estrictamente más caro que el anterior).

**Motivo**: el problema real detectado jugando es que a partir de cierta oleada no queda dónde invertir el oro. Añadir tres niveles más de mejora, con coste geométrico, desplaza mucho más lejos el punto en el que "todo está maximizado". Combinado con el coste de reparación (que además crece con las oleadas avanzadas, porque hay enemigos golpeando torres de forma constante), da a las oleadas tardías un gasto continuo con el que la simulación de balance debe converger sin excedentes desbocados.

**Verificación**: se reutiliza y adapta `tests/balance.test.ts` (ya existente) para comprobar que, jugando con una estrategia razonable, el oro no crece sin límite en oleadas avanzadas.

## Risks / Trade-offs

- **Balance por retocar**: los números iniciales de las torres y enemigos nuevos son una primera aproximación. Mitigación: la simulación de balance existente se adapta y se usa para iterar antes de dar el cambio por cerrado, igual que en la entrega anterior.
- **Superficie de tests grande**: casi toda la suite referencia los ids de enemigo actuales por nombre; hay que revisar cada fichero de test, no solo los de `wave-system`. Se declara como tarea explícita para no dejar tests desincronizados con el catálogo nuevo.
- **Lectura visual de "fuera de camino" y "torre dañada"**: son conceptos nuevos que el jugador debe poder distinguir a simple vista (un enemigo cruzando el prado, una torre con daño visible). Se aborda en el render con las mismas técnicas ya usadas (color/forma, no texto), pero queda sujeto a verificación visual en navegador antes de cerrar el cambio.
