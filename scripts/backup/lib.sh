# shellcheck shell=bash
# Shared by the backup scripts (docs/BACKUP_PLAN.md). Sourced, never run.
#
# One rule runs through all of them: **nothing about the data reaches the output.** The scheduled
# job runs in a public repository, whose Actions logs anyone can read, so the scripts print the
# names of steps, pass or fail, and counts of tables or files at most — never a row, a name, a
# file key or a size.

set -euo pipefail
# Byte order everywhere, so `sort` and `comm` agree on what sorted means.
export LC_ALL=C

BACKUP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC2034 # used by the scripts that source this
REPO_DIR="$(cd "$BACKUP_DIR/../.." && pwd)"

# The schemas a dump holds: the app's tables, its private functions, and the migration journal.
# Supabase's own (auth, storage, cron, vault) hold nothing of ours.
# shellcheck disable=SC2034
DUMP_SCHEMAS=(public app drizzle)

step() { printf '── %s\n' "$*" >&2; }
fail() {
  printf 'FAILED: %s\n' "$*" >&2
  exit 1
}

# The PostgreSQL 17 client tools: `PG_BIN` when set (CI installs them beside the runner's own),
# otherwise whatever is on the PATH — checked, because an older pg_dump refuses a newer server and
# an older pg_restore cannot read a newer dump.
pg() {
  local tool="${PG_BIN:+$PG_BIN/}$1"
  shift
  "$tool" "$@"
}
require_pg17() {
  local version
  version="$(pg pg_restore --version | grep -oE '[0-9]+' | head -1)"
  [[ "$version" -ge 17 ]] || fail "pg_restore $version: the PostgreSQL 17 client tools are needed (set PG_BIN, e.g. /opt/homebrew/opt/postgresql@17/bin)"
}

require() {
  local tool
  for tool in "$@"; do command -v "$tool" >/dev/null || fail "$tool is not installed"; done
}

# Dates are Vietnam's: the nightly run at 01:00 ICT is that day's backup. A backup's name carries
# the minute it began, so a second run on the same day — by hand — never meets a locked object.
today_ict() { TZ=Asia/Ho_Chi_Minh date +%F; }
stamp_ict() { TZ=Asia/Ho_Chi_Minh date +%FT%H%M; }

# The dead-man's switch (healthchecks.io, as CRON_PING_URL is for the app's schedules):
# `<base>/<check>/start`, then `<base>/<check>` or `<base>/<check>/fail`. Unset = no pings.
ping_check() {
  local check="$1" state="${2:-}"
  [[ -n "${HC_PING_URL:-}" ]] || return 0
  curl -fs -m 10 --retry 3 -o /dev/null "${HC_PING_URL%/}/${check}${state:+/$state}" || printf 'warning: ping %s %s did not go through\n' "$check" "${state:-success}" >&2
}

# R2 over its S3 API, with one of two tokens: one that can only read the production file bucket,
# one that writes the backup buckets.
export AWS_PAGER="" CLOUDSDK_CORE_VERBOSITY=error
r2_files() { AWS_ACCESS_KEY_ID="$R2_FILES_READ_KEY_ID" AWS_SECRET_ACCESS_KEY="$R2_FILES_READ_SECRET" aws --endpoint-url "$R2_ENDPOINT" --region auto "$@"; }
r2_backup() { AWS_ACCESS_KEY_ID="$R2_BACKUP_KEY_ID" AWS_SECRET_ACCESS_KEY="$R2_BACKUP_SECRET" aws --endpoint-url "$R2_ENDPOINT" --region auto "$@"; }
