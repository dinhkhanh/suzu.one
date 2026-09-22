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

// ── Interviews (FR-REC-06) ──────────────────────────────────────────────────────────────────

/** What kind of conversation this round is. Names the *purpose*, not the tool used to hold it. */
export const INTERVIEW_KINDS = ["phone_screen", "hiring_manager", "technical", "portfolio", "culture", "panel", "final"] as const;
export type InterviewKind = (typeof INTERVIEW_KINDS)[number];

/** Where it happens. `video` is the one that carries a meeting link. */
export const INTERVIEW_MODES = ["onsite", "video", "phone"] as const;
export type InterviewMode = (typeof INTERVIEW_MODES)[number];

export const INTERVIEW_STATUSES = ["scheduled", "completed", "cancelled", "no_show"] as const;
export type InterviewStatus = (typeof INTERVIEW_STATUSES)[number];

/** An interview nobody is still waiting for. */
export const INTERVIEW_CLOSED: readonly InterviewStatus[] = ["completed", "cancelled", "no_show"];

/**
 * What the calendar adapter managed to do. The adapter is the platform's — interviews and project
 * meetings share it — and `simulated` is the honest answer on a machine with no Google
 * credentials: the internal event exists, the `.ics` works, and nothing left the building.
 */
export { CALENDAR_DELIVERY_STATUSES, type CalendarDeliveryStatus } from "../platform/calendar/enums";

/**
 * One line of an interview kit (FR-REC-06: structured scorecards). The kit lives on the **opening**
 * and is **copied onto the interview** when it is scheduled, so rewriting the kit next month does
 * not rewrite what last month's interviewers were asked — a scorecard has to keep meaning what it
 * meant when it was filled in.
 */
export type ScorecardCriterion = { key: string; label: string; labelEn: string | null; hint: string | null };

/** The kit an opening gets when nobody has written one. Four things every interview is really about. */
export const DEFAULT_INTERVIEW_KIT: readonly ScorecardCriterion[] = [
  { key: "craft", label: "Chuyên môn", labelEn: "Craft", hint: "Kỹ năng và kinh nghiệm cho đúng công việc này" },
  { key: "problem_solving", label: "Giải quyết vấn đề", labelEn: "Problem solving", hint: "Cách nghĩ khi gặp việc chưa có sẵn lời giải" },
  { key: "collaboration", label: "Phối hợp", labelEn: "Collaboration", hint: "Làm việc với người khác, nhận và đưa phản hồi" },
  { key: "motivation", label: "Động lực", labelEn: "Motivation", hint: "Vì sao là công việc này, ở đây, lúc này" },
];

/** The scale every criterion is scored on. Four points, no middle: a scorecard has to take a side. */
export const SCORE_MIN = 1;
export const SCORE_MAX = 4;

/** What the interviewer concludes. Kept separate from the ratings: the numbers inform it, they do not decide it. */
export const INTERVIEW_RECOMMENDATIONS = ["strong_no", "no", "yes", "strong_yes"] as const;
export type InterviewRecommendation = (typeof INTERVIEW_RECOMMENDATIONS)[number];

// ── Take-home assignments (FR-REC-07) ───────────────────────────────────────────────────────

export const ASSIGNMENT_STATUSES = ["sent", "received", "rated", "cancelled"] as const;
export type AssignmentStatus = (typeof ASSIGNMENT_STATUSES)[number];

/** An assignment nobody is still waiting on. */
export const ASSIGNMENT_CLOSED: readonly AssignmentStatus[] = ["rated", "cancelled"];

/** What the candidate's submission page accepts. Same spirit as `PUBLIC_LIMITS`. */
export const ASSIGNMENT_LIMITS = { note: 5_000, link: 300, links: 5 } as const;

/** How long a take-home link stays usable after the due date before it stops opening at all. */
export const ASSIGNMENT_GRACE_DAYS = 3;

// ── Offers (FR-REC-08) ──────────────────────────────────────────────────────────────────────

/**
 * An offer's life. Three of these are worth reading twice:
 *
 *   · `pending_approval` → `rejected` is an *internal* refusal — the company decided not to make
 *     this offer. It never reached the candidate and it is not a decline.
 *   · `approved` → `sent` is the moment the figure leaves the building. Before it, the offer can
 *     still be edited; after it, it cannot, because the candidate is holding a piece of paper.
 *   · `expired` is set by nobody: `offerExpiredOn` decides it from the clock, and the screens and
 *     the response path read it. A stale row is not a live offer just because no job has run.
 */
export const OFFER_STATUSES = ["draft", "pending_approval", "approved", "rejected", "sent", "accepted", "declined", "withdrawn", "expired"] as const;
export type OfferStatus = (typeof OFFER_STATUSES)[number];

/** Offers that still occupy the application — at most one of these may exist for it at a time. */
export const OFFER_LIVE: readonly OfferStatus[] = ["draft", "pending_approval", "approved", "sent", "accepted"];

/** Offers nobody is waiting on any more. */
export const OFFER_CLOSED: readonly OfferStatus[] = ["rejected", "accepted", "declined", "withdrawn", "expired"];

/** Why the candidate said no. A short list so the funnel report can count it (FR-REC-11). */
export const OFFER_DECLINE_REASONS = ["compensation", "counter_offer", "another_offer", "role_fit", "location", "timing", "personal", "other"] as const;
export type OfferDeclineReason = (typeof OFFER_DECLINE_REASONS)[number];

/** How long an offer stands by default before it lapses. Company practice; the form may override it. */
export const DEFAULT_OFFER_VALID_DAYS = 7;

/** What an offer may contain. Probation in Vietnam is capped at 60 days for most roles (Labour Code art. 25). */
export const OFFER_LIMITS = { probationMonths: 6, probationPercentMin: 85, note: 5_000, maxMonthlyVnd: 2_000_000_000 } as const;

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
