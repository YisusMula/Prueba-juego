# Evaluación independiente de EnRegla (repositorio `Prueba-juego/enregla`)

Fecha: 25-11-2026. Evaluador independiente. Leyenda de la evidencia: **[E]** lo comprobé ejecutándolo · **[C]** lo leí en el código o la documentación · **[I]** es una inferencia mía · **[W]** viene de una fuente web (citada).

---

## Veredicto

**Se podrá comercializar cuando se resuelvan los bloqueantes no técnicos (titular legal, contrato de encargo de tratamiento, impuestos y facturación, cobro real con Stripe, despliegue en producción con copias fuera del servidor) y se haya probado con 3 a 5 locales reales. Hoy no se puede cobrar a nadie.** Confianza: **alta (≈80 %)** en que hoy no se puede cobrar; **media (≈55 %)** en que el producto, tal como está, encuentre un hueco rentable.

Resumen para no técnicos: el software está mucho mejor hecho de lo normal en un producto en esta fase. Funciona, es seguro frente a lo más grave y tiene buen aspecto. Lo que falta es todo lo que rodea al software: no existe empresa titular, los textos legales están incompletos (en lugar de los datos del titular hay marcadores), el cobro nunca se ha probado contra Stripe real, no hay servidor en producción, no hay ningún cliente y nadie ha validado el producto con un bar o restaurante. Además compite en un mercado con alternativas consolidadas, y su ventaja principal es el precio (12 €/mes), que se puede copiar con facilidad.

---

## Tabla de puntuación

| # | Apartado | Nota | Justificación |
|---|---|---|---|
| 1 | Producto, propuesta y modelo de cobro | 7 | Problema real (registros del plan APPCC en papel) y propuesta clara. 12 €/mes por local con Stripe Checkout. Le faltan controles críticos habituales, como las temperaturas de cocinado y enfriamiento. |
| 2 | Mercado | 4 | Segmento muy grande, pero con competidores consolidados (Traqfood, Andy APPCC, Qamarero, SafetyCulture y apps gratuitas). La diferenciación es casi solo el precio, no hay canal de venta y no hay ninguna validación con clientes. |
| 3 | Legal y regulatorio | 3 | Las afirmaciones sobre la normativa son prudentes, pero falta el titular, el contrato de encargo de tratamiento (art. 28 RGPD), el IVA y la factura, y la constancia de que el cliente aceptó las condiciones. Una frase del PDF sobre la inalterabilidad de los registros es exagerada. |
| 4 | Calidad y completitud | 7 | Recorrí los flujos principales en el navegador, en móvil, tablet y escritorio. Pasan 75 tests de la web y 30 de 31 pruebas e2e (el fallo se debe a mi cambio de puerto), y axe no encuentra violaciones graves. No funciona sin conexión, no admite adjuntos, la carta de alérgenos solo está en español y no hay tipos de registro personalizables. |
| 5 | Seguridad y privacidad | 8 | No encontré fugas entre clientes (lo probé). CSRF, sesiones, contraseñas y PIN están bien resueltos y npm audit da 0 vulnerabilidades. Hallazgo medio: un encargado puede firmar registros en nombre de un empleado sin su PIN, y el PDF solo muestra el nombre del empleado. |
| 6 | Fiabilidad y operación | 6 | 266 tests del servidor contra PostgreSQL real, CI, y copia y restauración probadas. Pero nada está desplegado, la monitorización es manual, no hay copias fuera del servidor por defecto y no hay alertas de errores. |
| 7 | Negocio | 4 | El coste de servir a cada cliente es mínimo, pero el precio deja poco margen para pagar la adquisición de clientes (CAC). Hacen falta unos 150 a 250 locales de pago para un sueldo modesto. La rotación de bares (cierres y traspasos) es alta. |
| 8 | Camino al primer cliente | 5 | Lo pendiente es abordable (unas 3 a 6 semanas), pero corresponde sobre todo al propietario, a lo legal y a lo comercial, no a la parte técnica. |

---

## 1. Qué es el producto (según el código, no el marketing)

Es una aplicación web (SaaS) para bares, restaurantes, cafeterías y obradores pequeños de España. Sirve para llevar en digital los registros del sistema de autocontrol de higiene, el **APPCC** (Análisis de Peligros y Puntos de Control Crítico). [C][E]
- **Siete tipos de registro** [C] (`server/migrations/0001_init.sql`, CHECK de `records.type`): temperatura de equipos, limpieza por planes, recepción de mercancía, aceite de fritura, plagas, incidencias y formación. A esto se suman la **carta de alérgenos** (14 alérgenos, versión imprimible y carta pública con QR) y los **informes PDF y CSV**.
- **Modo cocina** [E]: una tablet compartida y vinculada mediante un token de dispositivo. Cada persona elige su nombre e introduce un PIN, que es opcional. Lo recorrí en el navegador (`shots/kiosk-*.png`).
- **Registros de solo añadir** [C][E]: un trigger de PostgreSQL impide modificar o borrar registros, y las correcciones se guardan como enmiendas encadenadas.
- **Cobro** [C]: Stripe Checkout y portal de cliente, a 12 €/mes o 120 €/año por local, IVA no incluido. Prueba gratuita de 14 días sin tarjeta, una por cuenta. Si la prueba termina sin suscripción o hay un impago, el local pasa a solo lectura (`server/src/modules/billing/*`).
- **Origen** [C]: todo el producto lo escribió un agente de IA ("Claude") entre el 9 y el 11 de noviembre de 2026, sobre un repositorio que antes contenía un juego (`git log`). Hay varios commits etiquetados como "trabajo en curso, sin verificar". No hay ninguna señal de usuarios reales, de despliegue ni de validación con hosteleros.

## 2. Mercado

- **Tamaño** [W]: Hostelería de España habla de más de 300.000 bares, restaurantes y cafeterías ([qamarero.com/blog/cuantos-bares-hay-en-espana-cifras](https://qamarero.com/blog/cuantos-bares-hay-en-espana-cifras/) cita esa cifra; [Anuario Hostelería 2025](https://otea.es/wp-content/uploads/2025/12/ANUARIO-HOSTELERIA-2025.pdf)). Todos están obligados a tener un sistema de autocontrol. [I] Una parte grande lo resuelve con papel, con la plantilla de su consultora o con el módulo de su TPV. Si un 10 % pagara por una aplicación así, el mercado sería de unos 30.000 locales. Para un vendedor individual el techo práctico es mucho menor.
- **Competidores y precios** [W] (comparativa de 2026, de un tercero con interés comercial: [hackceleration.com](https://hackceleration.com/es/labs/mejor/software-appcc)):
  - **Traqfood** (grupo Mérieux NutriSciences): Starter a 19,99 €/mes en pago anual o 24,99 €/mes sin permanencia, 2 usuarios. Cubre el plan completo, admite sensores conectados y funciona sin conexión.
  - **Andy APPCC**: desde 24 €/local/mes, con etiquetado por lote y sensores en el plan Experto (85 €/mes).
  - **FoodDocs**: desde 79 $/mes, y genera el plan APPCC.
  - **SafetyCulture**: gratis hasta 10 licencias.
  - **Qamarero**: el APPCC va dentro de su TPV (desde 119 €/mes) ([qamarero.com/software-appcc-restaurantes](https://qamarero.com/software-appcc-restaurantes/)).
  - **Appticc**: 29 €/mes ([capterra.com/p/10045648/appticc](https://www.capterra.com/p/10045648/appticc/)).
  - Hay apps gratuitas, como "APPCC Check" en la App Store.
  - No verifiqué cada precio en la web oficial de cada competidor.
- **Diferenciación creíble** [I]: precio (entre un 40 y un 50 % por debajo de Traqfood), sencillez, modo cocina muy bien resuelto y carta de alérgenos incluida. Es débil como barrera: cualquier competidor puede bajar precio, y los TPV lo incluyen gratis o en paquete.
- **Huecos frente a la competencia** [C][E]:
  - no funciona sin conexión;
  - no admite sensores;
  - no hace etiquetado ni trazabilidad de elaborados;
  - no genera el plan APPCC;
  - no permite adjuntar documentos (certificados de la empresa de plagas, carnés de manipulador, albaranes);
  - no registra temperaturas de cocinado ni de enfriamiento.
- **Disposición a pagar** [I]: existe, porque los competidores cobran entre 20 y 85 €. A 12 € la objeción no es el precio sino la confianza ("¿quién está detrás?") y el cambio de hábito.
- **Canal de adquisición** [I]: el más plausible son las **consultoras APPCC y gestorías de hostelería**, como prescriptoras o revendedoras, y las asociaciones provinciales de hostelería. La venta directa por SEO o anuncios a 12 €/mes difícilmente recupera el CAC.
- **Barreras de entrada** [I]: técnicas, bajas. Comerciales, altas: confianza, relación con la consultora y la inercia del papel.
- **Conclusión**: no es un océano vacío ni está saturado sin remedio. Es un mercado **competido**, y el hueco que queda es "lo más barato y sencillo". Ese hueco solo es rentable con un canal de distribución barato.

## 3. Marco legal y regulatorio

**Qué cubre para el cliente**: le ayuda a documentar el autocontrol que exige el Reglamento (CE) 852/2004 (registros de su plan APPCC) y la información sobre alérgenos de los alimentos sin envasar (Reglamento 1169/2011 y RD 126/2015). El producto **no sustituye el plan APPCC**, y así lo dice [C] (`web/src/pages/legal/LegalPages.tsx:136-141`, FAQ de la portada).

**Afirmaciones del producto**:
- En general son **prudentes** ("plantillas orientativas", "no garantiza el resultado de ninguna inspección").
- **Exagerada**: el PDF que se entrega al inspector dice "Los registros no se pueden modificar ni borrar" [E] (`informe-mes.pdf`, página 1, y `server/src/modules/reports/pdf.ts`). Es falso en términos absolutos, por tres motivos:
  1. El propietario puede **eliminar el local con todos sus registros**, incluso de inmediato (`server/src/modules/orgs/routes.ts:271`, "Eliminar ya definitivamente").
  2. Con el despliegue por defecto, la app usa un único rol de base de datos, que **puede desactivar el trigger** de inmutabilidad. Lo probé [E]: `ALTER TABLE records DISABLE TRIGGER …; UPDATE …` → `UPDATE 1`. El endurecimiento de roles existe, pero es opcional (`docs/db-roles-hardening.sql`, README:253).
  3. Los registros no tienen sellado criptográfico ni firma del PDF.
  - Hay que reformularlo, por ejemplo: "no se pueden modificar desde la aplicación; las correcciones…".
- **Carta pública con QR** [W][I]: la normativa exige información de alérgenos por escrito y accesible ([AESAN](https://www.aesan.gob.es/en/AECOSAN/web/seguridad_alimentaria/subdetalle/alimentos_no_envasados.htm), [guía de Aragón](https://www.aragon.es/documents/20127/674325/GUIA%20ALERGENOS%20CON%20LOGO.pdf/de93a303-e415-8dbf-f60b-a7d449550b5c)). No encontré una postura oficial sobre si basta con un QR. El producto ofrece una versión imprimible, y conviene que la presente como el soporte principal y el QR como complemento.

**Riesgos y requisitos para quien lo vende**:
1. **Titular sin definir** [C][E]: los textos legales usan marcadores. El build de producción **falla a propósito** si faltan `VITE_LEGAL_OWNER_NAME`, NIF, dirección, etc. (lo comprobé: `vite build` aborta con la lista de variables). Es obligatorio por la LSSI (art. 10).
2. **No hay contrato de encargo de tratamiento (art. 28 RGPD)** [C]. El cliente (el restaurante) introduce datos personales de sus empleados: nombres, firmas en los registros, formación, PIN. El vendedor los trata **por cuenta del cliente**, es decir, como encargado del tratamiento. La política de privacidad solo contempla al vendedor como responsable (`LegalPages.tsx:79-125`). Sin un contrato de encargo (DPA), cliente y vendedor incumplen. Tampoco se mencionan transferencias internacionales (Stripe, y el proveedor de email si es de EE. UU.).
3. **IVA y facturación** [C]: el Checkout no activa `automatic_tax` (`server/src/modules/billing/provider.ts:76-97`), y la documentación lo deja como "según tu caso" (`docs/OPERACIONES.md:256`). Si los precios de Stripe se crean sin IVA, se emitirán facturas incorrectas. Falta también decidir cómo se emiten facturas conformes a la normativa española. **Verifactu** está aplazado (RDL 15/2025) al 1-1-2027 para sociedades y al 1-7-2027 para el resto, y hay noticias de un nuevo aplazamiento a 2028 sin confirmar [W] ([noticias.juridicas.com](https://noticias.juridicas.com/actualidad/noticias/20735-nueva-prorroga:-verifactu-no-sera-obligatorio-hasta-2027-para-sociedades-y-otros-contribuyentes/), [emprendedores.es](https://emprendedores.es/gestion/aplazamiento-verifactu-2028/)). Hay que confirmarlo con la gestoría.
4. **Aceptación de las condiciones sin constancia** [C]: la casilla "Acepto los términos" solo se valida en el navegador (`web/src/pages/auth/AuthPages.tsx:137`). El servidor no guarda ni la versión ni la fecha de lo aceptado (`server/src/modules/auth/routes.ts`), así que no hay prueba del contrato.
5. **Consumidores** [I]: el servicio está pensado para profesionales, pero las condiciones no lo dicen ni excluyen a consumidores. Si hubiera consumidores, se aplicaría el derecho de desistimiento. Basta con una cláusula.
6. **Responsabilidad** [C][I]: la limitación a "lo pagado en 12 meses" es razonable entre empresas. El riesgo reputacional real son los **alérgenos**: si el local se equivoca, el cliente final puede culpar a la herramienta. El producto lo mitiga, porque un plato nuevo no se publica sin revisión (`migrations/0004_allergen_review.sql`). Recomiendo además un seguro de responsabilidad civil profesional y de ciberriesgos.
7. **Conservación de registros** [I]: la obligación de conservarlos es del cliente. La app le permite borrarlo todo al instante. Conviene avisarle con claridad antes de permitirlo.

## 4. Calidad y completitud (comprobado en navegador)

- **Tests ejecutados** [E]:
  - Servidor: `vitest` con **22 ficheros y 266 tests en verde** (75 s, contra PostgreSQL real en la base `eval_test`).
  - Web: **75 tests en verde**.
  - `typecheck` y `lint` sin errores en el servidor y en la web.
  - e2e con Playwright: **30 de 31**. El único fallo (`04-lanzamiento.spec.ts:143`) compara con la URL fija `http://localhost:3100`. Falló porque yo lo ejecuté en el puerto 3501 (lo exigían las reglas de la evaluación), no por un defecto del producto.
  - El test de accesibilidad con **axe-core** (claro y oscuro) pasó al ejecutarlo aparte.
  - La demo en navegador (`build:demo` + `demo:check`): **39 de 39 pasos correctos**.
- **Recorrido manual** [E] (`shots/`): portada, inicio de sesión, "Hoy", registrar temperatura, historial, alérgenos, informes, ajustes, facturación y modo cocina en tablet, a 390 px y 1366 px, sin errores de consola. El aspecto es profesional, legible y consistente. El PDF de 30 días (14 páginas) es claro, con las alertas resaltadas en rojo (`informe-mes.pdf`).
- **Registro → verificación por email → inicio de sesión → alta del local** [E]: completado por API con un usuario nuevo y por e2e.
- **Lo que no se puede completar** [E]: **pagar**. Sin claves de Stripe la pantalla de facturación dice "Los pagos online aún no están disponibles" (`shots/escritorio-facturacion.png`). Todo el flujo de cobro solo se ha probado contra un Stripe simulado (`server/test/billing.test.ts:15`, `FakeStripeProvider`).
- **Huecos que echaría en falta un cliente de pago** [C][E]:
  1. **Sin modo sin conexión**: sin internet no se guarda nada y la app pide "anótalo y regístralo cuando vuelva" (`shots/kiosk-offline.png`). Además, el registro tardío queda con la hora de la anotación, no con la de la medición.
  2. **No registra temperaturas de producto, cocinado, enfriamiento o regeneración** (son puntos críticos típicos de un restaurante) ni permite tipos de registro o listas de comprobación personalizadas.
  3. **No permite adjuntar** fotos ni documentos (certificados, albaranes, carnés).
  4. **Carta de alérgenos solo en español**, cuando hay mucha clientela turista.
  5. Recordatorios solo por email (sin notificaciones push ni WhatsApp). No hay sensores ni etiquetado.
- **Accesibilidad** [E]: sin violaciones graves según axe en las pantallas principales. Botones grandes en el modo cocina y fuente de alta legibilidad.

## 5. Seguridad y privacidad (revisión propia)

Probé por mi cuenta, con un script contra el servidor en ejecución (`scripts/sec.mjs`):
- **Aislamiento entre clientes** [E]: con un segundo usuario y su propio local, todos los intentos de leer, exportar o informar sobre el local ajeno devuelven **404**: local, registros, registro individual, exportación y CSV. También fallan crear un registro en mi local con un equipo o empleado ajeno (404), enmendar un registro ajeno (404) y usar un cursor de paginación ajeno (lista vacía).
- **CSRF** [E]: una petición sin `X-Requested-With` y con `Origin` ajeno devuelve 403.
- **Fecha del registro** [E]: enviar `createdAt: 2020-01-01` no tiene efecto, porque el servidor impone su propia hora.
- **Dependencias** [E]: `npm audit --omit=dev` da 0 vulnerabilidades en el servidor y en la web.
- **Bien resuelto, según el código** [C]: contraseñas con argon2id; sesiones con el token guardado como hash y cookie `__Host-` httpOnly; CSP estricta; límites de peticiones en PostgreSQL; PIN con reserva atómica y bloqueo; webhook de Stripe con firma; logs con datos sensibles ocultos.
- **Hallazgos**:
  - **M1 — Suplantación de la firma del personal (medio)** [E]. Un propietario o encargado registra desde la web con `staffId` de "Ana Martín", que tiene PIN, **sin introducir su PIN**, y el servidor lo acepta (201). En el **PDF para la inspección solo aparece "Ana Martín"**; el usuario real solo figura en el CSV.
    - Código: `server/src/modules/records/routes.ts:61-75` (no comprueba el PIN) y `server/src/modules/reports/format.ts:25` (`signer` oculta el `user_name` cuando hay `staff_name`).
    - Prueba: `informe.pdf` (línea "22:16 … Ana Martín") frente a `informe.csv` ("Ana Martín";"Usuario Demo").
    - Daña la integridad de los registros, que es precisamente lo que se vende.
  - **M2 — Inmutabilidad no garantizada con el despliegue por defecto (medio-bajo)** [E]: un único rol de base de datos puede desactivar el trigger (ver apartado 3).
  - **B1 — Empleados sin PIN (bajo, por diseño)** [C]: el PIN es opcional, así que cualquiera con la tablet puede firmar como esa persona.
  - **B2 — Copias sin cifrar** [C]: las copias de seguridad contienen datos personales y se guardan sin cifrar; el envío fuera del servidor depende de que el operador lo configure (`deploy/backup.sh`).
  - **B3 — Token de la tablet en `localStorage`** [C]: es aceptable con esta CSP, pero si la tablet se pierde hay que revocarla a mano.

## 6. Fiabilidad y operación

- **Tests y CI** [E][C]: abundantes y contra PostgreSQL real, con CI en GitHub Actions (`.github/workflows/enregla-ci.yml`). Prueban lo que importa: aislamiento entre clientes, inmutabilidad, facturación (simulada), idempotencia, bandeja de emails y PDF. **No prueban** Stripe real, un SMTP real ni el despliegue con Docker.
- **Copias de seguridad** [E]: ejecuté `deploy/backup.sh` contra mi base y la restauré en otra base: 355 registros y 2 locales recuperados correctamente. La retención es de 14 días **en el mismo servidor** salvo que se configure `BACKUP_POST_HOOK`.
- **Despliegue** [C]: Dockerfile, docker-compose con Caddy (TLS automático) y una guía de operaciones muy completa (`docs/OPERACIONES.md`). **No pude probar Docker** porque no está disponible en el contenedor. No hay ningún entorno desplegado.
- **Monitorización** [C]: solo `/healthz` y `/readyz`, más un monitor externo que hay que contratar a mano. No hay seguimiento de errores (tipo Sentry) ni métricas.
- **Coste de operación** [I]: un VPS de unos 5 a 10 €/mes, más SMTP transaccional (0 a 15 €), dominio y almacenamiento de copias (unos 5 €), da del orden de **20 a 40 €/mes fijos**, suficientes para cientos de locales. El coste marginal por local es de céntimos, más las comisiones de Stripe.
- **Persona sola en producción** [I], aproximadamente 4 a 8 h/mes sin incidencias:
  - actualizar dependencias y la imagen;
  - vigilar copias y monitor;
  - revisar cancelaciones y reembolsos manuales que señala la guía;
  - atender soporte por email.
  - El punto débil es la **guardia**: si el servidor cae durante el servicio de un sábado, nadie lo atiende.

## 7. Negocio

- **Precio**: 12 €/mes o 120 €/año por local, IVA aparte.
- **Ingreso neto por local** [W][I]: Stripe cobra un 1,5 % + 0,25 € por cargo y Billing un 0,7 % ([stripe.com/es/pricing](https://stripe.com/es/pricing)). En plan mensual quedan unos 11,5 €/mes; en anual, unos 9,7 €/mes equivalentes.
- **Coste de servir** [I]: menos de 0,5 €/local/mes en infraestructura. El soporte es el coste real: con unos 15 minutos al mes por local a 30 €/h salen unos 7,5 €. **El soporte se puede comer el margen.**
- **CAC plausible** [I]:
  - venta directa con anuncios: entre 100 y 300 € por cliente;
  - a través de consultoras con comisión recurrente del 20 al 30 %: menos coste inicial, pero un margen de unos 8 €.
  - Con una rotación mensual estimada del 2 al 4 % (cierres de bares), la vida media es de 25 a 50 meses y el LTV de unos 250 a 500 €. La venta directa con anuncios queda en el límite.
- **Punto de equilibrio orientativo** [I]:
  - costes fijos (unos 50 €/mes) más un seguro de responsabilidad civil y ciberriesgos (unos 40 €/mes): **unos 10 locales** cubren los costes de caja;
  - un sueldo modesto (2.000 €/mes) más la cuota de autónomo: **entre 200 y 250 locales**.
- **Riesgos de negocio**: competidores con marca (Mérieux) o TPV que regalan el módulo; dependencia de una sola persona; producto construido por IA sin feedback de usuarios (riesgo de que no encaje con lo que el inspector o la consultora piden de verdad).

## 8. Bloqueantes para cobrar al primer cliente (por orden de importancia)

1. **No hay titular legal ni datos legales.** Los textos legales tienen marcadores y el build de producción falla sin ellos: `web/.env.example` y `vite build` → "Define estas variables… VITE_LEGAL_OWNER_NAME…" [E].
2. **No hay contrato de encargo de tratamiento (art. 28 RGPD)** ni mención a transferencias internacionales: `web/src/pages/legal/LegalPages.tsx:78-125` [C].
3. **El cobro no existe en la práctica**: nunca se ha probado contra Stripe (ni en modo de prueba), y el IVA y la emisión de facturas están sin definir.
   - `server/test/billing.test.ts:15` usa un `FakeStripeProvider`.
   - `provider.ts:76-97`: sin `automatic_tax`.
   - Pantalla "Los pagos online aún no están disponibles" [E].
4. **No hay producción**: ni dominio, ni servidor, ni SMTP con SPF/DKIM, ni copia fuera del servidor, ni monitor externo. Nada de esto está desplegado [C]: `docs/OPERACIONES.md` es la guía, no la evidencia.
5. **Integridad de las firmas (M1)**: un encargado puede firmar como un empleado sin su PIN y el PDF lo oculta. Código: `records/routes.ts:61-75`, `reports/format.ts:25`. Prueba [E]: `informe.pdf` frente a `informe.csv`.
6. **Afirmación inexacta en el PDF** ("no se pueden modificar ni borrar"), con el despliegue por defecto de un solo rol: `reports/pdf.ts`, `README.md:253` [E].
7. **Validación con clientes**: ningún hostelero ni consultora ha usado el producto. No bloquea legalmente, pero cobrar sin un piloto es arriesgado [C] (`git log`).

## 9. Riesgos principales

| Riesgo | Tipo | Probabilidad | Impacto |
|---|---|---|---|
| No conseguir un canal de venta barato y quedarse en menos de 50 locales | Negocio | Alta | Alto |
| Un competidor o un TPV iguala el precio o regala el módulo | Negocio | Media | Alto |
| Sanción o reclamación RGPD por falta de DPA o mala gestión de datos de empleados | Legal | Media | Medio |
| Facturas sin IVA o no conformes | Legal y fiscal | Alta si no se configura | Medio |
| Reclamación por un incidente de alérgenos atribuido a la carta digital | Legal y reputacional | Baja | Alto |
| Un inspector o una consultora no acepta registros "firmados" sin firma verificable (M1) o sin hora real de medición | Producto | Media | Medio |
| Caída de internet en la cocina: registros perdidos o tardíos | Producto | Alta | Medio |
| Pérdida de datos por no tener copia fuera del servidor | Técnico | Baja a media | Muy alto |
| Caída en hora de servicio sin nadie de guardia | Técnico y operativo | Media | Medio |
| Deuda de mantenimiento de un código grande (unos 47.000 líneas) escrito por IA y no revisado por personas | Técnico | Media | Medio |

## 10. Plan mínimo hasta el primer cliente de pago

| # | Tarea | Esfuerzo | Responsable |
|---|---|---|---|
| 1 | Decidir el titular (autónomo o SL), darse de alta en Hacienda (IAE) y abrir cuenta bancaria | 1 a 2 semanas (calendario) | Propietario y gestoría |
| 2 | Revisión legal: aviso legal, privacidad, condiciones (solo profesionales, versión aceptada), **DPA del art. 28**, lista de subencargados y transferencias | 2 a 4 días de abogado (≈600 a 1.500 €) | Legal |
| 3 | Guardar en el servidor la aceptación de las condiciones (versión y fecha) y mostrar el DPA en el alta | 0,5 a 1 día | Técnico |
| 4 | Corregir M1: exigir el PIN del empleado o mostrar siempre "registrado por X en nombre de Y" en el PDF | 0,5 a 1 día | Técnico |
| 5 | Reformular la frase del PDF y aplicar por defecto los roles separados de base de datos en el compose de producción | 0,5 día | Técnico |
| 6 | Stripe: cuenta, precios con IVA y Stripe Tax o un tratamiento fiscal decidido con la gestoría, facturas, portal. Prueba completa en modo de prueba (alta, impago, cancelación, webhooks) y después en real | 2 a 3 días | Técnico y gestoría |
| 7 | Producción: dominio, VPS en la UE, SMTP con SPF/DKIM, copia diaria fuera del servidor y cifrada, monitor externo, alertas de errores. Ensayo de restauración | 2 a 3 días | Técnico |
| 8 | Piloto gratuito con 3 a 5 locales reales y una consultora APPCC durante 3 a 4 semanas, para medir qué falta (probablemente temperaturas de cocinado y enfriamiento, adjuntos y modo sin conexión) | 4 semanas (calendario) | Propietario y comercial |
| 9 | Implementar las 1 o 2 carencias que más pida el piloto (por ejemplo, un registro de temperatura de producto o un tipo personalizable) | 3 a 10 días | Técnico |
| 10 | Canal: acuerdo de prescripción o reventa con 1 o 2 consultoras APPCC y gestorías; página de contacto y soporte | Continuo | Comercial |
| 11 | Seguro de responsabilidad civil profesional y de ciberriesgos | 1 semana | Propietario |

Total realista hasta el primer cobro: **de 4 a 8 semanas de calendario**, de las cuales solo unos 7 a 15 días son de trabajo técnico.

## 11. Lo que no pude comprobar

- **Stripe real** (ni en modo de prueba): no hay claves y no debía crear cuentas.
- **SMTP real** (entregabilidad, SPF/DKIM): usé el transporte por consola.
- **Docker y Caddy** (TLS, red interna, servicio de copias del compose): Docker no está disponible en el contenedor.
- **Rendimiento con carga real** y con muchos locales: no hice pruebas de carga.
- **Validez ante una inspección real** de los registros y del PDF, ni si una carta solo por QR satisface a cada comunidad autónoma.
- **Precios de la competencia en sus webs oficiales**: los tomé de comparativas de terceros. Tampoco consulté la cifra oficial del INE (DIRCE) de 2025.
- **Calidad del contenido técnico** de las plantillas (rangos de temperatura citando el RD 1086/2020 y el RD 1021/2022): no lo contrasté con el BOE.

## Anexo: comandos y artefactos

- Servidor: `TEST_DATABASE_URL=…/eval_test npx vitest run` → 22 ficheros y 266 tests en verde.
- Web: `npx vitest run` → 75 en verde. `npm run typecheck` y `npm run lint` sin errores.
- e2e: `E2E_PORT=3501 E2E_DATABASE_URL=…/eval_e2e npx playwright test` → 29 pasan, 1 falla (por la URL fija de 3100) y 1 no se ejecutó; ejecutado aparte con `-g accesibilidad`, el de axe pasa.
- Demo: `npm run build:demo && npm run demo:check` → 39 de 39.
- Seguridad: `scripts/sec.mjs`. Navegador: `scripts/tour.mjs` y `scripts/kiosk.mjs`. Capturas en `shots/`. Informes en `informe.pdf`, `informe.csv` e `informe-mes.pdf`.
- Copia y restauración: `deploy/backup.sh` y después `pg_restore` → 355 registros restaurados.
- Todo se ejecutó sobre una copia en el scratchpad. El repositorio quedó sin cambios (`git status` limpio). Las bases `eval_*` se borraron y los servidores se pararon.
