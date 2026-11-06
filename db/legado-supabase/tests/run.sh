#!/usr/bin/env bash
# Prueba las migraciones y las reglas de seguridad en un Postgres temporal.
# Uso: bash supabase/tests/run.sh
set -euo pipefail
DIR="$(cd "$(dirname "$0")/.." && pwd)"
PGBIN="${PGBIN:-/usr/lib/postgresql/16/bin}"
TMP="$(mktemp -d)"
RUN=()
if [ "$(id -u)" = "0" ]; then chown postgres "$TMP"; RUN=(runuser -u postgres --); fi
PORT="${PGPORT_TEST:-55432}"
"${RUN[@]}" "$PGBIN/initdb" -D "$TMP/data" -U postgres -A trust >/dev/null
"${RUN[@]}" "$PGBIN/pg_ctl" -D "$TMP/data" -o "-p $PORT -k $TMP" -l "$TMP/log" start >/dev/null
trap '"${RUN[@]}" "$PGBIN/pg_ctl" -D "$TMP/data" stop >/dev/null; rm -rf "$TMP"' EXIT
PSQL=(psql -h "$TMP" -p "$PORT" -U postgres -d postgres -v ON_ERROR_STOP=1 -q)
"${PSQL[@]}" -f "$DIR/tests/00_simular_supabase.sql"
for f in "$DIR"/migrations/*.sql; do "${PSQL[@]}" -f "$f"; done
"${PSQL[@]}" -c "grant usage on schema public to anon, authenticated;
  grant all on all tables in schema public to authenticated;
  grant all on all sequences in schema public to authenticated;
  grant all on all tables in schema public to service_role;"
"${PSQL[@]}" -f "$DIR/tests/10_reglas.sql"
echo "OK: migraciones y reglas verificadas"
