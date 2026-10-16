# Release plan — SuZu One to the whole company

*Written 13 October 2026, against `main` at `55a4bfc8`. It gathers in one order what is spread over [`MVP_STATUS.md`](./MVP_STATUS.md) §4, [`INSPECTION_2026-10-04.md`](./INSPECTION_2026-10-04.md) §7, [`PHASE_12_OWNER_REVIEW.md`](./PHASE_12_OWNER_REVIEW.md) §2, [`PHASE_13_OWNER_REVIEW.md`](./PHASE_13_OWNER_REVIEW.md) §5, [`BACKUP_PLAN.md`](./BACKUP_PLAN.md) and [`DEVELOPMENT_PLAN.md`](./DEVELOPMENT_PLAN.md) §5. Where this file and one of those disagree on a step's detail, the step's own document wins; where they disagree on the order or the date, this one does.*

**How to use it.** Work top to bottom. Each wave has the steps (**Do**), what goes into the database (**Seed / load**), how you know it worked (**Check**), and the **Gate** that must be green before the next wave leans on it. Tick the boxes in the pull request that changes this file, or copy them into a tracking issue. The waves overlap in time; the gates do not move.

---

## 0. Where we start

Everything through Phase 13 R5, backups and `MAINTENANCE_MODE` is on `main`, and `main` is production (`suzu.one`, Vercel `sin1`, Supabase `ap-southeast-1`). The code is ahead of the company: what is missing is set-up, data, confirmations and habits.

| Area | State (inspection of 4 Oct unless dated) | Consequence |
|---|---|---|
| People | 35 active, 3 entities (placeholder legal names), 15 units. **17 without a line manager, 8 of them in no team.** | Approvals, reminders and team views reach nobody for those people |
| Access | `owner` × 6, `department_head` × 8. **No HR, payroll, finance, recruiter, sales or marketing grant.** | HR cannot do HR in the app; only owners can |
| Daily work (cut-over 5 Oct, D28/D29) | 15 morning plans and **4 end-of-day reports** in a week; 1 client | The cut-over has happened on paper, not in habit |
| Attendance & leave | 98 punches, 20 face templates, 11 leave requests, **no month locked**; 2026–27 holidays seeded `unconfirmed` | No month can feed payroll yet |
| Payroll | No run. **20 of 21 statutory values unverified** (+ `overtime.holiday_pay`, `leave.payout_basis`) | Payroll cannot be trusted until the chief accountant has signed |
| Ops | 47 obligation templates, **all unreviewed** | Deadlines are generated from unchecked rules |
| Performance | No review cycle; the three starter forms arrive with `pnpm db:seed` after Phase 12 | Year-end reviews need a cycle by 1 December |
| AI | Agent on for the pilot list only (`AI_AGENT_AUDIENCE=pilot`) | Most staff get quoted passages, not the agent |
| Safety nets | Backups built but **switched off until B1**; no restore drill; no uptime check; no branch protection; Vercel ignores type errors; CSP report-only; the developer laptop's `.env.local` points at production | One bad day could lose data with no proven way back |
| Legal | Q16 (PDPL, cross-border) open; processor agreements not on file; document templates are unreviewed drafts | **Payroll data may not go live** until Q16 is closed |

Not recorded anywhere: whether the Phase 12 and Phase 13 post-deploy steps (seed, cache flush, `kb:manual`) were run on production. Wave 0 checks.

---

## 1. The shape of it

```
Oct 13 ─ W0 Make production safe ─────────── Oct 17
Oct 14 ─ W1 Organisation, people, access ─────────── Oct 23
Oct 13 ─ W2 Daily work: repair the cut-over ────────────── Oct 30 (≥ 90 % EOD)
Oct 19 ─ W3 Attendance & leave ───────────────── Nov 3 (October locked) ── Dec 1 (Tết leave booked)
Oct 26 ─ W4 Knowledge base, comms, Ask SuZu AI to everyone ── Nov 8
Nov 2  ─ W5 Requests, approvals, assets, ops tracker ──────── Nov 20
Nov 2  ─ W6 Recruitment, CRM (gated on Q26–Q29) ─────────────────── Dec 18
Nov 9  ─ W7 Year-end reviews (cycle open by Nov 16) ─── Dec 31 · 2027 OKRs in January
Oct 20 ─ W8 Payroll: confirm → golden files → parallel Nov → parallel Dec → LIVE with January 2027 pay (paid 5 Feb)
```

| Milestone | Date | Gate |
|---|---|---|
| M0 Production is recoverable | Sat 17 Oct | Backups green two nights running; uptime check live; branch protection on |
| M1 Everyone is in the right place | Fri 23 Oct | Every active person has a unit and a line manager; HR roles granted; employee data verified per entity |
| M2 Daily work is the record | Fri 30 Oct | ≥ 90 % of expected EOD reports for 10 working days running; real clients and open projects loaded |
| M3 First month locked | Tue 3 Nov | October timesheets locked for every entity; differences explained |
| M4 Self-service is the only way | Mon 9 Nov | Handbook + top-20 SOPs published; agent on for everyone; leave and requests refused outside the app |
| M5 Payroll confirmed | Fri 20 Nov | Accountant signed Appendix A + PAY-10; Q16 closed; golden tests on real files pass |
| M6 Parallel run 1 (November pay) | 1–5 Dec | Zero unexplained differences per entity, or every one classed |
| M7 Parallel run 2 (December pay) | 1–5 Jan | Zero unexplained differences per entity; signed |
| **M8 Payroll live** | **January 2027 pay, 1–5 Feb** | Owner + HR lead + chief accountant sign; Excel kept as shadow for this one month |

**Why January 2027 for payroll.** It is the first month of a tax year, so no year-to-date PIT import is needed and the 2026 PIT finalisation stays in the Excel that computed it. It needs two locked months before the first parallel run (October and November) and two parallel runs before it (`DEVELOPMENT_PLAN.md` R1). Tết 2027 falls on Saturday 6 February, the day after pay day — see W8 step 8.6.

---

## 2. Who does what

| Who | Holds | In this plan |
|---|---|---|
| **Owner** (Trần Đình Khánh) | Vercel, Supabase, Cloudflare, Google Cloud, GitHub logins; `owner` role | Every production command, every environment variable, every decision marked *Owner*; final go/no-go |
| **HR lead** — the HR champion | `hr_admin` from W1 | Employee data, org tree, leave, attendance, reviews, recruitment wordings, training sessions |
| **Chief accountant** — the finance champion | `payroll` and/or `finance` from W1 | Appendix A, pay components, PAY-10, bank and statutory layouts, obligation templates, parallel-run sign-off |
| **Counsel** | — | Q16 / PDPL assessment, processor agreements, the privacy text, the document templates and offer letter, the acceptance template |
| **Team leads** — one champion per creative team | `department_head` on their unit | Their team's plans, reports, projects, approvals; first line of help |
| **Claude Code** | the repository, never production credentials | Code fixes, scripts tested locally, documentation; hands the owner ready commands |

---

## 3. Every release, the same way

This applies to every merge to `main` during the rollout, not only to the waves.

### 3.1 Before merging

- [ ] `pnpm check` green locally (Prettier, types, lint, tests).
- [ ] CI green on the pull request (`check`, `e2e`, `secrets`; about 4 minutes). It is the only run: CI does not run again on `main`, and Vercel does not wait for it. Branch protection holds that line — the branch must be up to date with `main` before it merges (GitHub offers "Update branch", and CI runs once more), and nobody, the owner included, pushes to `main` around a pull request.
- [ ] Every new migration starts with `SET lock_timeout = '5s';`, adds and never drops/renames/retypes/tightens (the migration lint in `pnpm check` holds this; an allowed exception is named in the PR).
- [ ] The PR says whether production needs a step after deploy: `db:seed`, `cache:flush`, `kb:manual`, a new environment variable, a manual SQL, an announcement.
- [ ] No merge between **07:00 and 09:00 ICT Mon–Sat** (check-in peak and morning plans) and none on the 1st–5th of a month once W3 has started (lock and payroll days). Best window: 12:00–13:00 or after 19:00.

### 3.2 Deploying

1. Merge to `main`. `vercel-build` runs `drizzle-kit migrate` against production, then builds.
2. Watch Vercel → Deployments until **Ready**. A failed migration rolls its batch back and leaves the previous build live — nothing to undo ([rollback.md](runbooks/rollback.md)).
3. Open `https://suzu.one/api/health` → `{"ok":true}`.

### 3.3 After deploying

Run what the PR named. Production commands are run **by the owner**, from the owner's machine, with the production env file loaded explicitly — never through a `.env.local` that points at production (W0 step 0.6 ends that):

```bash
pnpm exec tsx --env-file=<prod env file> scripts/seed.ts
```

```bash
pnpm exec tsx --env-file=<prod env file> scripts/cache-flush.ts https://suzu.one
```

```bash
pnpm exec tsx --env-file=<prod env file> --require ./scripts/server-only-shim.cjs scripts/kb-manual.ts --author <owner work email>
```

The seed only fills what is missing and never updates; run the cache flush after it and after any hand-made SQL.

**Check after every release:**
- [ ] Sign in; open `/today`, the page the release touched, and one approval.
- [ ] Sentry → `production`: no new issue in the first hour.
- [ ] Next morning: Admin → Jobs — the `midnight` and `morning` schedules ran, nothing failed; the failed-deliveries tile is not red.

**If it is wrong:** Vercel → Deployments → previous production build → **Promote to Production**, then `cache:flush`, then fix forward ([rollback.md](runbooks/rollback.md)). A data problem is [restore.md](runbooks/restore.md), never a hand edit first.

---

## W0 — Make production safe (Tue 13 – Sat 17 Oct)

Nothing else in this plan is worth doing on a system that cannot be restored.

**Do**

- [ ] **0.1 Catch up the post-deploy steps of Phase 12 and 13** (`PHASE_12_OWNER_REVIEW.md` §2, `PHASE_13_OWNER_REVIEW.md` §5). Run them even if you think they ran — each is idempotent:
  - `scripts/seed.ts` (brings `SEVERANCE`, the three review forms, the probation decision template, three request types), then `cache-flush`;
  - `kb-manual.ts --author <owner email>`, then `cache-flush` again.
- [ ] **0.2 Backups, B1** — [backup.md](runbooks/backup.md#setting-it-up-owner-once-about-an-hour), about an hour: age key (private half in the password manager and printed for the safe), `backup_reader` role from `scripts/backup/setup.sql`, R2 buckets `suzu-one-backups` and `suzu-one-files-backup`, the GCS bucket with `gcs-lifecycle.json`, Workload Identity, the GitHub environment `backups` with its variables and secrets, healthchecks `backup-hourly` and `backup-nightly`, then `BACKUPS_ENABLED=true`. Run the workflow once by hand: Actions → Backup → Run workflow → `nightly`.
- [ ] **0.3 Uptime check** on `https://suzu.one/api/health`, 1 minute, Singapore, alert after 2 failures ([incidents.md](runbooks/incidents.md#setting-up-the-uptime-check-owner-once-10-minutes)).
- [ ] **0.4 Cron switch**: healthchecks `midnight`, `morning`, `evening` and `CRON_PING_URL` on **Production only**. Add a fourth check for the five-minute `attendance-checkin-reminders` schedule only if it pings; otherwise rely on Admin → Jobs.
- [x] **0.5 Branch protection on `main`** (16 Oct): `check`, `e2e` and `secrets` required, branch up to date before merging, no push around a pull request — admins included. CI runs on pull requests only, so a release costs one run, and Vercel deploys as soon as it has built (no Deployment Checks: the gate is the pull request). `ignoreBuildErrors` stays: Vercel skips the type check CI has already done on that exact merge.
- [ ] **0.6 No laptop on production** ([environments.md](runbooks/environments.md) §1): `.env.local` → local stack; production values only in a separately named file used with `--env-file`; reset the database password and update `POSTGRES_URL*` in Vercel; rotate `CRON_SECRET` and `BETTER_AUTH_SECRET` ([KEY_ROTATION.md](KEY_ROTATION.md)) — everyone signs in once more, so do it **after 19:00** and say so in the evening announcement.
- [ ] **0.7 Encryption keys**: confirm the offline copy of `DATA_ENCRYPTION_KEYS` and `DATA_BLIND_INDEX_KEY` exists and matches Vercel (compare the key ids, not the values, on screen).
- [ ] **0.8 Environment audit** in Vercel (Production), names only: everything in §A1 of the appendix set; `STEP_UP_DRIVER=google`; `STORAGE_BUCKET` set explicitly (the code default `suzu-private` and `.env.example`'s `suzu-one-private` disagree); `SENTRY_ENVIRONMENT=production`; nothing production-valued ticked for **Preview**.
- [ ] **0.9 Sentry hygiene**: the developer machine must not report as `production` (ENG-07) — `SENTRY_ENVIRONMENT=development` in the local file, then resolve the old local noise.
- [ ] **0.10 Step-up and email, by hand**: open a payroll page in production (the Google step-up driver has never been confirmed); send one candidate letter to yourself (Resend + the offer PDF).
- [ ] **0.11 NAS face kiosk**: set `PURGE_INACTIVE_DAYS=0` on it today; switch it off in W3 once every wall tablet runs `/attendance/kiosk` (`privacy/R5_PRIVACY_DECISIONS.md` §3).

**Seed / load** — `scripts/seed.ts` (0.1) and the manual (0.1). Nothing else.

**Check**
- [ ] Healthchecks: `backup-hourly` green through a working day, `backup-nightly` green **two nights running** (its run restores the dump into a throwaway Postgres and passes `verify.sql`).
- [ ] The files check in the nightly log: every `stored_file` a record points at is in production and in both backups.
- [ ] Uptime monitor: one test alert received on the owner's phone.
- [ ] Appendix §B queries B1–B3 run clean (three review forms, `SEVERANCE`, request types present).
- [ ] A push with a failing test does **not** deploy.

**Gate M0**: backups green two nights, uptime live, branch protection on, nobody's laptop on production.

**Next, within the month:** the first **restore drill (B5)** from the offline kit alone ([restore.md](runbooks/restore.md#the-restore-drill)) — October is a scheduled drill month anyway. Use the restored copy to rehearse W8's parallel run on real data if a staging project exists by then ([environments.md](runbooks/environments.md) §2).

---

## W1 — Organisation, people, access (Wed 14 – Fri 23 Oct)

Everything downstream — approvals, reminders, leave, timesheets, payroll, reviews — routes through the org tree, the line manager and the role grants.

**Do**

- [ ] **1.1 Entities (Q12)** — `/admin/entities/[id]` for SZG, SZM, SZC: real legal name, tax code, insurance code, address, **wage region** (all three are seeded region I — check), branches, and the **paying bank accounts** (VCB / ACB). A fourth entity, if any, is created here, not by seed.
- [ ] **1.2 The org tree** — `/admin/org`: the real departments, big teams and small teams, nested (import file allowed: Mã phòng ban, Tên, Trực thuộc, Pháp nhân). Units are shared across entities unless a unit belongs to one. Remove or rename seeded units nobody uses (`BD`, `IT`…) only if no person sits in them.
- [ ] **1.3 Every person in one unit, with a line manager** — `/people` (or the employee import in update mode). Target: **0 active people without a manager** except the top of the tree.
- [ ] **1.4 Verify the employee data per entity** — HR exports the people list per entity, checks it against the HR master spreadsheet, fixes in the app. Restricted fields (CCCD, tax code, social insurance number, bank account) through the person's sensitive tab or the import's sensitive columns. **Format phone and ID columns as text in Excel** so leading zeros survive.
- [ ] **1.5 Contracts and job history** — `/people/import` (Contracts: Mã NV, Số HĐ, Loại HĐ, Từ ngày…; Job history). At minimum the current contract of every employee, so the renewal and probation alerts fire.
- [ ] **1.6 Role grants** — `/admin/roles` (decided by the owner, granted by the owner):

  | Role | To whom | Scope |
  |---|---|---|
  | `hr_admin` | HR lead | group |
  | `hr_staff` | HR staff | group or entity |
  | `payroll` | chief accountant / C&B | group |
  | `finance` | finance staff | group or entity |
  | `department_head` | every unit head not already granted | their unit (reaches below it) |
  | `entity_director` | each entity's director | entity |
  | `c_level` | the C-level five | group |
  | `recruiter` | whoever hires | group or unit |
  | `asset_admin` | office admin (**no HR role carries `asset:manage`**) | group |
  | `sales`, `marketing` | per Q26 | — |

  Decide at the same time (`MVP_STATUS.md` §4.A.6): does `hr_staff` hold `report:read`? Who holds `kb:manage`, `comms:manage`? May `hr_staff` see a salary band?
- [ ] **1.7 Review the six `owner` grants** — `owner` reads compensation for everybody and is exempt from plans and reports (D23 amendment). Keep it to the people who must hold it; give the others `c_level`.
- [ ] **1.8 Switch on the People module for everyone** — `/admin/flags` → `people` (off by default: today only `person:manage` / `org:manage` holders see it).
- [ ] **1.9 Google Workspace**: both admins (suzu.vn, suzu.group) mark the app as trusted in Admin console (SRS §7.2) — removes consent prompts; check `ALLOWED_WORKSPACE_DOMAINS` covers every domain staff sign in with (today `suzu.vn,suzu.group,bambooads.net`).
- [ ] **1.10 Collaborators and freelancers** (D14) — each has an HR-created workspace email and `workforce_type = collaborator`, so they are not chased for reports.

**Seed / load** — entity data (screens), org units (screen or import), people updates, contracts, job history, role grants. No script.

**Check**
- [ ] Appendix §B4 → 0 active people without a manager (other than the top), 0 without a unit.
- [ ] §B5 → the grant table matches 1.6.
- [ ] Sign in as HR with "see the app as somebody else" (FR-PLT-40) on: one employee, one team lead, one HR staff — each sees what the table in `docs/permission-matrix.md` says and **a line manager sees no salary**.
- [ ] HR signs a one-line note per entity: "the people list of <entity> is correct as of <date>".

**Gate M1**: the check list above, all green.

---

## W2 — Daily work: repair the cut-over (now – Fri 30 Oct)

The cut-over to the app for daily work was **5 October** (D28) and every team is a pilot (D29). The code is live; the habit is not.

**Do**

- [ ] **2.1 Load the real work**, team by team, with each lead: the real **clients** (`/crm` accounts — today there is 1), **retainers**, **open projects** with their briefs and job numbers, recurring tasks, and each team's workflow. Templates come from the seed (5 work templates, project template plans).
- [ ] **2.2 Teams** — every person who does project work is in a work team (22 were not).
- [ ] **2.3 Re-announce the rule** (owner, in person or video, then in the app's announcements): *from Monday 19 October, work that is not in the app does not count; the Google Sheets are read-only.* Make the sheets read-only that day.
- [ ] **2.4 Lead routine**: each lead reads their team's plans by 09:30 and reports by 09:00 next day, and approves the week's time on Monday (D22).
- [ ] **2.5 Phones**: every person installs the app to the home screen (PWA) and turns on push — iOS pushes only to the installed app. One real iPhone and one Android push test by the owner first. Messenger / Telegram linking for those who prefer it.
- [ ] **2.6 Fix what blocks people, fast**: whatever the feedback inbox and the leads report in the first two weeks goes to the top of Claude Code's queue; a fix ships the same day if it can (§3).

**Seed / load** — clients, contacts, retainers, projects, teams, recurring tasks, through the screens. CRM's stages, rate card and quote template are seeded and **placeholders until Q27–Q28**.

**Check**
- [ ] Appendix §B6 (EOD rate) every morning in the owners' channel: target **≥ 90 % of expected reports, Mon–Fri, 10 working days running**. Collaborators and `owner` holders are not counted (D23 as amended).
- [ ] Every active project has a lead, a client (or "internal") and at least one open task.
- [ ] Time entries exist for every team that bills by the hour.

**Gate M2**: ≥ 90 % EOD for 10 working days; real clients and open projects loaded. If the rate stalls below 70 % after the re-announcement, stop adding new waves to people's day until it recovers — the leads' routine is the lever, not more reminders.

---

## W3 — Attendance and leave (Mon 19 Oct → Tue 3 Nov, then to 1 Dec)

The first locked month is the foundation of payroll: no locked month, no parallel run.

**Do**

- [ ] **3.1 Holidays** — `/attendance/settings/calendar`: HR confirms the 2026 and 2027 public holidays (seeded `unconfirmed`), adds company days off. **There is no 2028 data** — put "seed 2028 holidays" in the ops tracker for November 2027.
- [ ] **3.2 Schedules and shifts** — `/attendance/settings/schedules`, `/shifts`: the real working hours per unit; Saturday WFH untracked (D15) unless Q15 decides otherwise.
- [ ] **3.3 Locations** — `/attendance/settings/locations`: each office's real coordinates, radius and public IP(s).
- [ ] **3.4 Attendance policy per entity** — `/attendance/settings/policy`: grace, rounding, OT rules, monthly correction cap (default 3), whether corrections or holiday work need an HR step (`MVP_STATUS.md` §4.E). From Phase 12 on, HR's saves become **proposals the owner approves** at `/approvals/rule/[id]`.
- [ ] **3.5 Clocks (Q5)** — name the device models; import one real export at `/attendance/devices/import` and adjust the mapping profile; map each device user id to a person. Until Q5 is settled the file import is the way.
- [ ] **3.6 Face kiosk** — open `/attendance/kiosk` on each wall tablet (modern device; iPadOS 17.0 is not supported); everyone re-enrols (SFace templates are not the NAS's); record face consent. Then **switch off the NAS kiosk** and delete its face store (`R5_PRIVACY_DECISIONS.md` §3).
- [ ] **3.7 Leave types and policies** — `/leave/admin/types`: the 11 seeded types reviewed by HR against the company handbook (annual days, carry-over, `COMP` kept — a lock carrying time off in lieu fails without it). Saves are proposals for the owner.
- [ ] **3.8 Leave opening balances** — `/leave/admin/import` (Mã NV, Loại phép, Năm, Số ngày còn lại, Tính đến ngày) **as of 1 October**, checked by HR per entity.
- [ ] **3.9 The October lock** — by Mon 2 Nov each person confirms their month, leads approve, HR locks per entity (FR-PAY-30: locked by the 2nd). Use **Recompute** on the team timesheet before locking if a policy changed during the month.
- [ ] **3.10 Tết 2027 leave** — open leave booking for late January / February 2027 by **1 December** (LVE-01); announce the company's Tết days off in the calendar first.

**Seed / load** — holidays (confirm), schedules, locations, policies, device mapping, face enrolment, leave opening balances. No script; `pnpm db:recompute` is local-only — production uses Recompute on the screen or the `timesheet-recompute` job.

**Check**
- [ ] §B7: 2026 and 2027 holidays all confirmed.
- [ ] §B8: October `timesheet_month` rows locked for every active employee of every entity.
- [ ] **The 20-person check** (Phase 2 exit): HR picks 20 people across entities and compares the locked October (days worked, leave, OT, lateness) with what they know; every difference is explained or fixed (and the month reopened with a comment).
- [ ] Leave ledger: each person's balance = opening + accrual − taken, for the same 20.
- [ ] Check-in p95 < 3 s on a phone over 4G at 08:00 (Vercel Speed Insights / Observability).

**Gate M3**: October locked everywhere, the 20-person check signed by HR. **November is locked the same way by Wed 2 Dec** — that is the month parallel run 1 pays.

---

## W4 — Knowledge base, comms, Ask SuZu AI to everyone (Mon 26 Oct – Mon 9 Nov)

**Do**

- [ ] **4.1 The real handbook and the top 20 SOPs** in the KB — import Markdown or .docx at `/kb/spaces/<space>/import` (arrives as draft), review, publish. The demo pages are samples and are deleted or archived.
- [ ] **4.2 Must-read** — decide which policies everyone (or a unit) must acknowledge, and the due period; reminders go every three days.
- [ ] **4.3 Company values** — replace the five placeholder values (kudos).
- [ ] **4.4 Onboarding checklist** — re-add the production checklist items with links to the real KB pages (items cannot be edited in place).
- [ ] **4.5 Unit spaces** — each unit head who wants one creates their unit's space (`kb:manage_unit`).
- [ ] **4.6 Ask SuZu AI to everyone** (`PHASE_13_OWNER_REVIEW.md` §5), after 4.1 is published so it answers from the real handbook:
  - read `/privacy` and `/terms`; confirm the no-training line matches the Anthropic account;
  - check `AI_MONTHLY_BUDGET_USD` (150) and the daily budgets in Vercel;
  - optional: a red-team-only eval first (about $0.30);
  - set `AI_AGENT_AUDIENCE=everyone`, redeploy;
  - announce with the two manual pages "Hỏi SuZu AI" and "Nhờ SuZu AI làm giúp".
- [ ] **4.7 Rewrite the evaluation set** against the real pages (the 160/212 questions were written for demo pages) before quoting any score about the real company.
- [ ] **4.8 Google Chat and Calendar** — set `GOOGLE_CHAT_WEBHOOK_URL` and the four `GOOGLE_CALENDAR_*` variables, **or decide to drop them** and say so in the manual. Today all Chat cards are "simulated" and interviews have no Meet link.

**Seed / load** — KB pages (import), values, checklist items. Embeddings follow by themselves (`kb-embeddings` job, midnight and morning).

**Check**
- [ ] Ask the agent ten real handbook questions in Vietnamese and two in English; each answer cites the real page.
- [ ] Week 1: `/assistant/unanswered?show=feedback` and `?show=usage` read twice; cost per day within budget.
- [ ] Acknowledgement report: the must-read policies are on their way to 100 %.

**Gate M4**: handbook live, agent on for everyone, and from **Mon 9 Nov** leave, requests and approvals are refused outside the app (DEVELOPMENT_PLAN §5.5).

---

## W5 — Requests, approvals, assets, ops tracker (Mon 2 – Fri 20 Nov)

**Do**

- [ ] **5.1 Request types** — `/admin/request-types`, `/admin/approval-flows`: HR and finance review the nine seeded types (purchase, payment, confirmation letter, advance, business trip, expense claim, equipment, stamp, IT support) — approvers, SLAs, thresholds (CEO above 20,000,000 ₫, 90-day claim age, 500,000 ₫ receipt rule: `MVP_STATUS.md` §4.F).
- [ ] **5.2 Document templates** — `/admin/document-templates`: counsel or the HR lead reads the seven drafts (confirmation letters, appointment, probation, termination, labour contract, `TM-NHAN-VIEC` offer) and the acceptance template `TM-NGHIEM-THU`; letterheads per entity. Until read, a generated document is reviewed by HR before it leaves the company.
- [ ] **5.3 Assets** — `/assets/import`: the real register (name, category, entity, serial, purchase date and price, holder by employee code). Digital assets and seats (licences, accounts) at the same time.
- [ ] **5.4 Ops tracker** — `/ops/templates`: the chief accountant and the HR lead review **every** obligation template (due rules, authority, evidence, which VAT/PIT variant per entity) and the owner marks each reviewed; set the owner/reviewer people where the role default picks the wrong person.
- [ ] **5.5 Expense claims** live from 1 November: no paper claims accepted for November expenses.

**Seed / load** — the register import; reviews of seeded types and templates.

**Check**
- [ ] §B9: obligation templates — 0 `unreviewed` among active ones.
- [ ] One request of each type end to end, by real people, including a rejection.
- [ ] Asset count matches finance's fixed-asset list.

**Gate**: templates reviewed before the December statutory deadlines are generated from them.

---

## W6 — Recruitment and CRM (Mon 2 Nov – Fri 18 Dec)

**Recruitment — do**
- [ ] **6.1** HR rewrites the six candidate email wordings (drafts) and adds `{{privacy_url}}` to `REJECT_AFTER_REVIEW`.
- [ ] **6.2** Confirm careers retention (12 months), rate limits (6 applications / 60 form loads an hour) and consent wording; decide virus scanning (recommendation: accept now, ClamAV before the careers page is promoted).
- [ ] **6.3** One real opening end to end: hiring request → opening → pipeline → interview → offer letter (PDF) → hire → onboarding checklist (Phase 7 exit).

**CRM — gated on the owner's answers to Q26 (who sells), Q27 (stages, discount threshold), Q28 (rate card, quote wording), Q29 (commission, before the first commission month)**
- [ ] **6.4** Answer Q26–Q29; grant `sales` / `marketing`; replace the seeded stages, rate card and quote template.
- [ ] **6.5** A **pilot month (December)**: every new deal, quote, invoice and payment in the app; finance reconciles invoices and payments against its ledger at month end (Phase 11 exit).

**Check** — the candidate received all four letters (Resend log); the December CRM ledger reconciles to the đồng.

---

## W7 — Performance (Mon 9 Nov – January)

**Do**
- [ ] **7.1** HR adapts the seeded **annual** review form; opens the **2026 year-end review cycle by Mon 16 Nov** (PRF-01: before 1 December). Only HR calibrates and releases (owner's answer, 5 Oct).
- [ ] **7.2** The **performance weighting version** and the **bonus scheme version** for 2026 — real ones, approved (placeholders today; Q14 open). If Q14 is not answered by 15 December, the 2026 bonus is computed outside the app and the app's run waits for 2027.
- [ ] **7.3** January 2027: the real group, entity and unit **OKRs** and each person's goals/KPIs (the seeded 17 KPI definitions are placeholders); the first month's KPI scores checked by HR in February (Phase 3.5 exit).

**Check** — cycle at calibration by mid-December; every eligible person has a released review before the bonus is paid.

---

## W8 — Payroll (Tue 20 Oct → January 2027 pay)

Payroll is the one module with a mandatory parallel run and written sign-off (DEVELOPMENT_PLAN §5.6, FR-PAY-38). Its gates are legal and human, not technical.

**Do**

- [ ] **8.1 Book the chief accountant** (by 23 Oct) for two sessions:
  - `/admin/rules`: verify **every** Appendix A value (insurance rates and caps, union dues and cap, PIT brackets and deductions, regional minimum wages, OT multipliers and caps, night window, `overtime.holiday_pay` (Q13), `leave.payout_basis`, probation, `insurance.unpaid_leave_threshold`, `pit.overtime_exemption`) and mark it verified;
  - **PAY-10**: night OT on rest days and holidays (engine 250 %/350 % vs Decree 145/2020 art. 57 270 %/390 %), allowance pro-rating for joiners and leavers (→ a per-entity policy), PIT month basis (work month vs paid on the 5th);
  - the 33 pay components' tax and insurance treatment (incl. `SEVERANCE`, `EXPENSE_REIMBURSE` exempt), the group payroll policy, Simple-profile PIT treatment;
  - the VCB and ACB payment layouts, D02-LT change codes, PIT indicators [21]–[37].
  Each answer that changes code becomes a Claude Code PR, merged by **Fri 13 Nov**.
- [ ] **8.2 Golden files** — the last three months of real payroll Excel **per entity**, anonymised, into `src/modules/payroll/engine/golden/`; the tests must match to the đồng (Phase 5 exit). Anonymise on the owner's machine before the file enters the repository — **the repository is public**.
- [ ] **8.3 Q16 / PDPL with counsel** — the cross-border transfer impact assessment covering Supabase, Vercel, Cloudflare (R2, Workers AI), Resend, Anthropic; processor agreements on file (Cloudflare DPA confirmed); the public privacy text updated with retention periods and the GPS notice. **No real salary enters production before this is closed** (SRS Q16, R3).
- [ ] **8.4 Pay data** (after 8.3), step-up required:
  - `/payroll/salaries/import` — pay profiles (Statutory / Simple, tax residency, PIT method, Cam kết 08, union) and salaries effective 1 October; imports arrive **pending** and are approved on screen;
  - each person's bank account and tax code (the variance check lists who lacks one);
  - per-entity settings: pay day, variance threshold, who signs, union on/off, proration basis.
- [ ] **8.5 Parallel run 1 — November pay** (calc 3 Dec, Excel pays on 5 Dec as usual):
  - the November timesheets locked (W3);
  - run the November payroll in the app to `calculated`;
  - import the Excel figures at `/payroll/parallel` (Mã NV, gross, insurance, union, PIT, net, employer cost);
  - every difference classed as **system bug / spreadsheet error / rule gap**; bugs fixed, rule gaps decided and recorded;
  - the app's run is **not** paid and not sent; cancel it after the comparison.
- [ ] **8.6 Parallel run 2 — December pay** (calc 3 Jan): the same, plus a retro item and one leaver, to prove both. Sign-off record by owner, HR lead and chief accountant: zero unexplained differences per entity.
- [ ] **8.7 Go live — January 2027 pay.** Calculate 1–3 Feb, approve, bank file, pay. **Tết is Saturday 6 February**: pay no later than Thu 4 Feb, and have the Excel computed the same month as a shadow, compared before the bank file is sent. If any difference is unexplained on 3 Feb, pay from Excel and move go-live to February pay.
- [ ] **8.8 Payslips** — employees read their payslip in the app (no payslip email yet, FR-PAY-32); tell them where.
- [ ] **8.9 After two clean live months** (January, February), retire the payroll Excel: archived read-only, owner-announced.

**Check**
- [ ] §B10: 0 unverified statutory parameters in force.
- [ ] Golden tests green on real files in CI.
- [ ] A line manager opening a payroll URL gets 404; a payroll page asks for step-up.
- [ ] The bank file opens in the bank's portal **in test mode** before it is used for money.

**Gates**: M5 (8.1–8.3 done) before 8.4; M6 and M7 signed before 8.7.

---

## 4. Communications and training

| When | To whom | What | By |
|---|---|---|---|
| Fri 16 Oct | Everyone | "This is how we work now": the app is the record for daily work; where to get help (the manual, Ask SuZu AI, your lead); sign-in-again note for 0.6 | Owner (video, 2 min) + announcement |
| Week of 19 Oct | Leads | 45 min: reading plans and reports, approving time, approvals, their team view | Owner |
| Week of 19 Oct | HR | 90 min: people, org, leave admin, attendance settings, imports, see-as | Owner |
| Week of 26 Oct | Everyone, per team | 30 min: phone install + push, check-in / kiosk, leave, requests, plans and reports | Team lead + HR champion |
| Week of 2 Nov | Finance / accountant | Payroll screens, parallel import, rules page | Owner |
| Each release | Everyone affected | One line in announcements + a 2-minute screen recording linked from the KB | Owner |

Help lives in the KB manual (`docs/manual`, published by `kb:manual`). Feedback is the in-app button; the owner reads the feedback inbox daily during the rollout.

---

## 5. Hypercare — the first two weeks of each wave

- **Daily, 09:30, 10 minutes (owner):** Admin → Jobs (yesterday's schedules), the failed-deliveries tile, Sentry `production`, the feedback inbox, §B6 EOD rate, healthchecks.
- **Weekly, Monday (owner + HR + leads, 30 min):** adoption numbers (§B6, sign-ins in 7 days, leave requests in-app vs outside, requests opened), the top five complaints, what ships this week.
- **Severity and response:** blocks pay or data exposed → fix or roll back the same hour ([incidents.md](runbooks/incidents.md)); blocks a daily task for a team → same day; annoyance → the next weekly batch.
- **Freeze**: no feature merges 1st–5th of each month from November (lock and pay days), and none in the two days before Tết pay.

---

## 6. Rolling back, per module

| What | How | Cost |
|---|---|---|
| A bad deploy | Vercel → previous build → Promote; `cache:flush` | Minutes; the schema stays new (migrations are backward-compatible) |
| Data written wrongly | [restore.md](runbooks/restore.md) — few records from a backup, never a full restore first | Hours |
| The whole app during a restore | `MAINTENANCE_MODE=on` in Vercel, redeploy | Everyone sees the maintenance page |
| Ask SuZu AI | `AI_AGENT_AUDIENCE=pilot`, or `AI_AGENT_ENABLED=off` (quoted passages return) | Minutes |
| People module for staff | `/admin/flags` → `people` off | Instant |
| Daily work | No technical rollback by design (D28); the sheets are readable for history | — |
| Payroll month | Pay from the Excel shadow; cancel the app's run | That month only |
| A policy change by HR | It is a proposal until the owner approves; an approved one is replaced by a new effective-dated version | — |

---

## Appendix A — production environment, by name

**A1. Must be set:** `POSTGRES_URL`, `POSTGRES_URL_NON_POOLING`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL=https://suzu.one`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` (redirect URIs `/api/auth/callback/google` **and** `/api/step-up/callback`), `ALLOWED_WORKSPACE_DOMAINS`, `STEP_UP_DRIVER=google`, `DATA_ENCRYPTION_KEYS`, `DATA_BLIND_INDEX_KEY`, `CRON_SECRET`, `CLOUDFLARE_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `STORAGE_BUCKET`, `RESEND_API_KEY`, `EMAIL_FROM`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`, `CLOUDFLARE_AI_API_TOKEN`, `ANTHROPIC_API_KEY`, `SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_DSN`, `SENTRY_ENVIRONMENT=production`.

**A2. Production only (never Preview):** `CRON_PING_URL`, `PUBLIC_SITE_URL`.

**A3. Switches to know:** `AI_AGENT_ENABLED`, `AI_AGENT_AUDIENCE` (`pilot` → `everyone` in W4), `AI_AGENT_PILOT_EMAILS`, `AI_MONTHLY_BUDGET_USD`, `AI_DAILY_BUDGET_USD_{EVERYONE,LEADS,OFFICE}`, `MAINTENANCE_MODE`, `CSP_MODE` (`report-only` → `enforce` after two quiet weeks of reports), `DATA_CACHE`, `BOOTSTRAP_OWNER_EMAILS` (empty it once the owners exist).

**A4. Decide or drop:** `GOOGLE_CHAT_WEBHOOK_URL`; `GOOGLE_CALENDAR_ID`, `_SERVICE_ACCOUNT_EMAIL`, `_SERVICE_ACCOUNT_KEY`, `_IMPERSONATE` (all four, never yet run); Messenger (`MESSENGER_*`, then `pnpm messenger:setup`) and Telegram (`TELEGRAM_*`, then `pnpm telegram:setup`) are live — check their tokens have not expired.

**A5. Backups (GitHub environment `backups`, not Vercel):** variables `BACKUPS_ENABLED`, `AGE_RECIPIENT`, `R2_ENDPOINT`, `BACKUP_BUCKET`, `FILES_BUCKET`, `FILES_BACKUP_BUCKET`, `GCS_BUCKET` (bare name), `GCP_WORKLOAD_IDENTITY_PROVIDER`, `GCP_SERVICE_ACCOUNT`; secrets `BACKUP_DATABASE_URL`, `R2_BACKUP_KEY_ID/SECRET`, `R2_FILES_READ_KEY_ID/SECRET`, `HC_PING_URL`.

## Appendix B — read-only checks

Run in Supabase → SQL Editor. They return counts only, no personal data.

```sql
-- B1  the seed's Phase 12 additions are present
select (select count(*) from review_template) as review_forms,
       (select count(*) from pay_component where code = 'SEVERANCE') as severance,
       (select count(*) from request_type) as request_types;

-- B4  people without a unit or a line manager
select count(*) filter (where org_unit_id is null) as no_unit,
       count(*) filter (where manager_id is null)  as no_manager,
       count(*)                                    as active
from person where status = 'active';

-- B5  role grants in force
select role, count(*) from role_assignment
where valid_to is null or valid_to >= current_date
group by role order by role;

-- B6  end-of-day reports, last 10 working days (owners and collaborators not counted, D23)
with asked as (
  select p.id from person p
  where p.status = 'active' and p.workforce_type <> 'collaborator'
    and not exists (select 1 from role_assignment r
                    where r.person_id = p.id and r.role = 'owner'
                      and (r.valid_to is null or r.valid_to >= current_date)))
select d::date as day,
       count(dr.id) filter (where dr.submitted_at is not null) as reports,
       (select count(*) from asked) as asked
from generate_series(current_date - 14, current_date - 1, interval '1 day') d
left join daily_report dr on dr.date = d::date and dr.person_id in (select id from asked)
where extract(isodow from d) between 1 and 5
group by d order by d;

-- B7  holidays still unconfirmed, per year
select extract(year from date) as year, count(*) filter (where not is_confirmed) as unconfirmed, count(*)
from calendar_day group by 1 order by 1;

-- B8  locked timesheet months
select month, count(*) filter (where locked_at is not null) as locked, count(*) as people
from timesheet_month group by month order by month desc limit 3;

-- B9  obligation templates by review status
select review_status, count(*) from obligation_template where is_active group by 1;

-- B10 statutory parameters in force and not verified
select count(*) filter (where not is_verified) as unverified, count(*) as in_force
from statutory_parameter
where voided_at is null and valid_from <= current_date and (valid_to is null or valid_to >= current_date);

-- B11 jobs in the last 24 hours
select job, result, count(*) from job_run
where started_at > now() - interval '1 day' group by 1, 2 order by 1, 2;
```

*B1's table names (`review_template`, `pay_component`, `request_type`) are the modules' own; if one has been renamed, Admin → the module's settings page shows the same thing.*

## Appendix C — decisions still owed, with their deadline

| # | Decision | Who | By | Blocks |
|---|---|---|---|---|
| 1 | Role grants table (W1 1.6) and the six owners | Owner | 21 Oct | M1 |
| 2 | Q12 entity legal, tax, insurance, bank data | Owner + accountant | 21 Oct | M1, payroll |
| 3 | Q5 clock models | Owner + HR | 26 Oct | W3 device import |
| 4 | Q15 Saturday WFH: full or half day, counts for pro-rating? | Owner + accountant | 26 Oct | October lock |
| 5 | Per-entity attendance and leave settings (`MVP_STATUS.md` §4.E) | Owner + HR | 28 Oct | October lock |
| 6 | Google Chat / Calendar: set or drop | Owner | 6 Nov | W4 |
| 7 | Q13, PAY-10, Appendix A, components, layouts | Chief accountant | 13 Nov | M5 |
| 8 | Q16 PDPL, processor agreements, privacy text | Owner + counsel | 20 Nov | Real salaries in production |
| 9 | Virus scanning | Owner | 20 Nov | Careers promotion |
| 10 | Q26–Q29 CRM | Owner | 27 Nov | CRM pilot month |
| 11 | Q14 bonus formula, performance weighting | Owner | 15 Dec | 2026 bonus in the app |
| 12 | The rules chosen by the build (`MVP_STATUS.md` §4.F, `PHASE_12_OWNER_REVIEW.md` §3, `PHASE_13_OWNER_REVIEW.md` §4) — confirm or overrule | Owner | 30 Nov | — |
