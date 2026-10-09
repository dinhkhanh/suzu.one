#!/usr/bin/env bash
# One logical dump of the production database (docs/BACKUP_PLAN.md §3.1): the app's three schemas,
# custom format, owners and grants left out so it restores into any Postgres 17.
#
#   BACKUP_DATABASE_URL=postgresql://backup_reader.<ref>:…@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres \
#     scripts/backup/dump.sh suzu.dump
#
# The URL is Supabase's **session** pooler (port 5432): the transaction pooler cannot hold the
# snapshot a dump reads from, and the direct host is IPv6-only. The role is `backup_reader`
# (setup.sql), which may read everything and bypass row-level security — every table has RLS on
# and no policies, and pg_dump refuses to dump a table RLS would filter.
#
# Writes the dump, and beside it `<file>.tables`: how many tables the database held as the dump
# began, which check-dump.sh compares with what the dump holds.
# shellcheck source=scripts/backup/lib.sh
source "$(dirname "$0")/lib.sh"

out="${1:?usage: dump.sh <file.dump>}"
: "${BACKUP_DATABASE_URL:?BACKUP_DATABASE_URL is not set}"
require_pg17

schema_list="$(printf "'%s'," "${DUMP_SCHEMAS[@]}")"
pg psql "$BACKUP_DATABASE_URL" -X -A -t -v ON_ERROR_STOP=1 \
  -c "select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where c.relkind = 'r' and n.nspname in (${schema_list%,})" >"$out.tables"

schema_args=()
for schema in "${DUMP_SCHEMAS[@]}"; do schema_args+=(--schema="$schema"); done
step "Dumping ${DUMP_SCHEMAS[*]}"
pg pg_dump "$BACKUP_DATABASE_URL" --format=custom --no-owner --no-privileges "${schema_args[@]}" --file "$out"
