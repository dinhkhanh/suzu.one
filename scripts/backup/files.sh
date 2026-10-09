#!/usr/bin/env bash
# The nightly file backup (docs/BACKUP_PLAN.md §2.2): incremental forever, never a delete.
#
# A stored file never changes — its key is a fresh uuid, the upload refuses an existing key, and
# the only rewrite is `finalizeObject`'s copy onto itself seconds after upload — so each object is
# copied once, and a night's work is only the objects production has and a backup has not:
#
#   R2  FILES_BUCKET → FILES_BACKUP_BUCKET/current/<key>, as it is; an object gone from production
#       moves to deleted/<date>/<key> (locked, expires after 400 days).
#   GCS FILES_BUCKET → GCS_BUCKET/files/<key>.age, encrypted to AGE_RECIPIENT; the job may not
#       delete there, so an object gone from production gets a tombstone instead — its customTime
#       set to now — and the bucket's lifecycle rule removes it 400 days later.
#
# Objects younger than an hour wait for the next night, so none is caught before it is finalized.
# With FILE_PATHS (one object path per line: the live file records of tonight's dump, written by
# check-dump.sh) it then checks that every one of them is in production and in both backups.
#
# Needs: aws (R2 over S3), gcloud signed in (the workflow's Workload Identity Federation), age, jq.
# shellcheck source=scripts/backup/lib.sh
source "$(dirname "$0")/lib.sh"

: "${R2_ENDPOINT:?}" "${FILES_BUCKET:?}" "${FILES_BACKUP_BUCKET:?}" "${GCS_BUCKET:?}" "${AGE_RECIPIENT:?}"
: "${R2_FILES_READ_KEY_ID:?}" "${R2_FILES_READ_SECRET:?}" "${R2_BACKUP_KEY_ID:?}" "${R2_BACKUP_SECRET:?}"
require aws gcloud age jq

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

# "<key>\t<last modified>" for every object under a prefix (the CLI follows the pages itself).
list_r2() {
  local client="$1" bucket="$2" prefix="${3:-}"
  "$client" s3api list-objects-v2 --bucket "$bucket" ${prefix:+--prefix "$prefix"} --query 'Contents[].[Key,LastModified]' --output text | grep -v '^None$' || true
}
hour_ago_utc() { date -u -d '1 hour ago' +%FT%T 2>/dev/null || date -u -v-1H +%FT%T; }
now_utc() { date -u +%FT%TZ; }

# ── Production
list_r2 r2_files "$FILES_BUCKET" >"$work/production.tsv"
cut -f1 "$work/production.tsv" | sort -u >"$work/production"
awk -F'\t' -v cutoff="$(hour_ago_utc)" 'substr($2, 1, 19) <= cutoff { print $1 }' "$work/production.tsv" | sort -u >"$work/settled"
step "Production: $(wc -l <"$work/production" | tr -d ' ') objects"

# ── The R2 copy
list_r2 r2_backup "$FILES_BACKUP_BUCKET" current/ | cut -f1 | sed 's#^current/##' | sort -u >"$work/r2-copy"
comm -23 "$work/settled" "$work/r2-copy" >"$work/r2-new"
comm -13 "$work/production" "$work/r2-copy" >"$work/r2-gone"
while IFS= read -r key; do
  r2_files s3 cp --only-show-errors "s3://$FILES_BUCKET/$key" "$work/object"
  r2_backup s3 cp --only-show-errors "$work/object" "s3://$FILES_BACKUP_BUCKET/current/$key"
  rm -f "$work/object"
done <"$work/r2-new"
today="$(today_ict)"
while IFS= read -r key; do
  r2_backup s3 mv --only-show-errors "s3://$FILES_BACKUP_BUCKET/current/$key" "s3://$FILES_BACKUP_BUCKET/deleted/$today/$key"
done <"$work/r2-gone"
step "R2 copy: $(wc -l <"$work/r2-new" | tr -d ' ') copied, $(wc -l <"$work/r2-gone" | tr -d ' ') moved to deleted/"

# ── Google Cloud
# "<key>\t<customTime or empty>" for every object under files/. An empty bucket is an error to gcloud.
if ! gcloud storage objects list "gs://$GCS_BUCKET/files/**" --format=json >"$work/gcs.json" 2>"$work/gcs.err"; then
  grep -qi 'matched no objects' "$work/gcs.err" || {
    cat "$work/gcs.err" >&2
    fail "listing gs://$GCS_BUCKET/files/"
  }
  echo '[]' >"$work/gcs.json"
fi
jq -r '.[] | [(.name // (.url | sub("^gs://[^/]+/"; ""))), (.custom_time // .customTime // "")] | @tsv' "$work/gcs.json" |
  sed -E 's#^files/##; s#\.age\t#\t#' | sort -u >"$work/gcs.tsv"
cut -f1 "$work/gcs.tsv" | sort -u >"$work/gcs"
awk -F'\t' '$2 == "" { print $1 }' "$work/gcs.tsv" | sort -u >"$work/gcs-live"
comm -23 "$work/settled" "$work/gcs" >"$work/gcs-new"
comm -13 "$work/production" "$work/gcs-live" >"$work/gcs-gone"
while IFS= read -r key; do
  # Streamed: the plain bytes never touch the runner's disk.
  r2_files s3 cp --only-show-errors "s3://$FILES_BUCKET/$key" - |
    age -r "$AGE_RECIPIENT" |
    gcloud storage cp - "gs://$GCS_BUCKET/files/$key.age" --no-clobber --storage-class=COLDLINE --no-user-output-enabled
done <"$work/gcs-new"
tombstone="$(now_utc)"
while IFS= read -r key; do
  gcloud storage objects update "gs://$GCS_BUCKET/files/$key.age" --custom-time="$tombstone" --no-user-output-enabled
done <"$work/gcs-gone"
step "Google Cloud: $(wc -l <"$work/gcs-new" | tr -d ' ') copied, $(wc -l <"$work/gcs-gone" | tr -d ' ') tombstoned"

# ── Every file a record points at is in production and in both backups.
if [[ -n "${FILE_PATHS:-}" ]]; then
  sort -u "$FILE_PATHS" | sed '/^$/d' >"$work/records"
  sort -u "$work/r2-copy" "$work/r2-new" >"$work/r2-now"
  sort -u "$work/gcs" "$work/gcs-new" >"$work/gcs-now"
  missing_production="$(comm -23 "$work/records" "$work/production" | wc -l | tr -d ' ')"
  missing_r2="$(comm -23 "$work/records" "$work/r2-now" | wc -l | tr -d ' ')"
  missing_gcs="$(comm -23 "$work/records" "$work/gcs-now" | wc -l | tr -d ' ')"
  if [[ "$missing_production$missing_r2$missing_gcs" != "000" ]]; then
    fail "files named by a record but missing — production: $missing_production, R2 copy: $missing_r2, Google Cloud: $missing_gcs"
  fi
  step "Every one of $(wc -l <"$work/records" | tr -d ' ') file records is in production and in both backups"
fi
