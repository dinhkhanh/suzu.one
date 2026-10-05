# Restore

Getting data back, and proving twice a year that it can be done (NFR-OPS-02: RPO ≤ 1 hour, RTO ≤ 8 hours).

## First, decide what kind of restore this is

| Situation | Do |
|---|---|
| A few records were changed or deleted by mistake, everything else is fine | **Do not restore the database.** Restore a copy elsewhere (the drill below, steps 1–4), read the lost rows from it, and put them back through the app — or, if the app cannot, with a reviewed SQL script whose rows are written to the audit log by hand. The audit log usually says what the rows were (`before` / `after`). |
| The whole database is damaged or gone (a bad migration that destroyed data, a dropped table, the project deleted) | A full restore, below. Everything written after the restore point is lost — announce it. |
| Files are missing from R2 | Copy them back from the files copy ([backup.md](backup.md#files)); the database still names them by key. |

Write down, before touching anything: the time the damage happened (the audit log, Sentry, Vercel logs), and the last good moment before it. That moment is the restore point.

## Full restore of production

**Needs:** the Supabase owner login, the Vercel login, the field-encryption keys' offline copy (only if the keys were lost too), and 1–3 hours.

1. **Stop writes.** Vercel → the project → Settings → Deployment Protection is not enough: put the app in maintenance by promoting nothing new and pausing the cron (Vercel → Settings → Cron Jobs → disable), then tell everyone (Chat space, Zalo group) to stop using the app. Writes made from here on will be lost.
2. **Restore in Supabase.**
   - With PITR: Database → Backups → Point in time → pick the restore point → Restore. The project is unavailable while it restores (minutes to an hour).
   - Without PITR: Database → Backups → Scheduled → the last backup before the damage → Restore.
   - If the Supabase project itself is gone: create a new project in Singapore (ap-southeast-1), restore the latest monthly dump into it (drill steps 3–4, with the new project's **direct** connection string instead of a local one), then point Vercel's `POSTGRES_URL` (pooler) and `POSTGRES_URL_NON_POOLING` (direct) at it and redeploy.
3. **Check the restore** (drill step 5) against production.
4. **Migrations.** The restored database may be behind the deployed code. `drizzle.__drizzle_migrations` says which migrations it has; redeploying the current `main` (Vercel → Deployments → the latest production one → Redeploy) runs the missing ones before the build.
5. **Flush the cache**, or pages keep serving pre-restore values until their TTL runs out: `pnpm cache:flush https://<app domain>` (needs `CRON_SECRET` in your shell).
6. **Re-enable the cron**, sign in, open Today, a person, a payslip (the step-up and decryption work), Admin → Jobs.
7. Tell everyone what was lost: everything written between the restore point and step 1. Record the incident ([incidents.md](incidents.md#after-the-incident)).

## The restore drill (twice a year — e.g. first week of April and October)

The point is to find out, on a calm day, that a backup can be read back and how long it takes. The drill **never** touches production: it restores a copy into a throwaway database and reads it.

**Needs:** Docker (for a local container) **or** a Supabase branch; the PostgreSQL 17 client tools; read access to the latest monthly dump in the backups bucket; ~1 hour. Start a stopwatch: the elapsed time is the RTO you can actually promise.

1. **Pick the backup.** Download last month's dump from `suzu-backups` (or take a fresh one, [backup.md](backup.md#the-monthly-dump-owner-first-working-day-of-the-month-15-minutes)). Note its date.
2. **Make a throwaway database.** Either
   - **local container** (simplest): `docker run --rm -d --name suzu-drill -e POSTGRES_PASSWORD=drill -p 55432:5432 postgres:17` — then `export DRILL='postgresql://postgres:drill@127.0.0.1:55432/postgres'`. The dump uses `pgvector`; if `pg_restore` reports `type "vector" does not exist`, use the image `pgvector/pgvector:pg17` instead; or
   - **a Supabase branch**: Supabase → the project → Branches → Create branch (it starts empty: branches do not copy data). Use its **direct** connection string as `DRILL`. Delete the branch at the end — it is billed while it exists.
3. **Prepare it.** `psql "$DRILL" -c 'create extension if not exists vector; create extension if not exists btree_gist; create schema if not exists app;'`
4. **Restore.** `pg_restore --dbname "$DRILL" --no-owner --no-privileges --jobs 4 suzu-<date>.dump`. A few "already exists" notices for the schemas are expected; an error on a table is not — stop and find out why.
5. **Check it.** Each of these must answer, and the figures should match what the app showed on the dump's date:
   ```sql
   select count(*) from person where status = 'active';           -- headcount
   select max(occurred_at) from audit_log;                          -- the dump's moment (≈ its date)
   select count(*) from payroll_run where status = 'locked';        -- closed payroll months
   select hash, created_at from drizzle.__drizzle_migrations order by created_at desc limit 1;  -- the last migration it has
   select count(*) filter (where totals_enc is not null) from payroll_run;  -- encrypted run totals came across (ciphertext)
   ```
   Then read one encrypted value back with the app's keys: point a local checkout's `.env.local` at `DRILL` (**`POSTGRES_URL` and `POSTGRES_URL_NON_POOLING` both** — the app prefers the second for migrations), with `DATA_ENCRYPTION_KEYS` from the offline copy, `pnpm dev`, sign in through a forged session or the local step-up driver, and open one payslip. If it shows numbers, the keys and the backup belong together. **Never** run the app against `DRILL` with production's `BETTER_AUTH_URL` or `CRON_SECRET`, and never run `pnpm db:seed` there.
6. **Stop the stopwatch.** Write in the password manager's backup note: date, backup used, elapsed time, what failed or surprised you. Anything over 8 hours is a finding to fix before the next drill.
7. **Throw it away.** `docker rm -f suzu-drill`, or delete the Supabase branch. Delete the downloaded dump.

A drill that failed is a successful drill: it found the problem on a calm day. Fix the cause in [backup.md](backup.md), then run it again.
