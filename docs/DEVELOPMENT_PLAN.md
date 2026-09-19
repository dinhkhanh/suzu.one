# Suzu One — Development Plan

| | |
|---|---|
| **Version** | 0.2 (owner's answers of 2026-09-19 incorporated) |
| **Date** | 2026-09-19 |
| **Companion doc** | [SRS.md](./SRS.md) — requirement IDs below (FR-…, NFR-…) refer to it |

---

## 1. Delivery strategy

Four principles drive the order of work:

1. **Ship something people use every day, early.** The first live milestone comes about 6 weeks in (employee records + directory), then check-in and leave. Daily use builds the habit and the data that later modules depend on.
2. **Build the two shared engines once.** The *approval engine* and the *task engine* (SRS §3.1) are platform work. Leave, OT, requests, payroll sign-off, onboarding checklists, work management and the compliance tracker all reuse them.
3. **Payroll comes after the data is trustworthy.** Payroll needs at least two clean months of locked timesheets and leave data, then two months of parallel run. So it is built mid-plan, while attendance data accumulates — and work management (which the leaders want now) ships before it.
4. **Roll out by pilot.** Each module goes to one pilot entity or department first, behind a feature flag, then to the whole group.

### Phase order at a glance

| Phase | Scope | Indicative duration | Live milestone |
|---|---|---|---|
| **0** | Foundation & platform | 3 wks | — (internal) |
| **1** | Core HR | 4 wks | **M1** — HR spreadsheets retired; everyone can sign in, directory and org chart live |
| **2** | Attendance & leave | 5 wks | **M2** — daily check-in, leave and OT requests, monthly timesheet lock |
| **3** | Work management + Operations & compliance tracker | 5 wks | **M3** — leaders assign and track tasks; HR/finance deadline calendar live |
| **3.5** | OKRs & KPIs (moved forward from Phase 8) | 2 wks | **M3.5** — 2027 goals and KPIs tracked in-system from Q1 2027 |
| **4** | Knowledge base + internal comms | 3 wks | **M4** — policies published and acknowledged; home feed |
| **5** | Payroll | 6 wks build + 2 months parallel run | **M5** — first official payroll from the system |
| **6** | Assets & requests | 3 wks | **M6** — paper/chat approvals retired |
| **7** | Recruitment (ATS) | 4 wks | **M7** — careers page live, candidate → employee flow |
| **8** | Performance reviews + performance-driven year-end bonus | 3 wks | **M8** — review cycle in-system; 2027 year-end bonus computed from KPI/OKR results |
| **9** | AI assistant + analytics | 3 wks | **M9** — "Ask Suzu" and owner dashboard v2 |
| **10** | CRM | separate SRS | — |

Build time for the full HRM suite (phases 0–9) is roughly **41 weeks ≈ 9–10 months**. Starting late September 2026, that puts M1 in early November 2026, M2 in mid-December 2026, M3 in late January 2027, M3.5 in February 2027 and the first official payroll (M5) around mid-2027. The payroll parallel run overlaps phases 6–7.

> **About the estimates.** The team is the owner plus Claude Code (SRS D9). Durations assume steady, near-full-time build sessions, plus part-time input from the HR lead and the chief accountant for UAT. If the owner's time is part-time, calendar dates stretch proportionally. The estimates will be re-baselined after Phase 1, once real velocity is known.
>
> **Why OKRs moved forward.** The year-end bonus is driven by KPI and OKR results (SRS D13). For the 2027 bonus to be computed in-system, 2027 goals and KPI actuals must be captured from early 2027 — so goal and KPI tracking ships as Phase 3.5, and the review cycle and bonus scheme follow in Phase 8, before year-end 2027.

---

## 2. Architecture plan

### 2.1 Application shape — modular monolith

A single Next.js application and a single PostgreSQL database, strictly modular inside. There are no microservices and no monorepo tooling until a second deployable actually exists.

```
src/
  app/                      # Next.js App Router — routes only, thin
    (auth)/                 # sign-in, not-provisioned
    (app)/                  # authenticated shell
      home/  people/  attendance/  leave/  payroll/  work/  ops/
      kb/  recruit/  performance/  assets/  requests/  admin/
    (public)/careers/       # the only public surface
    api/                    # webhooks, device push, cron endpoints
  modules/                  # ← all business logic lives here
    platform/
      auth/  org/  rbac/  approvals/  tasks-engine/  notifications/
      files/  audit/  search/  statutory/  import-export/  jobs/
    core-hr/  attendance/  leave/  payroll/  work/  ops/  kb/
    recruit/  performance/  assets/  requests/  comms/  ai/
      ├─ schema.ts          # Drizzle tables owned by this module
      ├─ service.ts         # use-cases; the only entry point for other modules
      ├─ policy.ts          # authorization rules for this module
      ├─ actions.ts         # server actions (validate → authorize → service)
      ├─ events.ts          # domain events emitted / handled
      ├─ engine/            # pure calculation code (payroll, timesheet, accrual)
      └─ ui/                # module components
  lib/                      # db client, env, i18n, money, dates, utils
  components/ui/            # shadcn design-system components
docs/  drizzle/ (migrations)  tests/  scripts/
```

Rules (enforced by lint boundaries):

- `app/` contains no business logic. It calls module actions and services.
- A module imports another module **only through its `service.ts`**, or reacts to its **domain events** (e.g. `employee.hired` → ops tracker creates the "register insurance" obligation; `leave.approved` → attendance recomputes the day).
- Every server action follows one pipeline: **parse (zod) → authenticate → authorize (policy) → service → audit → revalidate**. A shared `createAction()` wrapper makes skipping a step impossible.
- Calculation engines (`payroll/engine`, `attendance/engine`, `leave/engine`) are **pure functions with no I/O**. They take plain data and statutory parameters and return results with an explanation trace. This makes them testable against the accountant's spreadsheets.

### 2.2 Key technical decisions

| # | Decision | Rationale |
|---|---|---|
| ADR-01 | Next.js 16 App Router, server components and server actions; Node.js runtime (no edge runtime) | Simple data access and full Node APIs for PDF/Excel generation |
| ADR-02 | PostgreSQL + Drizzle ORM; SQL migrations committed and reviewed | Integrity constraints, effective-dated queries, reporting SQL |
| ADR-03 | Better Auth with Google provider; database sessions | Instant revocation on offboarding; custom two-workspace `hd` check (FR-PLT-02..05) |
| ADR-04 | Authorization in an application policy layer (role × scope × sensitivity tier); DB access only through module services | "Manager-of" and effective-dated scopes are impractical as row-level policies alone; one place to test |
| ADR-05 | Application-level envelope encryption for `restricted` / `compensation` columns | Defence in depth beyond disk encryption (DR-05) |
| ADR-06 | Money as integer VND in a `Money` helper type; no floats | Payroll correctness (DR-01) |
| ADR-07 | Effective-dated tables use `valid_from` / `valid_to` with exclusion constraints | History without ambiguity (DR-02) |
| ADR-08 | Domain events via a transactional outbox table + background dispatcher | Reliable cross-module reactions without coupling |
| ADR-09 | Background work: cron triggers + durable workflow steps for payroll runs, imports, schedulers and notification fan-out | Long jobs survive restarts and show progress |
| ADR-10 | One task engine; work management and the ops tracker are "task kinds" with their own views | One "My work" inbox, less code |
| ADR-11 | Feature flags by entity/department/user | Pilot rollouts (NFR-OPS-05) |
| ADR-12 | next-intl; Vietnamese as source language | Vietnamese-first UX |
| ADR-13 | Hosting Vercel (Singapore) + Supabase Postgres/Storage (Singapore), domain `suzu.one` — decided (SRS D10, D11); everything containerisable | Speed now, portability later |

### 2.3 Environments & pipeline

| Environment | Purpose | Data |
|---|---|---|
| Local | Development: self-hosted Supabase stack in Docker via the Supabase CLI, seeded fake company | Synthetic |
| Preview | One per pull request, auto-deployed; database branch | Synthetic |
| Staging | UAT with HR and the accountant; payroll parallel-run rehearsals | Anonymised copy |
| Production | Live | Real |

CI on every pull request: typecheck → lint (incl. module boundaries) → unit tests → integration tests (real Postgres) → permission-matrix tests → build → preview deploy → Playwright smoke tests on the preview. The main branch deploys to staging automatically. Production deploys by manual promotion.

---

## 3. Phase details

Each phase lists its scope (SRS IDs), key deliverables, and its **exit criteria** — the conditions under which the phase counts as done.

### Phase 0 — Foundation & platform (3 weeks)

> **Status, 2026-09-19.** The first part is live on `main`; the remainder below is built on branch `phase-0-remainder` (stacked on `phase-1-core-hr`; not merged, not deployed).
> **Done (on `main`):** Next.js 16 scaffold and tooling (`pnpm check`); schema + migrations for auth, entities/branches/shared departments/teams, person, role assignments, audit log (append-only trigger); Google sign-in with the two-workspace rules (`sign-in-policy.ts`, tested); per-request access re-check with session revocation; RBAC policy (role × scope × tier, tested); `createAction()` pipeline with audit; vi/en i18n; app shell, home, entities admin (list + create); seed data; security headers; local Supabase stack in Docker; row-level security on every table with the Supabase API roles revoked; Vercel project linked, production env set, migrations run on production deploys; `suzu.one` attached to the project.
> **Done (on the branch):**
> - *Engineering:* CI workflow (dependency audit → typecheck → lint → tests → build); lint rules for module boundaries and for `env()`-only configuration; the permission matrix generated from the role catalogue into `docs/permission-matrix.md` and checked by a test.
> - *Scheduled jobs:* `job_run` log with overlap protection and stale-run takeover; `/api/cron/*` behind `CRON_SECRET`; two daily schedules in `vercel.json`; failures notify the Owners; Admin → Scheduled jobs. First job: the daily people roll-over (future-dated assignments reach `person`, pre-boarding people become active) — this closes Phase 1 gap 1.
> - *Admin screens:* entity edit and branches; departments and teams (with parent-loop and still-in-use guards); role grants (grant, revoke, last-owner guard, person notified); audit-log viewer scoped by `entityReach()`.
> - *Notifications:* in-app centre with unread badge; email through an outbox (Resend; retries, gives up after five attempts); per-category preferences with mandatory security notices; daily digest. In use for role changes, work-email changes (the old address is told too — closes Phase 1 gap 7), failed jobs and rule proposals.
> - *Files:* private Supabase Storage bucket, direct browser upload through signed URLs, type allowlist + size limit + magic-byte check on what actually arrived, one-minute download links, read-audit for restricted/compensation files, soft delete, abandoned-upload cleanup. Verified against the local Supabase stack (`tests/storage.integration.test.ts`).
> - *Encryption:* envelope encryption for restricted/compensation fields (per-value data key, AES-256-GCM, bound to its row and column, re-wrap for key rotation) and a blind index for look-ups; `docs/KEY_ROTATION.md`.
> - *Statutory parameter store:* typed catalogue (money in VND, rates in basis points), effective-dated versions with a database exclusion constraint, propose → owner decides (FR-PLT-39, new permission `rules:propose`), seeded from SRS Appendix A as **unverified** until confirmed.
> - *Feature flags:* rollout per everyone / entity / department / person; the People module is the first flagged module (HR and admins always see it).
> - *Import framework:* `.xlsx`/`.csv` → typed rows + every problem in one pass → stored preview → all-or-nothing commit by the same person within a day; generic wizard and CSV template; first import: departments.
> - *Error tracking:* `instrumentation.ts` logs every server error as one structured line (no query strings) and forwards to Sentry when `SENTRY_DSN` is set; localized error and not-found pages.
> **Verified locally:** signed-out redirects, forged cookie rejected, offboarded person locked out with a still-valid session; the real Google sign-in round trip (owner signed in with `khanh@suzu.vn`, 2026-09-19); every new action over HTTP as owner, HR admin, entity HR staff, finance, department head and employee (allowed and refused paths, audit entries); cron endpoints with and without the secret; file storage against the local stack; production build and a smoke test of it.
> **Not yet verified:** any screen in a real browser or on a phone (forms, the import wizard's file picker, the browser's direct upload to storage, error pages); email delivery through Resend; Sentry forwarding; the cron triggers on Vercel.
> **Needs the owner before it can go live:** DNS for `suzu.one`; `CRON_SECRET`, `DATA_ENCRYPTION_KEYS` (+ offline copy), `DATA_BLIND_INDEX_KEY` in Vercel; a Resend account with the `suzu.one` sender domain verified; optionally a Sentry project; confirm the Supabase integration exposes `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`; branch protection on `main` requiring the CI check; `pnpm db:seed` against production for the statutory parameters.
> **Still open in Phase 0:** virus scanning of uploads (no scanner chosen — files are marked `not_scanned`); a strict Content-Security-Policy (NFR-SEC-01); rate limiting on auth (NFR-SEC-03); step-up re-authentication for compensation screens (FR-PLT-06, needed by Phase 5); secret scanning in CI; preview deployments with a database branch and Playwright smoke tests; the working calendar and public holidays (moved to Phase 2 with attendance); Google Chat notifications (S); structured editors for statutory parameters instead of JSON (before Phase 5); list export (FR-PLT-37, with Phase 1).

**Scope:** FR-PLT-01..06, 10..14, 30, 32, 33, 35, 38 (store only) · FR-ACL-01..04 · NFR-SEC · NFR-OPS-04/05

| Week | Deliverables |
|---|---|
| 1 | Repo, tooling, CI pipeline, environments, Vercel + database provisioning, design-system shell (sidebar, command palette, light/dark, vi/en), Google Cloud project + OAuth client (External) on `suzu.one`, sign-in with `hd` allowlist, not-provisioned page, bootstrap owner |
| 2 | Org model (group/entity/branch/**shared departments**/team, effective-dated) with **editable seed entities and departments** (SRS D8), person + user linkage, RBAC (roles, scopes, tiers, incl. the restricted Collaborator role), `createAction()` pipeline, audit log, admin screens for entities, org and roles |
| 3 | Notifications (in-app + email), private file storage with signed URLs, statutory parameter store, import framework (Excel → validate → preview → commit), feature flags, error tracking, seed script for a realistic fake company |

**Exit criteria**
- A `suzu.vn` and a `suzu.group` account can both sign in; a personal Gmail account cannot; a deactivated user is signed out within one request.
- The permission-matrix test suite exists and runs in CI.
- Every mutation in the app so far appears in the audit log.

### Phase 1 — Core HR (4 weeks) → **M1**

> **Status, 2026-09-19 — week 1 built on branch `phase-1-core-hr` (not merged, not deployed).**
> **Done:** `core-hr` module — employment periods (one per person at a time, rehire-safe), effective-dated primary assignments (department, team, branch, position, job level, line and dotted-line manager, workforce type) with database exclusion constraints, shared position catalogue, per-entity employee-code numbering, personal-tier profile table, saved list views; people list with search, filters, given-name sorting and paging; add-person, edit and change-assignment forms; person page shaped by sensitivity tier; `tierReach()` (the list form of `readableTier`, matrix-tested against it); work email made optional (people without app access); local-only demo company (`pnpm db:seed:demo`).
> **Verified locally** as owner, entity HR, department head and plain employee: list and person-page tiers, hire, future-dated and corrected assignments, every rejection path, audit entries.
> **Tests:** pure engines, policy (incl. a matrix test that `tierReach` equals `canReadTier`), migrations, and service tests on PGlite that check the list SQL against the policy for every kind of viewer.
> **Known gaps:** (1) ~~future-dated assignments and start dates reach `person` only on the next save~~ — closed by the daily roll-over job on `phase-0-remainder`. (2) FR-CHR-01 is partly covered: education, certificates and photo are not modelled yet (~~emergency contacts, restricted fields~~ — closed in week 2). (3) No duplicate-person warning on add, and no rehire screen (the schema allows a second employment period). (4) No screen for the employee-code scheme (defaults to `<ENTITY>-0001`). (5) The list has no export yet (FR-PLT-37). (6) Forms show one message per failure, not per-field errors; not yet clicked through in a browser or checked on a phone. (7) ~~no notification when a work email is re-pointed~~ — closed on `phase-0-remainder`: the old address and the person are both told. (8) Secondary assignments have a schema but no screens. (9) Page `<title>`s are hard-coded English, as in Phase 0.
> **Week 2, 2026-09-19 — built on local branch `mvp` (not pushed, not deployed).**
> **Done:** *Restricted fields* (`person_sensitive`: citizen ID with issue date/place, passport, tax code, social insurance number, registered hospital, bank accounts) — envelope-encrypted per row and column, blind index on the citizen ID; the person page shows only which fields are filled, values arrive on an audited "Show" (`person.sensitive.read`), and the audit log records the names of changed fields, never values. *Contracts* (seven types, appendices, early termination, soft delete, encrypted salary terms, signed copy as a file) with a pure rules engine fed from the statutory store: fixed term ≤ 36 months, one fixed-term renewal then indefinite, probation length by job category, one probation per employment, no overlapping labour contracts. *Dependents* register (restricted tier; encrypted ID/tax code; deduction months; supporting papers). *Document vault* on the files module (signed-URL upload from the browser, tier fixed by category: ID scans and health checks restricted, signed contracts and decisions compensation, the rest personal; expiry dates). *Emergency contacts* (personal tier). *Daily `hr-alerts` job*: contract expiry 45/30/15 days, probation end 10/3 days, document expiry 30 days — thresholds are the new owner-approved parameter `hr.alert_thresholds`; idempotent through `hr_alert_sent`; new notification category "HR deadlines" (in-app + daily digest by default). *Key rotation*: the promised re-wrap job (`/api/cron/field-keys-rewrap`). Demo seed extended (contracts about to expire, restricted details, a dependent).
> **Decisions:** contract type, number and dates are *personal* tier (the line manager plans around them and is alerted); salary terms and signed copies are *compensation* tier. Writing a record takes `person:manage` **and** the right to read that tier — so entity HR staff (restricted) keep restricted records but cannot record salary terms or attach signed contracts; HR admin can (revisit if entity HR should file signed copies). Employees read all of their own records but change nothing directly — that is week 3's change requests. Alerts go to roles that name `person:manage` (HR) plus the line manager — not to owners, whose `*` would bury them; document-expiry alerts go to HR and the person, not the manager. Probation alerts come from probation *contracts*, not from the workforce type. No new RBAC permissions.
> **Verified locally** over HTTP as HR admin, entity HR staff, department head / line manager and the employee: page sections per tier; reveal allowed/refused with audit entries and no plaintext in the audit log; every contract rule rejection; out-of-scope and tier refusals; vault and signed-copy uploads end to end against local storage (wrong type, re-labelling a category and unconfirmed uploads refused; one-minute download; `file.read` audited); the alerts job through `/api/cron/hr-alerts` (first run sends, second run sends nothing); the re-wrap job. **Tests:** golden tests for the contract rules and the alert countdown; policy tests; PGlite service tests for the exit criterion — a line manager and a department head get no restricted fields, no dependents, no restricted/compensation documents and no salary terms, HR staff stop at restricted, encrypted columns hold no plaintext.
> **Not yet verified:** the forms and the browser's direct upload in a real browser or on a phone; email delivery of the alerts.
> **Needs the owner:** `pnpm db:seed` on production adds the `hr.alert_thresholds` parameter (without it the alerts job fails and says so); `DATA_ENCRYPTION_KEYS` and `DATA_BLIND_INDEX_KEY` must be set before anyone saves restricted details.
> **Deferred:** education and certificates as structured records (the vault holds the scans), photo, editing a contract in place (delete and re-enter), bank-account change verification (with change requests, week 3), denied audit entries do not name the target person (pipeline-wide), contract import (FR-PLT-36), document generation (FR-CHR-06, Phase 6).
> **Week 3, 2026-09-19 — built on local branch `mvp` (not pushed, not deployed).**
> **Done:** *Approval engine* (`src/modules/platform/approvals/`, first use): `approval_request` / `approval_step` / `approval_assignee` / `approval_event`; a pure, golden-tested flow state machine that already covers sequential steps, "any" and "all" steps, conditions on request data, return-for-changes + resubmit, withdraw and delegation; approver rules (line manager, N-th level manager, department head, role, permission holder, named person) turned into people at submission and snapshotted on the request; nobody approves their own request, and a step nobody can answer falls back to the owners; inbox `/approvals` ("waiting for me" with a badge in the navigation, "my requests"); new notification category "Approvals" (`approvals.requested`, `approvals.decided`). Request types are definition objects owned by their module, which also owns the decide action — the engine decision and the business effect run in one transaction. *ESS* `/me`: the signed-in person's whole record, read-only (restricted values through the audited reveal), not behind the People flag. *Change requests* (`profile_change`): phone, personal email, addresses, marital status, citizen ID (+ issue date/place), tax code, social insurance number and the pay bank account; personal values are stored as a before → after diff, restricted values only in the request's encrypted payload (names in the plain payload and the audit log); one open request per person; HR with `person:manage` over the person decides — approve applies the change in the same transaction, reject and return need a comment, the requester withdraws or corrects and resubmits; **a bank-account change cannot be approved without the approver confirming a second-channel check**, recorded on the decision; pending requests show on the person page for HR. *Org chart* `/people/org-chart`: built from line-manager links of active people, per entity or group-wide, collapsible, directory-tier fields only, dotted lines as a note. *Employee bulk import* `/people/import`: 28 columns (Vietnamese headers first), every problem in one pass (duplicates in the file and on the books — work email, employee code, citizen ID through the blind index; unknown entity/department/team; email domain; the importer's reach **per row**; manager not found / self / loop), all-or-nothing commit through the same code path as the hire form, managers from the same file linked in a second pass. The import framework gained `sensitive` columns: those cells are encrypted while a batch waits for its commit and masked in the preview. Demo seed: two pending change requests (personal, bank account).
> **Decisions:** the owning module owns the decide action (platform code cannot import feature modules) — Phase 2's bulk approve needs a type → definition registry at a composition root, noted in `engine/flow.ts`; withdrawing is generic (`approval.withdraw`). Approvers by permission are the roles that *name* it (HR), not the owners' `*`. Deciding a change request takes being asked by the flow **and** still holding `person:manage` over the person **and**, when the request carries restricted values, reading the restricted tier; a line manager can neither open nor decide one. An approved bank account becomes the first (pay) account, the others are kept. Restricted fields can be replaced through a request, not cleared. Name, date of birth, gender and work email stay HR-only corrections. The import adds new people only (no updates), does not take branches, dotted-line managers or passports, and stores the staged restricted cells encrypted rather than leaving them out, so the commit needs no second upload. The directory stays the tier-shaped people list; **phone stays personal-tier**, so neither the list nor the org chart shows it until the owner decides otherwise. No new RBAC permissions.
> **Verified locally** over HTTP as the employee (submits, is refused a second request, withdraws, resubmits after a return, cannot decide), entity HR staff (reveals and decides inside the entity; 404/forbidden for another entity's employee; refused a bank change without the confirmation), HR admin (decides with the confirmation; commits only own import batch) and the line manager / department head (request pages 404, decide / reveal / withdraw / import refused, no change-request section on the person page): `/me`, `/approvals`, request page, org chart (group and one entity), import stage with problems, stage + commit, second commit refused; audit entries for every step incl. `.denied`; notifications and outbox wording; no restricted plaintext in `approval_request`, `import_batch` or the audit log. **Tests (186):** golden tests for the flow engine and the org tree; policy tests; PGlite tests for the approval service through change requests (approver resolution, owner fallback, approve applies, reject, return + resubmit, withdraw, own request, non-assignee, bank verification, approver below the restricted tier, who may open and reveal) and for the import (one-pass problems, reach per row, commit, encrypted staging).
> **Not yet verified:** the forms in a real browser or on a phone; email delivery; an `.xlsx` employee file (CSV was used; the parser path is shared with the department import); the org chart with a few hundred people.
> **Needs the owner:** nothing new — `DATA_ENCRYPTION_KEYS` must be set before change requests with restricted fields or imports with restricted columns are used. HR should format phone columns as text in Excel (leading zero).
> **Deferred:** approval flows configurable per entity in the database, parallel steps, delegation and bulk-approve screens, SLA reminders (Phase 2: FR-PLT-20..24 — the state machine and tables are ready); comments on a request without deciding; change requests for dependents, emergency contacts and documents (HR enters them); showing restricted "before" values inside the request (the approver uses the audited reveal on the person page); import of updates to existing people, contracts and leave balances; a card-style directory and an opt-in work phone.

**Scope:** FR-CHR-01..05, 07..13 (M items) · FR-PLT-36/37 · FR-RPT-02 (headcount subset)

| Week | Deliverables |
|---|---|
| 1 | Person and employment records, workforce types, employee codes, effective-dated assignments, people list with filters and saved views |
| 2 | Contracts (types, rules, expiry and probation alerts), dependents, document vault, sensitive-field encryption and read-auditing |
| 3 | ESS profile + change requests (first use of the approval engine: single-step flows), directory, org chart, bulk import of all existing employees |
| 4 | Lifecycle events (hire, transfer, promotion, termination), onboarding/offboarding checklists (first use of the task engine: checklist tasks), headcount reports, UAT and data migration |

**Exit criteria**
- 100% of current employees imported and verified by HR for every entity.
- HR confirms the employee spreadsheet is no longer the source of truth.
- A line manager cannot see restricted or compensation fields (verified by test and by UAT).

Deferred to later phases: document generation from templates (FR-CHR-06, Phase 6), skills inventory (FR-CHR-14, Phase 3), headcount planning (Phase 7).

### Phase 2 — Attendance & leave (5 weeks) → **M2**

**Scope:** FR-ATT-01..04, 06, 08..12, 14, 15, 17, 18 · FR-LVE-01..05, 07, 08 · FR-PLT-20..22 (approval engine full) · PWA shell

| Week | Deliverables |
|---|---|
| 1 | Approval engine v1 complete (multi-step, rule-based approvers, conditions, delegate, bulk approve); working calendars, holidays, schedules and shifts, **untracked working days (Saturday WFH auto-credit, FR-ATT-17)** |
| 2 | Leave: types, policies, entitlement and accrual engine (pure, tested), ledger, request flow, team calendar |
| 3 | Check-in/out PWA flow (GPS geofence, IP/Wi-Fi rules, flagging), installable PWA, push notifications, "who's in today" |
| 4 | Device log import with mapping profiles; merge rules; daily timesheet engine (pure, tested: late/early/missing/OT/overnight shifts) |
| 5 | Correction, WFH/off-site, OT and **holiday/rest-day work requests (FR-ATT-18)**; monthly timesheet confirm → approve → lock; HR anomaly console; UAT with the pilot department |

**Exit criteria**
- The pilot department runs a full month; the locked timesheet matches HR's manual check for a sample of at least 20 people.
- The leave-balance ledger reconciles with imported opening balances.
- Check-in p95 is under 3 s during the morning peak.

Rollout: pilot department (2 weeks), then pilot entity, then the group. Direct device API integration (FR-ATT-07) is scheduled after the device models are confirmed (Q5). File import covers the gap.

### Phase 3 — Work management + Operations & compliance tracker (5 weeks) → **M3**

**Scope:** FR-WRK-01..03, 05 (list/board/calendar), 06..11, 17, 18 · FR-OPS-01..05, 07..09 · then S items as time allows (FR-WRK-04, 12, 13, 16; FR-OPS-06, 10)

| Week | Deliverables |
|---|---|
| 1 | Task engine v2: teams, projects, tasks/sub-tasks, custom workflows, labels, client/brand, priorities, dependencies; list view with fast filtering; quick-create and command palette |
| 2 | Board (drag and drop, optimistic updates), calendar view (content calendar), comments/mentions/activity, attachments + Drive links, notifications and digest |
| 3 | Review/approval step with deliverable versions; task and project templates (seed: monthly social retainer, video production, KOL campaign, event); recurring tasks; **My work** inbox; leader view |
| 4 | Ops tracker: obligation templates with due-date rules and holiday shifting, per-entity instance scheduler, evidence-required completion, event-driven obligations from HR events (incl. the monthly payroll calendar: lock by the 2nd → propose by the 3rd → CEO signs by the 4th → pay on the 5th), seed library workshop with the chief accountant and HR lead |
| 5 | Compliance calendar and dashboard (entity × month), escalation chain, history/archive; workload view with leave overlay; intake forms; UAT with two creative teams + finance |

**Exit criteria**
- Two creative teams and the HR/finance team run their real work in the system for two weeks.
- Common task interactions feel instant (optimistic UI; p95 server round-trip under 300 ms).
- The obligation library has been reviewed by the chief accountant and the HR lead, approved by the owner, and the next three months of instances have been generated for every entity.

Timeline/Gantt, time logging, cycles and project dashboards follow as incremental releases during phases 4–6.

### Phase 3.5 — OKRs & KPIs (2 weeks) → **M3.5**

**Scope:** FR-PRF-01, 02 (moved forward; see the note in §1)

| Week | Deliverables |
|---|---|
| 1 | Goal tree (group → entity → department → team → individual), key results with metric types, weekly check-ins with confidence, progress roll-up, alignment view |
| 2 | KPI library per position with weights and targets, monthly/quarterly actuals entry (by manager or HR, with import), computed KPI score per person per period, manager and owner dashboards |

**Exit criteria**
- 2027 company and department OKRs are entered, and every employee has individual goals or KPIs assigned.
- The KPI score for the first closed month is computed and checked by HR against their manual calculation.

### Phase 4 — Knowledge base + internal comms (3 weeks) → **M4**

**Scope:** FR-KB-01..06 · FR-COM-01, 02 · S items: FR-KB-07..10, FR-COM-03, 04

| Week | Deliverables |
|---|---|
| 1 | Spaces, page tree, block editor (tables, callouts, embeds, attachments), permissions, version history |
| 2 | Publish workflow for controlled spaces, policy acknowledgement with audience targeting and reminders, Vietnamese-aware full-text search, templates, Google Docs/Markdown import |
| 3 | Announcements (targeted, scheduled, read tracking), home feed (joiners, birthdays, anniversaries, new pages), kudos, pulse survey v1; content migration sprint with HR |

**Exit criteria**
- The employee handbook and the top 20 SOPs are published.
- Policy acknowledgement is tracked for all staff.
- Onboarding checklists link to KB pages.

Embeddings for every page are generated from this phase on, so the AI assistant in Phase 9 starts with a full index.

### Phase 5 — Payroll (6 weeks build + 2 months parallel run) → **M5**

**Scope:** FR-PAY-01, 02, 04, 07, 08, 10..17, 19, 20, 30..35, 38 · FR-PLT-39 · then FR-PAY-03 (converter tool), 05, 06, 18, 36, 37. FR-PAY-21 (year-end bonus scheme) is built in Phase 8.

**Pre-work during phases 3–4 (no dev time):** HR supplies the last 3 months of the real payroll Excel files per entity. These become the anonymised **golden test cases**. The owner confirms the pay rules they encode (SRS D17: the owner decides the rules), and Appendix A values are verified with the chief accountant.

| Week | Deliverables |
|---|---|
| 1 | **Pay profiles (Statutory / Simple, SRS D18)**, pay component catalogue, salary structures (effective-dated, encrypted), salary change flow, safe formula language, statutory parameters loaded and signed off |
| 2 | **Payroll engine core** (pure library): timesheet inputs → pro-rating → earnings → insurance (caps, edge cases) → PIT (progressive, dependents by month, exemptions) → net; explanation trace per line; golden tests |
| 3 | Flat-rate PIT cases (CTV, non-resident), OT and holiday-work pay, retro items, off-cycle bonus runs, net→gross converter tool for offers; property-based tests (e.g. net ≤ gross, converter round-trips) |
| 4 | Run lifecycle per SRS D17 — draft → calculated → **proposed (HR lead)** → **approved (CEO)** → **payment prepared (chief accountant)** → paid → locked — as a durable background job with progress; variance checks; payroll calendar targeting payment on the 5th; period locking; owner approval for rule changes (FR-PLT-39) |
| 5 | Payslips (ESS, PDF, payslip query), **VCB and ACB bulk-transfer files**, **cash payment sheet with disbursement and receipt confirmation for the Simple pay profile (FR-PAY-39)**, payroll register and cost reports, insurance and PIT summaries |
| 6 | Statutory exports (insurance increase/decrease data, PIT declaration and finalization data), YTD import, **parallel-run mode with a per-person reconciliation report**, security review of the payroll module |

**Parallel run (2 payroll cycles, overlapping phases 6–7):** the system and the existing method both run. Every difference is investigated and classified as a system bug, a spreadsheet error or a rule gap. Go-live requires one full cycle with **zero unexplained differences** for every entity and sign-off from the owner, with the HR lead and chief accountant confirming the figures.

**Exit criteria**
- The golden tests match the existing Excel payroll to the đồng (or the difference is a confirmed Excel error).
- A parallel cycle completes with zero unexplained differences.
- Payslip access is verified: self, C&B and owner only.
- A penetration-style review of the compensation endpoints is done.

### Phase 6 — Assets & requests (3 weeks) → **M6**

**Scope:** FR-AST-01, 02 · FR-REQ-01, 02 · FR-CHR-06 · S items: FR-AST-03..05, FR-REQ-03, 04 · FR-PLT-23, 24, 31

| Week | Deliverables |
|---|---|
| 1 | Generic request builder (form designer + flow designer on the approval engine), seed request types, approve-from-notification deep links, Google Chat notifications, SLA reminders and escalation |
| 2 | Asset register, QR labels, assignment/handover/return tied to onboarding/offboarding, import |
| 3 | Production equipment booking calendar, licence/subscription tracking (renewals feed the ops tracker), expense claims, document generation from templates (contracts, decisions, confirmation letters) |

**Exit criteria**
- Every current employee's equipment is recorded.
- Purchase, payment and confirmation-letter requests run in-system.
- HR generates contracts from templates.

### Phase 7 — Recruitment / ATS (4 weeks) → **M7**

**Scope:** FR-REC-01..06, 08, 09, 13 · S items: FR-REC-07, 10, 11 · FR-CHR-17

| Week | Deliverables |
|---|---|
| 1 | Hiring requests + approval, job openings, configurable pipelines, candidate database with duplicate detection |
| 2 | Public careers page + application form (portfolio links, consent notice, spam/rate limiting), email templates, kanban pipeline |
| 3 | Interview scheduling with Google Calendar/Meet (incremental OAuth scopes), scorecards with blind feedback, assignments |
| 4 | Offer approval + offer letter, convert to pre-boarding employee, referral programme, funnel reports, candidate retention/purge job |

**Exit criteria**
- One real opening runs end to end: application → interviews → offer → employee record, with no retyping.

### Phase 8 — Performance reviews + year-end bonus (3 weeks) → **M8**

**Scope:** FR-PRF-03, 08, 09 · FR-PAY-21 · S items: FR-PRF-04, 06, 07 (goals and KPIs already shipped in Phase 3.5)

| Week | Deliverables |
|---|---|
| 1 | Review cycle builder: form templates, participants, timeline, self + manager review, confidentiality rules |
| 2 | Peer/360, release and acknowledgement, evidence panel (goals, KPI scores, task stats, kudos, attendance); **final performance result per person per year** with configurable weighting, owner override with reason, lock and publish |
| 3 | **Year-end bonus scheme**: formula and multiplier bands, cost simulation, HR proposal → owner adjustments → CEO approval → off-cycle payroll run; 1:1 notes with action items → tasks; outcomes → lifecycle proposals |

**Exit criteria**
- The 2027 annual review runs in-system.
- The 2027 year-end bonus is simulated, approved and paid through an off-cycle payroll run, with each person's amount traceable to their KPI/OKR results and any owner override.

This phase must be live by **November 2027** to serve the year-end review and the bonus paid before Tết 2028.

### Phase 9 — AI assistant + analytics (3 weeks) → **M9**

**Scope:** FR-AI-01, 02, 06 · FR-RPT-01 (v2), 04, 05 · C items as time allows

| Week | Deliverables |
|---|---|
| 1 | Retrieval over the KB with permission filtering and citations; chat UI; vi/en; unanswered-question log; evaluation set of ~100 real HR questions |
| 2 | Permission-checked personal tools (leave balance, payslip explanation, approver lookup, attendance summary); guardrail tests (no cross-user leakage); audit logging of tool calls |
| 3 | Owner dashboard v2, scheduled reports, work analytics; optional drafting helpers and confirm-to-act shortcuts |

**Exit criteria**
- At least 85% of the evaluation set is answered correctly with a correct citation.
- A red-team test shows no cross-user or compensation leakage.

### Phase 10 — CRM

A separate SRS will be written near the end of Phase 8. It will reuse org, RBAC, the approval and task engines, clients/brands from the Work module, files, notifications and AI. The target outcome is deal → project → tasks → time → cost → **client profitability**.

---

## 4. Quality plan

| Area | Approach |
|---|---|
| **Engines** (payroll, timesheet, leave accrual) | Pure libraries; golden-file tests from real anonymised cases; property-based tests; every statutory change adds a dated test case |
| **Permissions** | A matrix test generates every role × scope × resource × action combination and asserts allow/deny; it runs in CI; new resources must register in the matrix |
| **Integration** | Service-level tests against real Postgres with transaction rollback |
| **End-to-end** | Playwright for critical journeys: sign-in (both domains + rejected Gmail), check-in, leave request → approve, timesheet lock, payroll run → payslip, task create → review → done, obligation complete with evidence |
| **UAT** | Each phase ends with a scripted UAT with named business owners (HR lead, chief accountant, two team leaders) on staging with anonymised data |
| **Security** | Dependency + secret scanning in CI; security review at M1 (auth/RBAC), M5 (payroll), M7 (public surface), M9 (AI) |
| **Performance** | Load test of the check-in peak and the payroll job before M2 and M5 |
| **Definition of done** | Requirement implemented · tests pass · vi + en strings · audit events emitted · permission matrix updated · mobile checked · docs/KB help page written · feature flag plan |

---

## 5. Rollout & change management

1. **Champions**: one HR champion, one finance champion, and one leader per creative team. They join UAT and train their teams.
2. **Pilot then expand** per module (department → entity → group) via feature flags.
3. **Help content lives in the KB** (from Phase 4; before that, short Google Docs). Each release gets a two-minute screen recording.
4. **Feedback channel**: an in-app "Report a problem / suggest" button creates a task in the product backlog project (available from Phase 3).
5. **Cut-over rules**: each milestone has an explicit date after which the old method (spreadsheet, chat approval, paper form) is no longer accepted — announced by the owner.
6. **Payroll** is the one module with a mandatory parallel run and written sign-off.

---

## 6. Risks

| # | Risk | Impact | Mitigation |
|---|---|---|---|
| R1 | Payroll calculation errors | Wrong pay, tax exposure, loss of trust | Pure engine + golden tests + 2-cycle parallel run + accountant sign-off; explanation trace on every payslip line |
| R2 | Legal parameters change (this happened twice in 2026: PIT reform, reference-level increase) | Incorrect statutory amounts | Effective-dated parameter store; "annual legal review" and "on-change" obligations in the ops tracker itself; nothing hard-coded |
| R3 | Personal-data compliance (PDPL, cross-border hosting). The owner chose Singapore hosting and deferred the legal work (SRS D10) | Legal exposure | Tracked as open item Q16; close it before payroll data goes live; portable architecture; consent/notice flows; retention jobs |
| R4 | Scope is very large for an owner + Claude Code team | Delays, half-finished modules | Strict phase exit criteria; M-priority first; S/C items deferred; re-baseline after Phase 1; the owner's build time is the critical resource — protect it |
| R5 | Low adoption of task management (teams stay on chat/Trello) | Wasted build | Build with two pilot teams; speed and mobile UX are requirements, not extras; owner-announced cut-over; templates that match real workflows |
| R6 | Biometric device integration varies by model | Attendance gaps | File import first (works with any device); direct integration only after models are confirmed |
| R7 | Two-workspace Google setup friction (consent screens, calendar scopes) | Login/integration issues | External OAuth client, both admins trust the app, incremental scopes, tested with accounts from both domains in CI |
| R8 | The owner is the only developer | Bus factor; the owner's time competes with running the company | Documented ADRs, conventional structure, high test coverage, runbooks, infrastructure as configuration |
| R9 | Sensitive-data leak via exports, search or AI | Severe | Tier-aware authorization at the service layer, used by all three; audit of reads; red-team tests at M5 and M9 |
| R11 | Employees on the Simple pay profile (cash, no insurance/PIT) who legally fall under compulsory insurance or PIT withholding | Back-payments, penalties and interest if inspected; disputes when a person claims insurance benefits | Basis recorded per person and owner-only exposure report (FR-PAY-08); review with the chief accountant; nothing is hidden from reports |
| R10 | Data migration quality | Bad starting data breaks trust | Import with validation preview; HR verifies per entity; ESS change requests let employees fix their own data |

---

## 7. Immediate next steps

| # | Action | Who |
|---|---|---|
| 1 | Start Phase 0: scaffold the Next.js app, tooling, database schema for org/auth/RBAC/audit, sign-in with the two-domain check, app shell | Owner + Claude Code — **in progress** |
| 2 | Create the Google Cloud project and an **External** OAuth client; authorised redirect URIs for `http://localhost:3000` and `https://suzu.one`; put the client ID/secret in `.env.local`; ask both Workspace admins to mark the app as trusted | Owner |
| 3 | Create the Supabase project (Singapore) and the Vercel project; point `suzu.one` at Vercel | Owner + Claude Code |
| 4 | Replace the seed entities and departments with the real ones in the admin screen (available at the end of Phase 0) | Owner |
| 5 | Nominate two pilot team leaders for the Phase 2 and Phase 3 pilots | Owner |
| 6 | HR starts filling the employee import template (available in Phase 1, week 3) and collecting 3 months of payroll Excel files for the golden tests | HR lead |
