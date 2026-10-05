# Environments

NFR-OPS-04 asks for local, preview, staging and production. Today there are local and production — and the developer's local `.env.local` points at production (ENG-03, NFR-SEC-06), so "trying something locally" writes to the real database. These are the owner's steps to separate them. Nothing here needs code changes.

## 1. Nobody's laptop points at production (first, ~30 minutes)

1. On each developer machine: `.env.local` → `POSTGRES_URL` and `POSTGRES_URL_NON_POOLING` point at the local stack (`pnpm db:up`, then `postgresql://postgres:postgres@127.0.0.1:55322/postgres` for both), `BETTER_AUTH_URL=http://localhost:3000`, and **no** production `CRON_SECRET`, `DATA_ENCRYPTION_KEYS`, `RESEND_API_KEY`, `GOOGLE_CHAT_WEBHOOK_URL`, Messenger or Telegram tokens. Use the local step-up driver.
2. `pnpm db:migrate && pnpm db:seed && pnpm db:seed:demo` fill the local database with fake people.
3. Rotate the production database password (Supabase → Project settings → Database → Reset password), update `POSTGRES_URL` / `POSTGRES_URL_NON_POOLING` in Vercel (Production), redeploy. The old password — which sat in `.env.local` files — stops working.
4. Rotate the secrets that were on laptops ([KEY_ROTATION.md](../KEY_ROTATION.md)): `CRON_SECRET`, and `BETTER_AUTH_SECRET` (everyone signs in once more). The field-encryption keys cannot be rotated away from a copy that already read the data; keep them in the offline copy and Vercel only from now on.
5. Production data is looked at through the app, as a person with the right role — not through a local server.

## 2. A staging project (~1 hour, then a few minutes per release)

Staging is a second, separate copy of the system with fake data, where a release is tried with real services before `main`.

1. **Supabase:** a second project, `suzu-one-staging`, Singapore, the smallest plan. (A Supabase *branch* of production is an alternative: it shares the billing and the project, starts empty, and is deleted with one click — good for the restore drill, less good as a standing staging.)
2. **Vercel:** in the same project, Settings → Environments → create a custom environment **staging** tracking the branch `staging` (or use **Preview** for every branch). Set its variables — **never production's values**:
   - `POSTGRES_URL` / `POSTGRES_URL_NON_POOLING`: the staging project's pooler and direct strings;
   - `BETTER_AUTH_URL`: the staging URL; a staging OAuth redirect URI added to the Google client;
   - fresh `BETTER_AUTH_SECRET`, `CRON_SECRET`, `DATA_ENCRYPTION_KEYS`, `DATA_BLIND_INDEX_KEY` (generated for staging);
   - no `RESEND_API_KEY` (emails stay in the outbox), no Chat / Messenger / Telegram tokens, no `CRON_PING_URL`;
   - `SENTRY_ENVIRONMENT=staging`.
3. **Migrations on staging:** `vercel-build` migrates only when `VERCEL_ENV=production`. For staging, run them from a machine: `POSTGRES_URL=<staging direct> POSTGRES_URL_NON_POOLING=<staging direct> pnpm db:migrate`, then `pnpm db:seed && pnpm db:seed:demo` once, then `pnpm cache:flush <staging URL>`.
4. **Previews** (pull requests): until the Preview environment has its own database variables, a preview build either fails to start or — if Preview inherited production's variables — reads production. Check Vercel → Settings → Environment Variables: no production database string may be ticked for *Preview*. Point Preview at the staging database (shared by all previews) or leave it without one.
5. **A release:** merge to `staging`, migrate staging, try the change there with the demo people, then merge to `main`.

## 3. CI

GitHub Actions already runs `pnpm check` and `pnpm build` on every push and pull request, and the Playwright smoke suite (`e2e/`) against a throwaway Postgres service container with migrations and the demo seed — never against staging or production.
