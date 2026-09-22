// What a person did with their work on some days, and what waits for them — read-only, for the
// daily module's Today page, morning plan and end-of-day report (FR-PJM-20..23). No authorization
// inside: every question is about the person's own work (their tasks, their activity, what is
// addressed to them); the daily module decides who may see a report built from it.
//
// **Every title, key, project name, blocker reason and hand-off name here is the person's own view
// of their day.** Showing any of it to somebody else — a lead, a manager, a weekly report — goes
// through the daily module's read-time check first (`daily/labels.ts` + `daily/engine/redact.ts`,
// which ask `canViewTask` / `canViewProject` for that reader): reading someone's report is not
// permission to read the private project they worked on.
import "server-only";
import { and, asc, eq, exists, gte, inArray, isNotNull, isNull, lt, ne, or, type SQL, sql } from "drizzle-orm";
import { alias, type AnyPgColumn } from "drizzle-orm/pg-core";
import { addDays, type IsoDate } from "@/lib/dates";
import { db, schema } from "@/lib/db";
import type { StateCategory } from "./enums";
import { taskKey, WORK_KIND } from "./tasks";

const live = isNull(schema.task.deletedAt);
const open = inArray(schema.task.status, ["todo", "in_progress"]);
// Work still waiting in a team's triage is not anyone's to do yet (FR-PJM-32).
const accepted = or(isNull(schema.workTask.triageStatus), eq(schema.workTask.triageStatus, "accepted"));
// Business days are Vietnam-local (DR-04): a day runs from its midnight in Hanoi to the next.
const startOf = (date: IsoDate) => new Date(`${date}T00:00:00+07:00`);

/** A task as the day screens show it: enough to list, plan and move it. */
export type DayTask = {
  taskId: string;
  key: string;
  title: string;
  teamId: string;
  stateId: string;
  stateName: string;
  category: StateCategory;
  status: "todo" | "in_progress" | "done" | "cancelled";
  dueDate: IsoDate | null;
  estimateMinutes: number | null;
  priority: number | null;
  projectId: string | null;
  projectName: string | null;
  /** Vietnam-local date the task was completed, if it is done. */
  completedOn: IsoDate | null;
  assigneePersonId: string | null;
};

async function selectTasks(where: SQL | undefined): Promise<DayTask[]> {
  const rows = await db()
    .select({
      taskId: schema.task.id,
      number: schema.workTask.number,
      teamKey: schema.workTeam.key,
      title: schema.task.title,
      teamId: schema.workTask.teamId,
      stateId: schema.workTask.stateId,
      stateName: schema.workState.name,
      category: schema.workState.category,
      status: schema.task.status,
      dueDate: schema.task.dueDate,
      estimateMinutes: schema.task.estimateMinutes,
      priority: schema.task.priority,
      projectId: schema.workTask.projectId,
      projectName: schema.workProject.name,
      completedOn: sql<string | null>`to_char(${schema.task.completedAt} at time zone 'Asia/Ho_Chi_Minh', 'YYYY-MM-DD')`,
      assigneePersonId: schema.task.assigneePersonId,
    })
    .from(schema.task)
    .innerJoin(schema.workTask, eq(schema.workTask.taskId, schema.task.id))
    .innerJoin(schema.workTeam, eq(schema.workTeam.id, schema.workTask.teamId))
    .innerJoin(schema.workState, eq(schema.workState.id, schema.workTask.stateId))
    .leftJoin(schema.workProject, eq(schema.workProject.id, schema.workTask.projectId))
    .where(and(eq(schema.task.kind, WORK_KIND), live, where))
    .orderBy(asc(schema.task.dueDate), asc(schema.workTask.number));
  return rows.map(({ number, teamKey, ...row }) => ({ ...row, key: taskKey(teamKey, number), category: row.category as StateCategory }));
}

/**
 * My work, for the morning plan (FR-PJM-21): open tasks assigned to the person or where they
 * collaborate, overdue first, then by due date (no date last).
 */
export async function listOpenWorkOf(personId: string, today: IsoDate): Promise<DayTask[]> {
  const collaborates = exists(
    db()
      .select({ one: sql`1` })
      .from(schema.workTaskPerson)
      .where(and(eq(schema.workTaskPerson.taskId, schema.task.id), eq(schema.workTaskPerson.personId, personId), eq(schema.workTaskPerson.role, "collaborator"))),
  );
  const tasks = await selectTasks(and(open, accepted, or(eq(schema.task.assigneePersonId, personId), collaborates)));
  const rank = (task: DayTask) => (task.dueDate && task.dueDate < today ? 0 : task.dueDate ? 1 : 2);
  return tasks.sort((a, b) => rank(a) - rank(b) || (a.dueDate ?? "").localeCompare(b.dueDate ?? "") || (a.priority ?? 9) - (b.priority ?? 9));
}

/** Named tasks, open or not — the items of a plan, which may have moved on since. Unknown and deleted ids are left out. */
export async function listDayTasks(taskIds: readonly string[]): Promise<DayTask[]> {
  if (taskIds.length === 0) return [];
  return selectTasks(inArray(schema.task.id, [...new Set(taskIds)]));
}

// ── The day's activity ──────────────────────────────────────────────────────────────────────

export type FeedKind = "created" | "moved" | "completed" | "submitted" | "reviewed" | "commented" | "handoff_sent" | "handoff_received" | "blocker_raised" | "blocker_resolved";
export type FeedEvent = { personId: string; kind: FeedKind; taskId: string; key: string; title: string; at: Date; /** A state name, a decision, a reason — shown as it is. */ detail: string | null };

/**
 * Everything the people did to work tasks between two dates (inclusive, Vietnam-local), oldest
 * first: state moves and completions, deliverables handed in, reviews decided, comments,
 * hand-offs sent and received, blockers raised and resolved. The prefill engine turns it into a
 * report; nothing here is filtered for a reader (see the note at the top of this file).
 */
export async function listWorkActivityBetween(personIds: readonly string[], from: IsoDate, to: IsoDate): Promise<FeedEvent[]> {
  const people = [...new Set(personIds)];
  if (people.length === 0 || to < from) return [];
  const [start, end] = [startOf(from), startOf(addDays(to, 1))];
  const within = (column: AnyPgColumn) => and(gte(column, start), lt(column, end));
  const taskColumns = { taskId: schema.task.id, number: schema.workTask.number, teamKey: schema.workTeam.key, title: schema.task.title };

  const moves = db()
    .select({ ...taskColumns, personId: schema.workActivity.actorPersonId, type: schema.workActivity.type, field: schema.workActivity.field, toValue: schema.workActivity.toValue, at: schema.workActivity.createdAt })
    .from(schema.workActivity)
    .innerJoin(schema.task, eq(schema.task.id, schema.workActivity.taskId))
    .innerJoin(schema.workTask, eq(schema.workTask.taskId, schema.task.id))
    .innerJoin(schema.workTeam, eq(schema.workTeam.id, schema.workTask.teamId))
    .where(and(inArray(schema.workActivity.actorPersonId, people), within(schema.workActivity.createdAt), or(eq(schema.workActivity.type, "created"), and(eq(schema.workActivity.type, "field_changed"), eq(schema.workActivity.field, "state"))), live));

  const handedIn = db()
    .select({ ...taskColumns, personId: schema.workDeliverable.submittedByPersonId, version: schema.workDeliverable.version, at: schema.workDeliverable.submittedAt })
    .from(schema.workDeliverable)
    .innerJoin(schema.task, eq(schema.task.id, schema.workDeliverable.taskId))
    .innerJoin(schema.workTask, eq(schema.workTask.taskId, schema.task.id))
    .innerJoin(schema.workTeam, eq(schema.workTeam.id, schema.workTask.teamId))
    .where(and(inArray(schema.workDeliverable.submittedByPersonId, people), within(schema.workDeliverable.submittedAt), live));

  const decided = db()
    .select({ ...taskColumns, personId: schema.workDeliverable.decidedByPersonId, decision: schema.workDeliverable.decision, at: schema.workDeliverable.decidedAt })
    .from(schema.workDeliverable)
    .innerJoin(schema.task, eq(schema.task.id, schema.workDeliverable.taskId))
    .innerJoin(schema.workTask, eq(schema.workTask.taskId, schema.task.id))
    .innerJoin(schema.workTeam, eq(schema.workTeam.id, schema.workTask.teamId))
    .where(and(inArray(schema.workDeliverable.decidedByPersonId, people), isNotNull(schema.workDeliverable.decidedAt), within(schema.workDeliverable.decidedAt), inArray(schema.workDeliverable.decision, ["approved", "changes_requested"]), live));

  const comments = db()
    .select({ ...taskColumns, personId: schema.workComment.authorPersonId, at: schema.workComment.createdAt })
    .from(schema.workComment)
    .innerJoin(schema.task, eq(schema.task.id, schema.workComment.taskId))
    .innerJoin(schema.workTask, eq(schema.workTask.taskId, schema.task.id))
    .innerJoin(schema.workTeam, eq(schema.workTeam.id, schema.workTask.teamId))
    .where(and(inArray(schema.workComment.authorPersonId, people), within(schema.workComment.createdAt), isNull(schema.workComment.deletedAt), live));

  const receiver = alias(schema.person, "receiver");
  const sender = alias(schema.person, "sender");
  const handoffs = db()
    .select({ ...taskColumns, fromPersonId: schema.workHandoff.fromPersonId, toPersonId: schema.workHandoff.toPersonId, kind: schema.workHandoff.kind, fromName: sender.fullName, toName: receiver.fullName, at: schema.workHandoff.createdAt })
    .from(schema.workHandoff)
    .innerJoin(schema.task, eq(schema.task.id, schema.workHandoff.taskId))
    .innerJoin(schema.workTask, eq(schema.workTask.taskId, schema.task.id))
    .innerJoin(schema.workTeam, eq(schema.workTeam.id, schema.workTask.teamId))
    .leftJoin(sender, eq(sender.id, schema.workHandoff.fromPersonId))
    .leftJoin(receiver, eq(receiver.id, schema.workHandoff.toPersonId))
    .where(and(or(inArray(schema.workHandoff.fromPersonId, people), inArray(schema.workHandoff.toPersonId, people)), within(schema.workHandoff.createdAt), ne(schema.workHandoff.status, "cancelled"), live));

  const raised = db()
    .select({ ...taskColumns, personId: schema.workBlocker.raisedByPersonId, reason: schema.workBlocker.reason, at: schema.workBlocker.raisedAt })
    .from(schema.workBlocker)
    .innerJoin(schema.task, eq(schema.task.id, schema.workBlocker.taskId))
    .innerJoin(schema.workTask, eq(schema.workTask.taskId, schema.task.id))
    .innerJoin(schema.workTeam, eq(schema.workTeam.id, schema.workTask.teamId))
    .where(and(inArray(schema.workBlocker.raisedByPersonId, people), within(schema.workBlocker.raisedAt), live));

  const resolved = db()
    .select({ ...taskColumns, personId: schema.workBlocker.resolvedByPersonId, reason: schema.workBlocker.reason, at: schema.workBlocker.resolvedAt })
    .from(schema.workBlocker)
    .innerJoin(schema.task, eq(schema.task.id, schema.workBlocker.taskId))
    .innerJoin(schema.workTask, eq(schema.workTask.taskId, schema.task.id))
    .innerJoin(schema.workTeam, eq(schema.workTeam.id, schema.workTask.teamId))
    .where(and(inArray(schema.workBlocker.resolvedByPersonId, people), isNotNull(schema.workBlocker.resolvedAt), within(schema.workBlocker.resolvedAt), live));

  const [moveRows, handedInRows, decidedRows, commentRows, handoffRows, raisedRows, resolvedRows] = await Promise.all([moves, handedIn, decided, comments, handoffs, raised, resolved]);
  const base = (row: { taskId: string; number: number; teamKey: string; title: string }) => ({ taskId: row.taskId, key: taskKey(row.teamKey, row.number), title: row.title });
  const events: FeedEvent[] = [];
  for (const row of moveRows) {
    if (!row.personId) continue;
    if (row.type === "created") {
      events.push({ ...base(row), personId: row.personId, kind: "created", at: row.at, detail: null });
      continue;
    }
    const to = row.toValue as { name?: string; category?: string } | null;
    events.push({ ...base(row), personId: row.personId, kind: to?.category === "done" ? "completed" : "moved", at: row.at, detail: to?.name ?? null });
  }
  for (const row of handedInRows) events.push({ ...base(row), personId: row.personId, kind: "submitted", at: row.at, detail: `v${row.version}` });
  for (const row of decidedRows) if (row.personId && row.at) events.push({ ...base(row), personId: row.personId, kind: "reviewed", at: row.at, detail: row.decision });
  for (const row of commentRows) if (row.personId) events.push({ ...base(row), personId: row.personId, kind: "commented", at: row.at, detail: null });
  for (const row of handoffRows) {
    if (row.fromPersonId && people.includes(row.fromPersonId)) events.push({ ...base(row), personId: row.fromPersonId, kind: "handoff_sent", at: row.at, detail: row.toName });
    if (row.toPersonId && people.includes(row.toPersonId)) events.push({ ...base(row), personId: row.toPersonId, kind: "handoff_received", at: row.at, detail: row.fromName });
  }
  for (const row of raisedRows) events.push({ ...base(row), personId: row.personId, kind: "blocker_raised", at: row.at, detail: row.reason });
  for (const row of resolvedRows) if (row.personId && row.at) events.push({ ...base(row), personId: row.personId, kind: "blocker_resolved", at: row.at, detail: row.reason });
  return events.sort((a, b) => a.at.getTime() - b.at.getTime());
}

// ── What waits for the person ───────────────────────────────────────────────────────────────

export type HandoffWaiting = { handoffId: string; taskId: string; key: string; title: string; kind: string; fromName: string | null; createdAt: Date };

/** Hand-offs addressed to the person and not yet answered (FR-PJM-41). Accepting happens on the task. */
export async function listHandoffsWaitingFor(personId: string): Promise<HandoffWaiting[]> {
  const rows = await db()
    .select({ handoffId: schema.workHandoff.id, taskId: schema.task.id, number: schema.workTask.number, teamKey: schema.workTeam.key, title: schema.task.title, kind: schema.workHandoff.kind, fromName: schema.person.fullName, createdAt: schema.workHandoff.createdAt })
    .from(schema.workHandoff)
    .innerJoin(schema.task, eq(schema.task.id, schema.workHandoff.taskId))
    .innerJoin(schema.workTask, eq(schema.workTask.taskId, schema.task.id))
    .innerJoin(schema.workTeam, eq(schema.workTeam.id, schema.workTask.teamId))
    .leftJoin(schema.person, eq(schema.person.id, schema.workHandoff.fromPersonId))
    .where(and(eq(schema.workHandoff.toPersonId, personId), eq(schema.workHandoff.status, "pending"), live))
    .orderBy(asc(schema.workHandoff.createdAt));
  return rows.map(({ number, teamKey, ...row }) => ({ ...row, key: taskKey(teamKey, number) }));
}

export type OpenBlocker = { blockerId: string; taskId: string; key: string; title: string; reason: string; raisedByPersonId: string; raisedByName: string | null; neededPersonId: string | null; neededName: string | null; raisedAt: Date };

/**
 * Open blockers (FR-PJM-28) raised by any of these people — the board asks for a whole team at
 * once; blockers waiting on someone are `listBlockersWaitingOn` (blockers.ts). The reason and the
 * task's title are the raiser's: a caller showing them to anyone else labels them for that reader.
 */
export async function listOpenBlockersRaisedBy(personIds: readonly string[]): Promise<OpenBlocker[]> {
  const raisedBy = [...new Set(personIds)];
  if (raisedBy.length === 0) return [];
  const raiser = alias(schema.person, "raiser");
  const needed = alias(schema.person, "needed");
  const rows = await db()
    .select({ blockerId: schema.workBlocker.id, taskId: schema.task.id, number: schema.workTask.number, teamKey: schema.workTeam.key, title: schema.task.title, reason: schema.workBlocker.reason, raisedByPersonId: schema.workBlocker.raisedByPersonId, raisedByName: raiser.fullName, neededPersonId: schema.workBlocker.neededPersonId, neededName: needed.fullName, raisedAt: schema.workBlocker.raisedAt })
    .from(schema.workBlocker)
    .innerJoin(schema.task, eq(schema.task.id, schema.workBlocker.taskId))
    .innerJoin(schema.workTask, eq(schema.workTask.taskId, schema.task.id))
    .innerJoin(schema.workTeam, eq(schema.workTeam.id, schema.workTask.teamId))
    .leftJoin(raiser, eq(raiser.id, schema.workBlocker.raisedByPersonId))
    .leftJoin(needed, eq(needed.id, schema.workBlocker.neededPersonId))
    .where(and(isNull(schema.workBlocker.resolvedAt), live, inArray(schema.workBlocker.raisedByPersonId, raisedBy)))
    .orderBy(asc(schema.workBlocker.raisedAt));
  return rows.map(({ number, teamKey, ...row }) => ({ ...row, key: taskKey(teamKey, number) }));
}
