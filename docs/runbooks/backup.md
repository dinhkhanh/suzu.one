# Backup

What protects the data, and the one part the platforms do not do by themselves.

## What there is to lose

| What | Where | Backed up by |
|---|---|---|
| The database (every record, the audit log, encrypted salary fields) | Supabase Postgres, Singapore | Supabase daily backups and point-in-time recovery (below), plus our monthly dump |
| Files (contracts, payslip PDFs, evidence, photos) | Cloudflare R2 bucket `STORAGE_BUCKET` | **Nothing yet** — see "Files" below |
| Field-encryption keys (`DATA_ENCRYPTION_KEYS`, `DATA_BLIND_INDEX_KEY`) | Vercel environment variables | The owner's offline copy ([KEY_ROTATION.md](../KEY_ROTATION.md)). **A backup without its keys cannot be read back**: the encrypted fields stay ciphertext. |
| Every other secret | Vercel environment variables | Each can be re-issued at its provider ([KEY_ROTATION.md](../KEY_ROTATION.md)) |
| The code and the migrations | GitHub | Git itself |

## The database

### What Supabase keeps (check once, then once a year)

1. Supabase dashboard → the production project → **Database → Backups**.
2. **Scheduled backups**: on the Pro plan, one a day, kept 7 days. Confirm the latest is from today or yesterday.
3. **Point-in-time recovery (PITR)**: an add-on. NFR-OPS-02 asks for RPO ≤ 1 hour, which daily backups alone do not meet (a bad day loses up to 24 hours). Turn it on (Project settings → Add-ons → PITR, 7 days is enough — the monthly dump covers the long tail). With PITR on, the daily backups are replaced by it; recovery can go to any second inside the window.
4. Write down in the password manager, beside the Supabase login: the plan, whether PITR is on and its window, and the date you checked.

7 days (or PITR's window) is short of NFR-OPS-02's "daily backups ≥ 30 days, monthly ≥ 1 year". The monthly dump below closes the gap for the monthly copy; for the 30 daily days, either buy the 28-day PITR window or run the dump below weekly instead of monthly — decide once, write the decision down.

### The monthly dump (owner, first working day of the month, ~15 minutes)

A logical dump of the whole database, kept for 13 months outside Supabase, so that losing the Supabase project — or a mistake noticed after the PITR window — is still recoverable.

**Needs:** a machine with the PostgreSQL 17 client tools (`pg_dump --version` says 17.x — the server's major version), the production **direct** connection string (Supabase → Project settings → Database → Connection string → *Session* / port 5432, not the pooler on 6543), and write access to an R2 bucket for backups (not the files bucket).

1. Once only: create an R2 bucket, e.g. `suzu-backups`, in the same Cloudflare account. Settings → **Object lifecycle rules**: delete objects after 400 days. Settings → **Bucket lock** (if offered on the account): retain 30 days, so a leaked key cannot delete last month's dump. Create an R2 API token scoped to this bucket only, with write but not delete if the account allows it.
2. Dump, from the machine, into a file named by the date:
   ```sh
   export PGURL='postgresql://postgres.<ref>:<password>@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres'
   pg_dump "$PGURL" --format=custom --no-owner --no-privileges --schema=public --schema=app --schema=drizzle \
     --file "suzu-$(date +%Y-%m-%d).dump"
   ```
   It takes about a minute today. `--schema=drizzle` keeps the migration journal, so a restore knows which migrations it already has.
3. Check it is whole: `pg_restore --list "suzu-$(date +%Y-%m-%d).dump" | grep -c "TABLE DATA"` prints well over a hundred.
4. Upload it to the backups bucket (Cloudflare dashboard → R2 → `suzu-backups` → Upload, or `rclone copy`), then delete the local file. The dump holds every person's record; it never stays on a laptop.
5. Note the date and the file size in the password manager's backup note. A size that drops sharply from last month is a question worth asking.

Salary and other `restricted` / `compensation` fields are already encrypted inside the dump (they are encrypted by the app before they reach the database). Everything else — names, phone numbers, addresses — is in clear: treat the bucket as the most sensitive store the company has.

## Files

Files live in R2 (`STORAGE_BUCKET`), not in Postgres; the database only holds their keys. Neither Supabase's backups nor the dump contain them.

Until there is a copy, a deleted or overwritten object is gone. Once, the owner sets up one of:

- **R2 bucket replication / Sippy is not a backup** (it copies deletions too). Instead: a second bucket `suzu-files-copy`, and a monthly `rclone sync --backup-dir` (or `rclone copy`, which never deletes) from the files bucket into it, run beside the database dump; or
- Cloudflare's **object versioning**, when the account has it, with a lifecycle rule removing non-current versions after 400 days.

The app stores every upload under a new random key, and removes a deleted file's bytes with the `files-cleanup` job only `DELETED_FILE_GRACE_DAYS` (7) after the deletion — so the realistic loss is a bucket-level mistake, which is exactly what a second copy covers.

## After every backup change

Run the restore drill ([restore.md](restore.md)) with the new arrangement before trusting it.
