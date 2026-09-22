// A project's structure (FR-PJM-04, 05): ordered phases, milestones with a date and an owner, and
// the deliverables register — and which task works towards which of them (`project_task_link`,
// one task = one unit of a register line). The actions check who may change them.
import "server-only";
import { and, asc, count, eq } from "drizzle-orm";
import { ActionError } from "@/lib/action";
import { db, schema, type Tx } from "@/lib/db";
import { notify } from "../platform/notifications/service";
import { CHANNELS, CONTENT_FORMATS } from "../work/enums";
import { createWorkTaskIn, loadTasks } from "../work/service";
import { billMilestone } from "./billing";
import { ensurePlan } from "./plans";

type Executor = Tx | ReturnType<typeof db>;
export type PhaseRow = typeof schema.projectPhase.$inferSelect;
export type MilestoneRow = typeof schema.projectMilestone.$inferSelect;
export type DeliverableRow = typeof schema.projectDeliverable.$inferSelect;

const checkDates = (start: string | null, end: string | null) => {
  if (start && end && end < start) throw new ActionError("plan_dates_invalid");
};

/** A phase, milestone or line of another project is refused: ids come from the browser. */
async function phaseOf(executor: Executor, projectId: string, phaseId: string | null): Promise<string | null> {
  if (!phaseId) return null;
  const [row] = await executor.select({ projectId: schema.projectPhase.projectId }).from(schema.projectPhase).where(eq(schema.projectPhase.id, phaseId)).limit(1);
  if (row?.projectId !== projectId) throw new ActionError("phase_not_found");
  return phaseId;
}

async function milestoneOf(executor: Executor, projectId: string, milestoneId: string | null): Promise<MilestoneRow | null> {
  if (!milestoneId) return null;
  const [row] = await executor.select().from(schema.projectMilestone).where(eq(schema.projectMilestone.id, milestoneId)).limit(1);
  if (row?.projectId !== projectId) throw new ActionError("milestone_not_found");
  return row;
}

async function deliverableOf(executor: Executor, projectId: string, deliverableId: string | null): Promise<DeliverableRow | null> {
  if (!deliverableId) return null;
  const [row] = await executor.select().from(schema.projectDeliverable).where(eq(schema.projectDeliverable.id, deliverableId)).limit(1);
  if (row?.projectId !== projectId) throw new ActionError("deliverable_not_found");
  return row;
}

export const findPhase = async (id: string) => (await db().select().from(schema.projectPhase).where(eq(schema.projectPhase.id, id)).limit(1))[0];
export const findMilestone = async (id: string) => (await db().select().from(schema.projectMilestone).where(eq(schema.projectMilestone.id, id)).limit(1))[0];
export const findDeliverable = async (id: string) => (await db().select().from(schema.projectDeliverable).where(eq(schema.projectDeliverable.id, id)).limit(1))[0];

// ── Phases ──────────────────────────────────────────────────────────────────────────────────

export type PhaseInput = { name: string; startDate: string | null; endDate: string | null; budgetMinutes: number | null; sortOrder: number };

export async function savePhase(projectId: string, phaseId: string | null, input: PhaseInput): Promise<{ before: PhaseRow | null; after: PhaseRow }> {
  checkDates(input.startDate, input.endDate);
  return db().transaction(async (tx) => {
    await ensurePlan(projectId, tx);
    if (!phaseId) {
      const [after] = await tx.insert(schema.projectPhase).values({ projectId, ...input }).returning();
      return { before: null, after };
    }
    const [before] = await tx.select().from(schema.projectPhase).where(and(eq(schema.projectPhase.id, phaseId), eq(schema.projectPhase.projectId, projectId))).limit(1);
    if (!before) throw new ActionError("phase_not_found");
    const [after] = await tx.update(schema.projectPhase).set({ ...input, updatedAt: new Date() }).where(eq(schema.projectPhase.id, phaseId)).returning();
    return { before, after };
  });
}

/** Milestones and tasks of the phase stay; they simply belong to no phase (ON DELETE SET NULL). */
export async function deletePhase(phaseId: string): Promise<PhaseRow> {
  const [row] = await db().delete(schema.projectPhase).where(eq(schema.projectPhase.id, phaseId)).returning();
  if (!row) throw new ActionError("phase_not_found");
  return row;
}

// ── Milestones ──────────────────────────────────────────────────────────────────────────────

export type MilestoneInput = { name: string; dueDate: string | null; phaseId: string | null; ownerPersonId: string | null; isClientFacing: boolean; isBilling: boolean; sortOrder: number; /** Only written when given: the amount is `pjm:commercial`, and a reader without it never sends one. */ billingAmountVnd?: number | null };

export async function saveMilestone(projectId: string, milestoneId: string | null, input: MilestoneInput): Promise<{ before: MilestoneRow | null; after: MilestoneRow }> {
  return db().transaction(async (tx) => {
    await ensurePlan(projectId, tx);
    await phaseOf(tx, projectId, input.phaseId);
    if (input.ownerPersonId) {
      const [owner] = await tx.select({ status: schema.person.status }).from(schema.person).where(eq(schema.person.id, input.ownerPersonId)).limit(1);
      if (!owner || owner.status === "offboarded") throw new ActionError("person_not_found");
    }
    const { billingAmountVnd, ...rest } = input;
    const values = { ...rest, ...(billingAmountVnd === undefined ? {} : { billingAmountVnd: rest.isBilling ? billingAmountVnd : null }) };
    if (!milestoneId) {
      const [after] = await tx.insert(schema.projectMilestone).values({ projectId, ...values }).returning();
      return { before: null, after };
    }
    const before = await milestoneOf(tx, projectId, milestoneId);
    // A new date earns new reminders.
    const notified = before!.dueDate === input.dueDate ? before!.notified : [];
    const [after] = await tx.update(schema.projectMilestone).set({ ...values, notified, updatedAt: new Date() }).where(eq(schema.projectMilestone.id, milestoneId)).returning();
    return { before, after };
  });
}

/**
 * A billing milestone marked done hands finance a "ready to invoice" item (FR-PJM-56), in the same
 * transaction — once: reopening and finishing it again finds the item already made.
 */
export async function setMilestoneDone(milestoneId: string, done: boolean, actorPersonId: string): Promise<{ before: MilestoneRow; after: MilestoneRow; billingItemId: string | null }> {
  return db().transaction(async (tx) => {
    const [before] = await tx.select().from(schema.projectMilestone).where(eq(schema.projectMilestone.id, milestoneId)).limit(1).for("update");
    if (!before) throw new ActionError("milestone_not_found");
    const [after] = await tx
      .update(schema.projectMilestone)
      .set(done ? { doneAt: before.doneAt ?? new Date(), doneByPersonId: before.doneByPersonId ?? actorPersonId, updatedAt: new Date() } : { doneAt: null, doneByPersonId: null, updatedAt: new Date() })
      .where(eq(schema.projectMilestone.id, milestoneId))
      .returning();
    const billed = done ? await billMilestone(tx, after, actorPersonId) : null;
    return { before, after, billingItemId: billed?.created ? billed.item.id : null };
  });
}

export async function deleteMilestone(milestoneId: string): Promise<MilestoneRow> {
  const [row] = await db().delete(schema.projectMilestone).where(eq(schema.projectMilestone.id, milestoneId)).returning();
  if (!row) throw new ActionError("milestone_not_found");
  return row;
}

// ── The deliverables register ───────────────────────────────────────────────────────────────

export type DeliverableInput = { title: string; quantity: number; format: string | null; channel: string | null; dueDate: string | null; milestoneId: string | null; sortOrder: number };

export async function saveDeliverable(projectId: string, deliverableId: string | null, input: DeliverableInput): Promise<{ before: DeliverableRow | null; after: DeliverableRow }> {
  return db().transaction(async (tx) => {
    await ensurePlan(projectId, tx);
    await milestoneOf(tx, projectId, input.milestoneId);
    if (!deliverableId) {
      const [after] = await tx.insert(schema.projectDeliverable).values({ projectId, ...input }).returning();
      return { before: null, after };
    }
    const before = await deliverableOf(tx, projectId, deliverableId);
    const [after] = await tx.update(schema.projectDeliverable).set({ ...input, updatedAt: new Date() }).where(eq(schema.projectDeliverable.id, deliverableId)).returning();
    return { before, after };
  });
}

/**
 * A promise withdrawn stays on the register, struck through: what was promised and dropped is part
 * of the story an acceptance and a close-out report tell. Undo by passing false.
 */
export async function cancelDeliverable(deliverableId: string, cancelled: boolean): Promise<{ before: DeliverableRow; after: DeliverableRow }> {
  const before = await findDeliverable(deliverableId);
  if (!before) throw new ActionError("deliverable_not_found");
  const [after] = await db().update(schema.projectDeliverable).set({ cancelledAt: cancelled ? new Date() : null, updatedAt: new Date() }).where(eq(schema.projectDeliverable.id, deliverableId)).returning();
  return { before, after };
}

// ── Linking tasks ───────────────────────────────────────────────────────────────────────────

export type LinkInput = { milestoneId: string | null; deliverableId: string | null; phaseId: string | null };

/** The project a task sits in — for the actions' authorization. */
export async function projectOfTask(taskId: string): Promise<string | null> {
  const [row] = await db().select({ projectId: schema.workTask.projectId }).from(schema.workTask).where(eq(schema.workTask.taskId, taskId)).limit(1);
  return row?.projectId ?? null;
}

/**
 * Links a task of the project to a milestone, a register line and/or a phase. A line implies its
 * milestone when none is given. A task linked after kick-off gets its baseline dates now.
 */
export async function linkTask(projectId: string, taskId: string, input: LinkInput): Promise<{ before: LinkInput | null; after: LinkInput }> {
  return db().transaction(async (tx) => {
    const task = (await loadTasks([taskId], tx)).get(taskId);
    if (!task || task.work.projectId !== projectId) throw new ActionError("task_not_found");
    const plan = await ensurePlan(projectId, tx);
    const line = await deliverableOf(tx, projectId, input.deliverableId);
    const milestone = await milestoneOf(tx, projectId, input.milestoneId ?? line?.milestoneId ?? null);
    const phaseId = await phaseOf(tx, projectId, input.phaseId ?? milestone?.phaseId ?? null);
    const after: LinkInput = { milestoneId: milestone?.id ?? null, deliverableId: line?.id ?? null, phaseId };
    const [existing] = await tx.select().from(schema.projectTaskLink).where(eq(schema.projectTaskLink.taskId, taskId)).limit(1);
    if (!after.milestoneId && !after.deliverableId && !after.phaseId) {
      if (existing) await clearLink(tx, existing);
    } else {
      const baseline = existing ? { baselineStart: existing.baselineStart, baselineDue: existing.baselineDue } : plan.briefStatus === "approved" ? { baselineStart: task.task.startDate, baselineDue: task.task.dueDate } : {};
      await tx.insert(schema.projectTaskLink).values({ taskId, ...after, ...baseline }).onConflictDoUpdate({ target: schema.projectTaskLink.taskId, set: after });
    }
    return { before: existing ? { milestoneId: existing.milestoneId, deliverableId: existing.deliverableId, phaseId: existing.phaseId } : null, after };
  });
}

/** A task unlinked from the plan keeps its baseline (FR-PJM-12): only a row with nothing left to say goes. */
async function clearLink(executor: Executor, link: typeof schema.projectTaskLink.$inferSelect): Promise<void> {
  if (link.baselineStart || link.baselineDue) await executor.update(schema.projectTaskLink).set({ milestoneId: null, deliverableId: null, phaseId: null }).where(eq(schema.projectTaskLink.taskId, link.taskId));
  else await executor.delete(schema.projectTaskLink).where(eq(schema.projectTaskLink.taskId, link.taskId));
}

export async function unlinkTask(taskId: string): Promise<boolean> {
  const [link] = await db().select().from(schema.projectTaskLink).where(eq(schema.projectTaskLink.taskId, taskId)).limit(1);
  if (!link || (!link.milestoneId && !link.deliverableId && !link.phaseId)) return false;
  await clearLink(db(), link);
  return true;
}

export type LineTasksInput = { count: number; assigneePersonId: string | null; dueDate: string | null };

/**
 * One task per unit of a register line, in one go ("12 × Facebook post" → twelve tasks, numbered
 * after the ones already linked), each linked to the line and its milestone. The work module makes
 * the tasks, so they get their numbers, states and activity like any other.
 */
export async function createTasksForLine(deliverableId: string, input: LineTasksInput, actorPersonId: string): Promise<{ line: DeliverableRow; taskIds: string[] }> {
  return db().transaction(async (tx) => {
    const [line] = await tx.select().from(schema.projectDeliverable).where(eq(schema.projectDeliverable.id, deliverableId)).limit(1).for("update");
    if (!line) throw new ActionError("deliverable_not_found");
    if (line.cancelledAt) throw new ActionError("deliverable_cancelled");
    const [project] = await tx.select().from(schema.workProject).where(eq(schema.workProject.id, line.projectId)).limit(1);
    if (!project || project.status === "archived") throw new ActionError("project_archived");
    const milestone = line.milestoneId ? await milestoneOf(tx, line.projectId, line.milestoneId) : null;
    const [linked] = await tx.select({ value: count() }).from(schema.projectTaskLink).where(eq(schema.projectTaskLink.deliverableId, line.id));
    const plan = await ensurePlan(line.projectId, tx);
    const format = (CONTENT_FORMATS as readonly string[]).includes(line.format ?? "") ? line.format : null;
    const channel = (CHANNELS as readonly string[]).includes(line.channel ?? "") ? line.channel : null;
    const dueDate = input.dueDate ?? line.dueDate ?? milestone?.dueDate ?? null;
    const taskIds: string[] = [];
    for (let index = 0; index < input.count; index++) {
      const number = (linked?.value ?? 0) + index + 1;
      const { task } = await createWorkTaskIn(tx, { teamId: project.teamId, projectId: project.id, title: `${line.title} #${number}`, assigneePersonId: input.assigneePersonId, dueDate, contentFormat: format, channel }, actorPersonId, { notify: false });
      await tx.insert(schema.projectTaskLink).values({ taskId: task.id, deliverableId: line.id, milestoneId: milestone?.id ?? null, phaseId: milestone?.phaseId ?? null, ...(plan.briefStatus === "approved" ? { baselineDue: dueDate } : {}) });
      taskIds.push(task.id);
    }
    // Twelve posts are one notice, not twelve.
    if (input.assigneePersonId && input.assigneePersonId !== actorPersonId && taskIds.length) await notify({ recipients: [input.assigneePersonId], kind: "tasks.assigned", params: { count: taskIds.length, title: `${line.title} #${(linked?.value ?? 0) + 1}` }, link: `/work/projects/${project.id}` }, tx);
    return { line, taskIds };
  });
}

/** The ordered structure of a project. The caller has checked the viewer may read the plan. */
export async function listStructure(projectId: string): Promise<{ phases: PhaseRow[]; milestones: MilestoneRow[]; deliverables: DeliverableRow[] }> {
  const [phases, milestones, deliverables] = await Promise.all([
    db().select().from(schema.projectPhase).where(eq(schema.projectPhase.projectId, projectId)).orderBy(asc(schema.projectPhase.sortOrder), asc(schema.projectPhase.startDate)),
    db().select().from(schema.projectMilestone).where(eq(schema.projectMilestone.projectId, projectId)).orderBy(asc(schema.projectMilestone.dueDate), asc(schema.projectMilestone.sortOrder)),
    db().select().from(schema.projectDeliverable).where(eq(schema.projectDeliverable.projectId, projectId)).orderBy(asc(schema.projectDeliverable.sortOrder), asc(schema.projectDeliverable.createdAt)),
  ]);
  return { phases, milestones, deliverables };
}
