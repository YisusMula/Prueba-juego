# EnRegla — backend

Registros APPCC (autocontrol de higiene alimentaria) digitales para bares, restaurantes y pequeños obradores: temperaturas, limpieza, recepción de mercancía, aceite de fritura, plagas, incidencias, formación de manipuladores y carta de alérgenos, con informes PDF/CSV.

> Las plantillas y rangos que trae la aplicación son **orientativos**. Cada local debe revisarlos y adaptarlos a su propio plan de autocontrol; la herramienta no garantiza por sí misma el cumplimiento de la normativa.

- `server/` — API (Node 22, TypeScript estricto, Fastify 5, PostgreSQL + Kysely, zod, argon2id, pdfkit, nodemailer, Stripe).
- `web/` — frontend (React, pendiente). Si existe `web/dist`, el servidor lo sirve con fallback SPA.
- `docs/API.md` — referencia completa de la API para el frontend.

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

## Variables de entorno

Todas están documentadas en [`server/.env.example`](server/.env.example) y se validan con zod al arrancar. En producción el servidor no arranca si falta algo o si un secreto es débil. Las principales:

| Variable | Obligatoria en prod. | Descripción |
|---|---|---|
| `DATABASE_URL` | sí | PostgreSQL (contraseña ≥ 12 caracteres, no valores por defecto) |
| `APP_URL` | sí (https) | Origen público de la SPA: CSRF, enlaces de emails, retornos de Stripe |
| `APP_NAME` | no (`EnRegla`) | Nombre comercial visible en emails, PDF y textos |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM` | sí | Envío de email |
| `TRUST_PROXY` | según despliegue | Nº de proxies delante (`1`) o lista de IP/CIDR del proxy. **`true` está prohibido en producción** (ver «Detrás de un proxy») |
| `AUDIT_RETENTION_MONTHS` | no (`12`) | Meses que se conservan los eventos de auditoría |
| `UNVERIFIED_ACCOUNT_DAYS` | no (`7`) | Días tras los que se borran las cuentas que nunca verificaron el email |
| `PDF_MAX_CONCURRENCY` | no (`2`) | PDF generándose a la vez por proceso (el resto recibe 429) |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_MONTHLY`, `STRIPE_PRICE_ANNUAL` | no | Las cuatro o ninguna. Sin ellas la facturación responde 503 |
| `SESSION_ABSOLUTE_DAYS`, `SESSION_IDLE_HOURS` | no | Caducidad de sesiones (30 días / 168 h) |
| `SCHEDULER_ENABLED`, `SCHEDULER_INTERVAL_SECONDS` | no | Recordatorio diario y limpieza periódica |
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
- Liveness: `GET /healthz`. Readiness (comprueba la BD): `GET /readyz`. `SIGTERM` provoca un apagado ordenado (deja de aceptar conexiones, termina las peticiones en curso y cierra la BD; máx. 15 s).

### Stripe

1. Crea un producto con dos precios recurrentes (12 €/mes y 120 €/año) y copia sus IDs a `STRIPE_PRICE_MONTHLY` / `STRIPE_PRICE_ANNUAL`.
2. Activa el portal de cliente (Billing → Customer portal) con cambio de plan, método de pago y cancelación.
3. Crea un endpoint de webhook a `https://TU_DOMINIO/api/billing/webhook` con los eventos `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated` y `customer.subscription.deleted`; copia el secreto a `STRIPE_WEBHOOK_SECRET`.
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
- **Informes PDF**: máx. 5000 filas (por encima, error que sugiere acotar o usar CSV), máx. 2 PDF simultáneos por proceso (429 inmediato, sin cola) y la generación cede el event loop cada 20 filas, así que el resto de peticiones y `/healthz` siguen respondiendo.
- **Emails**: el asunto nunca lleva texto libre de usuario (solo `APP_NAME` y texto fijo). En el cuerpo, nombres de local/usuario van acotados (60 caracteres), entre comillas «», escapados y con un espacio de anchura cero tras `.`, `:`, `/`, `@` para que los clientes de correo no los conviertan en enlaces. El email de verificación saluda sin nombre.
- **Cabeceras**: helmet con CSP estricta (`script-src 'self'`, sin inline: compatible con un build de Vite sin scripts inline), `frame-ancestors 'none'`, `Referrer-Policy: no-referrer`, HSTS en producción, `Cache-Control: no-store` en la API. CORS cerrado salvo `DEV_ORIGINS`.
- **Logs** estructurados (pino) con redacción de cookies, `Authorization`, contraseñas, tokens y PIN.
- **Auditoría** (`audit_events`): logins y fallos, cambios de contraseña/email, altas/bajas de dispositivos, cambios de rol, invitaciones, exportaciones, informes, borrados, eventos de facturación y bloqueos de PIN.
- **Informes** en streaming (lotes de 500 filas con paginación keyset); CSV con prevención de inyección de fórmulas; textos del PDF saneados.
- **Recordatorio diario** en proceso: cada minuto, la instancia que obtiene un advisory lock de PostgreSQL envía, una vez al día y a partir de la hora configurada del local, un email a owners/managers con la preferencia activa si hay tareas pendientes.

### Decisiones ante ambigüedades

- El registro **no** inicia sesión y el login exige email verificado (necesario para no revelar si un email existe).
- Si alguien se registra con un email que ya tiene una cuenta **sin verificar**, **no** se tocan nombre ni contraseña (quien llega después no puede fijar la contraseña de esa cuenta): solo se reenvía el enlace de verificación (con rate limit) y la respuesta es la misma. El email avisa de que se mantiene la contraseña del primer registro y de que, si no fue él, no confirme y use «recuperar contraseña» (el reset verifica el email y fija una contraseña nueva). Las cuentas sin verificar se borran a los 7 días.
- **Prueba gratuita: una por cuenta.** La fecha de fin se guarda en el usuario (`users.trial_ends_at`) al crear su primer local; los siguientes la heredan (si ya caducó nacen en solo lectura, con la plantilla precargada). Borrar y recrear locales no la reinicia. **Riesgo residual:** alguien puede crear otra cuenta con otro email (o alias `+etiqueta`) para conseguir otra prueba; mitigarlo del todo exigiría tarjeta en la prueba o señales antifraude (dominio, IP, huella de pago), fuera del alcance actual.
- Al eliminar un local con suscripción viva en Stripe se cancela primero la suscripción; si Stripe falla, el local no se borra. Borrar la cuenta nunca elimina locales (si eres el único propietario debes borrarlos o transferirlos antes), así que no deja suscripciones huérfanas.
- Al expulsar a un miembro (o cuando sale o borra su cuenta) se revocan en la misma transacción los dispositivos de cocina que creó.
- Las contraseñas comunes se comprueban contra una lista embebida pequeña (no un servicio externo).
- Un usuario no puede borrar su cuenta si es el único propietario de algún local: debe eliminar el local o nombrar otro propietario (no se borran datos de un local implícitamente).
- Los registros guardan el nombre de quien firma (personal y/o usuario) además del id; el id de usuario no tiene clave foránea para que el registro sobreviva al borrado de la cuenta.
- Personal, equipos y planes no se borran (los registros los referencian): se desactivan. Proveedores y platos sí se pueden borrar (los registros guardan copia del nombre).
- Las enmiendas solo se crean desde la web (no desde el kiosko) y como máximo una por registro (se enmienda la última versión). Cerrar una incidencia = enmienda con `closed: true`.
- La "freidora" es un tipo de equipo (sin límites y con 0 controles diarios de temperatura); el aceite se registra contra ella. Umbral de referencia de compuestos polares: 25 % (por encima exige acción correctora).
- Plan semanal: toca el día de la semana configurado y cuenta como hecho si se registró en cualquier momento de esa semana (lunes–hoy); mensual, igual con el mes (día 1–28).
- El cumplimiento usa la configuración actual de equipos/planes (no hay histórico de configuración), contando cada equipo/plan desde su fecha de creación.
- Estado `past_due` (impago en reintento) ya deja el local en solo lectura, según la especificación. Se permite siempre: leer, exportar, informes, facturación, revocar dispositivos, salir/quitar miembros y eliminar el local.
- En Checkout, si quedan ≥ 48 h de prueba local se traslada como `trial_end` a Stripe para no perder los días restantes.
- Rango máximo: informes 1 año (366 días), cumplimiento 92 días. PDF máx. 5000 filas (error claro si se supera), CSV máx. 500 000. Fechas admitidas: años 2000–2100. Zonas horarias: solo nombres IANA (más `UTC`); `+01:00` y similares se rechazan porque PostgreSQL los interpreta con el signo invertido.
- Los textos de los emails, PDF y errores están en español de España; identificadores en inglés.

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

Al borrar una cuenta, sus eventos de auditoría se **seudonimizan**: se conserva el id aleatorio del usuario (ya no apunta a nadie), pero se quitan la IP y los emails (`email`, `from`, `to`), también su email en eventos de terceros (p. ej. la invitación que recibió). Los registros APPCC no se purgan (son del local y se borran solo al eliminarlo).

## Endurecimiento recomendado de la base de datos

La inmutabilidad de `records` la garantiza un trigger, pero el rol con el que se conecta la app es el **dueño** de las tablas: con esas credenciales se podría desactivar el trigger o reescribir el historial. En producción se recomienda separar:

- **Rol de migraciones** (dueño del esquema): solo se usa para `npm run migrate:prod` / `MIGRATE_ON_START` en un paso de despliegue.
- **Rol de ejecución** de la app: sin `DDL`, sin ser dueño de nada, con `SELECT`/`INSERT`/`UPDATE`/`DELETE` en las tablas normales pero **solo `SELECT` e `INSERT` en `records`** (el borrado en cascada al eliminar un local lo hace el dueño de la FK, no hace falta `DELETE`).

Script de ejemplo: [`docs/db-roles-hardening.sql`](docs/db-roles-hardening.sql). Con este esquema la app arranca con `MIGRATE_ON_START=false` y `DATABASE_URL` del rol de ejecución. No se aplica por defecto (el compose de ejemplo usa un único rol por simplicidad).

## Estructura

```
enregla/
├── Dockerfile · docker-compose.yml · docker-compose.prod.yml (Caddy) · .dockerignore · README.md
├── deploy/Caddyfile
├── docs/API.md · docs/db-roles-hardening.sql
└── server/
    ├── migrations/0001_init.sql        esquema, índices y trigger de inmutabilidad
    ├── migrations/0002_security_fixes.sql  prueba por usuario, job_runs, índices de purga (aditiva)
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
