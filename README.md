# Tower Game

Juego de defensa de torres por oleadas, jugable en el navegador desde el móvil o
el ordenador. Las criaturas entran por la cueva y recorren un camino sinuoso a
través del prado hasta tu castillo; tú levantas torres en la hierba y las subes
de nivel para que ninguna llegue.

Hay una **campaña de cinco escenarios**, cada uno con su propio problema: desde
un carril único hasta un camino que se parte en tres. Se abren en orden y cada
uno se puntúa con estrellas.

## Instalable y sin conexión

El juego es una **aplicación web instalable**: desde el navegador del móvil se
puede añadir a la pantalla de inicio, con su icono, y se abre a pantalla
completa sin barra de direcciones.

Y una vez abierto la primera vez, **funciona sin conexión**. No hay truco: la
página no hace ni una sola petición externa —todo el código, los gráficos y el
sonido se generan en el cliente— así que basta con que el navegador se quede con
lo que ya descargó. Los récords y la partida guardada viven en el propio
dispositivo.

El *service worker* sirve de la caché los recursos cuyo nombre lleva un hash
(que por definición no pueden estar desfasados) y pide a la red el documento,
para que una versión nueva llegue a quien ya lo tenía instalado.

## Continuar donde lo dejaste

La partida en curso **se guarda sola** cada pocos segundos y, sobre todo, al
ocultarse la pestaña: en un móvil ese es el último aviso antes de que el sistema
la recicle. Al volver, el menú ofrece **Continuar**, diciendo en qué escenario y
oleada te quedaste.

Se restaura la partida entera —enemigos con su recorrido, torres con su nivel y
su daño, proyectiles en vuelo, recargas de habilidades— y entra **en pausa**,
para que puedas reconocer el tablero antes de que la oleada siga.

El guardado se descarta al ganar, al perder, al salir al menú y al empezar otra
partida.

## Primeros pasos

La primera partida lleva una **guía**: una pista en pantalla que va indicando
qué hacer —elegir torre, colocarla, mejorarla y especializarla— y que **avanza
sola** cuando lo haces. No bloquea nada ni te obliga a pulsar donde te dice: si
ya sabes jugar, la ignoras o la saltas con su botón. Desde el menú principal se
puede volver a activar.

## Cómo se juega

La partida se gana **superando la oleada 30**; se pierde cuando las vidas llegan
a 0. Tras la victoria puedes seguir en **modo sin fin**, donde las oleadas no
paran de crecer.

- Elige la dificultad en el menú y el escenario en la pantalla siguiente. La
  dificultad cambia las vidas y el oro de partida y la dureza de los enemigos:

  | Dificultad | Vidas | Oro | Vida de los enemigos |
  | --- | --- | --- | --- |
  | Fácil | 30 | 220 | ×0,65 |
  | Normal | 20 | 150 | ×1 |
  | Difícil | 12 | 120 | ×1,5 |

- Elige una torre en la barra inferior y **pulsa sobre el prado** para colocarla.
  Las torres no se pueden poner sobre el camino. Si no te llega el oro, la torre
  aparece deshabilitada y no se puede seleccionar.
- **Pulsa una torre colocada** para ver sus estadísticas, subirla de nivel
  (hasta el 8, cada nivel más caro que el anterior), **especializarla** a partir
  del nivel 4, **elegir a quién dispara** o **venderla** por parte de lo
  invertido.
- Cada criatura eliminada da oro; la cantidad depende de su tipo.
- Cada criatura que llega al castillo **resta una vida y no da oro**.
- A partir de cierta oleada, algunas criaturas **abandonan el camino** y cruzan
  el prado en línea recta, y otras **dañan la estructura de una torre** al pasar
  junto a ella. Una torre sin estructura deja de disparar hasta que la reparas
  desde su panel, gastando oro.
- Cuando las vidas llegan a 0 aparece la pantalla de derrota con un botón para
  reintentar.

### Escenarios

| Escenario | Forma | Qué plantea |
| --- | --- | --- |
| Prado del Molino | 1 carril | Muchas curvas y un solo flujo. El sitio donde aprender. |
| Cruce de los Cuervos | 2 ramales | El camino se parte y se vuelve a juntar; las dos ramas miden lo mismo, así que cubrir una sola no basta. |
| Los Dos Portones | 2 entradas | Dos flujos opuestos hacia la misma meta: hay que montar dos defensas con el mismo oro. |
| Sendero del Faro | 1 carril | Un recorrido larguísimo, con pasillos de dos filas: cada enemigo pasa mucho tiempo bajo fuego y compensa concentrar el oro en pocos puestos. |
| Tres Senderos | 3 ramales | Se parte en tres tras una cabecera larga. Desatender un ramal cuesta un tercio de cada oleada. |

Los enemigos se reparten entre las rutas de forma alterna y determinista, y cada
uno recorre la suya de principio a fin. Cada escenario guarda **su propio
récord** por dificultad.

#### Campaña

El primer escenario está siempre abierto. Cada uno de los demás se desbloquea al
conseguir **al menos una estrella** en el anterior; los bloqueados siguen en la
lista, atenuados y diciendo qué hace falta para abrirlos.

Las estrellas de un escenario salen de la **dificultad más alta en la que hayas
ganado** en él: ⭐ en Fácil, ⭐⭐ en Normal, ⭐⭐⭐ en Difícil. Con cinco
escenarios, el total son 15. No se suman entre dificultades, así que ganar en
Difícil concede las tres directamente y no deja tareas pendientes que no
enseñan nada.

Solo cuenta **ganar**: llegar a la oleada 30 y morir en ella no da estrellas. El
menú principal y la pantalla de selección muestran tu total sobre el máximo.

### Entre oleadas

Antes de cada oleada, un aviso muestra **qué viene** (tipos, cantidad y si trae
voladores, atacantes de torres, criaturas que se salen del camino, acorazadas,
sanadoras o divisoras) y un botón para **llamarla antes de tiempo**. Cuanto antes
la llames, más oro de bonus.

### Especializaciones

Al llegar al **nivel 4**, cada torre elige una de **dos ramas**. La elección es
permanente durante la partida —vender la torre es la única vuelta atrás— y no
hace falta elegir para seguir subiendo de nivel.

| Torre | Rama A | Rama B |
| --- | --- | --- |
| Arqueras | **Ráfaga**: mucha más cadencia, menos daño por flecha | **Aguja**: perfora armadura |
| Cañón | **Metralla**: estrena daño en área | **Perforante**: perfora armadura y pega más fuerte |
| Mortero | **Asedio**: más radio y más alcance | **Demoledora**: perfora armadura, mucho más daño, menos radio |
| Torre de Hielo | **Ventisca**: congela a muchos más a la vez | **Fragilidad**: lo que congela recibe más daño de todas tus torres |
| Ballesta | **Vigía**: alcance enorme | **Virote de acero**: perfora armadura |
| Torre Mágica | **Cadena**: el rayo salta a dos enemigos más | **Sobrecarga**: golpe demoledor, más lento |

Tres efectos que no son solo números:

- **Perforación** ignora la armadura por completo. Es la respuesta a los gólems
  sin tener que cambiar de tipo de torre.
- **Cadena** salta al enemigo válido más cercano que ese disparo no haya tocado,
  respetando el dominio de la torre y sin repetir objetivo.
- **Fragilidad** convierte la torre de hielo en una torre de **apoyo**: por sí
  sola casi no mata, pero todo lo que congela recibe más daño de las demás.

Una torre especializada luce un estandarte dorado en el escenario.

### Prioridad de objetivo

Cada torre dispara a **Primero**, **Último**, **Más fuerte** o **Más cercano**.
La prioridad nunca rompe el dominio de la torre: un cañón sigue sin poder
disparar al aire aunque el objetivo prioritario sea volador.

### Habilidades

Se recargan solas y no cuestan oro.

| Habilidad | Efecto | Recarga |
| --- | --- | --- |
| ☄️ Meteoro | Se apunta a un punto del prado: 320 de daño en un radio amplio | 25 s |
| ❄️ Ventisca | Daño leve y congelación de 4 s a todo el mapa | 40 s |

### Récords

El juego guarda en el navegador la mejor oleada de cada **escenario y
dificultad**, y si llegaste a ganar. La pantalla de selección muestra el récord y
las estrellas de cada escenario; el menú principal, la mejor marca de la
dificultad elegida entre todos ellos y tu total de estrellas.

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

Una progresión de rata → araña → zorro → escarabajo → perro → jabalí en tierra, y
murciélago → águila → buitre en el aire, con limos, goblins, chamanes, orcos,
gólems y un jefe orco como gama alta. Cada oleada trae más criaturas, con más
vida y algo más rápidas que la anterior.

Además del daño y la velocidad, hay **rasgos que exigen cambiar de herramienta**,
no solo subir números:

| Rasgo | Quién lo tiene | Cómo se contrarresta |
| --- | --- | --- |
| 🛡 **Armadura** | Escarabajo, Gólem | Resta una cantidad fija a **cada impacto**, con un mínimo de 1. Castiga a las torres de muchos golpes pequeños y premia a las de golpe fuerte. Las habilidades la atraviesan. |
| ✚ **Sanación** | Chamán | Cura por área a los enemigos cercanos mientras vive. Hay que matarlo antes que al resto; la prioridad *Más fuerte* ayuda. |
| ◑ **División** | Limo | Al morir deja dos limillos más pequeños y rápidos donde cayó. Las crías no se vuelven a dividir. |
| ⚔ **Daño a torres** | Jabalí, Buitre, Orc, Gólem, Jefe Orco | Se paran a golpear la torre; hay que repararla desde su panel. |
| ⚠ **Fuera del camino** | Goblin, Jefe Orco | Cruzan el prado en línea recta. |

Una criatura acorazada se distingue por el marco metálico de su barra de vida, y
el chamán dibuja el alcance de su aura. El aviso de la próxima oleada señala qué
rasgos vienen antes de que lleguen.

### Controles

| Acción | Ratón / teclado | Táctil |
| --- | --- | --- |
| Mover la vista | Arrastrar | Arrastrar un dedo |
| Zoom | Rueda o botones `+` / `−` | Pellizcar o botones `+` / `−` |
| Ver el mapa entero | Botón `⤢` | Botón `⤢` |
| Colocar / seleccionar | Clic | Toque |
| Velocidad 1× / 2× / 3× | Teclas `1` `2` `3` o el selector | Selector del HUD |
| Llamar a la oleada | `Espacio` | Botón `¡Que vengan ya!` |
| Meteoro / Ventisca | Teclas `Q` / `W` | Botones de la barra lateral |
| Silenciar | Botón 🔊 | Botón 🔊 |
| Pausar | Botón `Menú` o `Esc` | Botón `Menú` |
| Mover el cursor de celda | Flechas | — |
| Colocar / seleccionar en esa celda | `Enter` | — |

El juego **se puede jugar entero con el teclado**: el tabulador llega a todos
los botones y las flechas mueven un cursor sobre la rejilla que `Enter` confirma,
con el mismo efecto que un toque. La vista sigue al cursor si se sale de
pantalla. Con el foco sobre un botón, la tecla es del botón: los atajos del
juego no la interceptan.

Una región de anuncios comunica a los lectores de pantalla lo que un jugador
vidente ve de un vistazo: el comienzo de cada oleada, la pérdida de una vida y
el final de la partida.

Los enemigos que quedan fuera de la vista se señalan con **flechas en el borde**
de la pantalla, para que un mapa desplazable no te haga perder de vista una fuga.

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
  game/     Simulación pura: rejilla, escenarios y rutas, oleadas, torres y sus
            especializaciones, economía, habilidades, dificultad, campaña,
            cámara. Sin DOM ni canvas, por lo
            que se puede probar entera en Node. Los sonidos se encolan como
            eventos, no se reproducen.
  render/   Dibujo en canvas: terreno precocinado, entidades y avisos de borde.
  ui/       HUD, barra de compra, panel de torre y entrada de puntero.
  audio/    Síntesis con Web Audio de los eventos que encola la simulación.
  storage/  Récords y preferencias en localStorage, a prueba de fallos.
public/     Manifiesto, iconos y service worker: instalación y modo sin conexión.
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
