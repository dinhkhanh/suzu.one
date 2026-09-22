// The risks, issues, decisions and assumptions log (FR-PJM-29). Items are written by the people
// working in the project; an issue can be turned into a task in the project, once, and the item
// keeps the link. Decisions carry the day they were taken and their proof — a file kept by the
// files module or an https link — and may come from a meeting (FR-PJM-30). No authorization here:
// the actions check `canAddRaid` / `canEditRaidItem` / `canCloseRaidItem` first.
import "server-only";
import { and, asc, desc, eq } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { ActionError } from "@/lib/action";
import { type IsoDate, todayInVietnam } from "@/lib/dates";
import { db, schema, type Tx } from "@/lib/db";
import { createWorkTaskIn, listAssignable, taskKey } from "../work/service";
import { canBecomeTask, normaliseRaid, type RaidKind, raidProblems, type RaidSeverity, type RaidStatus, sortRaid } from "./engine/raid";

type Executor = Tx | ReturnType<typeof db>;
export type RaidRow = typeof schema.projectRaidItem.$inferSelect;

/** Evidence files of the log are owned by the project (uploaded before the item is saved). */
export const RAID_EVIDENCE = "project_raid";

export type RaidInput = {
  kind: RaidKind;
  title: string;
  description: string | null;
  ownerPersonId: string | null;
  dueDate: IsoDate | null;
  severity: RaidSeverity | null;
  decidedOn: IsoDate | null;
  evidenceUrl: string | null;
  evidenceFileId: string | null;
};

export const findRaidItem = async (itemId: string, executor: Executor = db()): Promise<RaidRow | undefined> => (await executor.select().from(schema.projectRaidItem).where(eq(schema.projectRaidItem.id, itemId)).limit(1))[0];

/** The people an item may be given to: the project's members and its team's (the task assignee list). */
async function checkOwner(projectId: string, personId: string | null): Promise<void> {
  if (!personId) return;
  const [project] = await db().select({ teamId: schema.workProject.teamId }).from(schema.workProject).where(eq(schema.workProject.id, projectId)).limit(1);
  if (!project || !(await listAssignable(project.teamId, projectId)).some((person) => person.id === personId)) throw new ActionError("raid_owner_not_member");
}

/** An evidence file belongs to this project's log, and to nothing else. */
async function checkEvidence(projectId: string, fileId: string | null): Promise<void> {
  if (!fileId) return;
  const [file] = await db().select({ ownerType: schema.storedFile.ownerType, ownerId: schema.storedFile.ownerId }).from(schema.storedFile).where(eq(schema.storedFile.id, fileId)).limit(1);
  if (!file || file.ownerType !== RAID_EVIDENCE || file.ownerId !== projectId) throw new ActionError("file_not_found");
}

function checked(input: RaidInput, today: IsoDate): RaidInput {
  const clean = normaliseRaid({ ...input, title: input.title.trim() });
  const [problem] = raidProblems(clean, today);
  if (problem) throw new ActionError(problem);
  return clean;
}

/** Adds an item, or changes one of this project's. The kind of an existing item stays what it was. */
export async function saveRaidItem(projectId: string, itemId: string | null, input: RaidInput, actorPersonId: string, today: IsoDate = todayInVietnam()): Promise<{ before: RaidRow | null; after: RaidRow }> {
  const before = itemId ? ((await findRaidItem(itemId)) ?? null) : null;
  if (itemId && (!before || before.projectId !== projectId)) throw new ActionError("raid_not_found");
  const values = checked(before ? { ...input, kind: before.kind as RaidKind } : input, today);
  await Promise.all([checkOwner(projectId, values.ownerPersonId), checkEvidence(projectId, values.evidenceFileId)]);
  if (before) {
    const [after] = await db()
      .update(schema.projectRaidItem)
      .set({ ...values, kind: before.kind, updatedAt: new Date() })
      .where(eq(schema.projectRaidItem.id, before.id))
      .returning();
    return { before, after };
  }
  const [after] = await db().insert(schema.projectRaidItem).values({ projectId, ...values, createdByPersonId: actorPersonId }).returning();
  return { before: null, after };
}

export async function setRaidStatus(itemId: string, status: RaidStatus): Promise<{ before: RaidRow; after: RaidRow }> {
  const before = await findRaidItem(itemId);
  if (!before) throw new ActionError("raid_not_found");
  const [after] = await db().update(schema.projectRaidItem).set({ status, updatedAt: new Date() }).where(eq(schema.projectRaidItem.id, itemId)).returning();
  return { before, after };
}

/**
 * Turns an open issue into a task of the project's team, in the project — the work module makes
 * it, as any task — and keeps the link on the item. Once: the item row is locked, so a second tap
 * finds the link and is refused. The task goes to the given person, else to the item's owner.
 */
export async function issueToTask(itemId: string, input: { assigneePersonId: string | null; dueDate: IsoDate | null }, actorPersonId: string): Promise<{ item: RaidRow; taskId: string; key: string }> {
  return db().transaction(async (tx) => {
    const [item] = await tx.select().from(schema.projectRaidItem).where(eq(schema.projectRaidItem.id, itemId)).limit(1).for("update");
    if (!item) throw new ActionError("raid_not_found");
    if (!canBecomeTask(item)) throw new ActionError("raid_not_convertible");
    const [project] = await tx.select({ teamId: schema.workProject.teamId }).from(schema.workProject).where(eq(schema.workProject.id, item.projectId)).limit(1);
    if (!project) throw new ActionError("project_not_found");
    const { task, key } = await createWorkTaskIn(tx, { teamId: project.teamId, projectId: item.projectId, title: item.title, description: item.description, assigneePersonId: input.assigneePersonId ?? item.ownerPersonId, dueDate: input.dueDate ?? item.dueDate }, actorPersonId);
    const [after] = await tx.update(schema.projectRaidItem).set({ taskId: task.id, updatedAt: new Date() }).where(eq(schema.projectRaidItem.id, item.id)).returning();
    return { item: after, taskId: task.id, key };
  });
}

export type RaidView = RaidRow & {
  ownerName: string | null;
  authorName: string | null;
  task: { id: string; key: string; title: string; status: string } | null;
  meeting: { id: string; title: string; heldOn: IsoDate } | null;
  evidenceFile: { id: string; fileName: string } | null;
};

/** The whole log of a project in its reading order. The caller has checked the viewer may read the project. */
export async function listRaid(projectId: string, options: { kind?: RaidKind; meetingId?: string } = {}): Promise<RaidView[]> {
  const owner = alias(schema.person, "raid_owner");
  const author = alias(schema.person, "raid_author");
  const rows = await db()
    .select({
      item: schema.projectRaidItem,
      ownerName: owner.fullName,
      authorName: author.fullName,
      taskTitle: schema.task.title,
      taskStatus: schema.task.status,
      taskDeletedAt: schema.task.deletedAt,
      taskNumber: schema.workTask.number,
      teamKey: schema.workTeam.key,
      meetingTitle: schema.projectMeeting.title,
      meetingHeldOn: schema.projectMeeting.heldOn,
      fileName: schema.storedFile.fileName,
      fileDeletedAt: schema.storedFile.deletedAt,
    })
    .from(schema.projectRaidItem)
    .leftJoin(owner, eq(owner.id, schema.projectRaidItem.ownerPersonId))
    .leftJoin(author, eq(author.id, schema.projectRaidItem.createdByPersonId))
    .leftJoin(schema.task, eq(schema.task.id, schema.projectRaidItem.taskId))
    .leftJoin(schema.workTask, eq(schema.workTask.taskId, schema.projectRaidItem.taskId))
    .leftJoin(schema.workTeam, eq(schema.workTeam.id, schema.workTask.teamId))
    .leftJoin(schema.projectMeeting, eq(schema.projectMeeting.id, schema.projectRaidItem.meetingId))
    .leftJoin(schema.storedFile, eq(schema.storedFile.id, schema.projectRaidItem.evidenceFileId))
    .where(and(eq(schema.projectRaidItem.projectId, projectId), options.kind ? eq(schema.projectRaidItem.kind, options.kind) : undefined, options.meetingId ? eq(schema.projectRaidItem.meetingId, options.meetingId) : undefined))
    .orderBy(desc(schema.projectRaidItem.createdAt), asc(schema.projectRaidItem.id));
  const views = rows.map(
    (row): RaidView => ({
      ...row.item,
      ownerName: row.ownerName,
      authorName: row.authorName,
      // A deleted task is not a link anyone can follow.
      task: row.item.taskId && row.taskTitle && !row.taskDeletedAt && row.teamKey && row.taskNumber !== null ? { id: row.item.taskId, key: taskKey(row.teamKey, row.taskNumber), title: row.taskTitle, status: row.taskStatus ?? "todo" } : null,
      meeting: row.item.meetingId && row.meetingTitle && row.meetingHeldOn ? { id: row.item.meetingId, title: row.meetingTitle, heldOn: row.meetingHeldOn } : null,
      evidenceFile: row.item.evidenceFileId && row.fileName && !row.fileDeletedAt ? { id: row.item.evidenceFileId, fileName: row.fileName } : null,
    }),
  );
  return sortRaid(views);
}

/** Is this file the evidence of one of the project's items? For opening it. */
export async function raidWithEvidence(projectId: string, fileId: string): Promise<RaidRow | undefined> {
  const [row] = await db()
    .select()
    .from(schema.projectRaidItem)
    .where(and(eq(schema.projectRaidItem.projectId, projectId), eq(schema.projectRaidItem.evidenceFileId, fileId)))
    .limit(1);
  return row;
}
