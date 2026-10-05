# Rollback

A deploy broke something. The fastest way back is the previous build — it is still on Vercel, already built, and promoting it takes seconds.

## Why that is safe: the migration rule

Pushing to `main` runs the new migrations against production **before** the new build (`vercel-build` in `package.json`), and Vercel's rollback brings back old *code*, never an old *schema*. So the previous build always runs on the newer schema. That only works because every migration is **backward-compatible with the code deployed before it**:

- add tables, add nullable columns or columns with a default, add indexes and constraints the old code already satisfies;
- never drop, rename or retype a column or table the previous deploy reads, and never make a column `NOT NULL` that it may leave empty. Removing something takes two deploys: one that stops using it, then — once that one is live and you are sure you will not roll back past it — one that drops it;
- every migration starts with `SET lock_timeout = '5s';` so it gives up instead of queueing every request behind a lock.

`tests/migration-lint.test.ts` enforces this in `pnpm check` and CI: a migration after 0127 that drops, renames, retypes or tightens fails unless the file says why it is safe (`-- migration-lint: allow <rule> — <reason>`), and one without `lock_timeout` fails. A migration that is allowed to be destructive is also one you cannot roll back across — note it in the pull request.

If a migration fails on deploy (for instance it hit the lock timeout), drizzle rolls the whole batch back, the build stops, and the previous deploy stays live on the previous schema: nothing to roll back. Find out what held the lock (Supabase → Database → Query performance, or `select * from pg_stat_activity where state <> 'idle'`), and redeploy when it is quiet.

## Rolling back the code (5 minutes)

**Needs:** the Vercel login.

1. Vercel → the project → **Deployments**. Find the production deployment before the bad one (green, "Production" or "Promoted" in its history).
2. **⋯ → Promote to Production** (on Hobby/Pro this is "Instant Rollback"). The domain points at it within seconds; nothing is rebuilt and no migration runs.
3. Check: open the app, sign in, open the page that was broken. Open `/api/health` — it must say `{"ok":true}`.
4. **The cache**: entries written by the bad build may have a shape the old build does not expect. If a page errors after the rollback, flush: `pnpm cache:flush https://<app domain>` (needs `CRON_SECRET`).
5. **Fix forward.** After a rollback Vercel stops giving the production domain to new builds until you promote one. A push to `main` still builds — and its build **still runs its migrations against production** — but stays unpromoted. So: fix on a branch, merge to `main`, check the new build on its deployment URL, then **Promote to Production** (or "Undo Rollback"). Reverting the bad commit (`git revert <sha>`, push) is a fix like any other; a revert of a commit with a migration leaves the migration applied — that is fine, by the rule above.
6. **Cron**: the rolled-back build runs the schedules of *its* `vercel.json`. A job added by the bad deploy simply does not run until the fix is deployed.

## Rolling back data

A rollback of code never undoes what the bad build wrote. If it wrote wrong data, see [restore.md](restore.md) — usually the "few records" path, not a full restore.

## A migration that must be undone

There is no down-migration. Write a new, forward migration that puts things right (it goes through the same lint), test it on a copy ([restore.md](restore.md#the-restore-drill-twice-a-year--eg-first-week-of-april-and-october), steps 1–4, then `pnpm db:migrate` against the copy — never against production by hand), and deploy it the normal way.
