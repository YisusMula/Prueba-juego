#!/bin/sh
# Copia de seguridad de la base de datos de EnRegla con pg_dump (formato custom, comprimido).
#
# Variables (las mismas que usa libpq / psql):
#   PGHOST, PGPORT (5432), PGUSER, PGPASSWORD, PGDATABASE   conexión a PostgreSQL
#   BACKUP_DIR              carpeta de destino (por defecto /backups)
#   BACKUP_RETENTION_DAYS   días que se conservan las copias locales (por defecto 14)
#   BACKUP_POST_HOOK        (opcional) comando que se ejecuta tras cada copia, con su ruta en la
#                           variable BACKUP_FILE; p. ej. para subirla FUERA del servidor:
#                           BACKUP_POST_HOOK='rclone copy "$BACKUP_FILE" remoto:enregla-backups'
#                           (en server/.env para docker compose, escribe $$BACKUP_FILE)
#
# Uso:   PGHOST=... PGUSER=... PGPASSWORD=... PGDATABASE=... ./deploy/backup.sh
# Salida: $BACKUP_DIR/enregla-AAAAMMDD-HHMMSS.dump (+ .sha256). Código distinto de 0 si falla.
# Restaurar: ver docs/OPERACIONES.md («Restaurar una copia»).
set -eu

BACKUP_DIR="${BACKUP_DIR:-/backups}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-14}"
: "${PGDATABASE:?Define PGDATABASE}"

mkdir -p "$BACKUP_DIR"
stamp="$(date -u +%Y%m%d-%H%M%S)"
final="$BACKUP_DIR/enregla-$stamp.dump"
tmp="$final.partial"

log() { echo "[backup $(date -u +%Y-%m-%dT%H:%M:%SZ)] $*"; }
trap 'rm -f "$tmp"' EXIT

log "Volcando la base $PGDATABASE..."
pg_dump --format=custom --compress=6 --no-owner --no-privileges --file="$tmp" "$PGDATABASE"

# Comprobación mínima de que el fichero es un volcado legible (lista su contenido).
pg_restore --list "$tmp" > /dev/null
mv "$tmp" "$final"
if command -v sha256sum > /dev/null 2>&1; then
  (cd "$BACKUP_DIR" && sha256sum "$(basename "$final")" > "$(basename "$final").sha256")
fi
log "Copia creada: $final ($(du -h "$final" | cut -f1))"

if [ -n "${BACKUP_POST_HOOK:-}" ]; then
  log "Ejecutando BACKUP_POST_HOOK..."
  BACKUP_FILE="$final" sh -c "$BACKUP_POST_HOOK"
fi

# Retención local: borra copias (y sus .sha256) de más de RETENTION_DAYS días.
find "$BACKUP_DIR" -maxdepth 1 -type f \( -name 'enregla-*.dump' -o -name 'enregla-*.dump.sha256' \) -mtime +"$RETENTION_DAYS" -print -delete |
  while read -r f; do log "Borrada por antigüedad: $f"; done
log "Hecho."
