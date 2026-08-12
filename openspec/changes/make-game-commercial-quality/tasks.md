## 1. Dificultad y progresión de partida (`run-progression`, `economy`, `wave-system`)

- [ ] 1.1 `src/game/difficulty.ts`: tabla de dificultades (Fácil/Normal/Difícil) con vidas iniciales, oro inicial y multiplicador de vida
- [ ] 1.2 Guardar la dificultad en `GameState` y aplicarla a los recursos iniciales y a `spawnEnemy`
- [ ] 1.3 Oleada final y estado `victory` en la máquina de pantallas; `endless` para continuar tras ganar
- [ ] 1.4 Tests: recursos iniciales por dificultad, orden coherente entre dificultades, victoria al superar la oleada final, derrota tiene prioridad, modo sin fin no vuelve a ganar, victoria bloquea interacción

## 2. Récords persistentes (`run-progression`)

- [ ] 2.1 `src/storage/records.ts`: lectura/escritura tolerante a fallos de `localStorage`, récords por dificultad
- [ ] 2.2 Actualizar el récord al terminar la partida (victoria o derrota) solo si se supera
- [ ] 2.3 Mostrar el récord de la dificultad seleccionada en el menú principal
- [ ] 2.4 Tests: mejor resultado actualiza, peor no, independencia por dificultad, sin almacenamiento no revienta

## 3. Control del tiempo (`hud-controls`, `economy`)

- [ ] 3.1 Velocidad 1×/2×/3× multiplicando pasos por frame en `main.ts`, nunca el `dt`
- [ ] 3.2 Botón de llamar a la siguiente oleada con bonus proporcional al tiempo restante de preparación
- [ ] 3.3 Controles de velocidad y de llamar oleada en el HUD, con la velocidad siempre visible
- [ ] 3.4 Tests: bonus mayor cuanto antes se llama, llamar arranca la oleada, no se puede llamar con la oleada en marcha

## 4. Decisiones informadas (`tower-system`, `hud-controls`, `wave-system`)

- [ ] 4.1 Prioridad de objetivo por torre (primero/último/más fuerte/más cercano) aplicada tras el filtro de validez
- [ ] 4.2 Inversión acumulada por torre y venta con reembolso parcial
- [ ] 4.3 `describeWave(n)`: composición consultable sin generar la oleada, con banderas de aéreos y de daño a torres
- [ ] 4.4 Panel de torre: selector de prioridad y botón de vender con su reembolso
- [ ] 4.5 Previsualización de la próxima oleada y barra de progreso de la oleada en curso en el HUD
- [ ] 4.6 Tests: cada prioridad elige bien, la prioridad no salta el dominio, inversión crece con las mejoras, vender reembolsa y libera la celda, vender tras terminar la partida se rechaza, la consulta de oleada no genera enemigos

## 5. Habilidades del comandante (`hero-abilities`)

- [ ] 5.1 `src/game/abilities.ts`: catálogo (meteoro dirigido, ventisca inmediata) con recarga y parámetros
- [ ] 5.2 Estado de recarga en `GameState`, avance con el tiempo de simulación y modo de apuntado
- [ ] 5.3 Lanzamiento: meteoro daña en área en el punto señalado, ventisca congela a todos
- [ ] 5.4 `handleWorldTap` atiende el apuntado antes que la colocación de torres; cancelar no gasta la habilidad
- [ ] 5.5 Barra de habilidades en el HUD con estado de recarga y resaltado del apuntado
- [ ] 5.6 Tests: efecto de cada habilidad, recarga bloquea el reuso, la recarga no avanza en pausa, empiezan disponibles, apuntar no coloca torre, cancelar no gasta, no se usan con la partida terminada

## 6. Sonido (`game-audio`)

- [ ] 6.1 Cola de eventos de sonido en `GameState`, emitida desde la simulación (disparo, impacto, muerte, fuga, construir, mejorar, habilidad, victoria, derrota)
- [ ] 6.2 `src/audio/`: síntesis con Web Audio de cada efecto, inicialización en la primera interacción, implementación vacía si no hay soporte
- [ ] 6.3 Silencio persistente con botón en el HUD
- [ ] 6.4 Tests: los eventos se encolan al ocurrir, la cola se vacía al consumirse, silenciar no emite

## 7. Retorno visual (game feel)

- [ ] 7.1 Números de daño flotantes al impactar
- [ ] 7.2 Destello del enemigo al recibir daño
- [ ] 7.3 Sacudida de pantalla al perder una vida
- [ ] 7.4 Indicadores de borde para enemigos fuera del área visible (`viewport-navigation`)
- [ ] 7.5 Efecto visual del meteoro y de la ventisca

## 8. Interfaz y menús

- [ ] 8.1 Selector de dificultad y récord en el menú principal
- [ ] 8.2 Pantalla de victoria con resumen, continuar en modo sin fin y volver al menú
- [ ] 8.3 Reorganizar el HUD para que quepan velocidad, sonido, habilidades y llamar-oleada sin amontonarse
- [ ] 8.4 Responsive: verificar a 360 px y en apaisado que nada se solapa ni desborda

## 9. Reequilibrado y verificación

- [ ] 9.1 Reajustar el balance con la simulación existente: la victoria en la oleada 30 debe ser alcanzable en Normal y exigente en Difícil
- [ ] 9.2 Añadir a `tests/balance.test.ts` un caso por dificultad
- [ ] 9.3 `npm run typecheck`, `npm test` y `npm run build` en verde
- [ ] 9.4 Verificación en navegador (escritorio, móvil y apaisado): velocidad, llamar oleada, vender, prioridad, habilidades, sonido, victoria y récords
- [ ] 9.5 Actualizar `README.md` con las mecánicas y controles nuevos
