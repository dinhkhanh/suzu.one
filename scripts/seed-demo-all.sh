#!/usr/bin/env bash
# Rebuilds the demo database in the local Postgres container from nothing: `pnpm db:demo:rebuild`.
#
# The database is `suzu_local` (scripts/container-env.sh), never the one `.env.local` names. It is
# dropped and made again, migrated, and seeded in the order the seeds need: reference data, the
# demo company, projects and daily work, CRM — then, through a dev server on the demo data, the
# timesheets, the obligations, the payroll runs and the bonus run. Files go to a local s3rver.
# About four minutes. Needs the container (`pnpm db:up`) and Docker running.
set -euo pipefail
cd "$(dirname "$0")/.."
source scripts/container-env.sh

STATE="$HOME/.suzu-demo"
mkdir -p "$STATE/s3"
step() { printf '\n── %s\n' "$*"; }

# Local file storage: start s3rver if it is not answering.
if ! curl -s -o /dev/null "$R2_ENDPOINT/"; then
  step "Starting s3rver on $R2_ENDPOINT"
  nohup npx -y s3rver@3 --directory "$STATE/s3" --port 4569 --address 127.0.0.1 --configure-bucket "$STORAGE_BUCKET" >"$STATE/s3rver.log" 2>&1 &
  for _ in $(seq 1 60); do curl -s -o /dev/null "$R2_ENDPOINT/" && break; sleep 2; done
fi

step "Recreating the database $DEMO_DATABASE"
docker exec supabase_db_suzu-one psql -U postgres -v ON_ERROR_STOP=1 -c "drop database if exists ${DEMO_DATABASE} with (force)" -c "create database ${DEMO_DATABASE}"
# drizzle-kit prints a NOTICE per long identifier: keep its log, show it only when it fails.
if ! pnpm db:migrate >"$STATE/migrate.log" 2>&1; then cat "$STATE/migrate.log"; exit 1; fi

step "Reference data, the demo company, projects and daily work, CRM"
npx tsx scripts/seed.ts
npx tsx scripts/seed-demo.ts
npx tsx --require ./scripts/server-only-shim.cjs scripts/seed-demo-pjm.ts
npx tsx --require ./scripts/server-only-shim.cjs scripts/seed-demo-crm.ts

# The rest runs the app's own jobs, so it needs a server on the demo data. Use one already up on
# RECOMPUTE_URL, or start one and stop it (only it) at the end.
STARTED=""
if ! curl -s -o /dev/null "$RECOMPUTE_URL/api/health"; then
  step "Starting a dev server on $RECOMPUTE_URL"
  nohup pnpm next dev --port "${RECOMPUTE_URL##*:}" >"$STATE/dev-server.log" 2>&1 &
  STARTED=$!
  for _ in $(seq 1 90); do curl -s -o /dev/null "$RECOMPUTE_URL/api/health" && break; sleep 2; done
fi
stop_server() {
  [ -n "$STARTED" ] || return 0
  local port="${RECOMPUTE_URL##*:}"
  kill $(lsof -nP -t -iTCP:"$port" -sTCP:LISTEN) 2>/dev/null || true
  pkill -P "$STARTED" 2>/dev/null || true
  kill "$STARTED" 2>/dev/null || true
}
trap stop_server EXIT

step "Timesheets, obligations, payroll runs, the bonus run"
npx tsx scripts/recompute-timesheets.ts
npx tsx scripts/seed-demo-ops.ts
npx tsx scripts/seed-demo-payroll-runs.ts
npx tsx scripts/seed-demo-bonus-run.ts

step "Done: $POSTGRES_URL"
