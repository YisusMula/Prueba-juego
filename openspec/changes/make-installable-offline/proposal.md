# Instalable y jugable sin conexión

## Why

El juego se sirve como una web, y eso se nota en dos sitios donde pierde frente
a cualquier juego de móvil:

**No se puede instalar.** Para volver a jugar hay que acordarse de la URL y
abrirla en el navegador, con su barra de direcciones comiéndose parte de una
pantalla que ya va justa. No hay icono en la pantalla de inicio, que es donde
un jugador de móvil busca las cosas.

**No funciona sin conexión.** En el metro, en un avión o con mala cobertura, el
juego simplemente no carga. Y no hay ninguna razón técnica para ello: la
verificación en navegador lleva varias iteraciones confirmando que la página
**no hace ni una sola petición externa**. Todo —código, estilos, sonido,
gráficos— se genera en el cliente. Lo único que hace falta para jugar sin red es
que el navegador se quede con lo que ya descargó.

Las dos cosas se resuelven con lo mismo, y encima el juego ya cumple los
requisitos difíciles: es estático, es pequeño (unos 25 kB comprimidos) y guarda
todo su progreso en el propio dispositivo.

## What Changes

### Instalable

- Un manifiesto de aplicación web con el nombre, los iconos, el color de tema y
  la presentación a pantalla completa, para que el navegador ofrezca añadirlo a
  la pantalla de inicio y se abra sin barra de direcciones.
- Iconos generados a partir del mismo dibujo que ya usa el favicon, incluida una
  variante *maskable* para que Android no lo recorte mal.

### Sin conexión

- Un *service worker* que guarda lo descargado y lo sirve cuando no hay red.
- **Los recursos con hash en el nombre se sirven desde la caché primero**: su
  nombre cambia con su contenido, así que uno cacheado nunca puede estar
  desfasado.
- **El documento se pide primero a la red**, con la copia guardada como
  respaldo. Al revés, una versión nueva del juego no llegaría nunca.
- Las versiones antiguas de la caché se borran al activarse una nueva.

### Sin sorpresas

- El *service worker* solo interviene en peticiones propias del mismo origen.
- Si el navegador no lo soporta, o el registro falla, el juego sigue
  funcionando exactamente igual: sin conexión no será jugable, que es la
  situación de hoy.

## Impact

- Capacidad nueva `app-delivery`: cómo se entrega e instala el juego.
- Añade `public/manifest.webmanifest`, `public/sw.js` y los iconos; el registro
  va en `src/main.ts`, entre try/catch.
- No toca la simulación ni la interfaz de juego.
