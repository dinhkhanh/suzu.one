# Runbooks

What to do, step by step, when the production system needs a hand. Written for the owner (or whoever holds the Vercel, Supabase and Cloudflare logins); each one says what it needs before it starts.

| Runbook | When |
|---|---|
| [Incidents](incidents.md) | Something is wrong in production: the uptime check, the cron switch or Sentry says so, or people do. Also: setting up the uptime check and the cron switch. |
| [Rollback](rollback.md) | A deploy broke something: go back to the previous build. The migration rule that makes that safe. |
| [Backup](backup.md) | What is backed up, where, for how long — and the monthly dump the platform does not keep. |
| [Restore](restore.md) | Getting data back, and the restore drill (twice a year, NFR-OPS-02). |
| [Environments](environments.md) | Moving off the shared database: a staging project, and nobody's laptop pointing at production. |

The service names and ids (Vercel team and project, Supabase project ref) are in the owner's password manager beside the logins; they are not repeated here.

**Targets (SRS NFR-OPS-01, 02):** 99.5 % availability Mon–Sat 07:00–22:00 ICT · RPO ≤ 1 hour · RTO ≤ 8 hours · daily backups kept ≥ 30 days, a monthly one ≥ 1 year · a restore drill at least twice a year.
