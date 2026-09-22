// The timeline (FR-PJM-07): what the Gantt draws — phases, milestones and tasks with their current
// and baseline dates, the "blocks" dependencies between tasks of the project, and the working
// calendar the bars are laid on — and moving a task on it, with its dependents if the person agrees.
//
// The working calendar is the owning team's working weekdays (the days its daily rules expect a
// report on; Monday–Friday by default) minus the days off of the project's entity. Dates are
// written through the work module's own task update, never here: a move is the same change, with
// the same checks, activity and notices, as editing the dates on the task page.
import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { ActionError } from "@/lib/action";
import { addDays, type IsoDate, todayInVietnam } from "@/lib/dates";
import { db, schema } from "@/lib/db";
import { getDaysOff } from "@/modules/attendance/service";
import { getTeamRules } from "@/modules/daily/service";
import { canEditTask, listProjectTasks, loadTask, loadTasks, type WorkViewer } from "../work/service";
import { baselineSlip, taskSlip } from "./engine/baseline";
import { type DateChange, type Dependency, type MovePlan, planMove, workCalendar, type WorkCalendar } from "./engine/schedule";
import { ensurePlan } from "./plans";
import { listStructure } from "./structure";

export type TimelineTask = {
  id: string;
  key: string;
  title: string;
  status: string;
  startDate: IsoDate | null;
  dueDate: IsoDate | null;
  baselineStart: IsoDate | null;
  baselineDue: IsoDate | null;
  slipDays: number | null;
  assigneePersonId: string | null;
  assigneeName: string | null;
  phaseId: string | null;
  milestoneId: string | null;
  canEdit: boolean;
};
export type TimelinePhase = { id: string; name: string; startDate: IsoDate | null; endDate: IsoDate | null };
export type TimelineMilestone = { id: string; name: string; dueDate: IsoDate | null; baselineDue: IsoDate | null; slipDays: number | null; phaseId: string | null; done: boolean };
export type TimelineView = {
  today: IsoDate;
  range: { from: IsoDate; to: IsoDate };
  /** ISO weekdays the team works. */
  workingWeekdays: number[];
  daysOff: { date: IsoDate; name: string }[];
  phases: TimelinePhase[];
  milestones: TimelineMilestone[];
  tasks: TimelineTask[];
  dependencies: Dependency[];
  hasBaseline: boolean;
};

const MAX_TASKS = 2000;
// How far past the last date a move may push work: the days off of that span are loaded with it.
const HORIZON_DAYS = 400;

async function loadCalendar(teamId: string, entityId: string | null, from: IsoDate, to: IsoDate): Promise<{ calendar: WorkCalendar; workingWeekdays: number[]; daysOff: { date: IsoDate; name: string }[] }> {
  const [rules, daysOff] = await Promise.all([getTeamRules(teamId), getDaysOff(entityId, from, to)]);
  const calendar = workCalendar([...rules.reportDays], daysOff.map((day) => day.date));
  return { calendar, workingWeekdays: [...calendar.workingWeekdays].sort(), daysOff: daysOff.map(({ date, name }) => ({ date, name })) };
}

/** "blocks" dependencies between tasks of the given set. */
async function dependenciesAmong(taskIds: readonly string[]): Promise<Dependency[]> {
  if (taskIds.length === 0) return [];
  const ids = new Set(taskIds);
  const rows = await db()
    .select({ blocker: schema.workTaskDependency.blockerTaskId, blocked: schema.workTaskDependency.blockedTaskId })
    .from(schema.workTaskDependency)
    .where(and(inArray(schema.workTaskDependency.blockedTaskId, [...ids]), eq(schema.workTaskDependency.type, "blocks")));
  return rows.filter((row) => ids.has(row.blocker));
}

async function linksOf(taskIds: readonly string[]) {
  if (taskIds.length === 0) return new Map<string, typeof schema.projectTaskLink.$inferSelect>();
  const rows = await db().select().from(schema.projectTaskLink).where(inArray(schema.projectTaskLink.taskId, [...taskIds]));
  return new Map(rows.map((row) => [row.taskId, row]));
}

const minDate = (dates: (IsoDate | null | undefined)[]) => dates.reduce<IsoDate | null>((low, date) => (date && (!low || date < low) ? date : low), null);
const maxDate = (dates: (IsoDate | null | undefined)[]) => dates.reduce<IsoDate | null>((high, date) => (date && (!high || date > high) ? date : high), null);

/** Everything the timeline draws. The caller has checked the viewer may read the plan. */
export async function getTimeline(viewer: WorkViewer, project: { id: string; teamId: string; entityId: string | null; startDate: IsoDate | null; dueDate: IsoDate | null }, today: IsoDate = todayInVietnam()): Promise<TimelineView> {
  const [items, structure, plan] = await Promise.all([listProjectTasks(project.id), listStructure(project.id), ensurePlan(project.id)]);
  const live = items.filter((task) => task.status !== "cancelled").slice(0, MAX_TASKS);
  const ids = live.map((task) => task.id);
  const [links, dependencies, loaded] = await Promise.all([linksOf(ids), dependenciesAmong(ids), loadTasks(ids)]);

  const tasks: TimelineTask[] = live.map((task) => {
    const link = links.get(task.id);
    const open = task.status === "todo" || task.status === "in_progress";
    const facts = loaded.get(task.id)?.facts;
    return {
      id: task.id,
      key: task.key,
      title: task.title,
      status: task.status,
      startDate: task.startDate,
      dueDate: task.dueDate,
      baselineStart: link?.baselineStart ?? null,
      baselineDue: link?.baselineDue ?? null,
      slipDays: taskSlip({ taskId: task.id, dueDate: task.dueDate, baselineDue: link?.baselineDue ?? null, open }, today).slipDays,
      assigneePersonId: task.assigneePersonId,
      assigneeName: task.assigneeName,
      phaseId: link?.phaseId ?? null,
      milestoneId: link?.milestoneId ?? null,
      canEdit: !!facts && canEditTask(viewer, facts),
    };
  });

  const slip = baselineSlip(plan.baseline, { startDate: project.startDate, dueDate: project.dueDate, budgetMinutes: plan.budgetMinutes, milestones: structure.milestones.map((milestone) => ({ id: milestone.id, dueDate: milestone.dueDate, doneOn: milestone.doneAt ? todayInVietnam(milestone.doneAt) : null })) }, today);
  const plannedDue = new Map(plan.baseline?.milestones.map((milestone) => [milestone.id, milestone.dueDate]) ?? []);
  const slipOf = new Map(slip?.milestones.map((milestone) => [milestone.id, milestone.slipDays]) ?? []);
  const milestones: TimelineMilestone[] = structure.milestones.map((milestone) => ({ id: milestone.id, name: milestone.name, dueDate: milestone.dueDate, baselineDue: plannedDue.get(milestone.id) ?? null, slipDays: slipOf.get(milestone.id) ?? null, phaseId: milestone.phaseId, done: !!milestone.doneAt }));
  const phases: TimelinePhase[] = structure.phases.map(({ id, name, startDate, endDate }) => ({ id, name, startDate, endDate }));

  // The chart spans every date it has to draw, with a little room either side.
  const dates = [today, project.startDate, project.dueDate, ...tasks.flatMap((task) => [task.startDate, task.dueDate, task.baselineStart, task.baselineDue]), ...milestones.flatMap((milestone) => [milestone.dueDate, milestone.baselineDue]), ...phases.flatMap((phase) => [phase.startDate, phase.endDate])];
  const from = addDays(minDate(dates) ?? today, -7);
  const to = addDays(maxDate(dates) ?? today, 21);
  const { workingWeekdays, daysOff } = await loadCalendar(project.teamId, project.entityId, from, addDays(to, HORIZON_DAYS));
  return { today, range: { from, to }, workingWeekdays, daysOff, phases, milestones, tasks, dependencies, hasBaseline: !!plan.baseline };
}

export type MoveInput = { taskId: string; startDate: IsoDate | null; dueDate: IsoDate | null; shiftDependents: boolean };
/** Writes one task's dates. The action passes the work module's task update; a test passes the service under it. */
export type TaskDateWriter = (taskId: string, dates: { startDate: IsoDate | null; dueDate: IsoDate | null }) => Promise<void>;
export type MoveResult = { projectId: string; plan: MovePlan; applied: DateChange[]; /** Dependents that now start before their blocker ends and were left alone (the person said no). */ leftAlone: number };

/** The project a task on the timeline sits in; null = not a project task. */
export async function timelineProjectOf(taskId: string): Promise<string | null> {
  return (await loadTask(taskId))?.work.projectId ?? null;
}

/**
 * Moves a task and — if the person agreed — shifts the dependents that would otherwise start
 * before it ends, by the same number of working days (the plan is worked out again here from the
 * current dates, not taken from the browser). Every task shifted must be one the viewer may edit;
 * one they may not stops the whole move before anything is written.
 */
export async function moveTimelineTask(viewer: WorkViewer, input: MoveInput, write: TaskDateWriter): Promise<MoveResult> {
  if (input.startDate && input.dueDate && input.dueDate < input.startDate) throw new ActionError("task_dates_invalid");
  const moved = await loadTask(input.taskId);
  const projectId = moved?.work.projectId;
  if (!moved || !projectId) throw new ActionError("task_not_found");
  if (!canEditTask(viewer, moved.facts)) throw new ActionError("forbidden");

  const items = (await listProjectTasks(projectId)).filter((task) => task.status !== "cancelled");
  const dependencies = await dependenciesAmong(items.map((task) => task.id));
  const dates = items.flatMap((task) => [task.startDate, task.dueDate]).concat(input.startDate, input.dueDate);
  const from = minDate(dates) ?? todayInVietnam();
  const { calendar } = await loadCalendar(moved.work.teamId, moved.project?.entityId ?? moved.task.entityId, from, addDays(maxDate(dates) ?? from, HORIZON_DAYS));
  // Finished work stays where it happened.
  const movable = items.filter((task) => task.status === "todo" || task.status === "in_progress" || task.id === input.taskId);
  const plan = planMove(calendar, movable, dependencies, { taskId: input.taskId, startDate: input.startDate, dueDate: input.dueDate });

  const shifts = input.shiftDependents ? plan.shifts : [];
  if (shifts.length) {
    const loaded = await loadTasks(shifts.map((shift) => shift.taskId));
    const locked = shifts.filter((shift) => {
      const task = loaded.get(shift.taskId);
      return !task || !canEditTask(viewer, task.facts);
    });
    if (locked.length) throw new ActionError("timeline_dependents_locked", { count: locked.length });
  }
  const applied: DateChange[] = [];
  for (const change of [plan.moved, ...shifts]) {
    if (change.from.startDate === change.to.startDate && change.from.dueDate === change.to.dueDate) continue;
    await write(change.taskId, change.to);
    applied.push(change);
  }
  return { projectId, plan, applied, leftAlone: input.shiftDependents ? 0 : plan.shifts.length };
}
