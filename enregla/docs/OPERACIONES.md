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
13. [Roles de la base de datos (registros no modificables)](#13-roles-de-la-base-de-datos-registros-no-modificables)
14. [La tablet de cocina: modo de acceso guiado](#14-la-tablet-de-cocina-modo-de-acceso-guiado)

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
| Claves de la base de datos | **No van en `server/.env`.** Créalas con `sh deploy/generate-db-secrets.sh`, que escribe **un fichero por servicio** en `deploy/secrets/` (ver «La carpeta `deploy/secrets/`» en el apartado 13): `db.env` (solo `db`), `owner.env` (solo `migrate` y `maintenance`), `backup.env` (solo `backup`) y `app-db.env` (solo la app). Así la app nunca tiene la clave del administrador ni la del propietario. Guarda los cuatro ficheros en tu gestor de contraseñas; `.gitignore` excluye todo lo que hay en `deploy/secrets/` salvo los `*.example` (también copias `.bak`, `.orig` o `~`) y `.dockerignore` excluye la carpeta, `backups/` y cualquier volcado |
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

Al crear la base de datos, `deploy/postgres-init/10-enregla-roles.sh` crea los roles `enregla_owner`, `enregla_app` y `enregla_backup`. El servicio `migrate` aplica las migraciones con `enregla_owner`, fija los permisos de `enregla_app`, de `enregla_backup` y de PUBLIC (todos, en cada despliegue) y termina; solo entonces arrancan la app, conectada como `enregla_app`, y el servicio `maintenance` (cada hora, con `enregla_owner`: purga de locales y de auditoría antigua; apartado 13). Si la configuración no es válida, el contenedor `app` se para con un mensaje claro en los logs (p. ej. «APP_URL debe usar https en producción»): corrígelo en `server/.env` y repite el `up -d`. Si `migrate` falla, la app no arranca: `$C logs migrate`.

Comprueba:

```bash
curl -fsS https://app.tudominio.es/healthz   # {"status":"ok"}
curl -fsS https://app.tudominio.es/readyz    # {"status":"ok"}  (la base de datos responde)
```

Después, desde el navegador: regístrate, confirma el email (si no llega, ver apartado 9), crea un local y haz un registro de prueba.

> La separación de roles se aplica **por defecto** (apartado 13): nadie con las credenciales de la app puede modificar, borrar ni desactivar la protección del historial de registros. Si actualizas un despliegue anterior a esta versión, sigue el apartado 13 **antes** del `up -d`.

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

El servicio `backup` se conecta con el rol `enregla_backup`, de **solo lectura**: `SELECT` tabla a tabla (lo fija `migrate` con `BACKUP_DB_ROLE`), sin escritura, sin funciones y **sin ver ninguna fila** de las tablas que no se copian (`email_outbox`, `sessions`, `email_tokens`, `rate_limits`, `idempotency_keys`; una política de seguridad por filas se las oculta). Con su clave (`deploy/secrets/backup.env`) no se puede modificar ni borrar nada. **Ojo: el volcado sí contiene datos personales y los hashes de las contraseñas** (tabla `users`): trátalo como un secreto y **cífralo** antes de sacarlo del servidor (p. ej. `rclone` con un remoto `crypt`, o `age`/`gpg` en `BACKUP_POST_HOOK`). Si actualizas desde una versión en la que `backup` usaba el administrador o `pg_read_all_data`, ejecuta una vez `$C exec -T db sh /docker-entrypoint-initdb.d/10-enregla-roles.sh` (crea el rol y le quita `pg_read_all_data`) y `$C run --rm migrate` antes de `$C up -d backup`.

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

1. Para la app y el mantenimiento para que nadie escriba ni purgue: `$C stop app maintenance`.
2. Haz una copia del estado actual por si acaso (aunque esté dañado): `$C exec backup sh /usr/local/bin/enregla-backup.sh`.
3. Recrea la base y restaura:

   ```bash
   $C exec db dropdb -U enregla enregla
   $C exec db createdb -U enregla enregla
   $C exec -T db pg_restore -U enregla --no-owner --no-privileges --exit-on-error -d enregla < "$F"
   ```

4. **Imprescindible**: vuelve a separar los roles y a fijar los permisos: `$C exec -T db sh /docker-entrypoint-initdb.d/10-enregla-roles.sh` y `$C run --rm migrate` (apartado 13). Por qué: `pg_restore --no-owner --no-privileges` crea las tablas y funciones a nombre del administrador y **sin permisos**, y PostgreSQL deja entonces todas las funciones ejecutables por cualquiera (también las de purga). El script pasa todo a `enregla_owner` y `migrate` vuelve a dejar **todos** los permisos como deben estar (PUBLIC sin ejecutar ninguna función ni crear tablas temporales, `enregla_app` y `enregla_backup` con lo justo), aunque no haya migraciones nuevas. Hay una prueba automatizada de este mismo recorrido (`server/test/eval-fase1c.test.ts`, «restauración»). Si te saltas este paso, la app **no arranca** en producción y su log dice qué falta («…ejecuta docker compose … run --rm migrate…»).
5. Arranca la app y el mantenimiento: `$C up -d app maintenance` y comprueba `/readyz`, el login y el historial de un local. Las sesiones no están en la copia: **todos los usuarios tendrán que volver a iniciar sesión** (y los enlaces de email pendientes habrá que pedirlos de nuevo).
6. Si la copia es de una versión anterior de la app, `migrate` aplica las migraciones que falten.

En un servidor nuevo: instala Docker y clona el repositorio. Recupera de tu gestor de contraseñas **`server/.env` y los cuatro ficheros de `deploy/secrets/`** (`db.env`, `owner.env`, `backup.env`, `app-db.env`, con permisos 600): sin ellos no tienes los secretos y `up -d db` falla (son `required`). Si has perdido los de `deploy/secrets/`, genera otros con `sh deploy/generate-db-secrets.sh` (al restaurar en un volumen nuevo, el script de inicio crea los roles con las claves nuevas). Después `$C up -d db`, restaura como arriba (pasos 3 a 5) y por último `$C up -d --build`.

## 5. Actualizar y volver atrás

```bash
cd enregla
git fetch && git log --oneline HEAD..origin/main     # qué cambia
C="docker compose -f docker-compose.prod.yml --env-file server/.env"
$C exec backup sh /usr/local/bin/enregla-backup.sh  # copia ANTES de actualizar
git pull
$C up -d --build migrate app                         # migraciones (rol propietario) y después la app
$C logs migrate                                      # migraciones y permisos aplicados, sin errores
$C logs -f app
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
- **Mantenimiento** (`$C logs maintenance`, JSON): una línea «Mantenimiento hecho» cada hora. Un error «PURGA BLOQUEADA…» significa que la salvaguarda diaria ha parado las purgas (apartado 10): revisa la auditoría antes de subir el tope. Si deja de aparecer «Mantenimiento hecho», los locales pendientes no se están purgando.
- Si el proceso muere por un error no controlado, se apaga de forma ordenada con código 1 y Docker lo reinicia (`restart: unless-stopped`).

## 7. Rotación de secretos

Tras cambiar cualquier valor de `server/.env`: `$C up -d app` (recrea el contenedor con la nueva configuración).

| Secreto | Cómo rotarlo |
|---|---|
| `POSTGRES_PASSWORD` | `$C exec db psql -U enregla -d enregla -c "ALTER ROLE enregla PASSWORD 'NUEVA'"` y cambia `POSTGRES_PASSWORD` en `deploy/secrets/db.env` (ningún otro servicio la usa; la variable del contenedor `db` solo se usa al crear el volumen la primera vez) |
| `DB_APP_PASSWORD` / `DB_OWNER_PASSWORD` / `DB_BACKUP_PASSWORD` | cambia el valor en `deploy/secrets/db.env` **y** como `PGPASSWORD` en el fichero del servicio que la usa (`app-db.env`, `owner.env` o `backup.env`), ejecuta `$C up -d db` y `$C exec -T db sh /docker-entrypoint-initdb.d/10-enregla-roles.sh` (fija las contraseñas nuevas); después `$C up -d migrate maintenance app backup` |
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
- **Eliminar un local** no lo borra al momento: queda **pendiente de eliminación 30 días** (el plazo mínimo lo fija la base de datos en `enregla_owner_settings.org_deletion_grace_days`; la app no puede acortarlo), en solo lectura, sin carta pública, sin dispositivos de cocina y sin recordatorios; un propietario puede restaurarlo o **pedir la eliminación inmediata** (con su contraseña).
- **Quién borra**: la app **no puede** borrar locales. Lo hace el servicio **`maintenance`** (rol propietario), **cada hora**: purga los locales cuyo plazo venció y los que tienen la eliminación inmediata pedida. Por eso la interfaz y el PDF dicen «se eliminará en la próxima hora»: tras confirmar, el local sigue (en solo lectura) hasta la siguiente pasada, y el titular aún puede restaurarlo. Cada purga deja en la auditoría `org.purged` con el motivo (`plazo_vencido` o `eliminacion_inmediata_solicitada`), quién la pidió (`deletion_requested_by`, `purge_requested_by`) y el número de registros borrados. La base de datos comprueba que quien figura como solicitante es **propietario del local** en ese momento; no puede saber si fue esa persona en persona o alguien con las credenciales de la app, por eso el motivo no dice «del titular».
- **Facturación antes de borrar**: al pedir la eliminación inmediata, la app consulta Stripe y cancela la suscripción viva o el Checkout abierto; **si Stripe falla, la petición no se registra** (502/503 con el mensaje). Para los locales cuyo plazo vence, lo hace la tarea diaria de la app («Purga de local aplazada…» en el log si falla; se reintenta al día siguiente). El mantenimiento no se fía solo de la base de datos: guarda (en una tabla que solo ve el propietario) **todas las suscripciones de Stripe que ha tenido cada local**, y no purga un local mientras alguna no esté **comprobada en Stripe como terminada** (`purge_blocked_reason = 'suscripcion_sin_verificar_en_stripe'`; con la suscripción viva en la base de datos, `'suscripcion_viva'`). Para comprobarlo, el servicio `maintenance` usa `STRIPE_SECRET_KEY` (de `server/.env`; basta una clave restringida con lectura de suscripciones). Sin ella, los locales que hayan tenido suscripción no se purgan y el log de `maintenance` lo dice. Todo cambio de `stripe_subscription_id` o `subscription_status` queda en la auditoría (`db.org_billing_changed`, escrito por la base de datos).
- **Salvaguarda diaria**: si en una pasada se fueran a purgar más locales de los permitidos en 24 horas (`enregla_owner_settings.max_purges_per_day`, **3** por defecto; solo cuentan los que de verdad se pueden purgar, y los `org.purged` solo los puede escribir el propietario, así que no se pueden fabricar para bloquearla), el mantenimiento **no purga ninguno**, deja `maintenance.purge_blocked` en la auditoría y escribe en su log un error «PURGA BLOQUEADA…». Revisa entonces quién pidió esas eliminaciones (eventos `db.org_deletion_changed`, con el usuario de la base de datos y la IP) y, si son legítimas, sube el tope temporalmente: `$C exec db psql -U enregla -d enregla -c "UPDATE enregla_owner_settings SET value = '10' WHERE key = 'max_purges_per_day'"`. Mientras la salvaguarda bloquee, «en la próxima hora» no se cumple para nadie. Monitoriza el log de `maintenance` (apartado 6).
- Ojo: los datos de un local purgado **siguen en las copias de seguridad** hasta que estas caducan por su retención; tenlo en cuenta en tu política de privacidad.
- **Local pendiente cuyo único propietario borra su cuenta**: se permite (los locales pendientes no bloquean el borrado de la cuenta). Desde ese momento nadie puede restaurarlo ni pedir su eliminación inmediata: se conserva hasta su fecha (los encargados que queden pueden consultar y descargar informes) y entonces lo purga el mantenimiento. Quedarse sin miembros **ya no** adelanta la purga (era una forma de borrar un local al instante).
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

## 13. Roles de la base de datos (registros no modificables)

La aplicación no tiene ninguna forma de modificar ni borrar un registro (las correcciones son registros nuevos) y un trigger de PostgreSQL rechaza `UPDATE` y `DELETE` en `records`. Pero un trigger lo puede desactivar el **propietario** de la tabla. Por eso los compose separan, **por defecto**, tres roles:

| Rol | Para qué | Qué puede hacer |
|---|---|---|
| `enregla` (`POSTGRES_PASSWORD`) | administración a mano (`$C exec db psql -U enregla`); ningún servicio lo usa | todo (superusuario del contenedor) |
| `enregla_owner` (`DB_OWNER_PASSWORD`) | servicios `migrate` (migraciones y permisos, en un paso aparte que termina antes de arrancar la app) y `maintenance` (cada hora: purga de locales y de auditoría antigua) | propietario del esquema y de las tablas; único que puede ejecutar las funciones de purga |
| `enregla_backup` (`DB_BACKUP_PASSWORD`) | servicio `backup` (`pg_dump`) | **solo `SELECT`**, tabla a tabla (lo fija `migrate`), sin ver las filas de las tablas que no se copian; ninguna función |
| `enregla_app` (`DB_APP_PASSWORD`) | la app (`MIGRATE_ON_START=false`) | leer y escribir las tablas normales; en `records` **solo `SELECT` e `INSERT`**, y la hora (`created_at`) y el orden (`seq`) de cada registro los pone PostgreSQL (trigger, migración 0007), no la app. **Sin `DELETE`** en `organizations`, `devices`, `staff`, `equipment` y `cleaning_plans` (un borrado ahí arrastraría registros en cascada) y **sin permiso para ejecutar** las funciones de purga (`enregla_purge_organization`, `enregla_purge_due_organizations`, `enregla_purge_audit_events`): solo marca la petición. En `organizations`, un trigger impide adelantar el plazo (`deletion_scheduled_at` nunca antes de `deletion_requested_at` + plazo mínimo, y la petición con la hora actual) y tocar `purge_blocked_reason`. `audit_events`: solo `SELECT` e `INSERT`, y la hora (`created_at`) la pone PostgreSQL; la seudonimización solo funciona con cuentas ya borradas. En `equipment` y `cleaning_plans`, `UPDATE` solo de las columnas que edita la app (no `created_at`, que movería el historial). Historial de configuración: solo lectura (lo escriben triggers del propietario). Ajustes del propietario (`enregla_owner_settings`): solo lectura. Sin DDL, sin tablas temporales, sin ser propietario de nada (no puede desactivar triggers) y sin `TRUNCATE` |

### La carpeta `deploy/secrets/`

Un fichero por servicio, cada uno solo con lo que ese servicio necesita (los crea `sh deploy/generate-db-secrets.sh`, con permisos 600; los `*.example` muestran el formato):

| Fichero | Lo lee | Contiene |
|---|---|---|
| `db.env` | solo `db` | `POSTGRES_PASSWORD`, `DB_OWNER_PASSWORD`, `DB_APP_PASSWORD`, `DB_BACKUP_PASSWORD` (el script de inicio crea los roles con ellas) |
| `owner.env` | `migrate` y `maintenance` | `PGPASSWORD` del rol propietario |
| `backup.env` | `backup` | `PGPASSWORD` del rol de solo lectura |
| `app-db.env` | `app` | `PGPASSWORD` del rol de ejecución |

Compruébalo con `docker compose -f docker-compose.prod.yml --env-file server/.env config`: `db` recibe las cuatro claves; `migrate` y `maintenance`, solo `PGPASSWORD` (propietario); `backup`, solo `PGPASSWORD` (solo lectura); `app`, solo `PGPASSWORD` (ejecución) y `SMTP_PASS`. `.gitignore` excluye todo `deploy/secrets/` salvo los `*.example`.

En producción **la app no arranca** si encuentra `POSTGRES_PASSWORD` o `DB_*_PASSWORD` en su entorno, ni si su rol tiene **cualquiera** de los problemas que comprueba al arrancar (todos con pertenencia directa o indirecta, `pg_has_role`):

- **Rol equivocado** (el mensaje pide conectar con `enregla_app`): superusuario o propietario de `records` o miembro de ellos; miembro de `pg_execute_server_program`, `pg_read_server_files`, `pg_write_server_files` o `pg_write_all_data`; atributos `CREATEROLE`, `CREATEDB`, `BYPASSRLS` o `REPLICATION` en él o en un rol del que sea miembro.
- **Permisos** (el mensaje pide ejecutar `$C run --rm migrate`, que los repara; p. ej. tras restaurar una copia): `UPDATE`/`DELETE`/`TRUNCATE` en `records`, `DELETE` en `organizations`, permiso para ejecutar cualquier función de purga, o para crear tablas temporales.

No hay forma de saltarse esta comprobación: `ALLOW_PRIVILEGED_DB_ROLE` **ya no existe** (con un rol privilegiado o con la purga ejecutable, la app volvería a poder borrar locales al instante). Un despliegue sin separación de roles no es válido en producción.

### Lo que la base de datos garantiza y lo que no (riesgo residual)

- **Garantiza** (comprobado con los roles reales, `server/test/eval-fase1*.test.ts`), frente a quien tenga las credenciales de la app:
  - los registros: no se pueden modificar, borrar ni desactivar su trigger; su hora (`created_at`, `effective_at`) y su orden (`seq`) los pone PostgreSQL con el **reloj** en el momento del INSERT (no la hora de inicio de la transacción: mantener una transacción abierta no sirve para atrasarlos); una corrección solo puede apuntar a un registro **del mismo local y tipo**, y equipo, plan, persona, tablet y proveedor de un registro tienen que ser del mismo local (claves foráneas compuestas y comprobaciones en la base de datos);
  - la auditoría: no se puede borrar ni editar; su hora la pone el reloj; los eventos que escribe la base de datos (`db.*`, `org.purged`, `maintenance.*`) **no** los puede insertar la app; la retención mínima es de 12 meses;
  - el historial de configuración: no se puede reescribir ni crear con fecha atrasada (el alta de equipos y planes toma la hora del reloj);
  - los locales: no se pueden borrar ni ejecutar su purga; no se puede programar la eliminación con menos de 30 días ni con fechas falsas; la solicitud debe figurar a nombre de un **propietario real** del local; cada cambio de los campos de eliminación y de facturación y cada acceso retirado los registra la base de datos (`db.org_deletion_changed`, `db.org_billing_changed`, `db.membership_deleted`, con el usuario de PostgreSQL y la IP);
  - no se pueden crear tablas temporales para suplantar funciones ni ejecutar ninguna función salvo las imprescindibles para sus triggers;
  - el rol de copias no puede escribir nada ni leer las tablas que no se copian.
- **No impide** (riesgo residual): quien tenga las credenciales de la app puede hacer lo mismo que la app permite a un propietario: **programar la eliminación de un local y pedir su eliminación inmediata** a nombre de uno de sus propietarios. Con la eliminación inmediata, el plazo de 30 días **no** se respeta: el mantenimiento lo purga en la siguiente pasada (**como mucho una hora**), salvo que la salvaguarda diaria lo bloquee (más de `max_purges_per_day` en 24 h: no purga ninguno) o que el local tenga una suscripción sin comprobar en Stripe. Queda registrado en la auditoría, que ese rol no puede borrar. Con la salvaguarda por defecto, un atacante con las credenciales de la app podría hacer desaparecer **hasta 3 locales al día** antes de que salte el bloqueo. También puede cambiar los datos que la app deja cambiar (nombres, ajustes, roles de los miembros…) y leer todo lo que la app lee. Defensas: proteger `app-db.env`, vigilar el log de `maintenance` y los eventos `db.org_deletion_changed` con `session_user` o IP inesperados, bajar `max_purges_per_day` si tu volumen lo permite, y tener copias **cifradas** fuera del servidor (los datos purgados siguen en ellas hasta que caducan).
- **Tampoco impide** lo que haga quien tenga la clave del **propietario** o del **administrador**: lo pueden todo (desactivar triggers, borrar, cambiar la auditoría). Protégelas como el acceso al servidor. Y nada de esto sustituye a las copias de seguridad.

Los crea `deploy/postgres-init/10-enregla-roles.sh` (lo ejecuta PostgreSQL al crear el volumen) y los permisos los fija `migrate` tras cada migración (`APP_DB_ROLE=enregla_app` → `server/src/db/privileges.ts`), así que también cubren las tablas nuevas. Al eliminar un local, el borrado en cascada de sus registros lo hace PostgreSQL con los permisos del propietario de la tabla y el trigger solo lo permite cuando el local ya no existe.

Al arrancar, la app comprueba con qué permisos conecta y, si encuentra algún problema (los de la lista anterior), escribe un aviso en el log; en producción, además, se niega a arrancar.

**Comprobado** (PostgreSQL 16, base desechable): con `enregla_app`, `ALTER TABLE records DISABLE TRIGGER …` → «must be owner of table records»; `UPDATE`/`DELETE`/`TRUNCATE records` → «permission denied for table records»; `CREATE TABLE` → «permission denied for schema public»; `SET session_replication_role` → denegado. La app arranca y funciona con ese rol (la suite e2e completa pasa contra él). Segunda evaluación (migración 0009), también con `enregla_app`: `SELECT enregla_purge_organization(…)` y `enregla_purge_audit_events(…)` → «permission denied»; adelantar `deletion_scheduled_at` o atrasar `deletion_requested_at` → rechazado por el trigger; `CREATE TEMP TABLE` → «permission denied»; `INSERT INTO audit_events (…, created_at)` con una fecha antigua → se guarda la hora actual; `UPDATE equipment SET created_at = …` → «permission denied». La purga la hace `maintenance` (`enregla_owner`) y la auditoría la registra con `session_user = enregla_owner`.

Comprobación en tu servidor:

```bash
C="docker compose -f docker-compose.prod.yml --env-file server/.env"
$C exec -T db sh -c 'PGPASSWORD="$DB_APP_PASSWORD" psql -h 127.0.0.1 -U enregla_app -d enregla -c "ALTER TABLE records DISABLE TRIGGER records_immutable_trg"'   # debe fallar
$C exec -T db sh -c 'PGPASSWORD="$DB_APP_PASSWORD" psql -h 127.0.0.1 -U enregla_app -d enregla -c "UPDATE records SET alert = alert"'                       # debe fallar
# Tras restaurar una copia, también: nadie salvo el propietario puede ejecutar la purga (debe salir 0).
$C exec db psql -U enregla -d enregla -Atc "SELECT count(*) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname LIKE 'enregla_purge%' AND (has_function_privilege('enregla_app', p.oid, 'EXECUTE') OR has_function_privilege('enregla_backup', p.oid, 'EXECUTE'))"
```

### Migrar un despliegue existente (anterior a esta versión)

Antes la app se conectaba como `enregla`, el superusuario del contenedor. Para pasar a roles separados sin perder datos:

1. Copia de seguridad: `$C exec backup sh /usr/local/bin/enregla-backup.sh` (o `pg_dump` a mano) y comprueba que el fichero existe.
2. `git pull`, crea las claves con `sh deploy/generate-db-secrets.sh`, pon en `deploy/secrets/db.env` como `POSTGRES_PASSWORD` la que tenías en `server/.env` y **quita** `POSTGRES_PASSWORD` de `server/.env` (la app ya no debe verla: en producción no arranca si la encuentra).
3. Recrea `db` con el nuevo volumen de inicio y sus variables (los datos no se tocan): `$C up -d db`.
4. Crea los roles y pasa la propiedad de todo a `enregla_owner` (idempotente): `$C exec -T db sh /docker-entrypoint-initdb.d/10-enregla-roles.sh`.
5. Migraciones y permisos con el rol propietario: `$C run --rm migrate` (debe terminar con «Permisos del rol de la app (enregla_app) aplicados»).
6. Arranca la app con el rol de ejecución: `$C up -d --build migrate app`. Comprueba `/readyz`, que el log **no** muestra el aviso de roles y las dos órdenes de comprobación de arriba.

Volver atrás: el código anterior conectaba como `enregla` (superusuario), que sigue teniendo acceso a todo, así que basta con desplegar la versión anterior. Si despliegas sin Docker, aplica lo mismo a mano: crea los dos roles con el script (como superusuario y con `POSTGRES_DB`/`POSTGRES_USER` exportados), ejecuta `npm run migrate:prod` con el rol propietario y `APP_DB_ROLE=enregla_app`, y arranca la app con el rol de ejecución y `MIGRATE_ON_START=false`. `docs/db-roles-hardening.sql` queda como referencia del mismo esquema en SQL.

## 14. La tablet de cocina: modo de acceso guiado

«Salir del modo cocina» y «Desvincular esta tablet» piden la contraseña de un propietario o encargado, pero «Salir» solo cambia la pantalla: el navegador de la tablet puede seguir yendo a cualquier dirección. Para que en cocina solo se pueda usar EnRegla, fija la tablet con el modo de acceso guiado o quiosco del sistema:

- **iPad**: Ajustes → Accesibilidad → Acceso guiado (activa un código). Abre EnRegla en el modo cocina y pulsa tres veces el botón lateral o de inicio para empezar la sesión guiada.
- **Android**: Ajustes → Seguridad → Fijar aplicación (o «Fijar pantalla»). Abre EnRegla y fíjala desde la vista de aplicaciones recientes; para soltarla hace falta el patrón o PIN del dispositivo.

Así una persona de la cocina no puede salir del modo cocina sin el código del dispositivo, aunque toque «Salir».

Quién firma en la tablet: tras elegir persona, la franja «Registrando como Ana» queda siempre visible con «Cambiar de persona» y un botón grande **«He terminado»** (olvida a la persona). Si pasan **20 s** sin tocar la pantalla, la tablet pasa a pantalla completa **«¿Eres Ana?»** («Sí, soy Ana» con un toque, o «No, soy otra persona»), así que el siguiente toque siempre confirma quién firma. Las respuestas están **arriba** (en la franja de la cabecera, no donde están los equipos), el resto de la pantalla es neutro y durante 0,7 s tras aparecer no se acepta ningún toque: quien toque a ciegas donde estaba un equipo no responde «Sí» sin querer. A los **60 s** sin tocarla se olvida a la persona. **«Corregir»** el último registro pide siempre el PIN de quien lo hizo (si tiene) antes de abrir el formulario, y lo comprueba el servidor.

PIN bloqueado: tras 5 PIN erróneos, la persona queda bloqueada **1 minuto**; si se repite sin que nadie acierte, **5** y luego **15** minutos. Un propietario o encargado lo desbloquea al momento en la propia tablet («Desbloquear (responsable)», con su email y contraseña; queda en la auditoría) o en Ajustes → Personal. Ajustes avisa si alguien del personal no tiene PIN: sin PIN, cualquiera puede firmar con su nombre.

