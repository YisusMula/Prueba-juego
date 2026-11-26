#!/bin/sh
# =============================================================================
# EnRegla — genera las claves de la base de datos, SEPARADAS de las de la app (1.8).
#
#   deploy/secrets/db.env      → POSTGRES_PASSWORD, DB_OWNER_PASSWORD, DB_APP_PASSWORD.
#                                Solo lo leen los servicios db, migrate y backup.
#   deploy/secrets/app-db.env  → PGPASSWORD (la del rol enregla_app). Solo lo lee la app.
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
if [ -e db.env ] || [ -e app-db.env ]; then
  echo "deploy/secrets/db.env o app-db.env ya existen: no se tocan." >&2
  exit 1
fi
APP="$(gen)"
{
  echo "# Generado por deploy/generate-db-secrets.sh. Solo para db, migrate y backup."
  echo "POSTGRES_PASSWORD=$(gen)"
  echo "DB_OWNER_PASSWORD=$(gen)"
  echo "DB_APP_PASSWORD=$APP"
} > db.env
{
  echo "# Generado por deploy/generate-db-secrets.sh. Solo para la app (rol enregla_app)."
  echo "PGPASSWORD=$APP"
} > app-db.env
echo "Creados deploy/secrets/db.env y deploy/secrets/app-db.env (permisos 600). Guárdalos en tu gestor de contraseñas."
