"use server";
// Logging time (FR-PJM-24): the quick log on Today and in the end-of-day report, the timer, the week
// grid; the weekly timesheet's submit → approve | return → reopen (FR-PJM-25); the utilisation
// export (FR-PJM-61).
import { getTranslations } from "next-intl/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createAction } from "@/lib/action";
import { todayInVietnam } from "@/lib/dates";
import { type CsvFile, EXPORT_ROW_LIMIT, toCsv } from "@/modules/platform/export/csv";
import { canViewTask, loadTask, loadViewer } from "@/modules/work/service";
import { weekStartOf } from "./engine/rules";
import { parseRowKey } from "./engine/timesheet";
import type { Utilisation } from "./engine/utilisation";
import { TIME_CATEGORIES, type TimeCategory } from "./enums";
import { loadReportReader, loadSubjects } from "./people";
import { canApproveTimesheet } from "./policy";
import { deleteTimeEntry, logTime, setCellMinutes, startTimer, stopRunningTimer, updateTimeEntry, withinTimeWindow } from "./time";
import { decideWeek, findTimesheetWeekById, submitWeek } from "./timesheets";
import { getUtilisation } from "./utilisation";

const blankToNull = (value: unknown) => (typeof value === "string" && value.trim() === "" ? null : value);
const optional = <Schema extends z.ZodType>(schema: Schema) => z.preprocess(blankToNull, schema.nullable().default(null));
const isoDate = z.iso.date();
const monday = isoDate.refine((date) => weekStartOf(date) === date);

function refresh() {
  revalidatePath("/today");
  revalidatePath("/daily", "layout");
}

/** A task one may open, or a category: the task check every way of logging time shares. */
async function mayLogOn(user: Parameters<typeof loadViewer>[0], taskId: string | null): Promise<boolean> {
  if (!taskId) return true;
  const task = await loadTask(taskId);
  return !!task && canViewTask(await loadViewer(user), task.facts);
}

const logTimePipeline = createAction({
  name: "daily.time.log",
  input: z
    .object({
      date: isoDate,
      taskId: optional(z.uuid()),
      category: optional(z.enum(TIME_CATEGORIES)),
      // "1h30", "90", "1.5h" are parsed by the form; the server takes minutes.
      minutes: z.coerce.number().int().min(1).max(24 * 60),
      note: optional(z.string().trim().max(500)),
      // "default" = the project's kind decides.
      billable: z.enum(["default", "yes", "no"]).default("default"),
    })
    .refine((input) => !!input.taskId !== !!input.category, { path: ["taskId"] }),
  // One's own time, on a recent day (or in a returned week), on a task one may open.
  authorize: async (user, input) => (await withinTimeWindow(user.person.id, input.date, todayInVietnam())) && (await mayLogOn(user, input.taskId)),
  run: async ({ user, input }) => {
    const entry = await logTime({ personId: user.person.id, date: input.date, taskId: input.taskId, category: input.category, minutes: input.minutes, note: input.note, billable: input.billable === "default" ? null : input.billable === "yes" });
    refresh();
    return { data: { id: entry.id, billable: entry.billable }, audit: { resource: { type: "time_entry", id: entry.id }, summary: `${entry.date}: ${entry.minutes} min${entry.taskId ? ` on ${entry.taskId}` : ` (${entry.category})`}`, after: entry } };
  },
});
export async function logTimeAction(input: unknown) {
  return logTimePipeline(input);
}

const deleteTimePipeline = createAction({
  name: "daily.time.delete",
  input: z.object({ id: z.uuid() }),
  // The service refuses anyone else's entry and a locked week.
  authorize: () => true,
  run: async ({ user, input }) => {
    const entry = await deleteTimeEntry(user.person.id, input.id);
    refresh();
    return { data: { id: entry.id }, audit: { resource: { type: "time_entry", id: entry.id }, summary: `${entry.date}: −${entry.minutes} min`, before: entry } };
  },
});
export async function deleteTimeEntryAction(input: unknown) {
  return deleteTimePipeline(input);
}

const updateTimePipeline = createAction({
  name: "daily.time.update",
  input: z.object({
    id: z.uuid(),
    minutes: z.coerce.number().int().min(1).max(24 * 60),
    note: optional(z.string().trim().max(500)),
    billable: z.preprocess((value) => value === "on" || value === true || value === "true", z.boolean()),
  }),
  // The service refuses anyone else's entry and a locked week.
  authorize: () => true,
  run: async ({ user, input }) => {
    const { before, after } = await updateTimeEntry(user.person.id, input.id, { minutes: input.minutes, note: input.note, billable: input.billable });
    refresh();
    return { data: { id: after.id }, audit: { resource: { type: "time_entry", id: after.id }, summary: `${after.date}: ${before.minutes} → ${after.minutes} min`, before: { minutes: before.minutes, note: before.note, billable: before.billable }, after: { minutes: after.minutes, note: after.note, billable: after.billable } } };
  },
});
export async function updateTimeEntryAction(input: unknown) {
  return updateTimePipeline(input);
}

const rowKey = z.string().transform((value, context) => {
  const row = parseRowKey(value);
  if (!row || (row.category !== null && !(TIME_CATEGORIES as readonly string[]).includes(row.category)) || (row.taskId !== null && !z.uuid().safeParse(row.taskId).success)) {
    context.addIssue({ code: "custom", message: "row" });
    return z.NEVER;
  }
  return row as { taskId: string; category: null } | { taskId: null; category: TimeCategory };
});

const setCellPipeline = createAction({
  name: "daily.time.cell",
  input: z.object({ date: isoDate, row: rowKey, minutes: z.coerce.number().int().min(0).max(24 * 60) }),
  authorize: async (user, input) => (await withinTimeWindow(user.person.id, input.date, todayInVietnam())) && (await mayLogOn(user, input.row.taskId)),
  run: async ({ user, input }) => {
    const result = await setCellMinutes(user.person.id, input.date, input.row, input.minutes);
    refresh();
    return { data: result, audit: { resource: { type: "time_entry", id: result.changed[0] ?? null }, summary: `${input.date} ${input.row.taskId ?? input.row.category}: ${result.before} → ${result.after} min`, before: { minutes: result.before }, after: { minutes: result.after, entries: result.changed } } };
  },
});
export async function setTimeCellAction(input: unknown) {
  return setCellPipeline(input);
}

// ── The timer ───────────────────────────────────────────────────────────────────────────────

const startTimerPipeline = createAction({
  name: "daily.timer.start",
  input: z.object({ taskId: optional(z.uuid()), category: optional(z.enum(TIME_CATEGORIES)) }).refine((input) => !!input.taskId !== !!input.category, { path: ["taskId"] }),
  authorize: (user, input) => mayLogOn(user, input.taskId),
  run: async ({ user, input }) => {
    const { started, stopped } = await startTimer(user.person.id, input);
    refresh();
    return {
      data: { id: started.id, stopped: stopped && !stopped.deletedAt ? { id: stopped.id, minutes: stopped.minutes } : null },
      audit: { resource: { type: "time_entry", id: started.id }, summary: `timer on ${input.taskId ?? input.category}${stopped ? `; stopped ${stopped.id} at ${stopped.minutes} min` : ""}`, before: stopped ?? undefined, after: started },
    };
  },
});
export async function startTimerAction(input: unknown) {
  return startTimerPipeline(input);
}

const stopTimerPipeline = createAction({
  name: "daily.timer.stop",
  input: z.object({}),
  authorize: () => true,
  run: async ({ user }) => {
    const stopped = await stopRunningTimer(user.person.id);
    refresh();
    return {
      data: stopped ? { id: stopped.id, minutes: stopped.deletedAt ? 0 : stopped.minutes, capped: stopped.capped } : null,
      audit: { resource: { type: "time_entry", id: stopped?.id ?? null }, summary: stopped ? `timer stopped: ${stopped.deletedAt ? "discarded" : `${stopped.minutes} min${stopped.capped ? " (capped)" : ""}`}` : "no timer", after: stopped ?? undefined },
    };
  },
});
export async function stopTimerAction(input: unknown) {
  return stopTimerPipeline(input);
}

// ── The weekly timesheet ────────────────────────────────────────────────────────────────────

const submitWeekPipeline = createAction({
  name: "daily.timesheet.submit",
  input: z.object({ weekStart: monday }),
  // One's own week; the service checks the person's teams approve timesheets.
  authorize: () => true,
  run: async ({ user, input }) => {
    const { before, after } = await submitWeek(user.person.id, input.weekStart, todayInVietnam());
    refresh();
    revalidatePath("/daily/timesheets", "layout");
    return { data: { id: after.id }, audit: { resource: { type: "timesheet_week", id: after.id }, summary: `${after.weekStart}: submitted, ${after.minutes} min`, before: before ? { status: before.status } : undefined, after: { status: after.status, minutes: after.minutes } } };
  },
});
export async function submitWeekAction(input: unknown) {
  return submitWeekPipeline(input);
}

/** The reader approves this week's person (a lead of their team, or their line manager — never themself). */
async function mayDecide(personId: string, weekId: string): Promise<boolean> {
  const week = await findTimesheetWeekById(weekId);
  if (!week) return false;
  const [reader, subjects] = await Promise.all([loadReportReader(personId), loadSubjects([week.personId])]);
  const subject = subjects.get(week.personId);
  return !!subject && canApproveTimesheet(reader, subject);
}

function refreshDecided(personId: string) {
  revalidatePath("/daily/timesheets", "layout");
  revalidatePath(`/daily/timesheets/${personId}`);
}

const decidePipeline = createAction({
  name: "daily.timesheet.decide",
  input: z.object({ id: z.uuid(), decision: z.enum(["approve", "return"]), comment: optional(z.string().trim().max(2000)) }),
  authorize: (user, input) => mayDecide(user.person.id, input.id),
  run: async ({ user, input }) => {
    const reader = await loadReportReader(user.person.id);
    const { before, after } = await decideWeek(reader, input.id, input.decision === "approve" ? { type: "approve" } : { type: "return", comment: input.comment });
    refreshDecided(after.personId);
    return { data: { id: after.id, status: after.status }, audit: { resource: { type: "timesheet_week", id: after.id }, summary: `${after.weekStart}: ${after.status}`, before: { status: before.status }, after: { status: after.status, comment: after.comment } } };
  },
});
export async function decideWeekAction(input: unknown) {
  return decidePipeline(input);
}

const bulkApprovePipeline = createAction({
  name: "daily.timesheet.bulk_approve",
  input: z.object({ ids: z.array(z.uuid()).min(1).max(200) }),
  // Every week must be one the reader approves; one refusal refuses the batch.
  authorize: async (user, input) => (await Promise.all(input.ids.map((id) => mayDecide(user.person.id, id)))).every(Boolean),
  run: async ({ user, input }) => {
    const reader = await loadReportReader(user.person.id);
    const approved: string[] = [];
    for (const id of new Set(input.ids)) {
      const { after } = await decideWeek(reader, id, { type: "approve" });
      approved.push(after.id);
      refreshDecided(after.personId);
    }
    return { data: { approved: approved.length }, audit: { resource: { type: "timesheet_week", id: null }, summary: `approved ${approved.length} weeks`, after: { approved } } };
  },
});
export async function bulkApproveWeeksAction(input: unknown) {
  return bulkApprovePipeline(input);
}

const reopenPipeline = createAction({
  name: "daily.timesheet.reopen",
  input: z.object({ id: z.uuid(), reason: z.string().trim().min(1).max(2000) }),
  authorize: (user, input) => mayDecide(user.person.id, input.id),
  run: async ({ user, input }) => {
    const reader = await loadReportReader(user.person.id);
    const { before, after } = await decideWeek(reader, input.id, { type: "reopen", reason: input.reason });
    refreshDecided(after.personId);
    return { data: { id: after.id }, audit: { resource: { type: "timesheet_week", id: after.id }, summary: `${after.weekStart}: reopened — ${input.reason}`, before: { status: before.status, decidedBy: before.decidedByPersonId }, after: { status: after.status, reason: input.reason } } };
  },
});
export async function reopenWeekAction(input: unknown) {
  return reopenPipeline(input);
}

// ── Utilisation export (FR-PJM-61) ──────────────────────────────────────────────────────────

type ExportRow = { group: string; person: string; week: string; cell: Utilisation };
const hours = (minutes: number) => Math.round((minutes / 60) * 10) / 10;
const percent = (ratio: number | null) => (ratio === null ? "" : Math.round(ratio * 100));

const exportUtilisationPipeline = createAction({
  name: "daily.utilisation.export",
  input: z.object({}),
  // What the page shows the reader, no more: the service builds both from the same lists.
  authorize: () => true,
  run: async ({ user }) => {
    const [t, view] = await Promise.all([getTranslations("daily.utilisation"), getUtilisation({ personId: user.person.id, principal: user.principal }, todayInVietnam())]);
    const rows: ExportRow[] = [];
    for (const group of view.groups) {
      const name = group.kind === "reports" ? t("myReports") : group.name;
      if (group.kind !== "portfolio") for (const person of group.people) view.weeks.forEach((week, index) => rows.push({ group: name, person: person.name, week, cell: person.weeks[index] }));
      view.weeks.forEach((week, index) => rows.push({ group: name, person: t("teamTotal"), week, cell: group.total[index] }));
    }
    const kept = rows.slice(0, EXPORT_ROW_LIMIT);
    const csv = toCsv<ExportRow>(
      [
        { header: t("csv.group"), value: (row) => row.group },
        { header: t("csv.person"), value: (row) => row.person },
        { header: t("csv.week"), value: (row) => row.week },
        { header: t("csv.available"), value: (row) => hours(row.cell.available) },
        { header: t("csv.logged"), value: (row) => hours(row.cell.logged) },
        { header: t("csv.billable"), value: (row) => hours(row.cell.billable) },
        { header: t("csv.utilisation"), value: (row) => percent(row.cell.ratio) },
        { header: t("csv.billableRatio"), value: (row) => percent(row.cell.billableRatio) },
      ],
      kept,
    );
    const file: CsvFile = { fileName: `utilisation-${view.weeks[0]}_${view.weeks.at(-1)}.csv`, csv, rowCount: kept.length, truncated: rows.length > kept.length };
    return { data: file, audit: { resource: { type: "export:daily_utilisation" }, summary: `${file.rowCount} rows`, after: { weeks: view.weeks, groups: view.groups.map((group) => (group.kind === "reports" ? "reports" : `${group.kind}:${group.teamId}`)), rowCount: file.rowCount } } };
  },
});
export async function exportUtilisationAction(input: unknown) {
  return exportUtilisationPipeline(input);
}
