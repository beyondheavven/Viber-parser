#!/usr/bin/env sh
# Applies every migration to a throwaway Postgres container and runs the SQL
# tests against it. Never touches a Supabase project.
#
#   sh supabase/tests/run.sh [test-file ...]
set -eu

here=$(cd "$(dirname "$0")" && pwd)
root=$(cd "$here/.." && pwd)
image=${PG_TEST_IMAGE:-postgres:17-alpine}
name="viber-sql-test-$$"

cleanup() { docker rm -f "$name" >/dev/null 2>&1 || true; }
trap cleanup EXIT INT TERM

docker run -d --rm --name "$name" -e POSTGRES_PASSWORD=test "$image" >/dev/null

tries=0
until docker exec "$name" pg_isready -U postgres -h 127.0.0.1 >/dev/null 2>&1; do
  tries=$((tries + 1))
  [ "$tries" -gt 60 ] && { echo "postgres did not start" >&2; exit 1; }
  sleep 1
done

psql() { docker exec -i "$name" psql -q -X -v ON_ERROR_STOP=1 -U postgres -d postgres; }

for migration in "$root"/migrations/*.sql; do
  echo "migrate: $(basename "$migration")"
  psql < "$migration"
done

if [ "$#" -eq 0 ]; then
  set -- "$here"/*.test.sql
fi

for test in "$@"; do
  echo "test: $(basename "$test")"
  psql < "$test"
done

echo "ok"
