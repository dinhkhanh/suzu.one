# Phase 12 — for the owner who reads the diff and merges

*Written 2026-10-05 for branch `phase-12-close-the-gaps` at `f726af4` (main was `5eee433`). The owner decided on 5 October that Phase 12 reaches production only through this branch, after the owner has read it. This page is what to read beside the diff. The item numbers (PJM-01, PAY-03, …) are those of [`INSPECTION_2026-10-04.md`](./INSPECTION_2026-10-04.md), whose last column now says item by item what is fixed; the plan's view is the Phase 12 status note in [`DEVELOPMENT_PLAN.md`](./DEVELOPMENT_PLAN.md).*

> **Still moving when this was written** — update here when they land:
> - **R6-B house rules** (boundary lint, native controls and `window.confirm`, stored Vietnamese, `.xlsx` exports): being merged. Its merge commit: —. Its decisions go in §3 under "House rules".
> - **The found-defects fix-up**: running against the list in §4. Strike each item there as it is merged, with the commit.

---

## 1. What the branch contains

25 merges and four direct commits after the inspection (`d1276d0`), 19 migrations (**0115–0133**), about 4,540 tests (354 files) on the last full check. Every merge commit says what it brought; the bundle commits under it say, item by item, what now happens.

| Release | What it does, in short | Merges |
|---|---|---|
| **R0 — cut-over week** | A project has its plan row and job number when it is created. The client's review page preselects nothing, and its file link is the page's own route, signed when it is used. A timesheet week always has an approver (lead → manager → `work:manage` → owners) and can be recalled. Missed end-of-day reports are listed, can be filed late and are chased the next morning. Must-read pages can be aimed at an org unit. "Who holds this role over this unit" includes heads of the units above. Time is logged from the task page. Only a Vercel deployment reports to Sentry as `production`. The daily loop no longer asks owners and collaborators. | `c8417f6` `30138f7` `64efa9e` |
| **R1 — safety** | CRM activities answer to every record they name; contact details stay in the CRM and erasure reaches their copies; a draft quote no longer reveals the team's cost. Private brand files stay private, and the file route is rate-limited. The careers form is rate-limited before parsing; a stranger cannot stamp consent; anonymisation reaches every copy, and HR can erase on request. Deleted files leave storage. The assistant has per-person limits, stores token counts, and sends a model no contact detail. A Content-Security-Policy runs **report-only**, HSTS is explicit, CI scans for secrets, and Dependabot is on. A kiosk session expires. Approvals no longer strand with a leaver: HR can reassign a turn and delegate on someone's behalf. An account can be suspended. Only HR calibrates and releases a review, from the calibration stage. | `350488a` `3fb5f50` `c0f25a5` `ea31c6f` `143c960` |
| **R2 — project figures** | "Done internally" and "accepted by the client" are now two separate states. Status moves only through the kick-off gate and close-out, and re-opening is audited. After kick-off, scope, budget and fee change only through change requests. Retainer months can be worked. Billing and acceptance can be corrected, and the issued biên bản is kept. The job number shows on the work. A client's review links are revoked when the project ends or their maker leaves, and a link's views are audited. A deal can be set up for delivery once per project. Invoices can be drafts, voided and capped, and payments can be reversed. A team backlog has a board, a calendar, saved views and recurring tasks. A deleted task can be restored. Plans are visible to the chain, and leave cover is drafted when leave is submitted. | `4e04cc4` `fac79bf` `5ea3791` `32abc4a` `1deada6` |
| **R3 — payroll** | Retro pay exists and survives a recalculation. A stale run cannot be proposed. Typed figures keep their sign. C&B see each person's lines before proposing. Payslips are withdrawn when a run is returned. Every person can be paid: interbank on ACB, or "paid another way". Entities have paying accounts. The cash sheet records the amount handed over and a scan. Filings count a month once and read only approved runs. The bonus hand-over is atomic. A leaver's unused leave is paid, and the run asks C&B for the rest of the settlement. Q13 is a parameter. A locked timesheet month exports. There is an off-cycle run screen, and a year can have more than one bonus run. A wrong approved version can be voided. Salaries and pay profiles import, with owner approval. The parallel run has employer cost, a CSV and a sign-off. A probation share can be set. Other PIT deductions can be typed in. | `13f437f` `d87e0dd` `470cd5a` `bf03b01` `7dc40f9` |
| **R4 — HR flows** | Review forms are made on screen. A cycle is launched with notices, probation reviews start as probations end, and sign-off and reminders are built in. Flagged check-ins reach their reviewers; a rejection and the month lock reach the person. Positions are picked, not typed. Face consent can be withdrawn on `/me`. Issued papers are stored as issued, numbered under a lock, with the entity's letterhead and a register. HR records can be corrected and a person created in error removed. A probation pass changes contract and type together, and the resignation form comes back after a rehire. Leave can be booked ahead and into next year, with the person's own ledger. Leave and attendance rules take effect only on the owner's approval. Payment, purchase and advance requests end in finance's "to pay" queue; an advance is netted against its trip; claims are swept nightly. Three request types are added, the confirmation letter is generated, and a trip is filed once. The candidate gets four emails, recruiters are told of applications, the talent pool can be seen and left, and pipeline, question and interview-kit editors exist. | `e2cc81a` `88939e3` `7ffb58b` `30f126f` `12f51d0` |
| **R5 — operations and privacy** | A cron schedule that runs out of time hands the rest to a fresh invocation. A killed run reaches the owners, and a dead-man's ping is optional. Admin → Jobs has "Run now" and a failed-deliveries tile. There is `/api/health`. Housekeeping covers sessions, tokens, import batches, notifications, delivery logs and job runs. Sign-in is rate-limited across instances, and an unused session ends after three days. A migration lint runs. A failed audit write is retried and reported. Runbooks are written. A Playwright smoke suite is in CI. **Privacy:** a person can export their own data. A recorded GPS notice with withdrawal is shown at check-in. Check-in positions are kept 90 days and assistant chats 180 days. HR-confirmed anonymisation is offered three years after someone leaves. The clock roster drops leavers and withdrawn faces. | `b8ab8fb` `f726af4` |
| **R6 — speed** | A signed-in page receives only its own section's messages (vi: 663 KB → 15 KB shell + the section). 19 sections show a skeleton while loading; three stream; Tiptap loads on demand. Long lists are paged, and closed tasks are hidden by default. Reference tables are read from the cache, totals are counted in SQL, and per-row loops are batched. The service worker prunes its cache. | `938a1f5` |
| R6-B — house rules | *In progress — see the box above.* | — |
| R7 — deferred Should-haves | Not started. The owner chooses (inspection §5). | — |

**Migrations to read with care** (all were checked as safe for the code now on `main`):

- **0123** swaps the retro item's unique index.
- **0125** inserts the two new statutory keys as `unverified`, and only where parameters already exist.
- **0126** drops `crm_invoice_item_pkey` for a composite key.
- **0128** re-creates `salary_structure_no_overlap` so that it applies only to versions not voided.
- **0130** updates the seeded payment, purchase and advance types.
- **0131** inserts three wordings.

Every other migration only adds. The migration lint checks every migration from 0132 on.

---

## 2. After the deploy — the cut-over steps

In order. The merge itself runs migrations 0115–0133 against production before the new build exists, as every push does.

1. **`pnpm db:seed` against production.** It writes only what is missing. It brings:
   - the `SEVERANCE` pay component (R3; a leaver's run asks for it);
   - the three starter review forms — annual, mid-year and end of probation (R4; without them no cycle can be made from a starter);
   - the "Quyết định tiếp nhận sau thử việc" document template;
   - the three new request types: equipment, stamp/seal and IT support.

   The two statutory keys `overtime.holiday_pay` and `leave.payout_basis` already arrive with migration 0125. Without them a payroll run refuses to calculate.
2. **`pnpm cache:flush https://suzu.one`** after the seed and after any hand-made SQL. Several cache keys moved (request types `v3`, review templates `v2`, document templates `v2`, the role-grant table), and the seed writes past the app.
3. **`pnpm kb:manual --author <your work email>`** republishes the manual space in the knowledge base. About 70 manual pages changed with Phase 12, and the script publishes only pages whose text changed. Run `pnpm cache:flush` again afterwards.
4. **HR adds `{{privacy_url}}` to production's rejection wording** (`REJECT_AFTER_REVIEW`, among the recruitment email wordings; manual 16-07). Production's wordings predate the placeholder, and without it a rejected candidate gets no link to leave the talent pool. Read the three wordings migration 0131 inserted while you are there.
5. **Set up the uptime check** on `https://suzu.one/api/health` (`docs/runbooks/incidents.md`). **Optionally set `CRON_PING_URL`** (a healthchecks.io base). Each schedule then pings `<base>/<schedule>/start`, then `<base>/<schedule>` or `/fail`, so a cron that never fires is noticed.
6. **Branch protection on `main`**, and make Vercel wait for CI. Until then a red check still deploys, and Vercel still ignores type errors (`next.config.ts:19`).
7. **Watch the first CI run of the `e2e` job.** The Playwright suite has never run. Expect to adjust it.
8. **Watch the CSP reports** in Sentry's security endpoint for a week or two. They count against the Sentry quota. `vercel.live` (Vercel's preview toolbar) is not in the policy and will be reported. Then set `CSP_MODE=enforce`.
9. **Expect at the deploy:**
   - Everyone idle for more than three days is asked to sign in again.
   - A kiosk tablet opened more than 90 days ago, or unused for 14, stops and must be opened again (Attendance → kiosk).
   - Pending approval turns of people who have already left are moved by the next nightly roll-over.
   - From the deploy on, HR's leave-type, leave-policy and attendance-policy saves become proposals that wait for the owner (`/approvals/rule/[id]`).
10. **Privacy steps the code cannot take** (`docs/privacy/R5_PRIVACY_DECISIONS.md`):
   - Decommission the NAS face kiosk (§3). Until then, set `PURGE_INACTIVE_DAYS=0` on it.
   - Record Cloudflare (Workers AI, R2) as a processor and confirm its DPA.
   - Update the public privacy policy text (`legal.privacy`) with the retention periods and the GPS notice.
   - Decide on virus scanning (§5 of that file recommends accepting the risk now and adding ClamAV before the careers page draws volume).
11. **Check once by hand:**
    - Open a payroll page in production. The Google step-up driver has never been confirmed.
    - Send one candidate letter to yourself, for Resend and for the offer PDF attachment.
    - Read Admin → Jobs the morning after: all three schedules, and whether any hand-over happened.
12. **HR and the accountant review what the build seeded as guesses:**
    - the three new request types' approvers and SLAs;
    - the probation decision template;
    - the two new statutory keys, which arrive `unverified` (see §6).

---

## 3. Decisions the build made that the owner may overrule

Each line gives the decision, then where it lives. Paths are under `src/modules/` unless they say otherwise. Most limits are named constants, with the reason written beside them.

**Platform, access and operations**
- Who holds a role over a unit includes grants on every unit above it. The whole grant table is cached for 10 minutes, under one key. — `platform/rbac/grants-cache.ts`
- HR (`person:manage` over the subject) reassigns an open approval turn, with a reason, and never on their own request. A request with a sealed payload can go only to someone who reads the subject's restricted tier. — `platform/approvals/service.ts`
- A leaver's turns are re-resolved at offboarding. If nobody is left on a step, the turn goes to the owners. The engine never finishes a step by itself. — `platform/approvals/service.ts`
- Suspension: HR over the person, with a reason. Sessions end at once; employment and grants are kept. Suspending oneself, or the last owner who can still sign in, is refused. — `platform/auth`, people service
- A session ends after **three days** without use. It is pushed forward at most once an hour. — `platform/auth/auth.ts:22`
- Sign-in is counted per address: **60 a minute** to start a sign-in or for Google's callback, **300 a minute** for everything else. Step-up allows 10 calls in 10 minutes per session. Better Auth's own limiter is off. — `platform/auth/rate-limit.ts`, `endpoint-limit.ts`
- Retention: notifications 180 days; email, push, Chat, Messenger and Telegram delivery logs 90 days (never one still owed); spent link attempts 30 days; job runs 90 days; uncommitted import batches 1 day. — `platform/notifications/retention.ts`, `platform/jobs/service.ts:27`, `platform/import`
- A cron schedule has a **240-second** budget before it hands over. A run still "running" after **15 minutes** is marked failed, and the owners are told. — `platform/jobs/service.ts:21,98`
- "Run now" is for `rbac:manage` holders only (today the owner). Auditors and HR see the runs. — `platform/jobs/policy.ts`
- A failed audit write is retried 3 times, then sent to Sentry, and the action still answers ok. It is not written inside the change's transaction. — `src/lib/action.ts`
- Sentry: `SENTRY_ENVIRONMENT` / `NEXT_PUBLIC_SENTRY_ENVIRONMENT` override the detected environment. — `src/lib/observability/options.ts`
- CSP is report-only by default (`CSP_MODE`). Reports go to Sentry. HSTS is two years, with subdomains and no preload. — `src/lib/csp.ts`, `next.config.ts:35`
- `postgres` is pinned at 3.4.9, and Dependabot ignores it. **No `engines` field**: Vercel would choose production's Node version from it. `.gitleaks.toml` allows three named strings. — `package.json`, `.gitleaks.toml`
- The migration lint grandfathers everything up to 0131. — `tests/migration-lint.test.ts:13`

**Privacy** (all in `docs/privacy/R5_PRIVACY_DECISIONS.md` and `privacy/engine/retention.ts`)
- Former employees are offered for anonymisation **3 years** after their last day. HR confirms each one; nothing is anonymised automatically. Vault documents of kind "other" are treated as removable. Date of birth, gender, nationality and permanent address are kept for tax and insurance records.
- The exact positions of app check-ins are cleared after **90 days** (not while a check-in waits for review). Assistant chats and unanswered questions are deleted after **180 days**.
- The GPS notice is asked again whenever its version changes. Each answer is an append-only row. There is no early erasure on request beyond what the policy gives.
- KB passages and questions lose their contact details before they are sent to Cloudflare for embedding. Names cannot be redacted, so Cloudflare is recorded as a processor.
- The data export is one JSON file. It needs step-up, is refused while impersonating, and is audited with counts only.

**Daily work, work and projects**
- The fallback approver of a timesheet week is `work:manage` over the person, else the owners, and never the person. A recall needs no confirm step. — `daily/approvers.ts`
- Owners and collaborators are never asked or counted missing. They may still file, but they cannot submit a week. — `daily/team-rules.ts`
- A team's weekly notices go to the `work:manage` holders, one digest each. — `daily/weekly.ts`
- Deleted tasks can be restored for **30 days**, by project leads and team admins only. — `work/tasks.ts:656`
- The parent-task picker offers only the same list. The backlog calendar shows no publish posts. — `work/`
- A saved view may be up to 5 minutes stale (cached per person). — `work/views.ts`
- Client review link (`work/engine/preview.ts:95`):
  - A view is audited at most once an hour per visitor per link.
  - Files are limited to 300 an hour per visitor and 600 an hour per link; a video's URL is signed for 30 minutes.
  - A closed link's file redirects to the page.
  - Zalo's in-app browser on a phone counts as a person; Zalo anywhere else is a link fetcher.
- Links are revoked nightly on done or archived projects and when their creator leaves. No new link can be made on a done project. — `work/jobs.ts` (`work-preview-sweep`)
- Status reminders fall back to the named lead, then the team's leads. Internal projects and pitches count as accepted when done. Un-archiving never re-opens a project. — `projects/guards.ts`, `projects/jobs.ts`
- Retainer alerts fire at 80 % and 100 % of a line and of the month's hours, once each. A month the job never made can be made on demand within the terms. — `projects/retainers.ts`
- A billing amount can be corrected before invoicing, with a reason; the figures are kept on the item and out of the audit log. A signed acceptance's scan, signer and date can be corrected until it is invoiced. — `projects/billing.ts`, `projects/acceptance.ts`
- List sizes: deals 50, assets 100, candidates 50, obligations 500 open / 100 closed per page. Hard caps: tasks 2,000, leader view 1,000, deal board 500 cards — each says when it is cut. — route `page.tsx` files
- Under a `loading.tsx`, a page's `notFound()` / `redirect()` arrives after the skeleton (a 200 with `noindex` and a client-side redirect). — `src/app/(app)/*/loading.tsx`

**CRM and brand kits**
- A double delivery set-up means the same project name on the same deal; archived projects are ignored. — `crm/delivery.ts`
- Voiding an invoice returns its items to finance's queue. A written-off invoice cannot be voided. — `crm/invoices.ts`
- A payment change re-opens confirmed commission statements and statements in an open run. A statement in a closed run is flagged instead. — `crm/commission.ts`
- Without `pjm:cost` a seller sees only the discount rule. The margin is judged when the quote is sent. A quote whose margin cannot be estimated goes out on its discount alone, marked "not checked". — `crm/quotes.ts`
- Free text in activities is not searched by erasure, and the erase forms say so. — `crm/contacts.ts`
- Brand files: only a cited **picture** is public. 120 downloads and 1,500 pictures an hour per visitor. Pictures are still served as attachments. — `brand/engine/rate-limit.ts:26`, `brand/public.ts`
- The house Dialog and Segmented control are used rather than an alert dialog and radio group, for UI.md's bottom sheet. Core HR used shadcn's alert dialog; R6-B may unify them.

**Payroll** (`payroll/`)
- A negative net blocks a proposal. A missing bank account, missing tax code, missing salary structure or unverified statutory value only warns. A calculation whose claim stopped for 10 minutes can be taken over. — `run-readiness.ts`, `runs.ts`
- Any Statutory employee who banks outside VCB / ACB goes into the ACB file as an interbank row. "Paid another way" needs `payroll:pay` and step-up. A cash difference needs a note. — `payments.ts`
- A void is one step, by the owner (or by C&B for a first Statutory profile nobody approved). `payment_prepared` counts as "used". — `version-use.ts`, `platform/statutory/engine/versions.ts`
- The probation share reduces pay but not the declared insurance salary. — `engine/earnings.ts:57-96`
- There is no cap on charity, voluntary-pension or other PIT reliefs; a cap would later be a parameter. — `engine/components.ts`
- The off-cycle screen leaves leavers out. — `/payroll/runs/new/off-cycle`
- The parallel-run sign-off is by C&B or the owner, and it stops holding when the figures change. — `parallel.ts`
- `leave.payout_basis` is seeded as base salary plus insurable allowances. The same day rate applies to every leave type that pays out. — seed, `engine/`
- With `overtime.holiday_pay = inclusive`, 100 % is taken off all holiday overtime. The parameter is seeded `in_addition`, which is what the engine did before. — `engine/overtime.ts:54`
- Severance is typed in by C&B; it is not calculated. Engine 1.2.0. — `engine/`
- Two engine versions were bumped (1.1.0, then 1.2.0). The off-cycle and void bundle did not bump it.

**HR records, documents and lifecycle**
- Approval for transfer, promotion and termination is asked only where an administrator saved a flow. A move between entities does not go through transfer approval. — `core-hr/lifecycle.ts`
- Renaming a position is for group HR only. Removing a person created in error needs their name typed, and the database refuses it once anything else names them. — `core-hr/`
- Papers are always rendered in Vietnamese. The register shows the latest **300**. The subject may open every paper about them. — `documents/service.ts:402`
- A paper made before papers were stored is issued on its first opening, dated the day it was made. — `documents/service.ts`

**Leave, attendance and requests**
- Booking ahead counts on this year's accrual target by the leave date, and on next year's accrual or grant plus this year's projected carry-over while it has not lapsed. Nothing is projected for a closed year or further ahead. — `leave/projection.ts`, `leave/engine/`
- Staffing rules and leave balances stay with HR; only rules go to the owner. Rule proposals have a fixed flow to the owner and cannot be returned. — `leave/`, `attendance/`, `platform/approvals`
- A flagged check-in's reviewer is the line manager, else the HR holding `attendance:manage` (owners left out). The notices are a morning batch, one per reviewer. — `attendance/punches.ts`
- The face section on `/me` is hidden if the person was never enrolled. Withdrawing consent deletes the face data at once and is refused while impersonating. — `attendance/faces.ts`
- Kiosk sessions end after **14 days** unused and **90 days** in all. The limiter keeps windows for one day. — `attendance/engine/kiosk-lifetime.ts:18,20`
- A purchase is paid like a payment. The new types' approvers and SLAs are guesses. — `requests/seed-types.ts`
- A salary confirmation letter is not generated without the compensation tier; HR makes it by hand. An introduction letter has no template. — `requests/letters.ts`
- The trip's attendance record is linked to the request only by its reason text. — `attendance` `recordApprovedTrip`

**Performance**
- Probation reviews: the deadline window comes from HR's countdown, `hr.alert_thresholds.probationEndDays` ([10, 3] today). The self-review is due 7 days before the end and the manager's 3 days before. A contract is enrolled once, so a person HR removed does not come back. — `performance/engine/probation.ts`
- Reminders (code constants): a form due within 3 days once, then overdue forms weekly; an unrecorded sign-off or an unacknowledged review 3 days after release, then weekly. — `performance/review-reminders.ts`
- Only HR returns a submitted form. A blank form is three-point at 50 / 100 / 120 %. — `performance/review-actions.ts:324`, `src/app/(app)/performance/admin/templates/new/page.tsx:22`
- Releasing without calibration freezes the manager's proposed rating. — `performance/review-policy.ts`

**Recruitment**
- "Tell the candidate" is ticked by default, both for an interview and for a rejection. — `recruit/ui/interview-form.tsx:85`, `application-actions.tsx:78`
- The offer email attaches the salary PDF, which is removed from the outbox once the email is sent. — `recruit/offers.ts`
- The candidate's privacy page only lets them leave the pool. Its link is an HMAC of the record and the email address, and only its hash is stored. — `recruit/`, `/careers/privacy/<token>`
- Careers limits: form loads are counted. The consent notice names `privacy@suzu.one`, and `CONSENT_VERSION` was bumped. Retention counts from the latest application. — `recruit/engine/rate-limit.ts`, `recruit/enums.ts:86`

**Assistant**
- Questions: 10 a minute and 100 a day. Drafts: 5 a minute and 40 a day (`AI_LIMITS`). The owner sees usage for 30 days. — `ai/engine/limits.ts:28`
- Amounts of money are removed from KB passages sent to a model. — `ai/engine/redact.ts`

**House rules (R6-B)** — *to be added when it is merged.*

---

## 4. Defects found on the way that no bundle fixed

Found by the bundles while they built, checked against this branch where a line is given. A fix-up was running when this was written. **Strike each one here as it is merged.**

**Wrong today**
1. **Entity-scoped finance cannot open expense claims.** `canSettleExpenseClaims` is called with the principal alone, so its target is `{}` and only a group-wide `payroll:pay` passes. — `src/app/(app)/requests/claims/page.tsx:25`, `requests/expense-actions.ts:87`, `requests/ui/request-tabs.tsx:21`
2. **A recruiter granted on a department sees no openings.** `openingScope` uses `entityReach`, which ignores unit grants. — `recruit/service.ts:197-199`
3. **Former employees: an empty reach lists everyone.** `personInReachSql` returns `undefined` for an empty reach, which `and(…)` reads as "no filter". — `privacy/anonymise.ts:70`, `platform/rbac/reach-sql.ts:38-46`
4. **A suspended person still gets in-app notices, email and push.** Only `offboarded` is skipped. — `platform/notifications/service.ts:84`
5. **A leaver's payout posted after the month's run was approved has no path.** The payout is posted on the day after the last day, and the off-cycle screen leaves leavers out.
6. **Changing an opening's pipeline** while applications sit on its old stages is not handled. — `recruit/` `updateOpening`
7. **A legal minimum is a code constant**: the probation salary minimum of 85 %. — `recruit/enums.ts:203`, used at `recruit/offer-actions.ts:44`

**Smaller**

8. An un-archived KB page is re-chunked but not embedded until the next `kb-embeddings` run. — `kb/pages.ts:300-304`
9. The brief form still lets people type a contact's email or phone by hand. — `projects/ui/plan-forms.tsx:112`
10. The delegation page labels request types with `names.vi` whatever the reader's language. — `src/app/(app)/approvals/delegation/page.tsx:44`
11. The confirmation-letter notice says "collect it from HR", but the letter is now on `/me`.
12. A paper made from the person panel is not tied to a lifecycle event.
13. The draft button lists an unused `contacts` target. — `ai/ui/draft-button.tsx:92`
14. Payroll has no API for another module to add retro items.
15. The report form says "today" / "tomorrow" for a past day; `timesheets.intro` describes only leads and reports.
16. `stored_file.file_name` is kept after a purge (recruit clears its own). `defaultRetainUntil` duplicates `retainUntilFrom`. — `recruit/service.ts:549`
17. Push and chat delivery rows written before R4 may still hold a candidate's name, until their 90-day purge.
18. Stale comment: `kb/schema.ts:136` still lists `department:` / `team:` keys.
19. The kudos year for the evidence panel is taken in UTC. — `performance/evidence.ts:43-47` → `comms` `kudosReceived`

**Reads against the house rule, still left** (CLAUDE.md, the two questions)

20. `core-hr/alerts.ts:28` `renewed()` is N×M in JS.
21. `work/calendar.ts` and `work/cycles.ts:119` cap silently (1,000).
22. `/requests/pay` may total a capped list.
23. KB acknowledgements run one transaction per page.
24. The demo seeds insert `work_project` directly, past the plan hook. — `scripts/seed-demo-work.ts:194`, `scripts/seed-demo-work-planning.ts:53`
25. The demo seed lacks ops obligations and timesheet days.

**UI house rules** (R6-B's ground; strike what it closes)

26. A native checkbox in `crm` `money-forms.tsx` (~103) and in attendance `request-forms` (~82).
27. A raw checkbox and textarea in the attendance location form.
28. `window.confirm` still used in `projects/ui/plan-forms.tsx` (~65) and in KB, approvals and comms.
29. A native button on the candidates page.
30. The duplicate message key `position` (identical values).

**Not code — needs the owner or legal**

31. The public privacy policy (`legal.privacy`) does not state the new retention periods or the GPS notice.
32. FR-CHR-12: change requests for dependents, emergency contacts and documents were not built.

---

## 5. What was never verified

Everything on the branch passed `pnpm check` (unit, PGlite integration, migration and policy tests) at its merge. **Nothing below has been seen working:**

- **A browser.** No page of Phase 12 has been opened by a person: not the new screens, not the CSP under a real nonce, not the skeletons, the lazy editor, the per-section messages, the bottom-sheet dialogs, the position picker on a phone, or the video player on the client's page.
- **Playwright.** The seven-journey suite was typechecked, linted and listed; it has **never run**. Its first CI run (PgBouncer in transaction mode, migrations, seed, build) will show what needs adjusting.
- **Real email.** No candidate letter, attachment, or `.ics` file has gone through Resend. The outbox path and the `attachments` column were tested; the provider was not.
- **The Vercel cron chain.** Several things exist only in code:
  - the self-call with `?from=n`, the 202 it answers and the work done after answering;
  - the 15-minute sweep;
  - `CRON_PING_URL`;
  - "Run now" inside a 300-second action.
- **Production infrastructure.** Also untested:
  - `/api/health` through the Supabase pooler;
  - the auth limiter behind Vercel's proxy (which address header it reads);
  - R2 deletes of purged files;
  - Vercel's Data Cache purge of the moved cache keys;
  - the Google step-up driver;
  - Workers AI with redaction;
  - a Claude driver with a real key.
- **The migrations against production's data.** 0115–0133 were applied to fresh and test databases only. 0123, 0126 and 0128 change keys and constraints; read them before the merge.
- **The kiosk** after the lifetime change, on a real tablet. **The NAS kiosk** roster change against the running NAS.
- **Bank and statutory files.** The ACB interbank row and every layout are still assumed.

---

## 6. For the chief accountant

All of this is unverified until the accountant says otherwise. Each item is a parameter, a seeded component or a file layout, never a constant (except where §4 says so).

1. **Every Appendix A statutory value.** 20 of 21 are `unverified` in production; the list is in `MVP_STATUS.md` §4.C.
2. **`overtime.holiday_pay`** (new, Q13). `in_addition` (seeded): the holiday multiplier is paid on top of the day's salary. `inclusive`: the multiplier includes it, so the line pays the multiplier less 100 %, and all of it counts as premium for the PIT exemption. Which reading of Labour Code art. 98 applies?
3. **`leave.payout_basis`** (new). Unused leave on leaving is priced on the contract salary of the month before the month of leaving, divided by that month's normal working days (Labour Code art. 113.3, Decree 145/2020 art. 67.3). Seeded as base plus insurable allowances; which allowances count? Should every payable leave type use the same day rate?
4. **`SEVERANCE`** is seeded PIT-exempt. Confirm it, and the treatment of asset compensation and advance recovery typed into a leaver's run.
5. **Night overtime** (PAY-10). The engine pays rest-day and holiday nights at 250 % / 350 %; Decree 145/2020 art. 57 reads as 270 % / 390 %. Unchanged.
6. **Fixed allowances for joiners and leavers** are paid in full. The owner left this to the accountant (5 October); the answer becomes a per-entity policy.
7. **The PIT month basis.** PIT is keyed by work month, while salary is paid on the 5th of the next month.
8. **Probation share.** It reduces pay on probation days, at least `probation.limits.minimumPayPercent` (a parameter; recruitment's offer form checks a code constant of 85 % instead — §4 item 7). It does not reduce the declared insurance salary. Is that right for a probation contract that is insured?
9. **PIT reliefs typed into a run.** Charity, voluntary pension and "other" have no cap. Which caps apply? (They would become parameters.)
10. **The filings' month rule.** A person-month across two runs adds income and tax withheld, and takes deductions and assessable income from the run calculated last (golden case 16).
11. **The bank files.** Other banks go as interbank rows in the ACB file, in an assumed layout; VCB's assumed layout carries no beneficiary bank. Both layouts and the statutory files (D02-LT codes, PIT indicators [21]–[37]) are still guesses.
12. **The parallel-run report** now shows employer cost per person and compares it with the accountant's figure when given. The sign-off is the accountant's (or C&B's) record.
13. **Real golden cases.** Cases 16–20 were written by the build; three months of real anonymised payroll per entity are still needed.
14. **Expense claims** are swept nightly into the open run as `EXPENSE_REIMBURSE` (exempt from tax and insurance; to confirm).
15. **The 47 obligation templates**, all unreviewed.
