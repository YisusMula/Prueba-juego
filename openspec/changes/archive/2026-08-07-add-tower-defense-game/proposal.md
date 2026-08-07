## Why

El repositorio contiene hoy un Pong mínimo en HTML/CSS/JS suelto, sin build, sin pruebas y sin especificaciones. Queremos un juego real, desplegable en la web y jugable tanto en móvil como en escritorio: un *tower defense* clásico de oleadas, con economía de oro, torres mejorables y un mapa con curvas. Necesitamos además una base técnica (build, tipos, tests) que permita iterar por tareas verificables en lugar de parchear un script monolítico.

## What Changes

- **BREAKING**: se retira el juego Pong (`index.html`, `script.js`, `style.css` en la raíz) y el repositorio pasa a ser el proyecto "Tower Game".
- Se introduce un proyecto TypeScript + Vite con Vitest, con la lógica de juego desacoplada del renderizado para poder probarla sin navegador.
- Nuevo juego de defensa de torres jugable de principio a fin:
  - Menú principal ambientado con título "Tower Game" y botón de comenzar.
  - Mapa de prado con un camino sinuoso; las torres solo se colocan sobre prado, nunca sobre el camino.
  - Oleadas de enemigos terrestres y aéreos que recorren el camino hasta la meta.
  - 20 vidas iniciales; cada enemigo que llega a la meta resta una vida y no otorga oro.
  - Oro por enemigo eliminado, con recompensa distinta según el tipo.
  - Varios tipos de torre con coste, potencia y alcance distintos: cañón (solo terrestres) y arquera (terrestres y aéreas), cada una en variantes de distinto precio/potencia.
  - Selección de torre en el menú inferior + colocación con clic/toque en el prado; una torre cuyo coste supera el oro disponible no se puede seleccionar.
  - Selección de una torre ya colocada para subirla de nivel, con coste creciente por nivel.
  - HUD superior con vidas, oro, oleada y controles; menú inferior de compra.
  - Botón de menú que pausa la partida y permite salir al menú principal.
  - Pantalla de derrota con "Has perdido" y botón de reintentar cuando las vidas llegan a 0.
- Diseño responsive con cámara desplazable (arrastre y zoom) para jugar en móvil o escritorio.
- Despliegue web estático: build de producción y workflow de GitHub Pages.

## Capabilities

### New Capabilities

- `game-shell`: pantallas del juego (menú principal, partida, pausa, derrota), transiciones y ciclo de vida de la partida.
- `battlefield-map`: mapa de prado con camino curvo, celdas construibles vs. bloqueadas, meta y punto de entrada.
- `wave-system`: definición y progresión de oleadas, tipos de enemigos (terrestres/aéreos), recorrido y llegada a meta.
- `tower-system`: catálogo de torres, colocación, alcance, disparo, tipos de objetivo válidos y mejora de nivel.
- `economy`: vidas y oro — recompensas por eliminación, costes de compra y de mejora, reglas de asequibilidad.
- `hud-controls`: HUD superior, barra de compra inferior, panel de torre seleccionada y botón de menú.
- `viewport-navigation`: escalado responsive del lienzo y sistema de desplazamiento/zoom de cámara compatible con ratón y táctil.

### Modified Capabilities

Ninguna: el repositorio no tiene specs previas.

## Impact

- Código afectado: se elimina el Pong de la raíz; se añade `src/` (dominio + render + UI), `tests/`, `index.html` de Vite, `package.json`, `tsconfig.json`, `vite.config.ts`.
- Dependencias nuevas: `vite`, `typescript`, `vitest` (todas de desarrollo). El juego se sirve como estático sin dependencias en runtime.
- CI/CD: nuevo workflow de GitHub Actions que compila y publica en GitHub Pages.
- Documentación: `README.md` reescrito para el nuevo juego.
