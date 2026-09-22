// The figures a project is judged by, for many projects at once: register status (FR-PJM-05),
// hours burn (FR-PJM-09), open risks and issues (FR-PJM-29) and the facts of a status update
// (FR-PJM-27). Aggregated in SQL, then handed to the pure engines — so the portfolio, the project
// pages, the status update and the jobs all say the same thing. No authorization here: callers pass ids the viewer may already read.
import "server-only";
import { and, asc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { type IsoDate, todayInVietnam } from "@/lib/dates";
import { db, schema } from "@/lib/db";
import type { StateCategory } from "../work/enums";
import { deliveryFactsByTask } from "../work/service";
import { budgetBurn, type Burn } from "./engine/budget";
import { type LineStatus, lineStatus, registerProgress, type UnitFacts } from "./engine/register";
import type { RaidCounts } from "./engine/raid";
import { statusFacts } from "./engine/status";
import type { DeliverableRow } from "./structure";
import type { ProjectBaseline, StatusFacts } from "./schema";

export type RegisterLine = DeliverableRow & LineStatus;
export type Register = { lines: RegisterLine[]; promised: number; accepted: number; percent: number | null };

const liveTask = isNull(schema.task.deletedAt);

/**
 * The units of these register lines: one per linked live task, placed by its state, its latest
 * internal review and what the work module's delivery records say about it (`deliveryFactsByTask`:
 * the client's latest decision or an approved, frozen version; a delivery; a post out with its URL).
 * Each is simply absent until someone records it.
 */
export async function loadLineUnits(lineIds: readonly string[]): Promise<Map<string, UnitFacts[]>> {
  const result = new Map<string, UnitFacts[]>();
  if (lineIds.length === 0) return result;
  const taskId = schema.task.id;
  const units = await db()
    .select({
      taskId,
      deliverableId: schema.projectTaskLink.deliverableId,
      category: schema.workState.category,
      review: sql<UnitFacts["review"]>`(select d.decision from work_deliverable d where d.task_id = ${taskId} order by d.version desc limit 1)`,
    })
    .from(schema.projectTaskLink)
    .innerJoin(schema.task, eq(schema.task.id, schema.projectTaskLink.taskId))
    .innerJoin(schema.workTask, eq(schema.workTask.taskId, schema.projectTaskLink.taskId))
    .innerJoin(schema.workState, eq(schema.workState.id, schema.workTask.stateId))
    .where(and(inArray(schema.projectTaskLink.deliverableId, [...lineIds]), liveTask));
  const facts = await deliveryFactsByTask(units.map((unit) => unit.taskId));
  for (const { taskId: id, deliverableId, category, review } of units) {
    if (!deliverableId) continue;
    const delivery = facts.get(id);
    const clientDecision = (delivery?.lastClientDecision?.decision ?? (delivery?.clientApproved ? "approved" : null)) as UnitFacts["clientDecision"];
    result.set(deliverableId, [...(result.get(deliverableId) ?? []), { category: category as StateCategory, review, clientDecision, delivered: !!delivery?.delivered, published: !!delivery?.published }]);
  }
  return result;
}

/** Lines with their status — any lines, a project's register or a retainer month's. */
export async function withLineStatus(lines: readonly DeliverableRow[]): Promise<RegisterLine[]> {
  const units = await loadLineUnits(lines.map((line) => line.id));
  return lines.map((line) => ({ ...line, ...lineStatus({ quantity: line.quantity, cancelled: !!line.cancelledAt, units: units.get(line.id) ?? [] }) }));
}

/** Every register of these projects, each line with its status and the register's progress. Retainer months keep their own registers. */
export async function loadRegisters(projectIds: readonly string[]): Promise<Map<string, Register>> {
  const result = new Map<string, Register>(projectIds.map((id) => [id, { lines: [], promised: 0, accepted: 0, percent: null }]));
  if (projectIds.length === 0) return result;
  const lines = await db().select().from(schema.projectDeliverable).where(and(inArray(schema.projectDeliverable.projectId, [...projectIds]), isNull(schema.projectDeliverable.retainerPeriodId))).orderBy(asc(schema.projectDeliverable.sortOrder), asc(schema.projectDeliverable.createdAt));
  for (const line of await withLineStatus(lines)) result.get(line.projectId)?.lines.push(line);
  for (const register of result.values()) Object.assign(register, registerProgress(register.lines));
  return result;
}

/**
 * Hours burn per project: minutes logged on the project (on its tasks, or on the project itself),
 * plus what is left of the estimates of its open tasks.
 */
export async function loadBurns(projectIds: readonly string[], budgets: ReadonlyMap<string, number | null>): Promise<Map<string, Burn>> {
  const ids = [...projectIds];
  const result = new Map<string, Burn>();
  if (ids.length === 0) return result;
  const onProject = sql<string>`coalesce(${schema.timeEntry.projectId}, ${schema.workTask.projectId})`;
  const [logged, remaining] = await Promise.all([
    db()
      .select({ projectId: onProject, minutes: sql<number>`coalesce(sum(${schema.timeEntry.minutes}), 0)::int` })
      .from(schema.timeEntry)
      .leftJoin(schema.workTask, eq(schema.workTask.taskId, schema.timeEntry.taskId))
      .where(and(isNull(schema.timeEntry.deletedAt), or(inArray(schema.timeEntry.projectId, ids), inArray(schema.workTask.projectId, ids))))
      .groupBy(onProject),
    db()
      .select({
        projectId: schema.workTask.projectId,
        minutes: sql<number>`coalesce(sum(greatest(coalesce(${schema.task.estimateMinutes}, 0) - coalesce((select sum(te.minutes) from time_entry te where te.task_id = ${schema.task.id} and te.deleted_at is null), 0), 0)), 0)::int`,
      })
      .from(schema.workTask)
      .innerJoin(schema.task, eq(schema.task.id, schema.workTask.taskId))
      .where(and(inArray(schema.workTask.projectId, ids), liveTask, inArray(schema.task.status, ["todo", "in_progress"])))
      .groupBy(schema.workTask.projectId),
  ]);
  const loggedOf = new Map(logged.map((row) => [row.projectId, row.minutes]));
  const remainingOf = new Map(remaining.map((row) => [row.projectId, row.minutes]));
  for (const id of ids) result.set(id, budgetBurn({ loggedMinutes: loggedOf.get(id) ?? 0, remainingMinutes: remainingOf.get(id) ?? 0, budgetMinutes: budgets.get(id) ?? null }));
  return result;
}

/** The facts a status update is prefilled with (FR-PJM-27), as of today. */
export async function loadStatusFacts(projectId: string, plan: { budgetMinutes: number | null; baseline: ProjectBaseline | null }, today: IsoDate): Promise<StatusFacts> {
  const [tasks, blocked, milestones, registers, burns, raid] = await Promise.all([
    db().select({ status: schema.task.status, dueDate: schema.task.dueDate }).from(schema.workTask).innerJoin(schema.task, eq(schema.task.id, schema.workTask.taskId)).where(and(eq(schema.workTask.projectId, projectId), liveTask)),
    db()
      .select({ value: sql<number>`count(*)::int` })
      .from(schema.workBlocker)
      .innerJoin(schema.workTask, eq(schema.workTask.taskId, schema.workBlocker.taskId))
      .innerJoin(schema.task, eq(schema.task.id, schema.workBlocker.taskId))
      .where(and(eq(schema.workTask.projectId, projectId), isNull(schema.workBlocker.resolvedAt), liveTask)),
    db().select().from(schema.projectMilestone).where(eq(schema.projectMilestone.projectId, projectId)),
    loadRegisters([projectId]),
    loadBurns([projectId], new Map([[projectId, plan.budgetMinutes]])),
    db().select({ kind: schema.projectRaidItem.kind, severity: schema.projectRaidItem.severity, status: schema.projectRaidItem.status }).from(schema.projectRaidItem).where(and(eq(schema.projectRaidItem.projectId, projectId), eq(schema.projectRaidItem.status, "open"))),
  ]);
  const planned = new Map((plan.baseline?.milestones ?? []).map((milestone) => [milestone.id, milestone.dueDate]));
  const register = registers.get(projectId)!;
  return statusFacts({
    today,
    tasks: tasks.map((task) => ({ status: task.status as "todo" | "in_progress" | "done" | "cancelled", dueDate: task.dueDate })),
    blocked: blocked[0]?.value ?? 0,
    milestones: milestones.map((milestone) => ({ id: milestone.id, name: milestone.name, dueDate: milestone.dueDate, doneOn: milestone.doneAt ? todayInVietnam(milestone.doneAt) : null, baselineDue: planned.get(milestone.id) ?? null })),
    minutesLogged: burns.get(projectId)?.loggedMinutes ?? 0,
    budgetMinutes: plan.budgetMinutes,
    register: { accepted: register.accepted, promised: register.promised },
    raid,
  });
}

/** Open high risks and open issues per project (FR-PJM-29), counted in SQL — for the portfolio. */
export async function loadRaidCounts(projectIds: readonly string[]): Promise<Map<string, RaidCounts>> {
  const result = new Map<string, RaidCounts>(projectIds.map((id) => [id, { highRisks: 0, openIssues: 0 }]));
  if (projectIds.length === 0) return result;
  const item = schema.projectRaidItem;
  const rows = await db()
    .select({
      projectId: item.projectId,
      highRisks: sql<number>`count(*) filter (where ${item.kind} = 'risk' and ${item.severity} = 'high')::int`,
      openIssues: sql<number>`count(*) filter (where ${item.kind} = 'issue')::int`,
    })
    .from(item)
    .where(and(inArray(item.projectId, [...projectIds]), eq(item.status, "open")))
    .groupBy(item.projectId);
  for (const row of rows) result.set(row.projectId, { highRisks: row.highRisks, openIssues: row.openIssues });
  return result;
}

/** Linked tasks per milestone, as task statuses — for the milestone's progress. */
export async function loadMilestoneTasks(projectId: string): Promise<Map<string, ("todo" | "in_progress" | "done" | "cancelled")[]>> {
  const rows = await db()
    .select({ milestoneId: schema.projectTaskLink.milestoneId, status: schema.task.status })
    .from(schema.projectTaskLink)
    .innerJoin(schema.projectMilestone, eq(schema.projectMilestone.id, schema.projectTaskLink.milestoneId))
    .innerJoin(schema.task, eq(schema.task.id, schema.projectTaskLink.taskId))
    .where(and(eq(schema.projectMilestone.projectId, projectId), liveTask));
  const result = new Map<string, ("todo" | "in_progress" | "done" | "cancelled")[]>();
  for (const row of rows) if (row.milestoneId) result.set(row.milestoneId, [...(result.get(row.milestoneId) ?? []), row.status as "todo"]);
  return result;
}
