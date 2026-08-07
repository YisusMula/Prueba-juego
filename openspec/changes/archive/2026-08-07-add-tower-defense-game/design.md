## Context

El repositorio parte de un Pong en tres ficheros sueltos, sin build ni pruebas. El objetivo es un tower defense completo que se despliegue como sitio estático y que funcione con ratón y con dedos. Restricciones que condicionan el diseño:

- **Sin backend**: todo se sirve como estático (GitHub Pages), sin estado de servidor ni persistencia obligatoria.
- **Sin assets binarios**: no hay pipeline de arte, así que el aspecto de prado, camino, torres y bichos se dibuja de forma procedural en Canvas 2D.
- **Verificable sin navegador**: la simulación (oleadas, disparo, economía, mapa) debe ser probable con Vitest en Node, sin DOM.
- **Un solo dispositivo de entrada abstracto**: ratón y táctil deben pasar por el mismo camino de código para no duplicar reglas de "arrastre vs. pulsación".

## Goals / Non-Goals

**Goals:**

- Núcleo de simulación determinista y puro (`step(dt)`), independiente de Canvas y del DOM, testeable al 100 % en Node.
- Bucle de render a `requestAnimationFrame` con paso fijo de simulación, para que el comportamiento no dependa de los FPS del dispositivo.
- Interfaz responsive con HUD en DOM (HTML/CSS) y escenario en Canvas: el DOM da accesibilidad y adaptación gratis, el canvas da rendimiento.
- Cámara con pan/zoom acotada y una regla clara de umbral de arrastre para no colocar torres sin querer.
- Catálogo de torres, enemigos y oleadas definido como datos, para poder ajustar el balance sin tocar lógica.

**Non-Goals:**

- Multijugador, tablas de puntuación, guardado en la nube.
- Editor de mapas o mapas múltiples (un solo mapa diseñado a mano en esta entrega).
- Sonido y música.
- Motor de juego de terceros (Phaser, PixiJS): el alcance no lo justifica y añade peso de bundle.

## Decisions

### Canvas 2D para el escenario, DOM para el HUD

**Decisión**: el prado, el camino, torres, enemigos y proyectiles se dibujan en un `<canvas>`; el HUD superior, la barra de compra, el panel de torre y las pantallas de menú/pausa/derrota son elementos HTML posicionados encima.

**Motivo**: cientos de entidades móviles en DOM serían lentas, pero los botones en canvas obligarían a reimplementar hit-testing, foco y escalado tipográfico. Separarlos también hace trivial la regla "pulsar la interfaz no coloca torre": los eventos de los controles se detienen en el DOM y nunca llegan al canvas.

**Alternativa descartada**: todo en canvas (más control visual, mucho más trabajo de accesibilidad y responsive).

### Simulación pura separada del render

**Decisión**: `src/game/` contiene el estado y las reglas (`GameState`, `step(state, dt)`, mapa, catálogos, oleadas) sin ninguna referencia a `window`, `document` o `CanvasRenderingContext2D`. `src/render/` y `src/ui/` consumen ese estado y lo dibujan.

**Motivo**: es la condición para poder escribir tests de "torre dispara 3 veces en 2,5 s" o "enemigo en meta resta una vida" en Node, sin jsdom ni navegador headless.

### Paso fijo de simulación con acumulador

**Decisión**: el bucle acumula el tiempo real y ejecuta `step` en incrementos fijos de 1/60 s, con un tope de pasos por frame para evitar la espiral de la muerte tras un `tab` en segundo plano.

**Motivo**: hace la simulación reproducible y las pruebas deterministas; evita que en un móvil a 30 FPS los proyectiles atraviesen enemigos.

### Mapa como rejilla + polilínea de recorrido

**Decisión**: el mapa es una rejilla de celdas (`GRASS` / `PATH` / `SPAWN` / `GOAL`) generada a partir de una lista de celdas del camino trazada a mano con curvas. De esa lista se deriva una polilínea de puntos de paso con su longitud acumulada.

**Motivo**: la rejilla resuelve de forma trivial "¿puedo construir aquí?" y el snapping de colocación; la polilínea da a los enemigos una posición continua (`distanciaRecorrida`) que además sirve como criterio de "enemigo más avanzado" para la selección de objetivo, sin cálculos extra.

**Trade-off**: el camino es fijo, no generado; a cambio, garantizamos que tiene curvas y que es visualmente agradable.

### Enemigos aéreos sobre la misma ruta

**Decisión**: los aéreos siguen la misma polilínea que los terrestres, pero se dibujan con sombra y desplazamiento vertical, y solo son objetivo de torres con `canTargetAir`.

**Motivo**: una ruta aérea propia (línea recta) haría que las torres del centro del mapa nunca los vieran y rompería el equilibrio; reutilizar la ruta mantiene el juego legible. La diferencia real está en quién puede dispararles.

### Catálogos como datos y escalado de nivel por fórmula

**Decisión**: torres y enemigos se definen en tablas de datos. Las estadísticas de nivel N salen de una fórmula sobre las base (`damage * 1.6^(N-1)`, alcance creciente) y el coste de mejora de una progresión estrictamente creciente (`round(coste_base * 0.75 * 1.85^(N-1))`).

**Motivo**: cumple por construcción el requisito "cada nivel cuesta más que el anterior" y permite verificarlo con un test sobre todo el catálogo en vez de mantener tablas a mano.

### Umbral de arrastre para separar pan de colocación

**Decisión**: `pointerdown` guarda la posición; `pointerup` cuenta como *tap* solo si el desplazamiento acumulado es menor que ~10 px y han pasado menos de ~400 ms. Cualquier otra cosa es pan.

**Motivo**: en móvil es imposible tocar sin mover un poco el dedo; sin umbral, el jugador colocaría torres al intentar desplazarse (y al revés). El mismo código sirve para ratón.

### Cámara acotada con zoom mínimo = mapa completo

**Decisión**: el zoom mínimo se calcula para que el mapa quepa entero en el viewport; el desplazamiento se recorta a los límites del mapa en cada actualización.

**Motivo**: evita el estado confuso de "me he perdido en el vacío", habitual cuando la cámara es libre.

### TypeScript + Vite + Vitest

**Decisión**: Vite para el build y el servidor de desarrollo, TypeScript en modo estricto, Vitest para las pruebas de la simulación.

**Motivo**: cero configuración para un sitio estático con rutas relativas (`base: './'`) desplegable en Pages, y Vitest comparte la configuración de Vite sin duplicar transpilación.

## Risks / Trade-offs

- **Balance del juego**: los números iniciales de daño, vida y oro son una primera aproximación; existe el riesgo de que el juego resulte trivial o imposible. Mitigación: catálogos como datos y un test que comprueba la monotonía de la dificultad entre oleadas, para poder retocar con confianza.
- **Rendimiento en móviles antiguos**: dibujar el prado procedural en cada frame puede costar. Mitigación: el terreno estático (prado, camino, decoración) se pinta una sola vez en un canvas fuera de pantalla y se compone como imagen en cada frame.
- **Sin pruebas de navegador**: Vitest cubre la simulación pero no el render ni los gestos. Mitigación: mantener la capa de entrada fina y con las decisiones (tap vs. pan, pantalla→escenario) extraídas a funciones puras que sí se prueban.
- **Ruptura del contenido existente**: se elimina el Pong. Es intencional y está declarado como BREAKING en la propuesta; el historial de git conserva el código anterior.
- **Sin persistencia**: recargar la página pierde la partida. Aceptado para esta entrega.
