// Recruitment / ATS (FR-REC-01..13). Eight tables, and the shape of them follows the way hiring
// actually runs: somebody asks for a head, the ask is approved, the approved ask becomes an
// opening, the opening runs a configurable pipeline, and people walk through that pipeline.
//
// Two decisions are worth reading before the columns:
//
//   · **A candidate is not a person.** `person` is the employee register; a candidate is somebody
//     outside the company who may never join it. They get their own table with their own retention
//     clock (FR-REC-13), and only `core-hr`'s hire use-case ever turns one into a person.
//   · **Money lives on its own columns and never in an approval payload.** A hiring request's
//     budget and an opening's salary band are compensation-tier facts; the approval engine's
//     payload and summary are read by approvers, inboxes, notifications and the audit log, so the
//     figures stay here where `policy.ts` decides who is shown them.
import { bigint, boolean, date, index, integer, jsonb, pgTable, smallint, text, timestamp, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { approvalRequest } from "../platform/approvals/schema";
import { department, entity, team } from "../platform/org/schema";
import { person } from "../platform/people/schema";
import type {
  ApplicationEventType,
  ApplicationStatus,
  CalendarDeliveryStatus,
  CandidateSource,
  EmploymentType,
  HiringRequestStatus,
  InterviewKind,
  InterviewMode,
  InterviewRecommendation,
  InterviewStatus,
  OpeningMemberRole,
  OpeningQuestion,
  OpeningStatus,
  RecruitEmailKind,
  RejectionReason,
  ScorecardCriterion,
  StageCategory,
  WorkMode,
} from "./enums";

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
};

// ── Pipelines (FR-REC-02: stages configurable per job) ──────────────────────────────────────

// Shared by the group: a pipeline is a way of hiring, and the way you hire a designer does not
// change between legal entities. An opening points at one and copies nothing.
export const recruitPipeline = pgTable(
  "recruit_pipeline",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    code: text("code").notNull().unique(),
    name: text("name").notNull(),
    nameEn: text("name_en"),
    description: text("description"),
    // Offered first when an opening is created. At most one, kept true by the use-case.
    isDefault: boolean("is_default").notNull().default(false),
    isActive: boolean("is_active").notNull().default(true),
    ...timestamps,
  },
  (t) => [index("recruit_pipeline_active_idx").on(t.isActive)],
).enableRLS();

export const recruitPipelineStage = pgTable(
  "recruit_pipeline_stage",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    pipelineId: uuid("pipeline_id")
      .notNull()
      .references(() => recruitPipeline.id),
    // Stable within the pipeline, so a stage can be renamed without breaking anything that names it.
    key: text("key").notNull(),
    name: text("name").notNull(),
    nameEn: text("name_en"),
    sortOrder: smallint("sort_order").notNull(),
    // Which rung of the funnel this is, whatever it is called. See `enums.ts`.
    category: text("category").$type<StageCategory>().notNull(),
    ...timestamps,
  },
  (t) => [unique("recruit_pipeline_stage_key").on(t.pipelineId, t.key), index("recruit_pipeline_stage_order_idx").on(t.pipelineId, t.sortOrder)],
).enableRLS();

// ── The ask (FR-REC-01) ─────────────────────────────────────────────────────────────────────

// A manager asks for a head. The decision is the approval engine's; this row is the ask itself,
// and it keeps the budget, which the approval payload deliberately does not.
export const hiringRequest = pgTable(
  "hiring_request",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    entityId: uuid("entity_id")
      .notNull()
      .references(() => entity.id),
    departmentId: uuid("department_id").references(() => department.id),
    teamId: uuid("team_id").references(() => team.id),
    positionTitle: text("position_title").notNull(),
    jobLevel: text("job_level"),
    headcount: integer("headcount").notNull().default(1),
    employmentType: text("employment_type").$type<EmploymentType>().notNull().default("employee"),
    workLocation: text("work_location"),
    // Why the head is needed: replacement, growth, a new service line. Free text on purpose.
    reason: text("reason").notNull(),
    targetStartDate: date("target_start_date"),
    /**
     * Integer VND per month, the band the manager is asking to spend. **Compensation tier**:
     * `policy.ts` decides who is shown it, and it is never copied into the approval request's
     * payload or summary, which approvers, inboxes and the audit log all read.
     */
    budgetMinVnd: bigint("budget_min_vnd", { mode: "number" }),
    budgetMaxVnd: bigint("budget_max_vnd", { mode: "number" }),
    requestedByPersonId: uuid("requested_by_person_id")
      .notNull()
      .references(() => person.id),
    // Who will run the interviews and take the person on. Defaults to the requester.
    hiringManagerPersonId: uuid("hiring_manager_person_id").references(() => person.id),
    status: text("status").$type<HiringRequestStatus>().notNull().default("pending"),
    approvalRequestId: uuid("approval_request_id").references(() => approvalRequest.id),
    // Set when the approved ask was turned into an opening — the "no retyping" link.
    openingId: uuid("opening_id"),
    ...timestamps,
  },
  (t) => [index("hiring_request_entity_idx").on(t.entityId, t.status), index("hiring_request_requester_idx").on(t.requestedByPersonId, t.createdAt), index("hiring_request_approval_idx").on(t.approvalRequestId)],
).enableRLS();

// ── The opening (FR-REC-02) ─────────────────────────────────────────────────────────────────

export const jobOpening = pgTable(
  "job_opening",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // What people call it in a meeting: SZM-2026-003. Unique across the group.
    code: text("code").notNull().unique(),
    title: text("title").notNull(),
    titleEn: text("title_en"),
    entityId: uuid("entity_id")
      .notNull()
      .references(() => entity.id),
    departmentId: uuid("department_id").references(() => department.id),
    teamId: uuid("team_id").references(() => team.id),
    positionName: text("position_name"),
    jobLevel: text("job_level"),
    employmentType: text("employment_type").$type<EmploymentType>().notNull().default("employee"),
    workMode: text("work_mode").$type<WorkMode>().notNull().default("onsite"),
    workLocation: text("work_location"),
    headcount: integer("headcount").notNull().default(1),
    // The advertisement. Plain text with blank lines; the public page renders paragraphs, never HTML.
    description: text("description").notNull().default(""),
    requirements: text("requirements").notNull().default(""),
    benefits: text("benefits").notNull().default(""),
    /** Integer VND per month. **Compensation tier** — see the note at the top of this file. */
    salaryMinVnd: bigint("salary_min_vnd", { mode: "number" }),
    salaryMaxVnd: bigint("salary_max_vnd", { mode: "number" }),
    // Whether the band is printed on the public advertisement. Off by default: publishing a band
    // is a decision somebody takes, not something that happens because a field was filled in.
    salaryPublic: boolean("salary_public").notNull().default(false),
    pipelineId: uuid("pipeline_id")
      .notNull()
      .references(() => recruitPipeline.id),
    hiringRequestId: uuid("hiring_request_id").references(() => hiringRequest.id),
    status: text("status").$type<OpeningStatus>().notNull().default("draft"),
    /**
     * What the public URL carries. Opaque and unguessable, so no internal id ever reaches the
     * careers page, and an unpublished opening answers exactly like one that does not exist.
     */
    publicSlug: text("public_slug").notNull().unique(),
    // Custom questions the application form asks (FR-REC-03). See `OpeningQuestion` in enums.ts.
    questions: jsonb("questions").$type<OpeningQuestion[]>().notNull().default([]),
    /**
     * The interview kit (FR-REC-06): what every interviewer on this job is asked to judge. Empty
     * means `DEFAULT_INTERVIEW_KIT`. It is **copied onto each interview** when one is scheduled —
     * see the note on `ScorecardCriterion` — so this column is the current kit, not the history.
     */
    interviewKit: jsonb("interview_kit").$type<ScorecardCriterion[]>().notNull().default([]),
    targetStartDate: date("target_start_date"),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    closeReason: text("close_reason"),
    createdByPersonId: uuid("created_by_person_id").references(() => person.id),
    ...timestamps,
  },
  (t) => [index("job_opening_entity_idx").on(t.entityId, t.status), index("job_opening_department_idx").on(t.departmentId), index("job_opening_status_idx").on(t.status, t.publishedAt)],
).enableRLS();

// Who runs this opening. This table — not a role — is how a department head sees *their* opening
// and no other: `policy.ts` reads membership beside the role catalogue (see its header).
export const jobOpeningMember = pgTable(
  "job_opening_member",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    openingId: uuid("opening_id")
      .notNull()
      .references(() => jobOpening.id),
    personId: uuid("person_id")
      .notNull()
      .references(() => person.id),
    role: text("role").$type<OpeningMemberRole>().notNull(),
    ...timestamps,
  },
  (t) => [unique("job_opening_member_key").on(t.openingId, t.personId), index("job_opening_member_person_idx").on(t.personId)],
).enableRLS();

// ── The candidate database (FR-REC-04) ──────────────────────────────────────────────────────

export const candidate = pgTable(
  "candidate",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    fullName: text("full_name").notNull(),
    // Accent-stripped, lower-cased (`@/lib/text`), for search and for the duplicate check.
    searchName: text("search_name").notNull(),
    email: text("email"),
    phone: text("phone"),
    /**
     * The normalised forms the duplicate check matches on (`engine/duplicates.ts`): lower-cased
     * address with the `+tag` removed, and the national significant digits of the number. Stored
     * rather than computed in the query so the index does the work.
     */
    emailKey: text("email_key"),
    phoneKey: text("phone_key"),
    currentTitle: text("current_title"),
    currentEmployer: text("current_employer"),
    location: text("location"),
    // Portfolio and profile links — the thing that matters most for a creative agency (FR-REC-03).
    links: text("links").array().notNull().default([]),
    source: text("source").$type<CandidateSource>().notNull().default("direct"),
    sourceDetail: text("source_detail"),
    referredByPersonId: uuid("referred_by_person_id").references(() => person.id),
    tags: text("tags").array().notNull().default([]),
    notes: text("notes"),
    /**
     * PDPL (FR-REC-03, 13). `consentAt` is when the candidate agreed to the notice they were shown
     * and `consentVersion` is which notice that was; `talentPoolConsent` is the separate, opt-in
     * agreement to be kept on file after this application ends, which is the only thing that
     * extends `retainUntil`. `anonymisedAt` is set by the retention job, never by a person.
     */
    consentAt: timestamp("consent_at", { withTimezone: true }),
    consentVersion: text("consent_version"),
    talentPoolConsent: boolean("talent_pool_consent").notNull().default(false),
    retainUntil: date("retain_until"),
    anonymisedAt: timestamp("anonymised_at", { withTimezone: true }),
    // Null when the candidate applied through the public page: nobody inside the company made them.
    createdByPersonId: uuid("created_by_person_id").references(() => person.id),
    ...timestamps,
  },
  (t) => [
    index("candidate_email_key_idx").on(t.emailKey),
    index("candidate_phone_key_idx").on(t.phoneKey),
    index("candidate_search_name_idx").on(t.searchName),
    index("candidate_retention_idx").on(t.retainUntil, t.anonymisedAt),
  ],
).enableRLS();

// One candidate going for one opening. The unique index is the rule: applying twice to the same
// job is the same application, not a second one.
export const jobApplication = pgTable(
  "job_application",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    candidateId: uuid("candidate_id")
      .notNull()
      .references(() => candidate.id),
    openingId: uuid("opening_id")
      .notNull()
      .references(() => jobOpening.id),
    stageId: uuid("stage_id")
      .notNull()
      .references(() => recruitPipelineStage.id),
    status: text("status").$type<ApplicationStatus>().notNull().default("active"),
    source: text("source").$type<CandidateSource>().notNull().default("careers_page"),
    sourceDetail: text("source_detail"),
    coverLetter: text("cover_letter"),
    // Answers to the opening's custom questions, by question key.
    answers: jsonb("answers").$type<Record<string, string>>().notNull().default({}),
    // The CV, in the files module. Uploads from the public page are marked `not_scanned` there:
    // no virus scanner exists yet, and `policy.ts` keeps the file to the people running the opening.
    cvFileId: uuid("cv_file_id"),
    portfolioLinks: text("portfolio_links").array().notNull().default([]),
    /** Integer VND per month, what the candidate asks for. **Compensation tier.** */
    salaryExpectationVnd: bigint("salary_expectation_vnd", { mode: "number" }),
    salaryExpectationNote: text("salary_expectation_note"),
    appliedAt: timestamp("applied_at", { withTimezone: true }).notNull().defaultNow(),
    // When it entered the stage it is in — the clock the pipeline board ages cards by.
    stageEnteredAt: timestamp("stage_entered_at", { withTimezone: true }).notNull().defaultNow(),
    rejectionReason: text("rejection_reason").$type<RejectionReason>(),
    rejectionNote: text("rejection_note"),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    decidedByPersonId: uuid("decided_by_person_id").references(() => person.id),
    // Set when the accepted candidate became a person (FR-REC-09). Week 4 writes it.
    hiredPersonId: uuid("hired_person_id").references(() => person.id),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("job_application_candidate_opening_key").on(t.candidateId, t.openingId),
    index("job_application_opening_idx").on(t.openingId, t.status, t.stageId),
    index("job_application_candidate_idx").on(t.candidateId, t.appliedAt),
  ],
).enableRLS();

// Everything that ever happened to one application, in order. Only ever inserted.
export const applicationEvent = pgTable(
  "application_event",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    applicationId: uuid("application_id")
      .notNull()
      .references(() => jobApplication.id),
    type: text("type").$type<ApplicationEventType>().notNull(),
    fromStageId: uuid("from_stage_id").references(() => recruitPipelineStage.id),
    toStageId: uuid("to_stage_id").references(() => recruitPipelineStage.id),
    // Null when the public application form wrote it: nobody inside the company acted.
    actorPersonId: uuid("actor_person_id").references(() => person.id),
    note: text("note"),
    // What changed — never a figure, because the history is read more widely than the money.
    detail: jsonb("detail").$type<Record<string, unknown>>(),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("application_event_application_idx").on(t.applicationId, t.id)],
).enableRLS();

// ── Interviews (FR-REC-06) ──────────────────────────────────────────────────────────────────

/**
 * One conversation with one candidate, at one time, with one or more interviewers.
 *
 * **The internal event is the record.** Google Calendar is not available to this system (no keys,
 * no incremental OAuth scopes), so scheduling was built the other way round from the usual: this
 * row is the truth, `engine/ics.ts` turns it into a calendar file anybody's calendar can read, and
 * `calendar.ts` is an adapter that *may* also push it to Google when somebody configures it. The
 * `calendar_*` columns below record what that adapter managed — `simulated` on a machine with no
 * credentials, which is honest rather than silent.
 */
export const interview = pgTable(
  "interview",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    applicationId: uuid("application_id")
      .notNull()
      .references(() => jobApplication.id),
    // Denormalised from the application so every scope query can filter on it in one join.
    openingId: uuid("opening_id")
      .notNull()
      .references(() => jobOpening.id),
    // Which rung of the pipeline this round belongs to. Null when it belongs to none in particular.
    stageId: uuid("stage_id").references(() => recruitPipelineStage.id),
    kind: text("kind").$type<InterviewKind>().notNull(),
    round: smallint("round").notNull().default(1),
    title: text("title").notNull(),
    startAt: timestamp("start_at", { withTimezone: true }).notNull(),
    endAt: timestamp("end_at", { withTimezone: true }).notNull(),
    mode: text("mode").$type<InterviewMode>().notNull().default("onsite"),
    location: text("location"),
    meetingUrl: text("meeting_url"),
    status: text("status").$type<InterviewStatus>().notNull().default("scheduled"),
    // What the candidate is told beside the time — the address, what to bring. Goes in the invitation.
    notesForCandidate: text("notes_for_candidate"),
    /**
     * The kit the interviewers are asked to fill in, copied from the opening at scheduling time.
     * A kit edited afterwards does not change what these scorecards mean.
     */
    criteria: jsonb("criteria").$type<ScorecardCriterion[]>().notNull().default([]),
    // What `calendar.ts` did with this event. See the note above.
    calendarDriver: text("calendar_driver"),
    calendarStatus: text("calendar_status").$type<CalendarDeliveryStatus>(),
    calendarEventId: text("calendar_event_id"),
    calendarError: text("calendar_error"),
    scheduledByPersonId: uuid("scheduled_by_person_id").references(() => person.id),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    cancelReason: text("cancel_reason"),
    ...timestamps,
  },
  (t) => [index("interview_application_idx").on(t.applicationId, t.startAt), index("interview_opening_idx").on(t.openingId, t.startAt), index("interview_start_idx").on(t.startAt, t.status)],
).enableRLS();

/**
 * Who is in the room. **Being an interviewer is not being on the hiring team**: it admits this
 * person to *this interview* and the candidate behind it, and to nothing else about the opening.
 * A colleague brought in for one technical round does not thereby get the candidate database.
 */
export const interviewInterviewer = pgTable(
  "interview_interviewer",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    interviewId: uuid("interview_id")
      .notNull()
      .references(() => interview.id),
    personId: uuid("person_id")
      .notNull()
      .references(() => person.id),
    // Who runs the conversation. Cosmetic; it decides nothing about access.
    isLead: boolean("is_lead").notNull().default(false),
    ...timestamps,
  },
  (t) => [unique("interview_interviewer_key").on(t.interviewId, t.personId), index("interview_interviewer_person_idx").on(t.personId)],
).enableRLS();

/**
 * One interviewer's verdict (FR-REC-06: "feedback hidden from other interviewers until submitted").
 *
 * **`submitted_at` is the whole rule.** A scorecard with a null `submitted_at` is a private draft;
 * a submitted one is visible to the rest of the panel. `scorecardsFor` in `interviews.ts` will not
 * return anybody else's row to an interviewer who has not submitted their own, and the test that
 * says so calls the service, not a page — the rule is not a piece of UI that can be posted around.
 * Submitting is final: an interviewer who could revise after reading the others has not been blind.
 */
export const interviewScorecard = pgTable(
  "interview_scorecard",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    interviewId: uuid("interview_id")
      .notNull()
      .references(() => interview.id),
    interviewerPersonId: uuid("interviewer_person_id")
      .notNull()
      .references(() => person.id),
    // Scores by criterion key, 1..4. Keys that are not in the interview's own kit are dropped.
    ratings: jsonb("ratings").$type<Record<string, number>>().notNull().default({}),
    recommendation: text("recommendation").$type<InterviewRecommendation>(),
    strengths: text("strengths"),
    concerns: text("concerns"),
    notes: text("notes"),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [unique("interview_scorecard_key").on(t.interviewId, t.interviewerPersonId), index("interview_scorecard_person_idx").on(t.interviewerPersonId, t.submittedAt)],
).enableRLS();

// ── The public careers page (FR-REC-03) ─────────────────────────────────────────────────────

/**
 * One counted window of one visitor's requests to the careers page. The whole rate limiter: an
 * atomic `insert … on conflict do update set hits = hits + 1 returning hits` against the unique
 * key below, with the arithmetic in `engine/rate-limit.ts`.
 *
 * **`visitor_hash` is not an address.** It is HMAC-SHA-256 of the caller's IP under the
 * application secret, truncated to 16 hex characters (`visitorOf` in `src/lib/public-action.ts`):
 * enough to count one visitor's submissions for an hour, not enough to recover the address, to
 * join it to anything else, or to be personal data worth keeping (PDPL minimisation). The rows are
 * swept by the retention job.
 */
export const recruitPublicHit = pgTable(
  "recruit_public_hit",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // What was counted: "apply", "form". See `CAREERS_LIMITS`.
    bucket: text("bucket").notNull(),
    visitorHash: text("visitor_hash").notNull(),
    windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
    hits: integer("hits").notNull().default(1),
    lastAt: timestamp("last_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("recruit_public_hit_key").on(t.bucket, t.visitorHash, t.windowStart), index("recruit_public_hit_window_idx").on(t.windowStart)],
).enableRLS();

// ── Candidate emails (FR-REC-05) ────────────────────────────────────────────────────────────

/**
 * A wording a recruiter sends a candidate: the invitation, the rejection, the offer note. Both
 * languages live on the row because the recipient is outside the company and their language is a
 * property of *them*, not of the sender's locale cookie.
 *
 * Sending goes through the existing outbox (`email_outbox`), so a candidate email is delivered,
 * retried and — with no `RESEND_API_KEY` — simulated by exactly the same code as every other
 * email in the system. There is no second mail path to get wrong.
 */
export const recruitEmailTemplate = pgTable(
  "recruit_email_template",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    code: text("code").notNull().unique(),
    name: text("name").notNull(),
    kind: text("kind").$type<RecruitEmailKind>().notNull(),
    subject: text("subject").notNull(),
    body: text("body").notNull(),
    subjectEn: text("subject_en"),
    bodyEn: text("body_en"),
    isActive: boolean("is_active").notNull().default(true),
    updatedByPersonId: uuid("updated_by_person_id").references(() => person.id),
    ...timestamps,
  },
  (t) => [index("recruit_email_template_kind_idx").on(t.kind, t.isActive)],
).enableRLS();
