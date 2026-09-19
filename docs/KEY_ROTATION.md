# Secrets and key rotation

Secrets live only in the platform secret store (Vercel environment variables) — never in the repository (NFR-SEC-04). `.env.example` lists every variable; `.env.local` is for the local stack only.

## Field-encryption keys (`DATA_ENCRYPTION_KEYS`)

`restricted` and `compensation` fields are encrypted in the application before they reach the database (`src/lib/crypto/field-cipher.ts`). Each value has its own data key; the keys in `DATA_ENCRYPTION_KEYS` only wrap those data keys, so rotating never re-encrypts the data itself.

**These keys cannot be recovered.** If every copy is lost, the encrypted fields are lost with them; database backups do not help. The owner keeps an offline copy (password manager or printed, in the company safe) of every key that still protects data.

Format: `id:base64key,id:base64key` — the **first** key encrypts new values; all listed keys can decrypt.

### Rotating (yearly, or at once if a key may have leaked)

1. Generate a key: `openssl rand -base64 32`. Pick a new id, e.g. `k2026`.
2. Put it **first**: `DATA_ENCRYPTION_KEYS=k2026:<new>,k2025:<old>`. Redeploy. New writes use `k2026`; everything stays readable.
3. Re-wrap existing values with the re-wrap job (added with the first encrypted table in Phase 1 week 2). It calls `rewrap()` on every value whose key id is not the active one, and reports how many are left.
4. When the job reports zero values on the old key, remove the old key from the variable and redeploy. Keep the old key in the offline copy for as long as any database backup from before step 3 is retained (≥ 1 year, NFR-OPS-02).

### `DATA_BLIND_INDEX_KEY`

Used for look-ups on encrypted values (for example "is this national ID already on file?"). It cannot be rotated in place: changing it means recomputing every index column. Treat a leak as low severity (it reveals equality of values, not the values) and plan the recompute as a migration.

## Other secrets

| Variable | Rotate by | Effect |
|---|---|---|
| `BETTER_AUTH_SECRET` | Replace and redeploy | Everyone is signed out once |
| `GOOGLE_CLIENT_SECRET` | New secret in Google Cloud → update → redeploy → delete the old one | None |
| `CRON_SECRET` | Replace and redeploy | None (Vercel Cron reads the same variable) |
| `RESEND_API_KEY` | New key in Resend → update → redeploy → revoke the old one | None |
| `SUPABASE_SERVICE_ROLE_KEY`, database password | Rotate in Supabase; the Vercel integration updates the variables; redeploy | Brief reconnect |

After any rotation: check `/admin/jobs` the next morning and the sign-in page.
