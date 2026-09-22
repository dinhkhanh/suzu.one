// Baselines (FR-PJM-12): the dates a project was approved with — its own, its milestones' and every
// task's — kept so the timeline, the plan and the close-out report can show slip. Taken at kick-off
// approval and again when the project lead re-baselines; the audit record of a re-baseline keeps
// the baseline it replaced, so nothing is ever lost by moving the yardstick.
import "server-only";
import { and, asc, eq, isNull } from "drizzle-orm";
import { todayInVietnam } from "@/lib/dates";
import { db, schema, type Tx } from "@/lib/db";
import { type SlipSummary, slipSummary, takeBaseline, takeTaskBaselines, type TaskBaseline, taskSlip } from "./engine/baseline";
import { ensurePlan } from "./plans";
import type { ProjectBaseline } from "./schema";

/** The live tasks of a project with their dates and any baseline they already have. */
async function projectTaskDates(tx: Tx | ReturnType<typeof db>, projectId: string) {
  return tx
    .select({ taskId: schema.task.id, startDate: schema.task.startDate, dueDate: schema.task.dueDate, status: schema.task.status, baselineStart: schema.projectTaskLink.baselineStart, baselineDue: schema.projectTaskLink.baselineDue })
    .from(schema.workTask)
    .innerJoin(schema.task, eq(schema.task.id, schema.workTask.taskId))
    .leftJoin(schema.projectTaskLink, eq(schema.projectTaskLink.taskId, schema.task.id))
    .where(and(eq(schema.workTask.projectId, projectId), isNull(schema.task.deletedAt)))
    .orderBy(asc(schema.task.createdAt));
}

/**
 * Every task of the project gets its current dates as its baseline — linked to the plan or not:
 * a task with no milestone, line or phase gets a link row that only carries the baseline.
 */
export async function captureTaskBaselines(tx: Tx, projectId: string): Promise<{ before: TaskBaseline[]; after: TaskBaseline[] }> {
  const rows = await projectTaskDates(tx, projectId);
  const hadBaseline = new Set(rows.filter((row) => row.baselineStart !== null || row.baselineDue !== null).map((row) => row.taskId));
  const after = takeTaskBaselines(rows);
  for (const row of after) {
    // An undated task that never had a baseline has nothing to keep.
    if (!row.baselineStart && !row.baselineDue && !hadBaseline.has(row.taskId)) continue;
    await tx
      .insert(schema.projectTaskLink)
      .values(row)
      .onConflictDoUpdate({ target: schema.projectTaskLink.taskId, set: { baselineStart: row.baselineStart, baselineDue: row.baselineDue } });
  }
  return { before: rows.map((row) => ({ taskId: row.taskId, baselineStart: row.baselineStart, baselineDue: row.baselineDue })), after };
}

/** The project's own baseline: its dates, the hours budget and every milestone's date, now. */
export async function captureProjectBaseline(tx: Tx, projectId: string, now: Date): Promise<ProjectBaseline> {
  const plan = await ensurePlan(projectId, tx);
  const [project] = await tx.select({ startDate: schema.workProject.startDate, dueDate: schema.workProject.dueDate }).from(schema.workProject).where(eq(schema.workProject.id, projectId)).limit(1);
  const milestones = await tx.select({ id: schema.projectMilestone.id, dueDate: schema.projectMilestone.dueDate }).from(schema.projectMilestone).where(eq(schema.projectMilestone.projectId, projectId)).orderBy(asc(schema.projectMilestone.sortOrder));
  return takeBaseline({ startDate: project.startDate, dueDate: project.dueDate, budgetMinutes: plan.budgetMinutes, milestones }, now);
}

export type Rebaseline = { before: { baseline: ProjectBaseline | null; tasks: TaskBaseline[] }; after: { baseline: ProjectBaseline; tasks: TaskBaseline[] } };

/** The project lead's explicit re-baseline: the project, its milestones and all its tasks, in one transaction. */
export async function rebaseline(projectId: string, now: Date = new Date()): Promise<Rebaseline> {
  return db().transaction(async (tx) => {
    await ensurePlan(projectId, tx);
    const [plan] = await tx.select().from(schema.projectPlan).where(eq(schema.projectPlan.projectId, projectId)).limit(1).for("update");
    const baseline = await captureProjectBaseline(tx, projectId, now);
    await tx.update(schema.projectPlan).set({ baseline, updatedAt: now }).where(eq(schema.projectPlan.projectId, projectId));
    const tasks = await captureTaskBaselines(tx, projectId);
    // Only what changed goes to the log: a project of 500 tasks re-baselined after a one-week slip
    // keeps every old date that moved, not 500 identical pairs.
    const was = new Map(tasks.before.map((row) => [row.taskId, row]));
    const changed = tasks.after.filter((row) => {
      const old = was.get(row.taskId);
      return !old || old.baselineStart !== row.baselineStart || old.baselineDue !== row.baselineDue;
    });
    return { before: { baseline: plan.baseline, tasks: changed.map((row) => was.get(row.taskId) ?? { taskId: row.taskId, baselineStart: null, baselineDue: null }) }, after: { baseline, tasks: changed } };
  });
}

export type TaskSlipView = { summary: SlipSummary; slipOf: Map<string, number | null> };

/** Slip of every task of the project against its baseline. The caller has checked the viewer may read the plan. */
export async function loadTaskSlips(projectId: string, today = todayInVietnam()): Promise<TaskSlipView> {
  const rows = await projectTaskDates(db(), projectId);
  const slips = rows.filter((row) => row.status !== "cancelled").map((row) => taskSlip({ taskId: row.taskId, dueDate: row.dueDate, baselineDue: row.baselineDue, open: row.status === "todo" || row.status === "in_progress" }, today));
  return { summary: slipSummary(slips), slipOf: new Map(slips.map((slip) => [slip.taskId, slip.slipDays])) };
}
