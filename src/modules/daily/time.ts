// Time entries (FR-PJM-24): a person logs minutes on a task or on a category of non-task time, for
// a day — by the quick log, by typing into the week grid, or with a running timer. Billable
// defaults from the project's kind — client work and retainers are billed, pitches and internal
// projects are not. The weekly timesheet (FR-PJM-25) builds on these rows: a submitted or approved
// week is locked, and nothing here changes a locked week.
//
// Time logs are work records, never pay records (design rule 3): nothing here feeds payroll.
import "server-only";
import { and, asc, desc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { ActionError } from "@/lib/action";
import { addDays, type IsoDate } from "@/lib/dates";
import { db, schema, type Tx } from "@/lib/db";
import { taskKey } from "@/modules/work/service";
import { weekStartOf } from "./engine/rules";
import { stopTimer, vietnamDateOf } from "./engine/timer";
import { isWeekEditable, planCellChange, type TimesheetStatus } from "./engine/timesheet";
import { BILLABLE_PROJECT_KINDS, type TimeCategory } from "./enums";

type Executor = Tx | ReturnType<typeof db>;
export type TimeEntryRow = typeof schema.timeEntry.$inferSelect;

/**
 * How far back the person may still log or change time on their own: the current week and the
 * four before it. A week returned by the approver stays open to fix, however old.
 */
export const TIME_BACKFILL_DAYS = 35;

export type NewTimeEntry = { personId: string; date: IsoDate; taskId: string | null; category: TimeCategory | null; minutes: number; note: string | null; /** null = the project's default. */ billable: boolean | null };

/** The week's approval status, or null when the week was never submitted. */
export async function weekStatusOf(personId: string, weekStart: IsoDate, executor: Executor = db()): Promise<TimesheetStatus | null> {
  const [week] = await executor
    .select({ status: schema.timesheetWeek.status })
    .from(schema.timesheetWeek)
    .where(and(eq(schema.timesheetWeek.personId, personId), eq(schema.timesheetWeek.weekStart, weekStart)))
    .limit(1);
  return (week?.status as TimesheetStatus | undefined) ?? null;
}

async function assertWeekOpen(personId: string, date: IsoDate, executor: Executor = db()): Promise<void> {
  if (!isWeekEditable(await weekStatusOf(personId, weekStartOf(date), executor))) throw new ActionError("time_week_locked");
}

/** May the person still write on this date: not in the future, and recent — or in a returned week. */
export async function withinTimeWindow(personId: string, date: IsoDate, today: IsoDate): Promise<boolean> {
  if (date > today) return false;
  if (date >= addDays(today, -TIME_BACKFILL_DAYS)) return true;
  return (await weekStatusOf(personId, weekStartOf(date))) === "returned";
}

/** Whether time on this project is billed by default: client projects and retainers are. */
export async function billableByDefault(projectId: string | null, executor: Executor = db()): Promise<boolean> {
  if (!projectId) return false;
  const [plan] = await executor.select({ kind: schema.projectPlan.kind }).from(schema.projectPlan).where(eq(schema.projectPlan.projectId, projectId)).limit(1);
  // A project made before the project layer has no plan row: it is client work unless said otherwise.
  return (BILLABLE_PROJECT_KINDS as readonly string[]).includes(plan?.kind ?? "client");
}

/** The task's project, or an error when the task is gone. */
async function projectOfTask(taskId: string, executor: Executor): Promise<string | null> {
  const [work] = await executor
    .select({ projectId: schema.workTask.projectId })
    .from(schema.workTask)
    .innerJoin(schema.task, eq(schema.task.id, schema.workTask.taskId))
    .where(and(eq(schema.workTask.taskId, taskId), isNull(schema.task.deletedAt)))
    .limit(1);
  if (!work) throw new ActionError("task_not_found");
  return work.projectId;
}

type Target = { taskId: string | null; category: TimeCategory | null };

/** Where an entry goes: its project and whether it is billable, from the task or the category. */
async function placeOf(target: Target, billable: boolean | null, executor: Executor): Promise<{ taskId: string | null; category: TimeCategory | null; projectId: string | null; billable: boolean }> {
  if (!target.taskId === !target.category) throw new ActionError("time_task_or_category");
  const projectId = target.taskId ? await projectOfTask(target.taskId, executor) : null;
  return { taskId: target.taskId, category: target.taskId ? null : target.category, projectId, billable: billable ?? (await billableByDefault(projectId, executor)) };
}

export async function logTime(input: NewTimeEntry, executor: Executor = db()): Promise<TimeEntryRow> {
  if (!input.taskId === !input.category) throw new ActionError("time_task_or_category");
  await assertWeekOpen(input.personId, input.date, executor);
  const place = await placeOf(input, input.billable, executor);
  const [row] = await executor
    .insert(schema.timeEntry)
    .values({ personId: input.personId, date: input.date, weekStart: weekStartOf(input.date), ...place, minutes: input.minutes, note: input.note, source: "manual" })
    .returning();
  return row;
}

/** One of the person's own stopped entries, not deleted. */
async function ownEntry(personId: string, entryId: string, executor: Executor): Promise<TimeEntryRow> {
  const [entry] = await executor
    .select()
    .from(schema.timeEntry)
    .where(and(eq(schema.timeEntry.id, entryId), isNull(schema.timeEntry.deletedAt)))
    .limit(1);
  if (!entry || entry.personId !== personId || entry.timerStartedAt) throw new ActionError("time_entry_not_found");
  return entry;
}

/** Only the person's own entries, and only in an open week. Soft delete: the week's history keeps it. */
export async function deleteTimeEntry(personId: string, entryId: string): Promise<TimeEntryRow> {
  const entry = await ownEntry(personId, entryId, db());
  await assertWeekOpen(personId, entry.date);
  const [row] = await db().update(schema.timeEntry).set({ deletedAt: new Date(), updatedAt: new Date() }).where(eq(schema.timeEntry.id, entryId)).returning();
  return row;
}

export type TimeEntryChange = { minutes: number; note: string | null; billable: boolean };

/** The person corrects an entry of an open week: its length, its note, whether it is billed. */
export async function updateTimeEntry(personId: string, entryId: string, change: TimeEntryChange): Promise<{ before: TimeEntryRow; after: TimeEntryRow }> {
  const before = await ownEntry(personId, entryId, db());
  await assertWeekOpen(personId, before.date);
  // A corrected entry is no longer the timer's guess: the flag has done its job.
  const [after] = await db()
    .update(schema.timeEntry)
    .set({ ...change, capped: false, updatedAt: new Date() })
    .where(eq(schema.timeEntry.id, entryId))
    .returning();
  return { before, after };
}

/**
 * The week grid's cell: the person types the total for one task (or category) on one day, and the
 * entries under it are changed to add up to it (`planCellChange`). One transaction.
 */
export async function setCellMinutes(personId: string, date: IsoDate, target: Target, minutes: number): Promise<{ before: number; after: number; changed: string[] }> {
  if (!target.taskId === !target.category) throw new ActionError("time_task_or_category");
  return db().transaction(async (tx) => {
    await assertWeekOpen(personId, date, tx);
    const entries = await tx
      .select({ id: schema.timeEntry.id, minutes: schema.timeEntry.minutes, createdAt: schema.timeEntry.createdAt })
      .from(schema.timeEntry)
      .where(
        and(
          eq(schema.timeEntry.personId, personId),
          eq(schema.timeEntry.date, date),
          target.taskId ? eq(schema.timeEntry.taskId, target.taskId) : and(isNull(schema.timeEntry.taskId), eq(schema.timeEntry.category, target.category!)),
          isNull(schema.timeEntry.deletedAt),
          isNull(schema.timeEntry.timerStartedAt),
        ),
      );
    const before = entries.reduce((sum, entry) => sum + entry.minutes, 0);
    const plan = planCellChange(entries, minutes);
    const now = new Date();
    const changed: string[] = [];
    for (const update of plan.updates) {
      await tx.update(schema.timeEntry).set({ minutes: update.minutes, updatedAt: now }).where(eq(schema.timeEntry.id, update.id));
      changed.push(update.id);
    }
    if (plan.deletes.length > 0) {
      await tx.update(schema.timeEntry).set({ deletedAt: now, updatedAt: now }).where(inArray(schema.timeEntry.id, plan.deletes));
      changed.push(...plan.deletes);
    }
    if (plan.insert) changed.push((await logTime({ personId, date, ...target, minutes: plan.insert, note: null, billable: null }, tx)).id);
    return { before, after: Math.max(0, Math.round(minutes)), changed };
  });
}

// ── The timer ───────────────────────────────────────────────────────────────────────────────

export type RunningTimer = { id: string; taskId: string | null; key: string | null; title: string | null; category: string | null; startedAt: Date };

/** The person's running timer, if any — at most one (a unique index holds it). */
export async function getRunningTimer(personId: string): Promise<RunningTimer | null> {
  const [row] = await db()
    .select({ id: schema.timeEntry.id, taskId: schema.timeEntry.taskId, number: schema.workTask.number, teamKey: schema.workTeam.key, title: schema.task.title, category: schema.timeEntry.category, startedAt: schema.timeEntry.timerStartedAt })
    .from(schema.timeEntry)
    .leftJoin(schema.task, eq(schema.task.id, schema.timeEntry.taskId))
    .leftJoin(schema.workTask, eq(schema.workTask.taskId, schema.timeEntry.taskId))
    .leftJoin(schema.workTeam, eq(schema.workTeam.id, schema.workTask.teamId))
    .where(and(eq(schema.timeEntry.personId, personId), isNotNull(schema.timeEntry.timerStartedAt), isNull(schema.timeEntry.deletedAt)))
    .limit(1);
  if (!row) return null;
  const { number, teamKey, startedAt, ...rest } = row;
  return { ...rest, key: number !== null && teamKey ? taskKey(teamKey, number) : null, startedAt: startedAt! };
}

/**
 * Stops the running timer inside `tx`: the entry takes the start date and the minutes, rounded, cut
 * at 16 hours with a flag. A timer stopped within half a minute leaves nothing behind.
 */
async function stopIn(tx: Tx, personId: string, now: Date): Promise<TimeEntryRow | null> {
  const [running] = await tx
    .select()
    .from(schema.timeEntry)
    .where(and(eq(schema.timeEntry.personId, personId), isNotNull(schema.timeEntry.timerStartedAt), isNull(schema.timeEntry.deletedAt)))
    .for("update")
    .limit(1);
  if (!running) return null;
  const stopped = stopTimer(running.timerStartedAt!, now);
  const [row] = await tx
    .update(schema.timeEntry)
    .set(stopped.minutes > 0 ? { date: stopped.date, weekStart: weekStartOf(stopped.date), minutes: stopped.minutes, capped: stopped.capped, timerStartedAt: null, updatedAt: now } : { timerStartedAt: null, deletedAt: now, updatedAt: now })
    .where(eq(schema.timeEntry.id, running.id))
    .returning();
  return row;
}

export async function stopRunningTimer(personId: string, now: Date = new Date()): Promise<TimeEntryRow | null> {
  return db().transaction((tx) => stopIn(tx, personId, now));
}

/**
 * Starts a timer on a task (or a category) now. One timer per person: a running one is stopped
 * first, in the same transaction, and becomes an entry.
 */
export async function startTimer(personId: string, target: Target, now: Date = new Date()): Promise<{ started: TimeEntryRow; stopped: TimeEntryRow | null }> {
  const date = vietnamDateOf(now);
  return db().transaction(async (tx) => {
    await assertWeekOpen(personId, date, tx);
    const place = await placeOf(target, null, tx);
    const stopped = await stopIn(tx, personId, now);
    const [started] = await tx
      .insert(schema.timeEntry)
      .values({ personId, date, weekStart: weekStartOf(date), ...place, minutes: 0, source: "timer", timerStartedAt: now })
      .returning();
    return { started, stopped };
  });
}

// ── Reading ─────────────────────────────────────────────────────────────────────────────────

export type TimeEntryView = { id: string; date: IsoDate; taskId: string | null; key: string | null; title: string | null; projectId: string | null; projectName: string | null; category: string | null; minutes: number; billable: boolean; note: string | null; source: string; capped: boolean; createdAt: Date };

/** Entries between two dates, newest first. No authorization: callers pass people they may read. */
export async function listTimeOf(personIds: readonly string[], from: IsoDate, to: IsoDate, order: "newest" | "oldest" = "newest"): Promise<(TimeEntryView & { personId: string })[]> {
  if (personIds.length === 0) return [];
  const rows = await db()
    .select({
      id: schema.timeEntry.id,
      personId: schema.timeEntry.personId,
      date: schema.timeEntry.date,
      taskId: schema.timeEntry.taskId,
      number: schema.workTask.number,
      teamKey: schema.workTeam.key,
      title: schema.task.title,
      projectId: schema.timeEntry.projectId,
      projectName: schema.workProject.name,
      category: schema.timeEntry.category,
      minutes: schema.timeEntry.minutes,
      billable: schema.timeEntry.billable,
      note: schema.timeEntry.note,
      source: schema.timeEntry.source,
      capped: schema.timeEntry.capped,
      createdAt: schema.timeEntry.createdAt,
    })
    .from(schema.timeEntry)
    .leftJoin(schema.task, eq(schema.task.id, schema.timeEntry.taskId))
    .leftJoin(schema.workTask, eq(schema.workTask.taskId, schema.timeEntry.taskId))
    .leftJoin(schema.workTeam, eq(schema.workTeam.id, schema.workTask.teamId))
    .leftJoin(schema.workProject, eq(schema.workProject.id, schema.timeEntry.projectId))
    // A running timer (minutes 0) is not yet time spent.
    .where(and(inArray(schema.timeEntry.personId, [...new Set(personIds)]), sql`${schema.timeEntry.date} between ${from} and ${to}`, isNull(schema.timeEntry.deletedAt), isNull(schema.timeEntry.timerStartedAt)))
    .orderBy(...(order === "newest" ? [desc(schema.timeEntry.date), desc(schema.timeEntry.createdAt)] : [asc(schema.timeEntry.date), asc(schema.timeEntry.createdAt)]));
  return rows.map(({ number, teamKey, ...row }) => ({ ...row, key: number !== null && teamKey ? taskKey(teamKey, number) : null }));
}
