// The register line a task fills (FR-PJM-05, 06), set where people work: on the task's own page.
// One task is one unit of one line, and work is often finished before anybody records which
// promise it filled — so the field takes a task in any state, and offers the lines that are still
// open: the project's own register, and for a retainer the lines of its open months, this month's
// first. Only the line moves: the milestone and the phase the task is linked to stay as they are.
import "server-only";
import { asc, eq } from "drizzle-orm";
import { ActionError } from "@/lib/action";
import { type IsoDate, todayInVietnam } from "@/lib/dates";
import { db, schema } from "@/lib/db";
import type { ProjectFacts, WorkViewer } from "../work/service";
import { lineLabel, type Month, monthOf, openLinesFirst } from "./engine/retainer";
import { isProjectClosed } from "./plans";
import { canEditPlan, canViewPlan } from "./policy";
import { findDeliverable, type LinkInput, linkTask, projectOfTask } from "./structure";

export type TaskLineOption = { id: string; label: string; /** The retainer month the line belongs to; null for the project's own register. */ month: Month | null };
export type TaskLineView = { current: string | null; options: TaskLineOption[]; canEdit: boolean };

/**
 * The lines a task of this project may be put on, in the order the picker shows them, and the one
 * it is on. A cancelled line and a closed month's line are left out — unless the task is on it,
 * so the field never shows "none" for a task that fills a promise.
 */
export async function taskLineOptions(projectId: string, taskId: string, today: IsoDate = todayInVietnam()): Promise<{ current: string | null; options: TaskLineOption[] }> {
  const [lines, [link]] = await Promise.all([
    db()
      .select({ id: schema.projectDeliverable.id, title: schema.projectDeliverable.title, quantity: schema.projectDeliverable.quantity, cancelledAt: schema.projectDeliverable.cancelledAt, month: schema.projectRetainerPeriod.month, periodStatus: schema.projectRetainerPeriod.status })
      .from(schema.projectDeliverable)
      .leftJoin(schema.projectRetainerPeriod, eq(schema.projectRetainerPeriod.id, schema.projectDeliverable.retainerPeriodId))
      .where(eq(schema.projectDeliverable.projectId, projectId))
      .orderBy(asc(schema.projectDeliverable.sortOrder), asc(schema.projectDeliverable.createdAt)),
    db().select({ deliverableId: schema.projectTaskLink.deliverableId }).from(schema.projectTaskLink).where(eq(schema.projectTaskLink.taskId, taskId)).limit(1),
  ]);
  const current = link?.deliverableId ?? null;
  const open = lines.filter((line) => line.id === current || (!line.cancelledAt && (line.month === null || line.periodStatus === "open")));
  return { current, options: openLinesFirst(open, monthOf(today)).map((line) => ({ id: line.id, label: lineLabel(line), month: line.month })) };
}

/**
 * The "fills register line" field of a task's page: null when the task's project is not the
 * reader's to open as a plan (the people on a task see the task, not its project's register).
 * `canEdit` is the rule the plan page's link control has always had — `canEditPlan`, which a
 * closed project refuses.
 */
export async function getTaskLine(viewer: WorkViewer, project: ProjectFacts, taskId: string): Promise<TaskLineView | null> {
  if (!canViewPlan(viewer, project)) return null;
  const [closed, lines] = await Promise.all([isProjectClosed(project.id), taskLineOptions(project.id, taskId)]);
  return { ...lines, canEdit: canEditPlan(viewer, { ...project, closed }) };
}

/**
 * Puts a task on a register line of its project, or takes it off (null). The task's milestone and
 * phase links are passed through unchanged — a line still implies its milestone for a task that
 * had none (`linkTask`). A cancelled line takes no more work.
 */
export async function setTaskLine(taskId: string, deliverableId: string | null): Promise<{ projectId: string; before: LinkInput | null; after: LinkInput }> {
  const projectId = await projectOfTask(taskId);
  if (!projectId) throw new ActionError("task_not_found");
  const [[link], line] = await Promise.all([
    db().select({ milestoneId: schema.projectTaskLink.milestoneId, phaseId: schema.projectTaskLink.phaseId }).from(schema.projectTaskLink).where(eq(schema.projectTaskLink.taskId, taskId)).limit(1),
    deliverableId ? findDeliverable(deliverableId) : null,
  ]);
  if (deliverableId && line?.projectId !== projectId) throw new ActionError("deliverable_not_found");
  if (line?.cancelledAt) throw new ActionError("deliverable_cancelled");
  return { projectId, ...(await linkTask(projectId, taskId, { milestoneId: link?.milestoneId ?? null, deliverableId, phaseId: link?.phaseId ?? null })) };
}
