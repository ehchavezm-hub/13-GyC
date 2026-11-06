#!/usr/bin/env bash
# Prueba las migraciones de Neon (000 + 035 + 036) en un PostgreSQL temporal y luego el API contra esa base.
# Uso: bash db/tests/run.sh        (requiere PostgreSQL 16 y haber ejecutado "npm ci" en la raíz)
set -euo pipefail
RAIZ="$(cd "$(dirname "$0")/../.." && pwd)"
PGBIN="${PGBIN:-/usr/lib/postgresql/16/bin}"
TMP="$(mktemp -d)"
RUN=()
if [ "$(id -u)" = "0" ]; then chown postgres "$TMP"; chmod 755 "$TMP"; RUN=(runuser -u postgres --); fi
PORT="${PGPORT_TEST:-55433}"
"${RUN[@]}" "$PGBIN/initdb" -D "$TMP/data" -U postgres -A trust >/dev/null
"${RUN[@]}" "$PGBIN/pg_ctl" -D "$TMP/data" -o "-p $PORT -k $TMP" -l "$TMP/log" start >/dev/null
trap '"${RUN[@]}" "$PGBIN/pg_ctl" -D "$TMP/data" stop >/dev/null; rm -rf "$TMP"' EXIT
PSQL=(psql -h "$TMP" -p "$PORT" -U postgres -v ON_ERROR_STOP=1 -q)
"${PSQL[@]}" -d postgres -c "create database gyc"
"${PSQL[@]}" -d gyc -f "$RAIZ/db/migrations/000_gyc_neon_completo.sql"
"${PSQL[@]}" -d gyc -f "$RAIZ/db/migrations/035_compatibilidad_api.sql"
"${PSQL[@]}" -d gyc -f "$RAIZ/db/migrations/035_compatibilidad_api.sql"   # se puede ejecutar más de una vez
"${PSQL[@]}" -d gyc -f "$RAIZ/db/migrations/036_cuentas_preasignadas.sql"
"${PSQL[@]}" -d gyc -f "$RAIZ/db/migrations/036_cuentas_preasignadas.sql"
echo "OK: migraciones 000 + 035 + 036"
"${PSQL[@]}" -d postgres -c "create database gyc_api"
DATABASE_URL_PRUEBAS="postgres://postgres@localhost:$PORT/gyc_api?host=$TMP" node --test "$RAIZ/pruebas/api/api.test.mjs"
echo "OK: API compatible con la base"
