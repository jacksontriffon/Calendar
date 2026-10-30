#!/usr/bin/env bash
# Run the database tests without Docker / the Supabase CLI, against a local PostgreSQL (>= 15).
#
#   supabase/tests/local/run.sh
#
# It creates a fresh scratch database, applies tests/local/shim.sql (stub auth/pgmq/cron/vault/net
# schemas, API roles and a mini pgTAP), every migration except *_extensions.sql (the real
# extensions don't exist locally; the shim stands in for them), then supabase/seed.sql, and finally
# runs every test file (tests/database/*.sql plus tests/local/*.test.sql, the latter only exercise
# the stubs). Exit status is non-zero if anything fails.
#
# Environment:
#   DB_NAME     scratch database name (default calendar_test; it is dropped and recreated)
#   PGHOST / PGPORT / PGUSER / PGPASSWORD   standard libpq variables for a non-root run
# As root (e.g. in a container) it talks to the local cluster as the `postgres` OS user and starts
# the first cluster from `pg_lsclusters` if none is accepting connections (and stops it again).
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SUPA="$(cd "$HERE/../.." && pwd)"
DB="${DB_NAME:-calendar_test}"

if [ "$(id -u)" = 0 ]; then
  pg() { runuser -u postgres -- psql -X "$@"; }
  isready() { runuser -u postgres -- pg_isready -q; }
else
  pg() { psql -X "$@"; }
  isready() { pg_isready -q; }
fi

started_cluster=""
if ! isready 2>/dev/null; then
  if [ "$(id -u)" = 0 ] && command -v pg_lsclusters >/dev/null; then
    read -r ver name _ < <(pg_lsclusters -h)
    echo "starting PostgreSQL cluster $ver/$name"
    pg_ctlcluster "$ver" "$name" start
    started_cluster="$ver $name"
    for _ in $(seq 1 30); do isready 2>/dev/null && break; sleep 0.5; done
  else
    echo "PostgreSQL is not accepting connections (set PGHOST/PGPORT/PGUSER, or start a server)" >&2
    exit 2
  fi
fi
cleanup() { [ -n "$started_cluster" ] && pg_ctlcluster $started_cluster stop || true; }
trap cleanup EXIT

# Quiet: no result sets or NOTICEs from setup (errors still stop the run).
export PGOPTIONS="${PGOPTIONS:-} -c client_min_messages=error"
run() { pg -v ON_ERROR_STOP=1 -q -o /dev/null -d "$DB" "$@"; }

echo "== creating database $DB"
pg -v ON_ERROR_STOP=1 -q -d postgres -c "drop database if exists \"$DB\" with (force)" -c "create database \"$DB\""
# Supabase's default search_path, so tests can call pgTAP/extension functions unqualified.
pg -v ON_ERROR_STOP=1 -q -d postgres -c "alter database \"$DB\" set search_path to \"\$user\", public, extensions"

echo "== shim"
run -f - < "$HERE/shim.sql"

echo "== migrations"
for f in "$SUPA"/migrations/*.sql; do
  case "$f" in
    *_extensions.sql) echo "   skip  $(basename "$f") (stubbed by shim.sql)"; continue ;;
  esac
  echo "   apply $(basename "$f")"
  run --single-transaction -f - < "$f"
done

echo "== seed"
run -f - < "$SUPA/seed.sql"

echo "== tests"
total=0; failed=0; status=0
for f in "$SUPA"/tests/database/*.sql "$SUPA"/tests/local/*.test.sql; do
  [ -e "$f" ] || continue
  name="${f#"$SUPA"/tests/}"
  out="$(mktemp)"
  # Same flags pg_prove uses: bare TAP on stdout. psql errors abort the file.
  if ! pg -v ON_ERROR_STOP=1 -q -A -t -d "$DB" -f - < "$f" > "$out" 2> "$out.err"; then
    echo "-- $name: psql error"; cat "$out.err"; status=1
  fi
  n_ok=$(grep -c '^ok ' "$out" || true)
  n_bad=$(grep -c '^not ok ' "$out" || true)
  skipped=$(grep -c 'SKIP' "$out" || true)
  total=$((total + n_ok + n_bad)); failed=$((failed + n_bad))
  if [ "$n_bad" -gt 0 ] || grep -q '^# Looks like' "$out"; then
    echo "-- $name: FAILED ($n_bad failed, $n_ok passed)"
    grep -E '^(not ok|#)' "$out" || true
    status=1
  elif [ "$skipped" -gt 0 ] && [ "$n_ok" -eq 0 ]; then
    echo "-- $name: skipped"
  else
    echo "-- $name: ok ($n_ok assertions)"
  fi
  rm -f "$out" "$out.err"
done

[ "$total" -gt 0 ] || { echo "no assertions ran"; status=1; }
echo "== $((total - failed))/$total assertions passed"
[ "$status" -eq 0 ] && echo "ALL TESTS PASSED" || echo "TESTS FAILED"
exit "$status"
