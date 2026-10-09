#!/usr/bin/env bash
# One backup run, as the scheduled workflow (.github/workflows/backup.yml) makes it
# (docs/BACKUP_PLAN.md §2–3):
#
#   run.sh hourly    dump → check its table of contents → encrypt → R2 hourly/
#   run.sh nightly   dump → restore it and run verify.sql → encrypt → R2 daily/ and GCS daily/
#                    (and monthly/ on the 1st) → the file backup, checked against the dump
#
# Pings the dead-man's switch `backup-<kind>` at the start and with the verdict. The plain dump
# exists only in a private temporary folder, and only until it is encrypted.
# shellcheck source=scripts/backup/lib.sh
source "$(dirname "$0")/lib.sh"

kind="${1:?usage: run.sh hourly|nightly}"
[[ "$kind" == "hourly" || "$kind" == "nightly" ]] || fail "unknown kind: $kind"
: "${AGE_RECIPIENT:?}" "${BACKUP_BUCKET:?}" "${R2_ENDPOINT:?}" "${R2_BACKUP_KEY_ID:?}" "${R2_BACKUP_SECRET:?}"
[[ "$kind" == "hourly" ]] || : "${GCS_BUCKET:?}"
require age aws

check="backup-$kind"
ping_check "$check" start
work="$(mktemp -d)"
chmod 700 "$work"
finish() {
  local status=$?
  rm -rf "$work"
  if [[ $status -eq 0 ]]; then ping_check "$check"; else ping_check "$check" fail; fi
}
trap finish EXIT

name="suzu-$(stamp_ict).dump"
prefix="$([[ "$kind" == "hourly" ]] && echo hourly || echo daily)"

"$BACKUP_DIR/dump.sh" "$work/$name"
if [[ "$kind" == "hourly" ]]; then
  "$BACKUP_DIR/check-dump.sh" "$work/$name"
else
  FILE_PATHS_OUT="$work/file-paths" "$BACKUP_DIR/check-dump.sh" --restore "$work/$name"
fi

step "Encrypting"
age -r "$AGE_RECIPIENT" -o "$work/$name.age" "$work/$name"
rm -f "$work/$name"

step "Uploading to R2 $prefix/"
r2_backup s3 cp --only-show-errors "$work/$name.age" "s3://$BACKUP_BUCKET/$prefix/$name.age"
[[ "$kind" == "nightly" ]] || exit 0

step "Uploading to Google Cloud daily/"
gcloud storage cp "$work/$name.age" "gs://$GCS_BUCKET/daily/$name.age" --no-clobber --storage-class=STANDARD --no-user-output-enabled
# The run on the 1st holds the month that just ended: it is that month's backup, kept for 400 days.
if [[ "$(TZ=Asia/Ho_Chi_Minh date +%d)" == "01" ]]; then
  step "The 1st: keeping it as the monthly backup"
  r2_backup s3 cp --only-show-errors "s3://$BACKUP_BUCKET/daily/$name.age" "s3://$BACKUP_BUCKET/monthly/$name.age"
  gcloud storage cp "$work/$name.age" "gs://$GCS_BUCKET/monthly/$name.age" --no-clobber --storage-class=ARCHIVE --no-user-output-enabled
fi

FILE_PATHS="$work/file-paths" "$BACKUP_DIR/files.sh"
