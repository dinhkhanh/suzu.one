@AGENTS.md

# SuZu One — project conventions

Read `docs/SRS.md` (requirements, decisions D1–D18) and `docs/DEVELOPMENT_PLAN.md` (architecture §2, phases §3) before starting a phase.

## Architecture rules

- Modular monolith. Business logic lives in `src/modules/<module>/`; `src/app/` holds routes only.
- A module's files: `schema.ts` (its tables), `service.ts` (use-cases; the only entry point for other modules), `policy.ts`/`actions.ts`, `engine/` (pure calculation code), `ui/`.
- Every mutation is a server action built with `createAction()` from `src/lib/action.ts`: parse → authenticate → authorize → run → audit. Never write to the database from a route or component directly.
- Authorization is `can()` / `readableTier()` from `src/modules/platform/rbac/policy.ts`. Deny by default. Navigation checks are cosmetic; pages and actions re-check. The proxy is only an optimistic cookie check.
- Sensitivity tiers: `public_internal` < `personal` < `restricted` < `compensation`. Line managers never see compensation.
- Calculation engines (payroll, timesheet, leave accrual) are pure functions with no I/O and have golden tests.
- Money is integer VND. Legal rates, caps, brackets and holidays are effective-dated configuration, never constants in code.
- Tables carry `entity_id` where the data belongs to a legal entity. Units are shared across entities (`entity_id` null) unless stated.
- The organisation is one `org_unit` tree (D20, FR-PLT-16): departments, big teams and small teams nest to any depth. A person sits in one unit (`person.org_unit_id`); `org_unit.path`, `person.org_unit_path` and the derived `department_id` / `team_id` are written by database triggers, never by the application. Naming a unit — a role scope, an access row, an announcement audience — reaches everything below it; `unit_only:<id>` is the opt-out.
- Every `pgTable(...)` ends with `.enableRLS()` and gets no policies: the app connects as the table owner, and Supabase's public API roles must see nothing. A migration test enforces this.
- Pushing to `main` deploys to production and runs migrations there. Migrations must be backward-compatible with the currently deployed code.
- Reads that repeat per request go through `cached()` / `invalidate()` from `src/lib/cache` (Upstash Redis): reference data (org tree, types, policies, rates, calendars, templates) and role grants only — never personal, restricted or compensation data. Every writer of a cached table calls `invalidate()` after its change commits; a reader given a transaction reads from it, not the cache. Writes made outside the app (seeds, manual SQL) are followed by `pnpm cache:flush`.
- Postgres functions live in the private `app` schema (never `public`, which Supabase's API exposes), are `LANGUAGE sql STABLE` where possible, and end with `REVOKE EXECUTE ... FROM PUBLIC`. A migration test enforces this. Prefer aggregate SQL (GROUP BY, FILTER, DISTINCT ON, LATERAL) to loading rows into JS.
- **This applies to a new feature's reads as much as to the old ones — a feature is not finished while it still reads the naive way.** Every read you add answers two questions before it ships:
  1. *Is this reference data?* (types, templates, rules, policies, definitions, rates, calendars, plan templates, automation/triage/review-chain/hand-off/intake definitions, role grants.) Then it goes through `cached()` under one key for the whole small table, filtered in JS per caller — never a cache key per id or per team — with a stable total ordering so the stored array is deterministic, an optional `Executor` that bypasses the cache inside a transaction, and an `invalidate()` from **every** writer of that table, after the change commits and outside the transaction callback. Export a named `invalidate…()` so writers in other files can drop it. Volatile columns on an otherwise cacheable row (run counts, last-run times bumped inside another module's transaction) are read as they stand, beside the cached definition — never served from the cache. Copy `src/modules/work/teams.ts` or `src/modules/work/custom-fields.ts`.
  2. *Am I counting, summing, grouping, de-duplicating or picking one-per-group in JS?* Then it belongs in SQL (`count(*) filter (…)`, `sum(…)`, `GROUP BY`, `DISTINCT ON`, `LATERAL`), and a figure a screen only totals is fetched as the total, not as the rows. A query inside a loop, a `Promise.all` over ids, or a sequential `await` per row is a batched query instead — give the function the plural signature (`…OfPeople`, `…ByTask`, `resolveTaskKeys`) rather than calling the singular one N times. Copy `src/modules/daily/totals.ts` or `src/modules/work/delivery-facts.ts`.
- The audit log is append-only (database trigger). Do not add update or delete paths.
- New tables: add to the module's `schema.ts`, export from `src/lib/db/schema.ts` (relative import), then `pnpm db:generate --name <change>`.
- UI strings go in `messages/vi.json` (source language) and `messages/en.json`. No hard-coded user-facing text.
- `server-only` modules read configuration through `env()`; never read `process.env` elsewhere in `src/`.

## Before finishing a change

Run `pnpm check`. New permissions or roles need cases in `policy.test.ts`. New sign-in rules need cases in `sign-in-policy.test.ts`.

Then read back every read the change added, against the two questions above: reference data through `cached()` with its writers invalidating, and counting, grouping and per-id lookups in SQL rather than in JS. A feature built with bare queries is unfinished work, not a follow-up.
