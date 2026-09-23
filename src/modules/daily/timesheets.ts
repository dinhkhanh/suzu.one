// The week of time (FR-PJM-24, 25, 26): the person's grid with the attendance hint beside each day,
// the weekly timesheet — submitted, approved (locked) or returned, reopened only by an approver
// with a reason — and the approver's list of weeks waiting. Who reads what is policy.ts; every
// read here takes the reader and asks it, and the lists are the policy's list form.
import "server-only";
import { and, desc, eq, gte, inArray, isNotNull, isNull, lte, sql } from "drizzle-orm";
import { ActionError } from "@/lib/action";
import { addDays, type IsoDate } from "@/lib/dates";
import { db, schema, type Tx } from "@/lib/db";
import { getTimesheetDays } from "@/modules/attendance/service";
import { notify } from "@/modules/platform/notifications/service";
import { daysOf } from "./days";
import { type DayKind, weekStartOf } from "./engine/rules";
import { attendanceHint, type AttendanceHint, buildWeekGrid, isWeekEditable, rowKeyOf, type RowKey, rowsToCopy, type TimesheetStatus, transition, type WeekGrid, weekDates } from "./engine/timesheet";
import type { RuleMode } from "./enums";
import { listOverseen, loadSubjects, type Subject } from "./people";
import { showTimeLabels } from "./engine/redact";
import { loadSeen } from "./labels";
import { canApproveTimesheet, canViewAttendanceHint, canViewTimeEntry, canViewTimesheet, type ReportReader, type TimeReader } from "./policy";
import { rulesOfPeople } from "./team-rules";
import { listTimeOf, lockTimesheetWeek, TIME_BACKFILL_DAYS, type TimeEntryView } from "./time";

export type TimesheetWeekRow = typeof schema.timesheetWeek.$inferSelect;
const weekLabel = (weekStart: IsoDate) => weekStart.split("-").reverse().join("/");

export async function findTimesheetWeek(personId: string, weekStart: IsoDate, executor: Tx | ReturnType<typeof db> = db()): Promise<TimesheetWeekRow | null> {
  const [row] = await executor
    .select()
    .from(schema.timesheetWeek)
    .where(and(eq(schema.timesheetWeek.personId, personId), eq(schema.timesheetWeek.weekStart, weekStart)))
    .limit(1);
  return row ?? null;
}

export async function findTimesheetWeekById(id: string): Promise<TimesheetWeekRow | null> {
  const [row] = await db().select().from(schema.timesheetWeek).where(eq(schema.timesheetWeek.id, id)).limit(1);
  return row ?? null;
}

// ── The week view ───────────────────────────────────────────────────────────────────────────

export type WeekDayView = { date: IsoDate; kind: DayKind | null; name: string | null; leave: "full" | "part" | null; dayOff: boolean; /** null when the reader may not see attendance. */ hint: AttendanceHint | null };
/** `hidden`: a task the reader may not open — shown as private work, with its hours only. */
export type RowLabel = { key: RowKey; taskId: string | null; category: string | null; taskKey: string | null; title: string | null; projectName: string | null; hidden?: true };

export type TimeWeekView = {
  personId: string;
  fullName: string;
  weekStart: IsoDate;
  grid: WeekGrid;
  labels: Record<string, RowLabel>;
  /** The week's entries, oldest first, labelled for the reader. */
  entries: (TimeEntryView & { hidden?: true })[];
  week: (TimesheetWeekRow & { decidedByName: string | null }) | null;
  status: TimesheetStatus;
  /** Does any of the person's teams approve timesheets? Only then is the week submitted. */
  approvalRequired: boolean;
  timeMode: RuleMode;
  days: WeekDayView[];
  /** The person may still change this week (their own view only). */
  editable: boolean;
  /** Last week's rows this week does not have yet — "copy last week". */
  lastWeekRows: RowKey[];
  /** The reader approves this person's weeks. */
  canApprove: boolean;
  /** The reader sees only the rows on projects they lead. */
  partial: boolean;
};

const labelOf = (entry: TimeEntryView & { hidden?: true }): RowLabel => ({ key: rowKeyOf(entry), taskId: entry.taskId, category: entry.category, taskKey: entry.key, title: entry.title, projectName: entry.projectName, ...(entry.hidden ? { hidden: true as const } : {}) });

/**
 * `readerPersonId` is who reads it: for anyone but the person, each task and project is named only
 * where the reader may open it (engine/redact.ts) — a manager reads the hours of a private project's
 * task, not its title.
 */
async function buildWeekView(subject: Subject, weekStart: IsoDate, today: IsoDate, options: { readerPersonId: string; ledProjectIds?: ReadonlySet<string>; keep: (entry: TimeEntryView) => boolean; hints: boolean; own: boolean; canApprove: boolean; partial: boolean }): Promise<TimeWeekView> {
  const personId = subject.personId;
  const weekEnd = addDays(weekStart, 6);
  const [all, week, days, rules, attendance] = await Promise.all([
    listTimeOf([personId], addDays(weekStart, -7), weekEnd, "oldest"),
    findTimesheetWeek(personId, weekStart),
    daysOf([personId], weekStart, weekEnd),
    rulesOfPeople([personId]),
    options.hints ? getTimesheetDays([personId], weekStart, weekEnd) : Promise.resolve([]),
  ]);
  const kept = all.filter(options.keep);
  const seen = options.own ? null : await loadSeen(options.readerPersonId, { taskIds: kept.map((entry) => entry.taskId), projectIds: kept.map((entry) => entry.projectId) }, options.ledProjectIds);
  const visible = seen ? kept.map((entry) => showTimeLabels(entry, seen)) : kept;
  const entries = visible.filter((entry) => entry.date >= weekStart);
  const lastWeek = visible.filter((entry) => entry.date < weekStart);
  const labels: Record<string, RowLabel> = {};
  for (const entry of [...lastWeek, ...entries]) labels[rowKeyOf(entry)] = labelOf(entry);
  const decidedByName = week?.decidedByPersonId ? ((await loadSubjects([week.decidedByPersonId])).get(week.decidedByPersonId)?.fullName ?? null) : null;
  const status = (week?.status as TimesheetStatus | undefined) ?? "open";
  const own = rules.get(personId)!.rules;
  const personDays = days.get(personId);
  return {
    personId,
    fullName: subject.fullName,
    weekStart,
    grid: buildWeekGrid(weekStart, entries),
    labels,
    entries,
    week: week ? { ...week, decidedByName } : null,
    status,
    approvalRequired: own.timesheetApproval,
    timeMode: own.timeMode,
    days: weekDates(weekStart).map((date) => {
      const day = personDays?.get(date);
      const row = attendance.find((item) => item.date === date) ?? null;
      return { date, kind: day?.day.kind ?? null, name: day?.day.name ?? null, leave: day?.day.leave ?? null, dayOff: day?.dayOff ?? false, hint: options.hints ? attendanceHint(row) : null };
    }),
    editable: options.own && isWeekEditable(week ? status : null) && weekStart <= weekStartOf(today) && (addDays(weekStart, 6) >= addDays(today, -TIME_BACKFILL_DAYS) || status === "returned"),
    lastWeekRows: options.own ? rowsToCopy(lastWeek, entries) : [],
    canApprove: options.canApprove,
    partial: options.partial,
  };
}

/** The person's own week. */
export async function getMyTimeWeek(personId: string, weekStart: IsoDate, today: IsoDate): Promise<TimeWeekView | null> {
  const subject = (await loadSubjects([personId])).get(personId);
  if (!subject) return null;
  return buildWeekView(subject, weekStart, today, { readerPersonId: personId, keep: () => true, hints: true, own: true, canApprove: false, partial: false });
}

/**
 * Somebody's week as the reader may see it: the whole week for the people above them (the report
 * rule); only the rows on their projects for a project's lead; null for anyone else. The
 * attendance hint is for the person and their line-management chain (FR-PJM-26), not a work
 * team's lead; tasks and projects the reader may not open are shown as private work.
 */
export async function getTimesheetView(reader: TimeReader, personId: string, weekStart: IsoDate, today: IsoDate): Promise<TimeWeekView | null> {
  if (!reader.personId) return null;
  if (reader.personId === personId) return getMyTimeWeek(personId, weekStart, today);
  const subject = (await loadSubjects([personId])).get(personId);
  if (!subject) return null;
  const full = canViewTimesheet(reader, subject);
  const canApprove = canApproveTimesheet(reader, subject);
  if (!full && reader.ledProjectIds.size === 0) return null;
  const view = await buildWeekView(subject, weekStart, today, { readerPersonId: reader.personId, ledProjectIds: reader.ledProjectIds, keep: (entry) => canViewTimeEntry(reader, subject, entry), hints: full && canViewAttendanceHint(reader, subject), own: false, canApprove, partial: !full });
  // A project's lead with no row of this person on their projects has nothing to see here.
  if (!full && view.entries.length === 0) return null;
  // Nothing of the person's days or of their timesheet's status: only the hours on the project.
  if (!full) return { ...view, week: null, status: "open", days: view.days.map((day) => ({ date: day.date, kind: null, name: null, leave: null, dayOff: false, hint: null })) };
  return view;
}

// ── Submitting and deciding (FR-PJM-25) ─────────────────────────────────────────────────────

/** Who hears that a week waits: the leads of the person's teams and their line manager, never the person. */
async function approversOf(subject: Subject, executor: Tx): Promise<string[]> {
  const leads = subject.teamIds.length
    ? await executor
        .selectDistinct({ personId: schema.workTeamMember.personId })
        .from(schema.workTeamMember)
        .where(and(inArray(schema.workTeamMember.teamId, subject.teamIds), eq(schema.workTeamMember.role, "lead")))
    : [];
  return [...new Set([...leads.map((row) => row.personId), ...subject.chainAbove.slice(0, 1)])].filter((personId) => personId !== subject.personId);
}

/**
 * The person submits their week. Only where a team of theirs approves timesheets, only a week that
 * has begun, and not while a timer runs in it (its minutes are not known yet). The week's total is
 * kept on the row as it was submitted.
 */
export async function submitWeek(personId: string, weekStart: IsoDate, today: IsoDate, now: Date = new Date()): Promise<{ before: TimesheetWeekRow | null; after: TimesheetWeekRow }> {
  if (weekStartOf(weekStart) !== weekStart || weekStart > today) throw new ActionError("timesheet_week_invalid");
  const [subject, rules] = await Promise.all([loadSubjects([personId]).then((map) => map.get(personId)), rulesOfPeople([personId])]);
  if (!subject || !rules.get(personId)?.rules.timesheetApproval) throw new ActionError("timesheet_not_required");
  return db().transaction(async (tx) => {
    // The week's lock, the one every write of time takes: no entry slips in while it is totted up.
    await lockTimesheetWeek(tx, personId, weekStart);
    const before = await findTimesheetWeek(personId, weekStart, tx);
    const next = transition((before?.status as TimesheetStatus | undefined) ?? "open", { type: "submit" });
    if (!next.ok) throw new ActionError(next.error);
    const weekEnd = addDays(weekStart, 6);
    const [timer] = await tx
      .select({ id: schema.timeEntry.id })
      .from(schema.timeEntry)
      .where(and(eq(schema.timeEntry.personId, personId), isNotNull(schema.timeEntry.timerStartedAt), isNull(schema.timeEntry.deletedAt), gte(schema.timeEntry.date, weekStart), lte(schema.timeEntry.date, weekEnd)))
      .limit(1);
    if (timer) throw new ActionError("timesheet_timer_running");
    // The week's total is summed in Postgres: the rows themselves are not wanted here, and this
    // runs under the week's lock, which no wire traffic should hold open longer than it must.
    const [total] = await tx
      .select({ minutes: sql<number>`coalesce(sum(${schema.timeEntry.minutes}), 0)::int` })
      .from(schema.timeEntry)
      .where(and(eq(schema.timeEntry.personId, personId), eq(schema.timeEntry.weekStart, weekStart), isNull(schema.timeEntry.deletedAt)));
    const minutes = Number(total?.minutes ?? 0);
    const values = { status: next.status, minutes, submittedAt: now, decidedByPersonId: null, decidedAt: null, updatedAt: now };
    const [after] = await tx
      .insert(schema.timesheetWeek)
      .values({ personId, weekStart, ...values })
      .onConflictDoUpdate({ target: [schema.timesheetWeek.personId, schema.timesheetWeek.weekStart], set: values })
      .returning();
    await notify({ recipients: await approversOf(subject, tx), kind: "daily.timesheet_submitted", params: { person: subject.fullName, week: weekLabel(weekStart) }, link: `/daily/timesheets/${personId}?week=${weekStart}` }, tx);
    return { before, after };
  });
}

export type Decision = { type: "approve" } | { type: "return"; comment: string | null } | { type: "reopen"; reason: string | null };

/**
 * An approver decides a submitted week — approve (locks it) or return with a comment (opens it for
 * the person) — or reopens an approved one with a reason. The service asks the policy itself, so no
 * caller can skip it; the person hears the outcome.
 */
export async function decideWeek(reader: ReportReader, weekId: string, decision: Decision, now: Date = new Date()): Promise<{ before: TimesheetWeekRow; after: TimesheetWeekRow }> {
  const week = await findTimesheetWeekById(weekId);
  if (!week) throw new ActionError("timesheet_not_found");
  const subject = (await loadSubjects([week.personId])).get(week.personId);
  if (!subject || !canApproveTimesheet(reader, subject)) throw new ActionError("timesheet_not_found");
  const next = transition(week.status as TimesheetStatus, decision);
  if (!next.ok) throw new ActionError(next.error);
  const comment = decision.type === "return" ? decision.comment!.trim() : decision.type === "reopen" ? decision.reason!.trim() : week.comment;
  return db().transaction(async (tx) => {
    const [after] = await tx
      .update(schema.timesheetWeek)
      .set({ status: next.status, decidedByPersonId: reader.personId, decidedAt: now, comment, updatedAt: now })
      // The status it was read in: two approvers deciding at once, the second one fails.
      .where(and(eq(schema.timesheetWeek.id, weekId), eq(schema.timesheetWeek.status, week.status)))
      .returning();
    if (!after) throw new ActionError("timesheet_changed");
    await notify({ recipients: [week.personId], kind: "daily.timesheet_decided", params: { week: weekLabel(week.weekStart) }, link: `/daily/time?week=${week.weekStart}` }, tx);
    return { before: week, after };
  });
}

export type BulkApproval = { approved: TimesheetWeekRow[]; failed: { id: string; error: string }[] };

/**
 * Approves several weeks at once. Each week is its own decision in its own transaction, so a week
 * that fails — decided by another approver a moment ago, returned, not the reader's to approve —
 * neither undoes nor stops the others: every id is tried, and the result says which were approved
 * (the action audits exactly those) and which were not, and why. Never throws half-way.
 */
export async function approveWeeks(reader: ReportReader, weekIds: readonly string[], now: Date = new Date()): Promise<BulkApproval> {
  const result: BulkApproval = { approved: [], failed: [] };
  for (const id of new Set(weekIds)) {
    try {
      result.approved.push((await decideWeek(reader, id, { type: "approve" }, now)).after);
    } catch (error) {
      if (!(error instanceof ActionError)) console.error(JSON.stringify({ level: "error", event: "timesheet.bulk_approve_failed", weekId: id, message: error instanceof Error ? error.message : String(error) }));
      result.failed.push({ id, error: error instanceof ActionError ? error.message : "generic" });
    }
  }
  return result;
}

// ── The approver's lists ────────────────────────────────────────────────────────────────────

export type WaitingWeek = { id: string; personId: string; name: string; weekStart: IsoDate; status: TimesheetStatus; minutes: number; submittedAt: Date | null; decidedAt: Date | null; comment: string | null };

/**
 * Weeks the reader approves: the people they oversee (`listOverseen`) narrowed by
 * `canApproveTimesheet` — a skip-level manager sees reports but does not approve. `waiting` is
 * every submitted week; `recent` the weeks decided in the last `days` days (to reopen from).
 */
export async function listApprovals(reader: ReportReader, today: IsoDate, days = 42): Promise<{ waiting: WaitingWeek[]; recent: WaitingWeek[] }> {
  const groups = await listOverseen(reader);
  const candidates = [...new Set(groups.flatMap((group) => group.personIds))];
  if (candidates.length === 0) return { waiting: [], recent: [] };
  const subjects = await loadSubjects(candidates);
  const mine = candidates.filter((personId) => {
    const subject = subjects.get(personId);
    return !!subject && canApproveTimesheet(reader, subject);
  });
  if (mine.length === 0) return { waiting: [], recent: [] };
  const rows = await db()
    .select()
    .from(schema.timesheetWeek)
    .where(and(inArray(schema.timesheetWeek.personId, mine), inArray(schema.timesheetWeek.status, ["submitted", "approved", "returned"]), gte(schema.timesheetWeek.weekStart, addDays(weekStartOf(today), -7 * 26))))
    .orderBy(desc(schema.timesheetWeek.weekStart));
  const view = (row: TimesheetWeekRow): WaitingWeek => ({ id: row.id, personId: row.personId, name: subjects.get(row.personId)!.fullName, weekStart: row.weekStart, status: row.status as TimesheetStatus, minutes: row.minutes, submittedAt: row.submittedAt, decidedAt: row.decidedAt, comment: row.comment });
  const since = addDays(today, -days);
  return {
    waiting: rows.filter((row) => row.status === "submitted").map(view).sort((a, b) => a.weekStart.localeCompare(b.weekStart) || a.name.localeCompare(b.name, "vi")),
    recent: rows.filter((row) => row.status !== "submitted" && !!row.decidedAt && row.decidedAt.toISOString().slice(0, 10) >= since).map(view),
  };
}

export type ProjectTimeRow = { personId: string; name: string; projectId: string; projectName: string; minutes: number; billable: number };

/**
 * The time logged on the projects the reader leads in a week, per person and project (the PJM
 * access rule's project-lead clause, as a list). The rows open the person's week filtered to them.
 */
export async function listProjectTime(reader: TimeReader, weekStart: IsoDate): Promise<ProjectTimeRow[]> {
  if (!reader.personId || reader.ledProjectIds.size === 0) return [];
  // One row per person and project, summed in Postgres — nobody's individual entries cross the
  // wire for a list that only shows totals.
  const rows = await db()
    .select({
      personId: schema.timeEntry.personId,
      name: schema.person.fullName,
      projectId: schema.timeEntry.projectId,
      projectName: schema.workProject.name,
      minutes: sql<number>`coalesce(sum(${schema.timeEntry.minutes}), 0)::int`,
      billable: sql<number>`coalesce(sum(${schema.timeEntry.minutes}) filter (where ${schema.timeEntry.billable}), 0)::int`,
    })
    .from(schema.timeEntry)
    .innerJoin(schema.person, eq(schema.person.id, schema.timeEntry.personId))
    .innerJoin(schema.workProject, eq(schema.workProject.id, schema.timeEntry.projectId))
    .where(and(inArray(schema.timeEntry.projectId, [...reader.ledProjectIds]), eq(schema.timeEntry.weekStart, weekStart), isNull(schema.timeEntry.deletedAt), isNull(schema.timeEntry.timerStartedAt)))
    .groupBy(schema.timeEntry.personId, schema.person.fullName, schema.timeEntry.projectId, schema.workProject.name);
  return rows
    .map((row) => ({ personId: row.personId, name: row.name, projectId: row.projectId!, projectName: row.projectName, minutes: Number(row.minutes), billable: Number(row.billable) }))
    .sort((a, b) => a.projectName.localeCompare(b.projectName, "vi") || a.name.localeCompare(b.name, "vi"));
}
