"use server";
// Collaboration on a project (FR-PJM-29..31): the RAID log, meeting notes and the document space.
// Each action re-checks the project against the viewer — including whether it is closed — and an
// item or a meeting against the project it belongs to, never trusting the ids the browser sends.
import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { ActionError, createAction } from "@/lib/action";
import { db, schema } from "@/lib/db";
import type { CurrentUser } from "../platform/auth/session";
import { beginUpload, completeUpload, createDownloadLink, findFile } from "../platform/files/service";
import type { WorkViewer } from "../work/policy";
import { ensureProjectSpace } from "./documents";
import { RAID_KINDS, RAID_SEVERITIES, RAID_STATUSES, RECORDABLE_MEETING_KINDS } from "./engine/raid";
import { idList, isoDate, optional, rows, text } from "./form-inputs";
import { findMeeting, saveMeeting } from "./meetings";
import { canAddRaid, canCloseRaidItem, canCreateProjectSpace, canEditMeeting, canEditRaidItem, canRecordMeeting, canViewRaid, type PlanFacts } from "./policy";
import { findRaidItem, issueToTask, RAID_EVIDENCE, raidWithEvidence, saveRaidItem, setRaidStatus } from "./raid-log";
import { planProjectFor } from "./views";

const may = async (user: CurrentUser, projectId: string | null, rule: (viewer: WorkViewer, facts: PlanFacts) => boolean) => {
  const found = await planProjectFor(user, projectId);
  return !!found && rule(found.viewer, found.facts);
};
const auditProject = (projectId: string, entityId: string | null = null) => ({ type: "work_project", id: projectId, entityId });

function refresh(projectId: string) {
  for (const tab of ["", "/risks", "/meetings", "/documents", "/updates"]) revalidatePath(`/projects/${projectId}${tab}`);
  revalidatePath(`/work/projects/${projectId}`);
  revalidatePath("/projects");
}

// ── The RAID log (FR-PJM-29) ────────────────────────────────────────────────────────────────

const raidPipeline = createAction({
  name: "projects.raid.save",
  input: z.object({
    projectId: z.uuid(),
    itemId: optional(z.uuid()),
    kind: z.enum(RAID_KINDS),
    title: z.string().trim().min(1).max(300),
    description: text(4000),
    ownerPersonId: optional(z.uuid()),
    dueDate: optional(isoDate),
    severity: optional(z.enum(RAID_SEVERITIES)),
    decidedOn: optional(isoDate),
    evidenceUrl: optional(z.url().max(500)),
    evidenceFileId: optional(z.uuid()),
  }),
  authorize: async (user, input) => {
    if (!input.itemId) return may(user, input.projectId, canAddRaid);
    const item = await findRaidItem(input.itemId);
    return !!item && item.projectId === input.projectId && may(user, input.projectId, (viewer, facts) => canEditRaidItem(viewer, facts, item));
  },
  run: async ({ user, input }) => {
    const { projectId, itemId, ...values } = input;
    const { before, after } = await saveRaidItem(projectId, itemId, values, user.person.id);
    refresh(projectId);
    const shape = (row: typeof after) => ({ kind: row.kind, title: row.title, ownerPersonId: row.ownerPersonId, dueDate: row.dueDate, severity: row.severity, status: row.status, decidedOn: row.decidedOn, evidence: row.evidenceFileId ?? row.evidenceUrl });
    return { data: { id: after.id }, audit: { resource: { type: "project_raid_item", id: after.id }, summary: `${after.kind}: ${after.title}`, before: before ? shape(before) : null, after: { projectId, ...shape(after) } } };
  },
});
export async function saveRaidItemAction(input: unknown) {
  return raidPipeline(input);
}

const raidStatusPipeline = createAction({
  name: "projects.raid.status",
  input: z.object({ itemId: z.uuid(), status: z.enum(RAID_STATUSES) }),
  authorize: async (user, input) => {
    const item = await findRaidItem(input.itemId);
    return !!item && may(user, item.projectId, (viewer, facts) => canCloseRaidItem(viewer, facts, item));
  },
  run: async ({ input }) => {
    const { before, after } = await setRaidStatus(input.itemId, input.status);
    refresh(after.projectId);
    return { data: { id: after.id }, audit: { resource: { type: "project_raid_item", id: after.id }, summary: `${after.kind} ${input.status}`, before: { status: before.status }, after: { status: after.status } } };
  },
});
export async function setRaidStatusAction(input: unknown) {
  return raidStatusPipeline(input);
}

const toTaskPipeline = createAction({
  name: "projects.raid.to_task",
  input: z.object({ itemId: z.uuid(), assigneePersonId: optional(z.uuid()), dueDate: optional(isoDate) }),
  // Whoever may add to the log and make tasks in the project: its contributors.
  authorize: async (user, input) => {
    const item = await findRaidItem(input.itemId);
    return !!item && may(user, item.projectId, canAddRaid);
  },
  run: async ({ user, input }) => {
    const { item, taskId, key } = await issueToTask(input.itemId, { assigneePersonId: input.assigneePersonId, dueDate: input.dueDate }, user.person.id);
    refresh(item.projectId);
    revalidatePath(`/work/tasks/${taskId}`);
    return { data: { taskId, key }, audit: { resource: { type: "project_raid_item", id: item.id }, summary: `issue → ${key}`, after: { taskId, projectId: item.projectId } } };
  },
});
export async function issueToTaskAction(input: unknown) {
  return toTaskPipeline(input);
}

/** Only the pending upload this person started a moment ago, for the log. */
async function ownPendingUpload(user: CurrentUser, fileId: string): Promise<boolean> {
  const [row] = await db()
    .select({ id: schema.storedFile.id })
    .from(schema.storedFile)
    .where(and(eq(schema.storedFile.id, fileId), eq(schema.storedFile.ownerType, RAID_EVIDENCE), eq(schema.storedFile.uploadedByPersonId, user.person.id), eq(schema.storedFile.status, "pending")))
    .limit(1);
  return !!row;
}

const beginEvidencePipeline = createAction({
  name: "projects.raid.evidence.begin",
  input: z.object({ projectId: z.uuid(), fileName: z.string().trim().min(1).max(255), sizeBytes: z.number().int().positive() }),
  authorize: (user, input) => may(user, input.projectId, canAddRaid),
  run: async ({ user, input }) => {
    const found = (await planProjectFor(user, input.projectId))!;
    // Uploaded before the item is saved: owned by the project, like a change request's evidence.
    // Evidence of a client decision is correspondence with named people: personal, not public.
    const upload = await beginUpload({ ownerType: RAID_EVIDENCE, ownerId: input.projectId, entityId: found.project.entityId, tier: "personal" }, input, { personId: user.person.id, email: user.email });
    return { data: upload, audit: { resource: { type: "stored_file", id: upload.fileId, entityId: found.project.entityId }, summary: input.fileName } };
  },
});
export async function beginRaidEvidenceAction(input: unknown) {
  return beginEvidencePipeline(input);
}

const completeEvidencePipeline = createAction({
  name: "projects.raid.evidence.complete",
  input: z.object({ fileId: z.uuid() }),
  authorize: (user, input) => ownPendingUpload(user, input.fileId),
  run: async ({ user, input }) => {
    const file = await completeUpload(input.fileId, { personId: user.person.id, email: user.email });
    return { data: { fileId: file.id, fileName: file.fileName }, audit: { resource: { type: "stored_file", id: file.id, entityId: file.entityId }, summary: file.fileName } };
  },
});
export async function completeRaidEvidenceAction(input: unknown) {
  return completeEvidencePipeline(input);
}

const openEvidencePipeline = createAction({
  name: "projects.raid.evidence.open",
  input: z.object({ projectId: z.uuid(), fileId: z.uuid() }),
  // The file opens for whoever may read the project's log — and only as the evidence of one of its items.
  authorize: async (user, input) => (await may(user, input.projectId, canViewRaid)) && !!(await raidWithEvidence(input.projectId, input.fileId)),
  run: async ({ user, input }) => {
    const file = await findFile(input.fileId);
    if (!file || file.ownerType !== RAID_EVIDENCE) throw new ActionError("file_not_found");
    const url = await createDownloadLink(file, { personId: user.person.id, email: user.email }, user.request);
    return { data: { url }, audit: { resource: { type: "stored_file", id: file.id, entityId: file.entityId }, summary: file.fileName } };
  },
});
export async function openRaidEvidenceAction(input: unknown) {
  return openEvidencePipeline(input);
}

// ── Meetings (FR-PJM-30) ────────────────────────────────────────────────────────────────────

const meetingPipeline = createAction({
  name: "projects.meeting.save",
  input: z.object({
    projectId: z.uuid(),
    meetingId: optional(z.uuid()),
    kind: z.enum(RECORDABLE_MEETING_KINDS),
    title: z.string().trim().min(1).max(200),
    heldOn: isoDate,
    attendeeIds: idList,
    externalAttendees: text(1000),
    agenda: text(8000),
    notes: text(20000),
    decisions: rows(z.object({ title: z.string().trim().min(1).max(300), description: text(2000) }), 30).default([]),
    actions: rows(z.object({ title: z.string().trim().min(1).max(300), assigneePersonId: optional(z.uuid()), dueDate: optional(isoDate) }), 30).default([]),
  }),
  authorize: async (user, input) => {
    if (!input.meetingId) return may(user, input.projectId, canRecordMeeting);
    const meeting = await findMeeting(input.meetingId);
    return !!meeting && meeting.projectId === input.projectId && may(user, input.projectId, (viewer, facts) => canEditMeeting(viewer, facts, meeting));
  },
  run: async ({ user, input }) => {
    const { projectId, meetingId, actions, ...fields } = input;
    const { before, after, decisionIds, taskIds } = await saveMeeting(projectId, meetingId, { ...fields, actionItems: actions }, user.person.id);
    refresh(projectId);
    revalidatePath(`/projects/${projectId}/meetings/${after.id}`);
    return {
      data: { id: after.id, decisions: decisionIds.length, tasks: taskIds.length },
      audit: { resource: { type: "project_meeting", id: after.id }, summary: `${after.kind} ${after.heldOn}: ${after.title}`, before: before ? { title: before.title, heldOn: before.heldOn, attendees: before.attendeeIds.length } : null, after: { projectId, title: after.title, heldOn: after.heldOn, attendees: after.attendeeIds.length, decisionIds, taskIds } },
    };
  },
});
export async function saveMeetingAction(input: unknown) {
  return meetingPipeline(input);
}

// ── The document space (FR-PJM-31) ──────────────────────────────────────────────────────────

const spacePipeline = createAction({
  name: "projects.documents.create_space",
  input: z.object({ projectId: z.uuid() }),
  authorize: (user, input) => may(user, input.projectId, canCreateProjectSpace),
  run: async ({ user, input }) => {
    const { spaceId, created, pages } = await ensureProjectSpace(input.projectId, user.person.id);
    refresh(input.projectId);
    revalidatePath("/kb");
    return { data: { spaceId, created }, audit: { resource: auditProject(input.projectId), summary: created ? `document space ${spaceId}` : "document space exists", after: { spaceId, created, pages } } };
  },
});
export async function createProjectSpaceAction(input: unknown) {
  return spacePipeline(input);
}
