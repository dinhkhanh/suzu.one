# SuZu One

Internal operations platform for SuZu Group: HRM first (people, attendance, leave, payroll, recruitment, performance), plus work management, an HR/finance obligations tracker, a knowledge base and internal comms. CRM follows later.

- Requirements: [docs/SRS.md](docs/SRS.md)
- Architecture, phases and status: [docs/DEVELOPMENT_PLAN.md](docs/DEVELOPMENT_PLAN.md)

## Stack

Next.js 16 (App Router) · TypeScript · Tailwind + shadcn/ui · PostgreSQL + Drizzle ORM · Better Auth (Google sign-in only) · next-intl (vi/en) · Vitest.

## Local setup

Local development runs against a self-hosted Supabase stack in Docker (database, storage, Studio), managed by the Supabase CLI. Docker must be running.

```bash
pnpm install
cp .env.example .env.local        # then fill in the values (see below)
pnpm db:up                        # start local Supabase (first run downloads images)
pnpm db:migrate && pnpm db:seed   # apply migrations; placeholder entities, shared departments, statutory parameters
pnpm db:seed:demo                 # optional, local database only: a small fake company with role grants
pnpm dev
```

Local ports are moved to the 5532x range in `supabase/config.toml` so this project can run next to other local Supabase projects: database `55322`, Studio <http://127.0.0.1:55323>, API `55321`. `pnpm db:down` stops the stack (data is kept).

### Environment

| Variable | Notes |
|---|---|
| `DATABASE_URL` | Postgres connection string. Leave unset on Vercel: the Supabase integration provides `POSTGRES_URL` (app) and `POSTGRES_URL_NON_POOLING` (migrations) |
| `BETTER_AUTH_SECRET` | `openssl rand -base64 32` |
| `BETTER_AUTH_URL` | `http://localhost:3000` locally, `https://suzu.one` in production |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google Cloud OAuth client, user type **External** (the two Workspaces are separate organisations). Redirect URI: `{BETTER_AUTH_URL}/api/auth/callback/google` |
| `ALLOWED_WORKSPACE_DOMAINS` | `suzu.vn,suzu.group` |
| `BOOTSTRAP_OWNER_EMAILS` | Workspace emails that may sign in before any person record exists; they become Owner on first sign-in |
| `CRON_SECRET` | Shared with Vercel Cron (`vercel.json`); without it the scheduled jobs under `/api/cron/*` refuse to run |
| `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` | Private file storage. Set by the Supabase integration on Vercel. Locally: `http://127.0.0.1:55321` and `docker exec supabase_storage_suzu-one printenv SERVICE_KEY` |
| `DATA_ENCRYPTION_KEYS` / `DATA_BLIND_INDEX_KEY` | Field encryption for restricted and compensation data — **unrecoverable if lost**; see [docs/KEY_ROTATION.md](docs/KEY_ROTATION.md) |
| `RESEND_API_KEY` / `EMAIL_FROM` | Outgoing email. Without a key, emails are only written to the `email_outbox` table |
| `SENTRY_DSN` | Optional error tracking; without it server errors are only logged |

## Deployment

Pushing to `main` deploys to production on Vercel (project `suzu-one`, team `suzu-group`). The `vercel-build` script applies pending database migrations first — **on production deploys only**; preview builds never migrate. Production database: Supabase, provisioned through the Vercel integration. Auth variables (`BETTER_AUTH_*`, `GOOGLE_*`, `ALLOWED_WORKSPACE_DOMAINS`, `BOOTSTRAP_OWNER_EMAILS`) are set in Vercel for the production environment.

### Scheduled jobs

`vercel.json` triggers `/api/cron/midnight` (00:05 in Vietnam: bring people's placement up to date, activate new starters) and `/api/cron/morning` (07:00: notification digests, email retries, abandoned-upload cleanup). Every run is recorded and shown under Admin → Scheduled jobs; a failure notifies the Owners. To run one by hand: `curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/morning`.

### Database exposure

Supabase serves everything in the `public` schema over a REST API with a public key. This app does not use that API, so every table has row-level security enabled with no policies, and the API roles' privileges are revoked. A test fails if a new table forgets `.enableRLS()`.

## Who can sign in

Google Workspace accounts only. The server requires Google's verified hosted-domain claim to be on the allowlist (personal Gmail is rejected), **and** the email must match a person record that is not suspended or offboarded. The domain grants nothing by itself; roles are always explicit. Access is re-checked on every request, so offboarding locks a person out at once.

## Commands

| | |
|---|---|
| `pnpm check` | typecheck + lint + tests |
| `pnpm test` | unit tests, plus migration and service tests against an in-process Postgres (PGlite). Changing a role? Regenerate [docs/permission-matrix.md](docs/permission-matrix.md): `pnpm vitest run tests/permission-matrix.test.ts -u` |
| `SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… pnpm vitest run tests/storage.integration.test.ts` | file-storage tests against the local Supabase stack (skipped otherwise) |
| `pnpm db:generate` | create a migration from schema changes (`--name <what_changed>`) |
| `pnpm db:migrate` | apply migrations |
| `pnpm db:studio` | browse the database |
