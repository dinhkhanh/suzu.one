// The working calendar, shifts, schedules, who follows which schedule, and the roster
// (FR-ATT-01, 02, 17). Reading ends in `getDayPlans`: what each person is expected to do on each
// date — the question leave (working-day count) and the timesheet engine both ask.
import "server-only";
import { and, asc, between, desc, eq, gte, inArray, isNull, lte, or } from "drizzle-orm";
import { ActionError } from "@/lib/action";
import { addDays, type IsoDate } from "@/lib/dates";
import { db, schema, type Tx } from "@/lib/db";
import { type AssignmentFact, assignmentFor, type CalendarDay, type CalendarDayKind, dayPlan, type DayPlan, eachDate, patternProblems, type RosterEntry, ruleProblems, type SchedulePattern, type Segment } from "./engine/calendar";

type Executor = Tx | ReturnType<typeof db>;
export type CalendarDayRow = typeof schema.calendarDay.$inferSelect;
export type ShiftRow = typeof schema.shift.$inferSelect;
export type WorkScheduleRow = typeof schema.workSchedule.$inferSelect;
export type ScheduleAssignmentRow = typeof schema.scheduleAssignment.$inferSelect;

// ── Day plans ───────────────────────────────────────────────────────────────────────────────

export type PersonDayPlans = { personId: string; entityId: string | null; scheduleIds: string[]; days: DayPlan[] };

/**
 * What each person is expected to do on each date of the range. People are placed by where they
 * sit today (entity, department); a person nobody assigned a schedule follows the default one,
 * and without a default their days are "unscheduled".
 */
export async function getDayPlans(personIds: readonly string[], from: IsoDate, to: IsoDate, executor: Executor = db()): Promise<Map<string, PersonDayPlans>> {
  const result = new Map<string, PersonDayPlans>();
  if (personIds.length === 0 || to < from) return result;
  const ids = [...new Set(personIds)];
  const people = await executor.select({ personId: schema.person.id, entityId: schema.person.primaryEntityId, departmentId: schema.person.departmentId }).from(schema.person).where(inArray(schema.person.id, ids));
  const entityIds = [...new Set(people.flatMap((row) => (row.entityId ? [row.entityId] : [])))];
  const departmentIds = [...new Set(people.flatMap((row) => (row.departmentId ? [row.departmentId] : [])))];

  const [assignments, schedules, calendar, roster] = await Promise.all([
    executor
      .select()
      .from(schema.scheduleAssignment)
      .where(
        and(
          lte(schema.scheduleAssignment.validFrom, to),
          or(isNull(schema.scheduleAssignment.validTo), gte(schema.scheduleAssignment.validTo, from)),
          or(inArray(schema.scheduleAssignment.personId, ids), departmentIds.length ? inArray(schema.scheduleAssignment.departmentId, departmentIds) : undefined, entityIds.length ? and(eq(schema.scheduleAssignment.scope, "entity"), inArray(schema.scheduleAssignment.entityId, entityIds)) : undefined),
        ),
      ),
    executor.select().from(schema.workSchedule),
    executor.select().from(schema.calendarDay).where(between(schema.calendarDay.date, from, to)),
    executor
      .select({ personId: schema.shiftRoster.personId, date: schema.shiftRoster.date, shiftId: schema.shiftRoster.shiftId, segments: schema.shift.segments, breakMinutes: schema.shift.breakMinutes })
      .from(schema.shiftRoster)
      .leftJoin(schema.shift, eq(schema.shift.id, schema.shiftRoster.shiftId))
      .where(and(inArray(schema.shiftRoster.personId, ids), between(schema.shiftRoster.date, from, to))),
  ]);

  const patterns = new Map(schedules.map((row) => [row.id, row.pattern]));
  const fallback = schedules.find((row) => row.isDefault && row.isActive) ?? null;
  const facts: AssignmentFact[] = assignments;
  const calendarDays: CalendarDay[] = calendar.map((row) => ({ date: row.date, entityId: row.entityId, kind: row.kind, name: row.name }));
  const rosterOf = new Map<string, RosterEntry>(roster.map((row) => [`${row.personId}:${row.date}`, { date: row.date, shift: row.shiftId && row.segments ? { id: row.shiftId, segments: row.segments, breakMinutes: row.breakMinutes ?? 0 } : null }]));
  const dates = eachDate(from, to);

  for (const person of people) {
    const used = new Set<string>();
    const days = dates.map((date) => {
      const scheduleId = assignmentFor(facts, person, date)?.scheduleId ?? fallback?.id ?? null;
      if (scheduleId) used.add(scheduleId);
      return dayPlan({ date, entityId: person.entityId, pattern: scheduleId ? (patterns.get(scheduleId) ?? null) : null, calendar: calendarDays, roster: rosterOf.get(`${person.personId}:${date}`) ?? null });
    });
    result.set(person.personId, { personId: person.personId, entityId: person.entityId, scheduleIds: [...used], days });
  }
  return result;
}

// ── Calendar ────────────────────────────────────────────────────────────────────────────────

export type CalendarDayView = CalendarDayRow & { entityName: string | null };

export async function listCalendarDays(year: number): Promise<CalendarDayView[]> {
  const rows = await db()
    .select({ row: schema.calendarDay, entityName: schema.entity.shortName })
    .from(schema.calendarDay)
    .leftJoin(schema.entity, eq(schema.entity.id, schema.calendarDay.entityId))
    .where(between(schema.calendarDay.date, `${year}-01-01`, `${year}-12-31`))
    .orderBy(asc(schema.calendarDay.date), asc(schema.entity.shortName));
  return rows.map(({ row, entityName }) => ({ ...row, entityName }));
}

export type DayOff = { date: IsoDate; kind: CalendarDayKind; name: string };

/**
 * The days off of an entity (null = the group's own rows only) in a range, for other modules: the
 * work calendar shades them, the ops tracker shifts due dates past them. An entity's row beats the
 * group's row for the same date; a working override removes the date.
 */
export async function getDaysOff(entityId: string | null, from: IsoDate, to: IsoDate, executor: Executor = db()): Promise<DayOff[]> {
  const rows = await executor
    .select()
    .from(schema.calendarDay)
    .where(and(between(schema.calendarDay.date, from, to), entityId ? or(isNull(schema.calendarDay.entityId), eq(schema.calendarDay.entityId, entityId)) : isNull(schema.calendarDay.entityId)))
    .orderBy(asc(schema.calendarDay.date));
  const byDate = new Map<IsoDate, (typeof rows)[number]>();
  for (const row of rows) if (!byDate.has(row.date) || row.entityId) byDate.set(row.date, row);
  return [...byDate.values()].filter((row) => row.kind !== "working_override").map((row) => ({ date: row.date, kind: row.kind, name: row.name }));
}

export async function getCalendarDay(id: string): Promise<CalendarDayRow | null> {
  const [row] = await db().select().from(schema.calendarDay).where(eq(schema.calendarDay.id, id)).limit(1);
  return row ?? null;
}

export type CalendarDayInput = { entityId: string | null; date: IsoDate; kind: CalendarDayKind; name: string };

/** One row per entity (or the group) and date: saving the same date again replaces it, and confirms it. */
export async function saveCalendarDay(input: CalendarDayInput): Promise<{ before: CalendarDayRow | null; after: CalendarDayRow }> {
  return db().transaction(async (tx) => {
    const [before] = await tx
      .select()
      .from(schema.calendarDay)
      .where(and(eq(schema.calendarDay.date, input.date), input.entityId ? eq(schema.calendarDay.entityId, input.entityId) : isNull(schema.calendarDay.entityId)))
      .limit(1)
      .for("update");
    const values = { kind: input.kind, name: input.name, isConfirmed: true, updatedAt: new Date() };
    const [after] = before ? await tx.update(schema.calendarDay).set(values).where(eq(schema.calendarDay.id, before.id)).returning() : await tx.insert(schema.calendarDay).values({ entityId: input.entityId, date: input.date, ...values }).returning();
    return { before: before ?? null, after };
  });
}

export async function confirmCalendarDay(id: string): Promise<CalendarDayRow> {
  const [row] = await db().update(schema.calendarDay).set({ isConfirmed: true, updatedAt: new Date() }).where(eq(schema.calendarDay.id, id)).returning();
  if (!row) throw new ActionError("calendar_day_not_found");
  return row;
}

export async function deleteCalendarDay(id: string): Promise<CalendarDayRow> {
  const [row] = await db().delete(schema.calendarDay).where(eq(schema.calendarDay.id, id)).returning();
  if (!row) throw new ActionError("calendar_day_not_found");
  return row;
}

// ── Shifts ──────────────────────────────────────────────────────────────────────────────────

export async function listShifts(): Promise<(ShiftRow & { entityName: string | null })[]> {
  const rows = await db().select({ row: schema.shift, entityName: schema.entity.shortName }).from(schema.shift).leftJoin(schema.entity, eq(schema.entity.id, schema.shift.entityId)).orderBy(asc(schema.shift.code));
  return rows.map(({ row, entityName }) => ({ ...row, entityName }));
}

export async function getShift(id: string): Promise<ShiftRow | null> {
  const [row] = await db().select().from(schema.shift).where(eq(schema.shift.id, id)).limit(1);
  return row ?? null;
}

export type ShiftInput = { id: string | null; entityId: string | null; code: string; name: string; segments: Segment[]; breakMinutes: number; isActive: boolean };

export async function saveShift(input: ShiftInput): Promise<{ before: ShiftRow | null; after: ShiftRow }> {
  const problems = ruleProblems({ type: "working", segments: input.segments, breakMinutes: input.breakMinutes });
  if (problems.length > 0) throw new ActionError(`pattern_${problems[0]}`);
  const before = input.id ? await getShift(input.id) : null;
  if (input.id && !before) throw new ActionError("shift_not_found");
  const clash = await db()
    .select({ id: schema.shift.id })
    .from(schema.shift)
    .where(and(eq(schema.shift.code, input.code), (before?.entityId ?? input.entityId) ? eq(schema.shift.entityId, (before?.entityId ?? input.entityId)!) : isNull(schema.shift.entityId)));
  if (clash.some((row) => row.id !== input.id)) throw new ActionError("shift_code_taken");
  const values = { code: input.code, name: input.name, segments: input.segments, breakMinutes: input.breakMinutes, isActive: input.isActive, updatedAt: new Date() };
  // A shift stays with the entity it was made for.
  const [after] = before ? await db().update(schema.shift).set(values).where(eq(schema.shift.id, before.id)).returning() : await db().insert(schema.shift).values({ entityId: input.entityId, ...values }).returning();
  return { before, after };
}

// ── Schedules ───────────────────────────────────────────────────────────────────────────────

export async function listSchedules(): Promise<(WorkScheduleRow & { entityName: string | null })[]> {
  const rows = await db()
    .select({ row: schema.workSchedule, entityName: schema.entity.shortName })
    .from(schema.workSchedule)
    .leftJoin(schema.entity, eq(schema.entity.id, schema.workSchedule.entityId))
    .orderBy(desc(schema.workSchedule.isDefault), asc(schema.workSchedule.name));
  return rows.map(({ row, entityName }) => ({ ...row, entityName }));
}

export async function getSchedule(id: string): Promise<WorkScheduleRow | null> {
  const [row] = await db().select().from(schema.workSchedule).where(eq(schema.workSchedule.id, id)).limit(1);
  return row ?? null;
}

export type ScheduleInput = { id: string | null; entityId: string | null; name: string; kind: "fixed" | "flexible" | "shift"; pattern: SchedulePattern; isDefault: boolean; isActive: boolean };

export async function saveSchedule(input: ScheduleInput): Promise<{ before: WorkScheduleRow | null; after: WorkScheduleRow }> {
  const problems = patternProblems(input.pattern, input.kind);
  if (problems.length > 0) throw new ActionError(`pattern_${problems[0]}`);
  // The default is what everyone without an assignment follows: it belongs to the group and must be usable.
  if (input.isDefault && (input.entityId || !input.isActive)) throw new ActionError("schedule_default_group_only");
  return db().transaction(async (tx) => {
    const [before] = input.id ? await tx.select().from(schema.workSchedule).where(eq(schema.workSchedule.id, input.id)).limit(1).for("update") : [];
    if (input.id && !before) throw new ActionError("schedule_not_found");
    if (before && before.entityId !== input.entityId) throw new ActionError("schedule_entity_fixed");
    if (input.isDefault) await tx.update(schema.workSchedule).set({ isDefault: false }).where(eq(schema.workSchedule.isDefault, true));
    const values = { name: input.name, kind: input.kind, pattern: input.pattern, isDefault: input.isDefault, isActive: input.isActive, updatedAt: new Date() };
    const [after] = before ? await tx.update(schema.workSchedule).set(values).where(eq(schema.workSchedule.id, before.id)).returning() : await tx.insert(schema.workSchedule).values({ entityId: input.entityId, ...values }).returning();
    return { before: before ?? null, after };
  });
}

// ── Assignments ─────────────────────────────────────────────────────────────────────────────

export type AssignmentView = ScheduleAssignmentRow & { scheduleName: string; entityName: string | null; departmentName: string | null; personName: string | null };

export async function listAssignments(): Promise<AssignmentView[]> {
  const rows = await db()
    .select({ row: schema.scheduleAssignment, scheduleName: schema.workSchedule.name, entityName: schema.entity.shortName, departmentName: schema.department.name, personName: schema.person.fullName })
    .from(schema.scheduleAssignment)
    .innerJoin(schema.workSchedule, eq(schema.workSchedule.id, schema.scheduleAssignment.scheduleId))
    .leftJoin(schema.entity, eq(schema.entity.id, schema.scheduleAssignment.entityId))
    .leftJoin(schema.department, eq(schema.department.id, schema.scheduleAssignment.departmentId))
    .leftJoin(schema.person, eq(schema.person.id, schema.scheduleAssignment.personId))
    .orderBy(asc(schema.scheduleAssignment.scope), asc(schema.entity.shortName), asc(schema.department.name), asc(schema.person.fullName), desc(schema.scheduleAssignment.validFrom));
  return rows.map(({ row, ...names }) => ({ ...row, ...names }));
}

export async function getAssignment(id: string): Promise<ScheduleAssignmentRow | null> {
  const [row] = await db().select().from(schema.scheduleAssignment).where(eq(schema.scheduleAssignment.id, id)).limit(1);
  return row ?? null;
}

export type AssignmentInput = { scope: "entity" | "department" | "person"; entityId: string | null; departmentId: string | null; personId: string | null; scheduleId: string; validFrom: IsoDate; validTo: IsoDate | null; note: string | null };

const sameScope = (input: Pick<AssignmentInput, "scope" | "entityId" | "departmentId" | "personId">) =>
  input.scope === "person"
    ? and(eq(schema.scheduleAssignment.scope, "person"), eq(schema.scheduleAssignment.personId, input.personId!))
    : input.scope === "department"
      ? and(eq(schema.scheduleAssignment.scope, "department"), eq(schema.scheduleAssignment.departmentId, input.departmentId!), input.entityId ? eq(schema.scheduleAssignment.entityId, input.entityId) : isNull(schema.scheduleAssignment.entityId))
      : and(eq(schema.scheduleAssignment.scope, "entity"), eq(schema.scheduleAssignment.entityId, input.entityId!));

/**
 * A new assignment for a scope. The one in force before it ends the day before; an assignment
 * that would start inside the new one's period is in the way and must be removed first.
 */
export async function assignSchedule(input: AssignmentInput, actorPersonId: string): Promise<{ assignment: ScheduleAssignmentRow; closed: ScheduleAssignmentRow | null }> {
  const shape = input.scope === "person" ? !!input.personId && !input.departmentId && !input.entityId : input.scope === "department" ? !!input.departmentId && !input.personId : !!input.entityId && !input.departmentId && !input.personId;
  if (!shape) throw new ActionError("schedule_assignment_scope");
  if (input.validTo && input.validTo < input.validFrom) throw new ActionError("schedule_assignment_dates");
  return db().transaction(async (tx) => {
    const [schedule] = await tx.select().from(schema.workSchedule).where(eq(schema.workSchedule.id, input.scheduleId)).limit(1);
    if (!schedule || !schedule.isActive) throw new ActionError("schedule_not_found");
    // An entity's own schedule is for that entity's people.
    if (schedule.entityId && input.scope !== "person" && schedule.entityId !== input.entityId) throw new ActionError("schedule_other_entity");
    const overlapping = await tx
      .select()
      .from(schema.scheduleAssignment)
      .where(and(sameScope(input), input.validTo ? lte(schema.scheduleAssignment.validFrom, input.validTo) : undefined, or(isNull(schema.scheduleAssignment.validTo), gte(schema.scheduleAssignment.validTo, input.validFrom))))
      .for("update");
    if (overlapping.some((row) => row.validFrom >= input.validFrom)) throw new ActionError("schedule_assignment_overlap");
    let closed: ScheduleAssignmentRow | null = null;
    for (const row of overlapping) [closed] = await tx.update(schema.scheduleAssignment).set({ validTo: addDays(input.validFrom, -1) }).where(eq(schema.scheduleAssignment.id, row.id)).returning();
    const [assignment] = await tx.insert(schema.scheduleAssignment).values({ ...input, createdByPersonId: actorPersonId }).returning();
    return { assignment, closed };
  });
}

export async function removeAssignment(id: string): Promise<ScheduleAssignmentRow> {
  const [row] = await db().delete(schema.scheduleAssignment).where(eq(schema.scheduleAssignment.id, id)).returning();
  if (!row) throw new ActionError("schedule_assignment_not_found");
  return row;
}

// ── Roster ──────────────────────────────────────────────────────────────────────────────────

export type RosterView = { id: string; personId: string; personName: string; entityId: string | null; departmentId: string | null; teamId: string | null; date: IsoDate; shiftId: string | null; shiftCode: string | null; shiftName: string | null; note: string | null };

export async function listRoster(from: IsoDate, to: IsoDate, personIds?: readonly string[]): Promise<RosterView[]> {
  if (personIds && personIds.length === 0) return [];
  return db()
    .select({ id: schema.shiftRoster.id, personId: schema.shiftRoster.personId, personName: schema.person.fullName, entityId: schema.person.primaryEntityId, departmentId: schema.person.departmentId, teamId: schema.person.teamId, date: schema.shiftRoster.date, shiftId: schema.shiftRoster.shiftId, shiftCode: schema.shift.code, shiftName: schema.shift.name, note: schema.shiftRoster.note })
    .from(schema.shiftRoster)
    .innerJoin(schema.person, eq(schema.person.id, schema.shiftRoster.personId))
    .leftJoin(schema.shift, eq(schema.shift.id, schema.shiftRoster.shiftId))
    .where(and(between(schema.shiftRoster.date, from, to), personIds ? inArray(schema.shiftRoster.personId, [...personIds]) : undefined))
    .orderBy(asc(schema.shiftRoster.date), asc(schema.person.fullName));
}

export type RosterInput = { personId: string; from: IsoDate; to: IsoDate; /** A shift, "off" = rostered off, "clear" = back to the weekly pattern. */ shiftId: string | "off" | "clear"; note: string | null };

/** Sets the roster of one person for every date of a range (at most 62 days at a time). */
export async function setRoster(input: RosterInput): Promise<{ dates: number }> {
  if (input.to < input.from) throw new ActionError("roster_dates");
  const dates = eachDate(input.from, input.to);
  if (dates.length > 62) throw new ActionError("roster_range_too_long");
  return db().transaction(async (tx) => {
    if (input.shiftId !== "off" && input.shiftId !== "clear") {
      const [row] = await tx.select({ id: schema.shift.id }).from(schema.shift).where(and(eq(schema.shift.id, input.shiftId), eq(schema.shift.isActive, true))).limit(1);
      if (!row) throw new ActionError("shift_not_found");
    }
    await tx.delete(schema.shiftRoster).where(and(eq(schema.shiftRoster.personId, input.personId), between(schema.shiftRoster.date, input.from, input.to)));
    if (input.shiftId !== "clear") await tx.insert(schema.shiftRoster).values(dates.map((date) => ({ personId: input.personId, date, shiftId: input.shiftId === "off" ? null : input.shiftId, note: input.note })));
    return { dates: dates.length };
  });
}
