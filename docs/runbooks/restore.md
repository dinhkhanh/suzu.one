# Restore

Getting data back, and proving twice a year that it can be done (NFR-OPS-02: RPO ≤ 1 hour, RTO ≤ 8 hours). What the backups are and where they live is [backup.md](backup.md).

**Needs, every time:** the restore kit ([backup.md](backup.md#the-restore-kit-owner-kept-offline)); a machine with Docker, `age` and the PostgreSQL 17 client tools (`brew install postgresql@17 age`, then `export PG_BIN=/opt/homebrew/opt/postgresql@17/bin`); a checkout of this repository at `main`.

## First, decide what kind of restore this is

Write down, before touching anything: when the damage happened (the audit log, Sentry, Vercel logs), and the last good moment before it. That moment is the **restore point**. Then:

| Situation | Do | Time |
| --- | --- | --- |
| A few records were changed or deleted by mistake; everything else is fine | **Do not restore production.** [Read them back](#reading-records-back) from a backup on your machine, and put them back through the app, or with a reviewed SQL script that writes its own audit rows. The audit log often has the old values already (`before` / `after`). | < 1 h |
| A few files are missing | [Put the files back](#files) from a backup. The database still names them. | < 1 h |
| The database is damaged: a migration that destroyed data, a dropped table | A [full restore](#full-restore-of-production) into the same project. Everything written after the restore point is lost: announce it. | 1–3 h |
| The Supabase project or account is gone | A full restore [into a new project](#into-a-new-supabase-project). | 2–4 h |
| Cloudflare is gone (the account, or R2 for days) | The database is unaffected. Files: [into a new bucket from Google Cloud](#files). | 2–4 h |

## Reading records back

```sh
export AGE_IDENTITY=~/path/to/suzu-backup.key        # the kit's age key, saved to a file for now
export R2_ENDPOINT=https://<account id>.r2.cloudflarestorage.com BACKUP_BUCKET=suzu-backups
export R2_BACKUP_KEY_ID=… R2_BACKUP_SECRET=…          # the kit's read-only token
scripts/backup/restore-local.sh hourly                # or: daily, monthly; or a name: daily suzu-2026-10-09T0100.dump.age
```

Pick the newest backup **before** the restore point (`aws s3 ls s3://suzu-backups/hourly/ --endpoint-url $R2_ENDPOINT` lists them; names are Vietnam time). From Google Cloud instead: `FROM=gcs GCS_BUCKET=<bucket> scripts/backup/restore-local.sh daily`, signed in with `gcloud auth login`.

The script downloads, decrypts, restores into a throwaway container, checks it, and prints its URL. Read what you need with `psql "<url>"`. Encrypted fields are ciphertext there. To read one, run the app against it (see the drill, step 4). When done: `docker rm -f <container>`, and delete the key file.

## Full restore of production

1. **Close the app.** Vercel → the project → Settings → Environment Variables → `MAINTENANCE_MODE` = `on` (Production) → Deployments → the current production deployment → **Redeploy**. About two minutes. Every page now says "Đang bảo trì". Actions, the API and the cron get a 503, so nothing is written and no job runs. Tell everyone (Chat space, Zalo group).
2. **Choose the backup.** If the restore point is inside Supabase's last 7 days and a scheduled backup sits just before it: Supabase → Database → Backups → Restore. That is the simplest, so skip to step 4. Otherwise take the newest hourly or daily dump before the restore point. Restore it locally first ([above](#reading-records-back)) and confirm the damage is **not** in it.
3. **Restore the dump into production.** Download the chosen backup and decrypt it, then restore it with the **postgres** session-pooler URL (Supabase → Connect → Session pooler):
   ```sh
   aws s3 cp s3://suzu-backups/hourly/<name>.age . --endpoint-url "$R2_ENDPOINT"     # the kit's token in AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY
   age -d -i "$AGE_IDENTITY" -o suzu.dump <name>.age
   export PROD='postgresql://postgres.<ref>:<password>@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres'
   $PG_BIN/psql "$PROD" -v ON_ERROR_STOP=1 -c 'drop schema public cascade' -c 'drop schema app cascade' -c 'drop schema drizzle cascade'
   $PG_BIN/pg_restore --dbname "$PROD" --no-owner --no-privileges --exit-on-error suzu.dump
   $PG_BIN/psql "$PROD" -X -q -v ON_ERROR_STOP=1 -f scripts/backup/verify.sql && echo restored and checked
   ```
   The `extensions` schema is Supabase's and stays. Delete `suzu.dump` when done.
4. **Migrations.** The restored database may be behind the deployed code. Redeploy once more, still in maintenance: the production build runs the missing migrations before it starts.
5. **Open the app.** `MAINTENANCE_MODE` = `off`, redeploy, then at once `pnpm cache:flush https://<app domain>` (needs `CRON_SECRET` in your shell). Otherwise pages keep serving cached pre-restore values for up to an hour.
6. **Catch up.** Admin → Jobs → **Run now** on the day's jobs that have no run, and on `privacy-retention`, `candidate-retention` and `files-cleanup`: a restore can bring back records or files those jobs had already removed, and they remove them again. An anonymisation (Admin → Privacy) or an erasure done after the restore point is undone by the restore: the audit log lists them; do them again. If files were affected too, [put them back](#files).
7. **Check:** sign in; open Today, a person, a payslip (the step-up and the decryption work), Admin → Jobs.
8. **Tell everyone** what was lost: everything written between the restore point and step 1. Record the incident ([incidents.md](incidents.md#after-the-incident)).

### Into a new Supabase project

When the project itself is gone: create a new project in **Singapore (ap-southeast-1)**. Run `create schema if not exists extensions; create extension if not exists vector with schema extensions; create extension if not exists btree_gist with schema extensions;` in its SQL Editor, then steps 3–8 above against it. Before step 4, point Vercel's `POSTGRES_URL` (transaction pooler, 6543) and `POSTGRES_URL_NON_POOLING` (session pooler, 5432) at the new project. Run `scripts/backup/setup.sql` there too, and change the backup job's `BACKUP_DATABASE_URL` ([backup.md](backup.md#6-github)).

## Files

`scripts/backup/restore-files.ts` puts back every file that a database's records name and that the target bucket lacks. It leaves present files alone, so it can be run again safely.

```sh
export RESTORE_DATABASE_URL="$PROD"        # or the URL restore-local.sh printed, to bring files back to that day
export TARGET_ENDPOINT=https://<account id>.r2.cloudflarestorage.com TARGET_BUCKET=suzu-one-private
export TARGET_ACCESS_KEY_ID=… TARGET_SECRET_ACCESS_KEY=…     # an R2 token that may write the target bucket
# From the R2 copy (the kit's read token):
export R2_ENDPOINT="$TARGET_ENDPOINT" FILES_BACKUP_BUCKET=suzu-files-backup R2_BACKUP_KEY_ID=… R2_BACKUP_SECRET=…
pnpm exec tsx --require ./scripts/server-only-shim.cjs scripts/backup/restore-files.ts --dry-run   # then without --dry-run
# Or from Google Cloud (gcloud signed in), e.g. when Cloudflare is gone:
FROM=gcs GCS_BUCKET=<bucket> AGE_IDENTITY=~/path/to/suzu-backup.key pnpm exec tsx --require ./scripts/server-only-shim.cjs scripts/backup/restore-files.ts
```

Each file is written with its content type and download name, taken from its record. **Cloudflare gone:** make a bucket at any S3-compatible provider as the target, with its CORS rule (README, "File storage"), restore into it from Google Cloud, then point Vercel's `R2_ENDPOINT`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` and `STORAGE_BUCKET` at it and redeploy.

## The restore drill

Twice a year, e.g. the first week of April and of October. The nightly job already proves each dump restores. The drill proves the people and the kit: that the owner, starting from the kit alone, can get the data back and read it, and how long that takes. It **never** touches production.

1. Start a stopwatch. Open the kit. Nothing else.
2. `scripts/backup/restore-local.sh daily` ([reading records back](#reading-records-back)). It prints the restored database's URL.
3. `FROM=gcs scripts/backup/restore-local.sh monthly`: the second provider and the year-long copy can be read too. Then `docker rm -f` it.
4. Read an encrypted value with the app's keys: in a shell, `export POSTGRES_URL=<url> POSTGRES_URL_NON_POOLING=<url> DATA_ENCRYPTION_KEYS=<from the kit> DATA_BLIND_INDEX_KEY=<from the kit> STEP_UP_DRIVER=local BETTER_AUTH_URL=http://localhost:3124 MAINTENANCE_MODE=off`, then `pnpm next dev --port 3124`. Sign in through a forged session (or as yourself if Google sign-in is set up for localhost), and open one payslip. If it shows numbers, the keys and the backup belong together. **Never** give this server production's `CRON_SECRET`, Resend, Chat, Messenger or Telegram keys, and never run `pnpm db:seed` against it.
5. Files: `restore-files.ts --dry-run` with `RESTORE_DATABASE_URL` = the restored URL and `FROM=gcs`. It should report every file "already in place" (it compares with production's bucket) and none "in no backup".
6. Stop the stopwatch. Write in the password manager's backup note: the date, the backups used, the elapsed time, what failed or surprised you. Over 8 hours is a finding to fix before the next drill. Write the time into the line below too.
7. Throw it away: `docker rm -f <container>`, delete the key file.

A drill that failed is a successful drill: it found the problem on a calm day. Fix the cause, then run it again.

**Drills so far:** none yet. The first is due once the job has a week of backups ([BACKUP_PLAN.md](../BACKUP_PLAN.md) B5).
