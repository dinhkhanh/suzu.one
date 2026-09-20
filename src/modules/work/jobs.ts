// Work management's scheduled jobs.
import "server-only";
import { and, eq, inArray, isNotNull, isNull, lte } from "drizzle-orm";
import { addDays, type IsoDate } from "@/lib/dates";
import { db, schema } from "@/lib/db";
import type { JobDefinition } from "../platform/jobs/service";
import { notify } from "../platform/notifications/service";
import { type ReminderKind, reminderFor } from "./engine/reminders";
import { generateOccurrences } from "./recurrences";
import { taskKey, WORK_KIND } from "./tasks";

/**
 * Due tomorrow / overdue (FR-WRK-17), to the assignee: one notice per person, kind and day however
 * many tasks it covers. `work_reminder_sent` makes a second run on the same day send nothing.
 */
export async function sendWorkReminders(today: IsoDate): Promise<{ dueSoon: number; overdue: number; people: number }> {
  const rows = await db()
    .select({ id: schema.task.id, title: schema.task.title, dueDate: schema.task.dueDate, assigneeId: schema.task.assigneePersonId, number: schema.workTask.number, teamKey: schema.workTeam.key })
    .from(schema.task)
    .innerJoin(schema.workTask, eq(schema.workTask.taskId, schema.task.id))
    .innerJoin(schema.workTeam, eq(schema.workTeam.id, schema.workTask.teamId))
    .where(and(eq(schema.task.kind, WORK_KIND), isNull(schema.task.deletedAt), inArray(schema.task.status, ["todo", "in_progress"]), isNotNull(schema.task.assigneePersonId), isNotNull(schema.task.dueDate), lte(schema.task.dueDate, addDays(today, 1))))
    .orderBy(schema.task.dueDate, schema.workTask.number);

  const sent = { due_soon: 0, overdue: 0 };
  const people = new Set<string>();
  const due = rows.flatMap((row) => {
    const kind = reminderFor(row.dueDate!, today);
    return kind ? [{ ...row, kind, assigneeId: row.assigneeId! }] : [];
  });
  for (const [groupKey, own] of Map.groupBy(due, (row) => `${row.assigneeId}:${row.kind}`)) {
    const [assigneeId, kind] = groupKey.split(":") as [string, ReminderKind];
    await db().transaction(async (tx) => {
      const fresh = await tx.insert(schema.workReminderSent).values(own.map((row) => ({ taskId: row.id, personId: assigneeId, kind, sentOn: today }))).onConflictDoNothing().returning({ taskId: schema.workReminderSent.taskId });
      const tasks = own.filter((row) => fresh.some((mark) => mark.taskId === row.id));
      if (tasks.length === 0) return;
      const [first] = tasks;
      await notify({ recipients: [assigneeId], kind: kind === "due_soon" ? "tasks.due_soon" : "tasks.overdue", params: { count: tasks.length, key: taskKey(first.teamKey, first.number), title: first.title, dueDate: first.dueDate!.split("-").reverse().join("/") }, link: tasks.length === 1 ? `/work/tasks/${first.id}` : "/tasks" }, tx);
      sent[kind] += tasks.length;
      people.add(assigneeId);
    });
  }
  return { dueSoon: sent.due_soon, overdue: sent.overdue, people: people.size };
}

export const workRemindersJob: JobDefinition = { name: "work-reminders", run: ({ today }) => sendWorkReminders(today) };

/** Recurring tasks (FR-WRK-11): at midnight, so the morning's reminders and digest already know them. */
export const workRecurringJob: JobDefinition = { name: "work-recurring", run: ({ today }) => generateOccurrences(today) };
