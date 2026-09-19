# Suzu One — Software Requirements Specification (SRS)

| | |
|---|---|
| **Product** | Suzu One (working name) — internal HRM + work platform for Suzu Group, CRM to follow |
| **Version** | 0.2 (owner's answers of 2026-09-19 incorporated) |
| **Date** | 2026-09-19 |
| **Owner** | Company owner (product owner and final approver) |
| **Companion doc** | [DEVELOPMENT_PLAN.md](./DEVELOPMENT_PLAN.md) |

Requirement priority uses MoSCoW: **M** = must have, **S** = should have, **C** = could have, **L** = later / out of scope for HRM v1.

---

## 1. Introduction

### 1.1 Purpose

Suzu Group runs social media marketing and media/creative services across several legal entities. HR data, attendance, leave, payroll, task assignment, internal knowledge and statutory deadlines currently live in spreadsheets, chat threads and people's heads. Suzu One replaces those with a single internal web application.

### 1.2 Product vision

One login, one place for everything an employee, a leader, HR, finance and the owner need to run the company's internal operations:

1. **HRM first** — employee lifecycle, attendance, leave, full Vietnamese payroll, recruitment, performance.
2. **Work management** — leaders assign and track work (Linear-style speed, but built for marketing/creative teams, not software teams).
3. **Operations & compliance tracker** — HR and finance never miss a recurring internal job (payroll, PIT, insurance) or an external obligation (tax filings, financial statements, government reports), per legal entity.
4. **Knowledge base and internal comms** — policies, SOPs, brand guidelines, announcements, with an AI assistant on top.
5. **CRM later** — sharing the same people, org, task and permission foundation so clients, deals, projects and staff cost connect.

### 1.3 Confirmed decisions (from owner, 2026-09-19)

| # | Decision |
|---|---|
| D1 | Company is a **group with multiple legal entities**. The data model is multi-entity from day one. |
| D2 | **Full Vietnamese payroll in-app** (gross→net, BHXH/BHYT/BHTN, PIT, payslips, bank export), built after attendance and leave are stable. |
| D3 | Attendance supports **both** app check-in (GPS / Wi-Fi) **and** biometric device log import. |
| D4 | Extras in scope: Recruitment (ATS), Performance & OKRs, Assets & Requests, Internal comms & AI assistant, Knowledge base. |
| D5 | Add **work/task management** for marketing and creative work, and an **HR/finance operations & compliance tracker** for internal and external recurring jobs. |
| D6 | Login is via **Google Workspace**, two separate workspaces: `suzu.vn` (5 C-level) and `suzu.group` (all other employees). |
| D7 | Stack is **Next.js**. HRM first, CRM later. |

Decisions added 2026-09-19 (owner's answers to the open questions):

| # | Decision |
|---|---|
| D8 | **Entities and org structure start from seed data** and are edited by the owner in the admin screens. **Departments are shared across entities** by default. |
| D9 | **Built and operated by the owner with Claude Code.** Documentation, ADRs, tests and runbooks are written so one person can maintain it. |
| D10 | **Hosting option A**: managed cloud in Singapore (Vercel + Supabase). The PDPL cross-border assessment is deferred but stays on the risk list. The architecture stays portable. |
| D11 | App domain: **`suzu.one`** (`suzu.work` held in reserve). |
| D12 | Payroll today is in Excel. **All contracts are gross-based** — any net deal is converted to gross when the contract is made. Salary is paid on the **5th of the following month**, from **Vietcombank (VCB)** and **ACB**. |
| D13 | Entities have trade unions. The **year-end (13th-month) bonus is performance-driven**: KPI and OKR results decide the amount, which can exceed one month's salary. |
| D14 | Freelancers and collaborators get access **only through a company Google Workspace email created by HR**. The app has no guest or external accounts; their access is limited by role. |
| D15 | **Saturday is a work-from-home day with no attendance tracking.** Work on public holidays and rest days is allowed and paid at the statutory multipliers. |
| D16 | Nothing to migrate or integrate from existing tools (beyond Excel master data). |
| D18 | **Two pay profiles** exist in every entity: **(1) Statutory** — full insurance, trade union, PIT, paid by bank transfer from the company account; **(2) Simple** — salary only, no insurance/union/PIT, paid in cash by the chief accountant. |
| D17 | **Payroll governance**: the owner decides the rules · the HR lead proposes each monthly payroll · the CEO signs to approve it · the chief accountant prepares the bank transfer. |

### 1.4 Assumptions (please correct any that are wrong)

| # | Assumption |
|---|---|
| A1 | All entities and employees are in Vietnam; timezone `Asia/Ho_Chi_Minh`; currency VND. Vietnamese labour, insurance and tax law applies. |
| A2 | UI is bilingual **Vietnamese (default) + English**. |
| A3 | Headcount is in the tens to low hundreds (exact figures per entity to be entered by the owner). The system is designed for up to ~1,000 people without re-architecture. |
| A4 | The workforce includes non-standard types common in creative agencies: probation, interns, part-time, and **freelancers/collaborators (CTV)** on service contracts, who get a workspace email from HR when they need app access (D14). |
| A5 | Web app, mobile-first responsive, installable as a PWA. No native iOS/Android app in v1. |
| A6 | Hosting is managed cloud (Vercel + Supabase Postgres in Singapore) — confirmed, D10. |
| A7 | Two-factor authentication is enforced at the Google Workspace level, not re-implemented in the app. |
| A8 | The app is internal only. The single public surface is the careers page / job application form. |

### 1.5 Glossary

| Term | Meaning |
|---|---|
| Group | Suzu Group as a whole (top-level tenant) |
| Entity | A legal company within the group (has its own tax code, insurance code, payroll, statutory filings) |
| ESS / MSS | Employee self-service / manager self-service |
| BHXH, BHYT, BHTN | Social, health and unemployment insurance |
| PIT (TNCN) | Personal income tax |
| CTV | Collaborator / freelancer on a service contract |
| C&B | Compensation & benefits (payroll team) |
| Obligation | A recurring internal or external job with a deadline (e.g. monthly PIT declaration for Entity X) |
| PDPL | Law No. 91/2025/QH15 on Personal Data Protection, in force from 2026-01-01 |

---

## 2. Users, roles and access model

### 2.1 Personas

| Persona | Main needs |
|---|---|
| **Owner / Chairman** | Group-wide visibility: headcount, cost, attendance, workload, deadlines at risk. Final approvals. Full admin. |
| **C-level (suzu.vn)** | Cross-entity dashboards for their function; approvals; OKRs. |
| **Entity director** | Everything within their entity. |
| **HR admin / HR staff** | Employee records, contracts, onboarding/offboarding, leave and attendance administration, recruitment, policies. |
| **C&B / payroll specialist** | Salary data, payroll runs, insurance and PIT, payslips. |
| **Finance / accountant** | Payroll cost, bank files, statutory filing tracker, expense and purchase requests. |
| **Department head / team leader** | Approve leave/OT/requests, assign and track tasks, review team performance, see team attendance. |
| **Employee** | Check in, request leave, see payslip, do tasks, read policies, find colleagues. |
| **Recruiter / hiring manager** | Job openings, candidate pipeline, interviews, feedback. |
| **IT / asset admin** | Asset register, handover. |
| **Auditor (read-only)** | Time-boxed read access for audits. |
| **Candidate (external)** | Apply via public careers page. No login. |

### 2.2 Permission model

Access = **role** × **scope** × **sensitivity tier**.

- **Scope**: `group` → `entity` → `department` → `team` → `direct reports` → `self`.
- **Sensitivity tiers**: `public-internal` (name, title, work email), `personal` (phone, address, DOB), `restricted` (ID number, bank account, contracts, health/insurance), `compensation` (salary, payslips, payroll).
- A line manager sees `personal` data of their reports but **never `compensation`** unless explicitly granted. Compensation is visible only to: the employee (self), C&B, entity director (optional, configurable), owner.

| ID | Requirement | Pri |
|---|---|---|
| FR-ACL-01 | Roles are assigned explicitly per user, each with a scope. A user can hold several role+scope pairs (e.g. HR staff for Entity A, employee in Entity B). | M |
| FR-ACL-02 | Domain (`suzu.vn` vs `suzu.group`) **never grants privileges by itself**. Roles are always explicit. | M |
| FR-ACL-03 | Every server-side data access passes through one central authorization layer. No authorization logic in UI components. | M |
| FR-ACL-04 | Field-level protection by sensitivity tier, applied in queries, exports, search results, and AI assistant retrieval. | M |
| FR-ACL-05 | Custom roles: admin can clone a role and adjust its permissions. | S |
| FR-ACL-06 | Delegation: an approver can delegate approvals to another person for a date range. | S |
| FR-ACL-07 | Time-boxed access grants (auditor, temporary cover) that expire automatically. | C |
| FR-ACL-08 | "View as" for admins to verify what a role can see, fully audit-logged. | C |

---

## 3. System overview

### 3.1 Module map

```
┌───────────────────────────────────────────────────────────────────────┐
│  Experience layer:  Employee home · Manager hub · HR console ·        │
│                     Finance console · Owner dashboard · Careers page  │
├───────────────────────────────────────────────────────────────────────┤
│  HRM                │ Work                 │ Company                  │
│  · Core HR          │ · Tasks & projects   │ · Knowledge base         │
│  · Attendance       │ · Operations &       │ · Announcements & feed   │
│  · Leave            │   compliance tracker │ · Surveys & kudos        │
│  · Payroll          │ · Requests &         │ · AI assistant           │
│  · Recruitment      │   approvals          │                          │
│  · Performance/OKRs │ · Assets             │ CRM (later)              │
├───────────────────────────────────────────────────────────────────────┤
│  Platform:  Auth (Google ×2) · Org & multi-entity · RBAC · Approval   │
│  engine · Task engine · Notifications · Files · Audit log · Search ·  │
│  i18n · Reporting · Statutory parameter store · Integrations · Jobs   │
└───────────────────────────────────────────────────────────────────────┘
```

Two platform engines are deliberately shared:

- **Approval engine** — one configurable workflow engine used by leave, overtime, attendance corrections, requests, payroll sign-off, recruitment offers, KB publishing.
- **Task engine** — one task model used by work management *and* the operations & compliance tracker *and* onboarding/offboarding checklists. Different experiences, one data model, one "My work" inbox.

### 3.2 External integrations

| System | Use | Pri |
|---|---|---|
| Google OAuth (both workspaces) | Sign-in | M |
| Google Calendar | Leave on calendar, interview scheduling, task due dates (opt-in) | S |
| Google Drive | Attach Drive files/folders to tasks, KB pages, employee documents (link + picker) | S |
| Google Admin Directory | Optional: suggest account creation on onboarding, suspension on offboarding; sync avatar and org unit | C |
| Google Chat / email | Notifications | M (email), S (Chat) |
| Biometric attendance devices | Log import (file upload first; device API/push later) | M |
| Banks | Bulk salary transfer file export (per-bank templates) | M |
| Accounting software (e.g. MISA) | Payroll journal export (Excel/CSV) | S |
| E-signature provider | Sign labour contracts and policy acknowledgements | C |

---

## 4. Functional requirements

### 4.1 Platform foundation (PLT)

#### Authentication

| ID | Requirement | Pri |
|---|---|---|
| FR-PLT-01 | Sign in with Google only. No passwords stored in the app. | M |
| FR-PLT-02 | Accept only accounts whose verified Google hosted-domain (`hd`) claim is in the allowlist (`suzu.vn`, `suzu.group`). Checked server-side on every sign-in; personal Gmail is rejected. The allowlist is configuration, so new group domains can be added. | M |
| FR-PLT-03 | Because the two workspaces are separate Google organisations, the OAuth client is configured as **External** (an "Internal" client only serves one workspace). Domain enforcement is therefore the app's responsibility (FR-PLT-02). | M |
| FR-PLT-04 | A user can sign in only if their email matches an **active person record** (or the bootstrap owner list in configuration). Unknown emails from allowed domains land on a "not provisioned — contact HR" page. | M |
| FR-PLT-05 | Offboarding or suspension revokes all sessions immediately. | M |
| FR-PLT-06 | Session policy: rolling sessions, idle timeout, shorter timeout + re-authentication for compensation screens and payroll actions. | M |
| FR-PLT-07 | Freelancers/collaborators sign in with the workspace email HR creates for them (D14) and receive a restricted **Collaborator** role: their own profile, tasks and projects they are members of, the KB spaces shared with them, and their own payment records. No directory-wide personal data, no org-wide feed unless granted. No non-workspace guest accounts. | M |

#### Organisation & multi-entity

| ID | Requirement | Pri |
|---|---|---|
| FR-PLT-10 | Hierarchy: Group → Legal entities → Branches/locations → Departments → Teams. Departments may be entity-specific or shared across entities. | M |
| FR-PLT-11 | Each entity stores: legal name, tax code, insurance unit code, address, legal representative, wage region (I–IV), bank accounts, payroll calendar, working calendar. | M |
| FR-PLT-12 | A person has exactly one **primary employment** (entity, contract, payroll) at a time, and may have secondary assignments (works on teams in other entities) that affect task and reporting lines but not payroll. | M |
| FR-PLT-13 | Reporting lines: line manager (solid) and optional dotted-line manager. Org chart is generated from them. | M |
| FR-PLT-14 | All org changes are effective-dated with history (who reported to whom, in which department, on any past date). | M |
| FR-PLT-15 | Inter-entity transfer process: close employment in entity A, open in entity B, preserve seniority and leave balance per policy. | S |

#### Approval engine

| ID | Requirement | Pri |
|---|---|---|
| FR-PLT-20 | Configurable flows per request type and entity: sequential and parallel steps; approver resolved by rule (line manager, department head, role holder, named user, requester's N-th level manager). | M |
| FR-PLT-21 | Conditions on request data (e.g. leave > 3 days adds department head; purchase > 20M VND adds director). | M |
| FR-PLT-22 | Actions: approve, reject, return for changes, comment, delegate, withdraw. Bulk approve for managers. | M |
| FR-PLT-23 | SLA reminders and escalation when a step is idle for N days. | S |
| FR-PLT-24 | Approve directly from the email / Chat notification via secure deep link. | S |

#### Notifications, files, audit, search, i18n

| ID | Requirement | Pri |
|---|---|---|
| FR-PLT-30 | In-app notification centre + email. Per-user channel preferences. Digest mode. | M |
| FR-PLT-31 | Google Chat notifications (webhook or app). | S |
| FR-PLT-32 | Private file storage with signed, expiring URLs; per-file permission inherits from the owning record; virus scan on upload; type and size limits. | M |
| FR-PLT-33 | **Audit log**: append-only record of every create/update/delete on HR, payroll, permission and configuration data, and every *read* of `restricted` and `compensation` data (who, what, when, from where). Searchable by admins. | M |
| FR-PLT-34 | Global search (Cmd/Ctrl-K): people, tasks, KB pages, requests — permission-filtered. | S |
| FR-PLT-35 | UI in Vietnamese and English; user-selectable; all dates, numbers and currency formatted for locale. Content (KB, announcements) is single-language per item with optional translation. | M |
| FR-PLT-36 | Data import (Excel/CSV) with validation preview and error report for: people, contracts, leave balances, salary, assets, attendance logs. | M |
| FR-PLT-37 | Data export to Excel/CSV/PDF on all list and report screens, permission-filtered and audit-logged. | M |
| FR-PLT-38 | **Statutory parameter store**: all legal rates, caps, brackets, deductions, minimum wages, holidays and OT multipliers are effective-dated configuration, never hard-coded. Changes are versioned and audit-logged. See Appendix A. | M |
| FR-PLT-39 | **Rule governance** (D17): changes to statutory parameters, pay components, formulas, leave and attendance policies are proposed by HR/C&B and take effect only after **owner approval**. | M |

---

### 4.2 Core HR (CHR)

| ID | Requirement | Pri |
|---|---|---|
| FR-CHR-01 | **Person record**: identity (full name, DOB, gender, nationality, citizen ID/CCCD with issue date/place, passport), contact, permanent and current address, emergency contacts, marital status, education, certificates, bank account(s), tax code, social insurance number, health insurance registered hospital, photo. | M |
| FR-CHR-02 | **Workforce types**: official employee, probation, intern, part-time, freelancer/CTV, advisor. Type drives which modules apply (e.g. CTV: no leave accrual, no insurance, PIT withholding on payments). | M |
| FR-CHR-03 | **Employment record**: employee code (per-entity numbering scheme), entity, branch, department, team, position, job level/grade, manager, start date, seniority date, work location, work schedule. All effective-dated. | M |
| FR-CHR-04 | **Contracts**: probation agreement, fixed-term labour contract (≤ 36 months), indefinite-term contract, service/collaborator contract, internship agreement, NDA, contract appendices. Fields: number, type, sign date, start/end, salary terms, signed copy. | M |
| FR-CHR-05 | Contract rules and alerts: expiry alerts at 45/30/15 days; probation-end alerts; enforce "fixed-term can be renewed once, then must become indefinite"; max probation length by job type. | M |
| FR-CHR-06 | **Document generation** from templates (DOCX/PDF merge): labour contracts, appendices, decisions (appointment, salary adjustment, termination), confirmation letters. Templates per entity with letterhead. | S |
| FR-CHR-07 | **Dependents** register for PIT family deduction: relationship, ID/tax code, deduction start/end month, supporting documents. | M |
| FR-CHR-08 | Employee document vault: categorised uploads (ID scans, degrees, health checks, signed contracts), expiry tracking. | M |
| FR-CHR-09 | **Lifecycle events** as first-class records with approval and generated documents: hire, probation pass/fail, contract renewal, transfer, promotion, salary change, discipline, reward, long leave (maternity), resignation, termination. | M |
| FR-CHR-10 | **Onboarding**: checklist templates per entity/department/position generating tasks for HR, IT, manager and the new hire (account creation, equipment, policy acknowledgement, first-week plan). Pre-boarding form where the new hire fills in their own personal data before day 1. | M |
| FR-CHR-11 | **Offboarding**: resignation request → approval → checklist (handover, asset return, access revocation, final pay, insurance book closure, exit interview) → final status. | M |
| FR-CHR-12 | **ESS**: employee views their own profile and documents, and submits change requests for personal data (HR approves; bank account changes require extra verification). | M |
| FR-CHR-13 | **Directory & org chart**: searchable directory (name, team, skills, phone), interactive org chart per entity and group-wide. | M |
| FR-CHR-14 | Skills and tools inventory per person (e.g. video editing, motion, copywriting, media buying, platform certifications) — used later for staffing tasks and projects. | S |
| FR-CHR-15 | Birthday, work anniversary and probation-end reminders to managers and HR. | S |
| FR-CHR-16 | Rehire handling: returning person keeps a single person record with multiple employment periods. | S |
| FR-CHR-17 | Headcount planning: approved positions per department vs. filled, feeding recruitment. | C |

---

### 4.3 Time & attendance (ATT)

| ID | Requirement | Pri |
|---|---|---|
| FR-ATT-01 | **Work schedules**: fixed office hours, flexible hours (core hours + required daily total), shifts (incl. split and overnight shifts for production/shooting crews), part-time patterns. Assigned by entity/department/person, effective-dated. | M |
| FR-ATT-02 | **Working calendar** per entity: working weekdays (incl. alternate Saturdays), Vietnamese public holidays, compensatory days off, company days off. | M |
| FR-ATT-03 | **App check-in/out** (mobile web/PWA): captures time (server time), GPS position with accuracy, network info, device info, optional selfie. | M |
| FR-ATT-04 | Check-in validation rules per location: GPS geofence radius, and/or office public IP/Wi-Fi allowlist. Out-of-policy check-ins are accepted but flagged for manager review (not blocked) — configurable. | M |
| FR-ATT-05 | Anti-fraud basics: server timestamps only, mock-location heuristics, one active device per user with change alerts, flag impossible travel. | S |
| FR-ATT-06 | **Biometric device import**: upload raw log exports (CSV/Excel/DAT) with a mapping profile per device model; map device user IDs to employees; idempotent re-import; error report for unmapped IDs. | M |
| FR-ATT-07 | Direct device integration (scheduled pull or device push via vendor SDK/ADMS) once device models are confirmed. | S |
| FR-ATT-08 | When both sources exist for a person-day, a configurable precedence/merge rule decides (first-in/last-out across sources by default). | M |
| FR-ATT-09 | **Daily timesheet engine** computes per person-day: worked hours, late in, early out, missing punch, absence, leave, holiday, WFH, business trip, OT (by category). Recomputes automatically when inputs change, until the period is locked. | M |
| FR-ATT-10 | **Attendance correction requests** (forgot to punch, device error) with reason and evidence → approval. Monthly cap per person configurable. | M |
| FR-ATT-11 | **Remote work / WFH / off-site (shooting, client visit, event)** requests with approval; off-site check-in allowed at the declared location. | M |
| FR-ATT-12 | **Overtime**: pre-approved OT request; actual OT confirmed from punches; categories weekday / weekend / public holiday / night, with multipliers from the statutory store; choose pay or time-off-in-lieu; warnings against legal caps (monthly and yearly). | M |
| FR-ATT-13 | Late/early policy: grace minutes, rounding rules, penalty or deduction rules per entity — configurable, transparent to employees. | S |
| FR-ATT-14 | **Monthly timesheet**: employee confirms → manager approves → HR locks. Locked periods feed payroll; changes after lock need an HR-approved adjustment that flows into the next payroll as a retro item. | M |
| FR-ATT-15 | Views: my attendance calendar; team attendance today ("who's in / out / on leave / off-site"); anomaly list for HR. | M |
| FR-ATT-16 | Business trip records (destination, dates, purpose, per-diem) linked to requests and payroll. | S |
| FR-ATT-17 | **Untracked working days** (D15): a schedule can mark a weekday as "working, no punches required" — the default for **Saturday (work from home)**. The timesheet engine auto-credits the day as worked unless leave or unpaid absence is recorded; no late/early/missing-punch anomalies are raised. Configurable per entity, department and person, in case some teams do work on-site on Saturdays. | M |
| FR-ATT-18 | **Holiday and rest-day work** (D15): requested and approved like OT; the worked hours/day are confirmed by punches or by manager confirmation (for untracked or off-site work), and paid at the statutory multipliers (rest day ×2, public holiday ×3, per the parameter store), or as time off in lieu if the employee chooses and policy allows. | M |

---

### 4.4 Leave (LVE)

| ID | Requirement | Pri |
|---|---|---|
| FR-LVE-01 | Configurable **leave types** per entity: annual, sick (BHXH-paid), maternity/paternity, paid personal leave (own marriage, child's marriage, bereavement), unpaid, compensatory (from OT), company-specific (birthday leave, etc.). Each type defines: paid/unpaid, payroll treatment, accrual, carry-over, half-day/hourly allowed, attachment required, notice period, max consecutive days, eligible workforce types, gender/seniority conditions. | M |
| FR-LVE-02 | **Annual leave entitlement**: statutory base (12 days/year for normal conditions) + seniority bonus (+1 day per 5 years) + company extras; pro-rata for joiners/leavers; monthly accrual or yearly grant; probation rule configurable. | M |
| FR-LVE-03 | Carry-over rules: cap, expiry date, or payout of unused days on termination (feeds payroll). | M |
| FR-LVE-04 | Request flow: choose type and dates (full/half day/hours) → system shows balance, working-day count (excluding holidays/weekends per the person's calendar), team conflicts → approval via the approval engine → balance updated; cancel and amend supported. | M |
| FR-LVE-05 | Team leave calendar; conflict warnings (minimum staffing per team configurable). | M |
| FR-LVE-06 | Approved leave appears on the employee's Google Calendar as out-of-office and optionally on a shared team calendar. | S |
| FR-LVE-07 | Balance ledger: every accrual, use, adjustment, expiry and carry-over is a ledger entry with audit trail. HR can post manual adjustments with a reason. | M |
| FR-LVE-08 | Long-term leave (maternity, long sick leave, unpaid sabbatical) changes employment status and drives insurance "decrease/increase" obligations in the compliance tracker and payroll treatment. | M |
| FR-LVE-09 | Leave liability report (unused days × daily rate) per entity. | S |

---

### 4.5 Payroll (PAY) — full Vietnamese payroll

Payroll is per **entity**, per **period** (monthly default), with strict access control (`compensation` tier).

#### Compensation setup

| ID | Requirement | Pri |
|---|---|---|
| FR-PAY-01 | **Salary structure** per person, effective-dated: base salary, insurance salary (the contribution base, which may differ from gross), and allowances with attributes each: taxable / non-taxable / partially exempt up to a cap (e.g. meal, phone, uniform), subject to insurance or not, fixed or attendance-prorated. | M |
| FR-PAY-02 | Pay component catalogue per entity: earnings (salary, allowances, OT, KPI/performance bonus, commission, 13th month, holiday bonus, leave payout, retro pay), deductions (insurance, PIT, union dues, salary advance, penalties, asset compensation, loan repayment), employer costs (insurance, union fund). Formula-based components with a safe expression language. | M |
| FR-PAY-03 | All contracts are **gross-based** (D12). A **net→gross converter tool** helps HR turn a negotiated net figure into the contract gross at offer/contract time. Net-based payroll calculation is not required. | S (tool only) |
| FR-PAY-04 | Salary change history with approval flow and generated decision document. | M |
| FR-PAY-07 | **Pay profile** per employment, effective-dated (D18): **Statutory** (insurance + union + PIT by the full rules, paid by bank transfer) or **Simple** (salary only: attendance-prorated salary + allowances + OT/holiday pay + bonuses − advances/deductions; no insurance or union; paid in cash). Both profiles use the same timesheet, leave, OT, KPI and bonus inputs, the same run lifecycle and the same payslip in ESS. The PIT treatment of the Simple profile is a parameter (none / flat withholding), not hard-coded. Moving a person between profiles is a lifecycle event with an effective date and owner approval. | M |
| FR-PAY-08 | Each Simple-profile employment records its **basis** (probation, internship, service/collaborator contract, short-term under one month, retiree, other) and an optional review date. An owner-only report lists Simple-profile people by basis and by time on the profile, so the owner can see where statutory obligations may apply (see the note below). | M |
| FR-PAY-05 | Probation pay rule (≥ 85% of the position's official salary) validated. | S |
| FR-PAY-06 | Salary advance (mid-month) runs. | S |

#### Calculation

| ID | Requirement | Pri |
|---|---|---|
| FR-PAY-10 | Payroll run pulls locked timesheet data: standard working days, paid days, unpaid days, leave by type, OT hours by category, late/early deductions. | M |
| FR-PAY-11 | *(Statutory profile)* **Compulsory insurance**: employee and employer BHXH/BHYT/BHTN at effective-dated rates, on insurance salary, with contribution caps (social/health capped by reference level multiple; unemployment capped by regional minimum wage multiple), correct handling of: joiners/leavers mid-month, unpaid leave ≥ 14 working days in a month, maternity and long sick leave, probation (not covered), employees past retirement age, foreigners, people with insurance at another employer. | M |
| FR-PAY-12 | *(Statutory profile)* **Trade union**: employer union fund and employee union dues (with cap), per entity on/off. | M |
| FR-PAY-13 | **PIT for residents with labour contracts ≥ 3 months**: taxable income = total income − exempt income (exempt allowances, OT/night exemptions per current law) ; assessable income = taxable income − employee insurance − personal deduction − dependent deductions (per registered months) − other allowed deductions (charity, voluntary pension; new education/healthcare deductions when guidance is issued); progressive tax by effective-dated bracket table. | M |
| FR-PAY-14 | **PIT flat withholding**: non-residents (flat rate), and individuals without a contract or with contracts < 3 months / CTV payments (withholding rate above the per-payment threshold), with commitment-form exemption handling. | M |
| FR-PAY-15 | OT pay by category with statutory multipliers; night-shift premium. | M |
| FR-PAY-16 | Pro-rating rules for joiners, leavers, unpaid leave and mid-month salary changes (by working days or calendar days — per entity policy). | M |
| FR-PAY-17 | Retroactive adjustments: differences from late-approved changes or post-lock timesheet fixes are carried as explicit retro items in the next run. | M |
| FR-PAY-18 | Final settlement on termination: unused leave payout, severance allowance where applicable, asset compensation, advances recovery. | S |
| FR-PAY-19 | Off-cycle bonus runs, taxed correctly within the month paid. | M |
| FR-PAY-21 | **Performance-driven year-end bonus** (D13): a bonus scheme per entity/year defines the formula — e.g. `base month salary × service-time factor × individual performance multiplier × team/entity OKR multiplier` — with multipliers taken from the Performance module's final KPI/OKR results (FR-PRF-09). The result can exceed one month's salary. HR proposes, the owner adjusts individual amounts with a recorded reason, the CEO approves, then it runs as an off-cycle payroll. A simulation view shows the total cost under different multiplier tables before approval. | M |
| FR-PAY-20 | Every payslip line stores its inputs, formula version and statutory parameter version so any past payslip can be **explained and reproduced exactly**. | M |

> **Note on the Simple profile and the law.** For some groups, "salary only" is the legal position — for example probation-only contracts, interns, and retirees. For others it is not: a person on a labour contract of one month or more generally falls under compulsory social insurance, and payments to collaborators and short-term workers generally carry PIT withholding. The system records and pays the Simple profile as the owner directs (D17), does not hide these people from any report, and gives the owner the FR-PAY-08 view of the exposure. Get advice from the chief accountant or counsel on which people can lawfully stay on this profile.

#### Process and outputs

| ID | Requirement | Pri |
|---|---|---|
| FR-PAY-30 | Run lifecycle (D17): Draft → Calculated → **Proposed (HR lead)** → **Approved (CEO signs)** → **Payment prepared (chief accountant generates the bank transfer files)** → Paid → **Locked**. The CEO can return a run to HR with comments. Locked runs are immutable. The owner can view every run and every step. Target calendar: timesheet locked by the 2nd, proposed by the 3rd, approved by the 4th, **paid on the 5th** (shifted earlier when the 5th is a non-banking day — configurable). | M |
| FR-PAY-31 | Variance check before approval: compare with previous month per person and in total; highlight anomalies (net change > X%, new/removed people, negative net, missing bank account, missing tax code). | M |
| FR-PAY-32 | **Payslips**: published to ESS after approval; PDF; optional email with password-protected PDF; employee can raise a payslip query that goes to C&B. | M |
| FR-PAY-39 | **Cash payment** for the Simple profile (D18): the run produces a cash payment sheet per entity (name, net amount, signature column, total); the chief accountant records each disbursement (date, amount, payer); the employee confirms receipt in the app (or signs the printed sheet, which is scanned and attached). The run is "Paid" only when the bank batch and the cash sheet are both settled. Cash totals are reported separately from bank totals. | M |
| FR-PAY-33 | **Bank transfer files** in the bulk-payment templates of **Vietcombank (VCB)** and **ACB** (D12), per entity paying account; employees are split by the paying bank configured for them; totals reconcile with the approved run. Further bank templates can be added as configuration. | M |
| FR-PAY-34 | Reports: payroll register, cost by entity/department/cost-centre, insurance contribution summary (to reconcile with the BHXH portal's monthly notice), PIT withholding summary, union report, headcount cost trend. | M |
| FR-PAY-35 | Statutory data exports: insurance increase/decrease list (data for form D02-LT), monthly/quarterly PIT declaration data (05/KK-TNCN), **annual PIT finalization** data (05/QTT-TNCN with appendices), dependents registration list, PIT withholding certificates/income confirmation letters for employees. Export as Excel in the layouts the official tools (HTKK, BHXH portal/e-filing software) import. Direct e-filing is out of scope. | M (data) / S (official layouts) |
| FR-PAY-36 | Accounting journal export (salary expense, payables, insurance, PIT) mapped to the entity's chart of accounts, for MISA or similar. | S |
| FR-PAY-37 | CTV/freelancer payment runs: payment requests per job, PIT withholding, payment file, withholding certificate. | S |
| FR-PAY-38 | Parallel-run mode: run payroll in the system alongside the existing method and produce a per-person reconciliation report. Required before go-live (see development plan). | M |

---

### 4.6 Work management — tasks & projects (WRK)

Goal: Linear-level speed and clarity, shaped for social media, content and creative production rather than software.

| ID | Requirement | Pri |
|---|---|---|
| FR-WRK-01 | **Workspaces → Teams → Projects → Tasks → Sub-tasks.** A team (e.g. Social, Design, Video Production, Media Buying, Account, HR, Finance) owns its workflow; projects can span teams and entities. | M |
| FR-WRK-02 | **Task** fields: title, rich description, assignee (one accountable owner) + collaborators, requester, status, priority, start/due date, estimate, labels, project, **client/brand**, channel/platform (Facebook, TikTok, YouTube, Instagram, Zalo…), content format, attachments, Drive links, checklist, dependencies (blocks/blocked by), related tasks. | M |
| FR-WRK-03 | **Custom workflows per team** with status categories (Backlog / To do / In progress / In review / Done / Cancelled). Example template for content: *Brief → Ideation → Script/Copy → Design/Shoot → Edit → Internal review → Client review → Scheduled → Published → Reported*. | M |
| FR-WRK-04 | **Custom fields** per team/project (text, number, select, date, person, URL). | S |
| FR-WRK-05 | **Views**: list, kanban board, **calendar (content calendar)**, timeline/Gantt, table; saved filters; grouping by assignee/status/client/project; personal and shared views. | M (list, board, calendar) / S (timeline) |
| FR-WRK-06 | **My work**: inbox of everything assigned to me across tasks, approvals, obligations, onboarding items, reviews — sorted by due date and priority. | M |
| FR-WRK-07 | Leader view: tasks I assigned, by person and status; overdue and at-risk; one-click nudge. | M |
| FR-WRK-08 | **Review & approval step** on a task: submit deliverable (file/link versions) → reviewer approves or requests changes with comments → version history kept. Counts revision rounds. | M |
| FR-WRK-09 | Activity feed and threaded comments with @mentions, reactions, and rich paste of images/video links; every field change logged. | M |
| FR-WRK-10 | **Templates**: task templates and project templates (e.g. "Monthly social retainer", "TVC production", "KOL campaign", "Event") that generate a full task tree with relative due dates and role-based assignment. | M |
| FR-WRK-11 | **Recurring tasks** (daily/weekly/monthly/custom rule). | M |
| FR-WRK-12 | Keyboard-first UX: command palette, quick-create, shortcuts, bulk edit, drag and drop, optimistic updates, instant filters. | S |
| FR-WRK-13 | **Workload view**: open tasks/estimated hours per person per week, overlaid with approved leave and holidays from HRM. | S |
| FR-WRK-14 | Time logging on tasks (manual or timer). Optional per team. Enables utilisation and later per-client profitability (with payroll cost and CRM revenue). | S |
| FR-WRK-15 | Cycles/sprints (weekly or bi-weekly planning) — optional per team. | C |
| FR-WRK-16 | Intake forms: a team publishes a request form (e.g. "Design request") that creates a triaged task in its backlog. | S |
| FR-WRK-17 | Notifications: assigned, mentioned, due soon, overdue, status changed on tasks I follow; daily digest. | M |
| FR-WRK-18 | Privacy: projects can be open to the entity, team-only, or private to members. HR and finance teams default to private. | M |
| FR-WRK-19 | Project dashboard: progress, burndown by status, overdue, revision rounds, on-time delivery rate. | S |
| FR-WRK-20 | Task outcomes feed performance reviews as evidence (on-time rate, volume, review rounds) — informational, never an automatic score. | C |
| FR-WRK-21 | Later link to CRM: client and deal on projects; client-facing review links. | L |

---

### 4.7 Operations & compliance tracker (OPS)

For HR, C&B and finance: never miss a recurring job, and be able to prove it was done. Built on the task engine, with its own calendar and dashboard.

| ID | Requirement | Pri |
|---|---|---|
| FR-OPS-01 | **Obligation templates**: name, category (internal / external), authority (tax office, social insurance agency, labour department, statistics office, internal), applicable entities, recurrence (monthly / quarterly / semi-annual / annual / event-driven), due-date rule (e.g. "20th of the following month", "last day of the first month of next quarter", "last day of the 3rd month after fiscal year-end"), with automatic shift when the due date falls on a weekend/holiday, owner role, reviewer role, checklist, guidance notes, links to KB procedures, lead-time for reminders. | M |
| FR-OPS-02 | A scheduler **generates obligation instances per entity per period** as tasks with checklist, owner, reviewer and due date. | M |
| FR-OPS-03 | **Seed library** (editable, to be confirmed by the chief accountant), internal: monthly timesheet lock, payroll run, payslip release, salary payment, insurance increase/decrease reporting, insurance payment reconciliation, contract expiry review, probation review, leave balance year-end processing, 13th-month run, annual health check, labour-rule/policy review. External: VAT declaration (monthly/quarterly), PIT declaration (monthly/quarterly), provisional CIT payment (quarterly), invoice usage where applicable, **annual financial statements**, **CIT finalization**, **PIT finalization**, business licence fee, labour usage reports (semi-annual/annual), occupational accident/safety reports, unemployment insurance reports, trade union payments, statistics office surveys, independent audit (if required), foreign-employee work-permit renewals. | M |
| FR-OPS-04 | **Event-driven obligations**: generated by HRM events — new hire (register insurance, labour contract, tax code, dependents), termination (close insurance book, PIT certificate, final settlement), maternity leave (insurance claim), salary change (insurance adjustment). | M |
| FR-OPS-05 | **Evidence**: on completion, attach proof (submission receipt, payment slip, filed report), reference number, submitted date, amount paid. Instances cannot be closed without required evidence. | M |
| FR-OPS-06 | Two-step completion: *prepared by* → *reviewed/approved by* (maker-checker) for selected templates. | S |
| FR-OPS-07 | **Compliance calendar & dashboard**: by entity × month; status colours (upcoming / due soon / overdue / done / done late); filter by authority, owner, category. Owner/CFO sees all entities at once. | M |
| FR-OPS-08 | Escalation: reminders at configurable lead times; overdue items escalate to the department head, then to the CFO/owner. | M |
| FR-OPS-09 | History: full archive of past periods per obligation with evidence — the audit trail for tax/insurance inspections. | M |
| FR-OPS-10 | Payroll integration: payroll-related instances auto-link to the payroll run and auto-complete steps (e.g. "payroll approved", "bank file generated"). | S |
| FR-OPS-11 | Penalty/risk note per template (what happens if late) to help prioritisation. | C |
| FR-OPS-12 | Reuse for other departments later (legal: licence renewals, trademark; admin: lease, insurance policies, domain renewals). | C |

---

### 4.8 Knowledge base (KB)

| ID | Requirement | Pri |
|---|---|---|
| FR-KB-01 | **Spaces** (Company, HR policies, Finance procedures, per department, Brand guidelines, Client playbooks, Tools & how-tos) with nested pages. | M |
| FR-KB-02 | Block-based rich editor: headings, lists, tables, callouts, code, images, video embeds (YouTube, Drive), file attachments, Drive/Figma/Canva embeds, page links, @mentions, templates. | M |
| FR-KB-03 | Permissions per space and per page: view/edit by entity, department, role, person. | M |
| FR-KB-04 | Draft → review → publish flow for controlled spaces (policies), using the approval engine; version history with diff and restore. | M |
| FR-KB-05 | **Policy acknowledgement**: mark a page "must read"; target audience; employees confirm; HR tracks completion and sends reminders; re-acknowledgement on major revision. Used in onboarding. | M |
| FR-KB-06 | Full-text search (Vietnamese-aware, accent-insensitive), filters, recent and popular pages. | M |
| FR-KB-07 | Page owner and **review-by date**; stale-content reminders. | S |
| FR-KB-08 | Page feedback ("was this helpful"), comments, and "ask a question" to the page owner. | S |
| FR-KB-09 | Page templates: SOP, policy, meeting notes, campaign post-mortem, client playbook, onboarding guide. | S |
| FR-KB-10 | Import from Google Docs / Markdown / Word. | S |
| FR-KB-11 | Semantic search and AI answers with citations (see §4.13). | S |
| FR-KB-12 | Simple learning paths: ordered list of pages + quiz for onboarding/training, with completion tracking. | C |

---

### 4.9 Recruitment / ATS (REC)

| ID | Requirement | Pri |
|---|---|---|
| FR-REC-01 | **Hiring request** by a manager (position, headcount, budget, reason) → approval → job opening. | M |
| FR-REC-02 | Job openings with description, requirements, salary range (internal only), hiring team, pipeline stages (configurable per job). | M |
| FR-REC-03 | **Public careers page** and per-job application form (CV upload, portfolio links — important for creative roles — custom questions). Spam protection. Consent notice per PDPL. | M |
| FR-REC-04 | Candidate database with duplicate detection, source tracking (job boards, referral, social), tags, talent pool. | M |
| FR-REC-05 | Kanban pipeline; stage moves; rejection reasons; bulk actions; email templates (invite, reject, offer). | M |
| FR-REC-06 | **Interview scheduling** with Google Calendar (interviewer availability, Meet link), interview kits and structured scorecards; feedback hidden from other interviewers until submitted. | M |
| FR-REC-07 | Assignments/tests: send a brief, receive a submission, rate it. | S |
| FR-REC-08 | **Offer**: offer approval flow, offer letter from template, accept/decline tracking. | M |
| FR-REC-09 | **Convert to employee**: accepted candidate becomes a pre-boarding person record (no retyping), onboarding starts. | M |
| FR-REC-10 | Employee referral programme: submit referral, track status, bonus eligibility. | S |
| FR-REC-11 | Reports: time-to-hire, funnel conversion, source effectiveness, cost per hire. | S |
| FR-REC-12 | AI assist: CV parsing to structured fields, JD drafting, candidate summary. AI never auto-rejects. | C |
| FR-REC-13 | Candidate data retention: automatic deletion/anonymisation of unsuccessful candidates after the retention period unless they consent to the talent pool. | M |

---

### 4.10 Performance & OKRs (PRF)

| ID | Requirement | Pri |
|---|---|---|
| FR-PRF-01 | **OKRs/goals**: group → entity → department → team → individual, aligned in a tree; quarterly/annual periods; key results with metric types (number, %, currency, milestone); weekly check-ins with confidence level; progress roll-up. | M |
| FR-PRF-02 | **KPI library** per position (common for marketing roles: on-time delivery, content output, engagement, campaign ROAS, client satisfaction) with weights, targets and monthly/quarterly actuals, and a computed KPI score per person per period. | M |
| FR-PRF-09 | **Final performance result per person per year** (D13): combines KPI scores, OKR attainment and the review rating by a configurable weighting into a final score and band; the owner can override it with a recorded reason; results are locked and published to payroll as the multipliers for the year-end bonus (FR-PAY-21). | M |
| FR-PRF-03 | **Review cycles**: configurable (probation review, mid-year, annual): self-review → manager review → optional peers/360 → calibration → sign-off meeting → employee acknowledgement. Form templates with competencies and rating scales. | M |
| FR-PRF-04 | **Continuous feedback** and **1:1 meeting notes** (shared agenda, private notes, action items become tasks). | S |
| FR-PRF-05 | Calibration view (9-box or rating distribution) for HR and directors. | C |
| FR-PRF-06 | Review outcome links to lifecycle events: promotion, salary adjustment proposal, development plan, performance improvement plan. | S |
| FR-PRF-07 | Evidence panel in reviews: goals achieved, task statistics, kudos received, attendance summary, training completed. | S |
| FR-PRF-08 | Confidentiality: reviews visible only to the employee (after release), their management chain, and HR. | M |

---

### 4.11 Assets & requests (AST / REQ)

| ID | Requirement | Pri |
|---|---|---|
| FR-AST-01 | **Asset register**: code, category (laptop, camera, lens, lighting, phone, monitor, software licence, SIM, furniture), serial, owning entity, purchase date/price, warranty, condition, location, photos, QR label. | M |
| FR-AST-02 | **Assignment & handover**: assign to person with digital handover confirmation; return on offboarding or reassignment; condition notes; history. | M |
| FR-AST-03 | **Equipment booking** for shared production gear (cameras, lights, studio): calendar booking, check-out/check-in, conflict prevention. Highly relevant for a media production team. | S |
| FR-AST-04 | Maintenance and incident log; loss/damage report → optional payroll deduction via approval. | S |
| FR-AST-05 | Software licence and subscription tracking: seats, renewal dates, cost, owner (renewals appear in the OPS tracker). | S |
| FR-AST-06 | Stock-take mode: scan QR codes to audit assets. | C |
| FR-REQ-01 | **Generic request builder**: admin defines a request type with a form (fields, attachments) and an approval flow — no code. | M |
| FR-REQ-02 | Seed request types: purchase request, payment request, expense claim/reimbursement, advance request, business trip, equipment request, employment/income confirmation letter, stamp/seal usage, IT support, recruitment request. | M |
| FR-REQ-03 | Expense claims: line items, receipts, category, project/client tag, approval, reimbursement via payroll or separate payment batch. | S |
| FR-REQ-04 | Request tracking for requester; SLA reporting per request type. | S |

---

### 4.12 Internal communications & engagement (COM)

| ID | Requirement | Pri |
|---|---|---|
| FR-COM-01 | **Announcements**: targeted by entity/department/location, pinned, scheduled, with read tracking and optional "must acknowledge". | M |
| FR-COM-02 | **Home feed**: announcements, new joiners, birthdays, work anniversaries, kudos, new KB pages, open jobs. | M |
| FR-COM-03 | **Kudos/recognition** tied to company values, with optional points and leaderboard. | S |
| FR-COM-04 | **Surveys & pulse**: anonymous or named; eNPS; onboarding (30/60/90 days) and exit surveys; minimum group size to protect anonymity in reports. | S |
| FR-COM-05 | Polls and event sign-ups (company trip, year-end party). | C |
| FR-COM-06 | Anonymous suggestion / whistle-blower box routed to owner/HR head. | C |
| FR-COM-07 | Meeting-room and studio booking (if not handled via Google Calendar resources). | C |

---

### 4.13 AI assistant (AI)

| ID | Requirement | Pri |
|---|---|---|
| FR-AI-01 | **Ask Suzu**: chat that answers policy and how-to questions from the KB with **citations**, in Vietnamese or English. Retrieval respects the asker's KB permissions. | S |
| FR-AI-02 | Personal HR answers using the user's own data via permission-checked tools: "how many leave days do I have?", "explain my payslip this month", "who approves my OT?". | S |
| FR-AI-03 | Action shortcuts with confirmation: "request leave next Friday", "create a task for Lan to design the Tết banner, due Wednesday". The assistant drafts; the user confirms; normal approval flows apply. | C |
| FR-AI-04 | Drafting help: job descriptions, announcements, KB pages, review summaries, task briefs from a rough note. | C |
| FR-AI-05 | Manager/HR insights: natural-language questions over reports within the asker's scope ("turnover by department this year"). | C |
| FR-AI-06 | Guardrails: the AI has no access beyond the asking user's permissions; compensation data is never sent to the model except for the user's own payslip explanation; zero-data-retention provider setting; all AI tool calls audit-logged; clear "AI may be wrong — source linked" UX. | M (when AI ships) |
| FR-AI-07 | Unanswered-question log → tells HR which KB pages are missing. | C |

---

### 4.14 Reporting & dashboards (RPT)

| ID | Requirement | Pri |
|---|---|---|
| FR-RPT-01 | **Owner dashboard**: headcount and movement, payroll cost trend per entity, attendance today, leave today, open positions, overdue obligations, tasks at risk, pending approvals waiting on me. | M |
| FR-RPT-02 | HR reports: headcount by entity/department/type/gender/age/seniority, joiners and leavers, turnover rate, contract expiries, probation pipeline, attendance anomalies, leave usage and liability, OT hours vs. legal caps. | M |
| FR-RPT-03 | Payroll & cost reports (see FR-PAY-34). | M |
| FR-RPT-04 | Work reports: throughput, on-time rate, workload, revision rounds by team/client. | S |
| FR-RPT-05 | Every report is scope-filtered by the viewer's permissions, exportable, and schedulable by email. | S |
| FR-RPT-06 | Utilisation and per-client cost (time logs × loaded salary cost) — foundation for agency profitability once CRM revenue exists. Visible to owner/finance only. | C |

---

### 4.15 CRM (future phase — outline only)

Not specified in detail now; listed so the foundation is built to receive it.

- Accounts (clients/brands), contacts, leads, deal pipeline, activities, quotes/proposals, client contracts and retainers, renewal reminders.
- Gmail and Calendar sync for client communication history.
- Link **deal → project → tasks → time logs → staff cost → client profitability**.
- Client portal for deliverable review and approval.
- Invoicing handoff to accounting.

**Foundation requirements now:** the `client/brand` entity exists from the Work module (FR-WRK-02) as a lightweight record so it can be promoted to a full CRM account later without migration pain.

---

## 5. Data requirements

### 5.1 Core entities (conceptual)

```
Group 1─* Entity 1─* Branch
Entity 1─* Department 1─* Team
Person 1─* Employment (entity, dates, type) 1─* Assignment (dept, team, position, manager; effective-dated)
Person 1─* Contract · Dependent · Document · BankAccount
User 1─1 Person ; User *─* Role (with scope)
Employment 1─* SalaryStructure (effective-dated) 1─* SalaryComponent
Schedule / Calendar ─ Punch ─ DailyTimesheet ─ MonthlyTimesheet(lock)
LeaveType ─ LeaveRequest ─ LeaveLedgerEntry
PayrollRun (entity, period) 1─* Payslip 1─* PayslipLine (inputs, formula ver, param ver)
StatutoryParameterSet (effective-dated, versioned)
ApprovalFlow ─ ApprovalRequest ─ ApprovalStep ─ ApprovalAction
Team(work) ─ Project ─ Task ─ Subtask · Comment · Attachment · Review · TimeLog ; Client
ObligationTemplate ─ ObligationInstance (= Task + evidence)
Space ─ Page ─ PageVersion ─ Acknowledgement
JobOpening ─ Application ─ Candidate ─ Interview ─ Scorecard ─ Offer
Goal/KeyResult ─ CheckIn ; ReviewCycle ─ Review ─ ReviewResponse
Asset ─ AssetAssignment ─ Booking ; RequestType ─ Request
AuditLog · Notification · File
```

### 5.2 Data rules

| ID | Requirement |
|---|---|
| DR-01 | Money is stored as integer VND. No floating point anywhere in payroll. Rounding rules are explicit and configurable per component. |
| DR-02 | Effective dating (valid-from / valid-to) for org assignments, salary, schedules, statutory parameters, leave policies. |
| DR-03 | Soft delete for business records; hard delete only through the retention/erasure process. |
| DR-04 | All timestamps stored in UTC, displayed in `Asia/Ho_Chi_Minh`. Attendance "work date" is computed in local time with overnight-shift rules. |
| DR-05 | `restricted` and `compensation` fields are encrypted at the application level (envelope encryption) in addition to database encryption at rest. |
| DR-06 | Every table carries `entity_id` where applicable; all queries are entity-scoped by the authorization layer. |
| DR-07 | Locked periods (timesheet, payroll) are immutable; corrections are new adjusting records. |
| DR-08 | Vietnamese names: store full name as entered plus an accent-stripped search key; sort by given name (last word) per Vietnamese convention. |

### 5.3 Data migration

Initial load via import templates: entities and org structure, people and employment, contracts, dependents, current leave balances, current salary structures, assets, year-to-date payroll totals (needed for PIT finalization if go-live is mid-year), device user-ID mapping.

---

## 6. Non-functional requirements

### 6.1 Security

| ID | Requirement |
|---|---|
| NFR-SEC-01 | All traffic over TLS. HSTS. Strict CSP. Secure, HTTP-only, same-site cookies. CSRF protection on all mutations. |
| NFR-SEC-02 | Authorization enforced server-side on every request and every server action; deny by default; automated tests for the permission matrix. |
| NFR-SEC-03 | Input validation with shared schemas on client and server. Parameterised queries only. File upload hardening. Rate limiting on auth, public careers form, and AI endpoints. |
| NFR-SEC-04 | Secrets only in the platform secret store; no secrets in the repository; key rotation procedure documented. |
| NFR-SEC-05 | Audit log is append-only and cannot be edited by any application role, including the owner. |
| NFR-SEC-06 | Production database is not reachable from developer laptops by default; production data is never copied to non-production without anonymisation. |
| NFR-SEC-07 | Dependency and secret scanning in CI; security review before each major module goes live (especially payroll). |
| NFR-SEC-08 | Payslip and compensation pages: no caching at CDN/browser, re-authentication after idle. |

### 6.2 Privacy and legal compliance

| ID | Requirement |
|---|---|
| NFR-PRV-01 | Comply with Vietnam's **Personal Data Protection Law (91/2025/QH15)** and its guiding decrees: lawful basis and notice for employee data processing, explicit consent where required (e.g. selfie/GPS at check-in, candidates' talent-pool retention), purpose limitation, access limitation, breach notification procedure. |
| NFR-PRV-02 | Sensitive personal data (health, biometrics if any, location, financial) gets the strictest tier and minimal collection. GPS is captured only at the check-in moment, never tracked continuously. |
| NFR-PRV-03 | Data subject rights tooling: export my data; request correction; deletion/anonymisation workflow. |
| NFR-PRV-04 | Retention schedule per data category (e.g. unsuccessful candidates: short; employee records after termination: as required by labour, insurance, tax and accounting laws; payroll records: per accounting law). Automated purge/anonymise jobs with HR confirmation. |
| NFR-PRV-05 | Data processing impact assessment and, if data is hosted outside Vietnam, a **cross-border transfer impact assessment** must be prepared and filed as required. **→ needs confirmation with legal counsel before production go-live** (see §7.3). |
| NFR-PRV-06 | Processor agreements in place with hosting, email and AI vendors; AI provider configured for zero data retention. |
| NFR-LAW-01 | Labour Code 2019, Law on Social Insurance 2024, Law on Employment, PIT Law (amended 2025, Law 109/2025/QH15), Accounting Law — reflected through the statutory parameter store and the seed obligation library. All legal values must be signed off by the chief accountant before payroll go-live. |

### 6.3 Performance & scalability

| ID | Requirement |
|---|---|
| NFR-PRF-01 | Typical page interactive in < 2 s on a mid-range phone over 4G; task board and list interactions feel instant (< 100 ms perceived, optimistic updates). |
| NFR-PRF-02 | Check-in completes in < 3 s and tolerates brief connectivity loss (queued retry with original timestamp from a server-issued token). |
| NFR-PRF-03 | Payroll calculation for 500 employees completes in < 2 min as a background job with progress. |
| NFR-PRF-04 | Handles morning check-in peak (everyone within 15 minutes) without degradation. |
| NFR-PRF-05 | Designed for 1,000 people, 5 years of attendance and payroll history, 1M tasks. |

### 6.4 Availability, backup, operations

| ID | Requirement |
|---|---|
| NFR-OPS-01 | Target availability 99.5% during business hours (Mon–Sat 07:00–22:00 ICT). Planned maintenance outside those hours. |
| NFR-OPS-02 | Database point-in-time recovery; daily backups retained ≥ 30 days; monthly backup retained ≥ 1 year; **restore drill at least twice a year**. RPO ≤ 1 h, RTO ≤ 8 h. |
| NFR-OPS-03 | Error tracking, structured logs, uptime monitoring, alerting to the tech owner; job failure alerts (payroll, imports, schedulers). |
| NFR-OPS-04 | Environments: local, preview (per pull request, with seeded fake data), staging, production. |
| NFR-OPS-05 | Zero-downtime deploys; backward-compatible migrations; feature flags for phased rollout per entity/department. |

### 6.5 Usability

| ID | Requirement |
|---|---|
| NFR-UX-01 | Mobile-first for all employee self-service flows (check-in, leave, approvals, payslip, tasks). Installable PWA with push notifications where supported. |
| NFR-UX-02 | Desktop-optimised for HR/payroll consoles and task management (dense tables, keyboard shortcuts). |
| NFR-UX-03 | Consistent design system; light and dark themes; WCAG 2.1 AA for contrast and keyboard navigation. |
| NFR-UX-04 | An employee can request leave in ≤ 4 taps and a manager can approve in ≤ 2 from the notification. |
| NFR-UX-05 | Vietnamese-first microcopy written with HR, not machine-translated. |

### 6.6 Maintainability

| ID | Requirement |
|---|---|
| NFR-MNT-01 | Modular monolith: each module owns its schema, services and UI; modules talk through typed service interfaces and domain events, so CRM can be added without touching HRM internals. |
| NFR-MNT-02 | TypeScript strict mode end to end; schema-validated boundaries. |
| NFR-MNT-03 | **Payroll engine is a pure, deterministic library** (inputs → outputs, no I/O) with a golden-file test suite reviewed by the chief accountant. Attendance and leave accrual engines likewise. |
| NFR-MNT-04 | Automated tests: unit (engines), integration (services + DB), end-to-end (critical flows), permission matrix tests. CI gates on all. |
| NFR-MNT-05 | Portable: standard PostgreSQL and containers, so hosting can move (e.g. into Vietnam) without rewrite. |

---

## 7. Constraints and proposed technical direction

### 7.1 Proposed stack

| Layer | Choice | Why |
|---|---|---|
| Framework | **Next.js 16 (App Router)**, React 19, TypeScript | Owner's choice; server components and server actions fit an internal data app |
| UI | Tailwind CSS + shadcn/ui, TanStack Table, dnd-kit, Tiptap/BlockNote editor | Fast to build dense internal tools; good editor for KB and task descriptions |
| Database | **PostgreSQL** (managed: Supabase, Singapore region) + `pgvector` for AI search | Relational integrity for HR/payroll; one database for everything |
| ORM | Drizzle ORM + SQL migrations | Type-safe, SQL-transparent — important for payroll and reports |
| Auth | Better Auth (Google provider, `hd` allowlist check, DB sessions) | Full control over two-workspace logic and instant session revocation |
| Authorization | Central policy layer in the app (role × scope × tier) | Rules like "manager of" and effective-dated scope are too complex for DB row policies alone |
| Files | Private object storage (Supabase Storage or Vercel Blob private) with signed URLs | |
| Jobs | Scheduled jobs (Vercel Cron) + durable background workflows for payroll runs, imports, schedulers, notifications | |
| Email | Transactional email provider on a `suzu.group` subdomain with SPF/DKIM/DMARC | |
| AI | Claude models via Vercel AI Gateway (zero data retention), AI SDK, `pgvector` retrieval | |
| i18n | next-intl (vi, en) | |
| Hosting | Vercel (Singapore region functions), domain `suzu.one` | |
| Observability | Sentry (errors) + platform logs + uptime monitor | |
| Testing | Vitest, Playwright | |

### 7.2 Two Google Workspaces — design notes

- One Google Cloud project, one OAuth client, user type **External**, published. Server verifies `hd ∈ {suzu.vn, suzu.group}` and `email_verified`.
- Calendar/Drive features use **per-user OAuth scopes** requested incrementally (only when the user first uses the feature), so they work identically in both workspaces.
- Optional Directory sync needs a service account with domain-wide delegation configured **separately in each workspace's Admin console**. Deferred to a later phase.
- Both workspace admins should mark the app as **trusted** in Admin console → API controls, to avoid consent friction.

### 7.3 Data residency — decided: option A (D10)

Employee and payroll data is personal and sensitive data under the PDPL. Options:

| Option | Pros | Cons |
|---|---|---|
| **A. Managed cloud in Singapore** (Vercel + Supabase) — *proposed default* | Fastest to build and operate; strong managed security, backups, previews | Cross-border transfer of personal data → impact assessment dossier and notification obligations; confirm with counsel |
| **B. Hosted in Vietnam** (VN cloud VM/Kubernetes + self-managed Postgres, app in a container) | No cross-border transfer | You operate the infrastructure: backups, patching, monitoring, HA |
| **C. Hybrid** — app on Vercel, database in Vietnam | Data at rest stays in VN | Latency, still arguably cross-border processing; most complex |

**Decision (2026-09-19): option A.** The legal work (PDPL cross-border transfer impact assessment, processing notices) is deferred by the owner and tracked as risk R3 in the development plan; it should be closed before payroll data goes live. The architecture stays portable (NFR-MNT-05), so moving to option B later is feasible.

---

## 8. Open questions

Resolved on 2026-09-19: Q1 → D8 · Q2 → D9 · Q3 → D10 · Q4 → D11 · Q6 → D12 · Q7 → D13 · Q8 → D14 · Q9 → D15 · Q10 → D16 · Q11 → D17.

Still open:

| # | Question | Needed by |
|---|---|---|
| Q5 | Biometric devices: brand/model per office, and how logs are exported today? (File import works with any device, so this only blocks direct device integration.) | Phase 2 |
| Q12 | Real entity data — legal names, tax codes, insurance unit codes, wage regions, paying bank accounts (VCB/ACB) per entity — entered by the owner/HR in the admin screens over the seed data. | Phase 1 (names), Phase 5 (bank and insurance details) |
| Q13 | Holiday work for monthly-salaried staff: confirm the company's reading of the multiplier (×3 *in addition to* the holiday's normal paid salary, or ×3 *inclusive*). Stored as a parameter. | Phase 2 |
| Q14 | Year-end bonus formula: the first version of the scheme in FR-PAY-21 (weights of KPI vs OKR vs review rating, service-time factor, multiplier bands). | Phase 8 |
| Q15 | Is Saturday WFH a full or a half working day, and does it count toward the month's standard working days for pro-rating? (Assumed: full day, counted.) | Phase 2 |
| Q16 | PDPL legal work for offshore hosting (deferred by D10). | Before payroll go-live |

---

## Appendix A — Statutory parameter snapshot (seed values)

> **Snapshot gathered 2026-09-19 from public sources. Every value must be verified by the chief accountant before payroll go-live.** All of these live in the effective-dated statutory parameter store (FR-PLT-38), not in code.

| Parameter | Seed value | Note |
|---|---|---|
| Employee insurance | BHXH 8% · BHYT 1.5% · BHTN 1% = **10.5%** | On insurance salary |
| Employer insurance | BHXH 17.5% (incl. occupational accident/disease fund) · BHYT 3% · BHTN 1% = **21.5%** | |
| Trade union | Employer 2% union fund; member dues 1% (capped) | If the entity has a union / per current rules |
| BHXH/BHYT contribution cap | 20 × reference level (base salary). Reference level reported as **2,530,000 VND from 2026-07-01** (previously 2,340,000) → cap 50,600,000 | Verify the decree |
| BHTN contribution cap | 20 × regional minimum wage | |
| Regional minimum wage (from 2026-01-01) | Region I 5,310,000 · II 4,730,000 · III 4,140,000 · IV 3,700,000 VND/month | Verify the decree and each entity's region |
| PIT personal deduction | **15,500,000 VND/month** (applies from tax period 2026) | |
| PIT dependent deduction | **6,200,000 VND/month** per dependent | |
| PIT progressive brackets (monthly assessable income) | ≤10M: 5% · 10–30M: 10% · 30–60M: 20% · 60–100M: 30% · >100M: 35% | Amended PIT Law 109/2025/QH15 — 5 brackets; confirm the application date for salary income and transition rules |
| PIT non-resident | 20% flat on Vietnam-sourced salary | |
| PIT withholding, no contract / < 3 months | 10% on payments at or above the per-payment threshold | Verify current threshold |
| OT multipliers | Weekday 150% · weekly rest day 200% · public holiday/Tết 300% · night work +30% · night OT additional +20% | Labour Code 2019 |
| OT caps | ≤ 40 h/month; ≤ 200 h/year (300 h for specified cases) | |
| OT / night pay PIT exemption | Amended law reported to exempt OT and night-work pay more broadly than the premium portion only | Verify guidance |
| Annual leave | 12 working days/year (normal conditions), +1 day per 5 years of service | |
| Public holidays | 11 days/year (New Year 1, Tết 5, Hùng Kings 1, 30/4 1, 1/5 1, National Day 2) | Actual dates and swap days announced yearly |
| Probation | ≤ 180 days (enterprise managers) · ≤ 60 days (college-level+ roles) · ≤ 30 days (intermediate) · ≤ 6 working days (other); pay ≥ 85% | |
| Fixed-term contract | ≤ 36 months; may be renewed once as fixed-term, then must be indefinite | With statutory exceptions |
