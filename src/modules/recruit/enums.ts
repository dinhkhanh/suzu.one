// Value lists of the recruitment module (FR-REC-01..13). Plain module: shared by the server, the
// forms, the seed and the public careers page. (Constants exported from a `"use client"` file
// become client references on the server — the lesson `src/modules/core-hr/enums.ts` records.)

/**
 * Where a pipeline stage sits in the funnel. The *names* of stages are configuration — a pipeline
 * for a video editor is not a pipeline for an accountant — but the funnel report has to compare
 * openings with different stage names, so every stage declares which of these it is.
 */
export const STAGE_CATEGORIES = ["applied", "screening", "interview", "assignment", "offer", "hired"] as const;
export type StageCategory = (typeof STAGE_CATEGORIES)[number];

/**
 * How far an application got. Deliberately **not** a stage: a rejection keeps the stage it was
 * rejected at, which is the whole of what a funnel report needs to say where people fall out.
 */
export const APPLICATION_STATUSES = ["active", "hired", "rejected", "withdrawn"] as const;
export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];

/** An application nobody moves any more. */
export const APPLICATION_CLOSED: readonly ApplicationStatus[] = ["hired", "rejected", "withdrawn"];

/** Where the candidate came from (FR-REC-04: source tracking). */
export const CANDIDATE_SOURCES = ["careers_page", "referral", "job_board", "social", "agency", "direct", "event", "other"] as const;
export type CandidateSource = (typeof CANDIDATE_SOURCES)[number];

/** Why an application ended. Kept as a short list so source effectiveness can be counted. */
export const REJECTION_REASONS = ["not_qualified", "experience", "salary", "culture_fit", "position_filled", "withdrew", "no_response", "failed_assignment", "other"] as const;
export type RejectionReason = (typeof REJECTION_REASONS)[number];

/** A job opening's life (FR-REC-02). `filled` closes it because somebody was hired; `closed` for any other reason. */
export const OPENING_STATUSES = ["draft", "open", "on_hold", "closed", "filled"] as const;
export type OpeningStatus = (typeof OPENING_STATUSES)[number];

/** Statuses whose opening still takes applications — the only ones the public page ever shows. */
export const OPENING_PUBLIC_STATUSES: readonly OpeningStatus[] = ["open"];

/** What the hiring team member is there for. Drives what the module offers them, not what they may read. */
export const OPENING_MEMBER_ROLES = ["recruiter", "hiring_manager", "interviewer"] as const;
export type OpeningMemberRole = (typeof OPENING_MEMBER_ROLES)[number];

/** How the job is engaged. Mirrors the workforce types core-HR uses when the candidate becomes a person. */
export const EMPLOYMENT_TYPES = ["employee", "probation", "intern", "part_time", "collaborator"] as const;
export type EmploymentType = (typeof EMPLOYMENT_TYPES)[number];

export const WORK_MODES = ["onsite", "hybrid", "remote"] as const;
export type WorkMode = (typeof WORK_MODES)[number];

/** A hiring request's own life, beside the approval request that decides it (FR-REC-01). */
export const HIRING_REQUEST_STATUSES = ["pending", "approved", "rejected", "withdrawn", "fulfilled"] as const;
export type HiringRequestStatus = (typeof HIRING_REQUEST_STATUSES)[number];

/** Everything that ever happened to one application, in order. Only ever inserted. */
export const APPLICATION_EVENT_TYPES = [
  "applied",
  "stage_moved",
  "rejected",
  "withdrawn",
  "hired",
  "reopened",
  "note",
  "edited",
  // Later weeks write these; the list lives here so the history reads in one place.
  "emailed",
  "interview_scheduled",
  "interview_cancelled",
  "scorecard_submitted",
  "assignment_sent",
  "assignment_received",
  "offer_made",
  "offer_accepted",
  "offer_declined",
  "converted",
  "anonymised",
] as const;
export type ApplicationEventType = (typeof APPLICATION_EVENT_TYPES)[number];

/**
 * A custom question an opening asks its applicants (FR-REC-03). Kept as JSON on the opening rather
 * than a table: the questions are part of the advertisement, they are never queried across
 * openings, and an answer is only ever read beside the application that gave it.
 */
export type OpeningQuestion = { key: string; label: string; labelEn: string | null; kind: "text" | "long_text" | "choice"; required: boolean; choices: string[] };

/** How long an unsuccessful candidate's data is kept by default (FR-REC-13, PDPL). Configuration, not a constant in the engine. */
export const DEFAULT_RETENTION_MONTHS = 12;

// ── The public careers page (FR-REC-03) ─────────────────────────────────────────────────────

/**
 * Which privacy notice the candidate agreed to. Stored on the candidate row, so that when the
 * wording changes it is still possible to say what each person was actually shown — which is the
 * whole point of recording consent rather than a boolean (PDPL).
 *
 * **Bump this whenever `recruit.careers.consent.*` changes in either message bundle.**
 */
export const CONSENT_VERSION = "2026-09-pdpl-1";

/** What the public form is allowed to contain, so a probe cannot post a 10 MB cover letter. */
export const PUBLIC_LIMITS = {
  fullName: 120,
  email: 200,
  phone: 40,
  location: 120,
  currentTitle: 120,
  currentEmployer: 120,
  coverLetter: 5_000,
  answer: 2_000,
  link: 300,
  links: 8,
} as const;

// ── Candidate emails (FR-REC-05) ────────────────────────────────────────────────────────────

/** What a wording is for. The kind decides which templates a screen offers, nothing more. */
export const RECRUIT_EMAIL_KINDS = ["invite", "reject", "offer", "general"] as const;
export type RecruitEmailKind = (typeof RECRUIT_EMAIL_KINDS)[number];

/**
 * Everything a candidate email may name. A short allow-list on purpose — see the note at the top
 * of `engine/email-template.ts`. **No figure appears here**: money belongs in the offer letter,
 * which is a tiered document, not in a wording anybody with `recruit:manage` may edit.
 */
export const RECRUIT_EMAIL_PLACEHOLDERS = [
  "candidate_name",
  "job_title",
  "company_name",
  "stage_name",
  "sender_name",
  "careers_url",
] as const;
export type RecruitEmailPlaceholder = (typeof RECRUIT_EMAIL_PLACEHOLDERS)[number];
