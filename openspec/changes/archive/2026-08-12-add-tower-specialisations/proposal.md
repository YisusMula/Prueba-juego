# Especializaciones de torre

## Why

Mejorar una torre solo sube números. Con ocho niveles de "más daño, más
alcance", la decisión de mejorar es siempre la misma decisión, y una torre de
nivel 8 es la misma torre que era en el nivel 1, solo que más grande.

Esto se nota especialmente ahora que el bestiario exige contrajuego. Un gólem
con 14 de armadura deja a las arqueras haciendo daño simbólico, y la única
respuesta disponible es *construir otra torre distinta*. El jugador que ya ha
invertido 2.000 de oro en un puesto de arqueras no tiene ninguna forma de
adaptarlo: solo puede venderlo.

La vía que usan los tower defense de referencia para esto no es añadir más
torres al catálogo, sino **ramas de mejora**: a partir de cierto nivel, la
misma torre puede convertirse en dos cosas distintas. Eso multiplica la
variedad sin multiplicar la barra de compra, que ya tiene seis entradas y no
aguanta muchas más en un móvil.

## What Changes

### Especialización a mitad de la escalada

- Al llegar al **nivel 4**, cada torre ofrece **dos especializaciones**. El
  jugador elige una y la torre la conserva el resto de la partida.
- La elección es **irreversible**: es lo que la convierte en una decisión. Se
  puede deshacer vendiendo la torre, con la pérdida que eso supone.
- Sin elegir, la torre **puede seguir mejorando**: la especialización cambia lo
  que la torre hace, no es un peaje para seguir subiendo de nivel.

### Tres efectos nuevos

Cada rama tiene que cambiar *para qué sirve* la torre, no solo cuánto pega. Los
efectos nuevos son los mínimos para que eso se cumpla:

- **Perforación**: los disparos ignoran la armadura del enemigo. Es la
  respuesta que hoy falta a los acorazados.
- **Cadena**: el disparo salta a enemigos cercanos con daño decreciente.
- **Fragilidad**: los enemigos congelados reciben más daño de **todas** las
  torres, no solo de la que los congeló.

### Las doce ramas

| Torre | Rama A | Rama B |
| --- | --- | --- |
| Arqueras | **Ráfaga**: mucha más cadencia, menos daño por flecha | **Aguja**: perfora armadura |
| Cañón | **Metralla**: gana daño en área | **Perforante**: perfora armadura y pega más fuerte |
| Mortero | **Asedio**: más radio de área y más alcance | **Demoledora**: perfora armadura, mucho más daño, menos radio |
| Torre de Hielo | **Ventisca**: congela a muchos más enemigos a la vez | **Fragilidad**: lo que congela recibe más daño de todas las torres |
| Ballesta | **Vigía**: mucho más alcance | **Virote de acero**: perfora armadura |
| Torre Mágica | **Cadena**: el rayo salta a dos enemigos más | **Sobrecarga**: mucho más daño, menos cadencia |

Cada torre tiene **una** rama antiarmadura salvo la de hielo y la mágica, cuyo
papel es el control y el daño puro respectivamente.

### Interfaz

- El panel de torre muestra la elección cuando toca, con el nombre y el efecto
  de cada rama, y después la especialización elegida como una etiqueta.
- La torre especializada se distingue en el escenario.

## Impact

- Afecta a `tower-system` y `hud-controls`.
- `Tower` gana la especialización elegida; `statsAtLevel` pasa a tener en cuenta
  los modificadores de la rama.
- Es aditivo: una torre sin especializar se comporta exactamente como hoy, así
  que ningún test existente cambia de significado.
