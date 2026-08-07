# Tower Game

Juego de defensa de torres por oleadas, jugable en el navegador desde el móvil o
el ordenador. Las criaturas entran por la cueva y recorren un camino sinuoso a
través del prado hasta tu castillo; tú levantas torres en la hierba y las subes
de nivel para que ninguna llegue.

## Cómo se juega

- Empiezas con **20 vidas** y **150 de oro**.
- Elige una torre en la barra inferior y **pulsa sobre el prado** para colocarla.
  Las torres no se pueden poner sobre el camino. Si no te llega el oro, la torre
  aparece deshabilitada y no se puede seleccionar.
- **Pulsa una torre colocada** para ver sus estadísticas y subirla de nivel. Cada
  nivel cuesta más que el anterior, hasta el nivel 8.
- Cada criatura eliminada da oro; la cantidad depende de su tipo.
- Cada criatura que llega al castillo **resta una vida y no da oro**.
- A partir de cierta oleada, algunas criaturas **abandonan el camino** y cruzan
  el prado en línea recta, y otras **dañan la estructura de una torre** al pasar
  junto a ella. Una torre sin estructura deja de disparar hasta que la reparas
  desde su panel, gastando oro.
- Cuando las vidas llegan a 0 aparece la pantalla de derrota con un botón para
  reintentar.

### Torres

| Torre | Coste | Ataca a | Notas |
| --- | --- | --- | --- |
| Arqueras | 45 | Tierra y aire | Cadencia alta, daño bajo |
| Cañón | 60 | Solo tierra | Bolas de cañón, pega más fuerte |
| Mortero | 140 | Solo tierra | Daño en área |
| Torre de Hielo | 150 | Tierra y aire | Daño mínimo, pero congela; solo un enemigo a la vez salvo en niveles altos |
| Ballesta | 190 | Tierra y aire | Largo alcance y mucho daño |
| Torre Mágica | 260 | Tierra y aire | Rayos, el mayor daño del catálogo |

### Criaturas

Una progresión de rata → zorro → perro → jabalí en tierra, y murciélago → águila
→ buitre en el aire, con goblins, orcos y un jefe orco como gama alta. Cada
oleada trae más criaturas, con más vida y algo más rápidas que la anterior.
El jabalí, el buitre, el orco y el jefe orco pueden dañar torres cercanas; el
goblin y el jefe orco pueden abandonar el camino.

### Controles

| Acción | Ratón | Táctil |
| --- | --- | --- |
| Mover la vista | Arrastrar | Arrastrar un dedo |
| Zoom | Rueda o botones `+` / `−` | Pellizcar o botones `+` / `−` |
| Ver el mapa entero | Botón `⤢` | Botón `⤢` |
| Colocar / seleccionar | Clic | Toque |
| Pausar | Botón `Menú` o `Esc` | Botón `Menú` |

## Ejecutar en local

```bash
npm install
npm run dev      # servidor de desarrollo
```

Otros comandos:

```bash
npm test         # tests de la simulación (Vitest)
npm run typecheck
npm run build    # comprobación de tipos + build de producción en dist/
npm run preview  # sirve el build de producción
```

## Despliegue

El build genera un sitio estático en `dist/` con rutas relativas, así que se
puede servir desde cualquier hosting estático o desde un subdirectorio.

El workflow `.github/workflows/deploy.yml` comprueba tipos, ejecuta los tests y
publica en **GitHub Pages** en cada push a `main`. Para activarlo, en
*Settings → Pages* del repositorio hay que elegir **GitHub Actions** como origen.

## Estructura

```
src/
  game/     Simulación pura: mapa, oleadas, torres, economía, cámara.
            Sin DOM ni canvas, por lo que se puede probar entera en Node.
  render/   Dibujo en canvas: terreno precocinado y entidades.
  ui/       HUD, barra de compra, panel de torre y entrada de puntero.
tests/      Tests de Vitest, uno por capacidad de las specs.
openspec/   Specs y propuesta de cambio (ver más abajo).
```

## Especificaciones

El juego está especificado con [OpenSpec](https://github.com/Fission-AI/OpenSpec).
Las specs vivas de cada capacidad están en `openspec/specs/`; los cambios en
curso o archivados, con su propuesta, diseño y tareas, en
`openspec/changes/`. Cada escenario de las specs tiene su test correspondiente
en `tests/`.

```bash
npx @fission-ai/openspec@latest list
npx @fission-ai/openspec@latest spec list
```
