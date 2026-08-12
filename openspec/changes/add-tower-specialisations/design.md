# Diseño

## Modificadores, no torres nuevas

Una especialización podría implementarse de dos formas.

**Un tipo de torre nuevo por rama.** Elegir "Aguja" convertiría la torre en un
tipo `archer-needle` con su propia entrada en el catálogo. Es lo más directo,
pero duplica doce veces la tabla de estadísticas: cada retoque de balance a las
arqueras habría que replicarlo en sus dos ramas, y la barra de compra tendría
que filtrar los tipos que no son comprables.

**Un modificador aplicado sobre el tipo base, elegida.** La rama es un pequeño
conjunto de multiplicadores y banderas que se aplican *después* de
`statsAtLevel`. El catálogo sigue teniendo seis torres, el balance por nivel se
toca en un solo sitio, y una torre sin especializar es literalmente el caso de
"modificador identidad".

La segunda además hace que la funcionalidad existente no cambie de
comportamiento: si `specialisation` es `null`, el cálculo es el de hoy.

## Por qué el nivel 4, y por qué irreversible

El nivel 4 está a mitad de los ocho niveles. Antes, el jugador todavía no sabe
a qué se enfrenta el puesto; después, ya habría gastado la mayor parte de la
inversión sin haber tomado ninguna decisión.

La irreversibilidad es lo que hace que sea una decisión y no un menú. Si se
pudiera cambiar de rama, la respuesta óptima sería siempre "cambiar a la rama
que le va bien a la oleada que viene", que no es una elección: es
mantenimiento. Vender la torre sigue siendo la vía de escape, y su coste
(el 40 % de lo invertido) es exactamente el precio de haberse equivocado.

**Elegir no es obligatorio para seguir subiendo de nivel.** Un peaje obligado
convertiría la especialización en un trámite en vez de en una decisión, y
bloquearía a un jugador indeciso en mitad de una oleada.

## Perforación: ignorar, no reducir

Una rama antiarmadura podría reducir la armadura a la mitad o ignorarla del
todo. Se ignora del todo porque el objetivo es que la rama sea *legible*: "esta
torre no nota la armadura" es una frase que el jugador puede usar para decidir.
"Esta torre nota la mitad de la armadura" obliga a hacer cuentas para saber si
merece la pena.

Reutiliza el `ignoreArmor` que ya usan las habilidades del comandante, así que
no hay una segunda ruta de cálculo de daño que mantener.

## Cadena: saltos con daño decreciente

El rayo encadenado salta al enemigo válido más cercano que aún no ha sido
alcanzado por ese disparo, con el daño reducido en cada salto. Dos detalles que
importan:

- El salto **respeta el dominio de la torre**, igual que la adquisición de
  objetivo: una torre que no puede atacar al aire tampoco encadena hacia un
  aéreo.
- Cada enemigo se alcanza **una sola vez por disparo**. Sin eso, dos enemigos
  juntos se rebotarían el rayo entre ellos hasta agotar los saltos, que es
  mucho más daño del previsto y además se ve mal.

## Fragilidad: un efecto sobre el enemigo, no sobre la torre

La rama "Fragilidad" de la torre de hielo hace que lo que congela reciba más
daño **de todas las torres**. Se modela como un estado del enemigo y no como
una propiedad de la torre de hielo, porque quien aplica el daño extra es la
torre que dispara después, no la que congeló.

Esto la convierte en la primera torre de **apoyo** del juego: por sí sola casi
no mata, pero multiplica lo que hacen las demás. Es la razón de que exista un
papel para una torre de daño casi nulo.

El multiplicador se aplica antes de la armadura, no después: si se aplicara
después, un enemigo con mucha armadura vería su daño reducido y luego
multiplicado, y la fragilidad valdría mucho más contra acorazados que contra el
resto — un acoplamiento entre dos mecánicas que no se pretende.

## Compatibilidad

Todo el sistema es aditivo. Una torre con `specialisation: null` recorre
exactamente el mismo código que antes de este cambio, con multiplicadores a 1 y
banderas a falso. Los tests existentes de disparo, mejora, venta y balance
siguen midiendo lo mismo.
