# Test de usabilidad por tareas: EnRegla (simulación con 5 personas)

Fecha: 26/11/2026 · Instancia propia en :3610 con la base `eval_ux2` (ya borrada) · Build `web/dist` (al día con `src`) · Playwright con Chromium.
Capturas: `/tmp/claude-0/-home-user-Prueba-juego/577971a8-32b7-5d95-841f-db222bfa3352/scratchpad/ux-personas/shots/` (abajo, `shots/…`). PDF: `informe-30d.pdf`, `informe-7d.pdf` y las páginas pasadas a imagen en `pdf/` y `pdf7/` dentro de esa misma carpeta.

> **Aviso:** es una simulación. Las personas las ha interpretado un evaluador que veía el texto y los elementos de cada pantalla. Los tiempos son estimaciones para cada perfil, no medidas. Los toques sí se han contado.

## 1. Tabla resumen

| Persona | Tarea | Resultado | Toques/clics | Tiempo est. | Errores | Gravedad del problema principal |
|---|---|---|---|---|---|---|
| Carmen (móvil) | a) Entender la portada | Éxito | 0 (+ scroll) | 20–30 s | 0 | Baja ("APPCC" sale poco, y es mejor así) |
| Carmen | b) Registro, verificación y alta del bar | Éxito con dudas | 33 | 8–12 min | 2 (contraseña corta, PIN de 2 cifras) | Media (traducir "vitrina/cámara" a "nevera"; un aviso tapa los botones) |
| Carmen | c) "¿Está todo hecho hoy?" | Éxito | 0–1 | 5–10 s | 0 | Baja |
| Carmen | d) PDF del último mes en pantalla | Éxito | 3–4 | 45–90 s | 0–1 (duda entre "Mes pasado" y "Últimos 30 días") | Media (el PDF se descarga y no se abre; no sale aviso de descarga) |
| Jonathan (tablet) | a) Temperatura de la "cámara 2" | Éxito con dudas | 11 | 25–35 s | 0 (no está en la lista de personal hasta recargar) | **Alta** (un empleado nuevo no aparece y tampoco puede avisar) |
| Jonathan | b) 7 °C y acción correctora | Éxito parcial | 7 | 15–20 s | 1 (quiso marcar dos acciones y solo se guarda una) | Media |
| Jonathan | c) Limpieza de plancha y suelo | Éxito parcial | 4 + texto | 40–60 s | 1 ("plancha" no está; la escribe en observaciones) | Media |
| Jonathan | d) Pescado a 6 °C | **Fracaso de seguridad** (se guarda "Aceptada", sin aviso) | 6 + texto | 45–60 s | 1 (acepta un producto fuera de temperatura) | **Crítica** |
| Jonathan | e) Corregir la persona equivocada | **Fracaso** | 2 (cambiar persona) | 10 s y bloqueo | 1 (registro firmado por otro) | **Alta** (nadie puede corregir quién firmó) |
| Laura (escritorio) | a) Equipo, empleado con PIN y tablet | Éxito | ~18 | 4–5 min | 0 | Baja |
| Laura | b) Corregir un registro de ayer | Éxito en la app; el PDF lo atribuye mal | 4 + texto | 1–1,5 min | 0 | **Alta** (el PDF dice que corrigió el cocinero) |
| Laura | c) Por qué la semana pasada no llegó al 100 % | Éxito con ayuda/deducción | ~10 | 4–6 min | 0 | Media (no se puede bajar al detalle de "qué faltó") |
| Laura | d) Plato con alérgenos y carta con QR | Éxito | ~17 | 3 min | 0 | Media (no hay "resto = No"; la leyenda "Vacío: no declarado" confunde) |
| Laura | e) Cambiar de local, datos separados | Éxito | 2 para cambiar (+4 al crear) | 1–2 min | 0 | Baja |
| Pablo (móvil) | Qué puede pedir siendo alérgico al cacahuete y al sésamo | Éxito | 3 + desplazar | 30–45 s | 0 | Media (el texto "No declara tus alérgenos" genera dudas; a 320 px se rompe un nombre) |
| Inspectora | Fuera de rango, acciones y firmas en < 2 min | Éxito parcial (~3–4 min) | 14 páginas | 3–4 min | n/a | **Alta** (no hay resumen; hay lagunas que no se ven; la autoría de las correcciones es errónea) |

## 2. Por persona

### Carmen, 54 años, bar de barrio, móvil 390×844. SUS estimado: **68**
- **a) Portada** (`shots/c1-landing-fold.png`): en la primera pantalla tiene qué es ("registros de higiene… sin papeles"), el precio (12 €/mes, 14 días gratis, sin tarjeta) y la palabra "inspección". No necesita saber qué es "APPCC". **Se registraría**: "Si es gratis y no me piden la tarjeta, lo pruebo. Lo de la inspección es lo que me quita el sueño".
- **b) Alta** (`c3-registro-error.png`, `c7-onboarding2.png`, `c8-editar-equipo.png`, `c10-onboarding4.png`, `c12-pin-error.png`). Los errores de contraseña y de PIN se explican bien. Le cuesta que la plantilla traiga "Vitrina de tapas" y "Cámara frigorífica" cuando ella tiene "dos neveras", y en "Tipo" no hay ninguna opción "Nevera". No hay botón para borrar equipos (solo "Editar" y desactivar). Al acabar de verificar el email tiene que volver a escribirlo para entrar. El aviso "Equipo «Nevera de la cocina» guardado" sigue en pantalla dos pasos después y tapa "Atrás/Terminar".
  Cita: *"¿Cámara frigorífica? Yo tengo una nevera… bueno, le cambio el nombre."*
- **c) ¿Todo hecho hoy?** (`c16-hoy-demo.png`): el anillo "44 % · Quedan 5 de 9" y la lista "Pendiente" lo responden sin un solo toque. *"Vale, faltan cinco cosas y hay una alerta roja."*
- **d) PDF para la inspección** (`c17-informes.png`): Informes → (ya viene marcado "Últimos 30 días") → bajar → "Informe PDF". El archivo se descarga sin abrirse y no sale ningún mensaje. En el móvil tiene que encontrarlo en la barra de notificaciones o en Descargas. *"¿Ya está? ¿Dónde se ha guardado?"*
- **Sus 3 problemas:** (1) se descarga el PDF y no hay confirmación ni botón para abrirlo; (2) el vocabulario de la plantilla (vitrina, cámara, controles al día) no es el suyo; (3) el aviso que tapa los botones del asistente.

### Jonathan, 23 años, cocinero, tablet en horizontal 1024×768 y en vertical 768×1024. SUS estimado: **66**
- El modo cocina está muy bien resuelto para usarlo con prisa: botones de 72–156 px, teclado propio con ± y coma, verde o rojo al momento (`j5-temp-31.png`, `j22-vertical-teclado.png`), y en vertical también funciona (`j21-vertical-home.png`).
- **No aparecía en "¿Quién eres?"**: el encargado le había dado de alta, pero la tablet no lo muestra hasta recargar (la lista de personal se actualiza cada 5 minutos). Tampoco hay ninguna opción tipo "No estoy en la lista". Lo normal es que firme como "Luis Pérez", que no tiene PIN. *"No salgo… pues pongo a Luis, que no tiene clave."*
- **"Cámara 2"**: los nombres de la app ("Cámara de verduras y lácteos") no coinciden con la etiqueta de la puerta. Duda unos segundos.
- **b) 7 °C** (`j9-accion.png`, `j10-accion-sel.png`): el aviso "Fuera de rango, ¿Qué has hecho?" es muy claro. Pero la selección es única: al tocar "Repetiré la medición en 30 min" se desmarca "Puerta cerrada y revisada". Además, la cámara desaparece de "Pendiente" aunque la lectura esté mal, y nada le recuerda que vuelva a medir. *"He cerrado la puerta Y voy a volver a medir, ¿por qué solo me deja una?"*
- **c) Limpieza** (`j12-limpieza.png`): no existe la zona "plancha", así que marca "Suelos de cocina" y escribe "plancha limpia" en Observaciones. Tiene que confirmar "Guardar como parcial". Las filas de casillas miden 49 px y van pegadas unas a otras, más pequeñas que el resto del modo cocina, y con guantes es fácil equivocarse.
- **d) Pescado a 6 °C** (`j16-recepcion-6.png`, `j17-recepcion-guardada.png`): rellena proveedor, producto y 6 °C y marca "Sí, aceptada". **No sale ningún aviso** porque la "Temperatura máxima admisible" es opcional y está vacía. El aviso solo aparece si toca "Refrigerado (4 °C)" (`j18-recepcion-con-max.png`). En el panel y en el PDF consta como "Aceptada · 6 °C", sin marcar en rojo. *"Ha salido 'Hecho' en verde, pues bien."*
- **e) Persona equivocada** (`j19-cambiar.png`, `j20-registro-como-luis.png`): cambiar de persona es fácil ("· cambiar"), pero lo ya guardado se queda firmado por Luis. El quiosco no tiene "deshacer" y el formulario de corrección web no deja cambiar el firmante (`l11-corregir-sin-firmante.png`). Además, la identidad dura 3 minutos sin actividad, así que el siguiente compañero puede firmar con el nombre de Jonathan sin darse cuenta.
- **Sus 3 problemas:** (1) la recepción fuera de temperatura se acepta sin aviso; (2) no se puede corregir quién firmó (y no aparece si es nuevo); (3) una sola acción correctora y ningún recordatorio de volver a medir.

### Laura, 35 años, encargada con dos locales, escritorio 1440×900. SUS estimado: **80**
- **a)** Ajustes tiene una portada clara (`l2-ajustes.png`). Equipo, persona con PIN y tablet se hacen sin dudar. La vinculación con QR, que "solo se muestra esta vez", y el botón "Usar este dispositivo" son excelentes (`l6-codigo.png`).
- **b)** Historial → registro → "Corregir" → valor y motivo → guardar (`l8-detalle.png`, `l10-corregido.png`). En la app se ve bien. **En el PDF** pone "CORRECCIÓN… hecha… por Luis Pérez", cuando la hizo ella. Además, la versión corregida sale *antes* que la original, que dice "ver la corrección a continuación" (`pdf7/p-2.png`). *"¿Cómo que la corrigió Luis? Si he sido yo."*
- **c)** En Informes, con "Otras fechas" del 16 al 22 de noviembre, salen 92 % y la tabla por día (`l13-semana-pasada.png`, `l14-tabla.png`). Pero **no dice qué faltó**: tiene que ir al Historial, filtrar cada día y deducir que fueron limpiezas parciales (`l15-historial-16nov.png`). *"Ya sé qué días; ahora dime qué tarea."*
- **d)** Para el plato tiene que tocar las 14 decisiones una a una. No hay forma de marcar el resto como "No contiene" (`l18-plato-relleno.png`). La carta pública y el QR ya estaban activos (`l16-alergenos.png`). En la tabla imprimible la leyenda "Vacío: no declarado" puede leerse como "sin información" cuando en realidad significa "no contiene" (`l20-imprimir.png`). No hay un cartel de QR para las mesas, solo el QR pequeño de la tabla.
- **e)** El selector de local es claro (`l25-selector-2locales.png`) y el local nuevo no tiene registros, platos ni personal del otro (`l24-local2-alergenos.png`). Al cambiar de local siempre vuelve a "Hoy" aunque estuviera en otra pantalla.
- **Sus 3 problemas:** (1) el PDF atribuye mal la corrección; (2) no puede ver qué tarea faltó en el informe de cumplimiento; (3) los 14 toques por plato.

### Pablo, comensal alérgico al cacahuete y al sésamo, móvil 390×844 y 320 px. SUS estimado: **74**
- El filtro "Soy alérgico/a a…" funciona: "Pollo satay" sale como **"No apto"** en rojo (`p5-noapto-320.png`), y la opción "Ocultar platos que lo contienen" lo quita. Las trazas se señalan aparte (`p4-trazas.png`).
- Los chips de alérgenos van en una fila con desplazamiento horizontal: Cacahuetes y Sésamo quedan fuera de la pantalla y, al desplazar, deja de ver cuáles ha elegido (`p2-filtrado.png`). Ningún resumen dice "Filtrando: cacahuetes, sésamo".
- **Confianza:** la etiqueta verde "✓ No declara tus alérgenos", junto a "No se han declarado alérgenos en este plato. Consulta al personal" en el entrecot, suena a "no tenemos información". El aviso legal general es correcto, pero rebaja aún más la confianza. *"¿'No declara' quiere decir que no lleva o que no lo han apuntado?"*
- A 320 px, "Agua mineral" se parte en "Agu / a / min / eral" al lado de la etiqueta (`p4-trazas.png`). La cabecera fija del filtro ocupa un 35 % de la pantalla.
- **Sus 3 problemas:** (1) la redacción ambigua de "No declara"; (2) no ve qué alérgenos ha seleccionado; (3) el desbordamiento a 320 px.

### Inspectora de Sanidad (PDF de los últimos 30 días, 14 páginas en horizontal). Valoración tipo SUS: **62**
- El documento parece serio: título, local, periodo, tipos, nota de inmutabilidad, columnas de Firma y Acción correctora, filas fuera de rango en rojo y correcciones en amarillo con motivo (`pdf/p-01.png`, `pdf/p-12.png`). Las 7 temperaturas fuera de rango tienen acción correctora.
- **No hay resumen** al principio (incidencias, fuera de rango, días sin registro), así que para encontrar las 7 filas rojas tiene que pasar 8 páginas de temperaturas (224 filas). Tarda unos 3–4 minutos, más de los 2 que se proponían.
- **Las lagunas no se ven**: el 30/10 y el 11/11 no hay limpieza, pero el PDF no pone "no registrado"; solo se nota si alguien echa en falta la fila (`pdf/p-09.png`). Las limpiezas parciales no van resaltadas.
- La firma es el nombre que se eligió en la tablet, sin indicar si iba con PIN. La autoría de las correcciones es **errónea** cuando el registro original tenía firmante (ver Laura b). La recepción a 6 °C sale como "Aceptada" en blanco.
- Faltan datos que se suelen pedir: dirección, CIF o RGSEAA del establecimiento, "Página X de Y" y un espacio para la firma o visto bueno del responsable.
- Cita: *"Bien presentado, pero ¿dónde está el resumen de incidencias? Y aquí dice que lo corrigió el cocinero…"*

## 3. Problemas consolidados (por gravedad × frecuencia)

| # | Problema | Gravedad | Frecuencia | Pasos para reproducir | Captura | Recomendación |
|---|---|---|---|---|---|---|
| 1 | Una recepción refrigerada a 6 °C se acepta sin aviso si no se rellena la "Temperatura máxima admisible" (opcional) | Crítica (seguridad alimentaria) | Muy alta (en cada entrega, si hay prisa) | Modo cocina → Recepción → proveedor "Pescados del Puerto", producto, temperatura 6 → "Sí, aceptada" → Guardar | `shots/j16-recepcion-6.png`, `shots/j17-recepcion-guardada.png` | Poner una máxima por defecto en cada proveedor o categoría (pescado/carne 4 °C, o 2 °C para pescado; congelado −18 °C) y que salga ya preseleccionada; si se pone temperatura sin máxima, preguntar "¿Refrigerado o congelado?" |
| 2 | El PDF atribuye la corrección al firmante original ("hecha… por Luis Pérez") y no al usuario que corrigió. Además, cuando la hora es la misma, el orden se invierte y "a continuación" queda incorrecto | Alta (trazabilidad ante la inspección) | Cada corrección de un registro hecho en la tablet | Web → Historial → registro de tablet → Corregir → Guardar → Informes → PDF | `pdf7/p-2.png`, `shots/l10-corregido.png` | En `server/src/modules/reports/format.ts` (línea ~30), usar `user_name` para el autor de la corrección y separar "Firmó: X · Corrigió: Y". Ordenar el original antes que la corrección (por `created_at`, con desempate por `amends_record_id`) |
| 3 | No se puede corregir el firmante de un registro, ni en la tablet ni en la web | Alta | Frecuente en tablets compartidas | Tablet → elegir "Luis Pérez" por error → guardar → web → Corregir: no hay campo "Firmado por" | `shots/j20-registro-como-luis.png`, `shots/l11-corregir-sin-firmante.png` | Añadir "Persona que lo hizo" a la corrección (con motivo obligatorio) y un botón "Deshacer / no fui yo" de 10 s en la pantalla "Hecho" del quiosco |
| 4 | Un empleado recién añadido no aparece en la tablet hasta pasados hasta 5 minutos o recargar, y no hay opción "No estoy en la lista" | Alta (lleva a firmar con otro nombre) | Cada alta de personal | Web → Personal → Añadir → tablet → "¿Quién eres?" | `shots/j2-tras-tocar-camara.png` | Refrescar el contexto al abrir "¿Quién eres?" o cada 30 s; añadir "No estoy en la lista → avisa a tu encargado" |
| 5 | El PDF no tiene resumen ni marca los huecos (días sin limpieza ni controles) | Alta para la inspección | Cada informe | Informes → Últimos 30 días → PDF | `pdf/p-01.png`, `pdf/p-09.png` | Primera página con el resumen: % de cumplimiento, lista de fuera de rango con su acción, incidencias abiertas y días/tareas no registrados. Filas "NO REGISTRADO" en las tablas, "Página X de Y", datos del establecimiento (dirección, RGSEAA) y espacio para la firma del responsable |
| 6 | La acción correctora es de selección única, la lectura fuera de rango cuenta como tarea hecha y no hay recordatorio para volver a medir | Media | Cada alerta | Tablet → Temperatura → 7 → Siguiente → tocar dos acciones | `shots/j10-accion-sel.png`, `shots/j21-vertical-home.png` | Permitir varias acciones. Si se elige "Repetiré la medición", dejar la tarea pendiente o con un aviso de "volver a medir" a los 30 min |
| 7 | El informe de cumplimiento no deja ver qué tarea faltó | Media | Semanal (encargados) | Informes → Otras fechas → Ver como tabla | `shots/l14-tabla.png`, `shots/l15-historial-16nov.png` | Hacer que cada día o barra se pueda pulsar y muestre las tareas previstas que no se hicieron, con enlace al Historial filtrado |
| 8 | Redacción ambigua en la carta pública ("No declara tus alérgenos", "No se han declarado alérgenos") y en la impresa ("Vacío: no declarado") | Media (confianza del alérgico) | Cada comensal que filtra | /carta/… → elegir Cacahuetes | `shots/p2-filtrado.png`, `shots/l20-imprimir.png` | Usar "Sin cacahuete ni sésamo (según el local)" y, en los platos revisados sin alérgenos, "Sin alérgenos declarados por el local". En la leyenda impresa, "Vacío: no contiene" |
| 9 | En móvil, el PDF se descarga sin mensaje ni forma de abrirlo | Media | Cada inspección (momento de estrés) | Móvil → Informes → Informe PDF | `shots/c17-informes-fold.png` | Mostrar "Informe descargado · Abrir" o abrir el PDF en una pestaña nueva; subir el botón por encima del pliegue |
| 10 | El vocabulario de la plantilla del bar no es el del usuario (vitrina/cámara frente a nevera; no hay tipo "Nevera"); no se pueden borrar equipos en el asistente | Media | Cada alta de bar | Registro → Bar → paso 2 | `shots/c7-onboarding2.png`, `shots/c8-editar-equipo.png` | Añadir el tipo "Nevera / frigorífico", preguntar al principio "¿Cuántas neveras y congeladores tienes?" y poner un botón "Quitar" |
| 11 | En la limpieza no hay zona "Plancha" y las filas de casillas son pequeñas para usarlas con guantes | Media | Diaria | Tablet → Limpieza | `shots/j12-limpieza.png` | Incluir "Plancha / fogones / freidora" en la plantilla de cocina; filas de al menos 64 px con separación |
| 12 | La identidad dura 3 minutos en la tablet compartida | Media | Cambios de turno | Tablet → identificarse → otra persona registra antes de 3 min | `shots/j13-limpieza-guardar.png` (cabecera) | Volver a "¿Quién eres?" después de cada registro, o bajar el tiempo a 60 s y mostrar "Registrando como X" en grande en la pantalla de confirmación |
| 13 | Alérgenos: hay que decidir los 14 uno a uno | Baja-media | Cada plato | Alérgenos → Añadir plato | `shots/l18-plato-relleno.png` | Botón "Marcar los que faltan como No contiene" después de elegir los que sí lleva |
| 14 | Carta pública a 320 px: el nombre del plato se parte letra a letra; la cabecera fija ocupa ~35 %; los chips elegidos quedan fuera de la vista | Baja-media | Móviles pequeños | /carta/… a 320 px | `shots/p4-trazas.png`, `shots/p3-320.png` | Poner la etiqueta debajo del nombre en pantallas estrechas; cabecera plegable; resumen "Filtrando: …" |
| 15 | Un aviso tapa "Atrás/Terminar" en el asistente | Baja | Alta de local | Paso 2 → guardar equipo → Siguiente ×2 | `shots/c10-onboarding4.png` | Situar los avisos encima de la barra fija o cerrarlos al cambiar de paso |
| 16 | Después de verificar el email hay que volver a escribirlo para entrar | Baja | Una vez | Enlace de verificación → "Entrar y configurar mi local" | `shots/c5-verificado.png` | Rellenar el email o iniciar sesión automáticamente tras verificar |

## 4. Qué sale bien
- Portada: en 30 s se entiende qué es, cuánto cuesta (12 €/mes, prueba sin tarjeta) y para quién es.
- Registro: los errores de contraseña y de PIN se explican en el momento y en lenguaje claro.
- Panel "Hoy": responde "¿está todo hecho?" sin tocar nada (anillo, "Quedan 5 de 9", alertas arriba).
- Temperatura en el modo cocina: 4 toques, teclado propio grande, verde o rojo al instante; funciona en horizontal y en vertical.
- Flujo fuera de rango: pide "¿Qué has hecho?" con opciones rápidas y lo deja como alerta en el panel y en el PDF.
- Vinculación de la tablet: QR que se muestra una sola vez, nombre del dispositivo y desvinculación remota.
- Corrección en la web: guarda el original, pide el motivo y lo enseña bien en el detalle.
- Locales: selector claro y datos bien separados.
- Carta pública: el filtro por alérgeno muestra "No apto" y "Trazas" de forma visible y puede ocultar platos.
- El PDF parece un documento serio: tablas por tipo, rojo para lo fuera de rango, amarillo para las correcciones, firma en cada fila.

## 5. Limitaciones del método
- **Es una simulación**: un solo evaluador hizo de cinco personas y leyó cada pantalla como texto y capturas. No hay ojos, manos, guantes, vapor ni ruido reales. Los tiempos son estimaciones y las puntuaciones SUS son juicios del evaluador, no cuestionarios contestados.
- El "día siguiente" de Carmen se simuló con la cuenta demo (30 días de datos), no con su propio bar.
- El QR no se escaneó con una cámara real: la tablet se vinculó pegando el token. La descarga del PDF en móvil se ha razonado según cómo se comportan Android/iOS, no se probó en un dispositivo.
- Laura tenía un solo local en la demo y creó el segundo durante la prueba. La facturación (Stripe) no está configurada en esta instancia.
- El selector de fecha nativo se ve con el formato del Chromium sin interfaz (mm/dd/yyyy), que puede no ser el del dispositivo real.

## 6. Qué validar en un piloto (3–5 bares, 2 semanas)
Prioridades: (1) ¿los cocineros eligen su propio nombre o el que tiene menos fricción?; (2) ¿se rellena la máxima en las recepciones?; (3) ¿la dueña encuentra y abre el PDF delante del inspector?; (4) ¿qué entiende el comensal alérgico con "No declara"?; (5) la reacción de un inspector o técnico de Salud Pública ante el PDF.

**Guion breve de entrevista (15 min, al final de la primera semana)**
1. ¿Cómo apuntabais antes las temperaturas y limpiezas? ¿Qué os pedía el inspector la última vez?
2. Cuéntame la última vez que algo salió fuera de rango. ¿Qué hiciste y qué apuntaste?
3. ¿Ha pasado que alguien firme con el nombre de otro? ¿Por qué?
4. Si mañana viene Sanidad, ¿qué harías en el móvil? (que lo haga ahí mismo)
5. ¿Qué tarea de vuestra cocina no está en la app (plancha, campana, cortadora…)?
6. Del 1 al 10, ¿cuánto te fías de que esto te salve en una inspección? ¿Qué falta para el 10?

**Tareas observadas en el piloto (con el móvil o la tablet reales, cronometradas y grabando la pantalla, con consentimiento)**
- Cocinero con guantes: temperatura de apertura, una lectura fuera de rango y una recepción de pescado o carne (anotar si rellena la máxima).
- Cocinero nuevo dado de alta ese mismo día: identificarse en la tablet.
- Dueña: "Enséñame los registros del último mes como se los enseñarías al inspector" (desde el bolsillo hasta tener el PDF abierto).
- Encargada: "¿Qué no se hizo el martes pasado?" y "corrige el registro de ayer que apuntó mal Luis, que en realidad era de Jonathan".
- Comensal alérgico (3–5 personas reales, a ser posible de una asociación de alérgicos): "¿Qué pedirías?" y "¿Qué significa esta etiqueta?" con la carta a 320 y 390 px.
- Inspector o técnico de Salud Pública (1–2): "Busca en 2 minutos las incidencias del mes y quién las firmó" con el PDF impreso y en pantalla.

Métricas: tasa de éxito, tiempo hasta tener el PDF, % de recepciones con máxima, % de registros firmados por quien los hizo (contrastándolo con el turno), SUS real al final del piloto.
