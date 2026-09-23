// 1:1 meeting notes (FR-PRF-04, S). A manager and the person they manage keep one page per
// meeting: a shared agenda and shared notes both read, and a private column **only the manager
// ever sees** — the policy refuses the subject that field and a test proves it.
//
// An action item is not a second to-do list: it becomes a real task in the task engine (ADR-10),
// so it turns up in "my tasks" beside everything else and is closed there.
//
// No authorization inside; `one-on-one-actions.ts` checks first.
import "server-only";
import { and, desc, eq, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { ActionError } from "@/lib/action";
import { db, schema, type Tx } from "@/lib/db";
import type { IsoDate } from "@/lib/dates";
import { createTask, setTaskStatus } from "@/modules/platform/tasks-engine/service";

type Executor = Tx | ReturnType<typeof db>;
export type OneOnOneRow = typeof schema.oneOnOne.$inferSelect;
export type OneOnOneActionRow = typeof schema.oneOnOneAction.$inferSelect;

export const ONE_ON_ONE_CONTEXT = "one_on_one";

/** A meeting as somebody may read it: the private notes are already gone when `seesPrivate` is false. */
export type OneOnOneView = Omit<OneOnOneRow, "privateNotes"> & { privateNotes: string | null; managerName: string; personName: string; actions: OneOnOneActionRow[] };

export async function findOneOnOne(meetingId: string, executor: Executor = db()): Promise<OneOnOneRow | null> {
  const [row] = await executor.select().from(schema.oneOnOne).where(eq(schema.oneOnOne.id, meetingId)).limit(1);
  return row ?? null;
}

/**
 * One meeting, with the private notes stripped unless the reader is allowed them. Stripping here
 * rather than in the page means no screen can leak the column by forgetting to.
 */
export async function loadOneOnOne(meetingId: string, options: { seesPrivate: boolean }, executor: Executor = db()): Promise<OneOnOneView | null> {
  const [found, actions] = await Promise.all([
    namedMeetings(executor).where(eq(schema.oneOnOne.id, meetingId)).limit(1),
    executor.select().from(schema.oneOnOneAction).where(eq(schema.oneOnOneAction.meetingId, meetingId)).orderBy(schema.oneOnOneAction.createdAt),
  ]);
  const [meeting] = found;
  if (!meeting) return null;
  const { row, managerName, personName } = meeting;
  return { ...row, privateNotes: options.seesPrivate ? row.privateNotes : null, managerName: managerName ?? "—", personName: personName ?? "—", actions };
}

/** Meetings with the two parties' names joined on. */
function namedMeetings(executor: Executor) {
  const manager = alias(schema.person, "manager");
  const subject = alias(schema.person, "subject");
  return executor
    .select({ row: schema.oneOnOne, managerName: manager.fullName, personName: subject.fullName, actionCount: sql<number>`(${db().select({ value: sql<number>`count(*)::int` }).from(schema.oneOnOneAction).where(eq(schema.oneOnOneAction.meetingId, schema.oneOnOne.id))})` })
    .from(schema.oneOnOne)
    .leftJoin(manager, eq(manager.id, schema.oneOnOne.managerPersonId))
    .leftJoin(subject, eq(subject.id, schema.oneOnOne.personId))
    .$dynamic();
}

/**
 * Every meeting this person is a party to — as the manager, or as the subject **once the manager
 * has shared it**. A draft is the manager's until then (`canReadOneOnOne`).
 */
export async function listOneOnOnes(personId: string, executor: Executor = db()): Promise<{ row: OneOnOneRow; managerName: string; personName: string; actionCount: number }[]> {
  const rows = await namedMeetings(executor)
    .where(or(eq(schema.oneOnOne.managerPersonId, personId), and(eq(schema.oneOnOne.personId, personId), eq(schema.oneOnOne.status, "shared"))))
    .orderBy(desc(schema.oneOnOne.meetingOn));
  return rows.map(({ row, managerName, personName, actionCount }) => ({ row, managerName: managerName ?? "—", personName: personName ?? "—", actionCount }));
}

export type OneOnOneInput = { personId: string; meetingOn: IsoDate; agenda: string | null; sharedNotes: string | null; privateNotes: string | null };

export async function createOneOnOne(input: OneOnOneInput, managerPersonId: string, executor: Executor = db()): Promise<OneOnOneRow> {
  if (input.personId === managerPersonId) throw new ActionError("one_on_one_with_self");
  const [created] = await executor.insert(schema.oneOnOne).values({ ...input, managerPersonId }).returning();
  return created;
}

/**
 * `privateNotes` left out (`undefined`) keeps the stored column exactly as it was: a writer who may
 * not read the manager's private notes — HR — was never shown them, so their save must not wipe them.
 */
export async function updateOneOnOne(meetingId: string, input: Omit<OneOnOneInput, "personId" | "privateNotes"> & { privateNotes?: string | null }, executor: Executor = db()): Promise<{ before: OneOnOneRow; after: OneOnOneRow }> {
  const before = await findOneOnOne(meetingId, executor);
  if (!before) throw new ActionError("one_on_one_not_found");
  const { privateNotes, ...shared } = input;
  const [after] = await executor
    .update(schema.oneOnOne)
    .set({ ...shared, ...(privateNotes === undefined ? {} : { privateNotes }), updatedAt: new Date() })
    .where(eq(schema.oneOnOne.id, meetingId))
    .returning();
  return { before, after };
}

/** Sharing hands the agenda and the shared notes to the person. The private column never moves. */
export async function shareOneOnOne(meetingId: string, executor: Executor = db()): Promise<{ before: OneOnOneRow; after: OneOnOneRow }> {
  const before = await findOneOnOne(meetingId, executor);
  if (!before) throw new ActionError("one_on_one_not_found");
  if (before.status === "shared") throw new ActionError("one_on_one_shared");
  const [after] = await executor.update(schema.oneOnOne).set({ status: "shared", sharedAt: new Date(), updatedAt: new Date() }).where(eq(schema.oneOnOne.id, meetingId)).returning();
  return { before, after };
}

/**
 * An action item, and the task it becomes. The task is the record of the work; this row only
 * remembers that the meeting asked for it, and which task it turned into.
 */
export async function addOneOnOneAction(input: { meetingId: string; title: string; assigneePersonId: string | null; dueOn: IsoDate | null }, actorPersonId: string, executor: ReturnType<typeof db> = db()): Promise<OneOnOneActionRow> {
  const meeting = await findOneOnOne(input.meetingId, executor);
  if (!meeting) throw new ActionError("one_on_one_not_found");
  return executor.transaction(async (tx) => {
    const [created] = await tx.insert(schema.oneOnOneAction).values({ meetingId: input.meetingId, title: input.title, assigneePersonId: input.assigneePersonId, dueOn: input.dueOn }).returning();
    const task = await createTask(
      tx,
      {
        kind: ONE_ON_ONE_CONTEXT,
        title: input.title,
        // Whoever was named, else the person the meeting is about: an action item has an owner.
        assigneePersonId: input.assigneePersonId ?? meeting.personId,
        subjectPersonId: meeting.personId,
        dueDate: input.dueOn,
        context: { type: ONE_ON_ONE_CONTEXT, id: input.meetingId },
      },
      actorPersonId,
      { notify: true },
    );
    const [linked] = await tx.update(schema.oneOnOneAction).set({ taskId: task.id, updatedAt: new Date() }).where(eq(schema.oneOnOneAction.id, created.id)).returning();
    return linked;
  });
}

/** Ticking an action item off ticks its task off too: one thing, not two. */
export async function completeOneOnOneAction(actionId: string, actorPersonId: string, executor: Executor = db()): Promise<OneOnOneActionRow> {
  const [row] = await executor.select().from(schema.oneOnOneAction).where(eq(schema.oneOnOneAction.id, actionId)).limit(1);
  if (!row) throw new ActionError("one_on_one_action_not_found");
  if (row.taskId) await setTaskStatus(row.taskId, "done", actorPersonId, executor);
  return row;
}

export async function findOneOnOneAction(actionId: string, executor: Executor = db()): Promise<{ action: OneOnOneActionRow; meeting: OneOnOneRow } | null> {
  const [row] = await executor
    .select({ action: schema.oneOnOneAction, meeting: schema.oneOnOne })
    .from(schema.oneOnOneAction)
    .innerJoin(schema.oneOnOne, eq(schema.oneOnOne.id, schema.oneOnOneAction.meetingId))
    .where(eq(schema.oneOnOneAction.id, actionId))
    .limit(1);
  return row ?? null;
}

/** Whom a manager may open a 1:1 with — their own reports. Navigation only; the action re-checks. */
export async function myReports(managerPersonId: string, executor: Executor = db()): Promise<{ id: string; fullName: string }[]> {
  return executor.select({ id: schema.person.id, fullName: schema.person.fullName }).from(schema.person).where(and(eq(schema.person.managerId, managerPersonId), eq(schema.person.status, "active"))).orderBy(schema.person.searchName);
}
