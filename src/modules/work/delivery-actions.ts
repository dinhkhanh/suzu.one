"use server";
// Delivery (FR-PJM-50..57): review chains, stage decisions, client decisions with evidence, pins on
// versions, delivery records, the publish log and its results.
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createAction } from "@/lib/action";
import { todayInVietnam } from "@/lib/dates";
import { beginTaskUpload, completeTaskUpload, findTaskFile } from "./attachments";
import { findReviewChain, removeReviewChain, saveReviewChain } from "./chains";
import { findDelivery, recordDelivery, removeDelivery } from "./deliveries";
import { CLIENT_CHANNELS, fromVietnamLocal, isClientStage, MAX_CHAIN_STAGES, MAX_TIMECODE_MS, STAGE_DECISIONS } from "./engine/delivery";
import { CHANNELS, CONTENT_FORMATS } from "./enums";
import { addPin, deliverableMedia, findPin, setPinResolved } from "./pins";
import { canDecideStage, canEditTask, canManagePublish, canManageReviewChains, canPinFeedback, canRecordClientDecision, canRecordDelivery, canResolvePin, canModerateTask } from "./policy";
import { projectFacts, findProject } from "./projects";
import { cancelPublish, findPublish, findResult, markPublished, planPublish, recordResult, removeResult, updatePublishPlan } from "./publish";
import { resultImport } from "./results-import";
import { clientOfTask, currentStage, decideStage, findDeliverable, pendingDeliverable, recordClientDecision } from "./reviews";
import { type LoadedTask, loadTask } from "./tasks";
import { findTeam, teamFacts } from "./teams";
import { loadViewer } from "./viewer";

type User = Parameters<typeof loadViewer>[0] & { person: { fullName: string }; email: string };
const blankToNull = (value: unknown) => (typeof value === "string" && value.trim() === "" ? null : value);
const optional = <Schema extends z.ZodType>(schema: Schema) => z.preprocess(blankToNull, schema.nullable().default(null));
const checkbox = z.preprocess((value) => value === "on" || value === true || value === "true", z.boolean());
const actorOf = (user: User) => ({ personId: user.person.id, fullName: user.person.fullName });
const https = z.url({ protocol: /^https$/ }).max(1000);
const localDateTime = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
const auditTask = (loaded: LoadedTask) => ({ type: "task:work", id: loaded.task.id, entityId: loaded.task.entityId });

function refreshTask(taskId: string, projectId?: string | null) {
  revalidatePath(`/work/tasks/${taskId}`);
  if (projectId) revalidatePath(`/work/projects/${projectId}`);
  revalidatePath("/tasks");
  revalidatePath("/today");
}

// ── Review chains (FR-PJM-50) ───────────────────────────────────────────────────────────────

const stageInput = z.object({ key: optional(z.string().max(20)), name: z.string().trim().min(1).max(60), reviewer: z.string().max(60), dueHours: optional(z.coerce.number().int().min(1).max(24 * 31)) });

/** Who keeps a team's chains, or a project's own. */
async function managesChainsOf(user: User, teamId: string, projectId: string | null): Promise<boolean> {
  const viewer = await loadViewer(user);
  if (projectId) {
    const found = await findProject(projectId);
    return !!found && found.team.id === teamId && canManageReviewChains(viewer, teamFacts(found.team), projectFacts(found.project, found.team));
  }
  const team = await findTeam(teamId);
  return !!team && canManageReviewChains(viewer, teamFacts(team));
}

const refreshChains = (teamId: string, projectId: string | null) => {
  revalidatePath(`/work/teams/${teamId}/reviews`);
  if (projectId) revalidatePath(`/work/projects/${projectId}`);
};

const saveChainPipeline = createAction({
  name: "work.review_chain.save",
  input: z.object({ chainId: optional(z.uuid()), teamId: z.uuid(), projectId: optional(z.uuid()), name: z.string().trim().min(1).max(80), contentFormat: optional(z.enum(CONTENT_FORMATS)), stages: z.array(stageInput).min(1).max(MAX_CHAIN_STAGES), isActive: checkbox.default(true) }),
  authorize: async (user, input) => {
    const existing = input.chainId ? await findReviewChain(input.chainId) : null;
    if (input.chainId && (existing?.teamId !== input.teamId || (existing?.projectId ?? null) !== input.projectId)) return false;
    return managesChainsOf(user, input.teamId, input.projectId);
  },
  run: async ({ user, input }) => {
    const { chainId, teamId, projectId, ...values } = input;
    const { before, after } = await saveReviewChain({ teamId, projectId }, chainId, values, user.person.id);
    refreshChains(teamId, projectId);
    return { data: { id: after.id }, audit: { resource: { type: "work_review_chain", id: after.id }, summary: after.name, before, after } };
  },
});
export async function saveReviewChainAction(input: unknown) {
  return saveChainPipeline(input);
}

const removeChainPipeline = createAction({
  name: "work.review_chain.remove",
  input: z.object({ chainId: z.uuid() }),
  authorize: async (user, input) => {
    const chain = await findReviewChain(input.chainId);
    return !!chain?.teamId && managesChainsOf(user, chain.teamId, chain.projectId);
  },
  run: async ({ input }) => {
    const { before, deleted } = await removeReviewChain(input.chainId);
    refreshChains(before.teamId!, before.projectId);
    return { data: { deleted }, audit: { resource: { type: "work_review_chain", id: before.id }, summary: before.name, before } };
  },
});
export async function removeReviewChainAction(input: unknown) {
  return removeChainPipeline(input);
}

// ── Stage and client decisions (FR-PJM-50, 51) ──────────────────────────────────────────────

const clientFields = {
  channel: optional(z.enum(CLIENT_CHANNELS)),
  decidedByName: optional(z.string().trim().max(120)),
  decidedOn: optional(z.iso.date()),
  evidenceFileId: optional(z.uuid()),
  evidenceUrl: optional(https),
};
type ClientFields = { channel: string | null; decidedByName: string | null; decidedOn: string | null; evidenceFileId: string | null; evidenceUrl: string | null };

/** The client's side as stored: who decided defaults to the client's name, the day to today, the channel to Zalo — so a phone takes three taps. */
async function clientFactsOf(loaded: LoadedTask, input: ClientFields) {
  const client = await clientOfTask(loaded);
  return { channel: input.channel ?? "zalo", decidedByName: input.decidedByName ?? client.name ?? "", decidedOn: input.decidedOn ?? todayInVietnam(), evidenceFileId: input.evidenceFileId, evidenceUrl: input.evidenceUrl };
}

const decideStagePipeline = createAction({
  name: "work.review.stage",
  input: z.object({ taskId: z.uuid(), decision: z.enum(STAGE_DECISIONS), comment: optional(z.string().trim().max(4000)), ...clientFields }),
  authorize: async (user, input) => {
    const loaded = await loadTask(input.taskId);
    if (!loaded) return false;
    const pending = await pendingDeliverable(input.taskId);
    const stage = pending ? await currentStage(pending) : null;
    if (!pending || !stage) return false;
    const client = await clientOfTask(loaded);
    return canDecideStage(await loadViewer(user), loaded.facts, { isClient: isClientStage(stage.stage), reviewerPersonId: pending.stageReviewerPersonId, submittedByPersonId: pending.submittedByPersonId }, client);
  },
  run: async ({ user, input }) => {
    const loaded = (await loadTask(input.taskId))!;
    const stage = await currentStage((await pendingDeliverable(input.taskId))!);
    const client = stage && isClientStage(stage.stage) ? await clientFactsOf(loaded, input) : null;
    const result = await decideStage(input.taskId, { decision: input.decision, comment: input.comment, client }, actorOf(user));
    refreshTask(input.taskId, loaded.work.projectId);
    return { data: { version: result.deliverable.version, outcome: result.outcome }, audit: { resource: auditTask(loaded), summary: `${loaded.task.title}: v${result.deliverable.version} ${stage?.stage.name ?? ""} ${input.decision}`, after: { version: result.deliverable.version, stage: stage?.stage.name, decision: input.decision, outcome: result.outcome, client: client ? { channel: client.channel, decidedOn: client.decidedOn } : undefined } } };
  },
});
export async function decideStageAction(input: unknown) {
  return decideStagePipeline(input);
}

const clientDecisionPipeline = createAction({
  name: "work.review.client_decision",
  input: z.object({ deliverableId: z.uuid(), decision: z.enum(STAGE_DECISIONS), comment: optional(z.string().trim().max(4000)), ...clientFields }),
  authorize: async (user, input) => {
    const deliverable = await findDeliverable(input.deliverableId);
    const loaded = deliverable ? await loadTask(deliverable.taskId) : undefined;
    if (!loaded) return false;
    return canRecordClientDecision(await loadViewer(user), loaded.facts, await clientOfTask(loaded));
  },
  run: async ({ user, input }) => {
    const deliverable = (await findDeliverable(input.deliverableId))!;
    const loaded = (await loadTask(deliverable.taskId))!;
    const client = await clientFactsOf(loaded, input);
    const result = await recordClientDecision(input.deliverableId, { decision: input.decision, comment: input.comment, client }, actorOf(user));
    refreshTask(loaded.task.id, loaded.work.projectId);
    return { data: { version: result.deliverable.version, outcome: result.outcome, frozen: !!result.deliverable.frozenAt }, audit: { resource: auditTask(loaded), summary: `${loaded.task.title}: v${deliverable.version} client ${input.decision}`, after: { version: deliverable.version, decision: input.decision, channel: client.channel, decidedOn: client.decidedOn, evidence: client.evidenceFileId ? "file" : "link", frozen: !!result.deliverable.frozenAt } } };
  },
});
export async function recordClientDecisionAction(input: unknown) {
  return clientDecisionPipeline(input);
}

/** Evidence is uploaded to the task (a photo of the client's message, an email saved as PDF) by whoever records the decision. */
const recordsClientOn = async (user: User, loaded: LoadedTask) => {
  const viewer = await loadViewer(user);
  return canEditTask(viewer, loaded.facts) || canRecordClientDecision(viewer, loaded.facts, await clientOfTask(loaded));
};

const beginEvidencePipeline = createAction({
  name: "work.review.evidence.begin",
  input: z.object({ taskId: z.uuid(), fileName: z.string().min(1).max(255), sizeBytes: z.number().int().positive() }),
  authorize: async (user, input) => {
    const loaded = await loadTask(input.taskId);
    return !!loaded && recordsClientOn(user, loaded);
  },
  run: async ({ user, input }) => {
    const loaded = (await loadTask(input.taskId))!;
    const upload = await beginTaskUpload(loaded, input, { personId: user.person.id, email: user.email });
    return { data: upload, audit: { resource: auditTask(loaded), summary: input.fileName, after: { fileId: upload.fileId, fileName: input.fileName, sizeBytes: input.sizeBytes } } };
  },
});
export async function beginEvidenceUploadAction(input: unknown) {
  return beginEvidencePipeline(input);
}

const completeEvidencePipeline = createAction({
  name: "work.review.evidence.add",
  input: z.object({ fileId: z.uuid() }),
  authorize: async (user, input) => {
    const found = await findTaskFile(input.fileId, { pending: true });
    return !!found && found.file.uploadedByPersonId === user.person.id && recordsClientOn(user, found.loaded);
  },
  run: async ({ user, input }) => {
    const file = await completeTaskUpload(input.fileId, { personId: user.person.id, email: user.email, fullName: user.person.fullName });
    revalidatePath(`/work/tasks/${file.ownerId}`);
    return { data: { id: file.id, fileName: file.fileName }, audit: { resource: { type: "task:work", id: file.ownerId, entityId: file.entityId }, summary: file.fileName, after: { fileId: file.id, fileName: file.fileName } } };
  },
});
export async function completeEvidenceUploadAction(input: unknown) {
  return completeEvidencePipeline(input);
}

// ── Pins (FR-PJM-52) ────────────────────────────────────────────────────────────────────────

const unit = z.coerce.number().min(0).max(1);
const addPinPipeline = createAction({
  name: "work.review.pin.add",
  input: z.object({ deliverableId: z.uuid(), x: optional(unit), y: optional(unit), timecodeMs: optional(z.coerce.number().int().min(0).max(MAX_TIMECODE_MS)), body: z.string().trim().min(1).max(2000) }),
  authorize: async (user, input) => {
    const found = await deliverableMedia(input.deliverableId);
    return !!found && canPinFeedback(await loadViewer(user), found.loaded.facts);
  },
  run: async ({ user, input }) => {
    const { pin, loaded } = await addPin(input.deliverableId, input, actorOf(user));
    refreshTask(loaded.task.id);
    return { data: { id: pin.id }, audit: { resource: auditTask(loaded), summary: `${loaded.task.title}: pin`, after: { deliverableId: input.deliverableId, x: input.x, y: input.y, timecodeMs: input.timecodeMs } } };
  },
});
export async function addPinAction(input: unknown) {
  return addPinPipeline(input);
}

const resolvePinPipeline = createAction({
  name: "work.review.pin.resolve",
  input: z.object({ pinId: z.uuid(), resolved: z.boolean() }),
  authorize: async (user, input) => {
    const found = await findPin(input.pinId);
    return !!found && canResolvePin(await loadViewer(user), found.loaded.facts, found.pin);
  },
  run: async ({ user, input }) => {
    const { loaded } = (await findPin(input.pinId))!;
    const pin = await setPinResolved(input.pinId, input.resolved, user.person.id);
    refreshTask(loaded.task.id);
    return { data: { id: pin.id }, audit: { resource: auditTask(loaded), summary: `${loaded.task.title}: pin ${input.resolved ? "resolved" : "reopened"}` } };
  },
});
export async function setPinResolvedAction(input: unknown) {
  return resolvePinPipeline(input);
}

// ── Delivery records (FR-PJM-53) ────────────────────────────────────────────────────────────

const deliveryPipeline = createAction({
  name: "work.delivery.record",
  input: z.object({
    taskId: z.uuid(),
    deliverableId: optional(z.uuid()),
    deliveredOn: z.iso.date(),
    recipient: optional(z.string().trim().max(200)),
    links: z.preprocess((value) => (typeof value === "string" ? value.split(/\s+/).filter(Boolean) : value), z.array(https).max(10)).default([]),
    note: optional(z.string().trim().max(2000)),
    confirmUnapproved: checkbox.default(false),
  }),
  authorize: async (user, input) => {
    const loaded = await loadTask(input.taskId);
    return !!loaded && canRecordDelivery(await loadViewer(user), loaded.facts);
  },
  run: async ({ user, input }) => {
    const { taskId, ...values } = input;
    const { delivery, loaded } = await recordDelivery(taskId, values, actorOf(user));
    refreshTask(taskId, loaded.work.projectId);
    return { data: { id: delivery.id }, audit: { resource: auditTask(loaded), summary: `${loaded.task.title}: delivered ${delivery.deliveredOn}`, after: delivery } };
  },
});
export async function recordDeliveryAction(input: unknown) {
  return deliveryPipeline(input);
}

const removeDeliveryPipeline = createAction({
  name: "work.delivery.remove",
  input: z.object({ deliveryId: z.uuid() }),
  authorize: async (user, input) => {
    const found = await findDelivery(input.deliveryId);
    if (!found) return false;
    const viewer = await loadViewer(user);
    return (found.delivery.deliveredByPersonId === user.person.id && canRecordDelivery(viewer, found.loaded.facts)) || canModerateTask(viewer, found.loaded.facts);
  },
  run: async ({ user, input }) => {
    const { loaded } = (await findDelivery(input.deliveryId))!;
    const delivery = await removeDelivery(input.deliveryId, user.person.id);
    refreshTask(loaded.task.id, loaded.work.projectId);
    return { data: { id: delivery.id }, audit: { resource: auditTask(loaded), summary: `${loaded.task.title}: delivery removed`, before: delivery } };
  },
});
export async function removeDeliveryAction(input: unknown) {
  return removeDeliveryPipeline(input);
}

// ── Publish log and results (FR-PJM-54, 57) ─────────────────────────────────────────────────

const planFields = { platform: z.enum(CHANNELS), page: optional(z.string().trim().max(200)), plannedAt: optional(localDateTime) };
const managesTask = async (user: User, taskId: string) => {
  const loaded = await loadTask(taskId);
  return !!loaded && canManagePublish(await loadViewer(user), loaded.facts);
};
const managesPublish = async (user: User, publishId: string) => {
  const found = await findPublish(publishId);
  return !!found && canManagePublish(await loadViewer(user), found.loaded.facts);
};

const planPipeline = createAction({
  name: "work.publish.plan",
  input: z.object({ taskId: z.uuid(), ...planFields }),
  authorize: (user, input) => managesTask(user, input.taskId),
  run: async ({ user, input }) => {
    const publish = await planPublish(input.taskId, { platform: input.platform, page: input.page, plannedAt: input.plannedAt ? fromVietnamLocal(input.plannedAt) : null }, actorOf(user));
    const loaded = (await loadTask(input.taskId))!;
    refreshTask(input.taskId, loaded.work.projectId);
    revalidatePath("/work/calendar");
    return { data: { id: publish.id }, audit: { resource: auditTask(loaded), summary: `${loaded.task.title}: ${publish.platform}`, after: publish } };
  },
});
export async function planPublishAction(input: unknown) {
  return planPipeline(input);
}

const replanPipeline = createAction({
  name: "work.publish.replan",
  input: z.object({ publishId: z.uuid(), ...planFields }),
  authorize: (user, input) => managesPublish(user, input.publishId),
  run: async ({ user, input }) => {
    const { before, after } = await updatePublishPlan(input.publishId, { platform: input.platform, page: input.page, plannedAt: input.plannedAt ? fromVietnamLocal(input.plannedAt) : null }, actorOf(user));
    const loaded = (await loadTask(after.taskId))!;
    refreshTask(after.taskId, loaded.work.projectId);
    revalidatePath("/work/calendar");
    return { data: { id: after.id }, audit: { resource: auditTask(loaded), summary: `${loaded.task.title}: ${after.platform}`, before, after } };
  },
});
export async function updatePublishPlanAction(input: unknown) {
  return replanPipeline(input);
}

const publishedPipeline = createAction({
  name: "work.publish.published",
  input: z.object({ publishId: z.uuid(), url: https, publishedAt: optional(localDateTime), boosted: checkbox.default(false), adAccount: optional(z.string().trim().max(120)) }),
  authorize: (user, input) => managesPublish(user, input.publishId),
  run: async ({ user, input }) => {
    const { before, after } = await markPublished(input.publishId, { url: input.url, publishedAt: (input.publishedAt ? fromVietnamLocal(input.publishedAt) : null) ?? new Date(), boosted: input.boosted, adAccount: input.adAccount }, actorOf(user));
    const loaded = (await loadTask(after.taskId))!;
    refreshTask(after.taskId, loaded.work.projectId);
    revalidatePath("/work/calendar");
    return { data: { id: after.id }, audit: { resource: auditTask(loaded), summary: `${loaded.task.title}: ${after.url}`, before, after } };
  },
});
export async function markPublishedAction(input: unknown) {
  return publishedPipeline(input);
}

const cancelPipeline = createAction({
  name: "work.publish.cancel",
  input: z.object({ publishId: z.uuid() }),
  authorize: (user, input) => managesPublish(user, input.publishId),
  run: async ({ user, input }) => {
    const after = await cancelPublish(input.publishId, actorOf(user));
    const loaded = (await loadTask(after.taskId))!;
    refreshTask(after.taskId, loaded.work.projectId);
    revalidatePath("/work/calendar");
    return { data: { id: after.id }, audit: { resource: auditTask(loaded), summary: `${loaded.task.title}: ${after.platform} cancelled`, after } };
  },
});
export async function cancelPublishAction(input: unknown) {
  return cancelPipeline(input);
}

const figure = optional(z.coerce.number().int().min(0).max(Number.MAX_SAFE_INTEGER));
const resultPipeline = createAction({
  name: "work.publish.result",
  input: z.object({ publishId: z.uuid(), recordedOn: z.iso.date(), reach: figure, views: figure, engagement: figure, clicks: figure, spendVnd: figure }),
  authorize: (user, input) => managesPublish(user, input.publishId),
  run: async ({ user, input }) => {
    const { publishId, ...values } = input;
    const result = await recordResult(publishId, values, actorOf(user));
    const { loaded } = (await findPublish(publishId))!;
    refreshTask(loaded.task.id);
    return { data: { id: result.id }, audit: { resource: auditTask(loaded), summary: `${loaded.task.title}: results ${input.recordedOn}`, after: result } };
  },
});
export async function recordResultAction(input: unknown) {
  return resultPipeline(input);
}

const removeResultPipeline = createAction({
  name: "work.publish.result.remove",
  input: z.object({ resultId: z.uuid() }),
  authorize: async (user, input) => {
    const found = await findResult(input.resultId);
    return !!found && canManagePublish(await loadViewer(user), found.loaded.facts);
  },
  run: async ({ input }) => {
    const { loaded } = (await findResult(input.resultId))!;
    const result = await removeResult(input.resultId);
    refreshTask(loaded.task.id);
    return { data: { id: result.id }, audit: { resource: auditTask(loaded), summary: `${loaded.task.title}: results ${result.recordedOn} removed`, before: result } };
  },
});
export async function removeResultAction(input: unknown) {
  return removeResultPipeline(input);
}

export async function stageResultsImportAction(input: unknown) {
  return resultImport.stage(input);
}
export async function commitResultsImportAction(input: unknown) {
  return resultImport.commit(input);
}
