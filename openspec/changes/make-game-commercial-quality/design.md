## Context

Esta iteración nace de comparar el juego con los referentes del género (Kingdom Rush, Bloons TD, Plants vs. Zombies, Defender's Quest) en vez de de una intuición propia. Tres ideas de esa investigación mandan sobre el resto del diseño:

- **El control del tiempo no es una comodidad, es diseño.** El autor de *Defender's Quest* argumenta que dar al jugador control total del tiempo (pausa, velocidad, adelantar oleada) elimina la espera muerta sin abaratar el reto, porque el coste de los recursos ya limita cuántas acciones puede hacer. Nuestro juego obliga hoy a mirar 7 segundos de nada entre oleadas.
- **La información completa es lo que convierte reflejos en estrategia.** El jugador debe poder ver el estado del sistema para decidir. Hoy no sabe qué oleada viene ni puede dirigir el fuego de sus torres.
- **"Los mapas con scroll son enemigos del foco".** Preocuparse por lo que pasa fuera de cuadro fragmenta la atención. No podemos quitar el scroll (es un requisito explícito del juego en móvil), así que hay que compensarlo avisando de lo que queda fuera.

La restricción arquitectónica del proyecto sigue mandando: `src/game/` es simulación pura y probable en Node. Audio y `localStorage` son efectos de entorno y no pueden entrar ahí.

## Goals / Non-Goals

**Goals:**

- Devolver al jugador el control del ritmo: velocidad, adelantar oleada, y que ambas cosas no rompan el determinismo de la simulación.
- Dar un final a la partida (victoria a la oleada 30) y una razón para repetirla (dificultades y récords).
- Cerrar los huecos de decisión estándar del género: vender, priorizar objetivo, ver lo que viene.
- Añadir agencia momento a momento con habilidades de recarga, sin convertir el juego en un clicker.
- Polish sensorial (sonido y game feel) sin añadir ni un byte de assets ni una dependencia.

**Non-Goals:**

- Monetización, anuncios o compras dentro del juego. "Comerciable" aquí se entiende como calidad de producto, no como plumbing de pagos.
- Multijugador, tablas de clasificación en línea o cuentas de usuario.
- Mapas múltiples y árboles de mejora ramificados (Bloons). Son la evolución natural siguiente, pero multiplicarían el alcance de esta entrega.
- Guardar una partida a medias para retomarla después.

## Decisions

### La velocidad multiplica los pasos, nunca el `dt`

**Decisión**: el bucle mantiene el paso fijo de 1/60 s y la velocidad `N×` se implementa ejecutando hasta N veces más pasos por frame, con el tope de pasos por frame escalado en consecuencia. Nunca se multiplica el `dt` que recibe `step()`.

**Motivo**: multiplicar el `dt` cambiaría la granularidad de la integración y con ella el comportamiento: a 3× los proyectiles rápidos podrían atravesar enemigos y las cadencias se redondearían distinto. Multiplicando los pasos, una partida a 3× produce exactamente la misma secuencia de estados que una a 1×, solo que en un tercio de tiempo real. Eso es lo que exige la spec cuando dice que la velocidad no altera ningún resultado.

**Consecuencia**: la simulación pura no necesita enterarse de la velocidad. Es una decisión del bucle de `main.ts`, y por eso los tests siguen llamando a `step()` como siempre.

### El bonus por adelantar oleada es proporcional al tiempo cedido

**Decisión**: al llamar la oleada durante la preparación, el bonus es `round(waveTimer_restante × ORO_POR_SEGUNDO)`, con el temporizador saltando a 0.

**Motivo**: es la formulación que hace la decisión interesante en Kingdom Rush. El jugador cambia tiempo de preparación (con el que podría acumular más oro matando... nada, porque no hay enemigos) por oro directo, asumiendo el riesgo de recibir la oleada con la defensa a medias. Proporcional y no fijo, porque un bonus fijo se convertiría en "pulsa siempre nada más empezar la pausa" sin decisión ninguna.

### Prioridad de objetivo: un comparador por modo, aplicado después del filtro

**Decisión**: `findTarget` sigue filtrando primero por vivo, dominio válido y alcance —eso no cambia—, y solo entre los supervivientes aplica el comparador de la prioridad de la torre.

**Motivo**: mantiene la garantía de que un cañón nunca dispara a un aéreo por mucho que se configure su prioridad, que es una regla que ya está probada y que la spec vuelve a exigir explícitamente. El modo solo decide *cuál* de los válidos, nunca *si* es válido.

### La victoria es una transición de estado más, no un modo aparte

**Decisión**: se añade `victory` a la máquina de pantallas y un `endless: boolean` al estado. `step()` comprueba la victoria en el mismo sitio donde ya comprueba la derrota: cuando la oleada final se ha completado (fase de limpieza, sin enemigos, sin cola) y quedan vidas. Continuar en modo sin fin solo pone `endless = true` y devuelve la pantalla a `playing`.

**Motivo**: reutiliza toda la maquinaria de "la simulación no corre si la pantalla no es `playing`" que ya bloquea compras y avance tras la derrota. La victoria hereda gratis ese comportamiento, que es justo lo que pide la spec.

### La dificultad se resuelve al empezar, no se consulta en cada paso

**Decisión**: `GameState` guarda la dificultad elegida. `spawnEnemy` aplica `hpMultiplier × difficultyHpMultiplier`, y las vidas y el oro iniciales salen de la tabla de dificultad al arrancar la partida.

**Motivo**: mantiene `getWave(n)` como función pura del número de oleada —la composición no cambia con la dificultad, y así lo exige la spec— y concentra el efecto de la dificultad en dos puntos concretos y testeables.

### Audio: síntesis con Web Audio detrás de una interfaz, y la simulación solo emite eventos

**Decisión**: `src/game/` no llama al audio. La simulación acumula eventos de sonido en una cola dentro del estado (`state.soundQueue`), y la capa de presentación la vacía en cada frame y los reproduce. `src/audio/` sintetiza cada efecto con osciladores y envolventes; no hay ficheros.

**Motivo**: es lo que permite que `step()` siga siendo puro y ejecutable en Node, donde no existe `AudioContext`. Además hace los sonidos testeables: un test puede comprobar que matar a un enemigo encola el evento correcto sin necesitar navegador.

**Arranque**: el `AudioContext` se crea en la primera interacción del jugador, porque los navegadores bloquean la reproducción automática. Si la API no existe, la capa de audio se convierte en una implementación vacía y el juego funciona igual.

### La persistencia es de solo dos claves y tolera fallos

**Decisión**: `src/storage/` envuelve `localStorage` con try/catch en lectura y escritura, y devuelve valores por defecto ante cualquier fallo. Guarda los récords por dificultad y la preferencia de silencio.

**Motivo**: en modo privado de Safari e iframes con cookies bloqueadas `localStorage` lanza al escribir. Un juego que revienta ahí es un juego roto para una parte real de los usuarios, y la spec pide explícitamente que siga funcionando sin almacenamiento.

### Habilidades: datos + estado de recarga, y el apuntado vive en la capa de entrada

**Decisión**: el catálogo de habilidades es una tabla de datos (`meteor`, `blizzard`). El estado guarda la recarga restante de cada una y cuál está en modo apuntado. `handleWorldTap` comprueba primero si hay una habilidad apuntando, antes que la lógica de colocar o seleccionar torres.

**Motivo**: replica el patrón que ya funciona con `shopSelection` (una selección pendiente que intercepta el siguiente toque), así que no introduce un concepto de interacción nuevo que el jugador tenga que aprender ni que nosotros tengamos que probar desde cero.

### Aviso de enemigos fuera de cuadro: en el render, no en el estado

**Decisión**: la escena calcula qué enemigos caen fuera del viewport y dibuja una flecha en el borde correspondiente. No se guarda nada en `GameState`.

**Motivo**: depende exclusivamente de la cámara y del tamaño de pantalla, que son conceptos de presentación. Meterlo en el estado obligaría a la simulación a conocer el viewport y rompería su pureza.

## Risks / Trade-offs

- **Alcance grande en una sola entrega.** Son nueve capacidades tocadas a la vez, y la propia herramienta avisa de que conviene partir cambios con más de diez deltas. Se asume conscientemente porque las piezas se refuerzan entre sí (la victoria no significa nada sin dificultades, y las dificultades no significan nada sin récords), pero obliga a apoyarse mucho en la suite de tests existente para no romper lo que ya funcionaba.
- **Balance de nuevo sin validar.** Añadir venta, bonus por adelantar oleada y habilidades mete tres fuentes nuevas de ventaja para el jugador. La simulación de balance existente debe re-ejecutarse y probablemente reajustarse; existe el riesgo de que la victoria en la oleada 30 quede trivial en Fácil o inalcanzable en Difícil.
- **El sonido sintetizado suena a sintetizado.** Sin assets, los efectos serán funcionales pero no "de estudio". Es el precio de no añadir dependencias ni peso de descarga; se acepta como un escalón intermedio válido.
- **Superficie de interfaz creciendo en móvil.** Velocidad, habilidades, llamar oleada y previsualización compiten por un espacio ya justo en 360 px. Hay riesgo real de amontonamiento; obliga a verificar en pantalla estrecha y no solo en escritorio.
