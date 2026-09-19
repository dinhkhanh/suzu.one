"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createAction } from "@/lib/action";
import { todayInVietnam } from "@/lib/dates";
import type { DueRule } from "./engine/due-rule";
import { AUTHORITIES, EVENT_TYPES, OBLIGATION_CATEGORIES, RECURRENCES, SHIFTS } from "./enums";
import { beginEvidenceUpload, cancelInstance, completeEvidenceUpload, completeInstance, evidenceFileLink, findEvidenceFile, loadInstance, reassignInstance, removeEvidenceFile, reopenInstance, saveProgress } from "./instances";
import { canManageInstance, canManageLibrary, canManageOps, canViewInstance, canWorkInstance } from "./policy";
import { generateInstances } from "./scheduler";
import { saveTemplate, setReviewStatus } from "./templates";

const blankToNull = (value: unknown) => (typeof value === "string" && value.trim() === "" ? null : value);
const optional = <Schema extends z.ZodType>(schema: Schema) => z.preprocess(blankToNull, schema.nullable().default(null));
const checkbox = z.preprocess((value) => value === "on" || value === true, z.boolean());
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const lines = (value: string | null) => (value ?? "").split("\n").map((line) => line.trim()).filter(Boolean);

const auditInstance = (taskId: string, entityId: string) => ({ type: "task:obligation", id: taskId, entityId });
function refresh(taskId: string) {
  revalidatePath("/ops");
  revalidatePath(`/ops/obligations/${taskId}`);
  revalidatePath("/tasks");
}

// ── The library ─────────────────────────────────────────────────────────────────────────────

const party = z.enum(["permission", "role", "person", "none"]);
const partyRule = (kind: z.infer<typeof party>, value: string | null) => (kind === "permission" || kind === "role" ? `${kind}:${value ?? ""}` : kind);

const templatePipeline = createAction({
  name: "ops.template.save",
  input: z.object({
    templateId: optional(z.uuid()),
    code: z.string().trim().toUpperCase().regex(/^[A-Z0-9][A-Z0-9-]{1,39}$/),
    name: z.string().trim().min(1).max(200),
    category: z.enum(OBLIGATION_CATEGORIES),
    authority: z.enum(AUTHORITIES),
    recurrence: z.enum(RECURRENCES),
    ruleType: z.enum(["after_period", "in_period", "after_event"]),
    monthsAfter: z.coerce.number().int().default(1),
    month: z.coerce.number().int().default(1),
    day: z.preprocess(blankToNull, z.union([z.literal("last"), z.coerce.number().int()]).nullable().default(null)),
    days: z.coerce.number().int().default(0),
    shift: z.enum(SHIFTS),
    eventType: optional(z.enum(EVENT_TYPES)),
    entityIds: z.array(z.uuid()).max(50).default([]),
    ownerKind: party,
    ownerValue: optional(z.string().trim().max(60)),
    ownerPersonId: optional(z.uuid()),
    reviewerKind: party,
    reviewerValue: optional(z.string().trim().max(60)),
    reviewerPersonId: optional(z.uuid()),
    checklist: optional(z.string().max(4000)),
    guidance: optional(z.string().trim().max(4000)),
    // One per line: "Title | https://…".
    links: optional(z.string().max(4000)),
    reminderLeadDays: optional(z.string().trim().regex(/^\d{1,3}(\s*,\s*\d{1,3})*$/)),
    managerAfterDays: z.coerce.number().int().min(0).max(90).default(3),
    executiveAfterDays: z.coerce.number().int().min(0).max(180).default(7),
    evidence: z.object({ file: checkbox, reference: checkbox, submittedDate: checkbox, amount: checkbox }).default({ file: false, reference: false, submittedDate: false, amount: false }),
    penaltyNote: optional(z.string().trim().max(1000)),
    isActive: checkbox,
    // "I have checked this against the rules": the save itself is the review.
    markReviewed: checkbox,
  }),
  authorize: (user) => canManageLibrary(user.principal),
  run: async ({ user, input }) => {
    const dueRule: DueRule = input.ruleType === "after_event" ? { type: "after_event", days: input.days } : input.ruleType === "after_period" ? { type: "after_period", monthsAfter: input.monthsAfter, day: input.day ?? 0 } : { type: "in_period", month: input.month, day: input.day ?? 0 };
    const { before, after } = await saveTemplate(input.templateId, {
      code: input.code,
      name: input.name,
      category: input.category,
      authority: input.authority,
      recurrence: input.recurrence,
      dueRule,
      shift: input.shift,
      eventType: input.recurrence === "event" ? input.eventType : null,
      entityIds: input.entityIds,
      ownerRule: partyRule(input.ownerKind, input.ownerValue),
      ownerPersonId: input.ownerPersonId,
      reviewerRule: partyRule(input.reviewerKind, input.reviewerValue),
      reviewerPersonId: input.reviewerPersonId,
      checklist: lines(input.checklist),
      guidance: input.guidance,
      links: lines(input.links).map((line) => {
        const [title, url] = line.includes("|") ? line.split("|").map((part) => part.trim()) : [line, line];
        return { title: title || url, url };
      }),
      reminderLeadDays: input.reminderLeadDays ? input.reminderLeadDays.split(",").map((part) => Number(part.trim())) : [],
      escalation: { managerAfterDays: input.managerAfterDays, executiveAfterDays: input.executiveAfterDays },
      evidence: input.evidence,
      penaltyNote: input.penaltyNote,
      isActive: input.isActive,
    });
    const final = input.markReviewed ? (await setReviewStatus(after.id, true, user.person.id)).after : after;
    revalidatePath("/ops/templates");
    revalidatePath("/ops");
    return { data: { id: final.id }, audit: { resource: { type: "obligation_template", id: final.id }, summary: `${final.code}: ${final.name}`, before, after: final } };
  },
});
export async function saveObligationTemplateAction(input: unknown) {
  return templatePipeline(input);
}

const reviewPipeline = createAction({
  name: "ops.template.review",
  input: z.object({ templateId: z.uuid(), reviewed: z.boolean() }),
  authorize: (user) => canManageLibrary(user.principal),
  run: async ({ user, input }) => {
    const { before, after } = await setReviewStatus(input.templateId, input.reviewed, user.person.id);
    revalidatePath("/ops/templates");
    revalidatePath("/ops");
    return { data: { id: after.id }, audit: { resource: { type: "obligation_template", id: after.id }, summary: `${after.code}: ${before.reviewStatus} → ${after.reviewStatus}`, before: { reviewStatus: before.reviewStatus }, after: { reviewStatus: after.reviewStatus } } };
  },
});
export async function reviewObligationTemplateAction(input: unknown) {
  return reviewPipeline(input);
}

const syncPipeline = createAction({
  name: "ops.sync",
  input: z.object({}),
  // Generation covers every entity, so an entity-scoped manager may start it too: it only ever creates what the library says.
  authorize: (user) => canManageOps(user.principal),
  run: async ({ user }) => {
    const result = await generateInstances(todayInVietnam(), { actorId: user.person.id });
    revalidatePath("/ops");
    revalidatePath("/tasks");
    return { data: result, audit: { resource: { type: "obligation_instance" }, summary: JSON.stringify(result), after: result } };
  },
});
export async function syncObligationsAction(input: unknown) {
  return syncPipeline(input);
}

// ── One instance ────────────────────────────────────────────────────────────────────────────

const progressPipeline = createAction({
  name: "ops.obligation.save",
  input: z.object({
    taskId: z.uuid(),
    referenceNumber: optional(z.string().trim().max(120)),
    submittedDate: optional(isoDate),
    // Integer VND. "1.250.000" and "1,250,000" are what people type.
    amountPaid: z.preprocess((value) => (typeof value === "string" ? (value.trim() === "" ? null : Number(value.replace(/[.,\s]/g, ""))) : value), z.number().int().min(0).max(1_000_000_000_000).nullable().default(null)),
    note: optional(z.string().trim().max(2000)),
    checklist: z.record(z.string().regex(/^\d{1,2}$/), checkbox).default({}),
  }),
  authorize: async (user, input) => {
    const loaded = await loadInstance(input.taskId);
    return !!loaded && canWorkInstance(user.principal, loaded.parties);
  },
  run: async ({ input }) => {
    const { taskId, checklist, ...evidence } = input;
    const { before, after } = await saveProgress(taskId, { ...evidence, checklistState: checklist });
    refresh(taskId);
    return { data: { id: taskId }, audit: { resource: auditInstance(taskId, after.entityId), summary: after.periodKey, before, after: { referenceNumber: after.referenceNumber, submittedDate: after.submittedDate, amountPaid: after.amountPaid, note: after.note, checklistState: after.checklistState } } };
  },
});
export async function saveObligationProgressAction(input: unknown) {
  return progressPipeline(input);
}

const completePipeline = createAction({
  name: "ops.obligation.complete",
  input: z.object({ taskId: z.uuid() }),
  authorize: async (user, input) => {
    const loaded = await loadInstance(input.taskId);
    return !!loaded && canWorkInstance(user.principal, loaded.parties);
  },
  run: async ({ user, input }) => {
    const { loaded, completedLate } = await completeInstance(input.taskId, user.person.id);
    refresh(input.taskId);
    return { data: { completedLate }, audit: { resource: auditInstance(input.taskId, loaded.instance.entityId), summary: `${loaded.task.title}: ${loaded.task.status} → done${completedLate ? " (late)" : ""}`, before: { status: loaded.task.status }, after: { status: "done", completedLate, referenceNumber: loaded.instance.referenceNumber, submittedDate: loaded.instance.submittedDate, amountPaid: loaded.instance.amountPaid } } };
  },
});
export async function completeObligationAction(input: unknown) {
  return completePipeline(input);
}

const reasonInput = z.object({ taskId: z.uuid(), reason: z.string().trim().min(3).max(1000) });
const manageInstance = async (user: { principal: Parameters<typeof canManageInstance>[0] }, input: { taskId: string }) => {
  const loaded = await loadInstance(input.taskId);
  return !!loaded && canManageInstance(user.principal, loaded.parties);
};

const reopenPipeline = createAction({
  name: "ops.obligation.reopen",
  input: reasonInput,
  authorize: manageInstance,
  run: async ({ input }) => {
    const loaded = await reopenInstance(input.taskId, input.reason);
    refresh(input.taskId);
    return { data: { id: input.taskId }, audit: { resource: auditInstance(input.taskId, loaded.instance.entityId), summary: `${loaded.task.title}: ${input.reason}`, before: { status: loaded.task.status, completedLate: loaded.instance.completedLate }, after: { status: "in_progress", reason: input.reason } } };
  },
});
export async function reopenObligationAction(input: unknown) {
  return reopenPipeline(input);
}

const cancelPipeline = createAction({
  name: "ops.obligation.cancel",
  input: reasonInput,
  authorize: manageInstance,
  run: async ({ input }) => {
    const loaded = await cancelInstance(input.taskId, input.reason);
    refresh(input.taskId);
    return { data: { id: input.taskId }, audit: { resource: auditInstance(input.taskId, loaded.instance.entityId), summary: `${loaded.task.title}: ${input.reason}`, before: { status: loaded.task.status }, after: { status: "cancelled", reason: input.reason } } };
  },
});
export async function cancelObligationAction(input: unknown) {
  return cancelPipeline(input);
}

const reassignPipeline = createAction({
  name: "ops.obligation.reassign",
  input: z.object({ taskId: z.uuid(), assigneePersonId: optional(z.uuid()), reviewerPersonId: optional(z.uuid()) }),
  authorize: manageInstance,
  run: async ({ user, input }) => {
    const { before, after } = await reassignInstance(input.taskId, { assigneePersonId: input.assigneePersonId, reviewerPersonId: input.reviewerPersonId }, user.person.id);
    refresh(input.taskId);
    return { data: { id: input.taskId }, audit: { resource: auditInstance(input.taskId, after.entityId), summary: "reassign", before, after } };
  },
});
export async function reassignObligationAction(input: unknown) {
  return reassignPipeline(input);
}

// ── Evidence files ──────────────────────────────────────────────────────────────────────────

const actorOf = (user: { person: { id: string }; email: string }) => ({ personId: user.person.id, email: user.email });
const isOpen = (status: string) => status === "todo" || status === "in_progress";

const beginUploadPipeline = createAction({
  name: "ops.obligation.file.begin",
  input: z.object({ taskId: z.uuid(), fileName: z.string().min(1).max(255), sizeBytes: z.number().int().positive() }),
  authorize: async (user, input) => {
    const loaded = await loadInstance(input.taskId);
    return !!loaded && isOpen(loaded.task.status) && canWorkInstance(user.principal, loaded.parties);
  },
  run: async ({ user, input }) => {
    const loaded = (await loadInstance(input.taskId))!;
    const upload = await beginEvidenceUpload(loaded, input, actorOf(user));
    return { data: upload, audit: { resource: auditInstance(input.taskId, loaded.instance.entityId), summary: input.fileName, after: { fileId: upload.fileId, fileName: input.fileName, sizeBytes: input.sizeBytes } } };
  },
});
export async function beginEvidenceUploadAction(input: unknown) {
  return beginUploadPipeline(input);
}

const completeUploadPipeline = createAction({
  name: "ops.obligation.file.add",
  input: z.object({ fileId: z.uuid() }),
  authorize: async (user, input) => {
    const found = await findEvidenceFile(input.fileId, { pending: true });
    return !!found && found.file.uploadedByPersonId === user.person.id && isOpen(found.loaded.task.status) && canWorkInstance(user.principal, found.loaded.parties);
  },
  run: async ({ user, input }) => {
    const found = (await findEvidenceFile(input.fileId, { pending: true }))!;
    const file = await completeEvidenceUpload(input.fileId, actorOf(user));
    refresh(found.loaded.task.id);
    return { data: { id: file.id }, audit: { resource: auditInstance(found.loaded.task.id, file.entityId ?? found.loaded.instance.entityId), summary: file.fileName, after: { fileId: file.id, fileName: file.fileName, sizeBytes: file.sizeBytes } } };
  },
});
export async function completeEvidenceUploadAction(input: unknown) {
  return completeUploadPipeline(input);
}

const openFilePipeline = createAction({
  name: "ops.obligation.file.open",
  input: z.object({ fileId: z.uuid() }),
  authorize: async (user, input) => {
    const found = await findEvidenceFile(input.fileId);
    return !!found && canViewInstance(user.principal, found.loaded.parties);
  },
  run: async ({ user, input }) => {
    const { file, loaded } = (await findEvidenceFile(input.fileId))!;
    const url = await evidenceFileLink(file, actorOf(user), user.request);
    return { data: { url }, audit: { resource: auditInstance(loaded.task.id, loaded.instance.entityId), summary: file.fileName } };
  },
});
export async function openEvidenceFileAction(input: unknown) {
  return openFilePipeline(input);
}

const removeFilePipeline = createAction({
  name: "ops.obligation.file.remove",
  input: z.object({ fileId: z.uuid() }),
  authorize: async (user, input) => {
    const found = await findEvidenceFile(input.fileId);
    if (!found) return false;
    return (found.file.uploadedByPersonId === user.person.id && canWorkInstance(user.principal, found.loaded.parties)) || canManageInstance(user.principal, found.loaded.parties);
  },
  run: async ({ input }) => {
    const found = (await findEvidenceFile(input.fileId))!;
    const file = await removeEvidenceFile(input.fileId);
    refresh(found.loaded.task.id);
    return { data: { id: file.id }, audit: { resource: auditInstance(found.loaded.task.id, found.loaded.instance.entityId), summary: file.fileName, before: { fileId: file.id, fileName: file.fileName } } };
  },
});
export async function removeEvidenceFileAction(input: unknown) {
  return removeFilePipeline(input);
}
