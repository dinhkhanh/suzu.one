// Recurring tasks (FR-WRK-11): a rule on a project that the daily job turns into tasks, each
// occurrence once, `leadDays` before its date. The occurrence's date is the task's due date.
import "server-only";
import { and, asc, eq, inArray, ne } from "drizzle-orm";
import { ActionError } from "@/lib/action";
import { addDays, type IsoDate } from "@/lib/dates";
import { db, schema } from "@/lib/db";
import { nextOccurrence, occurrencesBetween, type RecurrenceRule, ruleProblems } from "./engine/recurrence";
import type { RecurrenceDraft } from "./schema";
import { createWorkTaskIn } from "./tasks";

export type RecurrenceRow = typeof schema.workRecurrence.$inferSelect;
export type RecurrenceInput = { projectId: string; title: string; rule: RecurrenceRule; startDate: IsoDate; endDate: IsoDate | null; leadDays: number; draft: RecurrenceDraft };

export async function findRecurrence(recurrenceId: string): Promise<RecurrenceRow | undefined> {
  const [row] = await db().select().from(schema.workRecurrence).where(eq(schema.workRecurrence.id, recurrenceId)).limit(1);
  return row;
}

export type RecurrenceView = RecurrenceRow & { assigneeName: string | null; nextDate: IsoDate | null; made: number };

export async function listRecurrences(projectId: string, today: IsoDate): Promise<RecurrenceView[]> {
  const rows = await db().select().from(schema.workRecurrence).where(eq(schema.workRecurrence.projectId, projectId)).orderBy(asc(schema.workRecurrence.createdAt));
  if (rows.length === 0) return [];
  const assigneeIds = rows.map((row) => row.draft.assigneePersonId).filter((id): id is string => !!id);
  const [people, made] = await Promise.all([
    assigneeIds.length ? db().select({ id: schema.person.id, name: schema.person.fullName }).from(schema.person).where(inArray(schema.person.id, assigneeIds)) : [],
    db().select({ recurrenceId: schema.workTask.recurrenceId }).from(schema.workTask).where(inArray(schema.workTask.recurrenceId, rows.map((row) => row.id))),
  ]);
  return rows.map((row) => {
    const from = row.generatedThrough ? addDays(row.generatedThrough, 1) : today;
    return { ...row, assigneeName: people.find((person) => person.id === row.draft.assigneePersonId)?.name ?? null, nextDate: row.isActive ? nextOccurrence(row.rule, row.startDate, from > today ? from : today, row.endDate) : null, made: made.filter((task) => task.recurrenceId === row.id).length };
  });
}

export async function createRecurrence(input: RecurrenceInput, actorPersonId: string, today: IsoDate): Promise<{ recurrence: RecurrenceRow; made: number }> {
  if (ruleProblems(input.rule).length) throw new ActionError("recurrence_rule_invalid");
  if (input.endDate && input.endDate < input.startDate) throw new ActionError("recurrence_dates_invalid");
  const [project] = await db().select().from(schema.workProject).where(eq(schema.workProject.id, input.projectId)).limit(1);
  if (!project) throw new ActionError("project_not_found");
  if (project.status === "archived") throw new ActionError("project_archived");
  const [recurrence] = await db().insert(schema.workRecurrence).values({ ...input, teamId: project.teamId, createdByPersonId: actorPersonId }).returning();
  // The first occurrences appear at once, not tomorrow morning.
  const { made } = await generateOccurrences(today, recurrence.id);
  return { recurrence, made };
}

/** Pause / resume, or end for good (`endDate` = today: what was already made stays). */
export async function changeRecurrence(recurrenceId: string, change: { isActive: boolean } | { endDate: IsoDate }): Promise<{ before: RecurrenceRow; after: RecurrenceRow }> {
  const before = await findRecurrence(recurrenceId);
  if (!before) throw new ActionError("recurrence_not_found");
  const [after] = await db().update(schema.workRecurrence).set({ ...("endDate" in change ? { endDate: change.endDate, isActive: false } : { isActive: change.isActive }), updatedAt: new Date() }).where(eq(schema.workRecurrence.id, recurrenceId)).returning();
  return { before, after };
}

/**
 * Makes every occurrence that is due to appear (its date ≤ today + leadDays) and has not been made.
 * Safe to run again: `generated_through` moves forward, and work_task's unique (recurrence,
 * occurrence date) refuses a second copy even if two runs race.
 */
export async function generateOccurrences(today: IsoDate, onlyRecurrenceId?: string): Promise<{ recurrences: number; made: number; skipped: number }> {
  const rows = await db()
    .select({ recurrence: schema.workRecurrence, projectStatus: schema.workProject.status, teamActive: schema.workTeam.isActive })
    .from(schema.workRecurrence)
    .innerJoin(schema.workTeam, eq(schema.workTeam.id, schema.workRecurrence.teamId))
    .leftJoin(schema.workProject, eq(schema.workProject.id, schema.workRecurrence.projectId))
    .where(and(eq(schema.workRecurrence.isActive, true), onlyRecurrenceId ? eq(schema.workRecurrence.id, onlyRecurrenceId) : undefined));

  let made = 0;
  let skipped = 0;
  for (const { recurrence, projectStatus, teamActive } of rows) {
    if (!teamActive || projectStatus === "archived" || projectStatus === "done") continue;
    // A rule created with a start date in the past begins today; a job that missed days catches up.
    const from = recurrence.generatedThrough ? addDays(recurrence.generatedThrough, 1) : recurrence.startDate > today ? recurrence.startDate : today;
    const horizon = addDays(today, recurrence.leadDays);
    const to = recurrence.endDate && recurrence.endDate < horizon ? recurrence.endDate : horizon;
    if (from > to) continue;

    for (const occurrenceDate of occurrencesBetween(recurrence.rule, recurrence.startDate, from, to, 120)) {
      const created = await db().transaction(async (tx) => {
        const [existing] = await tx.select({ taskId: schema.workTask.taskId }).from(schema.workTask).where(and(eq(schema.workTask.recurrenceId, recurrence.id), eq(schema.workTask.occurrenceDate, occurrenceDate))).limit(1);
        if (existing) return false;
        const draft = recurrence.draft;
        // People leave and labels are deleted; the task is still made, without them.
        const [assignee] = draft.assigneePersonId ? await tx.select({ id: schema.person.id }).from(schema.person).where(and(eq(schema.person.id, draft.assigneePersonId), ne(schema.person.status, "offboarded"))).limit(1) : [];
        const labels = draft.labelIds?.length ? await tx.select({ id: schema.workLabel.id }).from(schema.workLabel).where(inArray(schema.workLabel.id, draft.labelIds)) : [];
        const [client] = draft.clientId ? await tx.select({ id: schema.workClient.id }).from(schema.workClient).where(eq(schema.workClient.id, draft.clientId)).limit(1) : [];
        await createWorkTaskIn(
          tx,
          { teamId: recurrence.teamId, projectId: recurrence.projectId, title: recurrence.title, description: draft.description ?? null, assigneePersonId: assignee?.id ?? null, requesterPersonId: recurrence.createdByPersonId, priority: draft.priority ?? null, estimateMinutes: draft.estimateMinutes ?? null, clientId: client?.id, channel: draft.channel ?? null, contentFormat: draft.contentFormat ?? null, labelIds: labels.map((label) => label.id), dueDate: occurrenceDate, recurrence: { id: recurrence.id, occurrenceDate } },
          recurrence.createdByPersonId,
        );
        return true;
      }).catch((error: unknown) => {
        // One rule that cannot make its task (a retired workflow, a vanished project) must not stop the others.
        if (error instanceof ActionError) return null;
        throw error;
      });
      if (created) made++;
      else if (created === null) skipped++;
    }
    await db().update(schema.workRecurrence).set({ generatedThrough: to }).where(eq(schema.workRecurrence.id, recurrence.id));
  }
  return { recurrences: rows.length, made, skipped };
}
