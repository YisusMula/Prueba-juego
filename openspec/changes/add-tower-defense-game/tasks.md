## 1. Base del proyecto

- [ ] 1.1 Retirar el juego Pong de la raíz (`index.html`, `script.js`, `style.css`)
- [ ] 1.2 Crear el proyecto Vite + TypeScript estricto (`package.json`, `tsconfig.json`, `vite.config.ts` con `base: './'`)
- [ ] 1.3 Configurar Vitest y comprobar que `npm test` y `npm run build` funcionan en vacío
- [ ] 1.4 Añadir `.gitignore` (node_modules, dist)

## 2. Mapa del prado (`battlefield-map`)

- [ ] 2.1 Definir la rejilla de celdas y los tipos de terreno (prado, camino, entrada, meta)
- [ ] 2.2 Trazar a mano el camino sinuoso con al menos cuatro cambios de dirección y derivar la rejilla
- [ ] 2.3 Derivar la polilínea de recorrido con longitudes acumuladas y la función posición-en-recorrido
- [ ] 2.4 Implementar `canPlaceTower(cell)`: solo prado libre, dentro de límites, sin torre
- [ ] 2.5 Tests: continuidad del camino, número de curvas ≥ 4, rechazo de colocación en camino/meta/ocupada/fuera de límites

## 3. Economía (`economy`)

- [ ] 3.1 Estado de vidas (20 iniciales) y oro inicial, con clamp a 0
- [ ] 3.2 Operaciones `spendGold`, `addGold`, `loseLife` con rechazo de saldo negativo
- [ ] 3.3 Regla de asequibilidad `canAfford(torre)` y cancelación de la selección al bajar el oro
- [ ] 3.4 Tests: oro/vidas iniciales, oro no negativo, fuga no da oro, cancelación de selección inasequible

## 4. Enemigos y oleadas (`wave-system`)

- [ ] 4.1 Catálogo de tipos de enemigo (terrestre básico, rápido, resistente, aéreo) con vida, velocidad y recompensa
- [ ] 4.2 Definición de oleadas con composición, intervalo de aparición y pausa entre oleadas
- [ ] 4.3 Avance de enemigos por la polilínea y detección de llegada a meta (−1 vida, sin oro)
- [ ] 4.4 Muerte de enemigo: retirada del escenario y recompensa de oro del tipo
- [ ] 4.5 Fin de oleada y progresión automática a la siguiente
- [ ] 4.6 Tests: aparición escalonada, dificultad creciente, resistente vs. rápido, meta resta 1 vida y no da oro, muerte da el oro del tipo

## 5. Torres (`tower-system`)

- [ ] 5.1 Catálogo de torres: cañón (solo tierra), arqueras (tierra y aire), mortero de área, ballesta de largo alcance
- [ ] 5.2 Colocación con cobro del coste y rechazo sin efecto si el terreno o el oro no lo permiten
- [ ] 5.3 Adquisición de objetivo: alcance, dominio válido y prioridad al enemigo más avanzado
- [ ] 5.4 Cadencia de disparo, proyectiles en vuelo, impacto y daño (incluido daño de área)
- [ ] 5.5 Fórmulas de nivel: estadísticas crecientes y coste de mejora estrictamente creciente, con nivel máximo
- [ ] 5.6 Selección de torre colocada y acción de mejora con validación de oro y de nivel máximo
- [ ] 5.7 Tests: cañón ignora aéreos, arqueras alcanzan aéreos, prioridad al más avanzado, cadencia respetada, coste/potencia crecientes, mejora sin oro no aplica

## 6. Ciclo de partida y pantallas (`game-shell`)

- [ ] 6.1 Máquina de estados de pantalla: menú → jugando ↔ pausa → derrota
- [ ] 6.2 Menú principal ambientado con el título "Tower Game" y botón de comenzar
- [ ] 6.3 Pausa desde el botón de menú, con reanudar y salir al menú principal
- [ ] 6.4 Derrota al llegar a 0 vidas: pantalla "Has perdido" con botón de reintentar y bloqueo de interacción
- [ ] 6.5 Reinicio limpio de la partida al comenzar o reintentar
- [ ] 6.6 Tests: transiciones de estado, la pausa congela la simulación, derrota bloquea compras, reintentar restaura 20 vidas y oleada 1

## 7. Render del escenario

- [ ] 7.1 Bucle de render con paso fijo de simulación y tope de pasos por frame
- [ ] 7.2 Terreno precocinado en canvas fuera de pantalla: prado con textura, camino de tierra con curvas y decoración
- [ ] 7.3 Dibujo de torres por tipo y nivel, con indicador de nivel
- [ ] 7.4 Dibujo de enemigos terrestres y aéreos (aéreos con sombra, por encima del escenario) con barra de vida
- [ ] 7.5 Dibujo de proyectiles, impactos y previsualización de colocación con radio de alcance

## 8. Interfaz (`hud-controls`)

- [ ] 8.1 HUD superior con vidas, oro y oleada, actualizado desde el estado
- [ ] 8.2 Barra de compra inferior con nombre, coste, tipo de objetivo y estado deshabilitado por oro
- [ ] 8.3 Selección/deselección de torre de compra y resaltado
- [ ] 8.4 Panel de torre seleccionada con estadísticas, coste de mejora y botón (deshabilitado por oro o nivel máximo)
- [ ] 8.5 Botón de menú en el HUD que pausa la partida
- [ ] 8.6 Estilos responsive (móvil y escritorio), objetivos táctiles ≥ 44 px, sin desbordamiento a 360 px
- [ ] 8.7 Los eventos de la interfaz no llegan al escenario (pulsar el HUD nunca coloca torre)

## 9. Cámara y entrada (`viewport-navigation`)

- [ ] 9.1 Lienzo adaptable al espacio disponible, con soporte de `devicePixelRatio` y de cambios de tamaño/orientación
- [ ] 9.2 Cámara con desplazamiento acotado a los límites del mapa
- [ ] 9.3 Zoom con rueda, pellizco y botones en pantalla, acotado entre "mapa completo" y el máximo
- [ ] 9.4 Conversión pantalla→escenario que tiene en cuenta desplazamiento y zoom
- [ ] 9.5 Umbral de arrastre que distingue pulsación de desplazamiento
- [ ] 9.6 Tests: clamp de cámara, clamp de zoom, conversión de coordenadas con pan+zoom, umbral tap vs. drag

## 10. Despliegue y documentación

- [ ] 10.1 Workflow de GitHub Actions que compila y publica en GitHub Pages
- [ ] 10.2 Reescribir `README.md`: cómo jugar, cómo ejecutar en local, cómo desplegar
- [ ] 10.3 Ejecutar la batería completa (`npm test`, `npm run build`, comprobación de tipos) y dejarla en verde
- [ ] 10.4 Verificar el juego en el navegador (menú, colocación, oleadas, mejora, pausa, derrota) en viewport móvil y de escritorio
