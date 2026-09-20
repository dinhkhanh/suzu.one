// Review cycles (FR-PRF-03): the form templates, the cycle and its timeline, the participants,
// and the self and manager reviews. Reads for the screens and the use-cases behind the actions.
//
// Two things hold the record together:
//   1. **The form is snapshotted at launch.** `review_cycle.form_snapshot` is what everybody is
//      asked and what their answers are worth; editing the template afterwards changes nothing
//      that has already been asked (SRS D13 — the bonus is computed from these figures).
//   2. **The manager is snapshotted at launch.** A reorganisation mid-cycle does not hand a
//      half-written review to somebody new.
//
// No authorization inside: `review-actions.ts` checks `review-policy.ts` first, exactly as the
// goal and KPI use-cases do.
import "server-only";
import { and, asc, desc, eq, inArray, isNotNull, ne } from "drizzle-orm";
import { ActionError } from "@/lib/action";
import { type IsoDate, todayInVietnam } from "@/lib/dates";
import { db, schema, type Tx } from "@/lib/db";
import { missingRequired, type ReviewScoreTrace, scoreReviewForm } from "./engine/review-score";
import { laterStage, type RatingPoint, type ReviewAnswers, type ReviewCycleKind, type ReviewCycleStatus, type ReviewFormKind, type ReviewFormShape, type ReviewFormStatus, type ReviewSection, type ReviewStage } from "./enums";
import { type Directory, loadDirectory } from "./people";
import type { PersonContext } from "./policy";
import type { ReviewParties } from "./review-policy";

type Executor = Tx | ReturnType<typeof db>;
export type ReviewTemplateRow = typeof schema.reviewTemplate.$inferSelect;
export type ReviewCycleRow = typeof schema.reviewCycle.$inferSelect;
export type ReviewParticipantRow = typeof schema.reviewParticipant.$inferSelect;
export type ReviewFormRow = typeof schema.reviewForm.$inferSelect;
export type ReviewPeerNominationRow = typeof schema.reviewPeerNomination.$inferSelect;

// ── Templates ───────────────────────────────────────────────────────────────────────────────

export async function listReviewTemplates(executor: Executor = db()): Promise<ReviewTemplateRow[]> {
  return executor.select().from(schema.reviewTemplate).orderBy(desc(schema.reviewTemplate.isActive), asc(schema.reviewTemplate.name));
}

export async function findReviewTemplate(templateId: string, executor: Executor = db()): Promise<ReviewTemplateRow | null> {
  const [row] = await executor.select().from(schema.reviewTemplate).where(eq(schema.reviewTemplate.id, templateId)).limit(1);
  return row ?? null;
}

export type TemplateInput = { name: string; nameEn: string | null; description: string | null; sections: ReviewSection[]; ratingScale: RatingPoint[]; isActive: boolean };

/** A template with no rating section scores nothing, and a scale with one point cannot rank anybody. */
export function checkTemplate(input: TemplateInput): TemplateInput {
  if (input.sections.length === 0) throw new ActionError("review_template_empty");
  if (new Set(input.sections.map((section) => section.key)).size !== input.sections.length) throw new ActionError("review_template_duplicate_key");
  if (input.sections.some((section) => section.askedOf.length === 0)) throw new ActionError("review_template_unasked_section");
  if (input.ratingScale.length < 2) throw new ActionError("review_template_scale_short");
  if (new Set(input.ratingScale.map((point) => point.value)).size !== input.ratingScale.length) throw new ActionError("review_template_duplicate_point");
  if (!input.sections.some((section) => section.kind === "rating" && section.weight > 0)) throw new ActionError("review_template_unscored");
  return input;
}

export async function saveReviewTemplate(templateId: string | null, input: TemplateInput, actorPersonId: string): Promise<{ before: ReviewTemplateRow | null; after: ReviewTemplateRow }> {
  checkTemplate(input);
  const values = { name: input.name, nameEn: input.nameEn, description: input.description, sections: input.sections, ratingScale: input.ratingScale, isActive: input.isActive, updatedAt: new Date() };
  if (!templateId) {
    const [after] = await db().insert(schema.reviewTemplate).values({ ...values, createdByPersonId: actorPersonId }).returning();
    return { before: null, after };
  }
  const before = await findReviewTemplate(templateId);
  if (!before) throw new ActionError("review_template_not_found");
  const [after] = await db().update(schema.reviewTemplate).set(values).where(eq(schema.reviewTemplate.id, templateId)).returning();
  return { before, after };
}

// ── Cycles ──────────────────────────────────────────────────────────────────────────────────

export async function listReviewCycles(filter: { year?: number; entityIds?: readonly string[] } = {}, executor: Executor = db()): Promise<ReviewCycleRow[]> {
  return executor
    .select()
    .from(schema.reviewCycle)
    .where(and(filter.year === undefined ? undefined : eq(schema.reviewCycle.year, filter.year), filter.entityIds ? inArray(schema.reviewCycle.entityId, [...filter.entityIds]) : undefined))
    .orderBy(desc(schema.reviewCycle.year), asc(schema.reviewCycle.name));
}

export async function findReviewCycle(cycleId: string, executor: Executor = db()): Promise<ReviewCycleRow | null> {
  const [row] = await executor.select().from(schema.reviewCycle).where(eq(schema.reviewCycle.id, cycleId)).limit(1);
  return row ?? null;
}

export type CycleInput = {
  entityId: string | null;
  name: string;
  kind: ReviewCycleKind;
  year: number;
  periodStart: IsoDate;
  periodEnd: IsoDate;
  templateId: string;
  selfDueOn: IsoDate | null;
  managerDueOn: IsoDate | null;
  peerDueOn: IsoDate | null;
  calibrationOn: IsoDate | null;
  releaseOn: IsoDate | null;
  peersEnabled: boolean;
  peerMin: number;
  peerMax: number;
  peerAnonymous: boolean;
};

function checkCycle(input: CycleInput): void {
  if (input.periodEnd < input.periodStart) throw new ActionError("review_period_backwards");
  const timeline = [input.selfDueOn, input.managerDueOn, input.peerDueOn, input.calibrationOn, input.releaseOn].filter((date): date is IsoDate => date !== null);
  // The dates the cycle does set must run forwards; any of them may be left out.
  const ordered = [input.selfDueOn, input.managerDueOn, input.calibrationOn, input.releaseOn].filter((date): date is IsoDate => date !== null);
  if (ordered.some((date, index) => index > 0 && date < ordered[index - 1])) throw new ActionError("review_timeline_backwards");
  if (timeline.some((date) => date < input.periodStart)) throw new ActionError("review_timeline_before_period");
  if (input.peersEnabled && input.peerMax < input.peerMin) throw new ActionError("review_peer_range");
}

/** Only a draft cycle can be changed: once it is launched people are answering the questions. */
export async function saveReviewCycle(cycleId: string | null, input: CycleInput, actorPersonId: string): Promise<{ before: ReviewCycleRow | null; after: ReviewCycleRow }> {
  checkCycle(input);
  const template = await findReviewTemplate(input.templateId);
  if (!template || !template.isActive) throw new ActionError("review_template_not_found");
  const values = { ...input, updatedAt: new Date() };
  if (!cycleId) {
    const [after] = await db().insert(schema.reviewCycle).values({ ...values, createdByPersonId: actorPersonId }).returning();
    return { before: null, after };
  }
  const before = await findReviewCycle(cycleId);
  if (!before) throw new ActionError("review_cycle_not_found");
  if (before.status !== "draft") throw new ActionError("review_cycle_launched");
  const [after] = await db().update(schema.reviewCycle).set(values).where(eq(schema.reviewCycle.id, cycleId)).returning();
  return { before, after };
}

/** Who a cycle covers: active staff of its entity (or the whole group), collaborators excepted. */
export async function eligibleParticipants(cycle: Pick<ReviewCycleRow, "entityId">, directory: Directory): Promise<PersonContext[]> {
  return [...directory.values()].filter((row) => row.status === "active" && row.workforceType !== "collaborator" && (cycle.entityId === null || row.entityId === cycle.entityId));
}

export type LaunchResult = { cycle: ReviewCycleRow; participants: number };

/**
 * Launch: freeze the form, work out who is in, snapshot each one's manager, and open the cycle for
 * writing. Idempotent in the sense that relaunching is refused — a cycle is launched once.
 */
export async function launchReviewCycle(cycleId: string, actorPersonId: string, executor: ReturnType<typeof db> = db()): Promise<LaunchResult> {
  return executor.transaction(async (tx) => {
    const [cycle] = await tx.select().from(schema.reviewCycle).where(eq(schema.reviewCycle.id, cycleId)).limit(1).for("update");
    if (!cycle) throw new ActionError("review_cycle_not_found");
    if (cycle.status !== "draft") throw new ActionError("review_cycle_launched");
    if (!cycle.templateId) throw new ActionError("review_template_not_found");
    const template = await findReviewTemplate(cycle.templateId, tx);
    if (!template) throw new ActionError("review_template_not_found");
    const shape: ReviewFormShape = { sections: template.sections, ratingScale: template.ratingScale };
    checkTemplate({ name: template.name, nameEn: template.nameEn, description: template.description, sections: template.sections, ratingScale: template.ratingScale, isActive: template.isActive });

    const directory = await loadDirectory(tx);
    const people = await eligibleParticipants(cycle, directory);
    if (people.length === 0) throw new ActionError("review_cycle_no_participants");
    await tx.insert(schema.reviewParticipant).values(people.map((row) => ({ cycleId, personId: row.personId, entityId: row.entityId ?? null, departmentId: row.departmentId ?? null, managerPersonId: row.managerId ?? null }))).onConflictDoNothing();
    const [after] = await tx
      .update(schema.reviewCycle)
      .set({ status: "active", formSnapshot: shape, launchedAt: new Date(), launchedByPersonId: actorPersonId, updatedAt: new Date() })
      .where(eq(schema.reviewCycle.id, cycleId))
      .returning();
    return { cycle: after, participants: people.length };
  });
}

/** draft → active → calibration → released → closed, one step at a time and never backwards. */
const CYCLE_NEXT: Partial<Record<ReviewCycleStatus, ReviewCycleStatus>> = { active: "calibration", calibration: "released", released: "closed" };

export async function advanceReviewCycle(cycleId: string, to: ReviewCycleStatus, executor: ReturnType<typeof db> = db()): Promise<{ before: ReviewCycleRow; after: ReviewCycleRow }> {
  return executor.transaction(async (tx) => {
    const [before] = await tx.select().from(schema.reviewCycle).where(eq(schema.reviewCycle.id, cycleId)).limit(1).for("update");
    if (!before) throw new ActionError("review_cycle_not_found");
    if (CYCLE_NEXT[before.status as ReviewCycleStatus] !== to) throw new ActionError("review_cycle_bad_step");
    const [after] = await tx
      .update(schema.reviewCycle)
      .set({ status: to, closedAt: to === "closed" ? new Date() : before.closedAt, updatedAt: new Date() })
      .where(eq(schema.reviewCycle.id, cycleId))
      .returning();
    return { before, after };
  });
}

export const nextCycleStatus = (status: ReviewCycleStatus): ReviewCycleStatus | null => CYCLE_NEXT[status] ?? null;

// ── Participants ────────────────────────────────────────────────────────────────────────────

export async function findParticipant(participantId: string, executor: Executor = db()): Promise<{ participant: ReviewParticipantRow; cycle: ReviewCycleRow } | null> {
  const [row] = await executor
    .select({ participant: schema.reviewParticipant, cycle: schema.reviewCycle })
    .from(schema.reviewParticipant)
    .innerJoin(schema.reviewCycle, eq(schema.reviewCycle.id, schema.reviewParticipant.cycleId))
    .where(eq(schema.reviewParticipant.id, participantId))
    .limit(1);
  return row ?? null;
}

/** The parties the confidentiality rules are decided against. */
export const partiesOfParticipant = (participant: ReviewParticipantRow, cycle: ReviewCycleRow, directory: Directory): ReviewParties | null => {
  const subject = directory.get(participant.personId);
  return subject ? { subject, managerPersonId: participant.managerPersonId, stage: participant.stage as ReviewStage, released: participant.releasedAt !== null, cycleStatus: cycle.status as ReviewCycleStatus, peerAnonymous: cycle.peerAnonymous } : null;
};

export async function addParticipant(cycleId: string, personId: string, directory: Directory, executor: Executor = db()): Promise<ReviewParticipantRow> {
  const row = directory.get(personId);
  if (!row) throw new ActionError("review_person_not_found");
  const [created] = await executor
    .insert(schema.reviewParticipant)
    .values({ cycleId, personId, entityId: row.entityId ?? null, departmentId: row.departmentId ?? null, managerPersonId: row.managerId ?? null })
    .onConflictDoNothing()
    .returning();
  if (!created) throw new ActionError("review_participant_exists");
  return created;
}

/** Taking somebody out of a cycle: only while nothing has been written about them. */
export async function removeParticipant(participantId: string, executor: ReturnType<typeof db> = db()): Promise<ReviewParticipantRow> {
  return executor.transaction(async (tx) => {
    const [row] = await tx.select().from(schema.reviewParticipant).where(eq(schema.reviewParticipant.id, participantId)).limit(1).for("update");
    if (!row) throw new ActionError("review_participant_not_found");
    const [form] = await tx.select({ id: schema.reviewForm.id }).from(schema.reviewForm).where(eq(schema.reviewForm.participantId, participantId)).limit(1);
    if (form) throw new ActionError("review_participant_has_forms");
    await tx.delete(schema.reviewPeerNomination).where(eq(schema.reviewPeerNomination.participantId, participantId));
    await tx.delete(schema.reviewParticipant).where(eq(schema.reviewParticipant.id, participantId));
    return row;
  });
}

// ── Forms ───────────────────────────────────────────────────────────────────────────────────

export async function listFormsOf(participantId: string, executor: Executor = db()): Promise<ReviewFormRow[]> {
  return executor.select().from(schema.reviewForm).where(eq(schema.reviewForm.participantId, participantId)).orderBy(asc(schema.reviewForm.kind), asc(schema.reviewForm.createdAt));
}

export async function findForm(formId: string, executor: Executor = db()): Promise<{ form: ReviewFormRow; participant: ReviewParticipantRow; cycle: ReviewCycleRow } | null> {
  const [row] = await executor
    .select({ form: schema.reviewForm, participant: schema.reviewParticipant, cycle: schema.reviewCycle })
    .from(schema.reviewForm)
    .innerJoin(schema.reviewParticipant, eq(schema.reviewParticipant.id, schema.reviewForm.participantId))
    .innerJoin(schema.reviewCycle, eq(schema.reviewCycle.id, schema.reviewForm.cycleId))
    .where(eq(schema.reviewForm.id, formId))
    .limit(1);
  return row ?? null;
}

const formOf = async (participantId: string, kind: ReviewFormKind, authorPersonId: string, executor: Executor): Promise<ReviewFormRow | null> => {
  const [row] = await executor
    .select()
    .from(schema.reviewForm)
    .where(and(eq(schema.reviewForm.participantId, participantId), eq(schema.reviewForm.kind, kind), eq(schema.reviewForm.authorPersonId, authorPersonId)))
    .limit(1);
  return row ?? null;
};

export type SaveFormInput = { participantId: string; kind: ReviewFormKind; answers: ReviewAnswers; comment: string | null; submit: boolean };

/**
 * Save a draft, or submit. Submitting scores the answers through the pure engine and stores the
 * trace; a required section left blank refuses the submission with its key.
 *
 * The one ordering rule of FR-PRF-03: **a manager review cannot be submitted before the person
 * has had their say** — either the self review is in, or its due date has passed. Nobody's
 * assessment is written over the top of a self review they were never given time to write.
 */
export async function saveReviewForm(input: SaveFormInput, authorPersonId: string, today: IsoDate = todayInVietnam(), executor: ReturnType<typeof db> = db()): Promise<{ before: ReviewFormRow | null; after: ReviewFormRow; participant: ReviewParticipantRow }> {
  return executor.transaction(async (tx) => {
    const found = await findParticipant(input.participantId, tx);
    if (!found) throw new ActionError("review_participant_not_found");
    const { cycle } = found;
    const [participant] = await tx.select().from(schema.reviewParticipant).where(eq(schema.reviewParticipant.id, input.participantId)).limit(1).for("update");
    if (cycle.status !== "active") throw new ActionError("review_cycle_not_collecting");
    const shape = cycle.formSnapshot;
    if (!shape) throw new ActionError("review_cycle_not_launched");

    const before = await formOf(input.participantId, input.kind, authorPersonId, tx);
    if (before?.status === "submitted") throw new ActionError("review_form_submitted");

    let trace: ReviewScoreTrace | null = null;
    if (input.submit) {
      const missing = missingRequired(shape, input.kind, input.answers);
      if (missing.length > 0) throw new ActionError("review_form_incomplete", { missing });
      if (input.kind === "manager") {
        const self = await formOf(input.participantId, "self", participant.personId, tx);
        const selfIn = self?.status === "submitted";
        const selfOverdue = cycle.selfDueOn !== null && cycle.selfDueOn < today;
        if (!selfIn && !selfOverdue) throw new ActionError("review_self_not_submitted");
      }
      trace = scoreReviewForm(shape, input.kind, input.answers);
    }

    const values = {
      answers: input.answers,
      comment: input.comment,
      status: (input.submit ? "submitted" : "draft") satisfies ReviewFormStatus,
      overallRatingBp: trace?.scoreBp ?? null,
      scoreTrace: trace,
      submittedAt: input.submit ? new Date() : null,
      updatedAt: new Date(),
    };
    const after = before
      ? (await tx.update(schema.reviewForm).set(values).where(eq(schema.reviewForm.id, before.id)).returning())[0]
      : (await tx.insert(schema.reviewForm).values({ ...values, cycleId: cycle.id, participantId: input.participantId, subjectPersonId: participant.personId, authorPersonId, kind: input.kind }).returning())[0];

    // The stage follows what has actually been submitted; it never goes backwards.
    let stage = participant.stage as ReviewStage;
    if (input.submit && input.kind === "self") stage = laterStage(stage, "self_done");
    if (input.submit && input.kind === "manager") stage = laterStage(stage, "manager_done");
    const updated =
      stage === participant.stage
        ? participant
        : (await tx.update(schema.reviewParticipant).set({ stage, updatedAt: new Date() }).where(eq(schema.reviewParticipant.id, participant.id)).returning())[0];
    return { before, after, participant: updated };
  });
}

/**
 * Calibration: HR or the reviewing manager may level a rating before release, with a note saying
 * why. The manager's own form is left exactly as written — what moves is the figure the final
 * yearly result reads (FR-PRF-09), and the note is the record of the difference.
 */
export async function calibrateParticipant(participantId: string, input: { reviewScoreBp: number | null; note: string }, actorPersonId: string, executor: ReturnType<typeof db> = db()): Promise<{ before: ReviewParticipantRow; after: ReviewParticipantRow }> {
  return executor.transaction(async (tx) => {
    const [before] = await tx.select().from(schema.reviewParticipant).where(eq(schema.reviewParticipant.id, participantId)).limit(1).for("update");
    if (!before) throw new ActionError("review_participant_not_found");
    if (before.releasedAt) throw new ActionError("review_already_released");
    const [after] = await tx
      .update(schema.reviewParticipant)
      .set({ reviewScoreBp: input.reviewScoreBp, calibrationNote: input.note, calibratedAt: new Date(), calibratedByPersonId: actorPersonId, stage: laterStage(before.stage as ReviewStage, "calibrated"), updatedAt: new Date() })
      .where(eq(schema.reviewParticipant.id, participantId))
      .returning();
    return { before, after };
  });
}

/**
 * Release: the review becomes the person's to read, and the figure FR-PRF-09 reads is frozen —
 * the calibrated one if there is one, else the manager's. Refused before the manager has written.
 */
export async function releaseParticipant(participantId: string, actorPersonId: string, executor: ReturnType<typeof db> = db()): Promise<{ before: ReviewParticipantRow; after: ReviewParticipantRow }> {
  return executor.transaction(async (tx) => {
    const [before] = await tx.select().from(schema.reviewParticipant).where(eq(schema.reviewParticipant.id, participantId)).limit(1).for("update");
    if (!before) throw new ActionError("review_participant_not_found");
    if (before.releasedAt) throw new ActionError("review_already_released");
    const [manager] = await tx
      .select()
      .from(schema.reviewForm)
      .where(and(eq(schema.reviewForm.participantId, participantId), eq(schema.reviewForm.kind, "manager"), eq(schema.reviewForm.status, "submitted")))
      .limit(1);
    if (!manager) throw new ActionError("review_manager_not_submitted");
    const [after] = await tx
      .update(schema.reviewParticipant)
      .set({ reviewScoreBp: before.reviewScoreBp ?? manager.overallRatingBp, releasedAt: new Date(), releasedByPersonId: actorPersonId, stage: laterStage(before.stage as ReviewStage, "released"), updatedAt: new Date() })
      .where(eq(schema.reviewParticipant.id, participantId))
      .returning();
    return { before, after };
  });
}

/** The person signs that they have seen it (FR-PRF-03's last step). */
export async function acknowledgeParticipant(participantId: string, note: string | null, executor: ReturnType<typeof db> = db()): Promise<{ before: ReviewParticipantRow; after: ReviewParticipantRow }> {
  return executor.transaction(async (tx) => {
    const [before] = await tx.select().from(schema.reviewParticipant).where(eq(schema.reviewParticipant.id, participantId)).limit(1).for("update");
    if (!before) throw new ActionError("review_participant_not_found");
    if (!before.releasedAt) throw new ActionError("review_not_released");
    if (before.acknowledgedAt) throw new ActionError("review_already_acknowledged");
    const [after] = await tx
      .update(schema.reviewParticipant)
      .set({ acknowledgedAt: new Date(), acknowledgementNote: note, stage: laterStage(before.stage as ReviewStage, "acknowledged"), updatedAt: new Date() })
      .where(eq(schema.reviewParticipant.id, participantId))
      .returning();
    return { before, after };
  });
}

// ── Reads for the screens ───────────────────────────────────────────────────────────────────

export type ParticipantLine = {
  participantId: string;
  cycleId: string;
  cycleName: string;
  cycleStatus: ReviewCycleStatus;
  year: number;
  personId: string;
  personName: string;
  managerPersonId: string | null;
  managerName: string | null;
  stage: ReviewStage;
  released: boolean;
  acknowledged: boolean;
  selfStatus: ReviewFormStatus | null;
  managerStatus: ReviewFormStatus | null;
  peersSubmitted: number;
  reviewScoreBp: number | null;
  selfDueOn: IsoDate | null;
  managerDueOn: IsoDate | null;
};

async function toLines(rows: { participant: ReviewParticipantRow; cycle: ReviewCycleRow }[], directory: Directory, executor: Executor): Promise<ParticipantLine[]> {
  if (rows.length === 0) return [];
  const forms = await executor
    .select({ participantId: schema.reviewForm.participantId, kind: schema.reviewForm.kind, status: schema.reviewForm.status, authorPersonId: schema.reviewForm.authorPersonId })
    .from(schema.reviewForm)
    .where(inArray(schema.reviewForm.participantId, rows.map((row) => row.participant.id)));
  return rows.map(({ participant, cycle }) => {
    const mine = forms.filter((form) => form.participantId === participant.id);
    return {
      participantId: participant.id,
      cycleId: cycle.id,
      cycleName: cycle.name,
      cycleStatus: cycle.status as ReviewCycleStatus,
      year: cycle.year,
      personId: participant.personId,
      personName: directory.get(participant.personId)?.fullName ?? "—",
      managerPersonId: participant.managerPersonId,
      managerName: participant.managerPersonId ? (directory.get(participant.managerPersonId)?.fullName ?? null) : null,
      stage: participant.stage as ReviewStage,
      released: participant.releasedAt !== null,
      acknowledged: participant.acknowledgedAt !== null,
      selfStatus: (mine.find((form) => form.kind === "self")?.status as ReviewFormStatus) ?? null,
      managerStatus: (mine.find((form) => form.kind === "manager")?.status as ReviewFormStatus) ?? null,
      peersSubmitted: mine.filter((form) => form.kind === "peer" && form.status === "submitted").length,
      reviewScoreBp: participant.reviewScoreBp,
      selfDueOn: cycle.selfDueOn,
      managerDueOn: cycle.managerDueOn,
    };
  });
}

const joined = (executor: Executor) => executor.select({ participant: schema.reviewParticipant, cycle: schema.reviewCycle }).from(schema.reviewParticipant).innerJoin(schema.reviewCycle, eq(schema.reviewCycle.id, schema.reviewParticipant.cycleId));

/** My own reviews, newest cycle first. */
export async function listMyParticipations(personId: string, executor: Executor = db()): Promise<ParticipantLine[]> {
  const rows = await joined(executor).where(and(eq(schema.reviewParticipant.personId, personId), ne(schema.reviewCycle.status, "draft"))).orderBy(desc(schema.reviewCycle.year));
  return toLines(rows, await loadDirectory(executor), executor);
}

/** The reviews I owe as somebody's manager: the people snapshotted to me in a live cycle. */
export async function listReviewsIOwe(personId: string, executor: Executor = db()): Promise<ParticipantLine[]> {
  const rows = await joined(executor)
    .where(and(eq(schema.reviewParticipant.managerPersonId, personId), inArray(schema.reviewCycle.status, ["active", "calibration"])))
    .orderBy(desc(schema.reviewCycle.year));
  return toLines(rows, await loadDirectory(executor), executor);
}

/** Every participant of one cycle — HR's and a manager's view; the caller filters by policy. */
export async function listCycleParticipants(cycleId: string, executor: Executor = db()): Promise<ParticipantLine[]> {
  const rows = await joined(executor).where(eq(schema.reviewParticipant.cycleId, cycleId)).orderBy(asc(schema.reviewParticipant.createdAt));
  const directory = await loadDirectory(executor);
  const lines = await toLines(rows, directory, executor);
  return lines.sort((a, b) => a.personName.localeCompare(b.personName));
}

export type LoadedParticipant = {
  participant: ReviewParticipantRow;
  cycle: ReviewCycleRow;
  parties: ReviewParties;
  shape: ReviewFormShape | null;
  forms: ReviewFormRow[];
  nominations: ReviewPeerNominationRow[];
  directory: Directory;
};

/** Everything one review screen needs, unfiltered: the page drops what the viewer may not read. */
export async function loadParticipant(participantId: string, executor: Executor = db()): Promise<LoadedParticipant | null> {
  const found = await findParticipant(participantId, executor);
  if (!found) return null;
  const [directory, forms, nominations] = await Promise.all([
    loadDirectory(executor),
    listFormsOf(participantId, executor),
    executor.select().from(schema.reviewPeerNomination).where(eq(schema.reviewPeerNomination.participantId, participantId)).orderBy(asc(schema.reviewPeerNomination.createdAt)),
  ]);
  const parties = partiesOfParticipant(found.participant, found.cycle, directory);
  if (!parties) return null;
  return { ...found, parties, shape: found.cycle.formSnapshot, forms, nominations, directory };
}

/** How far a cycle has got, for HR's list. */
export async function cycleProgress(cycleIds: readonly string[], executor: Executor = db()): Promise<Map<string, { participants: number; selfDone: number; managerDone: number; released: number }>> {
  const result = new Map<string, { participants: number; selfDone: number; managerDone: number; released: number }>();
  if (cycleIds.length === 0) return result;
  const rows = await executor.select().from(schema.reviewParticipant).where(inArray(schema.reviewParticipant.cycleId, [...cycleIds]));
  const submitted = await executor
    .select({ cycleId: schema.reviewForm.cycleId, participantId: schema.reviewForm.participantId, kind: schema.reviewForm.kind })
    .from(schema.reviewForm)
    .where(and(inArray(schema.reviewForm.cycleId, [...cycleIds]), eq(schema.reviewForm.status, "submitted")));
  for (const cycleId of cycleIds) {
    const mine = rows.filter((row) => row.cycleId === cycleId);
    const theirs = submitted.filter((row) => row.cycleId === cycleId);
    result.set(cycleId, {
      participants: mine.length,
      selfDone: new Set(theirs.filter((row) => row.kind === "self").map((row) => row.participantId)).size,
      managerDone: new Set(theirs.filter((row) => row.kind === "manager").map((row) => row.participantId)).size,
      released: mine.filter((row) => row.releasedAt !== null).length,
    });
  }
  return result;
}

/** For week 2's final yearly result: the released review figure per person for a year. */
export async function listReleasedReviewScores(year: number, executor: Executor = db()): Promise<Map<string, { participantId: string; cycleId: string; reviewScoreBp: number | null; releasedAt: Date }>> {
  const rows = await executor
    .select({ participant: schema.reviewParticipant, cycle: schema.reviewCycle })
    .from(schema.reviewParticipant)
    .innerJoin(schema.reviewCycle, eq(schema.reviewCycle.id, schema.reviewParticipant.cycleId))
    .where(and(eq(schema.reviewCycle.year, year), eq(schema.reviewCycle.kind, "annual"), isNotNull(schema.reviewParticipant.releasedAt)))
    .orderBy(desc(schema.reviewParticipant.releasedAt));
  const result = new Map<string, { participantId: string; cycleId: string; reviewScoreBp: number | null; releasedAt: Date }>();
  for (const { participant } of rows) {
    if (result.has(participant.personId)) continue;
    result.set(participant.personId, { participantId: participant.id, cycleId: participant.cycleId, reviewScoreBp: participant.reviewScoreBp, releasedAt: participant.releasedAt! });
  }
  return result;
}
