# EnRegla — guía de operación

Guía para quien despliega EnRegla por primera vez en un servidor propio (un VPS con Docker). Todo lo que sigue se hace desde la carpeta `enregla/` del repositorio.

> **Lo más importante:** los registros APPCC son la prueba de que el local ha hecho su autocontrol. Perderlos es lo peor que puede pasar. Antes de dar acceso a ningún cliente, deja funcionando las **copias de seguridad fuera del servidor** (apartado 3) y **prueba una restauración** (apartado 4).

## Índice

1. [Requisitos](#1-requisitos)
2. [Primer despliegue paso a paso](#2-primer-despliegue-paso-a-paso)
3. [Copias de seguridad](#3-copias-de-seguridad)
4. [Restaurar una copia](#4-restaurar-una-copia)
5. [Actualizar y volver atrás](#5-actualizar-y-volver-atrás)
6. [Monitorización mínima](#6-monitorización-mínima)
7. [Rotación de secretos](#7-rotación-de-secretos)
8. [Si falla Stripe](#8-si-falla-stripe)
9. [Si falla el email (SMTP)](#9-si-falla-el-email-smtp)
10. [Datos temporales y eliminación de locales](#10-datos-temporales-y-eliminación-de-locales)
11. [Configuración de Stripe](#11-configuración-de-stripe)
12. [Memoria del contenedor e informes PDF](#12-memoria-del-contenedor-e-informes-pdf)

---

## 1. Requisitos

- Un servidor Linux con Docker y el plugin `docker compose` (v2). 2 GB de RAM son suficientes para empezar (la app tiene un límite de 1 GB, ver apartado 12).
- Un dominio (p. ej. `app.tudominio.es`) cuyo registro DNS **A/AAAA** apunte al servidor, y los puertos **80 y 443** abiertos (Caddy obtiene el certificado TLS de Let's Encrypt automáticamente).
- Una cuenta SMTP para enviar emails (proveedor transaccional: Brevo, Mailgun, Amazon SES, Postmark…). Necesitas host, puerto, usuario, contraseña y una dirección remitente de un dominio que hayas verificado (SPF/DKIM) en ese proveedor.
- Opcional: cuenta de Stripe si vas a cobrar (ver README, apartado «Stripe»).
- Un **destino de copias fuera del servidor**: un bucket S3 compatible (Backblaze B2, Wasabi, Scaleway, AWS S3…) o, como mínimo, otra máquina accesible por SSH.

## 2. Primer despliegue paso a paso

```bash
git clone <URL del repositorio> && cd <repositorio>/enregla
cp server/.env.example server/.env
chmod 600 server/.env          # contiene secretos: que solo lo lea tu usuario
```

Edita `server/.env` (`nano server/.env`). Valores mínimos para producción:

| Variable | Valor |
|---|---|
| `NODE_ENV` | `production` (los compose lo fuerzan de todas formas) |
| `APP_URL` | `https://app.tudominio.es` (exactamente el origen público, sin barra final) |
| `DOMAIN` | `app.tudominio.es` |
| `ACME_EMAIL` | tu email (avisos de Let's Encrypt) |
| `POSTGRES_PASSWORD` | una clave larga y aleatoria: `openssl rand -base64 32`. Puede contener cualquier carácter: los compose la pasan a la app como `PGPASSWORD`, **no** dentro de una URL |
| `DATABASE_URL` | déjala como esté: los compose la anulan y usan `PGHOST`/`PGUSER`/`PGPASSWORD`/`PGDATABASE`. *Solo si despliegas sin compose* y usas `DATABASE_URL`, los caracteres especiales de la contraseña (`@ : / # ? %`…) deben ir codificados (`node -p 'encodeURIComponent(process.argv[1])' 'la-clave'`), o usa tú también las variables `PG*` |
| `MAIL_TRANSPORT` | `smtp` |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS` | los de tu proveedor (`SMTP_SECURE=true` con el puerto 465; con 587, `false` y se exige STARTTLS) |
| `MAIL_FROM` | `no-reply@tudominio.es` (dominio verificado en el proveedor) |
| `TRUST_PROXY` | no lo toques: `docker-compose.prod.yml` ya fija la subred de Caddy |
| `STRIPE_*` | las cuatro o ninguna (sin ellas la facturación responde 503 y el resto funciona) |

Arranca:

```bash
docker compose -f docker-compose.prod.yml --env-file server/.env up -d --build
docker compose -f docker-compose.prod.yml --env-file server/.env ps        # todo "running"/"healthy"
docker compose -f docker-compose.prod.yml --env-file server/.env logs -f app   # Ctrl+C para salir
```

La app aplica las migraciones de la base de datos al arrancar. Si la configuración no es válida, el contenedor `app` se para con un mensaje claro en los logs (p. ej. «APP_URL debe usar https en producción»): corrígelo en `server/.env` y repite el `up -d`.

Comprueba:

```bash
curl -fsS https://app.tudominio.es/healthz   # {"status":"ok"}
curl -fsS https://app.tudominio.es/readyz    # {"status":"ok"}  (la base de datos responde)
```

Después, desde el navegador: regístrate, confirma el email (si no llega, ver apartado 9), crea un local y haz un registro de prueba.

> Recomendado: separa el rol de migraciones del rol de ejecución de la app (`docs/db-roles-hardening.sql`, explicado en el README) para que nadie con las credenciales de la app pueda alterar el historial de registros.

## 3. Copias de seguridad

### Qué se copia

Todo está en PostgreSQL (no hay ficheros subidos por los usuarios). Una copia es un volcado `pg_dump` en formato *custom* (comprimido), que incluye esquema, datos, índices y triggers.

**Datos que NO se copian** (se copia la estructura de la tabla, vacía; `--exclude-table-data` en `deploy/backup.sh`): son datos temporales o secretos de un solo uso que no deben acabar en copias que se guardan meses fuera del servidor.

| Tabla | Qué contiene | Efecto tras restaurar |
|---|---|---|
| `email_outbox` | emails pendientes o recientes, cuyos cuerpos pueden llevar enlaces con token en claro | los emails que estuvieran pendientes no se envían; el usuario puede volver a pedirlos |
| `sessions` | sesiones abiertas | **todos los usuarios tienen que volver a iniciar sesión** |
| `email_tokens` | enlaces de verificación, restablecimiento y cambio de email | esos enlaces dejan de valer; se vuelven a pedir desde la app |
| `rate_limits` | contadores de límites de peticiones (y presupuesto de PDF) | los contadores empiezan de cero |
| `idempotency_keys` | claves de idempotencia de altas (7 días) | un reintento de un alta hecha justo antes de la copia podría duplicarse (caso muy improbable) |

Los ficheros de copia se crean con `umask 077` (solo legibles por el usuario que ejecuta la copia) y la carpeta de destino queda con permisos `700`.

### Copia diaria automática

`docker-compose.prod.yml` incluye el servicio `backup`, que ejecuta [`deploy/backup.sh`](../deploy/backup.sh) una vez al día (por defecto a las 03:00 UTC) y deja las copias en `enregla/backups/`:

- `enregla-AAAAMMDD-HHMMSS.dump` y su `.sha256`;
- comprueba que el volcado es legible (`pg_restore --list`) antes de darlo por bueno;
- borra las copias locales de más de `BACKUP_RETENTION_DAYS` días (14 por defecto).

Variables (en `server/.env`): `BACKUP_HOUR_UTC`, `BACKUP_RETENTION_DAYS`, `BACKUP_POST_HOOK`.

Copia manual en cualquier momento (p. ej. antes de actualizar):

```bash
docker compose -f docker-compose.prod.yml --env-file server/.env exec backup sh /usr/local/bin/enregla-backup.sh
ls -lh backups/
```

### Sácala del servidor (imprescindible)

Una copia que solo está en el mismo disco no te protege si pierdes el servidor, el disco o te borran la cuenta del proveedor. Configura `BACKUP_POST_HOOK`, que se ejecuta tras cada copia con la ruta del fichero en la variable `BACKUP_FILE`. Opciones:

- **Bucket S3 compatible con rclone** (recomendado; activa en el bucket el *versionado* o el *bloqueo de objetos* para que un atacante con acceso al servidor no pueda borrar las copias antiguas). La imagen `postgres:16-alpine` no trae rclone: lo más sencillo es ejecutar la subida desde el propio servidor con cron:

  ```bash
  # crontab -e   (en el servidor, tras instalar y configurar rclone: `rclone config`)
  30 4 * * * rclone copy /ruta/a/enregla/backups remoto:enregla-backups --max-age 48h
  ```

- **Otra máquina por SSH**: `rsync -a /ruta/a/enregla/backups/ usuario@otra-maquina:enregla-backups/` en un cron similar.
- Si tu imagen de backup tiene la herramienta, también puedes usar el hook: en `server/.env`, `BACKUP_POST_HOOK=rclone copy "$$BACKUP_FILE" remoto:enregla-backups` (con `$$`, que compose convierte en `$`).

Conserva fuera del servidor al menos 30 días de copias diarias y alguna mensual durante más tiempo (los registros APPCC suelen tener que conservarse varios años; consulta lo que te exija tu plan de autocontrol). Las copias contienen datos personales (emails, nombres): cífralas en el destino o usa un bucket privado.

### Comprobado

Tras excluir los datos temporales (noviembre de 2026) se repitió la prueba en local (PostgreSQL 16, base de demostración con 341 registros y filas de prueba en `email_outbox`, `sessions`, `email_tokens` y `rate_limits`): `deploy/backup.sh` → copia `600` en carpeta `700`, `sha256sum -c` correcto → `pg_restore --exit-on-error` en una base nueva → mismos recuentos de registros, usuarios, locales y migraciones, mismo hash de `(id, created_at, effective_at)` de todos los registros, trigger de inmutabilidad activo, y las cinco tablas excluidas presentes pero **vacías**.

Antes, el volcado y la restauración se probaron en local (PostgreSQL 16) con una base de 465.039 registros: `deploy/backup.sh` → base nueva → `pg_restore` → mismos recuentos de registros, locales, usuarios, historial de configuración y migraciones, mismo hash de `(id, created_at, effective_at)` de todos los registros, y el trigger de inmutabilidad presente y activo. **No se pudo probar con Docker** (no había demonio de Docker en el entorno de pruebas): los comandos `docker compose …` de esta guía no se han ejecutado; `docker compose config` sí valida los dos ficheros.

## 4. Restaurar una copia

Pruébalo **antes** de necesitarlo, en una base aparte, y repite la prueba de vez en cuando (p. ej. cada trimestre).

### Prueba de restauración (sin tocar producción)

```bash
F=backups/enregla-AAAAMMDD-HHMMSS.dump
sha256sum -c "$F.sha256"                       # integridad del fichero
C="docker compose -f docker-compose.prod.yml --env-file server/.env"
$C exec db createdb -U enregla enregla_restore_test
$C exec -T db pg_restore -U enregla --no-owner --no-privileges --exit-on-error -d enregla_restore_test < "$F"
$C exec db psql -U enregla -d enregla_restore_test -c "SELECT count(*) AS registros FROM records;"
$C exec db psql -U enregla -d enregla      -c "SELECT count(*) AS registros FROM records;"   # compárala con producción
$C exec db dropdb -U enregla enregla_restore_test
```

### Restaurar producción (desastre)

1. Para la app para que nadie escriba: `$C stop app`.
2. Haz una copia del estado actual por si acaso (aunque esté dañado): `$C exec backup sh /usr/local/bin/enregla-backup.sh`.
3. Recrea la base y restaura:

   ```bash
   $C exec db dropdb -U enregla enregla
   $C exec db createdb -U enregla enregla
   $C exec -T db pg_restore -U enregla --no-owner --no-privileges --exit-on-error -d enregla < "$F"
   ```

4. Arranca la app: `$C start app` y comprueba `/readyz`, el login y el historial de un local. Las sesiones no están en la copia: **todos los usuarios tendrán que volver a iniciar sesión** (y los enlaces de email pendientes habrá que pedirlos de nuevo).
5. Si la copia es de una versión anterior de la app, la app aplica sola las migraciones que falten al arrancar.

En un servidor nuevo: instala Docker, clona el repositorio, recupera `server/.env` (guárdalo en tu gestor de contraseñas: sin él no tienes los secretos), `up -d db`, restaura como arriba y después `up -d --build`.

## 5. Actualizar y volver atrás

```bash
cd enregla
git fetch && git log --oneline HEAD..origin/main     # qué cambia
C="docker compose -f docker-compose.prod.yml --env-file server/.env"
$C exec backup sh /usr/local/bin/enregla-backup.sh  # copia ANTES de actualizar
git pull
$C up -d --build app                                 # reconstruye y reinicia solo la app
$C logs -f app                                       # migraciones aplicadas, sin errores
curl -fsS https://app.tudominio.es/readyz
```

Durante el reinicio la app deja de recibir tráfico unos segundos (`/readyz` responde 503 durante el apagado ordenado).

**Migraciones:** son aditivas (añaden columnas/tablas sin romper la versión anterior), así que volver al código anterior suele ser posible sin tocar la base. La `0003` reescribe la tabla de registros una vez (relleno de `effective_at`): en bases muy grandes, actualiza fuera de horario.

**Volver atrás** (la nueva versión falla):

```bash
git log --oneline -5                 # identifica la versión anterior
git checkout <commit-anterior>
$C up -d --build app
```

Si el problema es de datos (una migración ha dañado algo), restaura la copia hecha justo antes de actualizar (apartado 4). Vuelve a la rama principal (`git checkout main`) cuando esté corregido.

## 6. Monitorización mínima

- **Disponibilidad**: configura un monitor externo (UptimeRobot, Better Stack, Healthchecks.io…) que pida `https://app.tudominio.es/readyz` cada minuto y te avise si no responde 200 dos veces seguidas. `/readyz` comprueba la base de datos; `/healthz` solo que el proceso vive.
- **Copias**: comprueba que aparece un fichero nuevo cada día en `backups/` **y en el destino externo**. Lo más fiable es un monitor de tipo *heartbeat* (Healthchecks.io): añade al final de tu cron de subida `&& curl -fsS https://hc-ping.com/<tu-uuid>` y te avisará si un día no llega.
- **Disco**: avisa si el disco supera el 80 % (`df -h`). Las copias locales y el volumen de PostgreSQL crecen con el tiempo.
- **Logs** (`$C logs app`, JSON): vigila mensajes de nivel `error`/`fatal`, en particular «Emails descartados tras agotar los reintentos», «Conexión inactiva con PostgreSQL perdida», «Evento de Stripe sin local asociable» y «Promesa rechazada sin capturar». Las sondas `/healthz` y `/readyz` no se registran (no ensucian el log).
- Si el proceso muere por un error no controlado, se apaga de forma ordenada con código 1 y Docker lo reinicia (`restart: unless-stopped`).

## 7. Rotación de secretos

Tras cambiar cualquier valor de `server/.env`: `$C up -d app` (recrea el contenedor con la nueva configuración).

| Secreto | Cómo rotarlo |
|---|---|
| `POSTGRES_PASSWORD` | `$C exec db psql -U enregla -d enregla -c "ALTER ROLE enregla PASSWORD 'NUEVA'"`, cambia `POSTGRES_PASSWORD` en `server/.env` y `$C up -d app backup` (la variable del contenedor `db` solo se usa al crear el volumen la primera vez) |
| `SMTP_PASS` | genera una nueva credencial en el proveedor, cámbiala en `.env`, reinicia la app y revoca la antigua |
| `STRIPE_SECRET_KEY` | en Stripe (Developers → API keys) usa «Roll key» con un periodo de solapamiento, cambia `.env`, reinicia y deja caducar la antigua. Mejor aún, usa una *restricted key* con los permisos mínimos (Checkout, portal, suscripciones) |
| `STRIPE_WEBHOOK_SECRET` | en el endpoint de webhook, «Roll secret»; Stripe firma con ambos durante el periodo indicado; cambia `.env` y reinicia |
| Sesiones de usuarios | no hay secreto de sesión que rotar (los tokens se guardan hasheados). Para cerrar todas las sesiones: `$C exec db psql -U enregla -d enregla -c "DELETE FROM sessions"` |
| Tokens de cocina | se revocan desde Ajustes → Dispositivos de cocina de cada local |

Si sospechas que `server/.env` se ha filtrado, rota **todo** lo anterior y revisa la auditoría de cada local.

## 8. Si falla Stripe

- **Checkout o portal no se abren**: la app responde 502 `BILLING_ERROR` con un mensaje claro y nada se rompe. Revisa <https://status.stripe.com> y los logs; los usuarios pueden reintentar más tarde.
- **Webhooks**: si Stripe o la base fallan al procesar un evento, la app responde 503 **sin** marcarlo como procesado y Stripe lo reintenta durante hasta 3 días. Cada evento hace que la app consulte el estado actual de la suscripción en Stripe, así que da igual el orden o que lleguen tarde. Revisa en Stripe (Developers → Webhooks → tu endpoint) los intentos fallidos; puedes reenviar uno a mano con «Resend».
- **Un evento sin local** (p. ej. una suscripción creada a mano en Stripe sin `metadata.organization_id`) se reintenta hasta que el cliente quede vinculado a un local; si nunca lo estará, añade en Stripe el metadato `organization_id` a la suscripción o ignora los avisos.
- **Impagos**: con `past_due` el local sigue funcionando (periodo de gracia) y la interfaz avisa del pago fallido; Stripe reintenta el cobro. Si Stripe la deja en `unpaid` o `canceled`, el local pasa a solo lectura (sin perder datos) hasta que se pague. **Salvaguarda:** si un local lleva más de `PAST_DUE_READ_ONLY_DAYS` (21) días en `past_due` (p. ej. porque Stripe está configurado para dejarla así indefinidamente), pasa igualmente a solo lectura. Configura Stripe como indica el apartado 11.
- **Suscripciones canceladas automáticamente**: la app cancela en Stripe, **sin reembolso automático**, una suscripción viva de un local eliminado o pendiente de eliminación, o la más antigua si un local llega a tener dos vivas. Cada caso deja en el log el aviso «Suscripción de Stripe cancelada automáticamente…» y en la auditoría del local un `billing.subscription_canceled` con `refund: manual_review`: revisa en Stripe si hubo un cobro que proceda reembolsar a mano.
- Si un local quedó con un estado incorrecto, basta con reenviar cualquier evento reciente de su suscripción desde el panel de Stripe: la app volverá a leer el estado real.

## 9. Si falla el email (SMTP)

Todos los emails pasan por una **bandeja de salida** en la base de datos (`email_outbox`): si el SMTP no responde, no se pierden. El primer intento es inmediato; después se reintenta automáticamente (30 s, 2 min, 10 min, 30 min, 1 h, 2 h, 4 h, 8 h, 8 h). Pasadas ~24 h sin éxito, el email se descarta y se registra un error en el log.

Diagnóstico:

```bash
$C exec db psql -U enregla -d enregla -c \
  "SELECT status, count(*), max(attempts), max(last_error) FROM email_outbox GROUP BY status"
```

- `pending` con `last_error` → el SMTP falla: comprueba host/puerto/usuario/contraseña, que el proveedor no haya bloqueado la cuenta y que el servidor puede salir al puerto (`nc -vz smtp.proveedor.com 587`). Cuando lo arregles (y reinicies la app si cambiaste `.env`), los pendientes se envían solos en el siguiente reintento. Para forzarlo ya: `UPDATE email_outbox SET next_attempt_at = now() WHERE status = 'pending';`
- `failed` → se agotaron los reintentos. Los enlaces de esos emails (verificación, restablecer contraseña, invitaciones) pueden haber caducado: lo correcto es que el usuario lo vuelva a pedir desde la aplicación.
- Emails que «se envían» pero no llegan: revisa SPF/DKIM/DMARC del dominio de `MAIL_FROM` y la carpeta de spam.

## 10. Datos temporales y eliminación de locales

- **Bandeja de emails**: guarda temporalmente destinatario, asunto y cuerpo (que puede contener enlaces de un solo uso). El cuerpo se **vacía en el mismo momento** en que el email se marca como enviado o como fallido definitivo; las filas (ya sin cuerpo) se borran a las **6 horas** (enviados) y a los **3 días** (fallidos). El error guardado no incluye direcciones, URL ni tokens. Además, la tabla no entra en las copias de seguridad.
- **Envío con varias instancias**: cada email se reserva de uno en uno justo antes de enviarlo (reserva de 120 s), así que un SMTP lento no provoca envíos duplicados entre instancias.
- **Claves de idempotencia** de altas de registros: 7 días.
- **Eliminar un local** no lo borra al momento: queda **pendiente de eliminación 30 días** (`ORG_DELETION_GRACE_DAYS`), en solo lectura, sin carta pública, sin dispositivos de cocina y sin recordatorios; un propietario puede restaurarlo o pedir la eliminación inmediata y definitiva (con su contraseña). La tarea diaria lo purga al vencer el plazo. Antes de borrar (purga o eliminación inmediata) se consulta Stripe: si la suscripción sigue viva se cancela y se expira cualquier Checkout abierto; **si Stripe falla, el local no se borra** (la purga lo registra en el log como «Purga de local aplazada…» y lo reintenta al día siguiente). Al pedir la eliminación se expira el Checkout abierto y se revocan las invitaciones pendientes. Ojo: los datos de un local purgado **siguen en las copias de seguridad** hasta que estas caducan por su retención; tenlo en cuenta en tu política de privacidad.
- **Local pendiente cuyo único propietario borra su cuenta**: se permite (los locales pendientes no bloquean el borrado de la cuenta). Desde ese momento nadie puede restaurarlo. Si quedan otros miembros (encargados), el local se conserva en solo lectura hasta su fecha para que puedan consultar y descargar informes, y se purga entonces. Si no queda **ningún** miembro, nadie puede acceder a él y la purga diaria lo elimina en su siguiente pasada, sin esperar a la fecha (siempre tras cancelar su facturación en Stripe, como arriba).
- El resto de plazos de retención están en el README («Retención de datos»).

## 11. Configuración de Stripe

Sin las cuatro variables `STRIPE_*` la facturación responde 503 y el resto funciona. Para cobrar:

1. **Cuenta y modo**: prueba todo primero en *modo de prueba* (claves `sk_test_…`) y repítelo después en modo real (`sk_live_…`). Activa la cuenta (datos fiscales y bancarios) antes de pasar a real.
2. **Productos y precios** (Product catalog → Add product): un producto «EnRegla» (o el nombre comercial) con dos precios **recurrentes** en EUR: **12 €/mes** y **120 €/año** (los importes que muestra la app están en `PRICES`, `server/src/modules/billing/routes.ts`; si cambias los de Stripe, cámbialos también ahí). Configura el impuesto (Stripe Tax o precios con IVA incluido) según tu caso. Copia los dos ids `price_…` en `STRIPE_PRICE_MONTHLY` y `STRIPE_PRICE_ANNUAL`.
3. **Clave secreta**: Developers → API keys. Mejor una *restricted key* con permisos de escritura en Checkout Sessions, Customer portal, Subscriptions y lectura de Customers/Prices. Va en `STRIPE_SECRET_KEY`.
4. **Webhook**: Developers → Webhooks → Add endpoint `https://app.tudominio.es/api/billing/webhook`, con estos eventos:
   - `checkout.session.completed`
   - `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`
   - `invoice.paid`, `invoice.payment_failed` (opcionalmente `invoice.payment_action_required` y `invoice.finalized`; cualquier `invoice.*` se procesa igual)

   Copia el *Signing secret* (`whsec_…`) en `STRIPE_WEBHOOK_SECRET`. La app consulta siempre el estado real de la suscripción, así que el orden de los eventos no importa.
5. **Portal de cliente** (Settings → Billing → Customer portal): actívalo y permite **actualizar el método de pago**, **ver facturas**, **cancelar la suscripción** (recomendado: «al final del periodo») y, si quieres, **cambiar entre los dos precios** (añade ambos al producto en el apartado de cambio de plan). Rellena el enlace a tus condiciones y a tu política de privacidad.
6. **Reintentos de cobro** (Settings → Billing → Subscriptions and emails → *Manage failed payments* / Smart Retries): activa los reintentos inteligentes (p. ej. 4 intentos en 2–3 semanas) y, **muy importante**, en «Si fallan todos los reintentos» elige **cancelar la suscripción** o **marcarla como impagada (`unpaid`)**. **No** elijas «dejarla vencida» (*leave as past due*): con `past_due` el local sigue escribiendo como periodo de gracia. Aun así, la app aplica una salvaguarda: más de `PAST_DUE_READ_ONLY_DAYS` (21) días en `past_due` → solo lectura. Activa también los emails de Stripe al cliente por pago fallido y tarjeta caducada.
7. **Checkout**: no requiere configuración aparte (la app crea cada sesión con el precio, la prueba restante, recogida de dirección y NIF). Las sesiones caducan solas a las 24 h; la app expira la anterior cuando se pide otra y al pedir la eliminación del local.
8. **Comprueba** en modo de prueba: contratar con la tarjeta `4242 4242 4242 4242`, ver el local `active`; pagar con `4000 0000 0000 0341` (falla la renovación) y ver `past_due` y el aviso; cancelar desde el portal y ver `canceled` → solo lectura; y en Developers → Webhooks que todos los eventos responden 200.

## 12. Memoria del contenedor e informes PDF

Los informes PDF se maquetan en un `worker_thread` aparte (no frenan el resto de peticiones), con el heap de cada worker limitado a 256 MB. Por defecto hay como mucho 2 a la vez (`PDF_MAX_CONCURRENCY`), 1 por local y por usuario, una cola de espera de hasta 20 s por orden de llegada y 180 s de generación por local y hora.

**Límite de memoria recomendado del contenedor `app`: 1 GB** (ya fijado con `mem_limit: 1g` en `docker-compose.prod.yml`): proceso principal ~250 MB + 2 workers de PDF (≤ 256 MB de heap cada uno más el búfer del PDF, máx. 64 MB) con margen. Si subes `PDF_MAX_CONCURRENCY`, añade ~350 MB por cada PDF simultáneo adicional. Si el contenedor se queda sin memoria, Docker lo mata y lo reinicia (`restart: unless-stopped`): vigila `docker stats` y los reinicios (`docker compose ps`).

**Timeouts del proxy** (`deploy/Caddyfile`): cabeceras 15 s, cuerpo 60 s, conexión inactiva 120 s del lado del cliente; hacia la app, conexiones reutilizables 60 s (menos que el keep-alive de 125 s de la app) y hasta 290 s para recibir la respuesta (menos que el límite de 300 s de la app).
