# SuZu One

Internal operations platform for SuZu Group: HRM first (people, attendance, leave, payroll, recruitment, performance), plus work management, an HR/finance obligations tracker, a knowledge base and internal comms. CRM follows later.

- Requirements: [docs/SRS.md](docs/SRS.md)
- Architecture, phases and status: [docs/DEVELOPMENT_PLAN.md](docs/DEVELOPMENT_PLAN.md)

## Stack

Next.js 16 (App Router) · TypeScript · Tailwind + shadcn/ui · PostgreSQL + Drizzle ORM · Better Auth (Google sign-in only) · next-intl (vi/en) · Vitest.

## Local setup

Local development runs against a self-hosted Supabase stack in Docker (database, Studio), managed by the Supabase CLI. Docker must be running.

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
| `POSTGRES_URL` / `POSTGRES_URL_NON_POOLING` | Pooled connection for the app, direct one for migrations. Named as the Vercel–Supabase integration names them, so `vercel env pull .env.local` configures a laptop like production |
| `BETTER_AUTH_SECRET` | `openssl rand -base64 32` |
| `BETTER_AUTH_URL` | `http://localhost:3000` locally, `https://suzu.one` in production |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google Cloud OAuth client, user type **External** (the two Workspaces are separate organisations). Redirect URI: `{BETTER_AUTH_URL}/api/auth/callback/google` |
| `ALLOWED_WORKSPACE_DOMAINS` | `suzu.vn,suzu.group,bambooads.net` (the sign-in page names only the first two) |
| `BOOTSTRAP_OWNER_EMAILS` | Workspace emails that may sign in before any person record exists; they become Owner on first sign-in |
| `CRON_SECRET` | Shared with Vercel Cron (`vercel.json`); without it the scheduled jobs under `/api/cron/*` refuse to run |
| `CLOUDFLARE_ACCOUNT_ID` | The Cloudflare account of the file bucket and the embeddings |
| `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` / `STORAGE_BUCKET` | Private file storage in Cloudflare R2 (see *File storage* below). Locally: a development bucket of your own, never production's |
| `CLOUDFLARE_AI_API_TOKEN` / `EMBEDDINGS_MODEL` | Knowledge-base embeddings through Workers AI (default `@cf/baai/bge-m3`). Without a token a deterministic local fake stands in |
| `DATA_ENCRYPTION_KEYS` / `DATA_BLIND_INDEX_KEY` | Field encryption for restricted and compensation data — **unrecoverable if lost**; see [docs/KEY_ROTATION.md](docs/KEY_ROTATION.md) |
| `RESEND_API_KEY` / `EMAIL_FROM` | Outgoing email. Without a key, emails are only written to the `email_outbox` table |
| `SENTRY_DSN` / `NEXT_PUBLIC_SENTRY_DSN` | Optional error tracking (Sentry SDK); without them errors are only logged. `SENTRY_TRACES_SAMPLE_RATE` (0–1) turns on tracing; `SENTRY_ORG` / `SENTRY_PROJECT` / `SENTRY_AUTH_TOKEN` upload source maps at build time. Nothing about a person or a request's content is sent (`src/lib/observability/scrub.ts`) |

## Deployment

Pushing to `main` deploys to production on Vercel (project `suzu-one`, team `suzu-group`). The `vercel-build` script applies pending database migrations first — **on production deploys only**; preview builds never migrate. Production database: Supabase, provisioned through the Vercel integration. Auth variables (`BETTER_AUTH_*`, `GOOGLE_*`, `ALLOWED_WORKSPACE_DOMAINS`, `BOOTSTRAP_OWNER_EMAILS`) are set in Vercel for the production environment.

### Scheduled jobs

`vercel.json` triggers `/api/cron/midnight` (00:05 in Vietnam: bring people's placement up to date, activate new starters) and `/api/cron/morning` (07:00: notification digests, email retries, abandoned-upload cleanup). Every run is recorded and shown under Admin → Scheduled jobs; a failure notifies the Owners. To run one by hand: `curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/morning`.

### File storage

Files live in a private Cloudflare R2 bucket; the app talks to it over R2's S3-compatible API with a key pair scoped to that bucket. Browsers upload straight to it through two-hour presigned PUT URLs and download through one-minute presigned GET URLs — the bytes never pass through the app, except the public careers form's, which the server checks and writes itself. What arrives is measured and sniffed before it counts (`completeUpload`), and only then given its download name: R2 cannot be told a filename when a link is made, so each object carries its own `Content-Disposition`.

Setting up a bucket (once per environment):

1. `npx wrangler r2 bucket create suzu-private --location apac` (a development bucket the same way, e.g. `suzu-dev`).
2. Bucket → Settings → CORS policy, so browsers may PUT to it:
   ```json
   [{ "AllowedOrigins": ["https://suzu.one"], "AllowedMethods": ["PUT"], "AllowedHeaders": ["content-type"], "MaxAgeSeconds": 3600 }]
   ```
   (the development bucket: `http://localhost:3000` and the preview domains instead).
3. R2 → Manage API tokens → **Object Read & Write**, limited to that bucket. Its access key ID and secret are `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY`; set them with `CLOUDFLARE_ACCOUNT_ID` in Vercel (production → the production bucket, previews → the development one).

**Moving from Supabase Storage** (once): with the R2 variables and the old `SUPABASE_URL` / `SUPABASE_SECRET_KEY` of production in the environment, run `pnpm storage:to-r2 --dry-run`, then `pnpm storage:to-r2` — before the deployment that switches to R2 — and once more right after it, which copies only what was uploaded in between. When downloads of old files work, the Supabase bucket can be emptied.

### Database exposure

Supabase serves everything in the `public` schema over a REST API with a public key. This app does not use that API, so every table has row-level security enabled with no policies, and the API roles' privileges are revoked. A test fails if a new table forgets `.enableRLS()`.

## Who can sign in

Google Workspace accounts only. The server requires Google's verified hosted-domain claim to be on the allowlist (personal Gmail is rejected), **and** the email must match a person record that is not suspended or offboarded. The domain grants nothing by itself; roles are always explicit. Access is re-checked on every request, so offboarding locks a person out at once.

## Commands

| | |
|---|---|
| `pnpm check` | typecheck + lint + tests |
| `pnpm test` | unit tests, plus migration and service tests against an in-process Postgres (PGlite). Changing a role? Regenerate [docs/permission-matrix.md](docs/permission-matrix.md): `pnpm vitest run tests/permission-matrix.test.ts -u` |
| `CLOUDFLARE_ACCOUNT_ID=… R2_ACCESS_KEY_ID=… R2_SECRET_ACCESS_KEY=… STORAGE_BUCKET=<dev bucket> pnpm vitest run tests/storage.integration.test.ts` | file-storage tests against a real R2 development bucket (skipped otherwise) |
| `pnpm storage:to-r2 [--dry-run]` | copy stored files from Supabase Storage into R2 (the one-time move; safe to repeat) |
| `pnpm db:generate` | create a migration from schema changes (`--name <what_changed>`) |
| `pnpm db:migrate` | apply migrations |
| `pnpm db:studio` | browse the database |
