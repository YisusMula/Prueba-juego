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

---

## 1. Requisitos

- Un servidor Linux con Docker y el plugin `docker compose` (v2). 2 GB de RAM son suficientes para empezar.
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

El volcado y la restauración se probaron en local (PostgreSQL 16) con una base de 465.039 registros: `deploy/backup.sh` → base nueva → `pg_restore` → mismos recuentos de registros, locales, usuarios, historial de configuración y migraciones, mismo hash de `(id, created_at, effective_at)` de todos los registros, y el trigger de inmutabilidad presente y activo. **No se pudo probar con Docker** (no había demonio de Docker en el entorno de pruebas): los comandos `docker compose …` de esta guía no se han ejecutado; `docker compose config` sí valida los dos ficheros.

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

4. Arranca la app: `$C start app` y comprueba `/readyz`, el login y el historial de un local.
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
- **Impagos**: con `past_due` el local sigue funcionando (periodo de gracia) y la interfaz avisa del pago fallido; Stripe reintenta el cobro. Si Stripe la deja en `unpaid` o `canceled`, el local pasa a solo lectura (sin perder datos) hasta que se pague.
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

- **Bandeja de emails**: guarda temporalmente destinatario, asunto y cuerpo (que puede contener enlaces de un solo uso). Los enviados se borran a las **6 horas** y los fallidos definitivos a los **3 días**. El error guardado no incluye direcciones, URL ni tokens.
- **Claves de idempotencia** de altas de registros: 7 días.
- **Eliminar un local** no lo borra al momento: queda **pendiente de eliminación 30 días** (`ORG_DELETION_GRACE_DAYS`), en solo lectura, sin carta pública, sin dispositivos de cocina y sin recordatorios; un propietario puede restaurarlo o pedir la eliminación inmediata y definitiva (con su contraseña). La tarea diaria lo purga al vencer el plazo. Ojo: los datos de un local purgado **siguen en las copias de seguridad** hasta que estas caducan por su retención; tenlo en cuenta en tu política de privacidad.
- El resto de plazos de retención están en el README («Retención de datos»).
