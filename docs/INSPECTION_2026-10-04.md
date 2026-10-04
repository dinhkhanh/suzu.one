# SuZu One — inspection, 4 October 2026

*What is missing, what is wrong, what should be better. The plan that follows from it is Phase 12 in [`DEVELOPMENT_PLAN.md`](./DEVELOPMENT_PLAN.md); requirement IDs (FR-…, NFR-…, D…) are those of [`SRS.md`](./SRS.md).*

---

## 1. How this was done, and how far to trust it

- **Code:** eleven read-only audits, one per area (platform · core HR · attendance & leave · payroll · work & daily · projects · CRM & brand kits · KB, comms & AI · recruitment & performance · assets, requests, ops & reports · non-functional), each reading the SRS section, the phase's status note and the module's code on `main` at `5eee433`. Nothing was run and nothing was changed.
- **Production:** read-only look at Vercel (deployments, runtime errors, variable *names*), Supabase (advisors, row counts and status aggregates — no personal data read) and Sentry.
- **Marks.** **✔** = re-checked by a second reading of the code or against production after the audit reported it. No mark = found by one audit reading the code, with the file named; treat it as very likely, and read the file before building on it. **(?)** = inferred, and the line says what would settle it.
- **Not done:** no browser pass, no test run, no load test. Nothing here says a screen *looks* right.

Severity: **S1** wrong result, data exposed, or a core flow blocked · **S2** a Must requirement missing or a dead end a user cannot get out of · **S3** improvement.

---

## 2. Where things stand

### 2.1 The code

Phases 0–11 and everything since are on `main`, which **is** production (`suzu.one`, Vercel `sin1`, Supabase `ap-southeast-1`). 21 modules, about 190,000 lines, 275 pages, 115 migrations, 294 test files, 11,585 message keys in each of Vietnamese and English with none missing either way ✔.

Built after the plan was last updated, and so in no status note: Messenger and Telegram notifications, seeing the app as somebody else (FR-PLT-40), owner oversight (D31), the first-sign-in guide, the feedback inbox, the "Quiet ink" redesign, the three-tier cache on Vercel's Data Cache, files on Cloudflare R2, KB search on pgvector + Workers AI, the user manual (142 pages), the in-app face kiosk and the NAS kiosk, status sets, digital assets and seats (FR-AST-07..11), follow-up requests (FR-REQ-05), the two-level job title (D32), competencies, work history, brand kits (§4.16), the public home page.

### 2.2 Production, as read on 4 October ✔

| | |
|---|---|
| People | 35 active (31 employees, 1 probation, 1 intern, 1 part-time, 1 collaborator), 3 entities, 15 org units. 18 people signed in during the last 7 days. |
| Reporting lines | **17 of 35 active people have no line manager**; 22 are in no work team; **8 have neither**. |
| Roles granted | `owner` × 6 and `department_head` × 8. **No HR, payroll, finance, recruiter, sales or marketing role is granted to anybody.** |
| Work | 11 teams (each has a lead), 9 active projects, 1 client, 87 work tasks, 37 time entries. Last 7 days: 15 morning plans, 4 end-of-day reports. |
| HR | 11 leave requests, 98 punches (69 app, 29 device), 20 face templates. No month has been locked. |
| Payroll | No run. 20 of 21 statutory parameters **unverified**. |
| Ops | 47 obligation templates, **all unreviewed**; 244 instances generated from them. |
| Performance | **No review template and no review cycle** (see PRF-01). |
| Jobs | 37 jobs ran in the last 7 days, all succeeded except `kb-embeddings` twice (30 Sep – 1 Oct, a Cloudflare token; fine since). Longest job 41 s; a whole schedule takes well under its 300 s. |
| Delivery | Email: 238 sent, 160 skipped. Web push: 282 sent, 28 failed. Messenger 114 and Telegram 39 sent. **Google Chat: all 76 simulated** (no webhook set). Files: all 30 `not_scanned`. |
| Not configured | `ANTHROPIC_API_KEY` (the assistant answers with quoted passages, never generated prose), `GOOGLE_CALENDAR_*` (interviews and meetings are internal-only, no Meet link), `GOOGLE_CHAT_WEBHOOK_URL`. |
| Database | 60 MB. Advisors: nothing at warning level; 381 foreign keys without an index and 149 unused indexes (information only at this size). |
| Errors | Production's real ones are small: Google sign-in state mismatches (9 events, 8 people, 28 Sep – 1 Oct), the face kiosk failing to load its model on some devices, one stale server-action call after a deploy. **Most of what Sentry shows is the developer's own machine**, reporting as `production` (see ENG-07). |

### 2.3 The documents are behind the code

- `MVP_STATUS.md` and the callout at the top of `DEVELOPMENT_PLAN.md` §3 say nothing is merged or deployed. Everything is.
- The Phase 10 and 11 notes say "not pushed, not merged". Both are live.
- `DEVELOPMENT_PLAN.md` §7 lists Phase 10 as in progress.
- `MVP_STATUS.md` §4.B names Voyage for embeddings and Supabase for files; production uses Workers AI and R2.
- README and `KEY_ROTATION.md` say `.env.local` is the local stack; it is the production database.
- SRS A8 says both public surfaces are `noindex`; careers is indexable by the owner's later decision, and there are now four public surfaces (careers, review links, brand kits, the home page).
- The user manual has no page for the face kiosk, status sets or brand kits.

---

## 3. Defects — wrong today (S1)

### Daily work and projects (the cut-over is 5 October)

| # | What | Evidence |
|---|---|---|
| PJM-01 ✔ | **A new project has no plan row and no job number until midnight**, and "Create document space" fails on it with `project_not_found`. | `projects/documents.ts:31`; `ensurePlan` is only called from inside the projects module and the midnight job |
| PJM-02 ✔ | **A task in a done state counts as "accepted" by the client**, and any in-review task as "client review", with no client decision. Accepted ÷ promised and the accepted column of the biên bản are inflated. | `projects/engine/register.ts:31,34` |
| PJM-03 | **The kick-off gate and the close-out can both be walked around**: the project header sets any status, so a project becomes Active without an approved brief and Done without the close checklist. A closed project re-activated this way keeps a permanently locked plan. | `work/projects.ts:137,154` |
| PJM-04 | **Original + change requests ≠ current**: budget, fee and register stay directly editable after kick-off, and the ledger takes each step's "after" from the next change's "before". Retainer scope bypasses change requests. | `projects/plans.ts:237,262`, `structure.ts:139`, `engine/change-request.ts:72` |
| PJM-05 ✔ | **"Approved" is preselected on the client's review page** — a name and one tap approve and freeze the version. | `(preview)/preview/[token]/page.tsx:127` |
| PJM-06 | The client's file link is signed for 60 seconds while the page promises "a few minutes"; no inline image or video. | `platform/files/service.ts:18` |
| DLY-01 | **A timesheet week nobody can approve**: a person with no team lead and no line manager submits a week that locks for ever (no recall). 8 active people are in exactly that position today ✔. | `daily/timesheets.ts` `approversOf`, `transition` |
| DLY-02 | **A missed end-of-day report cannot be filed from the UI**: the server allows 7 days back, but no screen offers a past date; the lead cannot nudge for yesterday; after midnight the Today card and the 18:00 reminder point at the new day. | `daily/reports.ts`, `daily/actions.ts:121`, `daily/page.tsx` |
| KB-01 ✔ | **"Must read" cannot be aimed at an org unit.** The form offers `unit` / `unit_only`; the server accepts only all / entity / department / team / person and throws; the audience SQL still matches `department:` / `team:` keys that migration 0072 rewrote to `unit:`. (Production has no audience rows yet, so nothing is silently lost — but the first unit audience will fail.) | `kb/acknowledgements.ts:26,29-35,58`, `kb/ui/ack-forms.tsx:52`, `drizzle/0072:172` |
| PLT-01 | **Heads of parent units are missed** wherever code asks "who holds this role over this unit": the lookup builds unit scopes without the subtree, against FR-PLT-16. The weekly-report notice is one caller. | `rbac/service.ts:258,275` |

### Payroll (not in use yet — fix before the first parallel run)

| # | What | Evidence |
|---|---|---|
| PAY-01 ✔ | **Retro pay never happens.** `deriveRetroItems`, `addRetroItem`, `cancelRetroItem`, `listRetroItems` have no caller outside tests: a post-lock timesheet adjustment or a late salary change never reaches the next run (FR-PAY-17, FR-ATT-14). | `payroll/retro.ts` |
| PAY-02 ✔ | **A recalculation silently drops retro lines**: the first calculation marks them taken; the second reads only open ones. | `payroll/runs.ts:184,213`, `retro.ts:59` |
| PAY-03 ✔ | **A stale run can be proposed**: a figure added to a `calculated` run (an expense claim, a commission) does not reset it, so it shows as posted and is not paid. | `payroll/runs.ts:73-96,105` |
| PAY-04 ✔ | **Typed figures lose their sign or vanish**: `Math.abs` turns a −500,000 clawback into +500,000; a code that is not an input component is skipped without a warning. | `payroll/engine/earnings.ts:157-158` |
| PAY-05 | **A run that can never be marked paid**: a Statutory employee banking outside VCB/ACB is "unroutable", a zero-net person (full-month maternity) is skipped, and old files' skip counts are summed for ever — with no override. | `payroll/payments.ts:320-341`, `exports/banks/format.ts:86` |
| PAY-06 | **PIT filings double-count in a month with two runs** (the bonus month), and include unapproved runs. | `payroll/statutory-exports.ts:59,192-194,248-251` |
| PAY-07 | **Unused leave is never paid**: leave posts `payout` ledger rows, `LEAVE_PAYOUT` is seeded as an engine component, and nothing connects them (FR-LVE-03, FR-PAY-18). | `leave/ledger.ts:253`, `payroll/seed-components.ts:37` |
| PAY-08 | Payslips stay published after the CEO returns a run; employees watch figures change. | `payroll/lifecycle.ts:50,86-88` |
| PAY-09 | `payBonusRun` is not atomic: a failure on the second entity or a double click duplicates the first entity's run. | `payroll/bonus.ts:488-511` |
| PAY-10 | For the accountant: night overtime on rest days and holidays is computed as 250 % / 350 %, where Decree 145/2020 art. 57 reads as 270 % / 390 %; fixed allowances pay in full to joiners and leavers; PIT is keyed by work month although salary is paid on the 5th of the next. | `engine/overtime.ts:58`, `engine/proration.ts:45-48` |

### Security and privacy

| # | What | Evidence |
|---|---|---|
| CRM-01 ✔ | **A lead's owner can log activities and assign follow-ups on any account**: with a lead named, authorization checks only the lead, and nothing ties the lead to the account in the same request. | `crm/account-actions.ts:224`, `crm/activities.ts:114` |
| CRM-02 | **Client contact details leave the CRM and survive erasure**: delivery set-up copies email and phone into the project brief and hand-off note, readable by everybody on the project; erasure does not reach those copies, the lead's own fields, or activity text. | `crm/delivery.ts:78-86,116`, `crm/contacts.ts:122` |
| CRM-03 | **A seller without `pjm:cost` can solve for a team's loaded hourly cost** by varying a draft quote and watching "needs approval" flip. Teams may be two people. | `crm/quotes.ts:126` |
| BRD-01 | A brand-kit file marked private is still fetchable in full with `?preview=1` when a rule cites it; the public file route has no rate limit. | `brand/public.ts:47,56-74` |
| REC-01 ✔ | **The public careers form is rate-limited after parsing**: malformed posts are never counted, and each writes an audit row. The form-load limit is defined and never applied. | `lib/public-action.ts:82-91`, `recruit/engine/rate-limit.ts:30` |
| REC-02 | A stranger can stamp talent-pool consent onto an existing candidate by typing their email. | `recruit/public.ts:222-224` |
| REC-03 | **Anonymisation is incomplete**: the name stays in application events, referral notes, rejection notes, the email outbox and audit summaries; and **deleted files are never removed from storage**, so a purged candidate's CV is still there. No erase-on-request action. | `recruit/jobs.ts:164`, `platform/files/service.ts:57,181` |
| PRF-02 ✔ | **A line manager can calibrate (0–1000 %) and release their own report's review at any time**, cycle open or not; that figure feeds the bonus. The code comment says this is intended — it should be the owner's decision, not the build's. | `performance/reviews.ts:326-362`, `review-policy.ts:125` |
| AI-01 | **No limit on the assistant or the draft helpers**: none per person, none per day, no token count stored. Harmless while no API key is set; a cost and abuse hole the day one is. | `ai/actions.ts:20` |
| AI-02 | Once a key is set: KB passages go to the model unredacted; the hand-off draft sends the whole comment thread (phones, emails) and asks for client contacts. | `ai/model.ts:73`, `ai/drafts.ts:117` |
| SEC-01 ✔ | **No Content-Security-Policy on any page** (NFR-SEC-01); HSTS is left to the platform default. | `next.config.ts:27-36,55` |
| SEC-02 | **CI does not gate production**: Vercel builds with type errors ignored and runs no tests; a push to `main` deploys whether or not CI passes. No secret scanning, no dependency bot. | `next.config.ts:19`, `.github/workflows/ci.yml` |
| SEC-03 | Kiosk sessions never expire (400-day cookie) and liveness is checked only in the browser: `/api/kiosk/punch` accepts any embedding from a device holding the cookie. | `attendance/kiosk-api.ts` |

---

## 4. Core flows that cannot be completed (S2)

| # | What | Evidence |
|---|---|---|
| PRF-01 ✔ | **No review cycle can be created in production.** The review-template action has no screen, and the production seed creates no template (production has 0). No cycle → no final result → no bonus multiplier (FR-PRF-03, FR-PRF-09, FR-PAY-21). | `performance/review-actions.ts:103`, `scripts/seed.ts` |
| PAY-11 ✔ | **Off-cycle runs have no screen** (`createOffCycleRunAction` is imported nowhere), and only one bonus run per year is allowed: a Tết or holiday bonus has no path (FR-PAY-19). | `payroll/run-actions.ts:71`, `schema.ts:703` |
| PAY-12 | **C&B cannot see a calculation before proposing it**: the per-person lines and trace render only on a published payslip. | `getRunPerson` has no caller |
| PAY-13 | **An approved version can never be corrected** — a mistyped salary can only be superseded from a later day; a back-dated raise is impossible. Applies to salary structures, pay profiles, components, policies, statutory parameters. | `platform/statutory/engine/versions.ts:22-30` |
| PAY-14 | **No salary-structure or pay-profile import**: each person needs their own owner-approved change, never bulk-approvable. Loading a company this way is days of clicking. | no `defineImport` in payroll |
| LVE-01 | **Leave cannot be booked ahead of accrual or into next year**: with monthly accrual, Tết leave asked for in December is refused for lack of balance. | `leave/requests.ts` `previewLeave` |
| PLT-02 | **Approvals strand with a leaver or an absentee**: only the current assignee can pass a turn on, delegation is self-service, nothing reassigns pending turns at offboarding, and HR has no "reassign". | `platform/approvals/actions.ts:49,91` |
| PLT-03 | Nobody can suspend an account: `suspended` is honoured everywhere and set nowhere (FR-PLT-05). | `auth/session.ts:77` |
| CHR-01 | **Issued documents are not permanent**: re-opening a numbered decision re-renders it from today's template, date and facts. The same is true of the acceptance record (PJM): a signed biên bản's printout changes when the template is edited. Numbering is read-then-insert with no lock. | `documents/service.ts:111,170-178,228-240`, `projects/acceptance.ts:270` |
| CHR-02 | **Records that cannot be corrected**: contracts (create / terminate / delete only, and only on the latest employment), dependents, emergency contacts, vault titles and expiry, employment start date and employee code, positions; a person created in error cannot be removed. | `core-hr/records-actions.ts:105-170` |
| CHR-03 | The resignation form disappears for good once any resignation was approved — including after a called-off termination or a rehire. | `(app)/me/page.tsx` |
| REC-04 | **The candidate hears nothing**: no acknowledgement, no rejection email, no interview invite with a time, and "send offer" sends nothing. Recruiters are not told of a new application. | `recruit/offers.ts:324-336`, `recruit/public.ts` |
| REC-05 | Three editors have storage and readers but no screen: per-job pipeline stages, interview kits, custom application questions (FR-REC-02, 03, 06). | `recruit/actions.ts:160,486`, `interviews.ts:371` |
| REQ-01 | **Requests end at "approved"**: payment, purchase and advance requests have no paid date, reference or finance queue; an advance is never netted against the trip. Approved expense claims wait for a manual "sweep". | `requests/service.ts`, `expense-posting.ts:129` |
| REQ-02 | Three seed request types are missing (equipment, stamp/seal, IT support); an approved confirmation-letter request generates no letter; a business trip is filed twice (requests and attendance). | `requests/seed-types.ts` |
| CRM-04 ✔ | Nothing stops a won deal being set up twice — each run makes another project carrying the whole fee, register and retainer. (Several projects per deal is intended; a double submit is not.) | `crm/delivery.ts:93` |
| CRM-05 | **No correction paths in the CRM**: an invoice cannot be edited or voided, a payment can exceed the invoice, drafts cannot be deleted, a confirmed commission statement ignores a later payment change. | `crm/invoices.ts:80`, `commission.ts:164` |
| PJM-07 | **Retainer months are unworkable from the UI**: a month's lines cannot be edited or given tasks, link labels repeat across months, finished tasks cannot be linked, the hours allowance never alerts. | `projects/metrics.ts:65`, `plan/page.tsx:198-200` |
| PJM-08 | A client project with a billing milestone but no register lines never bills, without a message; a billing amount cannot be corrected; a signed acceptance cannot be fixed; deleting a milestone orphans its acceptances and billing items. | `projects/acceptance.ts:79`, `billing.ts:150,237`, `structure.ts:120` |
| PJM-09 | The job number is shown on no task and no time entry (FR-PJM-02). An approved brief can never be edited again. | no `jobNumber` in `work/` or `daily/` |
| WRK-01 | **No time logging on the task page, board or list** — only on Today, the report form and `/daily/time` — though D22 makes time required. | `work/ui/**` imports nothing from `daily` |
| WRK-02 | Deleted tasks cannot be restored; a recurrence needs a project and cannot be edited; a team working from its backlog has no board or calendar; saved views need a project. | `work/tasks.ts:594`, `planning-actions.ts:155-196` |
| DLY-03 | The morning plan is read by nobody: D23 lets the chain read plans, and no lead screen shows one. People in no work team get no weekly report. Submitting a report notifies nobody. | `daily/plans.ts`, `weekly.ts:97` |
| DLY-04 | Leave cover is drafted only at midnight or from a tab the person may never open: the approver of a same-day request sees no cover plan, and nothing reminds anyone to hand back. | `work/cover.ts`, `today/inbox.tsx:64` |
| ATT-01 | A flagged check-in notifies nobody, and a pending flag blocks the month lock; the lock itself tells nobody. | `attendance/punches.ts` (no `notify`) |
| ATT-02 | Off-site and location forms want latitude and longitude typed by hand. No monthly timesheet export. An employee cannot see their own leave ledger or face enrolment, or withdraw consent. | `attendance/ui/request-forms.tsx:127-136` |
| AST-01 | Bookings notify nobody (request, decision, late return); nothing chases due-back, warranty, access review dates or "password to change". The register caps at 500 rows with no export. | `assets/service.ts:354`, no assets job |
| OPS-01 | Maker-checker is not built (FR-OPS-06); auto-closed payroll obligations are always written "on time". | `ops/scheduler.ts:261,281` |
| COM-01 | Surveys, pulse and eNPS do not exist (FR-COM-04); KB page feedback and comments do not exist (FR-KB-08); a scheduled announcement's notice waits for the next cron. | — |
| AI-03 | Newly published pages are invisible to the assistant for up to a day; the question is embedded accent-stripped while pages are embedded accented; "con" is read as "còn" (a sick-child question goes to the leave-balance tool); a capitalised word mid-sentence triggers an "other person" refusal. The 160-question eval set was written against demo pages and predates the current embedding model. | `kb/actions.ts:40`, `ai/retrieval.ts:23`, `ai/engine/routing.ts:49,82,163` |
| KB-02 | Two people editing a page overwrite each other silently; the diff shows text only; a page cannot leave its space, be duplicated or be undeleted. | `kb/pages.ts:230` |

---

## 5. Requirements not fully built

Only what is not built; everything unlisted was found built and reachable. Priority is the SRS's.

### Must

| ID | Gap |
|---|---|
| FR-PLT-06 | No idle timeout (7-day rolling session). Step-up is built; its Google driver has never been confirmed in production (?) — open a payroll page. |
| FR-PLT-11 | An entity has no bank accounts; the paying account is retyped for every file. |
| FR-PLT-12 | Secondary assignments: an enum value and nothing else. |
| FR-PLT-32 | No virus scanning. |
| FR-PLT-35 | Emails, pushes and chat messages are always Vietnamese. |
| FR-PLT-36 | No contract import, no salary import. |
| FR-PLT-37 | CSV only; about 11 screens export; the audit log, leave, assets, CRM, recruitment, approvals, requests and documents do not. |
| FR-PLT-39 | Leave types, leave policies and the attendance policy take effect on HR's own permission, with no owner approval. |
| FR-CHR-01 | No education or certificate records. |
| FR-CHR-09 | Only resignation and salary change go through approval; no event generates or links a document; hand-recorded events change nothing (a probation pass does not move the workforce type). |
| FR-CHR-10 | No pre-boarding form. |
| FR-CHR-12 | Change requests exclude dependents, emergency contacts and documents; an employee cannot open letters issued about them. |
| FR-CHR-13 | Directory search matches name, work email and code only; no phone. |
| FR-ATT-03 / NFR-PRF-02 | No selfie; no offline queue for check-in. |
| FR-ATT-12/18, Q13 | The "×3 inclusive or additional" holiday parameter does not exist; time off in lieu cannot be corrected after the lock. |
| FR-PAY-10, 13 | Late/early minutes and the KPI score are hard-coded 0 in the run; no input for other PIT deductions. |
| FR-PAY-11/16 | A mid-month pay-profile change is not segmented. |
| FR-PAY-32, 33, 35, 39 | No payslip email; bank and statutory files are CSV with unverified columns; the cash sheet has no disbursed amount or scan. |
| FR-PAY-38 | The parallel run compares six employee-side figures; no employer cost, no export, no sign-off record. |
| FR-WRK-05, FR-PJM-35, 36 | No task CSV export; state is not inline-editable in the table; templates carry no custom-field values. |
| FR-PJM-08, 09, 15 | No saved portfolio views; role and phase budgets show no burn; templates carry no hand-off packages. |
| FR-CRM-04, 05, 13, 32, 33, 50 | Account 360 lacks acceptances waiting, revision rounds, profitability and expiring contracts; no contact timeline; deal list lacks owner / entity / account / close-month filters and CSV; aging is one total per reader; the credit limit is never compared; profitability has no brand level or project drill-down; the dashboard lacks renewals, top accounts and an owner view. |
| FR-REC-04, 13 | The talent pool is a flag nobody can see or withdraw; a re-applying candidate is purged on the first application's clock. |
| FR-PRF-01, 02 | No check-in reminders; manual KPI actuals need no approval; no per-month target; no export. |
| FR-AST-01, 08 | No asset photos; the access review date is stored and never chased. |
| FR-RPT-02 | No leave usage or liability, OT-versus-caps, or joiners/leavers trend report. |
| FR-COM-02 | No open jobs on the home feed. |
| NFR-SEC-03 | No rate limit on auth (per-instance default), kiosk and device endpoints, or webhooks. |
| NFR-PRV-01..04 | No "export my data"; no anonymisation of former employees; no retention for GPS positions, notifications, delivery logs, AI conversations or audit IPs; no consent record for GPS at check-in; face consent is an HR checkbox. The NAS kiosk keeps its own face store outside the purge (?). |
| NFR-OPS-02..05 | No staging; no backup, restore or incident runbook and no restore drill; no health endpoint or uptime monitor; feature flags cover one module. |
| NFR-MNT-04 | No end-to-end test at all; "integration" is PGlite, so the pooler path that broke production twice is never exercised. |

### Should

FR-ACL-05 custom roles · FR-PLT-23 SLA for code-defined request types · FR-PLT-24 one-tap approve in email · FR-PLT-34 search beyond tasks · FR-CHR-06 DOCX, letterhead from the entity, fuller placeholders · FR-CHR-15 birthday and anniversary notices · FR-ATT-05, 07, 13, 16 · FR-LVE-06, 09 · FR-PAY-05, 06, 18, 36, 37 · FR-PJM-13 capacity by skill, 23 per-project weekly, 58 client-report selection · FR-KB-07, 08, 10 · FR-COM-03, 04 · FR-REC-10, 11 · FR-PRF-04, 06, 07 · FR-AST-04 · FR-REQ-03, 04 · FR-OPS-06, 10 · FR-RPT-05 file attachments · FR-CRM-07, 08, 22 per-entity thresholds, 27, 34, 41, 44 · FR-BRD-06.

### Could / later

FR-ACL-08 view as a role · FR-CHR-17 · FR-KB-12, 16 · FR-COM-05, 06 · FR-AI-03, 04 (beyond three drafts), 05 · FR-REC-12 · FR-PRF-05 · FR-AST-06 · FR-OPS-12 · FR-PJM-64 "what is blocked" · FR-CRM-53..56.

---

## 6. Engineering and operations

| # | What |
|---|---|
| ENG-01 | **Cron is one sequential function per schedule** (20 jobs in the morning, `maxDuration` 300 s ✔). It fits today (76 s for everything ✔), but a timeout would silently skip the tail — retention jobs are last — a timed-out run is marked failed only on the next trigger with no notice, and nothing notices a cron that never fired. |
| ENG-02 | **Migrations run before the build with no guard**: a failed build leaves the new schema under the old code; nothing lints destructive DDL; no `lock_timeout`; no index is created `CONCURRENTLY`. |
| ENG-03 | **No staging, and the production database on the laptop** (NFR-SEC-06). Previews, if any are opened, would share production data (?). |
| ENG-04 | **Housekeeping that does not exist**: deleted files' bytes, spent approval tokens, import batches (personal cells in clear JSON), notifications, delivery tables, `job_run`. |
| ENG-05 | **Failures nobody sees**: an email that fails five times, a failed cache purge (console only), a failed Chat card. Admin → Jobs has no "run now". |
| ENG-06 | **The module-boundary lint has a hole**: it restricts `@/modules/*` aliases only, so 35 relative cross-module imports pass (20 are projects → work internals; CRM reaches into work and projects). |
| ENG-07 ✔ | **The developer's machine reports to Sentry as `production`**, which buries production's real errors. |
| ENG-08 | `patches/postgres@3.4.9.patch` is load-bearing while `postgres` is caret-ranged; `@electric-sql/pglite` is a runtime dependency though only tests use it; no `engines` field. |
| ENG-09 | Audit is written after the mutation commits: if it fails, the change stands unaudited and the user sees an error. |
| PERF-01 | **The whole message catalogue (620–724 KB) goes to the browser on every signed-in page.** |
| PERF-02 | **No streaming**: 0 `loading.tsx`, 0 `<Suspense>` across 275 pages. Tiptap is imported statically by 30+ form components. |
| PERF-03 | **Lists that load everything**: project and backlog tasks (closed ones included, cut silently at 2,000), leader view (1,000), deals (500, with totals summed over the cut), assets (500), candidates (200), every obligation instance twice a day. Six readers paginate. Short of NFR-PRF-05/06. |
| PERF-04 | **Reads against the house rule** — reference data read bare (role-holder lookups from 37 call sites, approval flows, checklist templates, document templates, entities), counting in JS (owner dashboard tiles, claims owed, billing-ready total, headcount, timesheet month totals, kudos), and query-per-row loops (HR alerts, leave accrual, the month lock, KB acknowledgement notices, approver notices, final results, the claim sweep, bulk edit). Each is named with its line in the area audits. |
| PERF-05 | The service worker's static cache never shrinks between deploys; 49 MB of kiosk models sit in `public/`. |
| UI-01 | House-rule leftovers: about 30 native checkboxes, radios, textareas and selects (CRM, payroll, KB, attendance, org), `window.confirm` in attendance, leave and KB, two raw `<table>`s, hand-rolled bordered lists in cover and exit handover, hard-coded Vietnamese written into stored records (leave ledger, retro items, renewals, request summaries). |

---

## 7. What the owner alone can settle

Decisions the build made that should be the owner's — **answered 2026-10-05:**

| Question | The owner's answer |
|---|---|
| Who is asked for a plan, a report and time? | Every active person **except collaborators and holders of the `owner` role**; they may still file, and are never reminded or counted missing (amends D23). |
| May a line manager calibrate and release a review (PRF-02)? | **No.** Only HR (`performance:manage`) calibrates and releases, and only once the cycle has reached calibration or is closed; the manager writes the review and proposes the rating. |
| Are fixed allowances pro-rated for joiners and leavers? | **Ask the chief accountant first**; the engine stays as it is until then, and the answer becomes a per-entity policy. |
| How does Phase 12 reach production? | **On the branch only** (`phase-12-close-the-gaps`); the owner reads the diff and merges. |

Not asked, decided by the build: a won deal may still become several projects, but a double submit of the same set-up is refused.

Still open from the SRS: Q5 (clock models) · Q13 (holiday multiplier) · Q14 (bonus formula) · Q16 (PDPL, before payroll data) · Q26–Q30 (CRM).

Data and set-up, in production today: line managers for 17 people · HR, payroll, finance, recruiter, sales and marketing role grants · six `owner` grants reviewed · 20 statutory parameters verified by the chief accountant · 47 obligation templates reviewed · a real client list (there is 1) · Google Chat and Calendar keys, or a decision to drop them · the Anthropic key (with AI-01 and AI-02 closed first) · branch protection on `main` · real payroll files for the golden tests.
