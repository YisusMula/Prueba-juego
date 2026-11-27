# Plan hasta la comercialización de EnRegla

Fecha: 26 de noviembre de 2026.

## De dónde sale este plan

Reúne cuatro evaluaciones independientes hechas sin contexto previo del proyecto (informes completos en [`evaluaciones/`](evaluaciones/); las rutas de capturas que citan eran temporales y ya no existen):

1. **Viabilidad comercial**: veredicto "hoy no se puede cobrar; comercializable tras resolver bloqueantes no técnicos y un piloto con 3–5 locales". Notas: producto 7, mercado 4, legal 3, calidad 7, seguridad 8, operación 6, negocio 4.
2. **Auditoría experta de diseño y usabilidad**: usabilidad 7,5, diseño visual 8, modo cocina 7,5, accesibilidad 7,5, textos 8, documentos 6,5 (PDF 5,5).
3. **Test de usabilidad con cinco personas simuladas**: dueña de bar poco digital, cocinero en tablet, encargada con dos locales, comensal alérgico e inspectora de Sanidad. Facilidad de uso estimada (SUS) entre 62 y 80.
4. **Conversión y encaje del producto**: portada, activación, retención, huecos funcionales frente a las guías oficiales de autocontrol y frente a cinco competidores.

Los dos fallos técnicos principales de la evaluación de viabilidad (autoría de las firmas y la promesa de inmutabilidad del PDF) se han confirmado leyendo el código. El resto de hallazgos deben reproducirse antes de corregirlos; cada corrección lleva un test que falle sin ella.

## Qué significa "apto para comercializar"

EnRegla estará lista para cobrar cuando se cumplan **todas** estas condiciones:

1. Existe un titular legal con datos reales en los textos legales, contrato de encargo de tratamiento y condiciones para profesionales revisados por un abogado.
2. El cobro funciona con Stripe real, con IVA calculado y facturas conformes, probado de punta a punta en modo de prueba y con un pago real.
3. La aplicación está desplegada en la UE con dominio propio, correo autenticado, copias de seguridad cifradas fuera del servidor con restauración probada, y alertas que avisan al propietario si algo cae.
4. No queda ningún hallazgo crítico ni alto abierto de las evaluaciones.
5. Ningún registro puede quedar firmado a nombre de quien no lo hizo, y el PDF dice con exactitud quién registró y quién corrigió.
6. El PDF contiene lo que un inspector espera: datos del establecimiento, resumen, huecos señalados y verificación del responsable.
7. Cubre los registros que las guías oficiales piden a un restaurante (incluidos cocinado y enfriamiento) o permite crearlos como registros personalizados.
8. Un piloto de al menos 3 locales reales durante 2 semanas termina con estos resultados: cada local registra al menos 5 días de cada 7, ninguno pierde datos, y al menos 2 de los 3 dicen que pagarían.

## Resumen de fases

| Fase | Contenido | Quién | Duración |
|---|---|---|---|
| 0 | Decisiones del propietario | Propietario | 1 semana |
| 1 | Integridad de registros y seguridad alimentaria | Técnico | 3–4 días |
| 2 | Lo imprescindible para vender | Técnico | 3–4 semanas |
| 3 | Legal y fiscal | Propietario, abogado, gestoría, técnico | 3–5 semanas, en paralelo con la 2 |
| 4 | Producción | Técnico y propietario | 1 semana |
| 5 | Piloto con locales reales | Propietario y técnico | 3–4 semanas |
| 6 | Lanzamiento y canal de venta | Propietario y técnico | continuo |

Calendario orientativo: **10 a 14 semanas** hasta el primer cliente que paga. La mayor parte del tiempo es de calendario (trámites, abogado, piloto), no de desarrollo. El desarrollo suma unas **5 a 7 semanas** de trabajo técnico.

---

## Fase 0 — Decisiones del propietario (1 semana)

Nada de lo siguiente lo puede decidir el equipo técnico.

| # | Decisión | Opciones y recomendación |
|---|---|---|
| 0.1 | Nombre comercial | "EnRegla" choca con enregla.es (despacho de abogados) y enregla.app. Consultar la OEPM y elegir nombre y dominio antes de imprimir nada. El nombre se cambia en un solo ajuste. |
| 0.2 | Forma jurídica | Autónomo o SL, con gestoría. Condiciona el titular de los textos legales, el IVA y la facturación. |
| 0.3 | Precio | Hoy 12 €/mes o 120 €/año. La evaluación de conversión propone 15 €/mes (150 €/año) "todo incluido", −20 % por local desde 3 locales y alta asistida de 49 € (gratis en plan anual). Recomendación: decidirlo **después** del piloto, preguntando a los pilotos. |
| 0.4 | Canal principal | Consultoras APPCC (recomendado), empresas de control de plagas, asociaciones de hostelería. Si se eligen consultoras, la fase 6 incluye el panel de varios locales y el rol de asesor. |
| 0.5 | Alcance del primer lanzamiento | Solo España, solo profesionales (B2B), solo español en la app. La carta de alérgenos en inglés puede llegar después. |
| 0.6 | Captación de pilotos | Buscar 3–5 locales y, si es posible, una consultora APPCC dispuesta a probarlo. Empezar ya, en paralelo con la fase 1. |

---

## Fase 1 — Integridad de registros y seguridad alimentaria (3–4 días técnicos)

> **Estado: cerrada el 27 de noviembre de 2026** tras cuatro rondas de corrección y cuatro evaluaciones independientes; la última, sin hallazgos críticos ni altos. Quedan cuatro hallazgos bajos para la fase 2: actualización del servicio de mantenimiento (corregido en la documentación), eventos reservados que distinguen mayúsculas, variantes del nombre del proveedor en la recepción, y la auditoría de altas y cambios de rol hechos directamente en la base de datos. Informes en `/tmp` no conservados; resumen en el historial de commits.

Son los fallos que dañarían la confianza de un inspector o pondrían en riesgo a un comensal. Van primero.

| # | Problema | Evidencia | Corrección | Esfuerzo |
|---|---|---|---|---|
| 1.1 | Un encargado puede registrar desde la web a nombre de un empleado sin su PIN, y el PDF muestra solo al empleado | `server/src/modules/records/routes.ts` (alta web acepta `staffId` sin PIN); `server/src/modules/reports/format.ts` (`signer` oculta al usuario si hay empleado) | En la web, quien registra es siempre el usuario con sesión; si indica un empleado, queda como "registrado por X para Y" y se muestra así en app, PDF y CSV. | S |
| 1.2 | El PDF atribuye las correcciones al firmante original | `reports/format.ts` (`notes` usa `signer(r)`) | Autor de la corrección = usuario o empleado que la hizo, nunca el firmante del original. Formato "Firmó: X · Corrigió: Y". | S |
| 1.3 | En el PDF la corrección aparece encima del original | Captura del PDF en la auditoría experta | Ordenar siempre original → corrección, también con la misma hora. | S |
| 1.4 | La tablet sigue firmando con la última persona durante 3 minutos | `web/src/pages/kiosk/Kiosk.tsx` | Tras cada registro, volver a "¿Quién eres?" (o, como mínimo, cabecera grande "Registrando como Ana · ¿no eres Ana?"). Recomendación: proponer PIN por defecto al dar de alta personal. | S |
| 1.5 | No se puede corregir quién firmó ni deshacer un dato mal tecleado en la tablet | Test de personas y auditoría experta | Opción "Corregir" durante 2 minutos tras guardar en la tablet (crea una corrección, no borra). En la web, la corrección permite cambiar el firmante con motivo. | M |
| 1.6 | Recepción a 6 °C aceptada sin aviso: la temperatura máxima admisible viene vacía | Test de personas (`ux-personas`) | Máxima por defecto según el tipo de producto (refrigerado 4 °C, congelado −18 °C, configurable por proveedor) y preseleccionada. Aviso y acción correctora si se supera. | S |
| 1.7 | La carta pública marca con ✓ verde "No declara tus alérgenos", que un alérgico lee como "apto" | Auditoría experta (C3) y test de personas | Tono neutro, sin ✓ ni verde; texto "No se han declarado tus alérgenos en este plato. Confírmalo con el personal". Mismo criterio en la tabla imprimible. | S |
| 1.8 | El PDF afirma "los registros no se pueden modificar ni borrar" y el despliegue por defecto no lo garantiza | `reports/pdf.ts`; `docs/db-roles-hardening.sql` es opcional | Aplicar por defecto la separación de roles de base de datos (rol de ejecución sin permisos para alterar `records`) en los ficheros de despliegue, y reformular la frase del PDF con exactitud ("la aplicación no permite modificar ni borrar registros; las correcciones…"). | S |
| 1.9 | En iPhone no se pueden escribir temperaturas negativas en la web | `RecordForms.tsx`, `ConfigForms.tsx` (`inputMode="decimal"`) | Botón "±" junto a los campos de temperatura o reutilizar el teclado del modo cocina. Probar en un iPhone real. | S |
| 1.10 | Cualquiera puede salir del modo cocina o desvincular la tablet sin PIN, y "Salir" lleva a la web comercial | Auditoría experta (A6) | Pedir PIN o contraseña de encargado para salir y desvincular. | S |
| 1.11 | Un empleado nuevo tarda hasta 5 minutos en aparecer en la tablet | Test de personas | Refrescar la lista al mostrar "¿Quién eres?" y añadir "No estoy en la lista" con instrucciones. | S |
| 1.12 | Una lectura fuera de rango cuenta como tarea hecha y nada recuerda volver a medir | Auditoría experta (M5) | Estado "Hecho con alerta" distinto de "Hecho", y si la acción es "repetiré la medición", crear una tarea pendiente a los 30 minutos. Permitir varias acciones correctoras. | M |

**Criterio de salida**: tests que fallen sin cada corrección; PDF revisado a ojo con un caso de corrección y de registro por encargado.

---

## Fase 2 — Lo imprescindible para vender (3–4 semanas técnicas)

### 2A. El PDF como documento de inspección (4–5 días)

Es lo que el cliente enseña. Hoy obtiene un 5,5.

- Portada con datos del establecimiento: razón social, NIF, dirección y número de Registro Sanitario (RGSEAA), configurables en Ajustes.
- Resumen inicial: cumplimiento del periodo, número de alertas y si tienen acción correctora, incidencias abiertas.
- Huecos señalados: días y tareas sin registro marcados de forma visible (hoy no se ven).
- Limpiezas parciales señaladas.
- Agrupación por equipo dentro de cada tipo.
- "Página X de Y".
- Verificación del responsable: el propietario o encargado marca "revisado" un periodo (semanal o mensual); el PDF muestra "Verificado por … el …" y deja espacio para firma manuscrita.
- En Informes, poder ver qué tarea faltó cada día (hoy hay que deducirlo desde el Historial).

### 2B. Registros que piden las guías oficiales (4–6 días)

- **Cocinado y regeneración**: temperatura en el centro del producto (≥ 70 °C para regenerar según el plan genérico vasco; usar los valores de la normativa vigente y dejarlos configurables).
- **Enfriamiento rápido**: hora y temperatura de inicio y fin.
- **Registros personalizados**: el local crea su propio registro (lista de comprobación o valor con rango) para cubrir las fichas de su comunidad autónoma o de su consultor. Esto cubre también agua, mantenimiento y calibración de termómetros sin programar cada uno.
- Revisar todas las plantillas y rangos contra la normativa vigente (RD 1021/2022 y las guías de 2–3 comunidades autónomas) y anotar la fuente de cada valor.

### 2C. Funcionar sin conexión (5–8 días)

Cámaras y sótanos sin wifi son habituales, y dos competidores lo anuncian.

- Cola local en el modo cocina y en la web: el registro se guarda en el dispositivo y se envía al volver la conexión. El servidor ya admite reintentos sin duplicar (`Idempotency-Key`).
- La hora del registro la pone hoy el servidor, lo que protege contra fechas falsas. Al anotar sin conexión hay que guardar también la hora del dispositivo y marcar el registro como "anotado sin conexión", con un margen máximo (p. ej. 12 h) y aviso si el reloj del dispositivo no es coherente. El PDF lo indica.
- En la web, "Guardar" no debe quedar activo sin conexión si no hay cola.

### 2D. Activación: del registro al primer valor (3–4 días)

- Iniciar sesión automáticamente al verificar el email (hoy hay que volver a escribir email y contraseña; es el punto de mayor abandono).
- Primer día: en lugar de "Nada obligatorio hoy", una lista de primeros pasos (primera temperatura, vincular la tablet, descargar el primer PDF) con progreso.
- Plantilla del alta en el vocabulario del local (por ejemplo "Nevera" para bares) y botón para quitar equipos que no tiene.
- Descarga del PDF en móvil con confirmación visible y opción de abrirlo.
- Atajo "Marcar los que faltan como No contiene" al revisar alérgenos, con confirmación explícita.

### 2E. Retención por email (3–4 días)

Plantillas en `server/src/lib/emails.ts`; envío por la bandeja de salida existente.

- Bienvenida; día 1; día 3 si no hay registros; día 7 con resumen y enlace al PDF; día 11 (fin de prueba cerca); +7 y +30 días tras acabar la prueba.
- Alerta inmediata al propietario cuando un registro queda fuera de rango sin acción o queda una incidencia abierta.
- Resumen mensual para clientes de pago.
- Todos con baja de suscripción a los emails no esenciales.

### 2F. Portada y confianza (2–3 días + contenido del propietario)

- Sección "Quién está detrás" con nombre, ciudad y contacto real (lo aporta el propietario).
- Enlazar la demo interactiva y el PDF de ejemplo, que ya existen.
- Preguntas frecuentes que hoy faltan: validez ante Sanidad (con prudencia y citando la guía en que se basan las plantillas), dónde están los datos (UE) y cuánto se conservan, qué pasa sin wifi, alta asistida.
- Testimonios solo de pilotos reales y con su permiso; nunca inventados.
- Cambiar "Ver cómo funciona" por "Prueba la demo".

### 2G. Correcciones de diseño y accesibilidad (4–5 días)

De la auditoría experta, ordenadas por impacto:

- Botón "Cancelar" de "Corregir el registro" deformado en móvil; etiqueta "Pendiente de revisar" tapada a 1440 px.
- Modo solo lectura coherente: botones de "Hoy" desactivados con explicación, como ya ocurre en "pendiente de eliminación", y textos de Facturación sin contradicciones.
- Gráfico de Informes que no dependa solo del color (patrones o etiquetas), etiquetas de ejes legibles, día en curso sin rojo.
- Contraste de bordes de campos a 3:1 (hoy 2,1:1).
- Navegación móvil: Alérgenos visible sin pasar por "Más"/"Ajustes"; quitar duplicados en Ajustes.
- Tabla imprimible de alérgenos sin palabras partidas.
- Tablet en horizontal: botones "Entrar" y "Guardar con esta acción" visibles sin desplazar; textos de 13–14 px agrandados.
- Carta pública: alérgenos elegidos siempre visibles al desplazar; hora "Actualizado" en la zona del local; "Agua mineral" sin partir a 320 px.
- Resto de hallazgos medios y bajos de la auditoría experta.

**Criterio de salida de la fase 2**: una nueva ronda de evaluación independiente de diseño y usabilidad sin hallazgos críticos ni altos, y una revisión del PDF por una consultora APPCC o técnico de salud pública si se consigue.

---

## Fase 3 — Legal y fiscal (3–5 semanas de calendario, en paralelo)

| # | Tarea | Responsable | Esfuerzo o coste |
|---|---|---|---|
| 3.1 | Alta como autónomo o SL, cuenta bancaria | Propietario y gestoría | 1–2 semanas |
| 3.2 | Revisión de aviso legal, privacidad, términos y cookies; condiciones solo para profesionales | Abogado | 2–4 días; orientativo 600–1.500 € |
| 3.3 | Contrato de encargo de tratamiento (art. 28 RGPD): los clientes meten datos de sus empleados | Abogado | incluido en 3.2 |
| 3.4 | Lista pública de subencargados (alojamiento, correo, Stripe) y transferencias internacionales | Abogado y técnico | 1 día |
| 3.5 | Guardar qué versión de las condiciones y del contrato de encargo aceptó cada cliente y cuándo, y pedir la aceptación de nuevas versiones | Técnico | 0,5–1 día |
| 3.6 | IVA en Stripe (Stripe Tax o configuración manual) y emisión de facturas conformes | Técnico y gestoría | 2–3 días |
| 3.7 | Verifactu: confirmar con la gestoría la fecha que aplica y si la facturación de Stripe o un programa de facturación homologado lo cubre. No programar facturación propia | Gestoría | 1 consulta |
| 3.8 | Consulta escrita a Salud Pública de la comunidad del piloto sobre la validez de registros digitales y de la carta de alérgenos por QR | Propietario | 2–4 semanas de respuesta |
| 3.9 | Seguro de responsabilidad civil profesional y ciberriesgos | Propietario | 1 semana |
| 3.10 | Registro de marca del nombre elegido (OEPM) | Propietario | trámite |

---

## Fase 4 — Producción (1 semana)

| # | Tarea | Notas |
|---|---|---|
| 4.1 | Servidor en la UE y dominio | Con los ficheros de despliegue existentes (Docker, Caddy). Probarlos por primera vez de verdad: nunca se han ejecutado. |
| 4.2 | Separación de roles de base de datos activada | Ver 1.8. |
| 4.3 | Correo con SPF, DKIM y DMARC | Proveedor SMTP europeo; probar entrega a Gmail y Outlook. |
| 4.4 | Copias cifradas fuera del servidor | El script existe; falta el destino externo y el cifrado. Hacer un simulacro de restauración y documentarlo. |
| 4.5 | Monitorización | Monitor externo de `/readyz`, alertas de errores y de espacio en disco al teléfono del propietario. |
| 4.6 | Stripe | Productos, precios, webhook y reintentos según `docs/OPERACIONES.md`. Probar en modo de prueba todos los casos (alta, pago fallido, cancelación, reactivación) y luego un pago real propio. |
| 4.7 | Flujo de integración continua | Comprobar que se ejecuta en GitHub y pasa. |
| 4.8 | Plan de guardia | Qué hace el propietario si el servidor cae en hora de servicio; página de estado o mensaje de soporte. |

---

## Fase 5 — Piloto con locales reales (3–4 semanas)

- **Participantes**: 3–5 locales de distinto tipo (bar, restaurante, obrador) y, si es posible, una consultora APPCC.
- **Condiciones**: gratis durante el piloto a cambio de uso real y dos entrevistas. Contrato de encargo firmado desde el primer día.
- **Arranque presencial**: dar de alta el local y vincular la tablet con ellos, observando sin ayudar en lo posible.
- **Tareas observadas**: las del test de personas simuladas (informe en `ux-personas`), incluidas un comensal alérgico real leyendo la carta y, si se consigue, un técnico de Salud Pública leyendo el PDF.
- **Métricas**: días con registros por semana, tareas completadas, tiempo hasta el primer PDF, errores y correcciones, incidencias de conexión, contactos de soporte.
- **Entrevista final**: ¿lo seguiríais usando?, ¿cuánto pagaríais?, ¿qué falta?, ¿lo recomendaríais a otro hostelero?
- **Salida**: se cumple el punto 8 de "apto para comercializar". Se corrigen las 1–2 carencias que más pidan los pilotos antes de abrir el registro.

---

## Fase 6 — Lanzamiento y canal (continuo)

- Fijar el precio con lo aprendido en el piloto (decisión 0.3).
- Si el canal son consultoras: panel de varios locales y rol de asesor que pueda ver y verificar los registros de sus clientes (esfuerzo M, unas 1–2 semanas). Es lo que hace viable ese canal.
- Acuerdos con empresas de control de plagas y asociaciones de hostelería.
- Evitar publicidad de pago amplia: con este precio el coste por cliente no compensa.

### Después del lanzamiento (deseable, según demanda)

- Fotos y adjuntos (recepción, incidencias, certificados de plagas).
- Carta de alérgenos en inglés y otros idiomas; interfaz en otros idiomas para el personal.
- Trazabilidad por lote y etiquetado (imprescindible para obradores).
- Sensores de temperatura.
- Páginas con plantillas descargables para atraer visitas desde buscadores (la web es una aplicación de una sola página y hoy apenas se indexa).

---

## Riesgos que el plan no elimina

| Riesgo | Probabilidad | Impacto | Mitigación |
|---|---|---|---|
| No encontrar un canal de venta barato | Alta | Alto | Piloto con consultora; canal de plagas y asociaciones |
| Un competidor o un TPV iguala el precio o regala el módulo | Media | Alto | Diferenciarse por encaje con las guías autonómicas y por el canal de consultoras |
| Un inspector no acepta los registros digitales | Baja–media | Alto | Consulta escrita a Salud Pública (3.8) y PDF conforme (2A) |
| Incidente de alérgenos atribuido a la carta digital | Baja | Alto | Correcciones 1.7 y revisión obligatoria de platos; textos legales revisados |
| Una sola persona mantiene el servicio | Alta | Medio–alto | Monitorización y plan de guardia (4.5, 4.8); revisión humana del código antes de crecer |
| Unas 47.000 líneas escritas por IA sin revisión humana | — | Medio | Revisión de código por un desarrollador antes del lanzamiento abierto, empezando por autenticación, facturación y registros |

## Cómo se ejecutará la parte técnica

Cada fase técnica sigue el mismo proceso usado hasta ahora: reproducir el problema, corregirlo con un test que falle sin la corrección, verificación propia de todos los tests, y una evaluación independiente al final de las fases 1 y 2 (seguridad, diseño y usabilidad). Nada se da por terminado sin esa verificación.
