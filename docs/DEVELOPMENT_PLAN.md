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

> **Status, 2026-09-19.**
> **Done:** Next.js 16 scaffold and tooling (`pnpm check`); schema + migrations for auth, entities/branches/shared departments/teams, person, role assignments, audit log (append-only trigger); Google sign-in with the two-workspace rules (`sign-in-policy.ts`, tested); per-request access re-check with session revocation; RBAC policy (role × scope × tier, tested); `createAction()` pipeline with audit; vi/en i18n; app shell, home, entities admin (list + create); seed data; security headers; local Supabase stack in Docker; row-level security on every table with the Supabase API roles revoked; Vercel project linked, production env set, migrations run on production deploys; `suzu.one` attached to the project.
> **Verified locally:** signed-out redirects, forged cookie rejected, signed-in home and entities pages, offboarded person locked out with a still-valid session.
> **Not yet verified:** the real Google OAuth round trip (needs the OAuth client), and the create-entity form in a browser.
> **Remaining in Phase 0:** DNS for `suzu.one` (owner), CI workflow, entity/department edit screens, role-assignment admin, audit-log viewer, notifications, file storage, statutory parameter store, import framework, feature flags, error tracking, permission-matrix test generator.

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
