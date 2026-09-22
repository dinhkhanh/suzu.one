// Blockers (FR-PJM-28): a task flagged "blocked" with the reason and whom it waits for. The person
// named and the team's leads hear of it at once; whoever raised it hears when it is resolved. A
// task has at most one open blocker (a unique index), and the time it spent blocked is measured in
// SQL from the rows, never kept as a running number.
import "server-only";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { ActionError } from "@/lib/action";
import type { IsoDate } from "@/lib/dates";
import { db, schema, type Tx } from "@/lib/db";
import { notify } from "../platform/notifications/service";
import { type LoadedTask, loadTask, logActivity, taskKey } from "./tasks";

type Executor = Tx | ReturnType<typeof db>;
export type BlockerRow = typeof schema.workBlocker.$inferSelect;

const taskLink = (taskId: string) => `/work/tasks/${taskId}`;
const label = (loaded: LoadedTask) => `${taskKey(loaded.team.key, loaded.work.number)} ${loaded.task.title}`;
/** Minutes from raising to resolving — or to now, while it is open. */
const blockedMinutesSql = sql<number>`(extract(epoch from (coalesce(${schema.workBlocker.resolvedAt}, now()) - ${schema.workBlocker.raisedAt})) / 60)::int`;

async function teamLeads(tx: Executor, teamId: string): Promise<string[]> {
  const rows = await tx.select({ personId: schema.workTeamMember.personId }).from(schema.workTeamMember).where(and(eq(schema.workTeamMember.teamId, teamId), eq(schema.workTeamMember.role, "lead")));
  return rows.map((row) => row.personId);
}

export async function findOpenBlocker(taskId: string, executor: Executor = db()): Promise<BlockerRow | undefined> {
  const [row] = await executor.select().from(schema.workBlocker).where(and(eq(schema.workBlocker.taskId, taskId), isNull(schema.workBlocker.resolvedAt))).limit(1);
  return row;
}

/**
 * Marks the task blocked. The person it waits for must be someone the task could be given to
 * (checked by the action against the assignable list); they and the team's leads are told.
 */
export async function raiseBlocker(taskId: string, input: { reason: string; neededPersonId: string | null }, actor: { personId: string; fullName: string }): Promise<{ blocker: BlockerRow; loaded: LoadedTask; notified: string[] }> {
  return db().transaction(async (tx) => {
    const loaded = await loadTask(taskId, tx);
    if (!loaded) throw new ActionError("task_not_found");
    if (loaded.task.status === "done" || loaded.task.status === "cancelled") throw new ActionError("blocker_task_closed");
    if (await findOpenBlocker(taskId, tx)) throw new ActionError("blocker_already_open");
    let neededName: string | null = null;
    if (input.neededPersonId) {
      const [person] = await tx.select({ name: schema.person.fullName, status: schema.person.status }).from(schema.person).where(eq(schema.person.id, input.neededPersonId)).limit(1);
      if (!person || person.status === "offboarded") throw new ActionError("person_not_found");
      neededName = person.name;
    }
    // The partial unique index is the real guard: two people pressing at once get one blocker.
    const [blocker] = await tx.insert(schema.workBlocker).values({ taskId, reason: input.reason, neededPersonId: input.neededPersonId, raisedByPersonId: actor.personId }).onConflictDoNothing().returning();
    if (!blocker) throw new ActionError("blocker_already_open");
    await logActivity(tx, taskId, actor.personId, [{ type: "blocker_raised", to: { name: input.reason, needed: neededName } }]);
    const recipients = [...new Set([input.neededPersonId, ...(await teamLeads(tx, loaded.team.id))])].filter((id): id is string => !!id && id !== actor.personId);
    await notify({ recipients, kind: "tasks.blocked", params: { actor: actor.fullName, task: label(loaded), reason: input.reason }, link: taskLink(taskId) }, tx);
    return { blocker, loaded, notified: recipients };
  });
}

/** Resolves the task's open blocker; whoever raised it hears, unless they resolved it themselves. */
export async function resolveBlocker(taskId: string, resolution: string | null, actor: { personId: string; fullName: string }): Promise<{ blocker: BlockerRow; loaded: LoadedTask }> {
  return db().transaction(async (tx) => {
    const loaded = await loadTask(taskId, tx);
    if (!loaded) throw new ActionError("task_not_found");
    const [blocker] = await tx
      .update(schema.workBlocker)
      .set({ resolvedAt: new Date(), resolvedByPersonId: actor.personId, resolution })
      .where(and(eq(schema.workBlocker.taskId, taskId), isNull(schema.workBlocker.resolvedAt)))
      .returning();
    if (!blocker) throw new ActionError("blocker_not_open");
    await logActivity(tx, taskId, actor.personId, [{ type: "blocker_resolved", from: { name: blocker.reason }, to: resolution ? { name: resolution } : null }]);
    if (blocker.raisedByPersonId !== actor.personId) await notify({ recipients: [blocker.raisedByPersonId], kind: "tasks.unblocked", params: { actor: actor.fullName, task: label(loaded) }, link: taskLink(taskId) }, tx);
    return { blocker, loaded };
  });
}

export type BlockerView = { id: string; taskId: string; reason: string; neededPersonId: string | null; neededName: string | null; raisedByPersonId: string; raisedByName: string | null; raisedAt: Date; resolvedAt: Date | null; resolvedByName: string | null; resolution: string | null; minutes: number };

function blockerQuery(executor: Executor) {
  const needed = alias(schema.person, "needed");
  const raiser = alias(schema.person, "raiser");
  const resolver = alias(schema.person, "resolver");
  return executor
    .select({
      id: schema.workBlocker.id,
      taskId: schema.workBlocker.taskId,
      reason: schema.workBlocker.reason,
      neededPersonId: schema.workBlocker.neededPersonId,
      neededName: needed.fullName,
      raisedByPersonId: schema.workBlocker.raisedByPersonId,
      raisedByName: raiser.fullName,
      raisedAt: schema.workBlocker.raisedAt,
      resolvedAt: schema.workBlocker.resolvedAt,
      resolvedByName: resolver.fullName,
      resolution: schema.workBlocker.resolution,
      minutes: blockedMinutesSql,
    })
    .from(schema.workBlocker)
    .leftJoin(needed, eq(needed.id, schema.workBlocker.neededPersonId))
    .leftJoin(raiser, eq(raiser.id, schema.workBlocker.raisedByPersonId))
    .leftJoin(resolver, eq(resolver.id, schema.workBlocker.resolvedByPersonId))
    .$dynamic();
}

/** A task's blockers, the open one first, then newest first — for the task page. */
export async function listTaskBlockers(taskId: string): Promise<BlockerView[]> {
  return blockerQuery(db())
    .where(eq(schema.workBlocker.taskId, taskId))
    .orderBy(sql`${schema.workBlocker.resolvedAt} is null desc`, desc(schema.workBlocker.raisedAt));
}

/**
 * For other modules (EOD board, status update, leader view): the open blockers of these tasks.
 * No access check — the caller already holds task ids the viewer may see.
 */
export async function listOpenBlockers(taskIds: readonly string[], executor: Executor = db()): Promise<BlockerView[]> {
  if (taskIds.length === 0) return [];
  return blockerQuery(executor)
    .where(and(inArray(schema.workBlocker.taskId, [...new Set(taskIds)]), isNull(schema.workBlocker.resolvedAt)))
    .orderBy(asc(schema.workBlocker.raisedAt));
}

export type RaisedBlocker = BlockerView & { key: string; title: string };

function withTask(executor: Executor) {
  const needed = alias(schema.person, "needed");
  const raiser = alias(schema.person, "raiser");
  return executor
    .select({ id: schema.workBlocker.id, taskId: schema.workBlocker.taskId, reason: schema.workBlocker.reason, neededPersonId: schema.workBlocker.neededPersonId, neededName: needed.fullName, raisedByPersonId: schema.workBlocker.raisedByPersonId, raisedByName: raiser.fullName, raisedAt: schema.workBlocker.raisedAt, resolvedAt: schema.workBlocker.resolvedAt, resolution: schema.workBlocker.resolution, minutes: blockedMinutesSql, number: schema.workTask.number, teamKey: schema.workTeam.key, title: schema.task.title })
    .from(schema.workBlocker)
    .innerJoin(schema.task, and(eq(schema.task.id, schema.workBlocker.taskId), isNull(schema.task.deletedAt)))
    .innerJoin(schema.workTask, eq(schema.workTask.taskId, schema.workBlocker.taskId))
    .innerJoin(schema.workTeam, eq(schema.workTeam.id, schema.workTask.teamId))
    .leftJoin(needed, eq(needed.id, schema.workBlocker.neededPersonId))
    .leftJoin(raiser, eq(raiser.id, schema.workBlocker.raisedByPersonId))
    .$dynamic();
}
const present = (rows: Awaited<ReturnType<ReturnType<typeof withTask>["execute"]>>): RaisedBlocker[] => rows.map(({ number, teamKey, ...row }) => ({ ...row, resolvedByName: null, key: taskKey(teamKey, number) }));

/** For the daily report (FR-PJM-21): the blockers a person raised on a day (Vietnam time), resolved or not. */
export async function listBlockersRaisedOn(personId: string, date: IsoDate, executor: Executor = db()): Promise<RaisedBlocker[]> {
  const rows = await withTask(executor)
    .where(and(eq(schema.workBlocker.raisedByPersonId, personId), sql`(${schema.workBlocker.raisedAt} at time zone 'Asia/Ho_Chi_Minh')::date = ${date}::date`))
    .orderBy(asc(schema.workBlocker.raisedAt));
  return present(rows);
}

/** For "My work" and the EOD board: the open blockers waiting on this person. */
export async function listBlockersWaitingOn(personId: string, executor: Executor = db()): Promise<RaisedBlocker[]> {
  const rows = await withTask(executor)
    .where(and(eq(schema.workBlocker.neededPersonId, personId), isNull(schema.workBlocker.resolvedAt)))
    .orderBy(asc(schema.workBlocker.raisedAt));
  return present(rows);
}

/** Total minutes each task spent blocked, the open blocker counted up to now. */
export async function blockedMinutes(taskIds: readonly string[], executor: Executor = db()): Promise<Map<string, number>> {
  if (taskIds.length === 0) return new Map();
  const rows = await executor
    .select({ taskId: schema.workBlocker.taskId, minutes: sql<number>`sum(${blockedMinutesSql})::int` })
    .from(schema.workBlocker)
    .where(inArray(schema.workBlocker.taskId, [...new Set(taskIds)]))
    .groupBy(schema.workBlocker.taskId);
  return new Map(rows.map((row) => [row.taskId, Number(row.minutes)]));
}
