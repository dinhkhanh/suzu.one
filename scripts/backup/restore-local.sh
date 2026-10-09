#!/usr/bin/env bash
# Brings a backup back into a throwaway database on this machine: for the restore drill, and for
# reading back records changed or deleted by mistake (docs/runbooks/restore.md). Never production.
#
#   scripts/backup/restore-local.sh                     the newest daily backup, from R2
#   scripts/backup/restore-local.sh hourly              the newest hourly one
#   scripts/backup/restore-local.sh daily suzu-2026-10-09T0100.dump.age  that one
#   FROM=gcs scripts/backup/restore-local.sh monthly    the newest monthly one, from Google Cloud
#
# Needs: Docker, age, the PostgreSQL 17 client tools (PG_BIN, e.g. /opt/homebrew/opt/postgresql@17/bin),
# and from the restore kit: AGE_IDENTITY (the path of the age private key) and, for R2,
# R2_ENDPOINT + R2_BACKUP_KEY_ID / R2_BACKUP_SECRET (the kit's read token) + BACKUP_BUCKET; for
# Google Cloud, gcloud signed in and GCS_BUCKET.
#
# Leaves the restored database running and prints its URL; the plain dump is deleted at the end.
# shellcheck source=scripts/backup/lib.sh
source "$(dirname "$0")/lib.sh"

prefix="${1:-daily}"
name="${2:-}"
from="${FROM:-r2}"
: "${AGE_IDENTITY:?AGE_IDENTITY is not set: the path of the age private key from the restore kit}"
[[ -r "$AGE_IDENTITY" ]] || fail "cannot read $AGE_IDENTITY"
require age docker
require_pg17
started=$SECONDS

work="$(mktemp -d)"
chmod 700 "$work"
trap 'rm -rf "$work"' EXIT

if [[ "$from" == "r2" ]]; then
  require aws
  : "${R2_ENDPOINT:?}" "${BACKUP_BUCKET:?}" "${R2_BACKUP_KEY_ID:?}" "${R2_BACKUP_SECRET:?}"
  if [[ -z "$name" ]]; then
    name="$(r2_backup s3api list-objects-v2 --bucket "$BACKUP_BUCKET" --prefix "$prefix/" --query 'Contents[].Key' --output text | tr '\t' '\n' | grep -v '^None$' | sort | tail -1 | sed "s#^$prefix/##")"
  fi
  [[ -n "$name" ]] || fail "no backup under $prefix/ in $BACKUP_BUCKET"
  step "Downloading $prefix/$name from R2"
  r2_backup s3 cp --only-show-errors "s3://$BACKUP_BUCKET/$prefix/$name" "$work/backup.age"
elif [[ "$from" == "gcs" ]]; then
  require gcloud
  : "${GCS_BUCKET:?}"
  if [[ -z "$name" ]]; then
    name="$(gcloud storage ls "gs://$GCS_BUCKET/$prefix/" | sort | tail -1 | sed 's#.*/##')"
  fi
  [[ -n "$name" ]] || fail "no backup under $prefix/ in $GCS_BUCKET"
  step "Downloading $prefix/$name from Google Cloud"
  gcloud storage cp "gs://$GCS_BUCKET/$prefix/$name" "$work/backup.age" --no-user-output-enabled
else
  fail "FROM is r2 or gcs"
fi

step "Decrypting"
age -d -i "$AGE_IDENTITY" -o "$work/backup.dump" "$work/backup.age" || fail "this key cannot decrypt the backup"
rm -f "$work/backup.age"

KEEP=1 "$BACKUP_DIR/check-dump.sh" --restore "$work/backup.dump"
printf '\nBackup %s/%s, restored in %d min. Write the time down in the drill note (restore.md).\n' "$prefix" "$name" $(((SECONDS - started + 59) / 60))
