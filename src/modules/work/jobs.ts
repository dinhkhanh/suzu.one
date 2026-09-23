// Work management's scheduled jobs.
import "server-only";
import { and, eq, inArray, isNotNull, isNull, lte } from "drizzle-orm";
import { addDays, type IsoDate } from "@/lib/dates";
import { db, schema } from "@/lib/db";
import type { JobDefinition } from "../platform/jobs/service";
import { notify } from "../platform/notifications/service";
import { runDueDateAutomations } from "./automations";
import { syncCoverPlans } from "./cover";
import { runCycles } from "./cycles";
import { type ReminderKind, reminderFor } from "./engine/reminders";
import { syncExitHandovers } from "./exit";
import { sendPublishReminders } from "./publish";
import { PREVIEW_HIT_RETENTION_DAYS } from "./engine/preview";
import { purgePreviewHits } from "./preview";
import { generateOccurrences } from "./recurrences";
import { sendReviewOverdueReminders } from "./reviews";
import { taskKey, WORK_KIND } from "./tasks";
import { wakeSnoozedTriage } from "./triage";

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

/**
 * The morning's work reminders: due and overdue tasks, review-chain stages past their due time
 * (FR-PJM-50), posts planned for today or missed (FR-PJM-54 — there is no hourly slot, so "due"
 * is the morning of the day), and the "due date reached" automations (FR-PJM-33), whose notices
 * belong to the same moment.
 */
export const workRemindersJob: JobDefinition = {
  name: "work-reminders",
  run: async ({ today }) => {
    const now = new Date();
    return { ...(await sendWorkReminders(today)), ...(await sendReviewOverdueReminders(now)), publish: await sendPublishReminders(now), ...(await runDueDateAutomations(today)) };
  },
};

/** Recurring tasks (FR-WRK-11): at midnight, so the morning's reminders and digest already know them. */
export const workRecurringJob: JobDefinition = { name: "work-recurring", run: ({ today }) => generateOccurrences(today) };

/** Snoozed triage (FR-PJM-32) wakes at midnight: back in the queue before the leads' morning. */
export const workTriageWakeJob: JobDefinition = { name: "work-triage-wake", run: ({ today }) => wakeSnoozedTriage(today) };

/** Cycles (FR-PJM-10) at midnight: yesterday's ended cycle is reviewed and its open work is in the new one before anyone plans the day. */
export const workCyclesJob: JobDefinition = { name: "work-cycles", run: ({ today }) => runCycles(today) };

/**
 * Leave cover (FR-PJM-44) at midnight: drafts for leave filed since, plans of called-off leave
 * cancelled, and the covers of a leave starting today take the work over before the day begins.
 */
export const workCoverJob: JobDefinition = { name: "work-cover", run: ({ today }) => syncCoverPlans(today) };

/** Exit and transfer handovers (FR-PJM-45) at midnight, from the lifecycle events recorded since. */
export const workExitHandoverJob: JobDefinition = { name: "work-exit-handover", run: ({ today }) => syncExitHandovers(new Date(), today) };

/**
 * The client review links' rate limiter (D24, FR-PJM-51a) at midnight. Its rows are hashes of a
 * visitor with an hour's resolution; a week on they are noise, and keeping noise about somebody
 * outside the company is keeping something for no reason (PDPL storage limitation).
 */
export const workPreviewSweepJob: JobDefinition = {
  name: "work-preview-sweep",
  run: async () => ({ previewHits: await purgePreviewHits(new Date(Date.now() - PREVIEW_HIT_RETENTION_DAYS * 24 * 60 * 60 * 1000)) }),
};
