# Privacy decisions — Phase 12, R5 (NFR-PRV-01..04)

Written with the R5-B build (2026-10-05). It records the privacy choices that the build made but cannot enforce in code, and the steps that belong to infrastructure. The owner can overrule any of them. The legal work deferred by D10 (Q16: the cross-border transfer impact assessment and the processing notices filed with the authority) is still the owner's and is not covered here.

Law references: Law 91/2025/QH15 on Personal Data Protection (in force 2026-01-01) and its guiding decree. Decree 13/2023 is the earlier text the SRS notes cite; its consent and notice rules carry over. Also: Accounting Law 88/2015/QH13 art. 41, Decree 174/2016 art. 12, Labour Code 2019 art. 190, Civil Code 2015 art. 429.

## 1. Retention schedule

The periods are named constants in `src/modules/privacy/engine/retention.ts`, and each one carries its reason there. They are company policy, not legal rates, so they are not kept in the statutory parameter store.

| Data | Kept | How it goes |
|---|---|---|
| Exact position, IP address, user agent and device info of an **app check-in** | 90 days after the check-in. A check-in still waiting for review keeps them. | Nightly job `privacy-retention` sets the fields to null. The punch itself stays: time, direction, matched office, distance and flags. |
| **Assistant** conversations (messages included) and logged unanswered questions | 180 days after the last message | Nightly job `privacy-retention` deletes them. |
| **Face** templates (in the app) | Until the person withdraws or leaves | Withdrawal on `/me` deletes them at once. Leavers are handled by the `face-leavers` job (already in place). |
| Unsuccessful **candidates** | Their retention window (FR-REC-13, already in place) | `candidate-retention` job anonymises them. |
| **Former employees'** personal details | 3 years after the last day of their last employment | HR-confirmed anonymisation on Admin → Privacy (`/admin/privacy`). Never automatic. |
| Payroll, tax, insurance and labour **records** | At least 10 years (Accounting Law art. 41; Decree 174/2016 art. 12) | Never removed by the app. |
| **Backups** of the database and the files (decided 2026-10-09, [BACKUP_PLAN.md](../BACKUP_PLAN.md) D6) | Whatever the app deleted or anonymised stays in the encrypted backups for up to 400 days | The backup buckets' lifecycle rules remove it. A restore brings deleted data back. Afterwards the owner runs `privacy-retention`, `candidate-retention` and `files-cleanup` again, and repeats from the audit log any anonymisation or erasure done after the restore point ([restore.md](../runbooks/restore.md)). The privacy notice says so (section 10). |

Why 3 years for former employees: it outlasts the 1-year limit for individual labour disputes (Labour Code art. 190) and the 3-year limit for contract claims (Civil Code art. 429). After that the company has no purpose for contact details, emergency contacts or scanned diplomas.

**What anonymisation removes:**
- the work email and the app account (Better Auth user, its sessions and its Google link)
- the profile picture
- phone, personal email, current address and marital status
- emergency contacts
- vault documents of the kinds ID scan, health check, degree, certificate and other — their files are erased from storage at once
- notifications, notification settings and push devices
- Messenger and Telegram links (revoked, chat ids blanked)
- assistant conversations
- face data
- the position fields of every app check-in

**What it keeps, because tax, insurance and accounting records must still identify the person:**
- name and employee code
- date of birth, gender, nationality and permanent address
- identity, tax, social-insurance and bank numbers (`person_sensitive`, encrypted)
- dependants claimed for PIT
- employment periods and assignments
- contracts and decisions with their signed copies
- lifecycle events
- payroll runs, payslips and payments
- timesheets and punch times
- leave, approval requests and issued documents
- the consent records

The audit log is append-only and is not touched. Each anonymisation is recorded in `person_anonymisation`, with counts only.

*Owner may overrule:* the 3-year period, and treating vault documents of kind "other" as removable.

## 2. GPS at check-in: recorded notice and withdrawal

- The first time the person taps the check-in key, a notice explains what is collected, why, who sees it, how long it is kept, and that they may say no. They choose either "I agree" or "Check in without location". The same notice is asked again whenever `GPS_NOTICE_VERSION` changes.
- Each answer is a row in `privacy_consent_event`. A row is never updated, and it stores the version, the language and the exact text shown.
- On `/me` → "Your data and privacy", the person can withdraw or allow again. Withdrawing is as easy as agreeing.
- The server enforces the answer. `punchAction` drops any position the phone sends unless the latest answer is "given" to the current notice. Without a position, an office network still counts; otherwise the check-in goes to the manager for review.
- This is consent under Law 91/2025 for location, which is sensitive personal data (SRS NFR-PRV-01, 02). The notice repeats that the position is read once, at the tap, and is never tracked.

## 3. Face data and the NAS face store

- In the app: the face consent is the signed paper form that HR records at enrolment (`face_enrolment`). R4-E added self-service withdrawal. Withdrawing now also writes a `face_check_in / withdrawn` row in `privacy_consent_event`.
- **The NAS kiosk** (`tools/face-kiosk`, superseded by the in-app kiosk) keeps its own SQLite store (`data/kiosk.db`) with face embeddings and its own consent dates. Its only link to SuZu One is the device roster (`GET /api/attendance/device/roster`). **That roster now leaves out people who have left (`offboarded`) and people who withdrew face consent and were not enrolled again since.** At its next sync (every 10 minutes) the NAS stops recognising them. It then deletes their faces after `PURGE_INACTIVE_DAYS`, which defaults to 30.
- **Decision: decommission the NAS kiosk.** Nothing in the app needs it. Its store is a second copy of biometric data that sits outside the app's purge and outside its backups policy. Steps (infrastructure, not code):
  1. In SuZu One, under Attendance → Time clocks, open the NAS kiosk device and revoke its push token. Then deactivate the device.
  2. On the NAS, under Container Manager → Project `face-kiosk`, stop the project and delete it.
  3. Delete `/volume1/docker/face-kiosk/data/` (`kiosk.db` and its WAL files) and the `.env`.
  4. Delete any Hyper Backup versions that contain that folder, or let them expire. Check the backup task's retention.
  5. Record the date in the processing register.
- Until then, set `PURGE_INACTIVE_DAYS=0` in `docker-compose.yml`, so the NAS deletes a leaver's or a withdrawing person's faces at the next roster sync instead of 30 days later.

## 4. Knowledge-base embeddings (Cloudflare Workers AI)

`kb/chunks.ts` sends every published passage and every typed question to Cloudflare Workers AI (`@cf/baai/bge-m3`) to compute vectors.

**Decision: both.**
1. **Redact before sending.** `kb/embeddings.ts` now passes every text through the assistant's own `redactContacts` (emails, Vietnamese phone numbers, Zalo/Messenger/Telegram/WhatsApp links) before it leaves for Cloudflare. A vector does not need a phone number to find a page. A test checks the request body.
2. **Record Cloudflare as a processor.** Redaction cannot recognise names, and a question may name a colleague. Cloudflare Inc. (Workers AI, inference only) therefore goes into the processing register as a processor of KB text and assistant questions. It should be covered by Cloudflare's DPA (the Cloudflare Customer DPA — confirm it is accepted for the account), and it is a cross-border transfer to add to the Q16 dossier. R2 file storage is with the same vendor and goes on the same line.

The KB is not meant to hold personal data. Page owners should keep it out, and the assistant's existing guardrails apply on the way to a chat model. Vectors computed before this change were made from unredacted text. They are not personal data in readable form, and they are replaced whenever a passage changes or the model changes.

## 5. Virus scanning

Every stored file is `scan_status = not_scanned`. The current controls are:
- an allow-list of file types
- a magic-byte check of the first bytes against the extension, so a script renamed `.pdf` is refused
- a size cap per type
- private buckets with short-lived signed links
- downloads served as attachments
- CSP and `nosniff`

Options, with no new paid service:

| Option | For | Against |
|---|---|---|
| A. **Accept the risk, keep the controls above** and keep `not_scanned` honest | Nothing to run. Files are opened on company laptops, where Windows Defender / XProtect scans them at download. | No scan at rest. A malicious PDF, ZIP or Office file (exploit, not macro: .docm/.xlsm are not allowed) reaches its reader unflagged. |
| B. **ClamAV in a small container** (on a VM we already pay for, or on the NAS until it is retired), polling R2 for `not_scanned` objects and posting `clean`/`infected` back through an authenticated endpoint | Free and open source, and files stay in-house. The `scan_status` column and enum already exist. | One more service to run and update (signature DB ~300 MB). ClamAV's detection of new malware is modest. |
| C. ClamAV inside a Vercel function | No new host | The signature DB exceeds the function size limit and cold starts. Not workable. |
| D. VirusTotal or a similar free API | Good detection | **Rejected.** It shares uploaded files with security vendors. That would send CVs, ID scans and contracts to third parties, which is incompatible with Law 91/2025. Its free tier also forbids commercial use. |
| E. Cloudflare's own malware scanning | — | It belongs to Cloudflare's paid Zero Trust / WAF products and does not cover R2 objects at rest. |

**Recommendation: A now, B when the public careers form opens to volume.** Strangers' CVs are the only uploads from outside the company. Before the careers page is advertised widely, run ClamAV (option B) with a nightly job that marks files and quarantines any `infected` one: hide it, and tell the uploader's owner module. Until then, keep the type and magic-byte checks strict, and do not add macro-enabled Office types (`.docm`, `.xlsm`) to the allow-list.

## 6. Export my data

`/me` → "Your data and privacy" → "Download my data" produces one JSON file (`suzu-one/my-data@1`) with the following sections:
- profile
- identity and bank fields
- emergency contacts and dependants
- employment, assignments and lifecycle events
- contracts with pay terms
- vault documents (listed by name) and issued documents
- leave requests and ledger
- attendance: punches including positions not yet cleared, requests, months and days
- approval requests
- notifications
- payslips with full figures
- assistant conversations
- privacy answers and face-enrolment status

It is the person's own data only, read with their own principal. It needs a fresh step-up, like the payslip pages, because pay is in it. It is refused while seeing the app as somebody else. It is audited as `privacy.export_my_data`, with record counts only. File contents are not enclosed: each file opens from the app with its own audit entry.

## 7. Still open (owner)

- Q16 / NFR-PRV-05: the transfer impact assessment, now including Cloudflare (Workers AI, R2), Vercel, Supabase, the email provider and the AI provider.
- NFR-PRV-06: processor agreements on file for each of those vendors.
- The public Privacy Policy page (`legal.privacy` in the messages) should state the retention periods in §1 and the GPS notice in §2. This build did not change it.
