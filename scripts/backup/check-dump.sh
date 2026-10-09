#!/usr/bin/env bash
# Proves a dump can be read back (docs/BACKUP_PLAN.md §3.4).
#
#   check-dump.sh <file.dump>            the quick check: the dump's table of contents holds data
#                                        for as many tables as the database had (<file>.tables)
#   check-dump.sh --restore <file.dump>  the whole check: restore it into a throwaway Postgres 17
#                                        container and run verify.sql against it
#
# With --restore and KEEP=1 the container is left running and its URL printed (restore-local.sh);
# otherwise it is removed on the way out. FILE_PATHS_OUT=<file> writes the object paths of the live
# file records to that file, for files.sh to check the file backup against.
# shellcheck source=scripts/backup/lib.sh
source "$(dirname "$0")/lib.sh"

restore=0
if [[ "${1:-}" == "--restore" ]]; then
  restore=1
  shift
fi
dump="${1:?usage: check-dump.sh [--restore] <file.dump>}"
require_pg17

toc="$(pg pg_restore --list "$dump")" || fail "the dump's table of contents cannot be read"
tables_in_dump="$(grep -c ' TABLE DATA ' <<<"$toc" || true)"
# "Archive created at 2026-10-10 01:00:03 +07" — the moment the dump's snapshot was taken.
taken_at="$(sed -n 's/^;[[:space:]]*Archive created at //p' <<<"$toc" | head -1)"
[[ "$tables_in_dump" -gt 0 ]] || fail "the dump holds no table data"
if [[ -f "$dump.tables" ]]; then
  expected="$(tr -d '[:space:]' <"$dump.tables")"
  [[ "$tables_in_dump" -eq "$expected" ]] || fail "the dump holds data for $tables_in_dump tables, the database had $expected"
fi
step "The table of contents is whole: $tables_in_dump tables"
[[ "$restore" -eq 1 ]] || exit 0

# ── The whole check: a throwaway Postgres 17 with pgvector, as on Supabase.
require docker
container="suzu-backup-check-$$"
cleanup() { [[ "${KEEP:-0}" == "1" ]] || docker rm -f "$container" >/dev/null 2>&1 || true; }
trap cleanup EXIT
password="$(openssl rand -hex 16)"
docker pull -q pgvector/pgvector:pg17 >/dev/null
docker run -d --name "$container" -e POSTGRES_PASSWORD="$password" -p 127.0.0.1::5432 pgvector/pgvector:pg17 >/dev/null
port="$(docker port "$container" 5432/tcp | head -1 | sed 's/.*://')"
url="postgresql://postgres:${password}@127.0.0.1:${port}/postgres"
for _ in $(seq 1 60); do
  # The image starts once to initialise and restarts; wait for the server that stays.
  docker exec "$container" pg_isready -U postgres -h 127.0.0.1 >/dev/null 2>&1 && pg psql "$url" -X -q -c 'select 1' >/dev/null 2>&1 && break
  sleep 1
done
pg psql "$url" -X -q -c 'select 1' >/dev/null 2>&1 || fail "the throwaway database did not start"

# Supabase keeps its extensions in their own schema; two columns are typed `extensions.vector`.
# The dump makes `public` itself, so the image's empty one goes first.
pg psql "$url" -X -q -v ON_ERROR_STOP=1 \
  -c 'drop schema public' \
  -c 'create schema extensions' \
  -c 'create extension vector with schema extensions' \
  -c 'create extension btree_gist with schema extensions' >/dev/null

step "Restoring"
started=$SECONDS
pg pg_restore --dbname "$url" --no-owner --no-privileges --exit-on-error --jobs 4 "$dump" || fail "the dump does not restore"
step "Restored in $((SECONDS - started)) s"

restored="$(pg psql "$url" -X -A -t -c "select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where c.relkind = 'r' and n.nspname in ('public', 'app', 'drizzle')")"
[[ "$restored" -eq "$tables_in_dump" ]] || fail "$restored tables restored, the dump holds $tables_in_dump"

taken_iso=""
# Without spaces: PGOPTIONS splits on them.
[[ -n "$taken_at" ]] && taken_iso="$(pg psql "$url" -X -A -t -c "select to_char('${taken_at}'::timestamptz at time zone 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"')" 2>/dev/null || true)"
PGOPTIONS="-c backup.taken_at=${taken_iso}" pg psql "$url" -X -q -v ON_ERROR_STOP=1 -f "$BACKUP_DIR/verify.sql" >/dev/null || fail "verify.sql"
step "verify.sql passed"

# The migration it was taken at must be one this checkout knows (drizzle records each migration as
# the sha256 of its file): a dump from a database that ran an unknown migration is from somewhere
# else, or newer than the code — restore it with a checkout at least that new.
last_hash="$(pg psql "$url" -X -A -t -c 'select hash from drizzle.__drizzle_migrations order by created_at desc limit 1')"
migration=""
for file in "$REPO_DIR"/drizzle/*.sql; do
  if [[ "$(shasum -a 256 "$file" | cut -d' ' -f1)" == "$last_hash" ]]; then
    migration="$(basename "$file" .sql)"
    break
  fi
done
[[ -n "$migration" ]] || fail "the dump's last migration is not one of this checkout's"
step "Taken at migration $migration"

if [[ -n "${FILE_PATHS_OUT:-}" ]]; then
  # Files older than two hours: files.sh leaves objects younger than an hour for the next night.
  pg psql "$url" -X -A -t -v ON_ERROR_STOP=1 \
    -c "select object_path from public.stored_file where status = 'ready' and purged_at is null and created_at < now() - interval '2 hours' order by 1" >"$FILE_PATHS_OUT"
fi

if [[ "${KEEP:-0}" == "1" ]]; then
  printf '\nThe restored database is running in the container %s:\n  %s\nRemove it with: docker rm -f %s\n' "$container" "$url" "$container"
fi
