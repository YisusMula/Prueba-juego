# EnRegla — registros APPCC digitales para hostelería (SaaS multi-local)

Registros APPCC (autocontrol de higiene alimentaria) digitales para bares, restaurantes y pequeños obradores: temperaturas, limpieza, recepción de mercancía, aceite de fritura, plagas, incidencias, formación de manipuladores y carta de alérgenos, con informes PDF/CSV.

> Las plantillas y rangos que trae la aplicación son **orientativos**. Cada local debe revisarlos y adaptarlos a su propio plan de autocontrol; la herramienta no garantiza por sí misma el cumplimiento de la normativa.

- `server/` — API (Node 22, TypeScript estricto, Fastify 5, PostgreSQL + Kysely, zod, argon2id, pdfkit, nodemailer, Stripe).
- `web/` — frontend (React 19 + Vite + TanStack Query + Tailwind 4, PWA). Si existe `web/dist`, el servidor lo sirve con fallback SPA. Ver «Frontend» más abajo.
- `docs/API.md` — referencia completa de la API para el frontend.
- `docs/OPERACIONES.md` — **guía de operación**: primer despliegue paso a paso, copias de seguridad y restauración, actualización y vuelta atrás, monitorización, rotación de secretos, qué hacer si Stripe o el SMTP fallan.

## Arranque local

Requisitos: Node 22 y PostgreSQL 16.

```bash
# 1. Base de datos (ejemplo con un PostgreSQL local)
sudo -u postgres psql -c "CREATE USER enregla WITH PASSWORD 'enregla' CREATEDB;"
sudo -u postgres psql -c "CREATE DATABASE enregla_dev OWNER enregla;"
sudo -u postgres psql -c "CREATE DATABASE enregla_test OWNER enregla;"

# 2. Servidor
cd enregla/server
npm ci
cp .env.example .env          # valores de desarrollo listos para usar
npm run migrate               # (el servidor también migra al arrancar)
npm run seed:demo             # usuario y local de demostración con 30 días de datos
npm run dev                   # http://localhost:3000
```

Datos demo (`npm run seed:demo`, recrea los datos en cada ejecución):

| | |
|---|---|
| Usuario | `demo@example.com` |
| Contraseña | `Demo-EnRegla-2026` |
| Local | Restaurante La Demo (suscripción marcada como activa, carta pública activada) |
| Personal | Ana Martín (PIN 1234), Luis Pérez (sin PIN), Marta Gil (PIN 5678) |
| Kiosko | el script imprime un token `kd_…` para `Authorization: Bearer` |

En desarrollo los emails se imprimen por consola (`MAIL_TRANSPORT=console`), con sus enlaces.

Para el frontend con Vite, configura un proxy de `/api` a `http://localhost:3000` (así la SPA y la API comparten origen y la cookie funciona sin CORS). Si no usas proxy, añade el origen de Vite a `DEV_ORIGINS`.

### Scripts (`server/`)

| Script | Qué hace |
|---|---|
| `npm run dev` | servidor con recarga (tsx watch) |
| `npm run build` | compila a `dist/` |
| `npm start` | arranca `dist/server.js` |
| `npm run migrate` | aplica migraciones SQL pendientes (`migrations/NNNN_*.sql`) |
| `npm run seed:demo` | crea el usuario/local demo (se niega en producción salvo `ALLOW_DEMO_SEED=true`) |
| `npm test` | tests de integración (vitest) contra PostgreSQL real (`enregla_test`; se recrea el esquema) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | eslint (typescript-eslint con reglas de tipos) |

Los tests usan `TEST_DATABASE_URL` (por defecto `postgres://enregla:enregla@localhost:5432/enregla_test`). **Borran y recrean el esquema `public` de esa base**: no la apuntes a datos reales.

## Frontend (`web/`)

```bash
cd enregla/web
npm ci
npm run dev          # http://localhost:5173 (proxy de /api → http://localhost:3000; arranca antes el servidor)
```

El proxy de Vite mantiene la SPA y la API en el mismo origen: el navegador envía `Origin: http://localhost:5173`, que coincide con `APP_URL` del `.env` de desarrollo (CSRF). Para producción, `npm run build` genera `web/dist`, que el servidor sirve en su mismo puerto con la CSP estricta (sin scripts ni estilos inline; fuentes autoalojadas; nada de terceros).

| Script (`web/`) | Qué hace |
|---|---|
| `npm run dev` | servidor de desarrollo de Vite |
| `npm run build` | `typecheck` + build de producción (`dist/`, con service worker que nunca cachea `/api`) |
| `npm run typecheck` / `npm run lint` | TypeScript estricto / eslint (incluye `jsx-a11y` y prohíbe `dangerouslySetInnerHTML`) |
| `npm test` | pruebas unitarias (vitest + Testing Library) |
| `npm run e2e` | build + suite Playwright contra el servidor real (ver abajo) |
| `npm run screenshots` | capturas en móvil/tablet/escritorio, en claro y oscuro, en `docs/capturas/` (necesita el servidor e2e arrancado) |
| `npm run icons` | regenera los iconos PNG de la PWA desde el logotipo |
| `npm run og-image` | regenera la imagen social `public/og-image.png` |

- Marca: `VITE_APP_NAME` (por defecto "EnRegla"), leída solo en `src/config/brand.ts` y en `vite.config.ts` (título y manifiesto).
- **Datos legales del titular y contacto**: variables de entorno de compilación documentadas en [`web/.env.example`](web/.env.example):
  - Obligatorias para publicar: `VITE_LEGAL_OWNER_NAME` (nombre o razón social), `VITE_LEGAL_TAX_ID` (NIF), `VITE_LEGAL_ADDRESS`, `VITE_LEGAL_CONTACT_EMAIL`, `VITE_LEGAL_HOSTING_PROVIDER`, `VITE_LEGAL_LAST_UPDATED`.
  - Opcionales: `VITE_LEGAL_REGISTRY_DATA`, `VITE_LEGAL_HOSTING_LOCATION`, `VITE_LEGAL_EMAIL_PROVIDER`, `VITE_LEGAL_JURISDICTION`, `VITE_SUPPORT_EMAIL` (pie de la web, Facturación y pantallas de error) y `VITE_PUBLIC_URL` (canonical, Open Graph y `sitemap.xml`).
  - En desarrollo, lo que falte se ve como marcador resaltado. **`npm run build` (producción) FALLA** con la lista de variables que faltan, salvo que se pase explícitamente `VITE_ALLOW_PLACEHOLDER_LEGAL=true` (solo para e2e/CI; `npm run e2e` y el workflow de CI lo usan). En Docker se pasan como `--build-arg` (los compose las toman del `--env-file`).
- **SEO**: el build genera `robots.txt` (portada y legales indexables; app, cocina, carta pública, autenticación y API no) y, con `VITE_PUBLIC_URL`, `sitemap.xml` y el `link rel=canonical`. Imagen social propia `web/public/og-image.png` (1200×630, `npm run og-image` la regenera). `<noscript>` con la descripción, el precio y los enlaces legales.
- **Cifras**: la fuente de texto (Atkinson Hyperlegible) dibuja el cero con barra; las cifras 0–9 usan las de Bricolage (sin barra) mediante `unicode-range`.
- Los esquemas zod y constantes se importan directamente de `server/src/schemas` (alias `@shared/schemas`).
- `localStorage` solo guarda: el token del dispositivo de cocina (la tablet no tiene sesión; solo sirve para `/api/kiosk/*`, viaja en `Authorization` y se borra al recibir 401 o con «Desvincular esta tablet»; se revoca desde Ajustes → Dispositivos de cocina), el último local abierto y un indicador booleano de "hay sesión". La sesión real es la cookie httpOnly.
- Modo cocina: `/cocina`. Vinculación: `/cocina/vincular#token=…` (el QR que genera Ajustes lleva el token en el fragmento, que no llega al servidor).

### Pruebas e2e

Requisitos: PostgreSQL local con el usuario `enregla` (ver arriba; necesita `CREATEDB`), dependencias del servidor instaladas (`server/node_modules`) y Chromium de Playwright (ya presente en este entorno; versión de `@playwright/test` fijada a 1.63.0).

```bash
cd enregla/web
npm run e2e          # = vite build && playwright test --trace off
```

`e2e/start-server.mjs` arranca un servidor **aislado**: base `enregla_e2e` (se crea si no existe y se recarga con el seed demo), puerto 3100 con `APP_URL=http://localhost:3100`, el build de `web/dist` y `MAIL_TRANSPORT=console`. Los emails (con sus enlaces `#token=`) se escriben en `web/e2e/.runtime/server.log` y las pruebas los leen de ahí: no hace falta ningún cambio en el servidor. Variables opcionales: `E2E_PORT`, `E2E_DATABASE_URL`, `E2E_ADMIN_DATABASE_URL`. Todas las pruebas fallan si aparece un error de JavaScript o una violación de CSP en la consola.

Cobertura (además, `e2e/04-lanzamiento.spec.ts`): borrado diferido y restauración de un local y eliminación definitiva; plato pendiente de revisar que no sale en la carta y sí tras revisarlo; limpieza parcial; validación de 999 °C en web y cocina; PIN incorrecto rechazado al identificarse; recuperación de contraseña completa; invitación abierta con otra cuenta; portada (precio en la primera pantalla del móvil), SEO y páginas legales; y una pasada de **axe-core** (`@axe-core/playwright`) sobre las pantallas principales en claro y oscuro que falla con violaciones serias o críticas. Cobertura previa: registro → verificación por email → login → alta guiada; temperatura normal y fuera de rango con acción correctora → Hoy → Historial → enmienda; solo lectura (aviso, formularios deshabilitados, informes disponibles); ajustes (equipo, personal con PIN, invitación); modo cocina con PIN incorrecto y correcto, revocación del dispositivo; alérgenos + carta pública con filtro (sin peticiones a terceros) + versión imprimible; descarga de PDF y CSV; 404, sesión caducada con destino conservado y bloqueo de redirección abierta; cierre de sesión.

## Variables de entorno

Todas están documentadas en [`server/.env.example`](server/.env.example) y se validan con zod al arrancar. En producción el servidor no arranca si falta algo o si un secreto es débil. Las principales:

| Variable | Obligatoria en prod. | Descripción |
|---|---|---|
| `DATABASE_URL` | sí (o `PG*`) | PostgreSQL (contraseña ≥ 12 caracteres, no valores por defecto). Los caracteres especiales de la contraseña deben ir codificados para URL; alternativa: `PGHOST`/`PGPORT`/`PGUSER`/`PGPASSWORD`/`PGDATABASE` sin codificar (lo que usan los compose) |
| `APP_URL` | sí (https) | Origen público de la SPA: CSRF, enlaces de emails, retornos de Stripe |
| `APP_NAME` | no (`EnRegla`) | Nombre comercial visible en emails, PDF y textos |
| `SUPPORT_EMAIL` | no | Email de soporte que se añade al final de todos los emails |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM` | sí | Envío de email |
| `TRUST_PROXY` | según despliegue | Nº de proxies delante (`1`) o lista de IP/CIDR del proxy. **`true` está prohibido en producción** (ver «Detrás de un proxy») |
| `AUDIT_RETENTION_MONTHS` | no (`12`) | Meses que se conservan los eventos de auditoría |
| `UNVERIFIED_ACCOUNT_DAYS` | no (`7`) | Días tras los que se borran las cuentas que nunca verificaron el email |
| `PDF_MAX_CONCURRENCY` | no (`2`) | PDF generándose a la vez por proceso (el resto recibe 429) |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_MONTHLY`, `STRIPE_PRICE_ANNUAL` | no | Las cuatro o ninguna. Sin ellas la facturación responde 503 |
| `SESSION_ABSOLUTE_DAYS`, `SESSION_IDLE_HOURS` | no | Caducidad de sesiones (30 días / 168 h) |
| `SCHEDULER_ENABLED`, `SCHEDULER_INTERVAL_SECONDS` | no | Recordatorio diario, avisos de fin de prueba y limpieza/purga periódica |
| `EMAIL_WORKER_ENABLED`, `EMAIL_WORKER_INTERVAL_SECONDS` | no (`true`, `15`) | Worker de reintentos de la bandeja de salida de emails |
| `ORG_DELETION_GRACE_DAYS` | no (`30`) | Días que un local pendiente de eliminación se conserva (restaurable) |
| `WEB_DIST_DIR` | no | Build del frontend (por defecto `../web/dist`) |
| `MIGRATE_ON_START` | no | `false` para no migrar al arrancar |

## Despliegue

### Docker

```bash
cd enregla
cp server/.env.example server/.env
# Edita server/.env: NODE_ENV=production, APP_URL=https://…, SMTP_*, MAIL_FROM,
# POSTGRES_PASSWORD (larga), TRUST_PROXY=1 si hay proxy, Stripe si procede.
docker compose --env-file server/.env up -d --build
```

Para producción hay un ejemplo completo con **Caddy** (TLS automático con Let's Encrypt) en [`docker-compose.prod.yml`](docker-compose.prod.yml) + [`deploy/Caddyfile`](deploy/Caddyfile): solo Caddy publica puertos (80/443), la app queda en una red interna y confía únicamente en la subred de Caddy.

```bash
# server/.env: además de lo anterior, DOMAIN=app.tudominio.es y ACME_EMAIL=tu@email
docker compose -f docker-compose.prod.yml --env-file server/.env up -d --build
```

- `Dockerfile` multi-etapa: compila el servidor, compila `web/` si existe (si no, imagen solo API) y ejecuta como usuario `node` (no root) con `HEALTHCHECK` sobre `/healthz`.
- Los compose fuerzan `NODE_ENV=production` (aunque `server/.env` diga otra cosa) y pasan la conexión como `PGHOST`/`PGUSER`/`PGPASSWORD`/`PGDATABASE`: `POSTGRES_PASSWORD` puede llevar cualquier carácter sin codificarlo.
- `docker-compose.prod.yml` incluye un servicio `backup` con copia diaria `pg_dump` en `./backups` (ver `docs/OPERACIONES.md`, que explica también cómo sacarla del servidor y cómo restaurarla).
- `docker-compose.yml`: `app` + `db` (PostgreSQL 16, volumen `pgdata`, sin puerto publicado). La app publica el 3000 **solo en `127.0.0.1`**: el acceso público debe pasar por un proxy inverso con TLS. La app aplica las migraciones al arrancar.
- La cookie de sesión es `__Host-` + `Secure`, así que la app debe servirse por https.

### Detrás de un proxy (TRUST_PROXY)

La IP del cliente se usa en el rate limiting y la auditoría. Si la app confía en `X-Forwarded-For` de cualquiera, un atacante puede inventarse una IP por petición y saltarse los límites por IP; por eso en producción **no arranca con `TRUST_PROXY=true`**. Reglas:

1. La app **no debe ser accesible directamente** desde Internet (en compose: `127.0.0.1:3000:3000` o sin `ports`, como en `docker-compose.prod.yml`). Si se puede llegar a la app sin pasar por el proxy, cualquier valor de `TRUST_PROXY` es falsificable.
2. Configura **cuántos** proxies hay delante (`TRUST_PROXY=1` con un único proxy) o, mejor, **qué IP** tienen (`TRUST_PROXY=172.30.0.0/24`, `TRUST_PROXY=10.0.0.5,10.0.0.6`; se aceptan también `loopback`, `linklocal`, `uniquelocal`).
3. El proxy debe **sustituir** `X-Forwarded-For` por la IP real (no limitarse a añadir), o ser el único salto confiado.

Ejemplos:

- **Caddy**: `reverse_proxy app:3000` (Caddy añade la IP real; en `deploy/Caddyfile` se fuerza `header_up X-Forwarded-For {remote_host}`). En la app: `TRUST_PROXY=<subred o IP de Caddy>` o `1`.
- **Nginx** en la misma máquina: `proxy_set_header X-Forwarded-For $remote_addr;` (no `$proxy_add_x_forwarded_for` si Nginx es el borde), `proxy_set_header X-Forwarded-Proto $scheme;` y `proxy_pass http://127.0.0.1:3000;`. En la app: `TRUST_PROXY=127.0.0.1` (o `loopback`).
- **Plataforma gestionada** (Render, Fly.io, Railway, un balanceador de nube…): consulta cuántos saltos añade (normalmente 1) y usa `TRUST_PROXY=1`, o su rango de IP si lo publica. Si hay CDN + balanceador, son 2.
- Liveness: `GET /healthz`. Readiness (comprueba la BD, 3 s máx.): `GET /readyz` → 503 si la BD no responde **y durante el apagado**. `SIGTERM` provoca un apagado ordenado (`/readyz` pasa a 503, deja de aceptar conexiones, termina las peticiones en curso y cierra la BD; máx. 15 s). Las sondas no se registran a nivel info.
- Errores no capturados (`unhandledRejection`/`uncaughtException`): se registran (nivel fatal) y el proceso se apaga de forma ordenada con código 1 para que el orquestador lo reinicie. Un corte de PostgreSQL **no** tumba el proceso: el pool registra el error y reconecta.
- Timeouts HTTP: keep-alive 125 s (mayor que el de los balanceadores habituales), `headersTimeout` 130 s, `requestTimeout` 300 s, inactividad de socket 130 s y, en descargas grandes (PDF, CSV, exportación), se aborta la que no progresa en 60 s.

### Stripe

1. Crea un producto con dos precios recurrentes (12 €/mes y 120 €/año) y copia sus IDs a `STRIPE_PRICE_MONTHLY` / `STRIPE_PRICE_ANNUAL`.
2. Activa el portal de cliente (Billing → Customer portal) con cambio de plan, método de pago y cancelación.
3. Crea un endpoint de webhook a `https://TU_DOMINIO/api/billing/webhook` con los eventos `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.paid` e `invoice.payment_failed`; copia el secreto a `STRIPE_WEBHOOK_SECRET`. En cada evento el servidor **recupera la suscripción actual de Stripe** y aplica ese estado (el orden de llegada da igual); si no puede (Stripe caído o local aún no asociable) responde 503 sin marcar el evento y Stripe lo reintenta.
4. En local: `stripe listen --forward-to localhost:3000/api/billing/webhook`.

## Decisiones de diseño y seguridad

- **Sesiones** en tabla (`sessions`), se guarda solo el SHA-256 del token (256 bits). Cookie `__Host-…` httpOnly, Secure, SameSite=Lax. Rotación en cada login; caducidad absoluta y por inactividad; cambiar o restablecer la contraseña invalida las demás sesiones (el restablecimiento, todas).
- **CSRF**: además de SameSite, toda petición mutante con cookie exige `X-Requested-With: XMLHttpRequest` y `Origin` permitido (o `Sec-Fetch-Site: same-origin`). Kiosko (Bearer) y webhook (firma) quedan fuera por diseño.
- **Contraseñas**: argon2id (m=19 MiB, t=2, p=1, parámetros OWASP), 10–128 caracteres, lista embebida de contraseñas comunes, sin revelar si un email existe (respuestas idénticas y hash ficticio en el login para igualar tiempos; los emails se envían sin bloquear la respuesta).
- **Tokens de un solo uso** (verificación, reset, cambio de email, invitación): 256 bits aleatorios, hasheados, con caducidad, consumo atómico. Viajan en el fragmento `#token=` de la URL para no aparecer en logs ni en `Referer`.
- **Multi-tenant**: todas las consultas filtran por `organization_id` y la pertenencia se verifica en cada petición; cualquier id ajeno (en ruta, cuerpo o cursor) responde 404.
- **Registros inmutables**: no hay rutas de edición/borrado y un trigger de PostgreSQL rechaza `UPDATE`/`DELETE` en `records`, salvo el borrado en cascada al eliminar la organización. Las correcciones son enmiendas encadenadas.
- **Kiosko**: token de dispositivo de 256 bits (hash SHA-256), revocable, que solo da acceso a `/api/kiosk/*`. PIN del personal con argon2id y bloqueo de 15 min tras 5 fallos.
- **Rate limiting** en PostgreSQL (tabla `rate_limits`, ventana fija, actualización atómica): funciona con varias instancias sin Redis. La interfaz `RateLimiter` permite sustituirlo. El login se limita por (cuenta + IP) con el umbral normal y por cuenta con un techo alto (100/h), para que nadie bloquee a otro desde su IP. Hay límites para informes, exportación, altas de registros e invitaciones (detalle en `docs/API.md` §1.6).
- **Informes PDF**: máx. 5000 filas (por encima, error que sugiere acotar o usar CSV), máx. 2 PDF **generándose** a la vez por proceso (429 inmediato, sin cola) y la generación cede el event loop cada 20 filas. El PDF se genera completo en memoria (tope defensivo de 64 MiB) y el hueco se libera al terminar la generación; después se envía con `Content-Length`, así que un cliente lento no puede retener los huecos. Fuente Unicode embebida (DejaVu Sans, `server/assets/fonts`, licencia incluida): latín extendido, griego y cirílico; lo que la fuente no cubre (p. ej. muchos emojis) sale como `□`. Los textos nunca se recortan: las celdas crecen y continúan en la página siguiente.
- **Emails**: el asunto nunca lleva texto libre de usuario (solo `APP_NAME` y texto fijo). En el cuerpo, nombres de local/usuario van acotados (60 caracteres), entre comillas «», escapados y con un espacio de anchura cero tras `.`, `:`, `/`, `@` para que los clientes de correo no los conviertan en enlaces. El email de verificación saluda sin nombre.
- **Cabeceras**: helmet con CSP estricta (`script-src 'self'`, sin inline: compatible con un build de Vite sin scripts inline), `frame-ancestors 'none'`, `Referrer-Policy: no-referrer`, HSTS en producción, `Cache-Control: no-store` en la API. CORS cerrado salvo `DEV_ORIGINS`.
- **Logs** estructurados (pino) con redacción de cookies, `Authorization`, contraseñas, tokens y PIN.
- **Auditoría** (`audit_events`): logins y fallos, cambios de contraseña/email, altas/bajas de dispositivos, cambios de rol, invitaciones, exportaciones, informes, borrados, eventos de facturación y bloqueos de PIN.
- **Informes** en streaming (lotes de 500 filas con paginación keyset); CSV con prevención de inyección de fórmulas; textos del PDF saneados.
- **Recordatorio diario** en proceso: cada minuto, la instancia que obtiene un advisory lock de PostgreSQL **encola**, una vez al día y a partir de la hora configurada del local, un email a owners/managers con la preferencia activa si hay tareas pendientes (la marca del día y el encolado van en la misma transacción; el envío SMTP va fuera).
- **Emails con bandeja de salida** (`email_outbox`): todo email se encola (en la misma transacción que el hecho cuando es posible: invitaciones, cambio de contraseña, borrado de local, recordatorios, avisos de prueba) y se intenta enviar al momento; si el SMTP falla se reintenta con backoff (30 s, 2 min, 10 min, 30 min, 1 h, 2 h, 4 h, 8 h, 8 h; se descarta a los 10 intentos o ~26 h). Seguro con varias instancias (`FOR UPDATE SKIP LOCKED` + arrendamiento de 2 min). nodemailer con timeouts explícitos (conexión 10 s, socket 30 s). **Almacenamiento temporal**: los cuerpos pueden contener enlaces con token, así que las filas enviadas se borran a las 6 h y las fallidas definitivas a los 3 días; el error guardado es un resumen sin direcciones, URL ni tokens.
- **Avisos de fin de prueba**: a los owners de cada local en prueba (sin suscripción), 3 días antes y el día que caduca, una sola vez cada uno, a partir de las 9:00 hora local, con enlace a facturación.
- **Idempotencia**: `POST /records`, enmiendas y `/kiosk/records` aceptan `Idempotency-Key` (UUID); claves únicas por local, conservadas 7 días (ver `docs/API.md` §1.7).

### Decisiones ante ambigüedades

- El registro **no** inicia sesión y el login exige email verificado (necesario para no revelar si un email existe).
- Si alguien se registra con un email que ya tiene una cuenta **sin verificar**, **no** se tocan nombre ni contraseña (quien llega después no puede fijar la contraseña de esa cuenta): solo se reenvía el enlace de verificación (con rate limit) y la respuesta es la misma. El email avisa de que se mantiene la contraseña del primer registro y de que, si no fue él, no confirme y use «recuperar contraseña» (el reset verifica el email y fija una contraseña nueva). Las cuentas sin verificar se borran a los 7 días.
- **Prueba gratuita: una por cuenta.** La fecha de fin se guarda en el usuario (`users.trial_ends_at`) al crear su primer local; los siguientes la heredan (si ya caducó nacen en solo lectura, con la plantilla precargada). Borrar y recrear locales no la reinicia. **Riesgo residual:** alguien puede crear otra cuenta con otro email (o alias `+etiqueta`) para conseguir otra prueba; mitigarlo del todo exigiría tarjeta en la prueba o señales antifraude (dominio, IP, huella de pago), fuera del alcance actual.
- Al eliminar un local con suscripción viva en Stripe se cancela primero la suscripción; si Stripe falla, el local no pasa a pendiente de eliminación. Borrar la cuenta nunca elimina locales (si eres el único propietario debes borrarlos o transferirlos antes), así que no deja suscripciones huérfanas.
- Al expulsar a un miembro (o cuando sale o borra su cuenta) se revocan en la misma transacción los dispositivos de cocina que creó.
- Las contraseñas comunes se comprueban contra una lista embebida pequeña (no un servicio externo).
- Un usuario no puede borrar su cuenta si es el único propietario de algún local: debe eliminar el local o nombrar otro propietario (no se borran datos de un local implícitamente).
- Los registros guardan el nombre de quien firma (personal y/o usuario) además del id; el id de usuario no tiene clave foránea para que el registro sobreviva al borrado de la cuenta.
- Personal, equipos y planes no se borran (los registros los referencian): se desactivan. Proveedores y platos sí se pueden borrar (los registros guardan copia del nombre).
- Las enmiendas solo se crean desde la web (no desde el kiosko) y como máximo una por registro (se enmienda la última versión). Cerrar una incidencia = enmienda con `closed: true`.
- La "freidora" es un tipo de equipo (sin límites y con 0 controles diarios de temperatura); el aceite se registra contra ella. Umbral de referencia de compuestos polares: 25 % (por encima exige acción correctora).
- Plan semanal: toca el día de la semana configurado y cuenta como hecho si se registró en cualquier momento de esa semana (lunes–hoy); mensual, igual con el mes (día 1–28).
- **Fecha del hecho** (`records.effective_at`): un registro normal cuenta en su hora de alta; una **enmienda** cuenta en la fecha del registro original (raíz de la cadena), así que enmendar hoy un registro de ayer no cambia el cumplimiento de ningún día. `created_at` sigue siendo la hora real de inserción (en una enmienda, cuándo se enmendó). Tareas, cumplimiento, recordatorios, historial (orden, filtros y cursor) e informes usan `effective_at`; los informes muestran además cuándo y quién enmendó. La rellena un trigger (también para código antiguo).
- **Vigencia histórica de la configuración**: cada alta/edición/desactivación de equipos y planes queda en `equipment_config_history` / `cleaning_plan_config_history` (triggers). Lo esperado de cada día sale de la configuración vigente ese día: se exige un equipo/plan si estaba activo al empezar el día y sigue activo al terminarlo (o ahora, si es hoy), con la frecuencia vigente al final del día. Por tanto el día de alta (o de reactivación, o de desactivación) no es exigible; lo registrado ese día sí figura como hecho en «Hoy» (`countsToday: false`, fuera del resumen).
- Estado `past_due` (cobro fallido mientras Stripe reintenta) es **escribible** (periodo de gracia) y la API expone `subscription.paymentFailed` para avisar. Solo lectura: prueba caducada, `unpaid`, `canceled`, `incomplete_expired` y además `paused` (prueba de Stripe terminada sin método de pago: no se da servicio gratis indefinido). `incomplete` (primer pago en curso, máx. 23 h) es escribible. Se permite siempre: leer, exportar, informes, facturación, revocar dispositivos, salir/quitar miembros y eliminar el local.
- **Borrado diferido de locales**: `DELETE /api/orgs/{id}` cancela antes la suscripción de Stripe (si falla, no hace nada) y deja el local **pendiente de eliminación** 30 días: solo lectura, sin carta pública, dispositivos de cocina revocados, sin recordatorios ni avisos; los miembros siguen viendo y exportando datos e informes, un owner puede restaurarlo (no reactiva la suscripción ni los dispositivos) y se envía un email a los owners con la fecha de eliminación definitiva. La tarea diaria lo purga al vencer. Derecho de supresión: un owner puede pedir la eliminación inmediata y definitiva de un local ya pendiente (`DELETE /api/orgs/{id}/permanent`, con contraseña). Un local pendiente no impide borrar la cuenta.
- En Checkout, si quedan ≥ 48 h de prueba local se traslada como `trial_end` a Stripe para no perder los días restantes.
- Rango máximo: informes 1 año (366 días), cumplimiento 92 días. PDF máx. 5000 filas (error claro si se supera), CSV máx. 500 000. Fechas admitidas: años 2000–2100. Zonas horarias: solo nombres IANA (más `UTC`); `+01:00` y similares se rechazan porque PostgreSQL los interpreta con el signo invertido.
- Los textos de los emails, PDF y errores están en español de España; identificadores en inglés. Los mensajes de validación (zod) salen de un mapa de errores en español compartido por servidor y web (`server/src/schemas/es.ts`).
- **Alérgenos**: un plato nace sin revisar y no se publica hasta confirmar sus 14 alérgenos (o marcar «no contiene ninguno»). La carta pública nunca afirma «sin alérgenos»: dice «No se han declarado alérgenos en este plato» y muestra siempre el aviso de consultar al personal y de posibles trazas.
- **Limpieza parcial**: exige al menos una zona; si faltan zonas se pide confirmación y se guarda como «Parcial (2 de 5)», que no cuenta como tarea hecha.
- **Recepción**: temperatura máxima admisible opcional (atajos 4 °C / −18 °C); aceptar mercancía caducada o demasiado caliente exige motivo y genera alerta.
- **Kiosko**: el PIN se verifica al identificarse (`/api/kiosk/verify-pin`) y otra vez en cada alta; el PIN solo vive en memoria.

## Retención de datos

Una tarea diaria (la misma maquinaria que el recordatorio: advisory lock de PostgreSQL y marca en `job_runs`, así que se ejecuta una vez al día aunque haya varias instancias) purga:

| Dato | Plazo |
|---|---|
| Eventos de auditoría | 12 meses (`AUDIT_RETENTION_MONTHS`) |
| Cuentas que nunca verificaron el email (sin locales) | 7 días (`UNVERIFIED_ACCOUNT_DAYS`) |
| Sesiones caducadas o inactivas | al caducar |
| Tokens de email caducados o usados | 7 días después |
| Invitaciones caducadas o revocadas | 30 días después |
| Filas de rate limit vencidas | 1 hora después |
| Locales pendientes de eliminación | al vencer el plazo (30 días; `ORG_DELETION_GRACE_DAYS`), con todos sus datos |
| Claves de idempotencia | 7 días |
| Emails de la bandeja de salida | enviados: 6 horas; fallidos definitivos: 3 días |

Al borrar una cuenta, sus eventos de auditoría se **seudonimizan**: se conserva el id aleatorio del usuario (ya no apunta a nadie), pero se quitan la IP y los emails (`email`, `from`, `to`), también su email en eventos de terceros (p. ej. la invitación que recibió). Los registros APPCC no se purgan (son del local y se borran solo al eliminarlo definitivamente).

## Endurecimiento recomendado de la base de datos

La inmutabilidad de `records` la garantiza un trigger, pero el rol con el que se conecta la app es el **dueño** de las tablas: con esas credenciales se podría desactivar el trigger o reescribir el historial. En producción se recomienda separar:

- **Rol de migraciones** (dueño del esquema): solo se usa para `npm run migrate:prod` / `MIGRATE_ON_START` en un paso de despliegue.
- **Rol de ejecución** de la app: sin `DDL`, sin ser dueño de nada, con `SELECT`/`INSERT`/`UPDATE`/`DELETE` en las tablas normales pero **solo `SELECT` e `INSERT` en `records`** (el borrado en cascada al eliminar un local lo hace el dueño de la FK, no hace falta `DELETE`).

Script de ejemplo: [`docs/db-roles-hardening.sql`](docs/db-roles-hardening.sql). Con este esquema la app arranca con `MIGRATE_ON_START=false` y `DATABASE_URL` del rol de ejecución. No se aplica por defecto (el compose de ejemplo usa un único rol por simplicidad).

## Estructura

```
enregla/
├── Dockerfile · docker-compose.yml · docker-compose.prod.yml (Caddy) · .dockerignore · README.md
├── deploy/Caddyfile · deploy/backup.sh (pg_dump con retención)
├── docs/API.md · docs/OPERACIONES.md · docs/db-roles-hardening.sql
└── server/
    ├── migrations/0001_init.sql        esquema, índices y trigger de inmutabilidad
    ├── migrations/0002_security_fixes.sql  prueba por usuario, job_runs, índices de purga (aditiva)
    ├── migrations/0003_reliability.sql     effective_at, historial de configuración, idempotencia,
    │                                       bandeja de emails, borrado diferido, avisos de prueba (aditiva)
    ├── migrations/0004_allergen_review.sql revisión explícita de alérgenos por plato (aditiva)
    ├── assets/fonts/                       DejaVu Sans (regular y negrita) + licencia, para los PDF
    ├── src/
    │   ├── server.ts · app.ts · config.ts · deps.ts
    │   ├── db/            Kysely, tipos, migrador
    │   ├── http/          contexto, guards (sesión/rol/solo lectura), validación, seguridad (helmet, CORS, CSRF)
    │   ├── lib/           errores, crypto, contraseñas, mailer y plantillas, rate limit, auditoría, fechas, paginación
    │   ├── schemas/       esquemas zod compartibles con el frontend
    │   ├── modules/       auth, account, orgs (+ plantillas, miembros, auditoría), staff, devices, equipment,
    │   │                  cleaning, suppliers, records, allergens, tasks, reports, billing, kiosk, reminders
    │   └── scripts/seed-demo.ts
    └── test/              tests de integración (vitest + PostgreSQL)
```
