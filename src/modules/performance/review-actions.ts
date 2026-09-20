"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createAction } from "@/lib/action";
import { todayInVietnam } from "@/lib/dates";
import { notify } from "@/modules/platform/notifications/service";
import { REVIEW_CYCLE_KINDS, REVIEW_CYCLE_STATUSES, REVIEW_FORM_KINDS, REVIEW_SECTION_KINDS } from "./enums";
import { loadDirectory } from "./people";
import { canAcknowledgeReview, canDecideNomination, canManageCycle, canManageReviewTemplates, canNominatePeer, canReleaseReview, canWriteManagerReview, canWritePeerReview, canWriteSelfReview, nominationIsApproved, type ReviewParties } from "./review-policy";
import {
  acknowledgeParticipant,
  addParticipant,
  advanceReviewCycle,
  calibrateParticipant,
  decideNomination,
  findNomination,
  findParticipant,
  findReviewCycle,
  isApprovedPeer,
  launchReviewCycle,
  listCycleParticipants,
  nominatePeer,
  partiesOfParticipant,
  releaseCycle,
  releaseParticipant,
  removeParticipant,
  type ReviewCycleRow,
  type ReviewTemplateRow,
  saveReviewCycle,
  saveReviewForm,
  saveReviewTemplate,
  withdrawNomination,
} from "./reviews";

const blankToNull = (value: unknown) => (typeof value === "string" && value.trim() === "" ? null : value);
const optional = <Schema extends z.ZodType>(schema: Schema) => z.preprocess(blankToNull, schema.nullable().default(null));
const checkbox = z.preprocess((value) => value === "on" || value === true || value === "true", z.boolean());
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

function refresh(participantId?: string) {
  revalidatePath("/performance", "layout");
  if (participantId) revalidatePath(`/performance/reviews/${participantId}`);
}

const templateFacts = (row: ReviewTemplateRow) => ({ name: row.name, sections: row.sections.length, scalePoints: row.ratingScale.length, isActive: row.isActive });
const cycleFacts = (row: ReviewCycleRow) => ({ name: row.name, kind: row.kind, year: row.year, entityId: row.entityId, status: row.status, templateId: row.templateId, selfDueOn: row.selfDueOn, managerDueOn: row.managerDueOn, releaseOn: row.releaseOn, peersEnabled: row.peersEnabled });

/** The parties of one participant, loaded once for both the authorize step and the run step. */
async function partiesOf(participantId: string): Promise<ReviewParties | null> {
  const found = await findParticipant(participantId);
  if (!found) return null;
  return partiesOfParticipant(found.participant, found.cycle, await loadDirectory());
}

// ── Templates (HR) ──────────────────────────────────────────────────────────────────────────

const sectionSchema = z.object({
  key: z.string().trim().regex(/^[a-z0-9][a-z0-9_-]{0,39}$/),
  title: z.string().trim().min(1).max(300),
  titleEn: optional(z.string().trim().max(300)),
  kind: z.enum(REVIEW_SECTION_KINDS),
  weight: z.coerce.number().int().min(0).max(1000).default(0),
  required: checkbox,
  askedOf: z.array(z.enum(REVIEW_FORM_KINDS)).min(1),
});
const ratingPointSchema = z.object({
  value: z.coerce.number().int().min(0).max(100),
  label: z.string().trim().min(1).max(120),
  labelEn: optional(z.string().trim().max(120)),
  // What the point is worth, typed as a percentage ("100" → 10000 bp).
  scorePercent: z.coerce.number().min(0).max(1000),
});

const saveTemplatePipeline = createAction({
  name: "performance.reviewTemplate.save",
  input: z.object({
    templateId: optional(z.uuid()),
    name: z.string().trim().min(1).max(200),
    nameEn: optional(z.string().trim().max(200)),
    description: optional(z.string().trim().max(2000)),
    sections: z.array(sectionSchema).min(1).max(40),
    ratingScale: z.array(ratingPointSchema).min(2).max(10),
    isActive: checkbox,
  }),
  authorize: (user) => canManageReviewTemplates(user.principal),
  run: async ({ user, input }) => {
    const { before, after } = await saveReviewTemplate(
      input.templateId,
      {
        name: input.name,
        nameEn: input.nameEn,
        description: input.description,
        sections: input.sections.map((section) => ({ ...section, askedOf: [...new Set(section.askedOf)] })),
        ratingScale: input.ratingScale.map((point) => ({ value: point.value, label: point.label, labelEn: point.labelEn, scoreBp: Math.round(point.scorePercent * 100) })),
        isActive: input.isActive,
      },
      user.person.id,
    );
    refresh();
    return { data: { id: after.id }, audit: { resource: { type: "review_template", id: after.id }, summary: after.name, before: before ? templateFacts(before) : undefined, after: templateFacts(after) } };
  },
});
export async function saveReviewTemplateAction(input: unknown) {
  return saveTemplatePipeline(input);
}

// ── Cycles (HR) ─────────────────────────────────────────────────────────────────────────────

const cycleSchema = z.object({
  cycleId: optional(z.uuid()),
  entityId: optional(z.uuid()),
  name: z.string().trim().min(1).max(200),
  kind: z.enum(REVIEW_CYCLE_KINDS),
  year: z.coerce.number().int().min(2000).max(2100),
  periodStart: isoDate,
  periodEnd: isoDate,
  templateId: z.uuid(),
  selfDueOn: optional(isoDate),
  managerDueOn: optional(isoDate),
  peerDueOn: optional(isoDate),
  calibrationOn: optional(isoDate),
  releaseOn: optional(isoDate),
  peersEnabled: checkbox,
  peerMin: z.coerce.number().int().min(0).max(20).default(0),
  peerMax: z.coerce.number().int().min(0).max(20).default(5),
  peerAnonymous: checkbox,
});

const saveCyclePipeline = createAction({
  name: "performance.reviewCycle.save",
  input: cycleSchema,
  // Where the cycle would sit decides who may build it: a group cycle needs a group-wide grant.
  authorize: async (user, input) => {
    if (!canManageCycle(user.principal, input.entityId)) return false;
    // Editing: the cycle's own entity decides too, not only the one being posted.
    if (!input.cycleId) return true;
    const existing = await findReviewCycle(input.cycleId);
    return !!existing && canManageCycle(user.principal, existing.entityId);
  },
  run: async ({ user, input }) => {
    const { cycleId, ...rest } = input;
    const { before, after } = await saveReviewCycle(cycleId, rest, user.person.id);
    refresh();
    return { data: { id: after.id }, audit: { resource: { type: "review_cycle", id: after.id, entityId: after.entityId }, summary: after.name, before: before ? cycleFacts(before) : undefined, after: cycleFacts(after) } };
  },
});
export async function saveReviewCycleAction(input: unknown) {
  return saveCyclePipeline(input);
}

const launchPipeline = createAction({
  name: "performance.reviewCycle.launch",
  input: z.object({ cycleId: z.uuid() }),
  authorize: async (user, input) => {
    const cycle = await findReviewCycle(input.cycleId);
    return !!cycle && canManageCycle(user.principal, cycle.entityId);
  },
  run: async ({ user, input }) => {
    const result = await launchReviewCycle(input.cycleId, user.person.id);
    refresh();
    return { data: { participants: result.participants }, audit: { resource: { type: "review_cycle", id: result.cycle.id, entityId: result.cycle.entityId }, summary: `launched: ${result.participants} participants`, after: cycleFacts(result.cycle) } };
  },
});
export async function launchReviewCycleAction(input: unknown) {
  return launchPipeline(input);
}

const advancePipeline = createAction({
  name: "performance.reviewCycle.advance",
  input: z.object({ cycleId: z.uuid(), to: z.enum(REVIEW_CYCLE_STATUSES) }),
  authorize: async (user, input) => {
    const cycle = await findReviewCycle(input.cycleId);
    return !!cycle && canManageCycle(user.principal, cycle.entityId);
  },
  run: async ({ input }) => {
    const { before, after } = await advanceReviewCycle(input.cycleId, input.to);
    refresh();
    return { data: { status: after.status }, audit: { resource: { type: "review_cycle", id: after.id, entityId: after.entityId }, summary: `${before.status} → ${after.status}`, before: cycleFacts(before), after: cycleFacts(after) } };
  },
});
export async function advanceReviewCycleAction(input: unknown) {
  return advancePipeline(input);
}

const addParticipantPipeline = createAction({
  name: "performance.reviewParticipant.add",
  input: z.object({ cycleId: z.uuid(), personId: z.uuid() }),
  authorize: async (user, input) => {
    const cycle = await findReviewCycle(input.cycleId);
    return !!cycle && canManageCycle(user.principal, cycle.entityId);
  },
  run: async ({ input }) => {
    const row = await addParticipant(input.cycleId, input.personId, await loadDirectory());
    refresh();
    return { data: { id: row.id }, audit: { resource: { type: "review_participant", id: row.id, entityId: row.entityId }, summary: "added", after: { personId: row.personId, managerPersonId: row.managerPersonId } } };
  },
});
export async function addReviewParticipantAction(input: unknown) {
  return addParticipantPipeline(input);
}

const removeParticipantPipeline = createAction({
  name: "performance.reviewParticipant.remove",
  input: z.object({ participantId: z.uuid() }),
  authorize: async (user, input) => {
    const found = await findParticipant(input.participantId);
    return !!found && canManageCycle(user.principal, found.cycle.entityId);
  },
  run: async ({ input }) => {
    const row = await removeParticipant(input.participantId);
    refresh();
    return { data: { id: row.id }, audit: { resource: { type: "review_participant", id: row.id, entityId: row.entityId }, summary: "removed", before: { personId: row.personId, stage: row.stage } } };
  },
});
export async function removeReviewParticipantAction(input: unknown) {
  return removeParticipantPipeline(input);
}

// ── Writing a review ────────────────────────────────────────────────────────────────────────

// Answers arrive from the form as `answers.<section key>`; a rating comes through as its value.
const answersSchema = z.record(z.string().regex(/^[a-z0-9][a-z0-9_-]{0,39}$/), z.union([z.string().max(8000), z.number()])).default({});

const saveFormPipeline = createAction({
  name: "performance.reviewForm.save",
  input: z.object({ participantId: z.uuid(), kind: z.enum(REVIEW_FORM_KINDS), answers: answersSchema, comment: optional(z.string().trim().max(8000)), submit: checkbox }),
  authorize: async (user, input) => {
    const parties = await partiesOf(input.participantId);
    if (!parties) return false;
    switch (input.kind) {
      case "self":
        return canWriteSelfReview(user.principal, parties);
      case "manager":
        return canWriteManagerReview(user.principal, parties);
      case "peer":
        return canWritePeerReview(user.principal, parties, await isApprovedPeer(input.participantId, user.person.id));
    }
  },
  run: async ({ user, input }) => {
    const { before, after, participant } = await saveReviewForm({ participantId: input.participantId, kind: input.kind, answers: input.answers, comment: input.comment, submit: input.submit }, user.person.id, todayInVietnam());
    refresh(input.participantId);
    // The audit keeps what changed, never the prose: a review is personal-tier content.
    return {
      data: { id: after.id, status: after.status, stage: participant.stage },
      audit: { resource: { type: "review_form", id: after.id, entityId: participant.entityId }, summary: `${after.kind} · ${after.status}`, before: before ? { status: before.status, answered: Object.keys(before.answers).length } : undefined, after: { status: after.status, answered: Object.keys(after.answers).length, overallRatingBp: after.overallRatingBp } },
    };
  },
});
export async function saveReviewFormAction(input: unknown) {
  return saveFormPipeline(input);
}

const calibratePipeline = createAction({
  name: "performance.review.calibrate",
  input: z.object({ participantId: z.uuid(), ratingPercent: optional(z.coerce.number().min(0).max(1000)), note: z.string().trim().min(1).max(2000) }),
  authorize: async (user, input) => {
    const parties = await partiesOf(input.participantId);
    return !!parties && canReleaseReview(user.principal, parties);
  },
  run: async ({ user, input }) => {
    const { before, after } = await calibrateParticipant(input.participantId, { reviewScoreBp: input.ratingPercent === null ? null : Math.round(input.ratingPercent * 100), note: input.note }, user.person.id);
    refresh(input.participantId);
    return { data: { reviewScoreBp: after.reviewScoreBp }, audit: { resource: { type: "review_participant", id: after.id, entityId: after.entityId }, summary: "calibrated", before: { reviewScoreBp: before.reviewScoreBp }, after: { reviewScoreBp: after.reviewScoreBp, note: after.calibrationNote } } };
  },
});
export async function calibrateReviewAction(input: unknown) {
  return calibratePipeline(input);
}

const releasePipeline = createAction({
  name: "performance.review.release",
  input: z.object({ participantId: z.uuid() }),
  authorize: async (user, input) => {
    const parties = await partiesOf(input.participantId);
    return !!parties && canReleaseReview(user.principal, parties);
  },
  run: async ({ user, input }) => {
    const { before, after } = await releaseParticipant(input.participantId, user.person.id);
    const cycle = await findReviewCycle(after.cycleId);
    // The person is told there is something to read — never what it says, and never the figure.
    await notify({ recipients: [after.personId], kind: "performance.review_released", params: { cycle: cycle?.name ?? "" }, link: `/performance/reviews/${after.id}` });
    refresh(input.participantId);
    return { data: { releasedAt: after.releasedAt }, audit: { resource: { type: "review_participant", id: after.id, entityId: after.entityId }, summary: "released", before: { stage: before.stage }, after: { stage: after.stage, reviewScoreBp: after.reviewScoreBp } } };
  },
});
export async function releaseReviewAction(input: unknown) {
  return releasePipeline(input);
}

// Release everybody who is ready. The ones the bulk action left alone come back in `data`.
const releaseCyclePipeline = createAction({
  name: "performance.review.releaseCycle",
  input: z.object({ cycleId: z.uuid() }),
  authorize: async (user, input) => {
    const cycle = await findReviewCycle(input.cycleId);
    return !!cycle && canManageCycle(user.principal, cycle.entityId);
  },
  run: async ({ user, input }) => {
    const result = await releaseCycle(input.cycleId, user.person.id);
    const cycle = await findReviewCycle(input.cycleId);
    // Everybody released hears once, in one go, that their review is theirs to read.
    if (result.released.length > 0) {
      const participants = await listCycleParticipants(input.cycleId);
      const told = participants.filter((line) => result.released.includes(line.participantId));
      await notify({ recipients: told.map((line) => line.personId), kind: "performance.review_released", params: { cycle: cycle?.name ?? "" }, link: "/performance/reviews" });
    }
    refresh();
    return {
      data: { released: result.released.length, skipped: result.skipped },
      audit: { resource: { type: "review_cycle", id: input.cycleId, entityId: cycle?.entityId ?? null }, summary: `released ${result.released.length}, skipped ${result.skipped.length}`, after: { released: result.released.length, skipped: result.skipped.map((row) => row.reason) } },
    };
  },
});
export async function releaseCycleAction(input: unknown) {
  return releaseCyclePipeline(input);
}

// ── Peer / 360 nominations (week 2) ─────────────────────────────────────────────────────────

const nominatePipeline = createAction({
  name: "performance.review.nominatePeer",
  input: z.object({ participantId: z.uuid(), peerPersonId: z.uuid(), note: optional(z.string().trim().max(500)) }),
  authorize: async (user, input) => {
    const parties = await partiesOf(input.participantId);
    return !!parties && canNominatePeer(user.principal, parties);
  },
  run: async ({ user, input }) => {
    const parties = await partiesOf(input.participantId);
    // The subject's own choice waits for their manager; a manager's or HR's takes effect at once.
    const approved = !!parties && nominationIsApproved(user.principal, parties);
    const { nomination } = await nominatePeer({ participantId: input.participantId, peerPersonId: input.peerPersonId, approved, note: input.note }, user.person.id);
    if (approved) await notify({ recipients: [input.peerPersonId], kind: "performance.peer_requested", params: {}, link: "/performance/reviews" });
    refresh(input.participantId);
    return { data: { id: nomination.id, status: nomination.status }, audit: { resource: { type: "review_peer_nomination", id: nomination.id }, summary: nomination.status, after: { participantId: nomination.participantId, peerPersonId: nomination.peerPersonId, status: nomination.status } } };
  },
});
export async function nominatePeerAction(input: unknown) {
  return nominatePipeline(input);
}

const decideNominationPipeline = createAction({
  name: "performance.review.decideNomination",
  input: z.object({ nominationId: z.uuid(), decision: z.enum(["approve", "decline"]) }),
  authorize: async (user, input) => {
    const found = await findNomination(input.nominationId);
    if (!found) return false;
    const parties = await partiesOf(found.participantId);
    return !!parties && canDecideNomination(user.principal, parties);
  },
  run: async ({ user, input }) => {
    const { before, after } = await decideNomination(input.nominationId, input.decision, user.person.id);
    if (after.status === "approved") await notify({ recipients: [after.peerPersonId], kind: "performance.peer_requested", params: {}, link: "/performance/reviews" });
    refresh(after.participantId);
    return { data: { status: after.status }, audit: { resource: { type: "review_peer_nomination", id: after.id }, summary: `${before.status} → ${after.status}`, before: { status: before.status }, after: { status: after.status, peerPersonId: after.peerPersonId } } };
  },
});
export async function decidePeerNominationAction(input: unknown) {
  return decideNominationPipeline(input);
}

const withdrawNominationPipeline = createAction({
  name: "performance.review.withdrawNomination",
  input: z.object({ nominationId: z.uuid() }),
  authorize: async (user, input) => {
    const found = await findNomination(input.nominationId);
    if (!found) return false;
    const parties = await partiesOf(found.participantId);
    if (!parties) return false;
    // Whoever may decide a nomination may take one back; so may the person who made it.
    return canDecideNomination(user.principal, parties) || found.nominatedByPersonId === user.person.id;
  },
  run: async ({ input }) => {
    const row = await withdrawNomination(input.nominationId);
    refresh(row.participantId);
    return { data: { id: row.id }, audit: { resource: { type: "review_peer_nomination", id: row.id }, summary: "withdrawn", before: { peerPersonId: row.peerPersonId, status: row.status } } };
  },
});
export async function withdrawPeerNominationAction(input: unknown) {
  return withdrawNominationPipeline(input);
}

const acknowledgePipeline = createAction({
  name: "performance.review.acknowledge",
  input: z.object({ participantId: z.uuid(), note: optional(z.string().trim().max(4000)) }),
  authorize: async (user, input) => {
    const parties = await partiesOf(input.participantId);
    return !!parties && canAcknowledgeReview(user.principal, parties);
  },
  run: async ({ input }) => {
    const { after } = await acknowledgeParticipant(input.participantId, input.note);
    refresh(input.participantId);
    return { data: { acknowledgedAt: after.acknowledgedAt }, audit: { resource: { type: "review_participant", id: after.id, entityId: after.entityId }, summary: "acknowledged", after: { stage: after.stage } } };
  },
});
export async function acknowledgeReviewAction(input: unknown) {
  return acknowledgePipeline(input);
}
