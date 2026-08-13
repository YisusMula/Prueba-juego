## ADDED Requirements

### Requirement: Aplicación instalable

El juego SHALL publicar un manifiesto de aplicación web con su nombre, una
descripción corta, el color de tema y de fondo, presentación a pantalla completa
y un conjunto de iconos.

Los iconos SHALL incluir al menos un tamaño grande y una variante *maskable*,
para que un lanzador que recorte el icono a su forma no muerda el dibujo.

El manifiesto SHALL estar enlazado desde el documento, junto al color de tema.

#### Scenario: El manifiesto describe la aplicación

- **WHEN** se consulta el manifiesto
- **THEN** declara nombre, nombre corto, descripción, color de tema, color de fondo y presentación a pantalla completa

#### Scenario: Hay iconos utilizables

- **WHEN** se consultan los iconos del manifiesto
- **THEN** existe al menos uno de 512 píxeles o más
- **AND** existe al menos uno declarado como maskable

#### Scenario: El documento enlaza el manifiesto

- **WHEN** se carga la página
- **THEN** el documento enlaza el manifiesto y declara el color de tema

### Requirement: Jugable sin conexión

El juego SHALL registrar un *service worker* que le permita cargarse y jugarse
sin conexión después de la primera visita.

Los recursos cuyo nombre incluya un hash de contenido SHALL servirse **desde la
caché primero**, ya que un nombre distinto implica un contenido distinto. El
documento principal SHALL pedirse **a la red primero**, con la copia guardada
como respaldo, de modo que una versión nueva del juego llegue a quien ya lo
había abierto.

Como el *service worker* se registra después de cargar la página, no controla
esa primera carga y sus recursos no pasan por él. Por eso la página SHALL
comunicarle qué recursos ha cargado, para que los guarde: sin ello, quien abra
el juego una vez y se quede sin red no podría jugar, porque en la caché no
habría ni el documento ni el código.

El *service worker* SHALL ignorar las peticiones que no sean `GET` o que no sean
del mismo origen.

Al activarse una versión nueva, el *service worker* SHALL borrar las cachés del
juego de versiones anteriores.

#### Scenario: Tras la primera visita el juego carga sin red

- **GIVEN** un jugador que ya ha abierto el juego una vez
- **WHEN** recarga la página sin conexión
- **THEN** la página se sirve desde la caché y el juego se puede jugar

#### Scenario: La primera carga también queda guardada

- **GIVEN** una primera visita al juego
- **WHEN** el service worker termina de instalarse
- **THEN** el documento y los recursos que la página cargó están en la caché

#### Scenario: Los recursos con hash se sirven de la caché

- **GIVEN** un recurso con hash ya guardado en la caché
- **WHEN** la página lo pide
- **THEN** se sirve desde la caché sin esperar a la red

#### Scenario: El documento se pide a la red primero

- **GIVEN** una versión nueva del juego publicada
- **WHEN** un jugador que ya lo tenía cacheado lo abre con conexión
- **THEN** recibe la versión nueva

#### Scenario: Las peticiones ajenas no se tocan

- **WHEN** llega una petición que no es GET o no es del mismo origen
- **THEN** el service worker no la intercepta

#### Scenario: Las cachés viejas se borran

- **GIVEN** una caché de una versión anterior del juego
- **WHEN** se activa una versión nueva del service worker
- **THEN** la caché anterior se elimina

### Requirement: El modo sin conexión nunca impide jugar

Si el navegador no soporta *service workers* o el registro falla, el juego SHALL
seguir funcionando con normalidad. El registro SHALL hacerse después de cargar
la página, para no competir por ancho de banda con lo que hace falta para
empezar a jugar.

#### Scenario: Sin soporte el juego funciona igual

- **GIVEN** un navegador sin soporte de service workers
- **WHEN** el jugador abre el juego
- **THEN** el juego carga y se puede jugar con normalidad

#### Scenario: Un registro fallido no rompe nada

- **GIVEN** un entorno en el que registrar el service worker falla
- **WHEN** el jugador abre el juego
- **THEN** el juego carga y se puede jugar con normalidad
