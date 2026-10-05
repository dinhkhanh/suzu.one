// Recurring tasks (FR-WRK-11): a rule — on a project, or on a team's backlog — that the daily job
// turns into tasks, each occurrence once, `leadDays` before its date. The occurrence's date is the
// task's due date, unless it falls on a day off of the team's entity: then the task is due the next
// working day, or is not made, or is made anyway, as the rule says (`onDayOff`). A rule can be
// changed; what it has already made stays as it is.
import "server-only";
import { and, asc, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { ActionError } from "@/lib/action";
import { addDays, type IsoDate } from "@/lib/dates";
import { db, schema } from "@/lib/db";
import { getDaysOff } from "@/modules/attendance/service";
import { type DayOffMode, occurrencesBetween, placeOccurrences, type RecurrenceRule, ruleProblems } from "./engine/recurrence";
import type { RecurrenceDraft } from "./schema";
import { createWorkTaskIn } from "./tasks";

export type RecurrenceRow = typeof schema.workRecurrence.$inferSelect;
/** `projectId` null puts the rule on `teamId`'s backlog; with a project, the team is the project's. */
export type RecurrenceInput = { projectId: string | null; teamId?: string | null; title: string; rule: RecurrenceRule; startDate: IsoDate; endDate: IsoDate | null; leadDays: number; onDayOff?: DayOffMode; draft: RecurrenceDraft };
export type RecurrenceScope = { projectId: string } | { teamId: string };

/** How far ahead the next date of a rule is looked for: "every 366 days", "every 12 months" — and a little room to shift past a holiday. */
const NEXT_HORIZON_DAYS = 366 * 2;
const SHIFT_ROOM_DAYS = 14;

export async function findRecurrence(recurrenceId: string): Promise<RecurrenceRow | undefined> {
  const [row] = await db().select().from(schema.workRecurrence).where(eq(schema.workRecurrence.id, recurrenceId)).limit(1);
  return row;
}

/**
 * Is the date a day off for each of these entities (null = the group's own calendar)? Sundays and
 * the working calendar's holidays and company days off — the days a template's due dates avoid
 * too (templates.ts). One read of the calendar per entity, however many rules ask.
 */
async function dayOffChecks(entityIds: readonly (string | null)[], from: IsoDate, to: IsoDate): Promise<Map<string | null, (date: IsoDate) => boolean>> {
  const distinct = [...new Set(entityIds)];
  const lists = await Promise.all(distinct.map((entityId) => getDaysOff(entityId, from, to)));
  return new Map(
    distinct.map((entityId, index) => {
      const off = new Set(lists[index].map((day) => day.date));
      return [entityId, (date: IsoDate) => off.has(date) || new Date(`${date}T00:00:00Z`).getUTCDay() === 0];
    }),
  );
}

export type RecurrenceView = RecurrenceRow & { assigneeName: string | null; /** The day the next task will be due — shifted past a day off where the rule says so. */ nextDate: IsoDate | null; made: number };

/** The rules of a project, or (`teamId`) of a team's own backlog. */
export async function listRecurrences(scope: RecurrenceScope, today: IsoDate): Promise<RecurrenceView[]> {
  const rows = await db()
    .select({ recurrence: schema.workRecurrence, teamEntityId: schema.workTeam.entityId, projectEntityId: schema.workProject.entityId })
    .from(schema.workRecurrence)
    .innerJoin(schema.workTeam, eq(schema.workTeam.id, schema.workRecurrence.teamId))
    .leftJoin(schema.workProject, eq(schema.workProject.id, schema.workRecurrence.projectId))
    .where("projectId" in scope ? eq(schema.workRecurrence.projectId, scope.projectId) : and(eq(schema.workRecurrence.teamId, scope.teamId), isNull(schema.workRecurrence.projectId)))
    .orderBy(asc(schema.workRecurrence.createdAt), asc(schema.workRecurrence.id));
  if (rows.length === 0) return [];
  const assigneeIds = rows.map((row) => row.recurrence.draft.assigneePersonId).filter((id): id is string => !!id);
  const [people, made, offOf] = await Promise.all([
    assigneeIds.length ? db().select({ id: schema.person.id, name: schema.person.fullName }).from(schema.person).where(inArray(schema.person.id, assigneeIds)) : [],
    db().select({ recurrenceId: schema.workTask.recurrenceId, count: sql<number>`count(*)::int` }).from(schema.workTask).where(inArray(schema.workTask.recurrenceId, rows.map((row) => row.recurrence.id))).groupBy(schema.workTask.recurrenceId),
    dayOffChecks(rows.map((row) => row.projectEntityId ?? row.teamEntityId), today, addDays(today, NEXT_HORIZON_DAYS + SHIFT_ROOM_DAYS)),
  ]);
  const names = new Map(people.map((person) => [person.id, person.name]));
  const madeBy = new Map(made.map((row) => [row.recurrenceId, row.count]));
  return rows.map(({ recurrence: row, teamEntityId, projectEntityId }) => {
    const after = row.generatedThrough ? addDays(row.generatedThrough, 1) : today;
    const from = after > today ? after : today;
    const horizon = addDays(from, NEXT_HORIZON_DAYS);
    // The first few of the rule's dates are enough to find one that is kept: a skipped holiday is followed by an ordinary day.
    const dates = row.isActive ? occurrencesBetween(row.rule, row.startDate, from, row.endDate && row.endDate < horizon ? row.endDate : horizon, 12) : [];
    const [next] = placeOccurrences(row.rule, row.startDate, dates, row.onDayOff as DayOffMode, offOf.get(projectEntityId ?? teamEntityId)!);
    return { ...row, assigneeName: row.draft.assigneePersonId ? (names.get(row.draft.assigneePersonId) ?? null) : null, nextDate: next?.due ?? null, made: madeBy.get(row.id) ?? 0 };
  });
}

export async function createRecurrence(input: RecurrenceInput, actorPersonId: string, today: IsoDate): Promise<{ recurrence: RecurrenceRow; made: number }> {
  if (ruleProblems(input.rule).length) throw new ActionError("recurrence_rule_invalid");
  if (input.endDate && input.endDate < input.startDate) throw new ActionError("recurrence_dates_invalid");
  const { teamId: namedTeamId, ...values } = input;
  let teamId: string;
  if (input.projectId) {
    const [project] = await db().select().from(schema.workProject).where(eq(schema.workProject.id, input.projectId)).limit(1);
    if (!project) throw new ActionError("project_not_found");
    if (project.status === "archived") throw new ActionError("project_archived");
    teamId = project.teamId;
  } else {
    // On the team's backlog: tasks outside any project (FR-WRK-11 asks for a rule, not for a project).
    const [team] = namedTeamId ? await db().select({ id: schema.workTeam.id, isActive: schema.workTeam.isActive }).from(schema.workTeam).where(eq(schema.workTeam.id, namedTeamId)).limit(1) : [];
    if (!team || !team.isActive) throw new ActionError("team_not_found");
    teamId = team.id;
  }
  const [recurrence] = await db().insert(schema.workRecurrence).values({ ...values, teamId, createdByPersonId: actorPersonId }).returning();
  // The first occurrences appear at once, not tomorrow morning.
  const { made } = await generateOccurrences(today, recurrence.id);
  return { recurrence, made };
}

export type RecurrencePatch = { title: string; rule: RecurrenceRule; endDate: IsoDate | null; leadDays: number; onDayOff: DayOffMode; assigneePersonId: string | null; estimateMinutes: number | null };

/**
 * Changes a rule: its title, when it comes round, who its tasks go to and how long they are
 * estimated to take, how far ahead they appear, what happens on a day off, when it ends. Only what
 * it makes from now on: the tasks it has already made — the ones waiting in the list too — keep
 * their title, their date and their assignee, and nobody's work is rewritten behind their back.
 * When the dates change, the days ahead that the old rule had already looked at are looked at again
 * under the new one (a date already made is never made twice: work_task's unique guard).
 */
export async function updateRecurrence(recurrenceId: string, patch: RecurrencePatch, today: IsoDate): Promise<{ before: RecurrenceRow; after: RecurrenceRow; made: number }> {
  if (ruleProblems(patch.rule).length) throw new ActionError("recurrence_rule_invalid");
  const before = await findRecurrence(recurrenceId);
  if (!before) throw new ActionError("recurrence_not_found");
  if (patch.endDate && patch.endDate < before.startDate) throw new ActionError("recurrence_dates_invalid");
  const { assigneePersonId, estimateMinutes, ...columns } = patch;
  const rescheduled = JSON.stringify(patch.rule) !== JSON.stringify(before.rule) || patch.onDayOff !== before.onDayOff || patch.leadDays !== before.leadDays || patch.endDate !== before.endDate;
  const [after] = await db()
    .update(schema.workRecurrence)
    .set({
      ...columns,
      draft: { ...before.draft, assigneePersonId, estimateMinutes },
      // Back to yesterday: the run below goes over the days ahead again, under the rule as it now stands.
      ...(rescheduled && before.generatedThrough && before.generatedThrough >= today ? { generatedThrough: addDays(today, -1) } : {}),
      updatedAt: new Date(),
    })
    .where(eq(schema.workRecurrence.id, recurrenceId))
    .returning();
  const { made } = after.isActive ? await generateOccurrences(today, after.id) : { made: 0 };
  return { before, after, made };
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
 *
 * An occurrence on a day off of the rule's entity — the project's, else the team's — is placed as
 * the rule says (`placeOccurrences`): due the next working day, dropped, or kept. It is still
 * known by the rule's own date, so a shifted occurrence is made once like any other.
 */
export async function generateOccurrences(today: IsoDate, onlyRecurrenceId?: string): Promise<{ recurrences: number; made: number; skipped: number }> {
  const rows = await db()
    .select({ recurrence: schema.workRecurrence, projectStatus: schema.workProject.status, projectEntityId: schema.workProject.entityId, teamActive: schema.workTeam.isActive, teamEntityId: schema.workTeam.entityId })
    .from(schema.workRecurrence)
    .innerJoin(schema.workTeam, eq(schema.workTeam.id, schema.workRecurrence.teamId))
    .leftJoin(schema.workProject, eq(schema.workProject.id, schema.workRecurrence.projectId))
    .where(and(eq(schema.workRecurrence.isActive, true), onlyRecurrenceId ? eq(schema.workRecurrence.id, onlyRecurrenceId) : undefined));

  // What each rule still has to look at, before anything is read about days off.
  const due = rows.flatMap(({ recurrence, projectStatus, projectEntityId, teamActive, teamEntityId }) => {
    if (!teamActive || projectStatus === "archived" || projectStatus === "done") return [];
    // A rule created with a start date in the past begins today; a job that missed days catches up.
    const from = recurrence.generatedThrough ? addDays(recurrence.generatedThrough, 1) : recurrence.startDate > today ? recurrence.startDate : today;
    const horizon = addDays(today, recurrence.leadDays);
    const to = recurrence.endDate && recurrence.endDate < horizon ? recurrence.endDate : horizon;
    return from > to ? [] : [{ recurrence, from, to, entityId: projectEntityId ?? teamEntityId }];
  });
  if (due.length === 0) return { recurrences: rows.length, made: 0, skipped: 0 };
  const earliest = due.map((row) => row.from).sort()[0];
  const latest = due.map((row) => row.to).sort().at(-1)!;
  const offOf = await dayOffChecks(due.map((row) => row.entityId), earliest, addDays(latest, SHIFT_ROOM_DAYS));

  let made = 0;
  let skipped = 0;
  for (const { recurrence, from, to, entityId } of due) {
    const placed = placeOccurrences(recurrence.rule, recurrence.startDate, occurrencesBetween(recurrence.rule, recurrence.startDate, from, to, 120), recurrence.onDayOff as DayOffMode, offOf.get(entityId)!);
    for (const { occurrence: occurrenceDate, due: dueDate } of placed) {
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
          { teamId: recurrence.teamId, projectId: recurrence.projectId, title: recurrence.title, description: draft.description ?? null, assigneePersonId: assignee?.id ?? null, requesterPersonId: recurrence.createdByPersonId, priority: draft.priority ?? null, estimateMinutes: draft.estimateMinutes ?? null, clientId: client?.id, channel: draft.channel ?? null, contentFormat: draft.contentFormat ?? null, labelIds: labels.map((label) => label.id), dueDate, recurrence: { id: recurrence.id, occurrenceDate } },
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
