## 1. Modelo de especializaciones (`tower-system`)

- [x] 1.1 `src/game/specialisations.ts`: catálogo de dos ramas por tipo de torre, con nombre, descripción y modificadores
- [x] 1.2 `SPECIALISATION_LEVEL = 4`; `specialisation` en `Tower`, nula al construir
- [x] 1.3 `specialiseTower`: valida nivel, pertenencia al tipo y que no esté ya especializada
- [x] 1.4 `statsAtLevel` aplica los modificadores de la rama sobre las estadísticas del nivel
- [x] 1.5 Tests: no antes del nivel, se conserva, es irreversible, rama de otro tipo se rechaza, vender la descarta, se llega al máximo sin especializar, sin rama las estadísticas no cambian

## 2. Perforación (`tower-system`)

- [x] 2.1 Bandera `piercing` en la rama, propagada al proyectil y aplicada en el impacto directo y en el área
- [x] 2.2 Al menos una rama perforante en cada torre de daño
- [x] 2.3 Tests: la torre perforante ignora la armadura, sin perforación la armadura sigue contando, el área también perfora

## 3. Cadena (`tower-system`)

- [x] 3.1 `chainTargets` y `chainFalloff` en la rama; saltos al enemigo válido más cercano no alcanzado
- [x] 3.2 El salto respeta el dominio de la torre y ningún enemigo se alcanza dos veces por disparo
- [x] 3.3 Tests: alcanza a los cercanos, cada salto pega menos, respeta el dominio, sin repetir objetivo

## 4. Fragilidad (`tower-system`)

- [x] 4.1 `vulnerability` en el enemigo, aplicada por la congelación de una torre de hielo con esa rama
- [x] 4.2 El multiplicador se aplica antes de la reducción por armadura y se acaba con la congelación
- [x] 4.3 Tests: otra torre aprovecha la fragilidad, sin la rama no hay aumento, se acaba con la congelación

## 5. Interfaz (`hud-controls`)

- [x] 5.1 Sección de especialización en el panel de torre: dos botones con nombre y descripción, y aviso de que es permanente
- [x] 5.2 Etiqueta de la especialización elegida en lugar de la elección
- [x] 5.3 Marca visual de la torre especializada en el escenario
- [x] 5.4 Tests: se ofrece al llegar al nivel, no antes, y se sustituye por la etiqueta al elegir

## 6. Balance y verificación

- [x] 6.1 El jugador automático del simulador elige especialización; comprobar que los tres escenarios siguen siendo ganables en Normal
- [x] 6.2 Ninguna rama domina: comparar el daño por segundo efectivo de las dos ramas de cada torre
- [x] 6.3 `npm run typecheck`, `npm test` y `npm run build` en verde
- [x] 6.4 Verificación en navegador (escritorio y móvil) del panel de especialización
- [x] 6.5 Actualizar `README.md` con las ramas y los efectos nuevos
