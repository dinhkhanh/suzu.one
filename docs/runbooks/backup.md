# Backup

What is backed up, where, for how long, how you know it worked — and setting it up once. The design and its reasons are in [BACKUP_PLAN.md](../BACKUP_PLAN.md); getting data back is [restore.md](restore.md).

## What is kept

| What | Where it lives | Copies | Kept |
| --- | --- | --- | --- |
| The database | Supabase, Singapore | Supabase's daily backup · R2 `suzu-one-backups` · Google Cloud `<gcs bucket>` | Supabase 7 days · hourly 3 days · daily 35 days · monthly 400 days |
| Files | R2 `suzu-one-private` | R2 `suzu-one-files-backup` · Google Cloud `<gcs bucket>/files/` | while the file exists, then 400 days |
| Field-encryption keys and the backup key | Vercel, and the restore kit (below) | the kit | as long as any backup they open |
| Code and migrations | GitHub | git | — |

**The job** is `.github/workflows/backup.yml`, running `scripts/backup/run.sh`:

- **hourly**, 07:00–22:00 Monday to Saturday (Vietnam time): a dump of the database, checked for completeness, encrypted, into R2 `hourly/`;
- **nightly** at 01:00: a dump that is **restored into a throwaway database and checked** (`scripts/backup/verify.sql`) before it is kept, encrypted, into R2 `daily/` and Google Cloud `daily/`; on the 1st also into `monthly/` in both;
- then **the files**: each new file copied once into both backups (encrypted on Google Cloud); a file deleted from production is moved aside in R2 and marked on Google Cloud, never deleted by the job. Last, every file a database record points at is checked to be in production and in both backups.

Every dump is encrypted with **age** to a public key before it leaves the job. Only the private key in the restore kit opens it. Neither GitHub, the buckets nor a stolen token can read a backup. Locks on the buckets keep each backup for its whole retention, even from someone holding the job's credentials.

## How you know it works

- **healthchecks.io**: `backup-hourly` and `backup-nightly`. A failed run, or one that never started, alerts the owner. This is the signal to watch.
- **GitHub** emails the repository owner when a scheduled run fails. Actions → Backup shows each run's steps; the log says which step failed and never shows data.
- **Supabase** → Database → Backups: the newest scheduled backup is from today or yesterday (look once a month).

When a check is red, [incidents.md](incidents.md#a-backup-check-is-red) says what to do.

## The restore kit (owner, kept offline)

Without it no backup can be read. Keep it in the password manager, and a printed copy in the company safe:

- the **age private key** (`AGE-SECRET-KEY-1…`);
- `DATA_ENCRYPTION_KEYS` and `DATA_BLIND_INDEX_KEY`, including every old key a backup from the last 400 days may still need ([KEY_ROTATION.md](../KEY_ROTATION.md));
- the R2 **read-only kit token** for `suzu-one-backups` and `suzu-one-files-backup`, and the Cloudflare account ID;
- the names of the Google Cloud project and bucket;
- the logins: Supabase, Vercel, Cloudflare, Google Cloud, GitHub.

Check it at every drill ([restore.md](restore.md#the-restore-drill)).

## Setting it up (owner, once, about an hour)

Do the steps in this order: the job needs all of them before its first run. Tools on your machine: `npx wrangler` (logged in to the Cloudflare account), `gcloud`, `gh`, `age` (`brew install age`).

### 1. The backup key

```sh
age-keygen -o suzu-backup.key     # prints "Public key: age1…"
```

Put the whole file into the password manager as the age private key, print it for the safe, then delete the file. The **public key** (`age1…`) is not secret: it becomes the variable `AGE_RECIPIENT` (step 5).

### 2. The database role

Supabase → SQL Editor: run `scripts/backup/setup.sql` with a password of your own (`openssl rand -hex 24`) in place of `<password>`. The job's connection string is then
`postgresql://backup_reader.<project ref>:<password>@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres` — the **session** pooler, port 5432.

### 3. Cloudflare R2

```sh
npx wrangler r2 bucket create suzu-one-backups --location apac
npx wrangler r2 bucket create suzu-one-files-backup --location apac
# Keep each dump for its retention — not even the job's own token can delete it early — then let it go.
npx wrangler r2 bucket lock add suzu-one-backups --name hourly --prefix hourly/ --retention-days 3
npx wrangler r2 bucket lock add suzu-one-backups --name daily --prefix daily/ --retention-days 35
npx wrangler r2 bucket lock add suzu-one-backups --name monthly --prefix monthly/ --retention-days 400
npx wrangler r2 bucket lifecycle add suzu-one-backups --name hourly --prefix hourly/ --expire-days 3
npx wrangler r2 bucket lifecycle add suzu-one-backups --name daily --prefix daily/ --expire-days 35
npx wrangler r2 bucket lifecycle add suzu-one-backups --name monthly --prefix monthly/ --expire-days 400
# Files production deleted are moved under deleted/<date>/ and kept 400 days.
npx wrangler r2 bucket lock add suzu-one-files-backup --name deleted --prefix deleted/ --retention-days 400
npx wrangler r2 bucket lifecycle add suzu-one-files-backup --name deleted --prefix deleted/ --expire-days 400
```

Then Cloudflare dashboard → R2 → **Manage API tokens**, three tokens:

| Token | Permission | Buckets | Goes to |
| --- | --- | --- | --- |
| `backup-job-write` | Object Read & Write | `suzu-one-backups`, `suzu-one-files-backup` | GitHub secrets `R2_BACKUP_KEY_ID` / `R2_BACKUP_SECRET` |
| `backup-job-files-read` | Object Read only | `suzu-one-private` | GitHub secrets `R2_FILES_READ_KEY_ID` / `R2_FILES_READ_SECRET` |
| `backup-kit-read` | Object Read only | `suzu-one-backups`, `suzu-one-files-backup` | the restore kit |

### 4. Google Cloud

A project of its own, billed, in Singapore. `<project>` must be unique across Google (e.g. `suzu-backups-1`), and so must `<bucket>` (e.g. `suzu-backups-gcs`).

```sh
gcloud projects create <project> && gcloud billing projects link <project> --billing-account=<billing account id>
gcloud services enable storage.googleapis.com iamcredentials.googleapis.com sts.googleapis.com --project <project>
gcloud storage buckets create gs://<bucket> --project <project> --location asia-southeast1 \
  --uniform-bucket-level-access --public-access-prevention --retention-period 30d
gcloud storage buckets update gs://<bucket> --lifecycle-file scripts/backup/gcs-lifecycle.json

# The job's identity: it may add objects and set their customTime, never delete or overwrite one.
gcloud iam roles create backupWriter --project <project> --title "Backup writer" \
  --permissions storage.objects.create,storage.objects.get,storage.objects.list,storage.objects.update,storage.buckets.get
gcloud iam service-accounts create backup-writer --project <project>
gcloud storage buckets add-iam-policy-binding gs://<bucket> \
  --member serviceAccount:backup-writer@<project>.iam.gserviceaccount.com --role projects/<project>/roles/backupWriter

# GitHub signs in as it without a key: only this repository's `backups` environment, on main.
gcloud iam workload-identity-pools create github --project <project> --location global
gcloud iam workload-identity-pools providers create-oidc suzu-one --project <project> --location global \
  --workload-identity-pool github --issuer-uri https://token.actions.githubusercontent.com \
  --attribute-mapping 'google.subject=assertion.sub,attribute.repository=assertion.repository' \
  --attribute-condition "assertion.repository == 'dinhkhanh/suzu.one' && assertion.environment == 'backups' && assertion.ref == 'refs/heads/main'"
gcloud iam service-accounts add-iam-policy-binding backup-writer@<project>.iam.gserviceaccount.com --project <project> \
  --role roles/iam.workloadIdentityUser \
  --member "principalSet://iam.googleapis.com/projects/<project number>/locations/global/workloadIdentityPools/github/attribute.repository/dinhkhanh/suzu.one"
```

(`<project number>`: `gcloud projects describe <project> --format 'value(projectNumber)'`.)

**After a month of green nightly runs**, lock the retention policy. From then on nobody, including you, can delete a backup younger than 30 days or shorten the rule:

```sh
gcloud storage buckets update gs://<bucket> --lock-retention-period
```

### 5. healthchecks.io

In the "SuZu One" project ([incidents.md](incidents.md#setting-up-the-cron-switch-owner-once-10-minutes)), two checks with **Cron** schedules in UTC:

| Slug | Schedule | Grace |
| --- | --- | --- |
| `backup-hourly` | `0 0-15 * * 1-6` | 45 minutes |
| `backup-nightly` | `0 18 * * *` | 1 hour |

### 6. GitHub

The `backups` environment, which only `main` may use, holds everything the job needs:

```sh
gh api -X PUT repos/dinhkhanh/suzu.one/environments/backups --input - <<<'{"deployment_branch_policy":{"protected_branches":false,"custom_branch_policies":true}}'
gh api -X POST repos/dinhkhanh/suzu.one/environments/backups/deployment-branch-policies -f name=main

for name in BACKUP_DATABASE_URL R2_BACKUP_KEY_ID R2_BACKUP_SECRET R2_FILES_READ_KEY_ID R2_FILES_READ_SECRET HC_PING_URL; do
  gh secret set "$name" --env backups --repo dinhkhanh/suzu.one     # paste each value when asked
done
gh variable set AGE_RECIPIENT --env backups --repo dinhkhanh/suzu.one --body 'age1…'
gh variable set R2_ENDPOINT --env backups --repo dinhkhanh/suzu.one --body 'https://<cloudflare account id>.r2.cloudflarestorage.com'
gh variable set BACKUP_BUCKET --env backups --repo dinhkhanh/suzu.one --body suzu-one-backups
gh variable set FILES_BUCKET --env backups --repo dinhkhanh/suzu.one --body suzu-one-private
gh variable set FILES_BACKUP_BUCKET --env backups --repo dinhkhanh/suzu.one --body suzu-one-files-backup
gh variable set GCS_BUCKET --env backups --repo dinhkhanh/suzu.one --body '<bucket>'     # the bare name, no gs://
gh variable set GCP_WORKLOAD_IDENTITY_PROVIDER --env backups --repo dinhkhanh/suzu.one --body 'projects/<project number>/locations/global/workloadIdentityPools/github/providers/suzu-one'
gh variable set GCP_SERVICE_ACCOUNT --env backups --repo dinhkhanh/suzu.one --body 'backup-writer@<project>.iam.gserviceaccount.com'
```

`HC_PING_URL` is `https://hc-ping.com/<ping key>`, the same base as Vercel's `CRON_PING_URL`. `GCS_BUCKET` is the bucket's bare name: the scripts add `gs://` themselves, and `gs://suzu-one-backups` fails the first upload with "Invalid bucket name: 'gs:'".

### 7. The first run

Turn the job on: `gh variable set BACKUPS_ENABLED --repo dinhkhanh/suzu.one --body true` (a repository variable, not the environment's). Until then every run is skipped. Then Actions → Backup → **Run workflow** → `nightly`. It takes a few minutes. Every step green, and healthchecks shows `backup-nightly` up. If the last step reports files "named by a record but missing", look at those records before anything else: a file the database expects is not where it should be.

Then run the [restore drill](restore.md#the-restore-drill) once, from the kit alone. Until then, nothing has proven the backups can be read back by a person.

## Costs

At today's size (a 67 MB database, 131 MB of files), a few US cents a month across R2 and Google Cloud. GitHub Actions minutes are free for a public repository. At 200 GB of files, each backup holds about one copy of them: a few dollars a month in all.
