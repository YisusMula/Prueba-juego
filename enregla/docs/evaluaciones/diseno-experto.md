# Auditoría UX/UI experta: EnRegla (antes del lanzamiento)

Ruta de capturas: `/tmp/claude-0/-home-user-Prueba-juego/577971a8-32b7-5d95-841f-db222bfa3352/scratchpad/ux-experto/shots/` (abajo, `shots/…` = esa carpeta).
Marco: las 10 heurísticas de Nielsen, WCAG 2.2 AA (comprobaciones manuales y árbol de accesibilidad de Playwright) y criterios de uso en cocina (distancia, tamaño de toque, número de toques).
Instancia propia: puerto 3600, base `eval_ux1` (ya borrada), Chromium; tamaños 390×844, 1024×768, 768×1024 y 1440×900; temas claro y oscuro.

## Valoración global

Es un producto serio, sobrio y bien pensado, por encima de la media del sector. Lo que hoy frenaría la compra y el uso diario son unos pocos fallos en momentos críticos: meter temperaturas negativas en iPhone, que la tablet siga firmando con la última persona, que en la carta pública salga en verde «No declara tus alérgenos» y un PDF que a un inspector le parecerá un volcado de datos.

| Área | Nota |
|---|---|
| Usabilidad | 7,5 |
| Diseño visual | 8 |
| Modo cocina | 7,5 |
| Accesibilidad | 7,5 |
| Microcopy | 8 |
| Documentos (PDF 5,5 · carta 7,5) | 6,5 |

## Hallazgos priorizados

### Crítico

**C1. En iPhone no se pueden escribir temperaturas negativas en los formularios web.** Registrar → Temperaturas, Recepción y Corregir (móvil). El campo usa `inputMode="decimal"` (`web/src/features/RecordForms.tsx:254`, 489 y 503; también en `ConfigForms.tsx:112-115`). En iOS ese teclado no tiene el signo «−». El dueño o encargado que apunta el congelador (−19 °C) desde su iPhone no puede hacerlo. Tampoco puede configurar los límites del congelador, porque el formulario de equipos usa el mismo campo. El modo cocina sí lo resuelve con su teclado y la tecla «±». **Recomendación:** reutilizar el teclado del kiosco o poner un botón «±» junto al campo; para equipos de tipo congelador, interpretar el valor como negativo por defecto. Esfuerzo S. Captura del campo: `shots/m-light-registrar_temperatura.png`. El teclado de iOS no se puede capturar en Chromium; lo saco del código y del comportamiento conocido de iOS.

**C2. La tablet sigue firmando con la última persona durante 3 minutos.** Modo cocina, tablet. Después de guardar, la sesión de «Ana Martín» sigue activa (`IDLE_MS = 3 min`, `Kiosk.tsx:39`). La pantalla de resultado vuelve sola al inicio, pero conserva a la persona. En pleno servicio, el siguiente cocinero toca una tarea pendiente y registra con el nombre de Ana sin que nadie le pida identificarse. La firma es lo que da valor legal al registro y aquí se pierde sin que se note. **Recomendación:** olvidar a la persona al terminar cada registro, o al menos al volver al inicio. Si se quiere mantener la rapidez, mostrar en grande «Registrando como Ana · ¿no eres Ana?» en el teclado de temperatura y bajar el tiempo de inactividad a 30–60 s. Esfuerzo S. Capturas: `shots/k-tl-07-temp-9.png` y `shots/k-tl-10-result.png` (cabecera «Ana Martín · cambiar»).

**C3. La carta pública usa una marca verde con «No declara tus alérgenos».** Carta pública (móvil) con filtro activo. Los platos sin los alérgenos elegidos llevan una insignia verde con un ✓. «Entrecot a la brasa» y «Agua mineral», que no declaran ningún alérgeno, también salen en verde. Para una persona alérgica, verde con ✓ se lee como «apto». Es un riesgo para su salud y una responsabilidad para el local, aunque el texto sea prudente. **Recomendación:** usar un tono neutro (gris o azul) sin ✓ y un texto como «Sin tus alérgenos declarados · confirma con el personal». Reservar el verde para nada o quitarlo del todo. Esfuerzo S. Captura: `shots/m-carta-filtro-gluten-sulfitos.png`.

### Alto

**A1. En el PDF, la corrección aparece antes que el original, aunque el texto dice «a continuación».** Informe PDF, página 1. La fila amarilla «CORRECCIÓN…» va encima de la fila roja original, y la roja dice «ver la corrección a continuación». Un inspector que encuentra contradicciones en el documento desconfía de todo lo demás. **Recomendación:** colocar siempre el original y debajo su corrección, con una sangría o un conector visual. Esfuerzo S. Captura: `pdfimg/hi-01.png` (en la carpeta `ux-experto/`).

**A2. El PDF no tiene portada ni resumen y no parece un documento oficial de autocontrol.** Informe PDF, 14 páginas. Abre directamente con una tabla cronológica de temperaturas que mezcla todos los equipos. Le faltan:
- un resumen: % de cumplimiento, nº de alertas y cuántas tienen acción correctora, incidencias abiertas;
- los datos del establecimiento: razón social, dirección y nº de RGSEAA si lo tiene;
- la numeración «Página x de y»;
- un bloque de revisión y firma del responsable;
- una agrupación por equipo o una vista tipo hoja mensual, que es lo que el inspector conoce del papel.

Las limpiezas parciales («Parcial (4 de 5)») no se señalan, y «Completa (5 de 5)» se parte en dos líneas. El cumplimiento del 89 % que se ve en la app no llega al PDF. **Recomendación:** portada con un resumen de una página, después una sección por tipo y dentro por equipo; numeración «x de y»; pie con un identificador del documento; columnas que no partan los resultados. Esfuerzo M. Capturas: `pdfimg/hi-01.png`, `pdfimg/hi-02.png`, `pdfimg/inf-10.png` y `pdfimg/hi-14.png`.

**A3. El botón «Cancelar» de «Corregir el registro» se deforma en móvil.** Historial → detalle → Corregir (390 px). El botón queda aplastado y el texto sale vertical: «Ca / nc / el / ar». Es el flujo que más confianza necesita (corregir un registro legal) y parece roto. **Recomendación:** poner `shrink-0` y `whitespace-nowrap` en el botón, o moverlo al pie junto a «Guardar corrección». Esfuerzo S. Captura: `shots/fl-03-corregir.png`.

**A4. En la app del dueño no se puede guardar nada sin conexión.** Registrar (móvil) sin conexión. Aparece «no se podrá guardar nada hasta que vuelva internet», pero «Guardar» sigue activo y el error llega al pulsarlo. En cámaras de sótano o almacenes la cobertura es mala. El kiosco solo reintenta el último registro. **Recomendación:** una cola local de registros (ya hay claves de idempotencia) con el estado «Pendiente de enviar (2)». Como mínimo, desactivar «Guardar» o cambiar su texto cuando no hay conexión. Esfuerzo M–L. Captura: `shots/fl-09-offline-save.png`.

**A5. En el modo cocina no se puede deshacer ni corregir.** Resultado del modo cocina. Si alguien teclea 9 en lugar de 0,9, la pantalla dice «Guardado con alerta» y no ofrece «Me he equivocado». La corrección solo la puede hacer el encargado desde su cuenta. En la práctica, la alerta falsa se queda y al día siguiente se pierde tiempo. **Recomendación:** un botón «Corregir» durante 2 minutos en la pantalla de resultado, que cree la enmienda con el motivo «error al teclear» y la misma firma. Esfuerzo M. Captura: `shots/k-tl-10-result.png`.

**A6. Cualquiera puede salir del modo cocina o desvincular la tablet sin PIN.** Inicio del modo cocina, pie. «Salir del modo cocina» lleva a la web comercial (`/`) y «Desvincular esta tablet» solo pide confirmación. Un toque accidental con la mano húmeda, o un aprendiz curioso, deja la cocina sin tablet hasta que vuelva el encargado. **Recomendación:** pedir el PIN de un encargado o una pulsación larga para estas dos acciones, y que «Salir» lleve a una pantalla de bloqueo, no al marketing. Esfuerzo S. Captura: `shots/k-tpd-00-home-full.png`.

**A7. En «Informes» el gráfico de cumplimiento depende solo del color, y dos de sus colores casi no se distinguen.** Informes (escritorio y móvil, ambos temas). Verde 100 % frente a verde azulado 75–99 %: el contraste entre ellos es de 1,7:1 y para un daltónico son iguales. Además, el color de marca aparece aquí como si fuera un nivel del semáforo. El día en curso sale en rojo («menos del 50 %») aunque todavía no ha terminado. Las etiquetas de los ejes miden unos 8 px. **Recomendación:** escala de un solo tono o patrones; el día en curso en gris con rayas; etiquetas de al menos 11 px; añadir «N días con alertas». Esfuerzo S. Capturas: `shots/d-light-informes.png` y `shots/d-dark-informes.png`.

**A8. En solo lectura, la pantalla «Hoy» invita a registrar.** Prueba terminada, Hoy (móvil). «Temperatura» y «Otro registro» siguen activos, las tareas pendientes se pueden tocar y el texto dice «Puedes ir registrándolo». El usuario solo se entera del bloqueo al llegar al formulario. En «pendiente de eliminación» los botones sí se desactivan, así que los dos estados son incoherentes. En Facturación aparece «Tus datos y la prueba siguen funcionando con normalidad» justo debajo de «Modo solo lectura», que es una contradicción. Parte de esto viene de no tener configurada la pasarela de pago. **Recomendación:** un solo patrón para todos los bloqueos de escritura (desactivar y explicar una vez), y quitar los textos que se contradicen. Esfuerzo S. Capturas: `shots/st-ro-hoy.png`, `shots/st-del-hoy.png` y `shots/st-ro-facturacion.png`.

### Medio

- **M1. Alérgenos queda escondido en móvil.** Está en la barra lateral de escritorio, pero en móvil hay que ir a «Más» (que abre una página titulada «Ajustes») → «Carta de alérgenos». A la vez, Ajustes duplica «Informes» y «Carta de alérgenos». **Recomendación:** que la página de «Más» se titule «Más» y que «Alérgenos» aparezca en primer nivel; quitar los duplicados de Ajustes. Capturas: `shots/m-light-hoy.png` y `shots/m-light-ajustes.png`.
- **M2. En la lista de Alérgenos, la etiqueta se monta sobre el botón «Revisar».** A 1440 px, «Pendiente de revisar · no se muestra en la carta» queda tapada por el botón. «Editar» y «Eliminar» llevan el mismo peso visual en todos los platos (10 pares iguales) y crean ruido y riesgo de borrar por error. En móvil «Eliminar» es solo un icono; en escritorio lleva texto. Captura: `shots/d-light-alergenos.png`.
- **M3. Las cabeceras de la tabla imprimible de alérgenos parten las palabras.** «Crustác/eos», «Cacahu/etes», «Altramu/ces», «Molusco/s». Esta tabla se cuelga en el local y es lo primero que ve el inspector. **Recomendación:** cabeceras giradas 90° o `hyphens:auto` con `lang="es"`. Capturas: `shots/d-alergenos-imprimir.png` y `pdfimg/alg-1.png`.
- **M4. En tablet horizontal (1024 px), la app del dueño aprieta las tarjetas.** La barra lateral de 288 px más dos columnas dejan «Mesa / caliente» y «1 de 3 / controles · mín. / 63 °C» partidos en líneas cortas. **Recomendación:** una sola columna por debajo de unos 1200 px, o barra lateral plegable. Captura: `shots/t-light-hoy.png`.
- **M5. Un equipo fuera de rango aparece en «Hecho» con ✓ verde y a la vez con la insignia roja «Fuera de rango».** La señal es contradictoria. Además, «Repetiré la medición en 30 min» no genera ningún recordatorio ni tarea. **Recomendación:** dejar ese equipo en «Pendiente: volver a medir» hasta que haya una lectura correcta. Capturas: `shots/m-dark-hoy.png` y `shots/t-light-hoy.png`.
- **M6. El primer día, «Hoy» de un local nuevo se explica con jerga.** «Nada obligatorio hoy. Lo dado de alta hoy empieza a contar mañana» y la sección «Empieza a contar mañana / Dado de alta o reactivado hoy». No hay una guía de primeros pasos (vincular tablet, añadir personal, crear la carta). **Recomendación:** una lista de arranque con 4 pasos y un texto como «Hoy es tu primer día: prueba a registrar; mañana empezaremos a contar». Captura: `shots/ob-12-empty-hoy.png`.
- **M7. Después de confirmar el email hay que volver a iniciar sesión.** **Recomendación:** entrar automáticamente. Captura: `shots/ob-04-verified.png`.
- **M8. Vincular la tablet a mano exige pegar un código de 46 caracteres (`kd_…`).** Sin cámara o sin QR, es impracticable. **Recomendación:** un código corto temporal de 6 dígitos. Captura: `shots/m-light-cocina_vincular.png`.
- **M9. Los bordes de los campos tienen poco contraste (`--line-strong` #b9b2a3 sobre blanco: 2,1:1).** No cumple WCAG 1.4.11 (pide 3:1). En una cocina con mucha luz cuesta ver dónde se escribe. El tema oscuro da 2,08:1. Captura: `shots/m-light-registrar_recepcion.png`.
- **M10. En la carta pública, al marcar varios alérgenos se pierde de vista cuáles están activos.** La fila de alérgenos se desplaza en horizontal y desaparecen de la vista. **Recomendación:** un resumen fijo («Filtrando: Gluten, Sulfitos ×»). Además, la hora de «Actualizado» usa la zona horaria del móvil del comensal en lugar de la del local (12:30 frente a 11:30). Captura: `shots/m-carta-filtro-gluten-sulfitos.png`.
- **M11. Revisar un plato exige al menos 14 toques.** **Recomendación:** un atajo «Marcar los que faltan como “No contiene”» después de marcar los que sí contiene. Captura: `shots/m-dish-review-s2.png`.
- **M12. El campo «Temperatura» muestra el ejemplo «Ej.: 3,5» en gris grande y en negrita, y parece un valor ya escrito.** **Recomendación:** dejar el campo vacío y poner el ejemplo en la ayuda. Captura: `shots/m-light-registrar_temperatura.png`.

### Bajo

- **B1.** El nombre del local aparece dos veces seguidas en móvil (cabecera y antetítulo). El icono de gorro de cocinero no tiene texto visible. Captura: `shots/m-light-hoy.png`.
- **B2.** «toca para cerrarla» aparece también en escritorio. **Recomendación:** «ábrela para cerrarla». Captura: `shots/d-light-hoy.png`.
- **B3.** En «Informes» de un local nuevo aparecen un «—» gigante, «0 de 0» y un gráfico vacío, en lugar de un mensaje de estado vacío. Captura: `shots/ob-14-empty-informes.png`.
- **B4.** «Bar» y «Restaurante» usan el mismo icono en el alta del local. Captura: `shots/ob-07-onb-1-errors.png`.
- **B5.** Los campos de fecha del Historial y de Recepción se ven como «mm/dd/yyyy» en Chromium sin interfaz; hay que verificarlo en un dispositivo real en español. Captura: `shots/d-light-historial.png`.
- **B6.** En el modo cocina, la hora y el texto «Última: … (09:36)» miden 13–14 px y no se leen a 1–2 m. Captura: `shots/k-tl-01-home.png`.
- **B7.** El botón «Entrar» del PIN queda cortado en la tablet en horizontal (768 px de alto). Captura: `shots/k-tl-05-pin-wrong.png`.
- **B8.** En la acción correctora del modo cocina, en horizontal, hay que desplazarse para llegar a «Guardar con esta acción». Captura: `shots/k-tl-09-action-picked.png`.
- **B9.** El botón comercial «Activar suscripción» va en rojo de peligro. Captura: `shots/st-ro-hoy.png`.
- **B10.** El lector de pantalla lee «67 % 67 %» dos veces en el anillo de progreso, y los guiones «•» de las alertas del kiosco. Archivo: `aria-hoy.txt` (en la carpeta `ux-experto/`).

## Las 10 mejoras de mayor impacto (por impacto/esfuerzo)

1. Teclado con «±» o teclado propio para la temperatura en móvil (C1). Esfuerzo S.
2. Olvidar a la persona tras cada registro en el kiosco, o confirmar quién registra (C2). Esfuerzo S.
3. Quitar el verde y el ✓ de «No declara tus alérgenos» en la carta (C3). Esfuerzo S.
4. Ordenar original → corrección en el PDF (A1). Esfuerzo S.
5. Arreglar el botón «Cancelar» de Corregir (A3) y la etiqueta montada en Alérgenos (M2). Esfuerzo S.
6. Proteger con PIN «Salir» y «Desvincular» del kiosco (A6). Esfuerzo S.
7. Un solo patrón de bloqueo para el modo solo lectura y textos coherentes en Facturación (A8). Esfuerzo S.
8. Portada con resumen y agrupación por equipo en el PDF (A2). Esfuerzo M.
9. «Corregir» durante 2 minutos en el resultado del kiosco (A5) y recordatorio de volver a medir (M5). Esfuerzo M.
10. Cola sin conexión en la app del dueño (A4). Esfuerzo M–L.

## Qué está bien resuelto

- La identidad visual es sobria y profesional: tipografía con carácter, paleta cálida y buena impresión de calidad.
- «Hoy» responde de un vistazo a «¿qué me falta?»: progreso, alertas arriba y pendientes que llevan directo al formulario ya rellenado.
- El teclado del kiosco es grande (unos 70 px por tecla), con «±» y coma decimal y respuesta inmediata en verde o rojo según el rango.
- Si la temperatura sale de rango, se pide la acción correctora con propuestas en un toque: es el corazón del APPCC bien diseñado.
- Los registros no se borran: se corrigen con el motivo, quién y cuándo, y así se explica en la interfaz.
- La revisión de alérgenos obliga a decidir los 14, el plato queda «pendiente de revisar» y no se publica hasta entonces.
- La carta pública es clara, con aviso de contaminación cruzada, filtro «Soy alérgico/a a…» y estados «No apto» y «Trazas».
- El tema oscuro está cuidado de verdad, no es una simple inversión de colores.
- La accesibilidad de base es buena: `lang="es"`, enlace para saltar al contenido, foco visible de 3 px, nombres accesibles con contexto («Editar Croquetas de jamón»), gráfico con texto alternativo y «Ver como tabla», y movimiento reducido respetado.
- El microcopy es consistente: tuteo, español de España, formatos «3,5 °C» y «26 nov 2026», y mensajes de error con ejemplos.
- Los mensajes de estado vacío del alta (personal, platos) son útiles y cada uno lleva su botón de acción.
- El CSV usa «;» y BOM, así que se abre bien en Excel en español.
- No hay desplazamiento horizontal en ninguno de los tamaños probados.

## Lo que no pude evaluar

- Dispositivos reales: el teclado de iOS y Android (C1 viene del código), el tamaño de letra del sistema, VoiceOver y TalkBack reales (usé el árbol de accesibilidad), y la legibilidad real a 1–2 m con reflejos.
- El uso con guantes o con las manos húmedas (solo puedo valorar tamaños y separaciones).
- El pago con Stripe (no está configurado en esta instancia), los emails como pieza de diseño (solo salen en el registro del servidor), el recordatorio diario y los avisos de fin de prueba.
- Los flujos de invitar a encargados, varios locales a la vez y la exportación o borrado completos: solo los vi por encima.
- El rendimiento con mucho volumen (PDFs de 3 meses o más) y la impresión física real de la tabla de alérgenos.
- La validez legal del PDF ante cada comunidad autónoma.
