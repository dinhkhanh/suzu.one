// The daily timesheet, stored (FR-ATT-09): gathers a person-day's inputs, runs the pure engine and
// keeps the result with its explanation. Recomputed whenever an input changes — until the row is
// locked (week 5's monthly lock sets `locked_at`), after which it is never touched again.
import "server-only";
import { createHash } from "node:crypto";
import { and, arrayContains, asc, between, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { addDays, type IsoDate, todayInVietnam } from "@/lib/dates";
import { db, schema, type Tx } from "@/lib/db";
import { listEmploymentFacts } from "@/modules/core-hr/service";
import { getLeaveOnDays } from "@/modules/leave/service";
import { matchesReach, permissionReach, type Principal, type Target, tierReach } from "@/modules/platform/rbac/policy";
import { getParameter } from "@/modules/platform/statutory/service";
import { loadPolicies, policyOn } from "./attendance-policies";
import { eachDate, minutesOf } from "./engine/calendar";
import { assignPunchesToDays, instantOf } from "./engine/merge";
import { computeTimesheetDay, ENGINE_VERSION, type MonthSummary, type NightWindow, NO_REQUESTS, summariseDays, type TimesheetDayResult } from "./engine/timesheet";
import { canSeeTimesheetOf } from "./policy";
import { listPunches } from "./punches";
import { approvedRequestsFor } from "./request-inputs";
import { getDayPlans } from "./schedules";

type Executor = Tx | ReturnType<typeof db>;
export type TimesheetDayRow = typeof schema.timesheetDay.$inferSelect;

export const monthOf = (date: IsoDate): string => date.slice(0, 7);
export const monthStart = (month: string): IsoDate => `${month}-01`;
export const monthEnd = (month: string): IsoDate => {
  const [year, number] = month.split("-").map(Number);
  return new Date(Date.UTC(year, number, 0)).toISOString().slice(0, 10);
};

async function nightWindowOn(date: IsoDate, executor: Executor): Promise<NightWindow> {
  try {
    const value = await getParameter("work.night_window", date, executor);
    return { start: minutesOf(value.start), end: minutesOf(value.end) };
  } catch {
    // Not seeded or not approved yet: no night minutes, and the trace says why.
    return null;
  }
}

const toColumns = (result: TimesheetDayResult) => ({
  planKind: result.planKind,
  status: result.status,
  requiredMinutes: result.requiredMinutes,
  workedMinutes: result.workedMinutes,
  creditedMinutes: result.creditedMinutes,
  lateMinutes: result.lateMinutes,
  earlyMinutes: result.earlyMinutes,
  absenceMinutes: result.absenceMinutes,
  missingPunch: result.missingPunch,
  leavePaidMinutes: result.leavePaidMinutes,
  leaveUnpaidMinutes: result.leaveUnpaidMinutes,
  holidayMinutes: result.holidayMinutes,
  wfhMinutes: result.wfhMinutes,
  tripMinutes: result.tripMinutes,
  nightMinutes: result.nightMinutes,
  otWeekdayMinutes: result.otWeekday.day,
  otWeekdayNightMinutes: result.otWeekday.night,
  otRestDayMinutes: result.otRestDay.day,
  otRestDayNightMinutes: result.otRestDay.night,
  otHolidayMinutes: result.otHoliday.day,
  otHolidayNightMinutes: result.otHoliday.night,
  otUnapprovedMinutes: result.otUnapprovedMinutes,
  otTimeOffMinutes: result.otTimeOffMinutes,
  firstIn: result.firstIn === null ? null : new Date(instantOf(result.date, result.firstIn)),
  lastOut: result.lastOut === null ? null : new Date(instantOf(result.date, result.lastOut)),
  anomalies: result.anomalies as string[],
  trace: result.trace,
});

export type RecomputeResult = { people: number; days: number; written: number; lockedSkipped: number };

/**
 * Computes and stores the timesheet days of these people for [from, to] (never beyond today).
 * Rows of a locked person-month are left exactly as they are; days outside someone's employment
 * have no row. Unchanged inputs write nothing.
 */
export async function recomputeDays(personIds: readonly string[], from: IsoDate, to: IsoDate, executor: Executor = db(), now: Date = new Date()): Promise<RecomputeResult> {
  const today = todayInVietnam(now);
  const until = to > today ? today : to;
  const ids = [...new Set(personIds)];
  const outcome: RecomputeResult = { people: ids.length, days: 0, written: 0, lockedSkipped: 0 };
  if (ids.length === 0 || until < from) return outcome;

  const [facts, plans, punches, leave, requests, policies, nightFrom, nightTo, existing, locked] = await Promise.all([
    listEmploymentFacts({ personIds: ids }, executor),
    getDayPlans(ids, addDays(from, -1), addDays(until, 1), executor),
    listPunches(ids, addDays(from, -1), addDays(until, 1), executor),
    getLeaveOnDays(ids, from, until, executor),
    approvedRequestsFor(ids, from, until, executor),
    loadPolicies(executor),
    nightWindowOn(from, executor),
    nightWindowOn(until, executor),
    executor.select({ id: schema.timesheetDay.id, personId: schema.timesheetDay.personId, date: schema.timesheetDay.date, inputsHash: schema.timesheetDay.inputsHash, lockedAt: schema.timesheetDay.lockedAt }).from(schema.timesheetDay).where(and(inArray(schema.timesheetDay.personId, ids), between(schema.timesheetDay.date, from, until))),
    // A person-month with any locked day is closed as a whole: no new rows slip into it either.
    executor
      .select({ personId: schema.timesheetDay.personId, month: sql<string>`to_char(${schema.timesheetDay.date}, 'YYYY-MM')` })
      .from(schema.timesheetDay)
      .where(and(inArray(schema.timesheetDay.personId, ids), between(schema.timesheetDay.date, monthStart(monthOf(from)), monthEnd(monthOf(until))), isNotNull(schema.timesheetDay.lockedAt)))
      .groupBy(schema.timesheetDay.personId, sql`to_char(${schema.timesheetDay.date}, 'YYYY-MM')`),
  ]);

  const lockedMonths = new Set(locked.map((row) => `${row.personId}:${row.month}`));
  const existingOf = new Map(existing.map((row) => [`${row.personId}:${row.date}`, row]));
  const dates = eachDate(from, until);
  const values: (typeof schema.timesheetDay.$inferInsert)[] = [];
  const stale: string[] = [];

  for (const fact of facts) {
    const personPlans = plans.get(fact.personId);
    if (!personPlans) continue;
    const planOf = new Map(personPlans.days.map((day) => [day.date, day]));
    const own = punches.filter((punch) => punch.personId === fact.personId);
    const boundary = policyOn(policies, fact.entityId, from).dayBoundary;
    const assigned = assignPunchesToDays(personPlans.days.map((day) => ({ date: day.date, segments: day.segments })), own.map((punch) => ({ at: punch.at.getTime(), direction: punch.direction, source: punch.source })), boundary);

    for (const date of dates) {
      const key = `${fact.personId}:${date}`;
      const row = existingOf.get(key);
      if (row?.lockedAt || lockedMonths.has(`${fact.personId}:${monthOf(date)}`)) {
        outcome.lockedSkipped++;
        continue;
      }
      const employed = !!fact.startDate && fact.startDate <= date && (!fact.endDate || fact.endDate >= date);
      const plan = planOf.get(date);
      if (!employed || !plan) {
        if (row) stale.push(row.id);
        continue;
      }
      outcome.days++;
      const resolved = policyOn(policies, fact.entityId, date);
      const policy = { mergeRule: resolved.mergeRule, graceLateMinutes: resolved.graceLateMinutes, graceEarlyMinutes: resolved.graceEarlyMinutes, roundingMinutes: resolved.roundingMinutes, otMinMinutes: resolved.otMinMinutes, otRequiresApproval: resolved.otRequiresApproval, duplicateWindowMinutes: resolved.duplicateWindowMinutes, breakStart: resolved.breakStart };
      // The day is over once its last planned minute (or midnight) has passed.
      const lastMinute = Math.max(1440, ...plan.segments.map((segment) => segment.end));
      const input = {
        plan,
        punches: assigned.get(date) ?? [],
        leave: leave.filter((item) => item.personId === fact.personId && item.date === date).map((item) => ({ portion: item.portion, amountCenti: item.amountCenti, minutes: item.minutes, isPaid: item.isPaid, typeCode: item.typeCode })),
        requests: requests.get(key) ?? NO_REQUESTS,
        policy,
        night: date === until ? nightTo : nightFrom,
        dayIsOver: now.getTime() >= instantOf(date, lastMinute),
      };
      const inputsHash = createHash("sha256").update(JSON.stringify([ENGINE_VERSION, input, resolved.dayBoundary])).digest("hex").slice(0, 32);
      if (row && row.inputsHash === inputsHash) continue;
      values.push({ personId: fact.personId, entityId: fact.entityId, date, ...toColumns(computeTimesheetDay(input)), inputsHash, computedAt: now });
    }
  }

  for (let index = 0; index < values.length; index += 200) {
    const chunk = values.slice(index, index + 200);
    const columns = Object.keys(chunk[0]).filter((column) => column !== "personId" && column !== "date") as (keyof typeof schema.timesheetDay.$inferInsert)[];
    await executor
      .insert(schema.timesheetDay)
      .values(chunk)
      .onConflictDoUpdate({
        target: [schema.timesheetDay.personId, schema.timesheetDay.date],
        set: Object.fromEntries(columns.map((column) => [column, sql.raw(`excluded."${schema.timesheetDay[column].name}"`)])),
        // The lock wins even against a recompute that started before it.
        setWhere: isNull(schema.timesheetDay.lockedAt),
      });
  }
  if (stale.length) await executor.delete(schema.timesheetDay).where(and(inArray(schema.timesheetDay.id, stale), isNull(schema.timesheetDay.lockedAt)));
  outcome.written = values.length + stale.length;
  return outcome;
}

// ── Reading ─────────────────────────────────────────────────────────────────────────────────

/** Stored timesheet days, oldest first. For week 5 (confirm → approve → lock) and payroll. */
export async function getTimesheetDays(personIds: readonly string[], from: IsoDate, to: IsoDate, executor: Executor = db()): Promise<TimesheetDayRow[]> {
  if (personIds.length === 0 || to < from) return [];
  return executor.select().from(schema.timesheetDay).where(and(inArray(schema.timesheetDay.personId, [...new Set(personIds)]), between(schema.timesheetDay.date, from, to))).orderBy(asc(schema.timesheetDay.date), asc(schema.timesheetDay.personId));
}

const summaryDay = (row: TimesheetDayRow) => ({
  ...row,
  otWeekday: { day: row.otWeekdayMinutes, night: row.otWeekdayNightMinutes },
  otRestDay: { day: row.otRestDayMinutes, night: row.otRestDayNightMinutes },
  otHoliday: { day: row.otHolidayMinutes, night: row.otHolidayNightMinutes },
  anomalies: row.anomalies as TimesheetDayResult["anomalies"],
});

export const summariseRows = (rows: readonly TimesheetDayRow[]): MonthSummary => summariseDays(rows.map(summaryDay));

/** One person's month ("2026-08") added up from the stored days. */
export async function summariseMonth(personId: string, month: string, executor: Executor = db()): Promise<MonthSummary> {
  return summariseRows(await getTimesheetDays([personId], monthStart(month), monthEnd(month), executor));
}

/**
 * One person's whole year, added up the same way (Phase 8, FR-PRF-07: the attendance line of a
 * review's evidence panel). One query over the year rather than twelve — the summary is the same
 * function, so a year and a month can never disagree about what "late" means.
 *
 * **No authorization inside**: the caller has checked who may read this person's data.
 */
export async function summarisePersonYear(personId: string, year: number, executor: Executor = db()): Promise<MonthSummary> {
  return summariseRows(await getTimesheetDays([personId], `${year}-01-01`, `${year}-12-31`, executor));
}

/**
 * One person's month **with the permission decision inside** — null when the reader may not see
 * it. `summariseMonth` above asks nothing, because every screen that calls it has already checked;
 * the assistant (FR-AI-02) has no screen, so this is its door, and `canSeeTimesheetOf` answers it
 * exactly as /attendance does. It cannot be called with more rights than the person who asked.
 */
export async function getMonthSummaryFor(principal: Principal, subjectPersonId: string, month: string): Promise<MonthSummary | null> {
  const [person] = await db()
    .select({ id: schema.person.id, entityId: schema.person.primaryEntityId, unitPath: schema.person.orgUnitPath, managerId: schema.person.managerId })
    .from(schema.person)
    .where(eq(schema.person.id, subjectPersonId))
    .limit(1);
  if (!person) return null;
  if (!canSeeTimesheetOf(principal, { personId: person.id, entityId: person.entityId, unitPath: person.unitPath, managerId: person.managerId })) return null;
  return summariseMonth(subjectPersonId, month);
}

export type PersonMonth = { personId: string; month: string; days: TimesheetDayRow[]; summary: MonthSummary };

/** A person's month for the "my attendance" calendar. The caller has checked `canSeeTimesheetOf`. */
export async function getPersonMonth(personId: string, month: string): Promise<PersonMonth> {
  const days = await getTimesheetDays([personId], monthStart(month), monthEnd(month));
  return { personId, month, days, summary: summariseRows(days) };
}

export type TeamMonthRow = { personId: string; fullName: string; employeeCode: string | null; departmentId: string | null; departmentName: string | null; days: TimesheetDayRow[]; summary: MonthSummary };

const targetOf = (person: typeof schema.person.$inferSelect): Target & { personId: string } => ({ personId: person.id, entityId: person.primaryEntityId, unitPath: person.orgUnitPath, managerId: person.managerId });

/**
 * The month grid of the people whose timesheets the viewer may read: their reports, whoever they
 * read at the personal tier (department heads), and HR's `attendance:manage` reach. Never colleagues.
 */
export async function getTeamMonth(viewer: { personId: string; principal: Principal }, month: string, options: { departmentId?: string | null; entityId?: string | null } = {}): Promise<{ rows: TeamMonthRow[]; departments: { id: string; name: string }[] }> {
  const hrReach = permissionReach(viewer.principal, "attendance:manage");
  const personalReach = tierReach(viewer.principal, "personal");
  const from = monthStart(month);
  const to = monthEnd(month);
  const everyone = await db().select({ person: schema.person, departmentName: schema.orgUnit.name }).from(schema.person).leftJoin(schema.orgUnit, eq(schema.orgUnit.id, schema.person.departmentId));
  const visible = everyone.filter(({ person }) => person.id !== viewer.personId && (person.managerId === viewer.personId || matchesReach(hrReach, targetOf(person)) || matchesReach(personalReach, targetOf(person))) && canSeeTimesheetOf(viewer.principal, targetOf(person)));
  const days = await getTimesheetDays(visible.map((row) => row.person.id), from, to);
  const withDays = new Set(days.map((day) => day.personId));
  // People who left before the month or have not started have no rows and no line.
  const shownAll = visible.filter((row) => withDays.has(row.person.id) || row.person.status === "active");
  const departments = [...new Map(shownAll.flatMap((row) => (row.person.departmentId && row.departmentName ? [[row.person.departmentId, { id: row.person.departmentId, name: row.departmentName }] as const] : []))).values()].sort((a, b) => a.name.localeCompare(b.name));
  const shown = shownAll.filter((row) => (!options.departmentId || row.person.departmentId === options.departmentId) && (!options.entityId || row.person.primaryEntityId === options.entityId));
  const codes = new Map((await listEmploymentFacts({ personIds: shown.map((row) => row.person.id) })).map((fact) => [fact.personId, fact.employeeCode]));
  const rows = shown
    .map(({ person, departmentName }) => {
      const own = days.filter((day) => day.personId === person.id);
      return { personId: person.id, fullName: person.fullName, employeeCode: codes.get(person.id) ?? null, departmentId: person.departmentId, departmentName, days: own, summary: summariseRows(own) };
    })
    .sort((a, b) => (a.departmentName ?? "").localeCompare(b.departmentName ?? "") || a.fullName.localeCompare(b.fullName));
  return { rows, departments };
}

/** May the viewer read this person's timesheet? (self, personal-tier readers, HR.) Loads the person. */
export async function timesheetTargetFor(viewer: Principal, personId: string): Promise<{ target: Target & { personId: string }; fullName: string } | null> {
  const [person] = await db().select().from(schema.person).where(eq(schema.person.id, personId)).limit(1);
  if (!person) return null;
  const target = targetOf(person);
  return canSeeTimesheetOf(viewer, target) ? { target, fullName: person.fullName } : null;
}

// ── Who is affected by a configuration change ───────────────────────────────────────────────

/** Active people of an entity and/or department (both null = everyone), for recomputes after configuration changes and the nightly job. */
export async function peopleIn(scope: { entityId?: string | null; departmentId?: string | null }, executor: Executor = db()): Promise<string[]> {
  const rows = await executor
    .select({ id: schema.person.id })
    .from(schema.person)
    // A unit takes everyone below it too (FR-PLT-16): narrowing "Marketing" must not miss its teams.
    .where(and(inArray(schema.person.status, ["active", "suspended"]), scope.entityId ? eq(schema.person.primaryEntityId, scope.entityId) : undefined, scope.departmentId ? arrayContains(schema.person.orgUnitPath, [scope.departmentId]) : undefined));
  return rows.map((row) => row.id);
}
