// The daily loop's scheduled jobs: the morning plan reminder, the evening report reminder, the
// Monday weekly reports and the Monday timesheet reminder. Each tells a person once per kind and day (`daily_reminder_sent`), and
// days off — holidays, leave, untracked Saturdays — ask nothing of anyone.
import "server-only";
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { addDays, type IsoDate } from "@/lib/dates";
import { db, schema, type Tx } from "@/lib/db";
import type { JobDefinition } from "@/modules/platform/jobs/service";
import { notify } from "@/modules/platform/notifications/service";
import { dayOf, daysOf } from "./days";
import { isoWeekday, weekStartOf } from "./engine/rules";
import { listTeamPeople, rulesOfPeople } from "./team-rules";
import { generateWeek } from "./weekly";

/** Marks the people as told for the day and returns the ones not told before. */
async function claim(personIds: readonly string[], kind: string, today: IsoDate, tell: (fresh: string[], tx: Tx) => Promise<void>): Promise<number> {
  if (personIds.length === 0) return 0;
  return db().transaction(async (tx) => {
    const fresh = (await tx.insert(schema.dailyReminderSent).values(personIds.map((personId) => ({ personId, kind, sentOn: today }))).onConflictDoNothing().returning({ personId: schema.dailyReminderSent.personId })).map((row) => row.personId);
    if (fresh.length > 0) await tell(fresh, tx);
    return fresh.length;
  });
}

/** Morning (FR-PJM-21): people whose team requires a plan and who have not made today's. */
export async function sendPlanReminders(today: IsoDate): Promise<{ reminded: number }> {
  const people = await listTeamPeople();
  const days = await dayOf(people, today);
  const due = people.filter((personId) => days.get(personId)?.plan.required);
  if (due.length === 0) return { reminded: 0 };
  const planned = await db().select({ personId: schema.dailyPlan.personId }).from(schema.dailyPlan).where(and(inArray(schema.dailyPlan.personId, due), eq(schema.dailyPlan.date, today), isNotNull(schema.dailyPlan.submittedAt)));
  const missing = due.filter((personId) => !planned.some((row) => row.personId === personId));
  const reminded = await claim(missing, "plan", today, (fresh, tx) => notify({ recipients: fresh, kind: "daily.plan_reminder", link: "/daily/plan" }, tx));
  return { reminded };
}

/** Evening (FR-PJM-22): people whose report is required today and not yet in, with their deadline. */
export async function sendReportReminders(today: IsoDate): Promise<{ reminded: number }> {
  const people = await listTeamPeople();
  const days = await dayOf(people, today);
  const due = people.filter((personId) => days.get(personId)?.report.required);
  if (due.length === 0) return { reminded: 0 };
  const submitted = await db().select({ personId: schema.dailyReport.personId }).from(schema.dailyReport).where(and(inArray(schema.dailyReport.personId, due), eq(schema.dailyReport.date, today), eq(schema.dailyReport.status, "submitted")));
  const missing = due.filter((personId) => !submitted.some((row) => row.personId === personId));
  let reminded = 0;
  // One notice per deadline: the wording names it.
  for (const [deadline, group] of Map.groupBy(missing, (personId) => days.get(personId)!.rules.reportDeadline)) {
    reminded += await claim(group, "report", today, (fresh, tx) => notify({ recipients: fresh, kind: "daily.report_reminder", params: { deadline }, link: "/daily/report" }, tx));
  }
  return { reminded };
}

/** Mondays (FR-PJM-23): last week's reports, to the leads and the department heads above the teams. */
export async function runWeeklyReports(today: IsoDate): Promise<Record<string, unknown>> {
  if (isoWeekday(today) !== 1) return { skipped: "not_monday" };
  const weekStart = addDays(weekStartOf(today), -7);
  return { weekStart, ...(await generateWeek(weekStart, { notify: true })) };
}

/**
 * Mondays (FR-PJM-25): people who submit timesheets — a team of theirs approves them and logs
 * time — and whose last week is neither submitted nor approved (a returned week counts as not
 * submitted). A week spent entirely on leave or holidays asks for nothing.
 */
export async function sendTimesheetReminders(today: IsoDate): Promise<Record<string, unknown>> {
  if (isoWeekday(today) !== 1) return { skipped: "not_monday" };
  const weekStart = addDays(weekStartOf(today), -7);
  const people = await listTeamPeople();
  const rules = await rulesOfPeople(people);
  const submitting = people.filter((personId) => {
    const own = rules.get(personId)?.rules;
    return !!own?.timesheetApproval && own.timeMode !== "off";
  });
  if (submitting.length === 0) return { weekStart, reminded: 0 };
  const days = await daysOf(submitting, weekStart, addDays(weekStart, 6));
  const due = submitting.filter((personId) => [...(days.get(personId)?.values() ?? [])].some((day) => !day.dayOff));
  if (due.length === 0) return { weekStart, reminded: 0 };
  const done = await db()
    .select({ personId: schema.timesheetWeek.personId })
    .from(schema.timesheetWeek)
    .where(and(inArray(schema.timesheetWeek.personId, due), eq(schema.timesheetWeek.weekStart, weekStart), inArray(schema.timesheetWeek.status, ["submitted", "approved"])));
  const missing = due.filter((personId) => !done.some((row) => row.personId === personId));
  const week = weekStart.split("-").reverse().join("/");
  const reminded = await claim(missing, "timesheet", today, (fresh, tx) => notify({ recipients: fresh, kind: "daily.timesheet_reminder", params: { week }, link: `/daily/time?week=${weekStart}` }, tx));
  return { weekStart, reminded };
}

/** 07:00 Vietnam, the morning slot. */
export const dailyPlanRemindersJob: JobDefinition = { name: "daily-plan-reminders", run: ({ today }) => sendPlanReminders(today) };
/** 18:00 Vietnam, a new evening slot — before the default 18:30 deadline. */
export const dailyReportRemindersJob: JobDefinition = { name: "daily-report-reminders", run: ({ today }) => sendReportReminders(today) };
/** The morning slot; does its work on Mondays only. */
export const dailyWeeklyReportsJob: JobDefinition = { name: "daily-weekly-reports", run: ({ today }) => runWeeklyReports(today) };
/** The morning slot; does its work on Mondays only. */
export const dailyTimesheetRemindersJob: JobDefinition = { name: "daily-timesheet-reminders", run: ({ today }) => sendTimesheetReminders(today) };
