// Obligation instances: reading them, working through them and closing them with evidence
// (FR-OPS-05). The `task` row carries status, owner and due date (so the instance shows in My work
// like any other task); everything the ops tracker adds is on `obligation_instance`.
import "server-only";
import { and, asc, desc, eq, gte, inArray, isNull, lte, or, type SQL, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { ActionError } from "@/lib/action";
import { type IsoDate, todayInVietnam } from "@/lib/dates";
import { db, schema, type Tx } from "@/lib/db";
import { beginUpload, completeUpload, createDownloadLink, findFile, listFilesOf, softDeleteFile, type StoredFileRow } from "../platform/files/service";
import { notify } from "../platform/notifications/service";
import type { Principal } from "../platform/rbac/policy";
import { escalationLevel } from "./engine/escalation";
import { isCompletedLate, missingEvidence, statusColour } from "./engine/status";
import { type ChecklistState, type EvidenceKey, OBLIGATION_FILE_OWNER, OBLIGATION_KIND, type StatusColour } from "./enums";
import { type InstanceParties, opsReach } from "./policy";
import { sentKeysOf } from "./reminders";
import type { ObligationTemplateRow } from "./templates";

type Executor = Tx | ReturnType<typeof db>;
type Actor = { personId: string; email?: string | null };
export type ObligationInstanceRow = typeof schema.obligationInstance.$inferSelect;
type TaskRow = typeof schema.task.$inferSelect;

export type LoadedInstance = { instance: ObligationInstanceRow; task: TaskRow; template: ObligationTemplateRow; parties: InstanceParties };

/** By the task id — the id My work links with. */
export async function loadInstance(taskId: string, executor: Executor = db()): Promise<LoadedInstance | undefined> {
  const [row] = await executor
    .select({ instance: schema.obligationInstance, task: schema.task, template: schema.obligationTemplate })
    .from(schema.obligationInstance)
    .innerJoin(schema.task, eq(schema.task.id, schema.obligationInstance.taskId))
    .innerJoin(schema.obligationTemplate, eq(schema.obligationTemplate.id, schema.obligationInstance.templateId))
    .where(and(eq(schema.obligationInstance.taskId, taskId), eq(schema.task.kind, OBLIGATION_KIND), isNull(schema.task.deletedAt)))
    .limit(1);
  return row ? { ...row, parties: { entityId: row.instance.entityId, assigneePersonId: row.task.assigneePersonId, reviewerPersonId: row.instance.reviewerPersonId } } : undefined;
}

// ── Lists ───────────────────────────────────────────────────────────────────────────────────

export type InstanceListItem = {
  taskId: string;
  title: string;
  templateId: string;
  templateCode: string;
  templateName: string;
  category: string;
  authority: string;
  unreviewed: boolean;
  entityId: string;
  entityCode: string;
  periodKey: string;
  dueDate: IsoDate | null;
  nominalDueDate: IsoDate;
  status: TaskRow["status"];
  colour: StatusColour;
  assigneePersonId: string | null;
  assigneeName: string | null;
  subjectName: string | null;
  completedAt: Date | null;
  completedLate: boolean | null;
  completedByName: string | null;
  referenceNumber: string | null;
  submittedDate: IsoDate | null;
  amountPaid: number | null;
  /** 0 = nobody above the owner was told, 1 = the manager, 2 = the executives (FR-OPS-08). */
  escalationLevel: 0 | 1 | 2;
  instanceId: string;
};

export type InstanceFilter = { open?: boolean; entityId?: string | null; dueFrom?: IsoDate; dueTo?: IsoDate; templateId?: string; authority?: string | null; category?: string | null; ownerId?: string | null; limit?: number };

/** The SQL list form of `canViewInstance`: the entities the viewer reads, plus what is theirs to do or review. */
function visibleTo(viewer: { principal: Principal; personId: string }): SQL | undefined {
  const reach = opsReach(viewer.principal);
  if (reach.all) return undefined;
  return or(reach.entityIds.length ? inArray(schema.obligationInstance.entityId, reach.entityIds) : undefined, eq(schema.task.assigneePersonId, viewer.personId), eq(schema.obligationInstance.reviewerPersonId, viewer.personId));
}

export async function listInstances(viewer: { principal: Principal; personId: string }, filter: InstanceFilter = {}, today: IsoDate = todayInVietnam()): Promise<InstanceListItem[]> {
  const assignee = alias(schema.person, "assignee");
  const subject = alias(schema.person, "subject");
  const completer = alias(schema.person, "completer");
  const rows = await db()
    .select({ instance: schema.obligationInstance, task: schema.task, template: schema.obligationTemplate, entityCode: schema.entity.code, assigneeName: assignee.fullName, subjectName: subject.fullName, completedByName: completer.fullName })
    .from(schema.obligationInstance)
    .innerJoin(schema.task, eq(schema.task.id, schema.obligationInstance.taskId))
    .innerJoin(schema.obligationTemplate, eq(schema.obligationTemplate.id, schema.obligationInstance.templateId))
    .innerJoin(schema.entity, eq(schema.entity.id, schema.obligationInstance.entityId))
    .leftJoin(assignee, eq(assignee.id, schema.task.assigneePersonId))
    .leftJoin(subject, eq(subject.id, schema.task.subjectPersonId))
    .leftJoin(completer, eq(completer.id, schema.task.completedByPersonId))
    .where(
      and(
        isNull(schema.task.deletedAt),
        visibleTo(viewer),
        filter.open === undefined ? undefined : filter.open ? inArray(schema.task.status, ["todo", "in_progress"]) : inArray(schema.task.status, ["done", "cancelled"]),
        filter.entityId ? eq(schema.obligationInstance.entityId, filter.entityId) : undefined,
        filter.templateId ? eq(schema.obligationInstance.templateId, filter.templateId) : undefined,
        filter.authority ? eq(schema.obligationTemplate.authority, filter.authority) : undefined,
        filter.category ? eq(schema.obligationTemplate.category, filter.category) : undefined,
        filter.ownerId ? eq(schema.task.assigneePersonId, filter.ownerId) : undefined,
        filter.dueFrom ? gte(schema.task.dueDate, filter.dueFrom) : undefined,
        filter.dueTo ? lte(schema.task.dueDate, filter.dueTo) : undefined,
      ),
    )
    .orderBy(filter.open === false ? desc(schema.task.dueDate) : sql`${schema.task.dueDate} asc nulls last`, asc(schema.entity.code), asc(schema.obligationTemplate.sortOrder))
    .limit(filter.limit ?? 500);
  const sentKeys = await sentKeysOf(rows.filter((row) => row.task.status === "todo" || row.task.status === "in_progress").map((row) => row.instance.id));
  return rows.map(({ instance, task, template, entityCode, assigneeName, subjectName, completedByName }) => ({
    taskId: task.id,
    title: task.title,
    templateId: template.id,
    templateCode: template.code,
    templateName: template.name,
    category: template.category,
    authority: template.authority,
    unreviewed: template.reviewStatus !== "reviewed",
    entityId: instance.entityId,
    entityCode,
    periodKey: instance.periodKey,
    dueDate: task.dueDate,
    nominalDueDate: instance.nominalDueDate,
    status: task.status,
    colour: statusColour({ status: task.status, dueDate: task.dueDate, completedLate: instance.completedLate }, today),
    assigneePersonId: task.assigneePersonId,
    assigneeName,
    subjectName,
    completedAt: task.completedAt,
    completedLate: instance.completedLate,
    completedByName,
    referenceNumber: instance.referenceNumber,
    submittedDate: instance.submittedDate,
    amountPaid: instance.amountPaid,
    escalationLevel: escalationLevel(sentKeys.get(instance.id) ?? []),
    instanceId: instance.id,
  }));
}

// ── Working on one ──────────────────────────────────────────────────────────────────────────

export type EvidenceInput = { referenceNumber: string | null; submittedDate: IsoDate | null; amountPaid: number | null; note: string | null; checklistState: ChecklistState };

const evidenceOf = (instance: ObligationInstanceRow) => ({ referenceNumber: instance.referenceNumber, submittedDate: instance.submittedDate, amountPaid: instance.amountPaid, note: instance.note, checklistState: instance.checklistState });

function requireOpen(loaded: LoadedInstance): void {
  if (loaded.task.status === "done" || loaded.task.status === "cancelled") throw new ActionError("obligation_closed");
}

/** Saving is not closing: the owner records the receipt as it arrives and ticks steps along the way. Moves an untouched instance to "in progress". */
export async function saveProgress(taskId: string, input: EvidenceInput, today: IsoDate = todayInVietnam()): Promise<{ before: ReturnType<typeof evidenceOf>; after: ObligationInstanceRow }> {
  return db().transaction(async (tx) => {
    const loaded = await loadInstance(taskId, tx);
    if (!loaded) throw new ActionError("obligation_not_found");
    requireOpen(loaded);
    if (input.submittedDate && input.submittedDate > today) throw new ActionError("obligation_submitted_in_future");
    // Only the template's own steps: a stale form cannot invent one.
    const checklistState = Object.fromEntries(loaded.template.checklist.map((_, index) => [String(index), !!input.checklistState[String(index)]]));
    const [after] = await tx.update(schema.obligationInstance).set({ referenceNumber: input.referenceNumber, submittedDate: input.submittedDate, amountPaid: input.amountPaid, note: input.note, checklistState, updatedAt: new Date() }).where(eq(schema.obligationInstance.id, loaded.instance.id)).returning();
    if (loaded.task.status === "todo") await tx.update(schema.task).set({ status: "in_progress", updatedAt: new Date() }).where(eq(schema.task.id, taskId));
    return { before: evidenceOf(loaded.instance), after };
  });
}

export type Missing = { evidence: EvidenceKey[]; checklist: number[] };

/** What stands between the instance and "done" (FR-OPS-05): required evidence and unticked steps. */
export async function whatIsMissing(loaded: LoadedInstance): Promise<Missing> {
  const files = await listFilesOf(OBLIGATION_FILE_OWNER, loaded.instance.id);
  return {
    evidence: missingEvidence(loaded.template.evidence, { files: files.length, referenceNumber: loaded.instance.referenceNumber, submittedDate: loaded.instance.submittedDate, amountPaid: loaded.instance.amountPaid }),
    checklist: loaded.template.checklist.map((_, index) => index).filter((index) => !loaded.instance.checklistState[String(index)]),
  };
}

export async function completeInstance(taskId: string, actorPersonId: string, today: IsoDate = todayInVietnam()): Promise<{ loaded: LoadedInstance; completedLate: boolean }> {
  const loaded = await loadInstance(taskId);
  if (!loaded) throw new ActionError("obligation_not_found");
  requireOpen(loaded);
  // Files are counted outside the transaction (the files module reads through db()).
  const missing = await whatIsMissing(loaded);
  if (missing.evidence.length || missing.checklist.length) throw new ActionError("obligation_evidence_missing", missing);
  const completedLate = isCompletedLate(loaded.task.dueDate, today, loaded.instance.submittedDate);
  await db().transaction(async (tx) => {
    const [moved] = await tx.update(schema.task).set({ status: "done", completedAt: new Date(), completedByPersonId: actorPersonId, updatedAt: new Date() }).where(and(eq(schema.task.id, taskId), inArray(schema.task.status, ["todo", "in_progress"]))).returning({ id: schema.task.id });
    if (!moved) throw new ActionError("obligation_closed");
    await tx.update(schema.obligationInstance).set({ completedLate, updatedAt: new Date() }).where(eq(schema.obligationInstance.id, loaded.instance.id));
  });
  return { loaded, completedLate };
}

export async function reopenInstance(taskId: string, reason: string): Promise<LoadedInstance> {
  return db().transaction(async (tx) => {
    const loaded = await loadInstance(taskId, tx);
    if (!loaded) throw new ActionError("obligation_not_found");
    if (loaded.task.status !== "done" && loaded.task.status !== "cancelled") throw new ActionError("obligation_not_closed");
    await tx.update(schema.task).set({ status: "in_progress", completedAt: null, completedByPersonId: null, updatedAt: new Date() }).where(eq(schema.task.id, taskId));
    await tx.update(schema.obligationInstance).set({ completedLate: null, reopenReason: reason, updatedAt: new Date() }).where(eq(schema.obligationInstance.id, loaded.instance.id));
    return loaded;
  });
}

/** "This will not happen" (the entity has no foreign employees this year): cancelled with the reason kept, never deleted. */
export async function cancelInstance(taskId: string, reason: string): Promise<LoadedInstance> {
  return db().transaction(async (tx) => {
    const loaded = await loadInstance(taskId, tx);
    if (!loaded) throw new ActionError("obligation_not_found");
    requireOpen(loaded);
    await tx.update(schema.task).set({ status: "cancelled", updatedAt: new Date() }).where(eq(schema.task.id, taskId));
    await tx.update(schema.obligationInstance).set({ note: [loaded.instance.note, reason].filter(Boolean).join("\n"), updatedAt: new Date() }).where(eq(schema.obligationInstance.id, loaded.instance.id));
    return loaded;
  });
}

export async function reassignInstance(taskId: string, input: { assigneePersonId: string | null; reviewerPersonId: string | null }, actorPersonId: string): Promise<{ before: InstanceParties; after: InstanceParties }> {
  return db().transaction(async (tx) => {
    const loaded = await loadInstance(taskId, tx);
    if (!loaded) throw new ActionError("obligation_not_found");
    requireOpen(loaded);
    const ids = [input.assigneePersonId, input.reviewerPersonId].filter((id): id is string => !!id);
    const people = ids.length ? await tx.select({ id: schema.person.id, status: schema.person.status }).from(schema.person).where(inArray(schema.person.id, ids)) : [];
    if (ids.some((id) => !people.some((person) => person.id === id && person.status !== "offboarded"))) throw new ActionError("obligation_person_not_found");
    if (input.assigneePersonId && input.assigneePersonId === input.reviewerPersonId) throw new ActionError("obligation_reviewer_is_owner");
    await tx.update(schema.task).set({ assigneePersonId: input.assigneePersonId, updatedAt: new Date() }).where(eq(schema.task.id, taskId));
    await tx.update(schema.obligationInstance).set({ reviewerPersonId: input.reviewerPersonId, updatedAt: new Date() }).where(eq(schema.obligationInstance.id, loaded.instance.id));
    if (input.assigneePersonId && input.assigneePersonId !== loaded.task.assigneePersonId && input.assigneePersonId !== actorPersonId) {
      await notify({ recipients: [input.assigneePersonId], kind: "ops.assigned", params: { count: 1, title: loaded.task.title }, link: `/ops/obligations/${taskId}` }, tx);
    }
    return { before: loaded.parties, after: { ...loaded.parties, ...input } };
  });
}

// ── Evidence files (platform files module; signed-URL upload) ───────────────────────────────

export const listEvidenceFiles = (instanceId: string) => listFilesOf(OBLIGATION_FILE_OWNER, instanceId);

/** Receipts and filed returns are company papers, not personal data: the ops policy, not a sensitivity tier, decides who opens them. */
export const beginEvidenceUpload = (loaded: LoadedInstance, file: { fileName: string; sizeBytes: number }, actor: Actor) => beginUpload({ ownerType: OBLIGATION_FILE_OWNER, ownerId: loaded.instance.id, entityId: loaded.instance.entityId, tier: "public_internal" }, file, actor);

export async function findEvidenceFile(fileId: string, options: { pending?: boolean } = {}): Promise<{ file: StoredFileRow; loaded: LoadedInstance } | undefined> {
  const file = options.pending ? (await db().select().from(schema.storedFile).where(and(eq(schema.storedFile.id, fileId), eq(schema.storedFile.status, "pending"))).limit(1))[0] : await findFile(fileId);
  if (!file || file.ownerType !== OBLIGATION_FILE_OWNER) return undefined;
  const [instance] = await db().select({ taskId: schema.obligationInstance.taskId }).from(schema.obligationInstance).where(eq(schema.obligationInstance.id, file.ownerId)).limit(1);
  const loaded = instance ? await loadInstance(instance.taskId) : undefined;
  return loaded ? { file, loaded } : undefined;
}

export const completeEvidenceUpload = (fileId: string, actor: Actor) => completeUpload(fileId, actor);
export const evidenceFileLink = (file: StoredFileRow, actor: Actor, request?: { ipAddress?: string | null; userAgent?: string | null }) => createDownloadLink(file, actor, request);

/** Evidence of a closed instance is the inspection trail: it cannot be removed until someone with authority reopens it. */
export async function removeEvidenceFile(fileId: string): Promise<StoredFileRow> {
  const found = await findEvidenceFile(fileId);
  if (!found) throw new ActionError("file_not_found");
  requireOpen(found.loaded);
  const file = await softDeleteFile(fileId);
  if (!file) throw new ActionError("file_not_found");
  return file;
}
