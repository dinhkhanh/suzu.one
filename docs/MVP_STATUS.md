# MVP status — phases 0–9

*Written 2026-09-20, at the end of Phase 9. Companion to `docs/DEVELOPMENT_PLAN.md` §3, which holds the full per-phase status notes; this file is the short version plus the one list the owner needs: **§4, Needs the owner**.*

---

## 1. Where the code is

Phases 1–9 are built on **local branch `mvp`** (stacked on `phase-0-remainder`). **Nothing is pushed. Nothing is merged into `main`. Nothing is deployed.** Only the first part of Phase 0 is live on `main`.

`pnpm check` (2,512 tests) and `pnpm build` pass on `mvp`. Migrations 0001–0073 are applied to the local Docker database. All are backward-compatible with the deployed code except **0072**, which rebuilds the org structure as one tree (§5b): it renames `department`, folds `team` into it and rewrites the role scopes and audience keys, so the code and that migration must ship together.

**To get this in front of anybody:** open a pull request from `mvp`, read the diff, merge, and let the `main` deploy run the migrations — after working through §4.A below.

## 2. What is built

| Phase | Modules | Migrations | Tests (cum.) |
|---|---|---|---|
| 0 Foundation & platform | auth (Google, two domains), org, RBAC, audit, files, notifications, approvals engine, task engine, jobs, feature flags, import/export, PDF | 0001–0017 | — |
| 1 Core HR | `core-hr` — employment periods, effective-dated assignments, encrypted restricted fields, change requests, onboarding checklists, import | — | 225 |
| 2 Attendance & leave | `attendance`, `leave` — calendars, schedules, check-in, timesheets, corrections, OT, leave types, balances, accrual | 0018–0027 | 479 |
| 3 Work + Ops tracker | `work`, `ops` — teams, projects, workflows, tasks, reviews; obligation library, calendar, evidence | 0028–0033 | 668 |
| 3.5 OKRs & KPIs | `performance` — goal tree, KPI library, monthly scoring | 0034–0036 | 742 |
| 4 KB + internal comms | `kb`, `comms` — spaces, page tree, Tiptap editor, versions, publish workflow, acknowledgements, search, chunks + embeddings; announcements, kudos, feed | 0037–0043 | 857 |
| 5 Payroll | `payroll` — pay profiles, pure engine, run lifecycle, payslips, PDF, bank and statutory files, step-up re-auth | 0044–0051 | 1,495 |
| 6 Assets & requests | `assets`, `requests` — generic request builder, expense claims, asset register, QR labels, bookings, licences, generated documents | 0052–0059 | 1,794 |
| 7 Recruitment / ATS | `recruit` — hiring requests, openings, pipeline, public careers page, interviews, offers, referrals | 0060–0065 | 2,130 |
| 8 Performance reviews + bonus | `performance`, `payroll` — review cycles, peer/360, evidence panel, final yearly result, year-end bonus scheme and run, 1:1 notes | 0066–0068 | 2,383 |
| 9 AI assistant + analytics | `ai`, `reports` — Ask SuZu (KB retrieval with citations, four personal tools), owner dashboard v2, scheduled reports, work analytics | 0069–0071 | 2,498 |

Phase 10 is projects & daily work management (PJM, SRS §4.6b). Phase 11 (CRM) is **not started** and needs its own SRS.

## 3. The shape of the thing, in one paragraph

A modular monolith: Next.js 16, Drizzle + Postgres (Supabase), Better Auth with Google and a two-domain check. Business logic lives in `src/modules/<module>/`; `src/app/` holds routes only. Every mutation goes through `createAction()` — parse → authenticate → authorize → run → audit — so nothing writes without leaving a record. Authorization is `can()` / `readableTier()` with four sensitivity tiers, deny by default, and **line managers never see compensation**. Payroll, timesheet, leave accrual, bonus and analytics calculations are pure functions with golden tests. Money is integer VND; legal rates, caps, brackets and holidays are effective-dated configuration, never constants. Every table has RLS enabled with no policies — the app connects as the owner and Supabase's public API roles see nothing.

**Everything that needs an outside account sits behind an adapter with a local driver**, so the whole system runs on a laptop with no keys at all. Those adapters are §4.B.

## 4. Needs the owner

*Ordered by what must happen first. Each item was recorded by the phase that hit it; the phase's own status note in `DEVELOPMENT_PLAN.md` has the detail.*

### A. Before anything can run in production

1. **DNS** for `suzu.one` pointed at Vercel. Confirm the Supabase integration exposes `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`.
2. **Secrets in Vercel:** `CRON_SECRET` (without it every scheduled job refuses to run), `DATA_ENCRYPTION_KEYS` **and an offline copy of them** — losing these keys loses the encrypted personal data permanently — and `DATA_BLIND_INDEX_KEY`. Both must exist before anybody saves a restricted field or runs an import with restricted columns.
3. **Google Cloud project and an *External* OAuth client.** Authorised redirect URIs for `http://localhost:3000`, `https://suzu.one` **and `<BETTER_AUTH_URL>/api/step-up/callback`** — without the third, step-up re-authentication fails and nobody can open a payroll screen. Both Workspace admins mark the app as trusted.
4. **Branch protection on `main`** requiring the CI check.
5. **`pnpm db:seed` against production.** This is not optional: it seeds statutory parameters, holidays, the default schedule, leave types (including `COMP` — a timesheet lock that carries time off in lieu fails without it), the attendance policy, clock profiles, `work.night_window`, `hr.alert_thresholds` (the alerts job fails without it), starter checklists, work templates, the obligation library, the starter KPI library, KB templates, company values, starter pay components, the group pay policy, request types and document templates.
6. **Role grants where the catalogue defaults do not fit.** At minimum, decide: should `hr_staff` hold `report:read`? Who holds `asset:manage` — **no HR role carries it**? Who holds `kb:manage` / `comms:manage`? Who holds `payroll` / `finance` / `c_level`? Should `hr_staff` be able to see a salary band (today: no)?

### B. Accounts and keys — every one of these has a working local fake today

| What | Environment variables | What happens without it |
|---|---|---|
| **Outgoing email** (Resend) | `RESEND_API_KEY`, `EMAIL_FROM` | Every email is written to the outbox and marked `skipped`. **No candidate has ever actually been written to, and no scheduled report has ever reached a mailbox.** |
| **Web push** | `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` (`pnpm push:keys`) | Pushes are recorded "simulated"; browsers cannot subscribe at all. Needs one real phone test — iOS only pushes to the installed app. |
| **The assistant's model** (Claude API) | `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` | The local extractive driver: answers are the knowledge base's own passages, never generated prose. **Driver written, never run.** Also switch on **zero data retention** on that account — FR-AI-06 requires it and the code cannot assert it. |
| **KB embeddings** (Voyage AI) | `EMBEDDINGS_API_KEY`, `EMBEDDINGS_MODEL` | A deterministic local fake, so retrieval is effectively lexical and English questions about Vietnamese pages are weak. **Driver written, never run.** Re-embed after the key, then re-run `pnpm ai:eval`. |
| **Google Chat** approval cards | `GOOGLE_CHAT_WEBHOOK_URL` | Cards recorded "simulated". |
| **Google Calendar / Meet** for interviews and project meetings | `GOOGLE_CALENDAR_ID`, `..._SERVICE_ACCOUNT_EMAIL`, `..._SERVICE_ACCOUNT_KEY`, `..._IMPERSONATE` | The adapter is `src/modules/platform/calendar/`. Internal event and `.ics` only, no Meet link, and both screens say `simulated` out loud. **Driver written, never run** — needs a service account with domain-wide delegation. |
| **Virus scanning** | — | **There is none.** Every CV and take-home is stored `not_scanned` and reachable only by the hiring team. That is a mitigation, not a solution. |

### C. Confirmations by a qualified person — these block go-live, not just polish

1. **The chief accountant must verify every Appendix A statutory value**, including `union.dues_cap`, `insurance.unpaid_leave_threshold` and `pit.overtime_exemption`. **All of them are seeded `unverified`.**
2. The accountant also confirms `leave.annual`, `overtime.caps`, `overtime.multipliers`, `work.night_window`, and that `EXPENSE_REIMBURSE` is exempt from tax and insurance.
3. **Every assumed file column must be confirmed**: the VCB and ACB payment layouts, D02-LT's change codes TM/TL/GH/KL/OF, and the PIT indicator numbering [21]–[37] — indicator [37] has no register and HR fills it by hand.
4. **The five document templates, their letterheads and the `TM-NHAN-VIEC` offer letter are drafts nobody qualified has read.** They say so in their own text. Phase 6's exit criterion 3 is not met until a lawyer or HR lead has.
5. **The chief accountant and the HR lead must review every obligation template** in the ops library — due rules, authorities, evidence, and which VAT/PIT variant applies per entity — and the owner marks each reviewed on `/ops/templates`. The entire library is seeded `unreviewed`.
6. **PDPL and cross-border hosting** (SRS D10, open item Q16). Close it **before payroll data goes live**.
7. **The careers page is public and indexable** — the only thing on suzu.one that is; the owner decided (2026-09-24) that everything else stays out of search engines (`X-Robots-Tag` in `next.config.ts`). Confirm: the 12-month candidate retention window, the rate limits (6 applications / 60 form loads per hour), the consent wording, and the referral bonus rule.
8. A note the accountant should see: a month of unpaid leave **just under** the 14-day threshold still carries a full insurance contribution, so a person can end the month owing the company. That is the law as seeded; it is flagged, tested and documented.

### D. Real data the system cannot start without

1. Replace the seeded **entities, branches and departments** with the real ones (the admin screens exist).
2. Run the **real employee import** and have HR verify it per entity — Phase 1's exit criterion, and nothing downstream is trustworthy without it. Format phone columns as text in Excel so the leading zero survives.
3. Real **leave opening balances**, through the same import.
4. **The last three months of real payroll Excel per entity**, anonymised into `payroll/engine/golden/`, one file each. Until then the golden tests are placeholders and the parallel run has nothing to compare against.
5. Each entity's **wage region and paying bank account**; each person's **bank account and tax code** (the variance check lists who is missing one).
6. Real **office coordinates and public IPs** per entity; the **clock models and their export formats**, then the mapping profiles adjusted.
7. An import file of the **assets the company actually owns**, with serials and purchase prices.
8. **The real employee handbook and the top 20 SOPs** in the knowledge base — Phase 4's exit criterion; the demo pages are samples. Decide which policies are must-read, for whom, and the due period. The real company values for kudos. Then re-add the production onboarding checklist items with their KB links (items cannot be edited in place). **The assistant's 160-question evaluation set is written against the demo pages and must be rewritten against the real ones before its score means anything about the real company.**
9. The real **2027 group, entity and department OKRs** and each person's goals or KPIs — Phase 3.5's exit criterion. Every seeded target, cap, floor and weight is a placeholder.
10. A real **bonus scheme version** and a real **performance weighting version**, approved. The seeded ones are placeholders and SRS Q14 is only provisionally answered by them.
11. Real **teams, workflows, clients and project templates**, run by **two pilot teams for two weeks** — Phase 3's exit criterion. Nominate the two team leaders.
12. Designed **app icons**.

### E. Per-entity settings to decide

Grace, rounding and OT rules · the monthly correction cap (default 3) · whether corrections or holiday work need an HR step · proration basis · union on or off · the Simple-profile PIT treatment · the payroll variance threshold and the pay day · the payroll-calendar days and who signs · the people behind ops owner/reviewer rules where the role default picks the wrong person · whether `work:manage` holders or the owner may open private projects (today: no — and this now shapes the work analytics report too) · whether a scheduled report's recipient who is not its creator may see the schedule (today: no).

### F. Rules chosen without you, which you should confirm or overrule

Each was decided so the build could continue, and each is recorded in its phase's status note.

- **Attendance & leave:** insurance is never pro-rated; coverage is decided by the 14-day test.
- **Payroll:** the month's standard days as the divisor; the last segment's insurance base; OT taken as time off in lieu split proportionally across categories; C&B rather than the accountant locks the period; approval thresholds (CEO above 20,000,000 ₫), the 90-day claim age limit, the 500,000 ₫ receipt rule, 14 days' licence lead time.
- **Performance:** a missing actual at an overridden close scores 0; attainment capped at 120%; lower-is-better scored as target ÷ actual; the annual figure weighted by months covered; nobody enters their own actuals, not even the owner; individual goals are hidden from colleagues; eligibility for the bonus is three months' service, collaborators out, employment on 31 December; the CEO may read the bonus run register but not one person's amount.
- **Knowledge base & comms:** birthdays shown to all staff as day and month; re-acknowledgement only after a major revision; reminders every three days; department heads may announce to their own department.
- **The assistant:** everybody may ask and no role grants it anything — what it can answer is decided per asker by the access rows already in the database; a tool is only ever about the asker; the payroll cost report may never be emailed; scheduling grants nothing you could not already read.

## 5. What is deferred

Nothing here blocks go-live; all of it was consciously left out.

- **Phase 1:** education and certificates as structured records, photos, editing a contract in place, bank-account change verification, contract import.
- **Phase 2:** SLA escalation, approve-from-email, selfie at check-in, direct clock-device integration, late/early penalties, business trips with per diem, Google Calendar out-of-office, the leave liability report.
- **Phase 3:** custom fields, timeline/Gantt and table views, bulk edit, time logging, cycles, project dashboards.
- **Phase 3.5:** weekly check-in reminders, an HR approval step for actuals, per-month target overrides, CSV export of scores.
- **Phase 4:** pulse surveys, kudos points and a leaderboard, page feedback and comments, learning paths, an @mention picker.
- **Phase 5:** probation ≥ 85% enforcement, salary advance runs, final settlement on termination, the accounting journal export, CTV payment runs, official `.xlsx` bank and statutory layouts (CSV today).
- **Phase 6:** the maintenance and incident log, asset photos, per-category expense caps.
- **Phase 7:** AI CV parsing and JD drafting, a pipeline editor screen, an interview-kit editor, cost per hire, the offer email to the candidate.
- **Phase 8:** a structured band-table editor for the bonus scheme (JSON today, fully validated), calibration sessions as their own screen, training completion in the evidence panel.
- **Phase 9:** **FR-AI-03 confirm-to-act shortcuts and FR-AI-04 drafting helpers were not built** — both C items, neither was nearly free. Also FR-AI-05 (natural-language questions over reports), manager-scope tools, streaming answers, feedback on an answer, pgvector with an HNSW index, and `.xlsx` scheduled reports.
- **Phase 11 (CRM):** not started; it needs its own SRS.

## 5b. Built after the MVP: nested org units and unit-owned KB spaces

**SRS D19, D20, FR-PLT-16, FR-KB-13..16 — built 2026-09-21 on branch `mvp`.** "Team" in this company means a group at any level — department, big team, small team — so the two flat levels became one tree, and a unit may now keep a knowledge base and documents of its own, run by its head rather than by HR.

**Done.** `department` and `team` are one `org_unit` table whose rows nest to any depth (migration 0072). The rename and the fold-in keep every id, so every `department_id`, `team_id`, subject key and role-grant `scope_id` still points at the same unit — nothing had to be re-entered. Two derived things carry the tree, both written by database triggers and never by the application: `org_unit.path` (the unit and its ancestors) and, on `person`, `org_unit_path` plus the `department_id` / `team_id` the reports still group by — the deepest unit of each kind on the chain. Moving a unit rewrites all of them for the whole subtree, people included. The scope `department` | `team` became one `unit` scope that **covers everything below it**: `loadGrants` widens a unit grant to its subtree once per request, so a check with one unit id is correct wherever the chain is not at hand. Access rows, acknowledgement audiences and announcement audiences use `unit:<id>` (the subtree) and `unit_only:<id>` (that unit alone, the deliberate narrowing); the migration rewrote the existing `department:` / `team:` keys. A schedule set on a unit now reaches the units below it, and the deeper unit wins. `/admin/org` is a tree editor: one form for every level, "add a unit inside this one", and a move that is refused if it would put a unit inside itself (in the service and again in the database). The placement fields on hire and reassignment are one unit picker. **Unit spaces (FR-KB-13):** `kb_space.owner_unit_id`, a new permission `kb:manage_unit` (c_level, entity_director, department_head), at most one space per unit, an access row for the unit written on creation, and the heads above inheriting the head's rights while `kb:manage` still reaches everything. **Unit documents (FR-KB-15):** every file in a space in one list, permission-filtered by the same SQL as the page tree.

**Verified** on the real local database and over HTTP with forged sessions: migration 0072 applied to a populated database (11 units, 20 people placed, the department-scoped grants and KB rows rewritten, no person left without a derived department); a small team created inside a department, a person moved into it, the department head's unchanged grant reaching it, and a move of that team to another department taking its person's whole chain and department with it. As a department head: `/admin/org` readable but not editable (no `org:manage`), `/kb` offering a space for their own unit, the create action allowed for a unit below them and refused for another department's unit, for a company-wide space, and for a second space on the same unit. Reading the finished team space: its member and the head above see it, a colleague in the same department but not in the team gets 404, HR sees it. The documents list shows a page's file to the team and not to that colleague. **A bug found this way:** `stored_file.owner_id` is `text`, so the new file query needed an explicit cast — the unit tests never saw it because they have no files.

**Not verified:** anything in a browser, as with the rest of the MVP. `pnpm db:seed:demo` now creates a "Hậu kỳ" team inside the video department, with a space its lead runs, but the demo has only been re-seeded from an empty database in tests, not against a running local stack.

**Needs the owner:** the real shape of the tree — which departments hold which teams, and how deep — since the migration leaves every existing department at the top level; and which heads get `department_head` grants on which units, because that grant is now what lets someone run their team's own knowledge base.

## 5c. Phase 10: projects & daily work management (PJM)

**Built 2026-09-22/23 on branch `phase-10-pjm`** (SRS D21, §4.6b; plan and full status in `DEVELOPMENT_PLAN.md` Phase 10). The app becomes the system of record for daily work: project briefs with a kick-off gate, job numbers, milestones, the deliverables register, budgets, status updates, portfolio, timeline, bookings, retainers, change requests, acceptance (nghiệm thu) and a billing queue for finance, close-out; `/today` as the landing page, morning plan, end-of-day report prefilled from activity, timesheets, utilisation; custom fields, table view, triage, blockers, cycles, hand-offs (stage packages, cross-team, leave cover, exit handover), review chains up to the client, client decision records, publish log, automations; delivery dashboard, KPI actuals from work, profitability, AI drafts. Migrations 0078–0087, additive.

**Needs the owner, in addition to §4:** decide SRS Q17–Q25 (who logs time, whether EOD reports are mandatory, client review links, job-number scheme, who sees fees, cut-over date, pilot teams, private projects and the owner); name two pilot teams; `pnpm db:seed` on production (project template plans, the acceptance template — a draft for counsel); the new evening cron; Supabase's upload limit for video deliverables.

## 6. What has never been seen in a real browser

Every phase was verified by tests and by exercising pages and server actions over HTTP with forged sessions — several real bugs were found that way and no other. But no phase has been clicked through by a person in a browser. The **Tiptap editor** (toolbar, tables, uploads, paste), the **English rendering** throughout, mobile layouts, and the whole of the AI chat are the places where that gap is widest.
