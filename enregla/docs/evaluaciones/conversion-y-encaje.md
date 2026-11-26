# EnRegla: evaluación de producto y crecimiento (26/11/2026)

Capturas en `/tmp/claude-0/-home-user-Prueba-juego/577971a8-32b7-5d95-841f-db222bfa3352/scratchpad/ux-negocio/shots/` (en adelante `shots/`).
Instancia propia en el puerto 3620 con la base `eval_ux3`, ya detenida y borrada. Recorrido completo en móvil (390 px): portada, registro, verificación, login, alta en 4 pasos, primera temperatura y PDF. También se vieron el modo cocina (tablet) y la facturación con la cuenta demo.

## Diagnóstico en 5 líneas
1. El producto está bien hecho y es usable: el modo cocina es bueno de verdad, las correcciones quedan auditadas y el PDF sale limpio. Del registro al primer PDF hay unos 15 pasos y menos de 5 minutos.
2. Es el más barato con precio público (12 € frente a 20–60 € de los competidores revisados), pero el precio no es una ventaja defendible: "barato y sencillo" lo copia cualquiera.
3. La portada no tiene prueba social ni demo enlazada, no dice quién está detrás y no responde a dudas como "¿vale ante Sanidad?", "¿dónde están mis datos?" o "¿me lo configuráis?". Para un hostelero que desconfía, eso pesa más que cualquier función.
4. Funcionalmente cubre lo básico del "control diario", pero faltan registros que piden las guías oficiales: cocinado, enfriamiento, regeneración, agua, mantenimiento/calibración, verificación del responsable y registros personalizables. Además no funciona sin conexión, y los competidores sí.
5. La retención depende de un único email diario a las 18:00 y de dos avisos de fin de prueba. No hay email de bienvenida, ni seguimiento durante el uso, ni recuperación de clientes perdidos, ni nada pensado para consultorías, que son el canal con más palanca.

## Hallazgos priorizados

### Crítico
| # | Hallazgo | Evidencia | Recomendación |
|---|---|---|---|
| C1 | **No hay ninguna prueba social ni señal de confianza.** La portada no tiene testimonios, logos, cifras, cara del fundador ni teléfono. El pie solo dice "Soporte: soporte@…". La competencia sí los muestra: Traqfood, logos y 8 testimonios; Andy, 3 testimonios con nombre y cargo; Qamarero, "4,9 en Google". | `shots/landing-desk-full.png`; `web/src/pages/public/Landing.tsx` (no hay ninguna sección de ese tipo) | Sin clientes se puede mostrar con honestidad: (a) un bloque "Quién está detrás", con foto, nombre, ciudad y teléfono o WhatsApp; (b) la **demo interactiva**, que ya existe en `web/dist-demo`; (c) el **PDF de ejemplo**, que ya existe (`dist-demo/informe-ejemplo.pdf`) y no está enlazado; (d) la referencia a las guías oficiales en las que se basan las plantillas; (e) en cuanto haya 3–5 pilotos gratuitos, sus citas con nombre del local. Nunca testimonios inventados. |
| C2 | **No hay modo sin conexión.** La FAQ dice "anótalo y regístralo en cuanto vuelva". En cámaras, sótanos y obradores el wifi suele fallar. Traqfood y Andy anuncian modo sin conexión. | FAQ "¿Y si se cae internet?" (`Landing.tsx`); `useOnline.ts` solo muestra el aviso | Cola local de registros con la hora del dispositivo y marca de "sincronizado más tarde". El servidor ya trabaja con idempotencia (`records/idempotency.ts`), así que la base existe. Esfuerzo M. |
| C3 | **Faltan registros que exigen las guías: cocinado, enfriamiento, regeneración y agua.** El plan genérico vasco pide en el control diario el enfriamiento rápido, la regeneración (≥70 °C en el centro), el mantenimiento en caliente y el cambio de aceite, y el cloro diario si el agua es de suministro propio. EnRegla solo tiene 7 tipos fijos y no deja crear registros nuevos. | `server/src/schemas/index.ts` (`RECORD_TYPES`); [Plan genérico de autocontrol en hostelería, Gobierno Vasco](https://www.euskadi.eus/contenidos/informacion/comedores_colectivos/es_def/adjuntos/Plan-generico-hosteleria.pdf) | Añadir los tipos "Cocinado/regeneración" (producto, T.ª en el centro) y "Enfriamiento" (producto, hora y T.ª de inicio y fin). Y, sobre todo, un **registro personalizable** (lista de comprobación o valor numérico con rango) para cubrir lo que pida cada comunidad autónoma o cada consultor. |

### Alto
| # | Hallazgo | Evidencia | Recomendación |
|---|---|---|---|
| A1 | **Hay que volver a iniciar sesión tras verificar el email.** Al pulsar el enlace aparece "Entrar y configurar mi local" y un formulario vacío en el que se vuelven a escribir email y contraseña. Es el punto de mayor abandono, porque mucha gente abre el correo en otro dispositivo. | `shots/act-03-verificado.png`, `shots/act-04-login.png` | Abrir sesión automáticamente al verificar, como mínimo en el mismo navegador, o rellenar el email. Valorar que se pueda empezar el alta antes de verificar. |
| A2 | **El primer día el panel dice "Nada obligatorio hoy".** Al terminar el alta, lo primero que ve el cliente es que no tiene nada que hacer, porque "lo dado de alta hoy empieza a contar mañana". Así se pierde el "momento ¡ajá!". | `shots/act-10-hoy.png` | El día del alta, mostrar una lista guiada: "Haz tu primera temperatura → vincula la tablet → descarga tu primer PDF", con progreso. Y poner un botón para descargar el PDF justo después del primer registro. |
| A3 | **El ciclo de vida por email es mínimo.** Plantillas existentes: verificación, recordatorio diario (por defecto a las 18:00, solo si hay pendientes), aviso de fin de prueba 3 días antes y el último día. **No hay** bienvenida, ni email el día 2 ("¿has vinculado la tablet?") o el día 7 ("tu primera semana: X registros, aquí tienes el PDF"), ni aviso por inactividad, ni resumen semanal o mensual para el dueño, ni recuperación a los 7 o 30 días de acabar la prueba, ni aviso de alerta en tiempo real cuando hay una temperatura fuera de rango. | `server/src/lib/emails.ts`; `server/src/modules/reminders/scheduler.ts` | Secuencia mínima: bienvenida a la hora 0, día 1 (tablet), día 3 (si no hay registros), día 7 (informe semanal con PDF adjunto), día 11 (fin de prueba con resumen de lo registrado), día +7 y +30 tras acabar la prueba. Resumen mensual para clientes de pago, que es lo que se percibe como "lo que pago". Alerta inmediata por email cuando algo sale fuera de rango. |
| A4 | **No responde dudas clave en la portada:** ¿lo acepta el inspector?, ¿dónde se alojan mis datos (RGPD, UE)?, ¿cuántos años se guardan?, ¿me lo configuráis?, ¿quién lo hace? La guía vasca pide conservar registros de **al menos 12 meses**. | FAQ de `Landing.tsx` | Añadir preguntas: "¿Lo acepta Sanidad?" (registros digitales legibles y no modificables, exportables a PDF, más un PDF de ejemplo), "¿Dónde están mis datos?" (servidor en la UE, copias de seguridad, exportación), "¿Cuánto tiempo se guardan?", "¿Me ayudáis a configurarlo?" (llamada de 15 minutos gratuita). |
| A5 | **No hay vista multi-local ni rol de consultor/auditor.** Solo existen los roles propietario y encargado, y cada local va aparte, sin panel conjunto. Las consultorías APPCC y los grupos pequeños (2–5 locales) no tienen dónde encajar. | `migrations/0001_init.sql` (rol `owner`/`manager`); `routes.tsx` | Rol "Asesor" de solo lectura y verificación en varios locales, con panel de cumplimiento entre locales. Es la base del canal de consultorías (ver Precio). |
| A6 | **El PDF no recoge datos que el inspector espera:** razón social/NIF, dirección, número de Registro Sanitario (RGSEAA/autonómico), firma o visto bueno del responsable del periodo, y la última revisión del plan. El local solo guarda nombre, tipo y zona horaria. | `pdfp-1.png` (`shots/`); tabla `organizations` | Añadir esos campos al local y un bloque de "Verificado por … el …" en el PDF, que el responsable firme desde la app (una verificación semanal, como la "revisión semanal" de Qamarero). |

### Medio
| # | Hallazgo | Evidencia | Recomendación |
|---|---|---|---|
| M1 | **El SEO no tiene recorrido.** Es una SPA con una sola página comercial indexable más las legales, y el contenido se pinta con JavaScript (solo un `<noscript>` resumido). No hay páginas que capten búsquedas como "plantilla registro temperaturas pdf", "hoja registro limpieza bar" o "APPCC bar obligatorio". | `dist/index.html`, `robots.txt`, `sitemap.xml` (4 URL) | Prerenderizar la portada y crear 10–20 páginas estáticas con plantillas descargables en PDF, cada una con su llamada a "hazlo digital". Es el canal orgánico más barato en este nicho. |
| M2 | **La carta de alérgenos solo está en español.** En zonas turísticas es justo donde el cliente extranjero la necesita. | `PublicMenu.tsx` (sin cambio de idioma) | Ofrecer los 14 alérgenos y la interfaz de la carta en inglés, francés y alemán. El nombre del plato lo traduce el local, o se deja como opcional. Esfuerzo S/M. |
| M3 | **No se pueden adjuntar fotos** a recepciones, incidencias, plagas (certificado de la empresa DDD) ni facturas. Traqfood fotografía etiquetas y Qamarero admite foto opcional. | No hay nada parecido en `schemas` | Adjuntar una foto comprimida en recepción, incidencia y plagas, y una carpeta "Documentos" para el certificado DDD, los análisis de agua y el plan APPCC en PDF. |
| M4 | **La interfaz solo está en español** y en las cocinas trabaja mucho personal extranjero. | No hay i18n | Ofrecer el modo cocina en inglés, árabe y rumano, por ejemplo. El modo cocina tiene poco texto, así que el coste es bajo. |
| M5 | Se pueden imitar firmas en el modo cocina: el PIN es opcional y "cada persona elige su nombre". Ante una inspección, la autoría vale poco. | `Landing.tsx` (KitchenBand) | Recomendar el PIN por defecto en el alta. |

### Bajo
| # | Hallazgo | Evidencia | Recomendación |
|---|---|---|---|
| B1 | La portada es visualmente buena: precio en la primera pantalla del móvil y llamada a la acción clara. Su CTA secundario, "Ver cómo funciona", lleva a 3 pasos en texto y no a una demo. | `shots/landing-mov-fold.png` | Cambiarlo por "Prueba la demo sin registrarte" (la demo ya existe) o por un vídeo de 60 s. |
| B2 | Rendimiento: 1 s en la instancia local; unos 165 KB comprimidos de JS más CSS en la portada. Caddy comprime (`deploy/Caddyfile`). Aceptable; no se ha pasado Lighthouse. | `dist/assets` | Prerenderizar (ver M1). |
| B3 | En esta instancia, sin Stripe, Facturación dice "escríbenos para activar". En producción hay que comprobar que el pago funciona de punta a punta. | `shots/demo-facturacion.png` | Prueba de pago real antes del lanzamiento. |

### Embudo de activación medido (móvil)
Portada → "Pruébalo" (1) → formulario de 3 campos + casilla + enviar (5) → abrir el correo y el enlace (1–2) → "Entrar y configurar" (1) → **volver a escribir email y contraseña** (3) → nombre del local + tipo + crear (3) → equipos "Siguiente" → limpieza "Siguiente" → personal "Terminar" (3) → "Ir al panel de hoy" (1) → Temperatura → equipo → valor → guardar (4) → Informes → PDF (2).
**Unas 24 interacciones y 8 campos.** Las plantillas por tipo de negocio son un acierto, porque cargan 3 equipos y 2 limpiezas sin escribir nada (`shots/act-06…09`). Lo que sobra son el doble login y el "Nada obligatorio hoy".

## Huecos funcionales

| Función | Por qué importa | Quién lo pide (fuente) | Imprescindible / deseable | Esfuerzo |
|---|---|---|---|---|
| Registros personalizables (lista de comprobación o valor con rango) | Cada comunidad autónoma y cada consultor tiene sus fichas; sin esto, el cliente sigue con papel para "lo demás" | Planes genéricos con apartados en blanco "para manipulaciones distintas" ([Euskadi](https://www.euskadi.eus/contenidos/informacion/comedores_colectivos/es_def/adjuntos/Plan-generico-hosteleria.pdf)); SafetyCulture se basa en plantillas propias ([Hack'celeration](https://hackceleration.com/es/labs/mejor/software-appcc)) | **Imprescindible** | M |
| Cocinado / regeneración (T.ª en el centro) | Punto de control crítico en cocina caliente; regeneración ≥70 °C | Plan genérico de hostelería de Euskadi (apartados 6.2 y "Control diario") | **Imprescindible** (restaurante) | S |
| Enfriamiento (hora y T.ª de inicio y fin, abatidor) | Punto de control crítico; enfriamiento rápido controlado | Euskadi (5.1, ficha de enfriamiento); [criterios de autocontrol para comidas preparadas, Valencia](https://seguridadycalidadalimentaria.fundacionusal.es/wp-content/uploads/guias/restauracion/criterios_autocontrol_establecimientos_comidas_preparadas_Valencia.pdf) | **Imprescindible** (restaurante y obrador) | S |
| Modo sin conexión | Cámaras y sótanos sin wifi; registro que se pierde = papel | Traqfood y Andy lo anuncian ([Andy, precios](https://andyapp.io/es/precios/); [Hack'celeration](https://hackceleration.com/es/labs/mejor/software-appcc)) | **Imprescindible** | M |
| Verificación o firma del responsable + datos del establecimiento en el PDF (NIF, RGSEAA, dirección) | Es lo que el inspector revisa: que alguien supervise | La guía vasca pide "Fecha del control / Firma" y una revisión anual; la "revisión semanal" de Qamarero ([Qamarero APPCC](https://qamarero.com/software-appcc-restaurantes/)) | **Imprescindible** | S |
| Agua (cloro residual) | Obligatorio si el agua es de suministro propio (pozo o depósito) | Control diario de Euskadi; [guía de autocontroles para minoristas, Diputación de Barcelona](https://seguridadycalidadalimentaria.fundacionusal.es/wp-content/uploads/guias/ccaa/guia_autocontrolesminoristas_diputacionbarcelona.pdf) | Deseable (imprescindible en el medio rural) | S (o vía registro personalizable) |
| Mantenimiento y calibración de termómetros | Plan de apoyo habitual; da credibilidad a las lecturas | Euskadi (controles anuales); Qamarero ("revisión de termómetros") | Deseable | S |
| Buenas prácticas mensuales (lista de comprobación) | Registro mensual en los planes genéricos | Euskadi ("Registro mensual de Control de Buenas Prácticas") | Deseable (cubierto si hay registros personalizables) | S |
| Homologación anual de proveedores | Revisión anual de proveedores | Euskadi ("registro anual de control de proveedores") | Deseable | S |
| Trazabilidad por lote y etiquetado (elaboración, caducidad secundaria) | Obradores y cocinas que preparan con antelación; es el producto estrella de los competidores | Andy y Traqfood (etiquetado con Brother) | Deseable (imprescindible para obrador y catering) | L |
| Fotos y adjuntos (etiqueta, albarán, certificado DDD, análisis) | Pruebas ante la inspección; documentación en un solo sitio | Traqfood (fotos de etiquetas), Qamarero (foto opcional) | Deseable alto | M |
| Panel multi-local y rol de asesor | Grupos y consultorías | Andy (descuentos desde 10 locales), Traqfood Manager (multisite) | Imprescindible para el canal de consultoría | M |
| Idiomas (modo cocina y carta de alérgenos) | Personal y clientes extranjeros | Inferido (no hay fuente directa) | Deseable | S/M |
| Sensores de temperatura | Elimina la lectura manual y da alertas fuera de horario | Qamarero, Andy Experto, Traqfood (JRI) | Deseable (diferenciador, no requisito) | L |
| Plan APPCC documental (generador) | Muchos no tienen plan escrito | FoodDocs (plan gratuito), [FoodDocs pricing](https://www.fooddocs.com/pricing) | Deseable; mejor vía alianza con consultoras | L |
| Exportación | Ya existe (PDF, CSV, exportación completa) | — | Cubierto | — |

## Comparativa de competidores

| Producto | Precio (sin IVA) | Prueba | Plataforma | Puntos fuertes | Puntos débiles | Fuente |
|---|---|---|---|---|---|---|
| **EnRegla** | 12 €/mes o 120 €/año por local, todo incluido | 14 días sin tarjeta | Web/PWA; tablet compartida con PIN | El más barato; modo cocina muy cuidado; correcciones auditadas; carta de alérgenos con QR; usuarios ilimitados | Sin modo sin conexión, sin registros personalizables, sin fotos, sin sensores, sin etiquetado, sin prueba social, solo en español | Código y recorrido propio |
| **Traqfood** (Francia, opera en España) | Starter 19,99 €/mes en anual (239,88 €) o 24,99 €; Manager 39,99 €/mes en anual o 44,99 € | 30 días | iOS, Android, navegador | Trazabilidad, fotos de etiquetas, impresora Brother, multisite en Manager, mucha prueba social ("nº1 en Francia") | Starter limitado a 2 usuarios y 1 local; temperaturas manuales | [traqfood.com/precios](https://traqfood.com/precios/) (verificado); [Hack'celeration](https://hackceleration.com/es/labs/mejor/software-appcc) |
| **Andy APPCC** (Intowin, España) | 24–85 € por local y mes en anual (34–95 € mensual) en 4 planes | 10 días | App; modo sin conexión; usuarios ilimitados | Etiquetado y trazabilidad, sensores (plan Experto), formación, descuentos desde 10 locales y franquicias | Caro para un bar; orientado a cadenas; pocas reseñas públicas | [andyapp.io/es/precios](https://andyapp.io/es/precios/) (verificado) |
| **Qamarero** (TPV con APPCC) | Sin precio publicado para el módulo (plan "Control"); TPV desde 119 €/mes según el comparador; sensores aparte | Propuesta a medida | TPV + móvil | Integrado con el TPV y el stock (mermas), sensores, foto, revisión semanal, 4,9 en Google | Solo tiene sentido si usas su TPV; venta consultiva; el PDF solo cubre temperaturas | [qamarero.com/software-appcc-restaurantes](https://qamarero.com/software-appcc-restaurantes/) (verificado) |
| **FoodDocs** (Estonia) | Plan gratuito de APPCC; Standard 69 £ por local y mes; Enterprise a medida; cuota de implantación | 14 días sin tarjeta | Web y app | Genera el plan APPCC; enfoque internacional | Caro; en libras/dólares; español no confirmado | [fooddocs.com/pricing](https://www.fooddocs.com/pricing) (verificado) |
| **SafetyCulture** (genérico) | Gratis hasta 10 licencias y 5 plantillas; Premium 24 $ por licencia y mes (anual) | Plan gratuito permanente | App + web | Plantillas personalizables, fotos, tareas, plan gratuito | No es específico de APPCC; precio por usuario | [Hack'celeration](https://hackceleration.com/es/labs/mejor/software-appcc) (no verificado en la web oficial) |
| **Papel + consultora** (el competidor real) | Fichas gratis de la comunidad autónoma; consultora con plan APPCC en pago único (no verificado) | — | Carpeta | Cero fricción, es lo que el inspector conoce | Registros incompletos o rellenados a posteriori | Fichas de [Euskadi](https://www.euskadi.eus/contenidos/informacion/comedores_colectivos/es_def/adjuntos/Control-diario.pdf) |

**Diferenciación real de EnRegla:** (1) precio de entrada claramente más bajo, con usuarios y tablets ilimitados; (2) un modo cocina más cuidado que la media (teclado propio, acciones correctoras a un toque); (3) carta de alérgenos con QR incluida, que los demás no destacan; (4) correcciones no destructivas y auditadas. Ninguna de estas cosas es una ventaja difícil de copiar. La diferenciación defendible tendría que venir de **cumplir exactamente con las fichas de cada comunidad autónoma** (plantillas por comunidad con referencia a su guía) y del **canal de consultores** (rol de asesor y multi-local).

## Precio, empaquetado y canal

**Precio.** 12 € está entre un 40 y un 70 % por debajo de Traqfood Starter y de Andy. No hace falta bajarlo, y probablemente esté dejando dinero sin cobrar. Recomendación:
- **Local**: 15 €/mes o 150 €/año. Mantener "todo incluido": es un buen argumento frente a los planes por módulos de Andy.
- **Grupo** (a partir de 3 locales): −20 % por local y panel multi-local.
- **Asesor/Partner**: gratis para la consultora, con panel de todos sus clientes, rol de verificación y marca blanca ligera en el PDF ("revisado por Consultora X"). Dos modelos posibles: la consultora revende a 15–20 € con margen, o paga 8 €/local al por mayor.
- **Alta asistida** opcional (49 € de pago único, o gratis en el plan anual): llamada de configuración + plantillas de su comunidad autónoma. Responde a "¿me lo instaláis?".
- **Prueba**: 14 días sin tarjeta está bien. Que se pueda alargar a 30 días si vincula la tablet o si viene de una consultora. Al terminar la prueba, el modo solo lectura actual es un buen gancho de recuperación: anunciarlo en la secuencia de emails ("tus 14 días de registros te esperan").

**Canales** (por orden):
1. **Consultoras APPCC y laboratorios** de análisis alimentario. Cada una gestiona decenas de locales, son a quien el hostelero hace caso sobre Sanidad, y hoy les cuesta revisar carpetas de papel. Requiere A5 y A6.
2. **Empresas de control de plagas (DDD).** Visitan cada local todos los meses y ya dejan un certificado. Es un canal de referidos natural: "deja tus certificados y registros en EnRegla".
3. **Asociaciones provinciales de hostelería y formadores de manipuladores de alimentos.** Llegan al dueño en el momento del curso obligatorio. Un descuento para asociados más una sesión en el curso da credibilidad sin tener clientes.
4. **SEO de plantillas** (M1): un canal de largo plazo y barato, que capta a quien hoy busca la ficha en PDF.
5. **Integración o alianza con TPV** (no Qamarero, que es competidor; TPV sin módulo APPCC): presencia en su catálogo de complementos. Inferido, sin validar.
Descartar de entrada la publicidad de pago de amplio alcance: a 12–15 € por local el coste de captar un cliente no sale a cuenta sin un canal de referidos.

## Lo no verificado
- Precios de SafetyCulture y del TPV de Qamarero (solo vienen del comparador Hack'celeration). Traqfood, Andy y FoodDocs se han verificado en sus webs oficiales. El modo sin conexión de Traqfood solo aparece en el comparador.
- Reseñas de usuarios de los competidores en Capterra o Google Play: Capterra devolvió 403 y no se han leído reseñas en detalle.
- Qué piden exactamente las guías de Madrid, Andalucía, Cataluña y Valencia, fila por fila. Solo se leyó con detalle el Plan Genérico de Euskadi. El RD 1021/2022 permite flexibilizar el autocontrol en minoristas, pero no se ha revisado su texto sobre registros.
- Si los inspectores aceptan registros solo digitales con firma "elegida" en una tablet. Se infiere que sí cuando son legibles, no modificables y exportables, pero no hay confirmación oficial.
- Precios de las consultoras APPCC, la vigencia del Kit Digital u otras ayudas, y el tamaño del mercado.
- Lighthouse/Core Web Vitals reales en producción; el comportamiento de Stripe (no estaba configurado en esta instancia).
- Nota operativa: el script de arranque e2e escribe `enregla/web/e2e/.runtime/server.log` y `seed.txt` dentro del repositorio (son ficheros de ejecución, no de código); mi ejecución los sobrescribió.
