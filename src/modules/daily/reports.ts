// The end-of-day report (FR-PJM-22): prefilled from the day's activity, completed by the person with
// blockers, notes and tomorrow's plan, submitted to the leads; the team daily board, comments and
// reactions, and the one-click reminder. Who may read a report is policy.ts; every read here takes
// the reader and asks it.
import "server-only";
import { and, asc, count, desc, eq, inArray } from "drizzle-orm";
import { ActionError } from "@/lib/action";
import { addDays, type IsoDate, todayInVietnam } from "@/lib/dates";
import { db, schema } from "@/lib/db";
import { notify } from "@/modules/platform/notifications/service";
import { type DayTask, listDayTasks, listOpenBlockersRaisedBy, listOpenWorkOf, listWorkActivityBetween, type OpenBlocker } from "@/modules/work/service";
import { dayOf, type PersonDay } from "./days";
import { prefillReport, type ReportDraft } from "./engine/prefill";
import { type ShownActivity, type ShownLine, showActivity, showLine } from "./engine/redact";
import { isLate, type NotRequiredReason } from "./engine/rules";
import { loadSeen, readsOwn } from "./labels";
import { listOverseen, loadReportReader, loadSubjects, readerMaySee, type Subject } from "./people";
import { findPlan } from "./plans";
import { canOverseeReport, canViewReport, type ReportReader } from "./policy";
import type { PlannedItem } from "./schema";
import { listTimeOf } from "./time";

export type ReportRow = typeof schema.dailyReport.$inferSelect;
export type ReportCommentRow = typeof schema.dailyReportComment.$inferSelect;

/** How far back a report may still be written: the rest of the week, not last month. */
export const REPORT_BACKFILL_DAYS = 7;
const dayLabel = (date: IsoDate) => date.split("-").reverse().join("/");

export async function findReport(personId: string, date: IsoDate): Promise<ReportRow | null> {
  const [row] = await db().select().from(schema.dailyReport).where(and(eq(schema.dailyReport.personId, personId), eq(schema.dailyReport.date, date))).limit(1);
  return row ?? null;
}

/** The day, as its activity tells it (FR-PJM-22 "prefilled"): read now, from the record. */
export async function buildDraft(personId: string, date: IsoDate): Promise<ReportDraft> {
  const [plan, events, time] = await Promise.all([findPlan(personId, date), listWorkActivityBetween([personId], date, date), listTimeOf([personId], date, date)]);
  const plannedTasks = await listDayTasks((plan?.items ?? []).map((item) => item.taskId));
  const planned = (plan?.items ?? []).flatMap((item) => {
    const task = plannedTasks.find((row) => row.taskId === item.taskId);
    return task ? [{ taskId: task.taskId, key: task.key, title: task.title, status: task.status, completedOn: task.completedOn }] : [];
  });
  return prefillReport({
    date,
    planned,
    events,
    time: time.map((entry) => ({ taskId: entry.taskId, key: entry.key, title: entry.title ?? entry.category ?? "", minutes: entry.minutes, at: entry.createdAt })),
  });
}

export type ReportForm = {
  report: ReportRow | null;
  draft: ReportDraft;
  day: PersonDay | null;
  /** Open work to pick tomorrow's plan from; what is not done today comes first and is ticked. */
  candidates: DayTask[];
  tomorrow: string[];
};

export async function getReportForm(personId: string, date: IsoDate): Promise<ReportForm> {
  const [report, draft, day, open] = await Promise.all([findReport(personId, date), buildDraft(personId, date), dayOf([personId], date), listOpenWorkOf(personId, date)]);
  const notDone = new Set(draft.notDone.map((line) => line.taskId));
  const candidates = [...open.filter((task) => notDone.has(task.taskId)), ...open.filter((task) => !notDone.has(task.taskId))];
  const tomorrow = report?.status === "submitted" ? report.tomorrow.map((item) => item.taskId) : draft.notDone.map((line) => line.taskId).filter((id) => open.some((task) => task.taskId === id));
  return { report, draft, day: day.get(personId) ?? null, candidates, tomorrow };
}

export type ReportInput = { blockers: string | null; notes: string | null; tomorrow: readonly string[]; secondsToSubmit: number | null };

/**
 * Submits (or re-submits) the day's report. What was done and not done is prefilled again here,
 * from the record, so a report never says more than the activity shows. The first submission
 * fixes the time, the lateness against the person's deadline and the seconds it took; editing
 * afterwards changes the words, not the record of when it came in.
 */
export async function submitReport(personId: string, date: IsoDate, input: ReportInput, now: Date = new Date()): Promise<{ before: ReportRow | null; after: ReportRow }> {
  const today = todayInVietnam(now);
  if (date > today || date < addDays(today, -REPORT_BACKFILL_DAYS)) throw new ActionError("report_date_invalid");
  const [before, draft, day, open] = await Promise.all([findReport(personId, date), buildDraft(personId, date), dayOf([personId], date), listOpenWorkOf(personId, date)]);
  const tomorrow: PlannedItem[] = [...new Set(input.tomorrow)].map((taskId) => {
    const task = open.find((row) => row.taskId === taskId);
    if (!task) throw new ActionError("plan_task_not_yours");
    return { taskId, minutes: task.estimateMinutes };
  });
  const deadline = day.get(personId)?.rules.reportDeadline ?? "18:30";
  const first = !before || before.status !== "submitted";
  const values = {
    activity: draft.activity,
    done: draft.done,
    notDone: draft.notDone,
    minutesLogged: draft.minutesLogged,
    blockers: input.blockers,
    notes: input.notes,
    tomorrow,
    status: "submitted",
    updatedAt: now,
    ...(first ? { submittedAt: now, late: isLate(now, date, deadline), secondsToSubmit: input.secondsToSubmit } : {}),
  };
  const [after] = await db()
    .insert(schema.dailyReport)
    .values({ personId, date, ...values })
    .onConflictDoUpdate({ target: [schema.dailyReport.personId, schema.dailyReport.date], set: values })
    .returning();
  return { before, after };
}

export async function findReportById(reportId: string): Promise<ReportRow | null> {
  const [row] = await db().select().from(schema.dailyReport).where(eq(schema.dailyReport.id, reportId)).limit(1);
  return row ?? null;
}

export type ReportCommentView = { id: string; authorPersonId: string; authorName: string | null; body: string; reaction: string | null; createdAt: Date };
/** The report's task lines as the reader may see them (engine/redact.ts): stored titles are never shown to another reader on their own word. */
export type ShownReport = Omit<ReportRow, "done" | "notDone" | "activity"> & { done: ShownLine[]; notDone: ShownLine[]; activity: ShownActivity[] };
/** An open blocker as the reader may see it: on a task they may not open, only that there is one. */
export type ShownBlocker = OpenBlocker & { hidden?: true };
export type ReportView = { report: ShownReport; subject: Subject; comments: ReportCommentView[]; openBlockers: ShownBlocker[]; /** The plan carried into the next day, as the tasks stand now. */ tomorrow: ShownLine[] };

/**
 * One report with its thread — null when it does not exist or the reader may not see it. A lead or
 * a manager reads the report, not every task in it: each task (done, not done, the activity, the
 * open blockers, tomorrow's plan) is named only where the reader may open it now, and shows as
 * private work with its minutes otherwise. The person reads their own as they wrote it.
 */
export async function getReportView(reader: ReportReader, reportId: string): Promise<ReportView | null> {
  const report = await findReportById(reportId);
  if (!report) return null;
  const subject = await readerMaySee(reader, report.personId);
  if (!subject) return null;
  const [comments, openBlockers, tomorrowTasks] = await Promise.all([
    db()
      .select({ id: schema.dailyReportComment.id, authorPersonId: schema.dailyReportComment.authorPersonId, authorName: schema.person.fullName, body: schema.dailyReportComment.body, reaction: schema.dailyReportComment.reaction, createdAt: schema.dailyReportComment.createdAt })
      .from(schema.dailyReportComment)
      .leftJoin(schema.person, eq(schema.person.id, schema.dailyReportComment.authorPersonId))
      .where(eq(schema.dailyReportComment.reportId, reportId))
      .orderBy(asc(schema.dailyReportComment.createdAt)),
    listOpenBlockersRaisedBy([report.personId]),
    listDayTasks(report.tomorrow.map((item) => item.taskId)),
  ]);
  // In the report's order; a task deleted since is left out.
  const tomorrow = report.tomorrow.flatMap((item) => {
    const task = tomorrowTasks.find((row) => row.taskId === item.taskId);
    return task ? [{ taskId: task.taskId, title: task.title, ref: task.key }] : [];
  });
  if (readsOwn(reader, report.personId)) return { report, subject, comments, openBlockers, tomorrow };

  const seen = await loadSeen(reader.personId, {
    taskIds: [...report.done, ...report.notDone, ...report.activity, ...openBlockers, ...tomorrow].map((row) => row.taskId),
  });
  const shown: ShownReport = { ...report, done: report.done.map((line) => showLine(line, seen)), notDone: report.notDone.map((line) => showLine(line, seen)), activity: report.activity.map((item) => showActivity(item, seen)) };
  const blockers = openBlockers.map((blocker): ShownBlocker => (seen.tasks.has(blocker.taskId) ? blocker : { ...blocker, key: "", title: "", reason: "", neededPersonId: null, neededName: null, hidden: true }));
  return { report: shown, subject, comments, openBlockers: blockers, tomorrow: tomorrow.map((line) => showLine(line, seen)) };
}

/** The person's own recent reports. */
export async function listMyReports(personId: string, limit = 30): Promise<Pick<ReportRow, "id" | "date" | "status" | "late" | "submittedAt" | "blockers" | "minutesLogged">[]> {
  return db()
    .select({ id: schema.dailyReport.id, date: schema.dailyReport.date, status: schema.dailyReport.status, late: schema.dailyReport.late, submittedAt: schema.dailyReport.submittedAt, blockers: schema.dailyReport.blockers, minutesLogged: schema.dailyReport.minutesLogged })
    .from(schema.dailyReport)
    .where(eq(schema.dailyReport.personId, personId))
    .orderBy(desc(schema.dailyReport.date))
    .limit(limit);
}

/**
 * A comment or a reaction on a report. The person hears when someone else writes on their report;
 * when the person answers, whoever wrote there before hears it.
 */
export async function commentOnReport(reader: ReportReader, reportId: string, input: { body: string | null; reaction: string | null }, actorName: string): Promise<{ comment: ReportCommentRow; report: ReportRow }> {
  const report = await findReportById(reportId);
  if (!report) throw new ActionError("report_not_found");
  const subject = (await loadSubjects([report.personId])).get(report.personId);
  if (!subject || !canViewReport(reader, subject)) throw new ActionError("report_not_found");
  if (!input.body && !input.reaction) throw new ActionError("comment_empty");
  const author = reader.personId!;
  return db().transaction(async (tx) => {
    const [comment] = await tx.insert(schema.dailyReportComment).values({ reportId, authorPersonId: author, body: input.body ?? "", reaction: input.reaction }).returning();
    let recipients: string[] = [];
    if (author !== report.personId) recipients = [report.personId];
    else {
      // Whoever wrote here before — as long as they may still read the report: a lead who has left
      // the team, or a manager no longer above the person, hears nothing more of it.
      const earlier = await tx.selectDistinct({ personId: schema.dailyReportComment.authorPersonId }).from(schema.dailyReportComment).where(eq(schema.dailyReportComment.reportId, reportId));
      const readers = await Promise.all(earlier.map((row) => row.personId).filter((id) => id !== author).map((personId) => loadReportReader(personId, tx)));
      recipients = readers.filter((earlierReader) => canViewReport(earlierReader, subject)).map((earlierReader) => earlierReader.personId!);
    }
    await notify({ recipients, kind: "daily.report_commented", params: { actor: actorName, date: dayLabel(report.date) }, link: `/daily/reports/${reportId}` }, tx);
    return { comment, report };
  });
}

// ── The team daily board ────────────────────────────────────────────────────────────────────

export type BoardStatus = "submitted" | "missing" | "not_required";
export type BoardRow = {
  personId: string;
  name: string;
  status: BoardStatus;
  reason: NotRequiredReason | null;
  reportId: string | null;
  late: boolean;
  submittedAt: Date | null;
  blockers: string | null;
  openBlockers: number;
  comments: number;
  reminded: boolean;
};
export type BoardGroup = ({ kind: "team"; teamId: string; name: string } | { kind: "reports" }) & { rows: BoardRow[]; counts: Record<BoardStatus, number> };

const hasBlockers = (row: BoardRow) => !!row.blockers?.trim() || row.openBlockers > 0;
const ORDER: Record<BoardStatus, number> = { missing: 0, submitted: 1, not_required: 2 };

/**
 * Every person the reader oversees on a date (FR-PJM-22): submitted, missing, or not required
 * (leave, holiday, untracked day, the team's rules) — blockers first, then the missing. The rows
 * are exactly `listOverseen`, the list form of the policy.
 */
export async function getTeamBoard(reader: ReportReader, date: IsoDate): Promise<BoardGroup[]> {
  const groups = await listOverseen(reader);
  const personIds = [...new Set(groups.flatMap((group) => group.personIds))];
  if (personIds.length === 0) return [];
  const [subjects, days, reports, blockers, reminded] = await Promise.all([
    loadSubjects(personIds),
    dayOf(personIds, date),
    db().select().from(schema.dailyReport).where(and(inArray(schema.dailyReport.personId, personIds), eq(schema.dailyReport.date, date))),
    listOpenBlockersRaisedBy(personIds),
    db()
      .select({ personId: schema.dailyReminderSent.personId })
      .from(schema.dailyReminderSent)
      .where(and(inArray(schema.dailyReminderSent.personId, personIds), eq(schema.dailyReminderSent.kind, "nudge"), eq(schema.dailyReminderSent.sentOn, date))),
  ]);
  const reportIds = reports.map((report) => report.id);
  const commentCounts = reportIds.length
    ? await db().select({ reportId: schema.dailyReportComment.reportId, value: count() }).from(schema.dailyReportComment).where(inArray(schema.dailyReportComment.reportId, reportIds)).groupBy(schema.dailyReportComment.reportId)
    : [];

  const rowOf = (personId: string): BoardRow => {
    const report = reports.find((row) => row.personId === personId && row.status === "submitted");
    const day = days.get(personId);
    const status: BoardStatus = report ? "submitted" : day?.report.required ? "missing" : "not_required";
    return {
      personId,
      name: subjects.get(personId)?.fullName ?? "",
      status,
      reason: status === "not_required" ? (day?.report.reason ?? null) : null,
      reportId: report?.id ?? null,
      late: report?.late ?? false,
      submittedAt: report?.submittedAt ?? null,
      blockers: report?.blockers ?? null,
      openBlockers: blockers.filter((blocker) => blocker.raisedByPersonId === personId).length,
      comments: commentCounts.find((row) => row.reportId === report?.id)?.value ?? 0,
      reminded: reminded.some((row) => row.personId === personId),
    };
  };
  return groups.map((group) => {
    const rows = group.personIds.map(rowOf).sort((a, b) => Number(hasBlockers(b)) - Number(hasBlockers(a)) || ORDER[a.status] - ORDER[b.status] || a.name.localeCompare(b.name, "vi"));
    const counts = { submitted: 0, missing: 0, not_required: 0 };
    for (const row of rows) counts[row.status] += 1;
    return { ...(group.kind === "team" ? { kind: "team" as const, teamId: group.teamId, name: group.name } : { kind: "reports" as const }), rows, counts };
  });
}

/**
 * "Please send today's report" to one person or everyone missing (FR-PJM-22). Only to people the
 * reader oversees whose report is required and not in; once per person and day however often
 * anyone presses the button (`daily_reminder_sent`). Returns who was told.
 */
export async function remindMissing(reader: ReportReader, personIds: readonly string[], date: IsoDate, actorName: string): Promise<string[]> {
  const ids = [...new Set(personIds)];
  if (ids.length === 0) return [];
  const [subjects, days, reports] = await Promise.all([loadSubjects(ids), dayOf(ids, date), db().select({ personId: schema.dailyReport.personId }).from(schema.dailyReport).where(and(inArray(schema.dailyReport.personId, ids), eq(schema.dailyReport.date, date), eq(schema.dailyReport.status, "submitted")))]);
  const due = ids.filter((personId) => {
    const subject = subjects.get(personId);
    return !!subject && canOverseeReport(reader, subject) && !!days.get(personId)?.report.required && !reports.some((row) => row.personId === personId);
  });
  if (due.length === 0) return [];
  return db().transaction(async (tx) => {
    const fresh = await tx
      .insert(schema.dailyReminderSent)
      .values(due.map((personId) => ({ personId, kind: "nudge", sentOn: date })))
      .onConflictDoNothing()
      .returning({ personId: schema.dailyReminderSent.personId });
    const told = fresh.map((row) => row.personId);
    await notify({ recipients: told, kind: "daily.report_nudge", params: { actor: actorName }, link: `/daily/report?date=${date}` }, tx);
    return told;
  });
}
