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
import { addDays, type IsoDate, todayInVietnam } from "@/lib/dates";
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

/**
 * Takes the week's lock for the rest of the transaction and says whether the week is still open.
 * Every write of time — a log, a cell, a correction, a deletion, a timer stopping — and the
 * submission of the week take this same lock, so a submission never races an entry into the week it
 * is locking: whichever comes second sees the other's result. An advisory lock rather than a row
 * lock because a week that was never submitted has no row to lock.
 */
export async function lockTimesheetWeek(tx: Tx, personId: string, weekStart: IsoDate): Promise<TimesheetStatus | null> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`timesheet_week:${personId}:${weekStart}`}))`);
  return weekStatusOf(personId, weekStart, tx);
}

async function assertWeekOpen(tx: Tx, personId: string, date: IsoDate): Promise<TimesheetStatus | null> {
  const status = await lockTimesheetWeek(tx, personId, weekStartOf(date));
  if (!isWeekEditable(status)) throw new ActionError("time_week_locked");
  return status;
}

/** The window rule itself: not in the future, and recent — or in a week the approver returned. */
const inWindow = (date: IsoDate, today: IsoDate, status: TimesheetStatus | null) => date <= today && (date >= addDays(today, -TIME_BACKFILL_DAYS) || status === "returned");

/** May the person still write on this date: not in the future, and recent — or in a returned week. */
export async function withinTimeWindow(personId: string, date: IsoDate, today: IsoDate): Promise<boolean> {
  if (date > today) return false;
  if (date >= addDays(today, -TIME_BACKFILL_DAYS)) return true;
  return inWindow(date, today, await weekStatusOf(personId, weekStartOf(date)));
}

/** Whether time on this project is billed by default: client projects and retainers are. */
export async function billableByDefault(projectId: string | null, executor: Executor = db()): Promise<boolean> {
  if (!projectId) return false;
  const [plan] = await executor.select({ kind: schema.projectPlan.kind }).from(schema.projectPlan).where(eq(schema.projectPlan.projectId, projectId)).limit(1);
  // A project made before the project layer has no plan row: it is client work unless said otherwise.
  return (BILLABLE_PROJECT_KINDS as readonly string[]).includes(plan?.kind ?? "client");
}

/**
 * The same question for a screenful of tasks at once, in one query: which of these projects' time
 * is billed by default. The quick log shows the answer on the button before anything is logged
 * (Q17: the billable flag is part of everyday logging), so the person can change it there.
 */
export async function billableProjects(projectIds: readonly (string | null)[], executor: Executor = db()): Promise<Set<string>> {
  const ids = [...new Set(projectIds.filter((id): id is string => !!id))];
  if (ids.length === 0) return new Set();
  const rows = await executor.select({ projectId: schema.projectPlan.projectId, kind: schema.projectPlan.kind }).from(schema.projectPlan).where(inArray(schema.projectPlan.projectId, ids));
  const kindOf = new Map(rows.map((row) => [row.projectId, row.kind]));
  return new Set(ids.filter((id) => (BILLABLE_PROJECT_KINDS as readonly string[]).includes(kindOf.get(id) ?? "client")));
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

/** Writes one entry inside `tx`, whose caller already holds the week's lock and found it open. */
async function insertEntry(tx: Tx, input: NewTimeEntry): Promise<TimeEntryRow> {
  const place = await placeOf(input, input.billable, tx);
  const [row] = await tx
    .insert(schema.timeEntry)
    .values({ personId: input.personId, date: input.date, weekStart: weekStartOf(input.date), ...place, minutes: input.minutes, note: input.note, source: "manual" })
    .returning();
  return row;
}

export async function logTime(input: NewTimeEntry): Promise<TimeEntryRow> {
  if (!input.taskId === !input.category) throw new ActionError("time_task_or_category");
  return db().transaction(async (tx) => {
    await assertWeekOpen(tx, input.personId, input.date);
    return insertEntry(tx, input);
  });
}

/** One of the person's own stopped entries, not deleted — locked for the change that follows. */
async function ownEntry(personId: string, entryId: string, tx: Tx): Promise<TimeEntryRow> {
  const [entry] = await tx
    .select()
    .from(schema.timeEntry)
    .where(and(eq(schema.timeEntry.id, entryId), isNull(schema.timeEntry.deletedAt)))
    .for("update")
    .limit(1);
  if (!entry || entry.personId !== personId || entry.timerStartedAt) throw new ActionError("time_entry_not_found");
  return entry;
}

/**
 * An entry the person may still change: theirs, in an open week (the week's lock held from here to
 * the end of `tx`) and inside the window logging has — an old entry is not reached through its id
 * when it could not be logged any more.
 */
async function changeableEntry(tx: Tx, personId: string, entryId: string, today: IsoDate): Promise<TimeEntryRow> {
  const entry = await ownEntry(personId, entryId, tx);
  const status = await assertWeekOpen(tx, personId, entry.date);
  if (!inWindow(entry.date, today, status)) throw new ActionError("time_window_closed");
  return entry;
}

/** Only the person's own entries, and only in an open, recent week. Soft delete: the week's history keeps it. */
export async function deleteTimeEntry(personId: string, entryId: string, today: IsoDate = todayInVietnam()): Promise<TimeEntryRow> {
  return db().transaction(async (tx) => {
    await changeableEntry(tx, personId, entryId, today);
    const [row] = await tx.update(schema.timeEntry).set({ deletedAt: new Date(), updatedAt: new Date() }).where(eq(schema.timeEntry.id, entryId)).returning();
    return row;
  });
}

export type TimeEntryChange = { minutes: number; note: string | null; billable: boolean };

/** The person corrects an entry of an open, recent week: its length, its note, whether it is billed. */
export async function updateTimeEntry(personId: string, entryId: string, change: TimeEntryChange, today: IsoDate = todayInVietnam()): Promise<{ before: TimeEntryRow; after: TimeEntryRow }> {
  return db().transaction(async (tx) => {
    const before = await changeableEntry(tx, personId, entryId, today);
    // A corrected entry is no longer the timer's guess: the flag has done its job.
    const [after] = await tx
      .update(schema.timeEntry)
      .set({ ...change, capped: false, updatedAt: new Date() })
      .where(eq(schema.timeEntry.id, entryId))
      .returning();
    return { before, after };
  });
}

/**
 * The week grid's cell: the person types the total for one task (or category) on one day, and the
 * entries under it are changed to add up to it (`planCellChange`). One transaction.
 */
export async function setCellMinutes(personId: string, date: IsoDate, target: Target, minutes: number): Promise<{ before: number; after: number; changed: string[] }> {
  if (!target.taskId === !target.category) throw new ActionError("time_task_or_category");
  return db().transaction(async (tx) => {
    await assertWeekOpen(tx, personId, date);
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
    if (plan.insert) changed.push((await insertEntry(tx, { personId, date, ...target, minutes: plan.insert, note: null, billable: null })).id);
    return { before, after: Math.max(0, Math.round(minutes)), changed };
  });
}

/**
 * The week grid's billable switch: one row (a task or a category) for a whole week is billed to the
 * client, or is not. Every entry under it in that week follows — the flag belongs to the work, not
 * to the single log — and a week that is submitted, approved or too old to edit refuses, as every
 * other write of time does.
 */
export async function setRowBillable(personId: string, weekStart: IsoDate, target: Target, billable: boolean, today: IsoDate = todayInVietnam()): Promise<{ changed: number }> {
  if (!target.taskId === !target.category) throw new ActionError("time_task_or_category");
  if (weekStartOf(weekStart) !== weekStart || weekStart > today) throw new ActionError("timesheet_week_invalid");
  return db().transaction(async (tx) => {
    const status = await assertWeekOpen(tx, personId, weekStart);
    if (addDays(weekStart, 6) < addDays(today, -TIME_BACKFILL_DAYS) && status !== "returned") throw new ActionError("time_window_closed");
    const changed = await tx
      .update(schema.timeEntry)
      .set({ billable, updatedAt: new Date() })
      .where(
        and(
          eq(schema.timeEntry.personId, personId),
          eq(schema.timeEntry.weekStart, weekStart),
          target.taskId ? eq(schema.timeEntry.taskId, target.taskId) : and(isNull(schema.timeEntry.taskId), eq(schema.timeEntry.category, target.category!)),
          isNull(schema.timeEntry.deletedAt),
        ),
      )
      .returning({ id: schema.timeEntry.id });
    return { changed: changed.length };
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

/** A stopped timer's entry; `weekLocked` when its week was submitted meanwhile and the minutes were not kept. */
export type StoppedTimer = TimeEntryRow & { weekLocked: boolean };

/**
 * Stops the running timer inside `tx`: the entry takes the start date and the minutes, rounded, cut
 * at 16 hours with a flag. A timer stopped within half a minute leaves nothing behind. A timer whose
 * week was submitted or approved while it ran does not write into that week: it is stopped with
 * nothing kept (`weekLocked`), and the person is told — they add the time again once the approver
 * returns the week, if it belongs there.
 */
async function stopIn(tx: Tx, personId: string, now: Date): Promise<StoppedTimer | null> {
  const [running] = await tx
    .select()
    .from(schema.timeEntry)
    .where(and(eq(schema.timeEntry.personId, personId), isNotNull(schema.timeEntry.timerStartedAt), isNull(schema.timeEntry.deletedAt)))
    .for("update")
    .limit(1);
  if (!running) return null;
  const stopped = stopTimer(running.timerStartedAt!, now);
  const weekLocked = stopped.minutes > 0 && !isWeekEditable(await lockTimesheetWeek(tx, personId, weekStartOf(stopped.date)));
  const [row] = await tx
    .update(schema.timeEntry)
    .set(stopped.minutes > 0 && !weekLocked ? { date: stopped.date, weekStart: weekStartOf(stopped.date), minutes: stopped.minutes, capped: stopped.capped, timerStartedAt: null, updatedAt: now } : { minutes: 0, timerStartedAt: null, deletedAt: now, updatedAt: now })
    .where(eq(schema.timeEntry.id, running.id))
    .returning();
  return { ...row, weekLocked };
}

export async function stopRunningTimer(personId: string, now: Date = new Date()): Promise<StoppedTimer | null> {
  return db().transaction((tx) => stopIn(tx, personId, now));
}

/**
 * Starts a timer on a task (or a category) now. One timer per person: a running one is stopped
 * first, in the same transaction, and becomes an entry.
 */
export async function startTimer(personId: string, target: Target, now: Date = new Date()): Promise<{ started: TimeEntryRow; stopped: StoppedTimer | null }> {
  const date = vietnamDateOf(now);
  return db().transaction(async (tx) => {
    await assertWeekOpen(tx, personId, date);
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

/**
 * Entries between two dates, newest first. No authorization: callers pass people they may read —
 * and the task titles and project names here are the person's own view of their week, so a caller
 * showing them to anyone else labels them for that reader first (`loadSeen` + `showTimeLabels`).
 */
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
