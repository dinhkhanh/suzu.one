// The monthly timesheet (FR-ATT-14): the employee confirms → the line manager approves → HR locks
// the entity's month. A locked month is payroll's input: its days are never recomputed, its totals
// are frozen in `timesheet_month.summary`, and later corrections are `timesheet_adjustment` rows
// that payroll takes into its next open month as retro items.
import "server-only";
import { and, asc, desc, eq, gte, inArray, isNull, lt, lte, or, sql } from "drizzle-orm";
import { ActionError } from "@/lib/action";
import { type IsoDate, todayInVietnam } from "@/lib/dates";
import { db, schema, type Tx } from "@/lib/db";
import { listEmploymentFacts } from "@/modules/core-hr/service";
import { postCompensatoryLeave } from "@/modules/leave/service";
import { notify } from "@/modules/platform/notifications/service";
import { matchesReach, permissionReach, type Principal, type Target } from "@/modules/platform/rbac/policy";
import { canLock, type LockIssue, lockIssues, type LockPersonInput, type MonthStatus, timeOffCenti } from "./engine/requests";
import type { MonthSummary } from "./engine/timesheet";
import { canApproveMonthOf } from "./policy";
import type { AdjustmentDeltas } from "./schema";
import { getTimesheetDays, monthEnd, monthStart, recomputeDays, summariseRows, type TimesheetDayRow } from "./timesheets";

type Executor = Tx | ReturnType<typeof db>;
export type TimesheetMonthRow = typeof schema.timesheetMonth.$inferSelect;
export type TimesheetPeriodRow = typeof schema.timesheetPeriod.$inferSelect;
export type TimesheetAdjustmentRow = typeof schema.timesheetAdjustment.$inferSelect;

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
export const isMonth = (value: string): boolean => MONTH.test(value);
const monthIsOver = (month: string, today: IsoDate = todayInVietnam()) => monthEnd(month) < today;
const targetOf = (person: typeof schema.person.$inferSelect): Target & { personId: string } => ({ personId: person.id, entityId: person.primaryEntityId, departmentId: person.departmentId, teamId: person.teamId, managerId: person.managerId });

export async function getMonthRow(personId: string, month: string, executor: Executor = db()): Promise<TimesheetMonthRow | null> {
  const [row] = await executor.select().from(schema.timesheetMonth).where(and(eq(schema.timesheetMonth.personId, personId), eq(schema.timesheetMonth.month, month))).limit(1);
  return row ?? null;
}

export async function isPeriodLocked(entityId: string, month: string, executor: Executor = db()): Promise<boolean> {
  const [row] = await executor.select({ id: schema.timesheetPeriod.id }).from(schema.timesheetPeriod).where(and(eq(schema.timesheetPeriod.entityId, entityId), eq(schema.timesheetPeriod.month, month), eq(schema.timesheetPeriod.status, "locked"))).limit(1);
  return !!row;
}

async function lockedForUpdate(tx: Tx, personId: string, month: string) {
  const [person] = await tx.select().from(schema.person).where(eq(schema.person.id, personId)).limit(1);
  if (!person) throw new ActionError("person_not_found");
  // The row is the lock two people pressing at once queue on.
  await tx.insert(schema.timesheetMonth).values({ personId, entityId: person.primaryEntityId, month }).onConflictDoNothing();
  const [row] = await tx.select().from(schema.timesheetMonth).where(and(eq(schema.timesheetMonth.personId, personId), eq(schema.timesheetMonth.month, month))).limit(1).for("update");
  return { person, row };
}

async function freshSummary(tx: Tx, personId: string, month: string): Promise<{ days: TimesheetDayRow[]; summary: MonthSummary }> {
  await recomputeDays([personId], monthStart(month), monthEnd(month), tx);
  const days = await getTimesheetDays([personId], monthStart(month), monthEnd(month), tx);
  return { days, summary: summariseRows(days) };
}

/** The employee says "this is my month". Only once the month is over, and not while a day's hours are unknown. */
export async function confirmMonth(personId: string, month: string) {
  return db().transaction(async (tx) => {
    const { row } = await lockedForUpdate(tx, personId, month);
    if (row.status !== "open") throw new ActionError("timesheet_not_open");
    if (!monthIsOver(month)) throw new ActionError("timesheet_month_not_over");
    const { days, summary } = await freshSummary(tx, personId, month);
    if (days.length === 0) throw new ActionError("timesheet_empty");
    if (summary.missingPunchDays > 0) throw new ActionError("timesheet_missing_punches", { days: days.filter((day) => day.missingPunch).map((day) => day.date) });
    const [after] = await tx.update(schema.timesheetMonth).set({ status: "confirmed", summary, confirmedAt: new Date(), confirmedByPersonId: personId, updatedAt: new Date() }).where(eq(schema.timesheetMonth.id, row.id)).returning();
    const [person] = await tx.select({ managerId: schema.person.managerId, fullName: schema.person.fullName }).from(schema.person).where(eq(schema.person.id, personId)).limit(1);
    if (person?.managerId) await notify({ recipients: [person.managerId], kind: "attendance.month_waiting", params: { name: person.fullName, month }, link: `/attendance/timesheets?month=${month}` }, tx);
    return { before: row, after };
  });
}

/** The line manager's (or HR's) approval. HR may approve a month the person never confirmed — someone on long leave cannot press a button. */
export async function approveMonth(personId: string, month: string, actor: { personId: string; isHr: boolean }) {
  return db().transaction(async (tx) => {
    const { row } = await lockedForUpdate(tx, personId, month);
    if (row.status === "approved" || row.status === "locked") throw new ActionError("timesheet_not_open");
    if (row.status === "open" && !actor.isHr) throw new ActionError("timesheet_not_confirmed");
    if (!monthIsOver(month)) throw new ActionError("timesheet_month_not_over");
    const { days, summary } = await freshSummary(tx, personId, month);
    if (days.length === 0) throw new ActionError("timesheet_empty");
    const [after] = await tx.update(schema.timesheetMonth).set({ status: "approved", summary, approvedAt: new Date(), approvedByPersonId: actor.personId, updatedAt: new Date() }).where(eq(schema.timesheetMonth.id, row.id)).returning();
    return { before: row, after };
  });
}

/** Back to the person with a word why — until the lock. */
export async function reopenMonth(personId: string, month: string, actorPersonId: string, comment: string) {
  return db().transaction(async (tx) => {
    const { row } = await lockedForUpdate(tx, personId, month);
    if (row.status !== "confirmed" && row.status !== "approved") throw new ActionError("timesheet_not_open");
    const [after] = await tx
      .update(schema.timesheetMonth)
      .set({ status: "open", confirmedAt: null, confirmedByPersonId: null, approvedAt: null, approvedByPersonId: null, reopenedComment: comment, reopenedByPersonId: actorPersonId, reopenedAt: new Date(), updatedAt: new Date() })
      .where(eq(schema.timesheetMonth.id, row.id))
      .returning();
    if (personId !== actorPersonId) await notify({ recipients: [personId], kind: "attendance.month_reopened", params: { month, comment }, link: `/attendance?month=${month}` }, tx);
    return { before: row, after };
  });
}

// ── The entity's month ──────────────────────────────────────────────────────────────────────

export type PeriodPerson = { personId: string; fullName: string; employeeCode: string | null; managerId: string | null; status: MonthStatus; summary: MonthSummary; issues: LockIssue[] };
export type PeriodOverview = { entityId: string; month: string; period: TimesheetPeriodRow | null; isOver: boolean; people: PeriodPerson[]; issues: LockIssue[]; counts: Record<MonthStatus, number> };

/** Everyone with days in the entity's month, where each person's month stands, and what is in the way of the lock. */
export async function getPeriodOverview(entityId: string, month: string, executor: Executor = db()): Promise<PeriodOverview> {
  const from = monthStart(month);
  const to = monthEnd(month);
  const days = await executor.select().from(schema.timesheetDay).where(and(eq(schema.timesheetDay.entityId, entityId), gte(schema.timesheetDay.date, from), lte(schema.timesheetDay.date, to))).orderBy(asc(schema.timesheetDay.date));
  const personIds = [...new Set(days.map((day) => day.personId))];
  const [period] = await executor.select().from(schema.timesheetPeriod).where(and(eq(schema.timesheetPeriod.entityId, entityId), eq(schema.timesheetPeriod.month, month))).limit(1);
  if (personIds.length === 0) return { entityId, month, period: period ?? null, isOver: monthIsOver(month), people: [], issues: [], counts: { open: 0, confirmed: 0, approved: 0, locked: 0 } };

  const [people, months, reviews, requests, facts] = await Promise.all([
    executor.select().from(schema.person).where(inArray(schema.person.id, personIds)),
    executor.select().from(schema.timesheetMonth).where(and(inArray(schema.timesheetMonth.personId, personIds), eq(schema.timesheetMonth.month, month))),
    executor
      .select({ personId: schema.punch.personId, value: sql<number>`count(*)::int` })
      .from(schema.punch)
      .where(and(inArray(schema.punch.personId, personIds), eq(schema.punch.reviewStatus, "pending"), gte(schema.punch.at, new Date(`${from}T00:00:00+07:00`)), lt(schema.punch.at, new Date(new Date(`${to}T00:00:00+07:00`).getTime() + 86_400_000))))
      .groupBy(schema.punch.personId),
    executor
      .select({ row: schema.attendanceRequest, approvalStatus: schema.approvalRequest.status })
      .from(schema.attendanceRequest)
      .leftJoin(schema.approvalRequest, eq(schema.approvalRequest.id, schema.attendanceRequest.approvalRequestId))
      .where(and(inArray(schema.attendanceRequest.personId, personIds), lte(schema.attendanceRequest.startDate, to), gte(schema.attendanceRequest.endDate, from), inArray(schema.attendanceRequest.status, ["pending", "approved"]))),
    listEmploymentFacts({ personIds }, executor),
  ]);

  const rows: PeriodPerson[] = [];
  const inputs: LockPersonInput[] = [];
  for (const person of people) {
    const own = days.filter((day) => day.personId === person.id);
    const summary = summariseRows(own);
    const status = (months.find((row) => row.personId === person.id)?.status ?? "open") as MonthStatus;
    const mine = requests.filter(({ row }) => row.personId === person.id);
    const pendingRequests = mine.filter(({ row, approvalStatus }) => row.status === "pending" && (approvalStatus === "pending" || approvalStatus === "returned")).length;
    // Approved holiday work that produced no holiday overtime and carries no confirmed hours: nobody knows what was worked.
    const unconfirmedHolidayWork = mine.filter(({ row }) => {
      if (row.type !== "holiday_work" || row.status !== "approved" || row.confirmedMinutes !== null) return false;
      const day = own.find((candidate) => candidate.date === row.startDate);
      return !day || day.otRestDayMinutes + day.otRestDayNightMinutes + day.otHolidayMinutes + day.otHolidayNightMinutes === 0;
    }).length;
    inputs.push({ personId: person.id, monthStatus: status, missingPunchDays: summary.missingPunchDays, punchesToReview: reviews.find((row) => row.personId === person.id)?.value ?? 0, pendingRequests, unconfirmedHolidayWork, absentDays: summary.absentDays, unapprovedOvertimeDays: own.filter((day) => day.otUnapprovedMinutes > 0).length });
    rows.push({ personId: person.id, fullName: person.fullName, employeeCode: facts.find((fact) => fact.personId === person.id)?.employeeCode ?? null, managerId: person.managerId, status, summary, issues: [] });
  }
  const issues = lockIssues(inputs);
  for (const row of rows) row.issues = issues.filter((issue) => issue.personId === row.personId);
  rows.sort((a, b) => a.fullName.localeCompare(b.fullName));
  const counts = { open: 0, confirmed: 0, approved: 0, locked: 0 };
  for (const row of rows) counts[row.status] += 1;
  return { entityId, month, period: period ?? null, isOver: monthIsOver(month), people: rows, issues, counts };
}

export type LockResult = { period: TimesheetPeriodRow; people: number; days: number; toilPosted: { personId: string; minutes: number; amountCenti: number }[]; exceptions: LockIssue[] };

/**
 * HR locks the entity's month. Refused while anything blocking remains — unless HR overrides with
 * a reason, and then the blockers are written on the period for the auditor. Sets `locked_at` on
 * every day (the recompute guard takes it from there), freezes each person's totals, and posts the
 * overtime people asked to take as time off to the leave ledger.
 */
export async function lockPeriod(entityId: string, month: string, actorPersonId: string, options: { overrideReason?: string | null } = {}): Promise<LockResult> {
  return db().transaction(async (tx) => {
    if (!monthIsOver(month)) throw new ActionError("timesheet_month_not_over");
    await tx.insert(schema.timesheetPeriod).values({ entityId, month }).onConflictDoNothing();
    const [period] = await tx.select().from(schema.timesheetPeriod).where(and(eq(schema.timesheetPeriod.entityId, entityId), eq(schema.timesheetPeriod.month, month))).limit(1).for("update");
    if (period.status === "locked") throw new ActionError("timesheet_period_locked");

    // Everyone's rows exist and are current before they freeze.
    const employed = await tx.selectDistinct({ personId: schema.timesheetDay.personId }).from(schema.timesheetDay).where(and(eq(schema.timesheetDay.entityId, entityId), gte(schema.timesheetDay.date, monthStart(month)), lte(schema.timesheetDay.date, monthEnd(month))));
    const current = await tx.select({ id: schema.person.id }).from(schema.person).where(and(eq(schema.person.primaryEntityId, entityId), inArray(schema.person.status, ["active", "suspended"])));
    const everyone = [...new Set([...employed.map((row) => row.personId), ...current.map((row) => row.id)])];
    for (let index = 0; index < everyone.length; index += 40) await recomputeDays(everyone.slice(index, index + 40), monthStart(month), monthEnd(month), tx);

    const overview = await getPeriodOverview(entityId, month, tx);
    if (overview.people.length === 0) throw new ActionError("timesheet_empty");
    const override = !!options.overrideReason?.trim();
    if (!canLock(overview.issues, override)) throw new ActionError("timesheet_lock_blocked", { issues: overview.issues.filter((issue) => issue.blocking) });
    const exceptions = overview.issues.filter((issue) => issue.blocking);

    const now = new Date();
    const toilPosted: LockResult["toilPosted"] = [];
    for (const person of overview.people) {
      await tx
        .insert(schema.timesheetMonth)
        .values({ personId: person.personId, entityId, month, status: "locked", summary: person.summary, lockedAt: now, lockedByPersonId: actorPersonId })
        .onConflictDoUpdate({ target: [schema.timesheetMonth.personId, schema.timesheetMonth.month], set: { status: "locked", summary: person.summary, entityId, lockedAt: now, lockedByPersonId: actorPersonId, updatedAt: now } });
      // Time off in lieu, one for one, in days of the person's own standard day. Only now are the month's actual hours final.
      const minutes = person.summary.otTimeOffMinutes;
      if (minutes > 0) {
        const dayMinutes = person.summary.standardDays > 0 ? Math.round(person.summary.standardMinutes / person.summary.standardDays) : 480;
        const amountCenti = timeOffCenti(minutes, dayMinutes);
        if (amountCenti > 0) {
          await postCompensatoryLeave(tx, { personId: person.personId, amountCenti, effectiveDate: monthEnd(month), sourceKey: `${person.personId}:${month}`, reason: `Nghỉ bù làm thêm giờ tháng ${month.slice(5)}/${month.slice(0, 4)} (${minutes} phút)`, actorPersonId });
          await tx.insert(schema.attendanceToilPosting).values({ personId: person.personId, month, minutes, amountCenti }).onConflictDoNothing();
          toilPosted.push({ personId: person.personId, minutes, amountCenti });
        }
      }
    }
    const locked = await tx.update(schema.timesheetDay).set({ lockedAt: now }).where(and(eq(schema.timesheetDay.entityId, entityId), gte(schema.timesheetDay.date, monthStart(month)), lte(schema.timesheetDay.date, monthEnd(month)), isNull(schema.timesheetDay.lockedAt))).returning({ id: schema.timesheetDay.id });
    const [after] = await tx
      .update(schema.timesheetPeriod)
      .set({ status: "locked", lockedAt: now, lockedByPersonId: actorPersonId, overrideReason: override ? options.overrideReason!.trim() : null, exceptions: exceptions.map(({ personId, code, count }) => ({ personId, code, count })), updatedAt: now })
      .where(eq(schema.timesheetPeriod.id, period.id))
      .returning();
    return { period: after, people: overview.people.length, days: locked.length, toilPosted, exceptions };
  });
}

// ── Adjustments after the lock ──────────────────────────────────────────────────────────────

export const ADJUSTMENT_FIELDS = ["workedMinutes", "leavePaidMinutes", "leaveUnpaidMinutes", "absenceMinutes", "lateMinutes", "earlyMinutes", "nightMinutes", "otWeekdayMinutes", "otWeekdayNightMinutes", "otRestDayMinutes", "otRestDayNightMinutes", "otHolidayMinutes", "otHolidayNightMinutes", "paidDaysCenti"] as const;

/** HR's correction to a locked month. The locked rows stay as they are; the difference waits here for payroll. */
export async function createAdjustment(input: { personId: string; month: string; date: IsoDate | null; deltas: AdjustmentDeltas; reason: string }, actorPersonId: string): Promise<TimesheetAdjustmentRow> {
  return db().transaction(async (tx) => {
    const month = await getMonthRow(input.personId, input.month, tx);
    if (!month || month.status !== "locked" || !month.entityId) throw new ActionError("adjustment_month_not_locked");
    if (input.date && input.date.slice(0, 7) !== input.month) throw new ActionError("adjustment_date_outside_month");
    const deltas = Object.fromEntries(Object.entries(input.deltas).filter(([key, value]) => (ADJUSTMENT_FIELDS as readonly string[]).includes(key) && typeof value === "number" && value !== 0)) as AdjustmentDeltas;
    if (Object.keys(deltas).length === 0) throw new ActionError("adjustment_empty");
    const [row] = await tx.insert(schema.timesheetAdjustment).values({ personId: input.personId, entityId: month.entityId, month: input.month, date: input.date, deltas, reason: input.reason, createdByPersonId: actorPersonId }).returning();
    await notify({ recipients: [input.personId], kind: "attendance.adjusted", params: { month: input.month, reason: input.reason }, link: `/attendance?month=${input.month}` }, tx);
    return row;
  });
}

/** Takes an adjustment back — until payroll has used it. */
export async function voidAdjustment(adjustmentId: string, actorPersonId: string, reason: string) {
  return db().transaction(async (tx) => {
    const [before] = await tx.select().from(schema.timesheetAdjustment).where(eq(schema.timesheetAdjustment.id, adjustmentId)).limit(1).for("update");
    if (!before) throw new ActionError("adjustment_not_found");
    if (before.status !== "active") throw new ActionError("adjustment_not_active");
    if (before.payrollMonth) throw new ActionError("adjustment_in_payroll");
    const [after] = await tx.update(schema.timesheetAdjustment).set({ status: "voided", voidedByPersonId: actorPersonId, voidedAt: new Date(), voidReason: reason }).where(eq(schema.timesheetAdjustment.id, adjustmentId)).returning();
    return { before, after };
  });
}

export async function findAdjustment(id: string): Promise<TimesheetAdjustmentRow | null> {
  const [row] = await db().select().from(schema.timesheetAdjustment).where(eq(schema.timesheetAdjustment.id, id)).limit(1);
  return row ?? null;
}

export async function listAdjustments(scope: { entityId?: string; personId?: string; month?: string }, executor: Executor = db()): Promise<(TimesheetAdjustmentRow & { fullName: string })[]> {
  const rows = await executor
    .select({ row: schema.timesheetAdjustment, fullName: schema.person.fullName })
    .from(schema.timesheetAdjustment)
    .innerJoin(schema.person, eq(schema.person.id, schema.timesheetAdjustment.personId))
    .where(and(scope.entityId ? eq(schema.timesheetAdjustment.entityId, scope.entityId) : undefined, scope.personId ? eq(schema.timesheetAdjustment.personId, scope.personId) : undefined, scope.month ? eq(schema.timesheetAdjustment.month, scope.month) : undefined))
    .orderBy(desc(schema.timesheetAdjustment.createdAt));
  return rows.map(({ row, fullName }) => ({ ...row, fullName }));
}

// ── What payroll reads (Phase 5) ────────────────────────────────────────────────────────────

export type LockedTimesheet = {
  personId: string;
  employeeCode: string | null;
  month: string;
  /** Days the month asked of the person (working and untracked days, paid holidays included) and the same in minutes. */
  standardDays: number;
  standardMinutes: number;
  /** Hundredths of a day, like the leave ledger: paid = worked + credited + paid leave + holidays; unpaid = unpaid leave + absence. */
  paidDaysCenti: number;
  unpaidDaysCenti: number;
  workedMinutes: number;
  creditedMinutes: number;
  leavePaidMinutes: number;
  leaveUnpaidMinutes: number;
  holidayMinutes: number;
  absenceMinutes: number;
  lateMinutes: number;
  earlyMinutes: number;
  /** Ordinary hours inside the statutory night window (night premium). */
  nightMinutes: number;
  /** Approved overtime by day category, each split into day and night minutes — `otTimeOffMinutes` of it was taken as time off (already in the leave ledger) and is not to be paid. */
  overtime: { weekday: { day: number; night: number }; restDay: { day: number; night: number }; holiday: { day: number; night: number }; totalMinutes: number; timeOffMinutes: number; payableMinutes: number };
  lockedAt: Date;
  lockedByPersonId: string | null;
};

export type LockedPeriod = { entityId: string; month: string; lockedAt: Date; lockedByPersonId: string | null; overrideReason: string | null; exceptions: { personId: string; code: string; count: number }[]; people: LockedTimesheet[] };

/**
 * Payroll's input for an entity's month ("2026-08"): one line per person from the snapshot frozen
 * at the lock. **null while the period is not locked** — payroll must not run on moving numbers.
 * Units: minutes are integers; days are hundredths of a day (same convention as `leave` —
 * `getLeaveUsage` gives the split of `leavePaidMinutes` by leave type and payroll treatment).
 */
export async function getLockedTimesheets(entityId: string, month: string, executor: Executor = db()): Promise<LockedPeriod | null> {
  const [period] = await executor.select().from(schema.timesheetPeriod).where(and(eq(schema.timesheetPeriod.entityId, entityId), eq(schema.timesheetPeriod.month, month), eq(schema.timesheetPeriod.status, "locked"))).limit(1);
  if (!period?.lockedAt) return null;
  const months = await executor.select().from(schema.timesheetMonth).where(and(eq(schema.timesheetMonth.entityId, entityId), eq(schema.timesheetMonth.month, month), eq(schema.timesheetMonth.status, "locked")));
  const codes = new Map((await listEmploymentFacts({ personIds: months.map((row) => row.personId) }, executor)).map((fact) => [fact.personId, fact.employeeCode]));
  const people = months.map((row): LockedTimesheet => {
    const summary = row.summary as unknown as MonthSummary;
    return {
      personId: row.personId,
      employeeCode: codes.get(row.personId) ?? null,
      month,
      standardDays: summary.standardDays,
      standardMinutes: summary.standardMinutes,
      paidDaysCenti: summary.paidDaysCenti,
      unpaidDaysCenti: summary.unpaidDaysCenti,
      workedMinutes: summary.workedMinutes,
      creditedMinutes: summary.creditedMinutes,
      leavePaidMinutes: summary.leavePaidMinutes,
      leaveUnpaidMinutes: summary.leaveUnpaidMinutes,
      holidayMinutes: summary.holidayMinutes,
      absenceMinutes: summary.absenceMinutes,
      lateMinutes: summary.lateMinutes,
      earlyMinutes: summary.earlyMinutes,
      nightMinutes: summary.nightMinutes,
      overtime: { weekday: summary.otWeekday, restDay: summary.otRestDay, holiday: summary.otHoliday, totalMinutes: summary.otTotalMinutes, timeOffMinutes: summary.otTimeOffMinutes, payableMinutes: Math.max(0, summary.otTotalMinutes - summary.otTimeOffMinutes) },
      lockedAt: row.lockedAt ?? period.lockedAt!,
      lockedByPersonId: row.lockedByPersonId,
    };
  });
  people.sort((a, b) => (a.employeeCode ?? "").localeCompare(b.employeeCode ?? ""));
  return { entityId, month, lockedAt: period.lockedAt, lockedByPersonId: period.lockedByPersonId, overrideReason: period.overrideReason, exceptions: period.exceptions, people };
}

/**
 * Retro items for the payroll of `payrollMonth`: active adjustments to months before it that no
 * payroll has taken yet (or that this very payroll month took — so a re-run sees the same list).
 * Payroll marks them with `markAdjustmentsTaken` when it is approved.
 */
export async function listAdjustmentsForPayroll(entityId: string, payrollMonth: string, executor: Executor = db()): Promise<TimesheetAdjustmentRow[]> {
  return executor
    .select()
    .from(schema.timesheetAdjustment)
    .where(and(eq(schema.timesheetAdjustment.entityId, entityId), eq(schema.timesheetAdjustment.status, "active"), lt(schema.timesheetAdjustment.month, payrollMonth), or(isNull(schema.timesheetAdjustment.payrollMonth), eq(schema.timesheetAdjustment.payrollMonth, payrollMonth))))
    .orderBy(asc(schema.timesheetAdjustment.month), asc(schema.timesheetAdjustment.createdAt));
}

/** Payroll's receipt: these adjustments went into `payrollMonth` and can no longer be voided. */
export async function markAdjustmentsTaken(tx: Tx, adjustmentIds: readonly string[], payrollMonth: string): Promise<number> {
  if (adjustmentIds.length === 0) return 0;
  const rows = await tx.update(schema.timesheetAdjustment).set({ payrollMonth }).where(and(inArray(schema.timesheetAdjustment.id, [...adjustmentIds]), eq(schema.timesheetAdjustment.status, "active"), isNull(schema.timesheetAdjustment.payrollMonth))).returning({ id: schema.timesheetAdjustment.id });
  return rows.length;
}

// ── Screens: what waits for a manager, and HR's entities ────────────────────────────────────

export type TeamMonthStatus = { personId: string; fullName: string; status: MonthStatus; summary: MonthSummary; confirmedAt: Date | null; canApprove: boolean };

/** The months of the people whose timesheet the viewer may approve: reports, and HR's reach. */
export async function listMonthsToApprove(viewer: { personId: string; principal: Principal }, month: string, options: { entityId?: string | null } = {}): Promise<TeamMonthStatus[]> {
  const reach = permissionReach(viewer.principal, "attendance:manage");
  const everyone = await db().select().from(schema.person);
  const mine = everyone.filter((person) => person.id !== viewer.personId && (person.managerId === viewer.personId || matchesReach(reach, targetOf(person))) && (!options.entityId || person.primaryEntityId === options.entityId));
  if (mine.length === 0) return [];
  const ids = mine.map((person) => person.id);
  const [days, months] = await Promise.all([getTimesheetDays(ids, monthStart(month), monthEnd(month)), db().select().from(schema.timesheetMonth).where(and(inArray(schema.timesheetMonth.personId, ids), eq(schema.timesheetMonth.month, month)))]);
  return mine
    .filter((person) => days.some((day) => day.personId === person.id))
    .map((person) => {
      const row = months.find((candidate) => candidate.personId === person.id);
      return { personId: person.id, fullName: person.fullName, status: (row?.status ?? "open") as MonthStatus, summary: summariseRows(days.filter((day) => day.personId === person.id)), confirmedAt: row?.confirmedAt ?? null, canApprove: canApproveMonthOf(viewer.principal, targetOf(person)) };
    })
    .sort((a, b) => a.fullName.localeCompare(b.fullName));
}

/** Tells everyone in the entity whose month is still open that it is ready to confirm. Returns how many were told. */
export async function remindToConfirm(entityId: string, month: string): Promise<number> {
  if (!monthIsOver(month)) throw new ActionError("timesheet_month_not_over");
  const overview = await getPeriodOverview(entityId, month);
  if (overview.period?.status === "locked") throw new ActionError("timesheet_period_locked");
  const open = overview.people.filter((person) => person.status === "open").map((person) => person.personId);
  const active = open.length ? await db().select({ id: schema.person.id }).from(schema.person).where(and(inArray(schema.person.id, open), eq(schema.person.status, "active"))) : [];
  if (active.length) await notify({ recipients: active.map((row) => row.id), kind: "attendance.month_ready", params: { month }, link: `/attendance?month=${month}` });
  return active.length;
}
