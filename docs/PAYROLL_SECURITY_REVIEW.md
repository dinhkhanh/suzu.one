# Payroll security review

**Performed 2026-09-20** against the payroll module as built in Phase 5 (weeks 1–6) on branch `mvp`,
commit `9a72af5` plus the fixes this review produced. Required by NFR-SEC-07 ("security review before
each major module goes live, especially payroll") and by the phase's exit criterion
"a penetration-style review of the compensation endpoints is done".

This is a review of the code **and of the running system**: every claim below was checked against a
seeded local instance over HTTP with forged sessions for ten personas, and the checks that can be
made permanent were written as tests. What was not exercised is said so plainly in
[Not covered](#not-covered).

**Verdict:** no way was found for anyone outside `self / C&B / owner` to read a person's pay, and no
figure was found outside the encrypted columns. Five findings were raised; **four are fixed**
(§ Findings 1–4) and one is accepted with a recommendation (§ Finding 5).

---

## 1. How the review was carried out

A fresh database (`pnpm db:migrate && pnpm db:seed && pnpm db:seed:demo`, then `pnpm db:recompute`
and `pnpm db:seed:demo:payroll` with the dev server up), which leaves August 2026 paid and locked for
three entities with 16 payslips, and September a draft.

Sessions were forged directly in the `session` table (local verification note), one per persona, with
a fresh `reauth_at`, and a second set with `reauth_at` two hours old to test step-up:

| Persona | Person | Grant |
|---|---|---|
| `owner` | owner@suzu.vn | `owner`, group |
| `ceo` | ha.nguyen@suzu.vn | `c_level`, group — signs runs |
| `hradmin` | mai.le@suzu.group | `hr_admin`, group — the HR lead / C&B |
| `cb` | ngan.vu@suzu.group | `payroll`, **SZC only** — the other entity's C&B |
| `finance` | tuan.vo@suzu.group | `finance`, group — the chief accountant |
| `hrstaff` | bao.pham@suzu.group | `hr_staff`, SZM — HR without compensation |
| `head` | long.dang@suzu.group | `department_head` — a line manager |
| `staff` | huy.ho@suzu.group | an employee, and the subject of a payslip |

The production build (`pnpm build && pnpm start`) was used for the cache-header and PDF checks,
because the dev server overrides response headers.

## 2. The rule being tested

Compensation never follows the org chart (`src/modules/payroll/policy.ts`):

- a person's **own** pay — always;
- **`payroll:propose`** over that person's entity (C&B, the HR lead) and the owner's `*` — a person's
  salary, payslip, run result, statutory filings, parallel-run figures;
- **`payroll:read`** over the entity (adds the CEO, the chief accountant, auditors) — run totals, the
  variance list, the cost/union/trend reports. **Not** an individual's full result;
- **`payroll:approve`** / **`payroll:pay`** — the signing and payment steps only;
- everybody else, including **line managers, department heads, entity directors and HR staff** —
  nothing. `readableTier()` and its "a manager reads their reports' personal data" clause is
  deliberately never consulted by this module.

---

## 3. Read paths and actions — the inventory

### 3.1 Pages and route handlers

Every page calls `requireStepUp(user, path)` after deciding it exists, so a person who may not see it
gets `notFound()` rather than a step-up prompt that would confirm it exists. `/payroll` itself is a
link list with no figures and needs no step-up.

| Route | Who | Proven by |
|---|---|---|
| `/payslips`, `/payslips/[payslipId]` | self, C&B over the entity, owner | `payslips.test.ts`; HTTP matrix §4.1 |
| `/payslips/[payslipId]/pdf` (handler) | same, 403 on a stale session | HTTP §4.1, §5 |
| `/payroll/salaries`, `/salaries/[personId]`, `/changes/[requestId]`, `/decisions/[structureId]` | self, C&B, owner | `salaries.test.ts`; week 1 HTTP matrix |
| `/payroll/runs`, `/runs/new`, `/runs/[runId]` | `payroll:read` over the entity; person detail needs C&B | `lifecycle.test.ts`, `run-views`; week 4 HTTP matrix |
| `/payroll/runs/[runId]/payments`, `…/payments/cash-sheet` (handler) | `payroll:pay` or C&B | `payments.test.ts`; week 5 HTTP matrix |
| `/payroll/reports` | `payroll:read`; the three reports that name people need C&B | `reports.test.ts` (SQL-level) |
| `/payroll/statutory` | C&B over the entity, owner | §4.1, §4.2 |
| `/payroll/parallel` | C&B over the entity, owner | §4.1, §4.3 |
| `/payroll/ytd` | C&B over the entity, owner | §4.1 |
| `/payroll/queries` | C&B (the queue) / the asker | week 5 |
| `/payroll/components`, `/payroll/policy`, `/payroll/profiles` | rule readers; deciding is the owner's | `policy.test.ts` |
| `/payroll/profiles/simple` | **owner only** (FR-PAY-08, risk R11) | `policy.test.ts` |
| `/payroll/tools/net-to-gross` | C&B, owner | week 3 |

### 3.2 Server actions

All **32** payroll actions go through `createAction` with `stepUp: true` and a payroll permission
check — verified mechanically over `src/modules/payroll/*actions*.ts`; there is no action in this
module without both. The two imports (`payroll_parallel`, `payroll_ytd`) are built by
`defineImport`, and are covered by finding 2 below and by `imports.test.ts`.

Actions that take an id (`runId`, `payslipId`, `queryId`, `requestId`, `structureId`) **load the row
first and authorize against its own entity**, never against the entity in the request body.

---

## 4. Findings and probes

### 4.1 Access matrix, over HTTP

Page responses (production build gives the same codes):

```
PATH                                    owner ceo hradmin cb finance hrstaff head staff
/payroll/statutory                       200  404   200   200   404     404   404  404
/payroll/parallel                        200  404   200   200   404     404   404  404
/payroll/ytd                             200  404   200   200   404     404   404  404
/payslips/<Huy's payslip>                200  404   200   404   404     404   404  200
/payslips/<id that does not exist>       404  404   404   404   404     404   404  404
/payroll/runs/<SZM August>               200  200   200   404   200     404   404  404
```

- The CEO and the chief accountant see the **run** (totals, variance) and not the **payslip** — the
  two levels of sight week 4 established.
- `cb` (C&B of SZC) is refused SZM's payslip and SZM's run: a payroll grant is per entity.
- **IDOR:** an id that does not exist and an id the viewer may not see answer **identically** (404,
  same body, same headers). `/payslips/<Tam's payslip>` as Huy → 404, and its PDF → 404.
- Signed out → 307 to `/sign-in` for all of them.

### 4.2 Statutory exports (new in week 6)

`payroll_statutory.export` for **SZM's** 05/KK-TNCN data:

```
owner → ok (12 rows)   hradmin → ok (12 rows)
cb → forbidden   ceo → forbidden   finance → forbidden
hrstaff → forbidden   head → forbidden   staff → forbidden
cb on its own entity (SZC) → ok (12 rows)
```

Each refusal wrote a `payroll_statutory.export.denied` audit row (6 of them). Each success wrote
`payroll_statutory.export` with `{kind, period, rows}` — the filing's name and size, never a figure
from inside it.

### 4.3 Parallel run (new in week 6)

`payroll_parallel.set_reference` and `payroll_parallel.classify` on SZM: `ok` for owner and the group
C&B; `forbidden` for `cb`, `ceo`, `finance`, `hrstaff`, `head`, `staff`, each with a `.denied` audit
row (6 + 3).

### 4.4 Trying to make the system talk

| Attempt | Result |
|---|---|
| `period: "9999-99"` | `invalid`, `fieldErrors.period = ["invalid_format"]` — no figure, no SQL |
| `kind: "../../etc"` | `invalid`, `fieldErrors.kind = ["invalid_value"]` |
| `entityId: "not-a-uuid"` | `invalid` — refused by the schema before any query |
| finalization for a year with no data | `statutory_export_not_available` — the same answer whether the year is empty or the entity is wrong |
| a person's certificate for somebody else | authorize refuses unless C&B over that entity |

No error message in the module interpolates an amount; the failures are fixed message keys
(`statutory_export_not_available`, `report_not_available`, `step_up_required`, `run_not_settled`).

### 4.5 Nothing readable at rest

Every monetary column is envelope ciphertext bound to its own row:

```
payroll_run.totals_enc              3/3   v1.…
payroll_run_person result+input    16/16  v1.…
salary_structure.terms_enc         19/19  v1.…
payroll_cash_payment.amount_enc     3/3   v1.…
payroll_payment_file.total_enc      7/7   v1.…
payroll_parallel_reference          1/1   v1.…
payroll_parallel_finding            1/1   v1.…
```

The only numeric columns in the clear across all payroll tables are `headcount`, `row_count`,
`skipped_count`, `calc_done`, `calc_total`, `view_count`, `months`, `year`, `sort_order` and
`pay_component.exempt_cap` — counts, progress and a **rule** (a statutory cap is not about a person).
`payslip` holds no amount at all; it points at the run person row.
A ciphertext moved to another row fails to decrypt (`parallel.test.ts`, last case).

### 4.6 Nothing readable in passing

| Channel | Checked | Result |
|---|---|---|
| `audit_log` | every `payroll*` / `salary*` row (21) for a 6-digit run | 2 matches, both a **UUID fragment** in `personId`; no amounts |
| `notification` | `params` for 6-digit runs | 0 |
| `email_outbox` | subject + body for `123.456`-shaped money | 0 |
| `job_run.result` | payroll jobs | counts and statuses only |
| KB index / search | `kb_page_chunk` is built from KB pages only; payroll writes nothing to it | by construction |
| Server log | finding 3 below |

---

## Findings

### Finding 1 — the statutory export action was dead (fixed) · severity: medium (availability)

`statutory-export-actions.ts` is a `"use server"` file and exported `STATUTORY_EXPORTS` (an array).
Next refuses that at runtime — *"a `use server` file can only export async functions, found object"* —
so **every statutory export returned HTTP 500**. The page rendered, so nothing in build, typecheck,
lint or the unit tests caught it; only calling the action did.

Fixed: the list moved to a plain module, `src/modules/payroll/statutory-kinds.ts`. Re-probed: §4.2.

*Lesson worth keeping:* a `"use server"` file must export async functions only. Nothing enforces this
at build time, so any constant shared between an action and its form belongs in a plain module.

### Finding 2 — the two payroll imports were not behind step-up (fixed) · severity: medium

`parallel_import` and `ytd_import` upload a spreadsheet of everybody's pay, but the import framework
built its `stage` and `commit` actions without `stepUp`, so a session whose re-authentication had
gone stale could still upload and commit compensation figures. Their `authorize` was correct
throughout (C&B over the entity), so this was a **missing second factor, not a missing check**.

Fixed: `ImportDefinition` gained an optional `stepUp`, passed to both actions; both payroll imports
set it. `defineImport` now also returns its `definition`, so an import's demands can be tested
without a file upload — `src/modules/payroll/imports.test.ts` pins step-up, the nine-persona
authorize matrix, and that every money column is marked `sensitive` (a staged batch waits encrypted).

### Finding 3 — the dev server logged salary figures (fixed) · severity: low (development only)

Next logs every server-function call **with its arguments** in development. Payroll actions take
amounts as arguments, so a developer's terminal held lines like:

```
ƒ setParallelReferenceAction({"employeeInsurance":"2625000","gross":"25000000", …})
```

Production does not do this, and NFR-SEC-06 already forbids production data on a developer's machine —
but a parallel run is precisely when real figures sit in a local database.

Fixed: `logging: { serverFunctions: false }` in `next.config.ts`. Re-probed: the same call now leaves
no figure in the log (0 matches).

### Finding 4 — the demo job could have run anywhere (fixed) · severity: medium

`payroll-demo-runs` locks timesheet periods and marks pay as disbursed. As first written it guarded
itself with a direct `process.env.NODE_ENV` read, which the configuration lint rightly refuses, and it
lived inside the payroll module reaching into attendance's internals.

Fixed: a single gate, `isDevelopmentEnvironment()` in `src/lib/env.ts` (false in a production build
and on Vercel), and the job moved to the composition root beside the cron route, where composing two
modules is allowed. The job throws before touching anything if the gate is false.

### Finding 5 — an out-of-reach `entityId` in a URL silently falls back · severity: low · **accepted**

`/payroll/statutory?entityId=<an entity the viewer may not see>` renders **their own** entity instead
of refusing: the pages resolve `entities.find(id) ?? entities[0]` from the viewer's own reach.

No data leaks — the fallback happens before any query, and the entity shown is one they may see — but
the page then disagrees with its own URL, which is a poor thing for an auditor reading over a
shoulder. `/payroll/parallel` and `/payroll/ytd` re-check `canManageCompensation` on the resolved id,
which is the belt-and-braces check, but the fallback still applies.

**Recommendation** (not done, to keep this review's changes small and reviewable): resolve the
`entityId` parameter strictly and `notFound()` when it is present and out of reach. Roughly ten lines
across four pages.

---

## Residual risks and things the owner must decide

- **The statutory and bank layouts are guesses.** Access to them is sound; their *contents* are
  unverified against HTTK / the BHXH portal / the banks' current templates. Every file says so, and
  each format module lists its assumed columns. This is a correctness risk, not a security one.
- **`payroll:read` shows net per person** in the variance list (what the CEO signs against). That is
  deliberate — one cannot approve a payroll one cannot see — but it means the CEO, the chief
  accountant and any auditor see every person's net. If the owner wants the CEO to sign against
  totals only, the variance list needs a second, blinded form.
- **Auditors hold `payroll:read` at `compensation` tier** in the role catalogue. Time-boxed grants
  (FR-ACL-07) do not exist yet, so an auditor's grant must be revoked by hand.
- **Step-up's real driver is untested.** The Google `prompt=login` / `max_age` round trip has never
  been exercised (no OAuth client reachable locally); only the local driver has. The local driver
  cannot be enabled in production (`stepUpDriverProblem`, tested).

## Not covered

- No automated scanner was run (no ZAP/Burp available offline); this was a manual, per-endpoint
  review with forged sessions.
- No load or timing analysis: response times were not compared between "forbidden" and "absent", so a
  **timing** oracle on payslip ids is not excluded (both paths do a database read, so a large
  difference is unlikely).
- The browser side was not exercised at all — no real session, no CSP report, no clickjacking test
  beyond the `X-Frame-Options: DENY` header being present.
- Rate limiting is still absent platform-wide (Phase 0's open item, NFR-SEC-03): nothing stops a
  signed-in person from enumerating payslip ids quickly. Every attempt is refused and audited, but
  the audit log is where it would be noticed, not the door.
