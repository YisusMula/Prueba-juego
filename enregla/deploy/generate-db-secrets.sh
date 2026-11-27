#!/bin/sh
# =============================================================================
# EnRegla — genera las claves de la base de datos: UN FICHERO POR SERVICIO, cada uno solo con lo
# que ese servicio necesita (N8). Ninguno lo recibe la app salvo app-db.env.
#
#   deploy/secrets/db.env      → POSTGRES_PASSWORD, DB_OWNER_PASSWORD, DB_APP_PASSWORD,
#                                DB_BACKUP_PASSWORD. Solo el servicio db (crea los roles al iniciar).
#   deploy/secrets/owner.env   → PGPASSWORD del rol propietario enregla_owner. migrate y maintenance.
#   deploy/secrets/backup.env  → PGPASSWORD del rol de solo lectura enregla_backup. Solo backup.
#   deploy/secrets/app-db.env  → PGPASSWORD del rol enregla_app. Solo la app.
#
# La app nunca recibe la clave del administrador ni la del propietario: con ellas se podría
# desactivar el trigger que impide modificar o borrar registros.
# Uso (desde enregla/):  sh deploy/generate-db-secrets.sh
# No sobrescribe ficheros existentes (para cambiar las claves, ver docs/OPERACIONES.md, apartado 7).
# =============================================================================
set -eu
cd "$(dirname "$0")/secrets"
umask 077
gen() { openssl rand -base64 36 | tr -d '\n/+=' | cut -c1-40; }
for f in db.env owner.env backup.env app-db.env; do
  if [ -e "$f" ]; then
    echo "deploy/secrets/$f ya existe: no se toca nada." >&2
    exit 1
  fi
done
OWNER="$(gen)"
APP="$(gen)"
BACKUP="$(gen)"
{
  echo "# Generado por deploy/generate-db-secrets.sh. Solo para el servicio db."
  echo "POSTGRES_PASSWORD=$(gen)"
  echo "DB_OWNER_PASSWORD=$OWNER"
  echo "DB_APP_PASSWORD=$APP"
  echo "DB_BACKUP_PASSWORD=$BACKUP"
} > db.env
{
  echo "# Generado por deploy/generate-db-secrets.sh. Solo para migrate y maintenance (rol enregla_owner)."
  echo "PGPASSWORD=$OWNER"
} > owner.env
{
  echo "# Generado por deploy/generate-db-secrets.sh. Solo para backup (rol enregla_backup, solo lectura)."
  echo "PGPASSWORD=$BACKUP"
} > backup.env
{
  echo "# Generado por deploy/generate-db-secrets.sh. Solo para la app (rol enregla_app)."
  echo "PGPASSWORD=$APP"
} > app-db.env
echo "Creados deploy/secrets/db.env, owner.env, backup.env y app-db.env (permisos 600). Guárdalos en tu gestor de contraseñas."
