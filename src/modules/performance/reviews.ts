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
import { and, asc, desc, eq, inArray, isNotNull, isNull, ne, sql } from "drizzle-orm";
import { ActionError } from "@/lib/action";
import { cached, invalidate } from "@/lib/cache";
import { type IsoDate, todayInVietnam } from "@/lib/dates";
import { db, schema, type Tx } from "@/lib/db";
import { missingRequired, type ReviewScoreTrace, scoreReviewForm } from "./engine/review-score";
import { templateProblems } from "./engine/review-template";
import { laterStage, releasable, type RatingPoint, type ReviewAnswers, type ReviewCycleKind, type ReviewCycleStatus, type ReviewFormKind, type ReviewFormShape, type ReviewFormStatus, type ReviewSection, type ReviewStage, templateSuits } from "./enums";
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

// Templates are configuration, a few rows: cached whole, cleared by `saveReviewTemplate` (and by
// `pnpm cache:flush` after the seed writes the starter forms). The key names the row's shape: an
// entry cached before templates had `kinds` is never read as one that has them.
const TEMPLATES_CACHE = "performance:review-templates:v2";
const TEMPLATES_TTL = 60 * 60;

/** Every template. Inside a transaction pass it, and the rows come from that transaction, not the cache. */
export async function listReviewTemplates(executor?: Executor): Promise<ReviewTemplateRow[]> {
  const load = (from: Executor) => from.select().from(schema.reviewTemplate).orderBy(desc(schema.reviewTemplate.isActive), asc(schema.reviewTemplate.name));
  return executor ? load(executor) : cached(TEMPLATES_CACHE, TEMPLATES_TTL, () => load(db()));
}

export async function findReviewTemplate(templateId: string, executor?: Executor): Promise<ReviewTemplateRow | null> {
  return (await listReviewTemplates(executor)).find((row) => row.id === templateId) ?? null;
}

export type TemplateInput = { name: string; nameEn: string | null; description: string | null; kinds: ReviewCycleKind[]; sections: ReviewSection[]; ratingScale: RatingPoint[]; isActive: boolean };

/**
 * A usable template, or the first thing wrong with it — every problem rides along in the details,
 * so the editor can show them all. The rules are the pure engine's, which the editor also runs as
 * HR types and the seed runs on the starter forms.
 */
export function checkTemplate(input: TemplateInput): TemplateInput {
  const problems = templateProblems(input);
  if (problems.length > 0) throw new ActionError(problems[0], { problems });
  return input;
}

export async function saveReviewTemplate(templateId: string | null, input: TemplateInput, actorPersonId: string): Promise<{ before: ReviewTemplateRow | null; after: ReviewTemplateRow }> {
  checkTemplate(input);
  const values = { name: input.name, nameEn: input.nameEn, description: input.description, kinds: input.kinds, sections: input.sections, ratingScale: input.ratingScale, isActive: input.isActive, updatedAt: new Date() };
  if (!templateId) {
    const [after] = await db().insert(schema.reviewTemplate).values({ ...values, createdByPersonId: actorPersonId }).returning();
    await invalidate(TEMPLATES_CACHE);
    return { before: null, after };
  }
  const before = await findReviewTemplate(templateId);
  if (!before) throw new ActionError("review_template_not_found");
  const [after] = await db().update(schema.reviewTemplate).set(values).where(eq(schema.reviewTemplate.id, templateId)).returning();
  await invalidate(TEMPLATES_CACHE);
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
  signOffRequired: boolean;
  isRolling: boolean;
};

function checkCycle(input: CycleInput): void {
  if (input.periodEnd < input.periodStart) throw new ActionError("review_period_backwards");
  // Only probation ends one person at a time; a mid-year or annual review has a cohort.
  if (input.isRolling && input.kind !== "probation") throw new ActionError("review_rolling_not_probation");
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
  // A probation form on an annual cycle would ask the wrong questions of everybody.
  if (!templateSuits(template, input.kind)) throw new ActionError("review_template_wrong_kind");
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

/** Who was put into a cycle, as the launch and enrolment notices need them. */
export type Enrolled = { participantId: string; personId: string; managerPersonId: string | null; cycleId: string; cycleName: string; selfDueOn: IsoDate | null; managerDueOn: IsoDate | null };

export type LaunchResult = { cycle: ReviewCycleRow; participants: number; enrolled: Enrolled[] };

/**
 * Launch: freeze the form, work out who is in, snapshot each one's manager, and open the cycle for
 * writing. Idempotent in the sense that relaunching is refused — a cycle is launched once.
 *
 * A **rolling** probation cycle launches empty: nobody is due yet. People are enrolled one at a
 * time as their probation nears its end (`probation-reviews.ts`), each with deadlines of their own.
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
    checkTemplate({ name: template.name, nameEn: template.nameEn, description: template.description, kinds: template.kinds, sections: template.sections, ratingScale: template.ratingScale, isActive: template.isActive });
    if (!templateSuits(template, cycle.kind as ReviewCycleKind)) throw new ActionError("review_template_wrong_kind");

    const directory = await loadDirectory(tx);
    const people = cycle.isRolling ? [] : await eligibleParticipants(cycle, directory);
    if (people.length === 0 && !cycle.isRolling) throw new ActionError("review_cycle_no_participants");
    if (people.length > 0) {
      await tx
        .insert(schema.reviewParticipant)
        .values(people.map((row) => ({ cycleId, personId: row.personId, entityId: row.entityId ?? null, departmentId: directory.get(row.personId)?.departmentId ?? null, managerPersonId: row.managerId ?? null })))
        .onConflictDoNothing();
    }
    const [after] = await tx
      .update(schema.reviewCycle)
      .set({ status: "active", formSnapshot: shape, launchedAt: new Date(), launchedByPersonId: actorPersonId, updatedAt: new Date() })
      .where(eq(schema.reviewCycle.id, cycleId))
      .returning();
    // Anybody HR put in by hand before the launch is told too, so read the cycle's people back whole.
    const everyone = await tx.select().from(schema.reviewParticipant).where(eq(schema.reviewParticipant.cycleId, cycleId));
    return { cycle: after, participants: everyone.length, enrolled: everyone.map((row) => enrolledOf(row, after)) };
  });
}

/** A participant as the notices need it: their own deadlines, or the cycle's. */
export const enrolledOf = (participant: ReviewParticipantRow, cycle: ReviewCycleRow): Enrolled => ({
  participantId: participant.id,
  personId: participant.personId,
  managerPersonId: participant.managerPersonId,
  cycleId: cycle.id,
  cycleName: cycle.name,
  ...dueDatesOf(participant, cycle),
});

/** One person's deadlines: their own where they have them (a probation review), else the cycle's. */
export const dueDatesOf = (participant: Pick<ReviewParticipantRow, "selfDueOn" | "managerDueOn">, cycle: Pick<ReviewCycleRow, "selfDueOn" | "managerDueOn">): { selfDueOn: IsoDate | null; managerDueOn: IsoDate | null } => ({
  selfDueOn: participant.selfDueOn ?? cycle.selfDueOn,
  managerDueOn: participant.managerDueOn ?? cycle.managerDueOn,
});

/**
 * draft → active → calibration → released → closed, one step at a time and never backwards.
 * A rolling probation cycle has no calibration round of its own — each review is released as it
 * comes in — so it goes from active straight to closed.
 */
const CYCLE_NEXT: Partial<Record<ReviewCycleStatus, ReviewCycleStatus>> = { active: "calibration", calibration: "released", released: "closed" };
const ROLLING_NEXT: Partial<Record<ReviewCycleStatus, ReviewCycleStatus>> = { active: "closed" };

export async function advanceReviewCycle(cycleId: string, to: ReviewCycleStatus, executor: ReturnType<typeof db> = db()): Promise<{ before: ReviewCycleRow; after: ReviewCycleRow }> {
  return executor.transaction(async (tx) => {
    const [before] = await tx.select().from(schema.reviewCycle).where(eq(schema.reviewCycle.id, cycleId)).limit(1).for("update");
    if (!before) throw new ActionError("review_cycle_not_found");
    if (nextCycleStatus(before.status as ReviewCycleStatus, before.isRolling) !== to) throw new ActionError("review_cycle_bad_step");
    const [after] = await tx
      .update(schema.reviewCycle)
      .set({ status: to, closedAt: to === "closed" ? new Date() : before.closedAt, updatedAt: new Date() })
      .where(eq(schema.reviewCycle.id, cycleId))
      .returning();
    return { before, after };
  });
}

export const nextCycleStatus = (status: ReviewCycleStatus, rolling = false): ReviewCycleStatus | null => (rolling ? ROLLING_NEXT : CYCLE_NEXT)[status] ?? null;

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
  return subject
    ? {
        subject,
        managerPersonId: participant.managerPersonId,
        stage: participant.stage as ReviewStage,
        released: participant.releasedAt !== null,
        cycleStatus: cycle.status as ReviewCycleStatus,
        peerAnonymous: cycle.peerAnonymous,
        rolling: cycle.isRolling,
        signOffRequired: cycle.signOffRequired,
        signedOff: participant.signOffRecordedAt !== null,
      }
    : null;
};

export type OwnDueDates = { selfDueOn: IsoDate | null; managerDueOn: IsoDate | null };

/**
 * Putting one person into a cycle by hand — somebody the launch missed, or a probation HR does not
 * want to wait for. Their own deadlines, if given, win over the cycle's; a rolling cycle's people
 * all have their own. Only into a cycle that is still being built or written.
 */
export async function addParticipant(cycleId: string, personId: string, directory: Directory, executor: Executor = db(), due: OwnDueDates = { selfDueOn: null, managerDueOn: null }): Promise<{ participant: ReviewParticipantRow; cycle: ReviewCycleRow }> {
  const row = directory.get(personId);
  if (!row) throw new ActionError("review_person_not_found");
  const cycle = await findReviewCycle(cycleId, executor);
  if (!cycle) throw new ActionError("review_cycle_not_found");
  if (cycle.status !== "draft" && cycle.status !== "active") throw new ActionError("review_cycle_not_collecting");
  if (due.selfDueOn && due.managerDueOn && due.managerDueOn < due.selfDueOn) throw new ActionError("review_timeline_backwards");
  const [created] = await executor
    .insert(schema.reviewParticipant)
    .values({ cycleId, personId, entityId: row.entityId ?? null, departmentId: row.departmentId ?? null, managerPersonId: row.managerId ?? null, selfDueOn: due.selfDueOn, managerDueOn: due.managerDueOn })
    .onConflictDoNothing()
    .returning();
  if (!created) throw new ActionError("review_participant_exists");
  return { participant: created, cycle };
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
    // A rolling cycle stays open after one person's review has been handed over; theirs is done.
    if (participant.releasedAt) throw new ActionError("review_already_released");
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
        const { selfDueOn } = dueDatesOf(participant, cycle);
        const selfOverdue = selfDueOn !== null && selfDueOn < today;
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
 * HR sends a submitted form back to its author: it is a draft again, scored nothing, and the reason
 * is kept on it for the author to read. Only while the review is being written — once it has been
 * calibrated or released the figure is settled. The stage follows what is still submitted.
 */
export async function returnReviewForm(formId: string, reason: string, actorPersonId: string, executor: ReturnType<typeof db> = db()): Promise<{ before: ReviewFormRow; after: ReviewFormRow; participant: ReviewParticipantRow; cycle: ReviewCycleRow }> {
  return executor.transaction(async (tx) => {
    const [before] = await tx.select().from(schema.reviewForm).where(eq(schema.reviewForm.id, formId)).limit(1).for("update");
    if (!before) throw new ActionError("review_form_not_found");
    if (before.status !== "submitted") throw new ActionError("review_form_not_submitted");
    const [participant] = await tx.select().from(schema.reviewParticipant).where(eq(schema.reviewParticipant.id, before.participantId)).limit(1).for("update");
    const cycle = await findReviewCycle(before.cycleId, tx);
    if (!participant || !cycle) throw new ActionError("review_participant_not_found");
    if (participant.personId === actorPersonId) throw new ActionError("review_own");
    if (cycle.status !== "active") throw new ActionError("review_cycle_not_collecting");
    if (participant.calibratedAt || participant.releasedAt) throw new ActionError("review_form_settled");
    const [after] = await tx
      .update(schema.reviewForm)
      .set({ status: "draft" satisfies ReviewFormStatus, overallRatingBp: null, scoreTrace: null, submittedAt: null, returnedAt: new Date(), returnedByPersonId: actorPersonId, returnReason: reason, updatedAt: new Date() })
      .where(eq(schema.reviewForm.id, formId))
      .returning();
    const [counts] = await tx
      .select({
        self: sql<number>`(count(*) filter (where ${schema.reviewForm.kind} = 'self'))::int`,
        manager: sql<number>`(count(*) filter (where ${schema.reviewForm.kind} = 'manager'))::int`,
      })
      .from(schema.reviewForm)
      .where(and(eq(schema.reviewForm.participantId, participant.id), eq(schema.reviewForm.status, "submitted")));
    const stage: ReviewStage = counts.manager > 0 ? "manager_done" : counts.self > 0 ? "self_done" : "pending";
    const [updated] = stage === participant.stage ? [participant] : await tx.update(schema.reviewParticipant).set({ stage, updatedAt: new Date() }).where(eq(schema.reviewParticipant.id, participant.id)).returning();
    return { before, after, participant: updated, cycle };
  });
}

// Calibration and release happen from the cycle's calibration stage on (in a rolling probation
// cycle, while it is open), and a review is never levelled or handed over by the person it is
// about (owner's decision, 2026-10-05; PRF-02). Both hold here as well as in the policy, because
// the bulk release reaches these rows by another road.
async function assertReleasable(tx: Tx, participant: ReviewParticipantRow, actorPersonId: string): Promise<void> {
  if (participant.personId === actorPersonId) throw new ActionError("review_own");
  const cycle = await findReviewCycle(participant.cycleId, tx);
  if (!cycle || !releasable({ status: cycle.status as ReviewCycleStatus, rolling: cycle.isRolling })) throw new ActionError("review_cycle_not_calibrating");
}

/**
 * Calibration: HR may level a rating before release, with a note saying why. The manager's own
 * form is left exactly as written — the rating on it is their proposal — and what moves is the
 * figure the final yearly result reads (FR-PRF-09); the note is the record of the difference.
 */
export async function calibrateParticipant(participantId: string, input: { reviewScoreBp: number | null; note: string }, actorPersonId: string, executor: ReturnType<typeof db> = db()): Promise<{ before: ReviewParticipantRow; after: ReviewParticipantRow }> {
  return executor.transaction(async (tx) => {
    const [before] = await tx.select().from(schema.reviewParticipant).where(eq(schema.reviewParticipant.id, participantId)).limit(1).for("update");
    if (!before) throw new ActionError("review_participant_not_found");
    if (before.releasedAt) throw new ActionError("review_already_released");
    await assertReleasable(tx, before, actorPersonId);
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
 * the calibrated one if there is one, else the rating the manager proposed. Refused before the
 * manager has written, and before the cycle has reached its calibration stage.
 */
export async function releaseParticipant(participantId: string, actorPersonId: string, executor: ReturnType<typeof db> = db()): Promise<{ before: ReviewParticipantRow; after: ReviewParticipantRow }> {
  return executor.transaction(async (tx) => {
    const [before] = await tx.select().from(schema.reviewParticipant).where(eq(schema.reviewParticipant.id, participantId)).limit(1).for("update");
    if (!before) throw new ActionError("review_participant_not_found");
    if (before.releasedAt) throw new ActionError("review_already_released");
    await assertReleasable(tx, before, actorPersonId);
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

/**
 * The sign-off conversation (FR-PRF-03): after release, the manager sits down with the person and
 * records that it happened — the day, and a note of what was agreed. Recorded once.
 */
export async function recordSignOff(participantId: string, input: { heldOn: IsoDate; note: string | null }, actorPersonId: string, today: IsoDate = todayInVietnam(), executor: ReturnType<typeof db> = db()): Promise<{ before: ReviewParticipantRow; after: ReviewParticipantRow }> {
  return executor.transaction(async (tx) => {
    const [before] = await tx.select().from(schema.reviewParticipant).where(eq(schema.reviewParticipant.id, participantId)).limit(1).for("update");
    if (!before) throw new ActionError("review_participant_not_found");
    if (!before.releasedAt) throw new ActionError("review_not_released");
    if (before.signOffRecordedAt) throw new ActionError("review_sign_off_recorded");
    if (before.personId === actorPersonId) throw new ActionError("review_own");
    // A conversation about a review cannot have been held before the review was handed over, or tomorrow.
    if (input.heldOn > today || input.heldOn < todayInVietnam(before.releasedAt)) throw new ActionError("review_sign_off_date");
    const [after] = await tx
      .update(schema.reviewParticipant)
      .set({ signOffOn: input.heldOn, signOffNote: input.note, signOffByPersonId: actorPersonId, signOffRecordedAt: new Date(), stage: laterStage(before.stage as ReviewStage, "signed_off"), updatedAt: new Date() })
      .where(eq(schema.reviewParticipant.id, participantId))
      .returning();
    return { before, after };
  });
}

/** The person signs that they have seen it (FR-PRF-03's last step) — after the sign-off conversation, where the cycle asks for one. */
export async function acknowledgeParticipant(participantId: string, note: string | null, executor: ReturnType<typeof db> = db()): Promise<{ before: ReviewParticipantRow; after: ReviewParticipantRow }> {
  return executor.transaction(async (tx) => {
    const [before] = await tx.select().from(schema.reviewParticipant).where(eq(schema.reviewParticipant.id, participantId)).limit(1).for("update");
    if (!before) throw new ActionError("review_participant_not_found");
    if (!before.releasedAt) throw new ActionError("review_not_released");
    if (before.acknowledgedAt) throw new ActionError("review_already_acknowledged");
    const cycle = await findReviewCycle(before.cycleId, tx);
    if (cycle?.signOffRequired && !before.signOffRecordedAt) throw new ActionError("review_sign_off_missing");
    const [after] = await tx
      .update(schema.reviewParticipant)
      .set({ acknowledgedAt: new Date(), acknowledgementNote: note, stage: laterStage(before.stage as ReviewStage, "acknowledged"), updatedAt: new Date() })
      .where(eq(schema.reviewParticipant.id, participantId))
      .returning();
    return { before, after };
  });
}

// ── Peer / 360 feedback (FR-PRF-03, week 2) ─────────────────────────────────────────────────
//
// The person puts peers forward and their manager (or HR) approves them; a manager or HR may also
// add a peer outright, which needs no approval. A peer who is approved gets a `review_form` of
// their own to fill in — their draft is private to them, like every other draft.
//
// Anonymity is a property of the cycle, honoured on the way out (`review-policy.ts`), not by
// hiding the nomination: HR and the manager must be able to see who was asked and chase them.

/** Who may be asked: the cycle's people, minus the subject, minus whoever is already nominated. */
export async function peerCandidates(participantId: string, executor: Executor = db()): Promise<{ id: string; fullName: string }[]> {
  const [found, directory, nominated] = await Promise.all([
    findParticipant(participantId, executor),
    loadDirectory(executor),
    executor.select({ peerPersonId: schema.reviewPeerNomination.peerPersonId }).from(schema.reviewPeerNomination).where(eq(schema.reviewPeerNomination.participantId, participantId)),
  ]);
  if (!found) return [];
  const taken = new Set(nominated.map((row) => row.peerPersonId));
  return [...directory.values()]
    .filter((row) => row.status === "active" && row.workforceType !== "collaborator" && row.personId !== found.participant.personId && !taken.has(row.personId))
    .map((row) => ({ id: row.personId, fullName: row.fullName }))
    .sort((a, b) => a.fullName.localeCompare(b.fullName));
}

const approvedCount = async (participantId: string, executor: Executor): Promise<number> =>
  (await executor.select({ id: schema.reviewPeerNomination.id }).from(schema.reviewPeerNomination).where(and(eq(schema.reviewPeerNomination.participantId, participantId), eq(schema.reviewPeerNomination.status, "approved")))).length;

export type NominateResult = { nomination: ReviewPeerNominationRow; notify: boolean };

/**
 * Put one peer forward. `approved` is set by the caller from the policy: the subject's own
 * nomination waits for their manager, a manager's or HR's is approved at once.
 */
export async function nominatePeer(input: { participantId: string; peerPersonId: string; approved: boolean; note: string | null }, actorPersonId: string, executor: ReturnType<typeof db> = db()): Promise<NominateResult> {
  return executor.transaction(async (tx) => {
    const found = await findParticipant(input.participantId, tx);
    if (!found) throw new ActionError("review_participant_not_found");
    const { participant, cycle } = found;
    if (!cycle.peersEnabled) throw new ActionError("review_peers_disabled");
    if (cycle.status !== "active") throw new ActionError("review_cycle_not_collecting");
    if (input.peerPersonId === participant.personId) throw new ActionError("review_peer_is_subject");
    // The cap counts the peers who are actually going to write, not the ones still waiting.
    if (input.approved && cycle.peerMax > 0 && (await approvedCount(input.participantId, tx)) >= cycle.peerMax) throw new ActionError("review_peer_max");
    const [nomination] = await tx
      .insert(schema.reviewPeerNomination)
      .values({
        cycleId: cycle.id,
        participantId: input.participantId,
        peerPersonId: input.peerPersonId,
        nominatedByPersonId: actorPersonId,
        note: input.note,
        status: input.approved ? "approved" : "pending",
        decidedByPersonId: input.approved ? actorPersonId : null,
        decidedAt: input.approved ? new Date() : null,
      })
      .onConflictDoNothing()
      .returning();
    if (!nomination) throw new ActionError("review_peer_exists");
    return { nomination, notify: input.approved };
  });
}

/** The manager's (or HR's) answer to a nomination the person made. */
export async function decideNomination(nominationId: string, decision: "approve" | "decline", actorPersonId: string, executor: ReturnType<typeof db> = db()): Promise<{ before: ReviewPeerNominationRow; after: ReviewPeerNominationRow; cycle: ReviewCycleRow }> {
  return executor.transaction(async (tx) => {
    const [before] = await tx.select().from(schema.reviewPeerNomination).where(eq(schema.reviewPeerNomination.id, nominationId)).limit(1).for("update");
    if (!before) throw new ActionError("review_nomination_not_found");
    if (before.status !== "pending") throw new ActionError("review_nomination_decided");
    const cycle = await findReviewCycle(before.cycleId, tx);
    if (!cycle) throw new ActionError("review_cycle_not_found");
    if (decision === "approve" && cycle.peerMax > 0 && (await approvedCount(before.participantId, tx)) >= cycle.peerMax) throw new ActionError("review_peer_max");
    const [after] = await tx
      .update(schema.reviewPeerNomination)
      .set({ status: decision === "approve" ? "approved" : "declined", decidedByPersonId: actorPersonId, decidedAt: new Date(), updatedAt: new Date() })
      .where(eq(schema.reviewPeerNomination.id, nominationId))
      .returning();
    return { before, after, cycle };
  });
}

export async function findNomination(nominationId: string, executor: Executor = db()): Promise<ReviewPeerNominationRow | null> {
  const [row] = await executor.select().from(schema.reviewPeerNomination).where(eq(schema.reviewPeerNomination.id, nominationId)).limit(1);
  return row ?? null;
}

/** Taking a nomination back — only while that peer has written nothing. */
export async function withdrawNomination(nominationId: string, executor: ReturnType<typeof db> = db()): Promise<ReviewPeerNominationRow> {
  return executor.transaction(async (tx) => {
    const [row] = await tx.select().from(schema.reviewPeerNomination).where(eq(schema.reviewPeerNomination.id, nominationId)).limit(1).for("update");
    if (!row) throw new ActionError("review_nomination_not_found");
    const [form] = await tx.select({ id: schema.reviewForm.id }).from(schema.reviewForm).where(and(eq(schema.reviewForm.participantId, row.participantId), eq(schema.reviewForm.kind, "peer"), eq(schema.reviewForm.authorPersonId, row.peerPersonId))).limit(1);
    if (form) throw new ActionError("review_nomination_has_form");
    await tx.delete(schema.reviewPeerNomination).where(eq(schema.reviewPeerNomination.id, nominationId));
    return row;
  });
}

export type PeerInvitation = { nominationId: string; participantId: string; cycleId: string; cycleName: string; year: number; subjectPersonId: string; subjectName: string; peerDueOn: IsoDate | null; written: boolean; submitted: boolean };

/** "Somebody asked you for feedback": the approved nominations naming me, in a live cycle. */
export async function listPeerInvitations(personId: string, executor: Executor = db()): Promise<PeerInvitation[]> {
  const rows = await executor
    .select({ nomination: schema.reviewPeerNomination, participant: schema.reviewParticipant, cycle: schema.reviewCycle })
    .from(schema.reviewPeerNomination)
    .innerJoin(schema.reviewParticipant, eq(schema.reviewParticipant.id, schema.reviewPeerNomination.participantId))
    .innerJoin(schema.reviewCycle, eq(schema.reviewCycle.id, schema.reviewPeerNomination.cycleId))
    .where(and(eq(schema.reviewPeerNomination.peerPersonId, personId), eq(schema.reviewPeerNomination.status, "approved"), inArray(schema.reviewCycle.status, ["active", "calibration"])))
    .orderBy(desc(schema.reviewCycle.year));
  if (rows.length === 0) return [];
  const [forms, directory] = await Promise.all([
    executor
      .select({ participantId: schema.reviewForm.participantId, status: schema.reviewForm.status })
      .from(schema.reviewForm)
      .where(and(eq(schema.reviewForm.authorPersonId, personId), eq(schema.reviewForm.kind, "peer"), inArray(schema.reviewForm.participantId, rows.map((row) => row.participant.id)))),
    loadDirectory(executor),
  ]);
  return rows.map(({ nomination, participant, cycle }) => {
    const form = forms.find((row) => row.participantId === participant.id);
    return {
      nominationId: nomination.id,
      participantId: participant.id,
      cycleId: cycle.id,
      cycleName: cycle.name,
      year: cycle.year,
      subjectPersonId: participant.personId,
      subjectName: directory.get(participant.personId)?.fullName ?? "—",
      peerDueOn: cycle.peerDueOn,
      written: !!form,
      submitted: form?.status === "submitted",
    };
  });
}

/** Is this person an approved peer of this participant? What the form and the page ask. */
export async function isApprovedPeer(participantId: string, personId: string, executor: Executor = db()): Promise<boolean> {
  const [row] = await executor
    .select({ id: schema.reviewPeerNomination.id })
    .from(schema.reviewPeerNomination)
    .where(and(eq(schema.reviewPeerNomination.participantId, participantId), eq(schema.reviewPeerNomination.peerPersonId, personId), eq(schema.reviewPeerNomination.status, "approved")))
    .limit(1);
  return !!row;
}

// ── Releasing a whole cycle at once ─────────────────────────────────────────────────────────

export type BulkReleaseResult = { released: string[]; skipped: { participantId: string; reason: string }[] };

/**
 * Release everybody in a cycle who is ready. The ones whose manager has not written are left
 * alone and listed back — a bulk action that silently skips people is worse than one that says so.
 * So is the actor's own review: somebody else releases that one. Refused as a whole before the
 * cycle has reached its calibration stage.
 */
export async function releaseCycle(cycleId: string, actorPersonId: string, executor: ReturnType<typeof db> = db()): Promise<BulkReleaseResult> {
  const cycle = await findReviewCycle(cycleId, executor);
  if (!cycle) throw new ActionError("review_cycle_not_found");
  if (!releasable({ status: cycle.status as ReviewCycleStatus, rolling: cycle.isRolling })) throw new ActionError("review_cycle_not_calibrating");
  const participants = await executor.select().from(schema.reviewParticipant).where(and(eq(schema.reviewParticipant.cycleId, cycleId), isNull(schema.reviewParticipant.releasedAt)));
  const result: BulkReleaseResult = { released: [], skipped: [] };
  for (const participant of participants) {
    try {
      await releaseParticipant(participant.id, actorPersonId, executor);
      result.released.push(participant.id);
    } catch (error) {
      result.skipped.push({ participantId: participant.id, reason: error instanceof ActionError ? error.message : "failed" });
    }
  }
  return result;
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
  /** This person's deadlines: their own where they have them, else the cycle's. */
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
      ...dueDatesOf(participant, cycle),
    };
  });
}

const joined = (executor: Executor) => executor.select({ participant: schema.reviewParticipant, cycle: schema.reviewCycle }).from(schema.reviewParticipant).innerJoin(schema.reviewCycle, eq(schema.reviewCycle.id, schema.reviewParticipant.cycleId));

/** My own reviews, newest cycle first. */
export async function listMyParticipations(personId: string, executor: Executor = db()): Promise<ParticipantLine[]> {
  const [rows, directory] = await Promise.all([joined(executor).where(and(eq(schema.reviewParticipant.personId, personId), ne(schema.reviewCycle.status, "draft"))).orderBy(desc(schema.reviewCycle.year)), loadDirectory(executor)]);
  return toLines(rows, directory, executor);
}

/** The reviews I owe as somebody's manager: the people snapshotted to me in a live cycle. */
export async function listReviewsIOwe(personId: string, executor: Executor = db()): Promise<ParticipantLine[]> {
  const [rows, directory] = await Promise.all([
    joined(executor)
      .where(and(eq(schema.reviewParticipant.managerPersonId, personId), inArray(schema.reviewCycle.status, ["active", "calibration"])))
      .orderBy(desc(schema.reviewCycle.year)),
    loadDirectory(executor),
  ]);
  return toLines(rows, directory, executor);
}

/** Every participant of one cycle — HR's and a manager's view; the caller filters by policy. */
export async function listCycleParticipants(cycleId: string, executor: Executor = db()): Promise<ParticipantLine[]> {
  const [rows, directory] = await Promise.all([joined(executor).where(eq(schema.reviewParticipant.cycleId, cycleId)).orderBy(asc(schema.reviewParticipant.createdAt)), loadDirectory(executor)]);
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
  const [found, directory, forms, nominations] = await Promise.all([
    findParticipant(participantId, executor),
    loadDirectory(executor),
    listFormsOf(participantId, executor),
    executor.select().from(schema.reviewPeerNomination).where(eq(schema.reviewPeerNomination.participantId, participantId)).orderBy(asc(schema.reviewPeerNomination.createdAt)),
  ]);
  if (!found) return null;
  const parties = partiesOfParticipant(found.participant, found.cycle, directory);
  if (!parties) return null;
  return { ...found, parties, shape: found.cycle.formSnapshot, forms, nominations, directory };
}

/** How far a cycle has got, for HR's list. */
export async function cycleProgress(cycleIds: readonly string[], executor: Executor = db()): Promise<Map<string, { participants: number; selfDone: number; managerDone: number; released: number }>> {
  const result = new Map<string, { participants: number; selfDone: number; managerDone: number; released: number }>();
  if (cycleIds.length === 0) return result;
  const participant = schema.reviewParticipant;
  const form = schema.reviewForm;
  const [people, submitted] = await Promise.all([
    executor
      .select({ cycleId: participant.cycleId, participants: sql<number>`count(*)::int`, released: sql<number>`(count(*) filter (where ${participant.releasedAt} is not null))::int` })
      .from(participant)
      .where(inArray(participant.cycleId, [...cycleIds]))
      .groupBy(participant.cycleId),
    executor
      .select({
        cycleId: form.cycleId,
        selfDone: sql<number>`(count(distinct ${form.participantId}) filter (where ${form.kind} = 'self'))::int`,
        managerDone: sql<number>`(count(distinct ${form.participantId}) filter (where ${form.kind} = 'manager'))::int`,
      })
      .from(form)
      .where(and(inArray(form.cycleId, [...cycleIds]), eq(form.status, "submitted")))
      .groupBy(form.cycleId),
  ]);
  const peopleOf = new Map(people.map((row) => [row.cycleId, row]));
  const submittedOf = new Map(submitted.map((row) => [row.cycleId, row]));
  for (const cycleId of cycleIds) {
    result.set(cycleId, {
      participants: peopleOf.get(cycleId)?.participants ?? 0,
      selfDone: submittedOf.get(cycleId)?.selfDone ?? 0,
      managerDone: submittedOf.get(cycleId)?.managerDone ?? 0,
      released: peopleOf.get(cycleId)?.released ?? 0,
    });
  }
  return result;
}

/** Who takes part in a year's annual cycles past draft — whose final result there is to compute. */
export async function annualParticipantIds(year: number, executor: Executor = db()): Promise<string[]> {
  const rows = await executor
    .selectDistinct({ personId: schema.reviewParticipant.personId })
    .from(schema.reviewParticipant)
    .innerJoin(schema.reviewCycle, eq(schema.reviewCycle.id, schema.reviewParticipant.cycleId))
    .where(and(eq(schema.reviewCycle.year, year), eq(schema.reviewCycle.kind, "annual"), ne(schema.reviewCycle.status, "draft")));
  return rows.map((row) => row.personId);
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
