# Backup and restore — the plan

**Status:** decided 2026-10-09 (the owner took every recommendation in §5, and asked for the 3-2-1 rule, §2.1). Built the same day: B0 and B2–B4 (§6). Waiting on the owner's set-up (B1, [backup.md](runbooks/backup.md#setting-it-up-owner-once-about-an-hour)) and the first drill (B5).

NFR-OPS-02 asks for: point-in-time recovery, daily backups kept ≥ 30 days, a monthly one kept ≥ 1 year, a restore drill at least twice a year, **RPO ≤ 1 hour, RTO ≤ 8 hours**. The runbooks ([backup.md](runbooks/backup.md), [restore.md](runbooks/restore.md)) describe a manual monthly dump and a drill. Neither has ever been done. This plan turns them into something that runs by itself, is checked by itself, and is restored for real on a calm day.

## 1. Where things stand (checked 2026-10-09)

| What | Today | Backed up by |
| --- | --- | --- |
| Database | Supabase `pkcobwkncwgaatfbqssn`, Singapore, Postgres 17.6, Pro plan, Micro compute. **67 MB**, 288 tables in `public`, 138 migrations; 37 people, ~3,000 audit rows | Supabase's daily backup, kept **7 days**. PITR: **not confirmed** (it is a paid add-on and has not been bought as far as we know). **No copy outside Supabase.** |
| Files | R2 bucket `suzu-one-private` (APAC): 30 file records (28 live), **131 MB** | **Nothing.** A bucket-level mistake or a leaked key that deletes objects loses them. |
| Old Supabase Storage objects | 40 objects (8 MB) in the Supabase Storage bucket `suzu-private`, left over from before the move to R2 (`scripts/storage-to-r2.ts`). 6 have the path of a live file record; 34 are named by none. | Supabase's daily backup holds their metadata, not their bytes. See D7. |
| Field-encryption keys | Vercel env + the owner's offline copy ([KEY_ROTATION.md](KEY_ROTATION.md)) | The offline copy |
| Code, migrations | GitHub (`dinhkhanh/suzu.one`, **public**) | Git |

Gaps against NFR-OPS-02:

- **RPO ≤ 1 h is not met.** A daily backup can lose up to 24 hours.
- **30 daily / 12 monthly is not met.** Supabase keeps 7 days; nothing keeps anything longer.
- **Losing the Supabase project loses everything.** The only database copies live inside it. The Supabase organisation was made through the Vercel integration (`vercel_icfg_…`), so the database also hangs on the Vercel account and its billing.
- **Files have no copy at all.**
- **No restore has ever been done.** The RTO is a guess.
- **The drill instructions have a bug.** `vector` (and `btree_gist`, `ltree`, `pgcrypto`, `postgis`, `uuid-ossp`) are installed in Supabase's `extensions` schema. Two columns are typed `extensions.vector` (`face_template.embedding`, `kb_page_chunk.embedding_vector`). A restore into a plain Postgres that creates `vector` in `public` fails on those tables. Fixed in [restore.md](runbooks/restore.md) alongside this plan.

## 2. The shape of it

```
                every hour, 07–22 ICT Mon–Sat          every night 01:00 ICT
GitHub Actions ─────────────────────────────┐   ┌────────────────────────────────┐
 (scheduled, main only,                     ▼   ▼                                │
  environment "backups")         pg_dump (Supabase session pooler :5432)         │
                                            │                                    │
                                 restore into a throwaway pg17 container,        │
                                 run scripts/backup/verify.sql  ── fail → alert  │
                                            │                                    │
                                 encrypt with age (public key only)              │
                                            │                                    │
                                 R2 `suzu-backups`: hourly/ daily/ monthly/      │
                                            │ (nightly: daily + monthly only)    │
                                 GCS `suzu-backups-gcs`, Singapore               │
                                                                                 │
                                 files: only the objects not yet copied ◄────────┘
                                   → `suzu-files-backup` (R2)
                                   → age → GCS `files/` (create-only)
                                 objects gone from production: tombstoned
                                            │
                                 healthchecks.io ping (a missed run alerts too)
```

Three properties matter more than the tools:

1. **Outside Supabase, and on two other providers.** The copies live on Cloudflare and on Google Cloud, with separate logins. Losing any one provider or account, Supabase's included, leaves two copies.
2. **Cannot be deleted by the job that writes them.** R2 bucket locks keep each dump, and each copy of a deleted file, until its retention ends. A leaked backup token can add objects but cannot remove them.
3. **Proven every night.** Every daily dump is restored into a throwaway database and checked before it is stored. A dump that cannot be read back fails loudly the same night, not on the day it is needed.

### 2.1 Against the 3-2-1 rule

Three copies, on two different kinds of storage, one of them offsite. For a cloud system "two kinds of storage" means two independent failure domains: a different provider, a different account, a different login. A second bucket in the same account is a second copy, not a second medium. The plan goes one step past the rule, to what is often called 3-2-1-1-0: one copy that cannot be changed (locked), and zero errors (each restore checked).

| | Copy | Provider / account | Immutable | Counts toward 3-2-1 |
| --- | --- | --- | --- | --- |
| **Database** | 1. Production | Supabase (AWS), through Vercel | — | the live copy |
| | 2. Supabase daily backups, 7 days | Supabase, same project | no (the project owner can restore over or delete them) | a copy, **not** a separate failure domain |
| | 3. `suzu-backups` on R2: hourly, daily, monthly | Cloudflare | bucket lock | copy 2, medium 2, offsite |
| | 4. `suzu-backups-gcs`: daily, monthly | Google Cloud, own project | retention policy (Bucket Lock) | copy 3, medium 3 |
| **Files** | 1. `suzu-one-private` on R2 | Cloudflare | — | the live copy |
| | 2. `suzu-files-backup` on R2, nightly, incremental | Cloudflare, same account | lock on `deleted/` | copy 2: catches mistakes, a bad key, a bad job; not a separate failure domain |
| | 3. `suzu-backups-gcs` `files/`, nightly, incremental, encrypted | Google Cloud | retention policy, create-only access | copy 3, medium 2, offsite |

Both hold the rule with at most a day's gap, and files cost about one extra copy of themselves per place, not one per backup (§2.2).

**Why Google Cloud for the third place.** The company already runs on Google (Workspace, Google sign-in). GCS has what the third copy needs and R2 lacks:

- a role that can add objects but neither delete nor overwrite them (overwriting needs `storage.objects.delete`, which the job never gets);
- a retention policy that can be locked for good;
- sign-in from GitHub Actions through Workload Identity Federation, so no long-lived key is stored anywhere.

Region `asia-southeast1` (Singapore), the same jurisdiction as production (D10). Backblaze B2 with Object Lock would do the same job; it is the fallback if a Google Cloud project is unwelcome.

**What goes to GCS.**

- `daily/` and `monthly/` dumps: the same age-encrypted file the nightly job already made, uploaded a second time. Standard class, lifecycle 35 days for daily; Archive class, 400 days for monthly.
- `files/<object path>.age`: each file once, encrypted, the night after it is uploaded (§2.2). Coldline class.
- A bucket retention policy of 30 days, **locked** after the first month works. Until it is unlocked, which a locked policy never is, nobody can delete an object younger than 30 days: not the job, not a stolen login, not the owner.
- Hourly dumps stay on R2 only. To lose them, Supabase and Cloudflare must both fail within the same day.

### 2.2 Full copies or snapshots

The database and the files want opposite answers.

**The database: a full dump every time.** It is small (67 MB, a fraction of that compressed) and changes everywhere at once, so the only thing a snapshot would save is storage that costs cents. A full dump is one file that restores alone, with no chain of increments to trust. Supabase gives no access to its write-ahead log, so real incremental Postgres backups (WAL-G, pgBackRest) are not available anyway. All the retained dumps together come to about 100 files: 48 hourly, 35 daily, 13 monthly. At 67 MB of data that is about 1.5 GB; at 2 GB of data it would be about 40 GB, still under a dollar a month on R2. **Revisit at ~5 GB**: buy PITR then, and keep only the daily and monthly dumps.

**Files: copy each one once, ever.** A monthly full archive would store every file thirteen times: 13 × 200 GB is 2.6 TB once the videos arrive. It is also unnecessary, because **a stored file never changes**. Its key is a fresh uuid (`files/service.ts`), the write refuses an existing key (`If-None-Match: *`), and the only rewrite is `finalizeObject`'s copy-onto-itself seconds after upload. So:

- **Incremental forever.** Each night the job lists both sides and copies only the objects production has and the backup does not yet have. Today that is 30 objects once, then a handful a night. Objects younger than an hour are left for the next night, so an upload is never caught before `finalizeObject` has run.
- **The database dump is the snapshot.** `stored_file` names every object a record points at. To bring files back to a day, restore that day's dump and copy the objects its `stored_file` rows name. Nothing else needs to record "which files existed on the 3rd".
- **Deletions are tombstones, not deletes.** When an object is gone from production, the job sets the backup object's `customTime` to now. It cannot delete anything, and `customTime` can only move forward. A GCS lifecycle rule, run by Google rather than by our credential, deletes it **400 days after its tombstone**: the oldest monthly dump that might still name it has expired by then. The job's role is `objects.create`, `get`, `list` and `update` (metadata) on that one bucket, and no `delete`. On R2 the same thing is `rclone sync --backup-dir deleted/<date>`, with `deleted/` locked and expiring after 400 days.
- **Storage**: each place holds every live file once, plus deleted files for 400 days. That is about 3× the files in total (production + R2 copy + GCS), against about 15× with monthly full archives.
- **Encryption** per object with the same age public key. A file is streamed `rclone cat` → `age` → upload, never written to the runner's disk.

**Why not restic or kopia.** Snapshot tools that deduplicate earn their keep on files that change in place, which ours never do. They also need the repository password online, so GitHub could read every backup; and their pruning needs delete rights, which the create-only design refuses. The two properties that matter most here are an online job that cannot read and cannot delete. These tools would give up both to solve a problem we do not have.

## 3. The database

### 3.1 Dumps

`pg_dump --format=custom --schema=public --schema=app --schema=drizzle --no-owner --no-privileges`, from the PostgreSQL 17 client. This is the scope [backup.md](runbooks/backup.md) already uses. `auth`, `storage`, `cron` and `vault` are Supabase's schemas and the app keeps nothing in them: Better Auth's tables are in `public`, `auth.users` is empty, there are no `pg_cron` jobs, and files are in R2.

- **Connection:** the Supabase **session** pooler (`…pooler.supabase.com:5432`), not the transaction pooler on 6543. The direct host is IPv6-only and GitHub's runners are IPv4.
- **Role:** a dedicated `backup_reader` login with `SELECT` on the three schemas, `BYPASSRLS`, and read-only transactions (`scripts/backup/setup.sql`). Every table has RLS on and no policies, so `pg_dump`, which runs with `row_security = off`, refuses to dump them for a role without `BYPASSRLS`. Supabase's `postgres` has `CREATEROLE` and `BYPASSRLS` (checked 2026-10-09), so it can make this role. The role is set up by hand, not by a migration: its password belongs to one environment.
- **Cost to production:** a 67 MB database dumps in seconds inside one repeatable-read snapshot. `statement_timeout` (120 s) is far away.

### 3.2 Cadence and retention

| Prefix in `suzu-backups` | When | Kept (bucket lock = lifecycle) | Meets |
| --- | --- | --- | --- |
| `hourly/` | every hour 07:00–22:00 ICT, Mon–Sat | 3 days | RPO ≤ 1 h during business hours |
| `daily/` | 01:00 ICT every day | 35 days | "daily ≥ 30 days" |
| `monthly/` | the daily run on the 1st, copied | 400 days | "monthly ≥ 1 year" |

Outside business hours almost nothing is written, and the nightly run plus Supabase's own daily backup cover it. GitHub's scheduler can start a run 5–20 minutes late. That still holds RPO under an hour for an hourly schedule. If it ever does not, the dead-man check (§3.5) says so.

Storage at today's size is under 2 GB in total, a few cents a month on R2. Ten times the data is still under a dollar.

### 3.3 Encryption

A dump holds every person's record in clear, except the restricted and compensation fields the app already encrypts. Each dump is encrypted with [age](https://age-encryption.org) to a **public key** (`AGE_RECIPIENT`) before upload. The private key lives only in the owner's offline copy, beside `DATA_ENCRYPTION_KEYS`. Nothing online can read a dump: not GitHub, not the backup token, not the bucket.

A restore therefore needs three things: **the dump, the age private key, and the field-encryption keys** (§4.1). Losing the age key makes every dump unreadable. It is added to KEY_ROTATION.md's list of keys that cannot be recovered.

### 3.4 Proving each dump

The nightly job restores the plaintext dump into a `pgvector/pgvector:pg17` service container, before encrypting it, and runs `scripts/backup/verify.sql`:

- the extensions and schemas exist, every table in the dump's table of contents has its data, and the migration journal's last hash equals the last entry in `drizzle/meta/_journal.json` on `main`;
- sanity floors: active people > 0, `audit_log`'s newest `occurred_at` within the last 26 hours, and the encrypted columns that hold data in production (`payroll_run.totals_enc` and the like) are not empty.

The script prints **only pass/fail**. The repository is public, and so are its Actions logs: no row counts, names, file keys or sizes ever go to the log. A vitest case runs `verify.sql` against the PGlite-migrated schema, so a migration that renames a checked column breaks CI, not the night's backup.

Hourly runs do the cheaper check: `pg_restore --list` has the expected number of `TABLE DATA` entries.

### 3.5 Being told

- One healthchecks.io check each for `backup-hourly` and `backup-nightly`, pinged `/start`, then success or `/fail`, the way [incidents.md](runbooks/incidents.md) already sets up `CRON_PING_URL`. A run that never happens alerts too.
- GitHub emails the repository owner when a scheduled workflow fails.
- [incidents.md](runbooks/incidents.md) gains a row: "a backup check is red".

### 3.6 Why not buy PITR

Supabase's PITR is $100 a month for 7 days ($400 for 28), and it needs at least Small compute (+$15). It gives second-level recovery but only inside Supabase, and only for 7–28 days. The hourly dumps meet RPO ≤ 1 h for about nothing, survive the loss of the project, and cover the year. PITR is worth buying later, if the business wants recovery to the minute, or once the database is too large to dump hourly (several GB). Until then the plan does not need it.

## 4. Restore

### 4.1 The restore kit

Kept offline by the owner, checked at every drill:

- the age private key (dumps);
- `DATA_ENCRYPTION_KEYS` and `DATA_BLIND_INDEX_KEY`, every key still named by a retained backup ([KEY_ROTATION.md](KEY_ROTATION.md));
- the R2 read token for `suzu-backups` and `suzu-files-backup`;
- the Supabase, Vercel, Cloudflare, Google Cloud and GitHub logins.

### 4.2 Five kinds of restore

| Situation | Path | Expected time |
| --- | --- | --- |
| A few records changed or deleted by mistake | `scripts/backup/restore-local.sh <dump>` → a local container with the newest dump before the mistake → read the rows → put them back through the app, or a reviewed SQL script that writes its own audit rows. **Production is not restored.** | < 1 h |
| The database is damaged (a bad migration, a dropped table) but the project is fine | Supabase's own backup (≤ 7 days, the dashboard's Restore), or our newest hourly dump restored into the same project after `drop schema public, app, drizzle cascade`. Then migrate, flush the cache, re-run the day's jobs. | 1–3 h |
| The Supabase project or account is gone | A new Supabase project in Singapore → extensions in `extensions` → restore the newest dump → point Vercel's `POSTGRES_URL` / `POSTGRES_URL_NON_POOLING` at it → redeploy (migrations run) → `pnpm cache:flush`. | 2–4 h |
| Files are missing | `scripts/backup/restore-files.ts` from `suzu-files-backup` (current or the dated `deleted/` folder) back into `suzu-one-private`. The database still names them by key. | < 1 h |
| Cloudflare is gone (account lost, R2 down for days) | The database is unaffected; the newest dump is on GCS if it is needed too. Files: a new S3-compatible bucket elsewhere (`R2_ENDPOINT` can point at any), `scripts/backup/restore-files.sh` copies and decrypts every object production's `stored_file` names from GCS `files/`, then change the storage variables in Vercel and redeploy. Files uploaded that day are lost. | 2–4 h |

**Stopping writes during a full restore.** Today the runbook can only ask people to stop. The plan adds a `MAINTENANCE_MODE` environment switch (B3): the proxy shows every page as a "Đang bảo trì" page with a 503, and answers everything else, the cron included, with a bare 503 before anything runs. Setting it in Vercel and redeploying takes about two minutes.

**After any full restore:** `pnpm cache:flush <app URL>`; Admin → Jobs → run today's jobs that have no run; re-run the privacy purge (a restore can bring back rows it had already removed, §5 D6); tell everyone the window that was lost; write the incident.

### 4.3 The drill

The drill twice a year (April and October) stays as in [restore.md](runbooks/restore.md), with `scripts/backup/restore-local.sh` doing steps 1–5. The nightly verification proves the dump. The drill proves the people and the kit: that the owner can find the keys, download, decrypt, restore and open a payslip, within the RTO. The first drill happens as soon as B2 has produced a week of dumps, and its timing is written down as the RTO we actually have.

## 5. The owner's decisions

All decided 2026-10-09: the owner took each recommendation.

| # | Decision | Decided |
| --- | --- | --- |
| D1 | Hourly dumps from GitHub Actions instead of the PITR add-on | **Yes.** It meets RPO ≤ 1 h and the year's retention for cents, and it survives losing Supabase. Revisit PITR when the database reaches several GB. |
| D2 | Where the dump job runs | **GitHub Actions**, in the existing public repo: free minutes, already trusted for CI. Secrets sit in a GitHub *environment* `backups` restricted to `main`, so pull requests (forks included) never see them. Logs carry no data (§3.4). The alternative, a small VM, is one more machine to patch. |
| D3 | Encrypt dumps with age, private key offline only | **Yes.** It is the only thing that makes a public-repo job and a leaked bucket token harmless. The cost is one more key that must never be lost. |
| D4 | Backup buckets in the same Cloudflare account, with bucket locks | **Yes**: `suzu-backups` and `suzu-files-backup`. The locks protect against a leaked token. Losing the Cloudflare account is covered by the third copy on GCS (D8), not by these buckets. |
| D5 | Add the `MAINTENANCE_MODE` switch | **Yes**, small (B3). Without it a full restore cannot stop writes. |
| D6 | What the privacy notice says about backups | Backups keep a deleted or purged record for up to 13 months, then it is gone. After a restore the purge runs again. Add one sentence to the PDPL notice and the R5 privacy decisions. |
| D7 | The 40 old Supabase Storage objects | Checked 2026-10-09: 6 share a path with a live file record in R2, 34 are named by no record. The nightly job's file check confirms each live record's object is in R2. Once that has passed, empty and delete the Supabase bucket `suzu-private` (Supabase → Storage). They sit outside every backup and every purge. |
| D8 | The 3-2-1 rule: a third copy with a third provider | **Google Cloud Storage**, Singapore, its own project: daily and monthly dumps; each file once, encrypted, nightly; a locked 30-day retention policy; no delete right for GitHub, which signs in through Workload Identity Federation (§2.1). |
| D9 | Full copies or snapshots | **Full dumps for the database, incremental-forever for files**, with the dump as the snapshot and tombstones instead of deletes (§2.2). Revisit the database side at ~5 GB. |

## 6. The build

| Slice | What | Who |
| --- | --- | --- |
| **B0 — docs** | This plan; the `extensions` fix in restore.md. | done with this document |
| **B1 — set-up** | Buckets `suzu-backups` (locks + lifecycle per §3.2) and `suzu-files-backup` (lock on `deleted/` for 400 days, lifecycle the same). R2 tokens: write for the job, read for the kit. A Google Cloud project `suzu-backups` with billing, the bucket `suzu-backups-gcs` in `asia-southeast1` (lifecycle per §2.1 and §2.2, retention 30 days, not yet locked), a Workload Identity pool trusting only `dinhkhanh/suzu.one`, environment `backups`, and a service account holding a custom role (`storage.objects.create`, `get`, `list`, `update`; no `delete`) on that bucket alone. Generate the age key pair: the public key becomes the `backups` environment's `AGE_RECIPIENT` variable, the private key goes into the kit. The `backup_reader` role (`scripts/backup/setup.sql`). GitHub environment `backups` with its secrets and variables. Two healthchecks.io checks. All of it, command by command: [backup.md](runbooks/backup.md#setting-it-up-owner-once-about-an-hour). | owner, ~1 h. The storage check is done (D7) |
| **B2 — the job** | **Done.** `scripts/backup/`: `run.sh` (one run, as the workflow makes it), `dump.sh`, `check-dump.sh` (table of contents, or a full restore into a throwaway container and `verify.sql`), `files.sh` (incremental copies with tombstones and the coverage check), `restore-local.sh`, `restore-files.ts`, `setup.sql`, `gcs-lifecycle.json`. `.github/workflows/backup.yml` (hourly + nightly schedules, `workflow_dispatch`, environment `backups`, Workload Identity Federation). `tests/backup-verify.test.ts`. Tested end to end on the local demo database, a local S3 server and a stand-in for `gcloud`: dumps, checks that fail on stale or empty data, encryption, uploads, file copies, moves and tombstones, the coverage check, restores from both providers, and file restores with their download names. Not yet run against the real buckets: that needs B1. After a month of clean runs the owner locks the GCS retention policy. | done; the lock is the owner's |
| **B3 — maintenance switch** | **Done.** `MAINTENANCE_MODE` in `env()`; the proxy (`src/proxy.ts`) shows `/maintenance` for every page with a 503 and `Retry-After`, and a bare 503 for everything else, before routing; the page reads nothing. `tests/proxy-maintenance.test.ts`; checked on a dev server. | done |
| **B4 — runbooks** | **Done.** backup.md (what is kept, the kit, the set-up) and restore.md (every kind of restore, the drill) rewritten; incidents.md: the backup signal and "A backup check is red"; KEY_ROTATION.md: the age key; the privacy notice (sections 8 and 10, vi/en) and R5_PRIVACY_DECISIONS name the backups; INSPECTION NFR-OPS-02 updated. | done |
| **B5 — first drill** | The owner, from the kit alone, restores last night's dump locally and opens a payslip, timed. Findings fixed, timing written into restore.md as the RTO. | owner, ~1 h, with me |

Nothing here changes the database schema. The workflow skips every run until the repository variable `BACKUPS_ENABLED` is `true`, the last step of B1, so it can be merged before the set-up.
