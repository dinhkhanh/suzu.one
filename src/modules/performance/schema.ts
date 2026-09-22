// Performance (FR-PRF). Phase 3.5 week 1: the goal tree, key results and the append-only check-in
// log. Scores must be reproducible (SRS D13 — the year-end bonus is computed from them): current
// values only ever change through a check-in row, and closing a goal freezes its figure.
// Value lists are in enums.ts.
import { type AnyPgColumn, bigint, boolean, date, index, integer, jsonb, pgTable, text, timestamp, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { position } from "../core-hr/schema";
import { entity, orgUnit } from "../platform/org/schema";
import { person } from "../platform/people/schema";
import type { KpiTrace } from "./engine/kpi-score";
import type { ResultTrace } from "./engine/result";
import type { ReviewScoreTrace } from "./engine/review-score";
import type { Milestone, PerformanceWeightingValue, RatingPoint, ReviewAnswers, ReviewFormShape, ReviewSection } from "./enums";

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
};

export const goal = pgTable(
  "goal",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // group | entity | department | team | individual
    level: text("level").notNull(),
    // Where the goal sits: nothing for the group; a department goal may name the entity it is meant
    // for (departments are shared); a team goal carries its department; an individual goal its person.
    entityId: uuid("entity_id").references(() => entity.id),
    departmentId: uuid("department_id").references(() => orgUnit.id),
    teamId: uuid("team_id").references(() => orgUnit.id),
    personId: uuid("person_id").references(() => person.id),
    // Accountable for the goal and the one who checks in.
    ownerPersonId: uuid("owner_person_id")
      .notNull()
      .references(() => person.id),
    parentGoalId: uuid("parent_goal_id").references((): AnyPgColumn => goal.id),
    title: text("title").notNull(),
    description: text("description"),
    year: integer("year").notNull(),
    // "2027" (annual) or "2027-Q1" … "2027-Q4".
    periodKey: text("period_key").notNull(),
    // draft | active | closed | cancelled
    status: text("status").notNull().default("draft"),
    // Its share when a parent without key results averages its children.
    weight: integer("weight").notNull().default(1),
    // Frozen at close, in basis points: the figure Phase 8 reads cannot move afterwards.
    finalProgressBp: integer("final_progress_bp"),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    closedByPersonId: uuid("closed_by_person_id").references(() => person.id),
    createdByPersonId: uuid("created_by_person_id").references(() => person.id),
    ...timestamps,
  },
  (t) => [index("goal_parent_idx").on(t.parentGoalId), index("goal_person_idx").on(t.personId), index("goal_year_level_idx").on(t.year, t.level)],
).enableRLS();

export const keyResult = pgTable(
  "key_result",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    goalId: uuid("goal_id")
      .notNull()
      .references(() => goal.id),
    title: text("title").notNull(),
    // number | percent | currency | milestone
    metricType: text("metric_type").notNull(),
    // Integers: hundredths for number and percent, whole VND for currency (enums.ts scaleOf).
    // A target below the start means "bring it down".
    startValue: bigint("start_value", { mode: "number" }).notNull().default(0),
    targetValue: bigint("target_value", { mode: "number" }).notNull().default(0),
    currentValue: bigint("current_value", { mode: "number" }).notNull().default(0),
    // For milestone key results: progress = done / total.
    milestones: jsonb("milestones").$type<Milestone[]>(),
    weight: integer("weight").notNull().default(1),
    sortOrder: integer("sort_order").notNull().default(0),
    // Copied from the latest check-in, which is the record.
    confidence: text("confidence"),
    lastCheckInAt: timestamp("last_check_in_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [index("key_result_goal_idx").on(t.goalId)],
).enableRLS();

// Append-only: the history of every figure a score was computed from. No update or delete path.
export const goalCheckIn = pgTable(
  "goal_check_in",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    keyResultId: uuid("key_result_id")
      .notNull()
      .references(() => keyResult.id),
    goalId: uuid("goal_id")
      .notNull()
      .references(() => goal.id),
    // The Monday of the week the check-in belongs to (Vietnam time).
    weekStart: date("week_start").notNull(),
    value: bigint("value", { mode: "number" }),
    milestones: jsonb("milestones").$type<Milestone[]>(),
    confidence: text("confidence").notNull(),
    note: text("note"),
    authorPersonId: uuid("author_person_id")
      .notNull()
      .references(() => person.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("goal_check_in_key_result_idx").on(t.keyResultId, t.createdAt), index("goal_check_in_goal_idx").on(t.goalId, t.createdAt)],
).enableRLS();

// ── KPIs (FR-PRF-02, week 2) ────────────────────────────────────────────────────────────────
// The library, templates per position, what each person is measured on (effective-dated by
// month), the actuals, and — once HR closes a month — the stored score with everything it was
// computed from. The bonus (SRS D13) reads the stored scores only.

export const kpiDefinition = pgTable("kpi_definition", {
  id: uuid("id").primaryKey().defaultRandom(),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  description: text("description"),
  // number | percent | currency — hundredths for the first two, whole VND for money.
  unit: text("unit").notNull(),
  // higher_better | lower_better
  direction: text("direction").notNull().default("higher_better"),
  // monthly | quarterly
  frequency: text("frequency").notNull().default("monthly"),
  capBp: integer("cap_bp").notNull().default(12000),
  floorBp: integer("floor_bp").notNull().default(0),
  // FR-PJM-62: a KPI measured from work (on_time_rate | deliverables_accepted | utilisation |
  // revision_rounds …) gets its monthly actual proposed from PJM data; a person confirms it.
  workMetric: text("work_metric"),
  isActive: boolean("is_active").notNull().default(true),
  // Set on the first edit through the screen: re-seeding the starter library leaves such rows alone.
  editedAt: timestamp("edited_at", { withTimezone: true }),
  ...timestamps,
}).enableRLS();

// What a position is measured on. entity_id null = every entity; an entity's own rows replace the
// group's set for that position.
export const positionKpi = pgTable(
  "position_kpi",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    positionId: uuid("position_id")
      .notNull()
      .references(() => position.id),
    entityId: uuid("entity_id").references(() => entity.id),
    kpiId: uuid("kpi_id")
      .notNull()
      .references(() => kpiDefinition.id),
    weight: integer("weight").notNull(),
    targetValue: bigint("target_value", { mode: "number" }).notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    ...timestamps,
  },
  (t) => [unique("position_kpi_unique").on(t.positionId, t.entityId, t.kpiId).nullsNotDistinct(), index("position_kpi_position_idx").on(t.positionId)],
).enableRLS();

// One KPI of one person from a month on. Months are 'YYYY-MM'; to_period null = still running.
// The use-case refuses two overlapping rows of one KPI for one person.
export const kpiAssignment = pgTable(
  "kpi_assignment",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    personId: uuid("person_id")
      .notNull()
      .references(() => person.id),
    entityId: uuid("entity_id")
      .notNull()
      .references(() => entity.id),
    kpiId: uuid("kpi_id")
      .notNull()
      .references(() => kpiDefinition.id),
    weight: integer("weight").notNull(),
    targetValue: bigint("target_value", { mode: "number" }).notNull(),
    fromPeriod: text("from_period").notNull(),
    toPeriod: text("to_period"),
    sourcePositionId: uuid("source_position_id").references(() => position.id),
    createdByPersonId: uuid("created_by_person_id").references(() => person.id),
    ...timestamps,
  },
  (t) => [index("kpi_assignment_person_idx").on(t.personId), index("kpi_assignment_entity_idx").on(t.entityId, t.fromPeriod)],
).enableRLS();

// period_key: 'YYYY-MM' for a monthly KPI, 'YYYY-Qn' for a quarterly one.
export const kpiActual = pgTable(
  "kpi_actual",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    assignmentId: uuid("assignment_id")
      .notNull()
      .references(() => kpiAssignment.id),
    personId: uuid("person_id")
      .notNull()
      .references(() => person.id),
    kpiId: uuid("kpi_id")
      .notNull()
      .references(() => kpiDefinition.id),
    periodKey: text("period_key").notNull(),
    actualValue: bigint("actual_value", { mode: "number" }),
    // "Did not apply this period" (no campaign ran): left out, the other weights renormalised. Needs a note.
    notApplicable: boolean("not_applicable").notNull().default(false),
    note: text("note"),
    // manual | import
    source: text("source").notNull().default("manual"),
    enteredByPersonId: uuid("entered_by_person_id").references(() => person.id),
    ...timestamps,
  },
  (t) => [unique("kpi_actual_unique").on(t.assignmentId, t.periodKey), index("kpi_actual_person_idx").on(t.personId, t.periodKey)],
).enableRLS();

// HR closes a month per entity. No row = open.
export const kpiPeriod = pgTable(
  "kpi_period",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    entityId: uuid("entity_id")
      .notNull()
      .references(() => entity.id),
    month: text("month").notNull(),
    status: text("status").notNull().default("open"),
    closedByPersonId: uuid("closed_by_person_id").references(() => person.id),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    // Closed although actuals were missing: why, and which lines were scored as zero.
    overrideReason: text("override_reason"),
    exceptions: jsonb("exceptions").$type<{ personId: string; kpiCode: string; periodKey: string }[]>(),
    reopenedByPersonId: uuid("reopened_by_person_id").references(() => person.id),
    reopenedAt: timestamp("reopened_at", { withTimezone: true }),
    reopenReason: text("reopen_reason"),
    ...timestamps,
  },
  (t) => [unique("kpi_period_unique").on(t.entityId, t.month)],
).enableRLS();

// The snapshot a close writes. Rows are never updated except to mark them superseded by a reopen;
// the next close writes revision n + 1.
export const kpiScore = pgTable(
  "kpi_score",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    personId: uuid("person_id")
      .notNull()
      .references(() => person.id),
    entityId: uuid("entity_id")
      .notNull()
      .references(() => entity.id),
    month: text("month").notNull(),
    revision: integer("revision").notNull(),
    // null = nothing to score (every line not applicable).
    scoreBp: integer("score_bp"),
    trace: jsonb("trace").$type<KpiTrace>().notNull(),
    inputsHash: text("inputs_hash").notNull(),
    computedAt: timestamp("computed_at", { withTimezone: true }).notNull().defaultNow(),
    supersededAt: timestamp("superseded_at", { withTimezone: true }),
  },
  (t) => [
    unique("kpi_score_unique").on(t.personId, t.month, t.revision),
    // One current score per person and month, whatever the code does.
    uniqueIndex("kpi_score_current_idx").on(t.personId, t.month).where(sql`${t.supersededAt} IS NULL`),
    index("kpi_score_entity_month_idx").on(t.entityId, t.month),
  ],
).enableRLS();

// ── Review cycles (FR-PRF-03, 08 — Phase 8 week 1) ──────────────────────────────────────────
// A cycle is a form, a set of participants and a timeline. The form is **snapshotted onto the
// cycle** when it launches: editing the template afterwards must never change what somebody was
// asked, or what their answers were worth. Confidentiality (FR-PRF-08) is decided in
// `review-policy.ts`, never by a column.

export const reviewTemplate = pgTable("review_template", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  nameEn: text("name_en"),
  description: text("description"),
  sections: jsonb("sections").$type<ReviewSection[]>().notNull(),
  // Each point carries what it is worth in basis points: the mapping is configuration (SRS D13).
  ratingScale: jsonb("rating_scale").$type<RatingPoint[]>().notNull(),
  isActive: boolean("is_active").notNull().default(true),
  createdByPersonId: uuid("created_by_person_id").references(() => person.id),
  ...timestamps,
}).enableRLS();

export const reviewCycle = pgTable(
  "review_cycle",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // null = the whole group.
    entityId: uuid("entity_id").references(() => entity.id),
    name: text("name").notNull(),
    // probation | mid_year | annual
    kind: text("kind").notNull(),
    year: integer("year").notNull(),
    periodStart: date("period_start").notNull(),
    periodEnd: date("period_end").notNull(),
    templateId: uuid("template_id").references(() => reviewTemplate.id),
    // The template as it was at launch — the only thing the forms are read against afterwards.
    formSnapshot: jsonb("form_snapshot").$type<ReviewFormShape>(),
    selfDueOn: date("self_due_on"),
    managerDueOn: date("manager_due_on"),
    peerDueOn: date("peer_due_on"),
    calibrationOn: date("calibration_on"),
    releaseOn: date("release_on"),
    // draft | active | calibration | released | closed
    status: text("status").notNull().default("draft"),
    peersEnabled: boolean("peers_enabled").notNull().default(false),
    peerMin: integer("peer_min").notNull().default(0),
    peerMax: integer("peer_max").notNull().default(5),
    // Anonymous peer feedback is never shown to the subject with its author's name.
    peerAnonymous: boolean("peer_anonymous").notNull().default(true),
    launchedAt: timestamp("launched_at", { withTimezone: true }),
    launchedByPersonId: uuid("launched_by_person_id").references(() => person.id),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    createdByPersonId: uuid("created_by_person_id").references(() => person.id),
    ...timestamps,
  },
  (t) => [index("review_cycle_year_idx").on(t.year, t.status), index("review_cycle_entity_idx").on(t.entityId)],
).enableRLS();

// One person in one cycle. The manager is **snapshotted at launch**: a reorganisation halfway
// through a cycle must not hand somebody's half-written review to a new manager.
export const reviewParticipant = pgTable(
  "review_participant",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    cycleId: uuid("cycle_id")
      .notNull()
      .references(() => reviewCycle.id),
    personId: uuid("person_id")
      .notNull()
      .references(() => person.id),
    entityId: uuid("entity_id").references(() => entity.id),
    departmentId: uuid("department_id").references(() => orgUnit.id),
    managerPersonId: uuid("manager_person_id").references(() => person.id),
    // pending | self_done | manager_done | calibrated | released | acknowledged
    stage: text("stage").notNull().default("pending"),
    // The manager's overall figure, frozen when the review is released — what FR-PRF-09 reads.
    reviewScoreBp: integer("review_score_bp"),
    calibrationNote: text("calibration_note"),
    calibratedAt: timestamp("calibrated_at", { withTimezone: true }),
    calibratedByPersonId: uuid("calibrated_by_person_id").references(() => person.id),
    releasedAt: timestamp("released_at", { withTimezone: true }),
    releasedByPersonId: uuid("released_by_person_id").references(() => person.id),
    acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }),
    acknowledgementNote: text("acknowledgement_note"),
    ...timestamps,
  },
  (t) => [unique("review_participant_unique").on(t.cycleId, t.personId), index("review_participant_person_idx").on(t.personId), index("review_participant_manager_idx").on(t.managerPersonId)],
).enableRLS();

// One filled form. Self, manager and every peer each get their own row; a draft is private to its
// author until it is submitted.
export const reviewForm = pgTable(
  "review_form",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    cycleId: uuid("cycle_id")
      .notNull()
      .references(() => reviewCycle.id),
    participantId: uuid("participant_id")
      .notNull()
      .references(() => reviewParticipant.id),
    subjectPersonId: uuid("subject_person_id")
      .notNull()
      .references(() => person.id),
    authorPersonId: uuid("author_person_id")
      .notNull()
      .references(() => person.id),
    // self | manager | peer
    kind: text("kind").notNull(),
    // draft | submitted
    status: text("status").notNull().default("draft"),
    answers: jsonb("answers").$type<ReviewAnswers>().notNull().default({}),
    // What the pure engine makes of the answers, stored with the trace it came from.
    overallRatingBp: integer("overall_rating_bp"),
    scoreTrace: jsonb("score_trace").$type<ReviewScoreTrace>(),
    comment: text("comment"),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [unique("review_form_unique").on(t.participantId, t.kind, t.authorPersonId), index("review_form_author_idx").on(t.authorPersonId, t.status), index("review_form_participant_idx").on(t.participantId)],
).enableRLS();

// Who the person asked for 360 feedback, and what their manager said to it (week 2 drives it).
export const reviewPeerNomination = pgTable(
  "review_peer_nomination",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    cycleId: uuid("cycle_id")
      .notNull()
      .references(() => reviewCycle.id),
    participantId: uuid("participant_id")
      .notNull()
      .references(() => reviewParticipant.id),
    peerPersonId: uuid("peer_person_id")
      .notNull()
      .references(() => person.id),
    nominatedByPersonId: uuid("nominated_by_person_id")
      .notNull()
      .references(() => person.id),
    // pending | approved | declined
    status: text("status").notNull().default("pending"),
    decidedByPersonId: uuid("decided_by_person_id").references(() => person.id),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    note: text("note"),
    ...timestamps,
  },
  (t) => [unique("review_peer_nomination_unique").on(t.participantId, t.peerPersonId), index("review_peer_nomination_peer_idx").on(t.peerPersonId, t.status)],
).enableRLS();

// ── The final yearly result (FR-PRF-09 — Phase 8 week 2) ────────────────────────────────────
// How the review rating, the KPI score and OKR attainment are combined is **configuration the
// owner approves**, effective-dated exactly like a pay policy (FR-PLT-39): the year the bonus is
// computed for reads the version in force at its end, and that version never changes afterwards.

export const performanceWeighting = pgTable(
  "performance_weighting",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // null = the group's weighting; an entity's own version replaces it for that entity.
    entityId: uuid("entity_id").references(() => entity.id),
    value: jsonb("value").$type<PerformanceWeightingValue>().notNull(),
    validFrom: date("valid_from").notNull(),
    validTo: date("valid_to"),
    // proposed | approved | rejected
    status: text("status").notNull().default("proposed"),
    note: text("note"),
    proposedByPersonId: uuid("proposed_by_person_id").references(() => person.id),
    decidedByPersonId: uuid("decided_by_person_id").references(() => person.id),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [index("performance_weighting_entity_idx").on(t.entityId, t.status, t.validFrom)],
).enableRLS();

// One person's year. The computed figure and the owner's override sit side by side: an override
// never rewrites what the weighting worked out, it is recorded beside it with its reason.
// `trace` is the whole derivation; `kpi_score_ids` and `goal_ids` are its provenance, so the
// figures can still be pointed at months and goals long after the year has closed.
export const performanceResult = pgTable(
  "performance_result",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    personId: uuid("person_id")
      .notNull()
      .references(() => person.id),
    entityId: uuid("entity_id").references(() => entity.id),
    year: integer("year").notNull(),
    weightingVersionId: uuid("weighting_version_id").references(() => performanceWeighting.id),
    // Where the review figure came from, when there was one.
    participantId: uuid("participant_id").references(() => reviewParticipant.id),
    reviewScoreBp: integer("review_score_bp"),
    kpiScoreBp: integer("kpi_score_bp"),
    okrScoreBp: integer("okr_score_bp"),
    computedScoreBp: integer("computed_score_bp"),
    computedBand: text("computed_band"),
    overrideScoreBp: integer("override_score_bp"),
    overrideReason: text("override_reason"),
    overrideByPersonId: uuid("override_by_person_id").references(() => person.id),
    overrideAt: timestamp("override_at", { withTimezone: true }),
    finalScoreBp: integer("final_score_bp"),
    finalBand: text("final_band"),
    // What the band is worth to the year-end bonus. A number, not money: the amount is payroll's.
    multiplierBp: integer("multiplier_bp"),
    trace: jsonb("trace").$type<ResultTrace>().notNull(),
    kpiScoreIds: jsonb("kpi_score_ids").$type<string[]>().notNull().default([]),
    goalIds: jsonb("goal_ids").$type<string[]>().notNull().default([]),
    // draft | locked | published
    status: text("status").notNull().default("draft"),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    lockedByPersonId: uuid("locked_by_person_id").references(() => person.id),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    publishedByPersonId: uuid("published_by_person_id").references(() => person.id),
    ...timestamps,
  },
  (t) => [unique("performance_result_unique").on(t.personId, t.year), index("performance_result_year_idx").on(t.year, t.entityId, t.status)],
).enableRLS();

// What a stored KPI score has already been used for. Phase 3.5 stores scores immutably and lets
// group HR reopen a month, which supersedes them and writes a new revision — but **a month a
// bonus run has already paid from must not move**: the money is out, and the figure behind it is
// evidence. Payroll writes these rows when a bonus run is approved (`markScoresConsumed`), and
// `reopenMonth` refuses any month that appears here.
export const kpiScoreUse = pgTable(
  "kpi_score_use",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // What consumed it, e.g. "bonus_run". Kept as text: the consumer lives in another module.
    consumerType: text("consumer_type").notNull(),
    consumerId: uuid("consumer_id").notNull(),
    scoreId: uuid("score_id")
      .notNull()
      .references(() => kpiScore.id),
    personId: uuid("person_id")
      .notNull()
      .references(() => person.id),
    entityId: uuid("entity_id")
      .notNull()
      .references(() => entity.id),
    month: text("month").notNull(),
    year: integer("year").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("kpi_score_use_unique").on(t.consumerId, t.scoreId), index("kpi_score_use_month_idx").on(t.entityId, t.month), index("kpi_score_use_year_idx").on(t.entityId, t.year)],
).enableRLS();

// ── 1:1 meeting notes (FR-PRF-04, S — Phase 8 week 3) ───────────────────────────────────────
// A shared agenda and shared notes both sides read, and a private column only the manager sees:
// the policy refuses the subject that field, and a test proves it. Action items become real tasks
// in the task engine (ADR-10) rather than a second to-do list nobody looks at.

export const oneOnOne = pgTable(
  "one_on_one",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    managerPersonId: uuid("manager_person_id")
      .notNull()
      .references(() => person.id),
    personId: uuid("person_id")
      .notNull()
      .references(() => person.id),
    meetingOn: date("meeting_on").notNull(),
    agenda: text("agenda"),
    sharedNotes: text("shared_notes"),
    /** The manager's own notes. Never read by the subject, whatever else they may hold. */
    privateNotes: text("private_notes"),
    // draft | shared
    status: text("status").notNull().default("draft"),
    sharedAt: timestamp("shared_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [index("one_on_one_pair_idx").on(t.personId, t.meetingOn), index("one_on_one_manager_idx").on(t.managerPersonId, t.meetingOn)],
).enableRLS();

export const oneOnOneAction = pgTable(
  "one_on_one_action",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    meetingId: uuid("meeting_id")
      .notNull()
      .references(() => oneOnOne.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    assigneePersonId: uuid("assignee_person_id").references(() => person.id),
    dueOn: date("due_on"),
    /** The task the engine made of it — the action item and the task are one thing, not two. */
    taskId: uuid("task_id"),
    ...timestamps,
  },
  (t) => [index("one_on_one_action_meeting_idx").on(t.meetingId)],
).enableRLS();

// ── Review outcomes (FR-PRF-06, S — Phase 8 week 3) ─────────────────────────────────────────
// What a published result leads to. A salary adjustment is **proposed through payroll's own
// use-case** (SRS D17): performance never becomes a second way to set a salary, so this row keeps
// the request's id and nothing else about money. The others raise a task for HR.

export const reviewOutcome = pgTable(
  "review_outcome",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    personId: uuid("person_id")
      .notNull()
      .references(() => person.id),
    entityId: uuid("entity_id").references(() => entity.id),
    year: integer("year").notNull(),
    resultId: uuid("result_id").references(() => performanceResult.id),
    participantId: uuid("participant_id").references(() => reviewParticipant.id),
    // promotion | salary_adjustment | development_plan | pip
    type: text("type").notNull(),
    note: text("note"),
    // proposed | accepted | rejected
    status: text("status").notNull().default("proposed"),
    /** Payroll's `salary_change` approval request, when the outcome is a salary adjustment. */
    salaryRequestId: uuid("salary_request_id"),
    /** The HR task the outcome raised, for the others. */
    taskId: uuid("task_id"),
    raisedByPersonId: uuid("raised_by_person_id").references(() => person.id),
    decidedByPersonId: uuid("decided_by_person_id").references(() => person.id),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [index("review_outcome_person_idx").on(t.personId, t.year), index("review_outcome_status_idx").on(t.status, t.year)],
).enableRLS();
