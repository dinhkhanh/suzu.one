"use server";
// Attendance configuration: calendar, shifts, schedules, assignments, roster. All HR's
// (`attendance:manage`), checked against where the thing sits.
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ActionError, createAction } from "@/lib/action";
import { getPersonTarget } from "@/modules/core-hr/service";
import { canAssignSchedule, canManageAttendanceConfig } from "./policy";
import { assignSchedule, confirmCalendarDay, deleteCalendarDay, getAssignment, getCalendarDay, getSchedule, getShift, removeAssignment, saveCalendarDay, saveSchedule, saveShift, setRoster } from "./schedules";

const blankToNull = (value: unknown) => (typeof value === "string" && value.trim() === "" ? null : value);
const optional = <Schema extends z.ZodType>(schema: Schema) => z.preprocess(blankToNull, schema.nullable().default(null));
const checkbox = z.preprocess((value) => value === "on" || value === true, z.boolean());
const day = z.iso.date();
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const segment = z.object({ start: time, end: time });
const json = <Schema extends z.ZodType>(schema: Schema) =>
  z.preprocess((value) => {
    if (typeof value !== "string") return value;
    try {
      return JSON.parse(value);
    } catch {
      return undefined;
    }
  }, schema);

const refresh = () => revalidatePath("/attendance", "layout");

// ── Calendar ────────────────────────────────────────────────────────────────────────────────

const saveDayPipeline = createAction({
  name: "attendance.calendar_day.save",
  input: z.object({ entityId: optional(z.uuid()), date: day, kind: z.enum(["public_holiday", "compensatory_off", "company_off", "working_override"]), name: z.string().trim().min(1).max(120) }),
  authorize: (user, input) => canManageAttendanceConfig(user.principal, input.entityId),
  run: async ({ input }) => {
    const { before, after } = await saveCalendarDay(input);
    refresh();
    return { data: { id: after.id }, audit: { resource: { type: "calendar_day", id: after.id, entityId: after.entityId }, summary: `${after.date} ${after.kind}: ${after.name}`, before: before ? { kind: before.kind, name: before.name, isConfirmed: before.isConfirmed } : null, after: { kind: after.kind, name: after.name, isConfirmed: true } } };
  },
});
export async function saveCalendarDayAction(input: unknown) {
  return saveDayPipeline(input);
}

const dayById = async (user: { principal: Parameters<typeof canManageAttendanceConfig>[0] }, id: string) => {
  const row = await getCalendarDay(id);
  return !!row && canManageAttendanceConfig(user.principal, row.entityId);
};

const confirmDayPipeline = createAction({
  name: "attendance.calendar_day.confirm",
  input: z.object({ id: z.uuid() }),
  authorize: (user, input) => dayById(user, input.id),
  run: async ({ input }) => {
    const row = await confirmCalendarDay(input.id);
    refresh();
    return { data: { id: row.id }, audit: { resource: { type: "calendar_day", id: row.id, entityId: row.entityId }, summary: `${row.date} confirmed: ${row.name}`, before: { isConfirmed: false }, after: { isConfirmed: true } } };
  },
});
export async function confirmCalendarDayAction(input: unknown) {
  return confirmDayPipeline(input);
}

const deleteDayPipeline = createAction({
  name: "attendance.calendar_day.delete",
  input: z.object({ id: z.uuid() }),
  authorize: (user, input) => dayById(user, input.id),
  run: async ({ input }) => {
    const row = await deleteCalendarDay(input.id);
    refresh();
    return { data: { id: row.id }, audit: { resource: { type: "calendar_day", id: row.id, entityId: row.entityId }, summary: `${row.date} removed: ${row.name}`, before: { kind: row.kind, name: row.name } } };
  },
});
export async function deleteCalendarDayAction(input: unknown) {
  return deleteDayPipeline(input);
}

// ── Shifts ──────────────────────────────────────────────────────────────────────────────────

const saveShiftPipeline = createAction({
  name: "attendance.shift.save",
  input: z.object({
    id: optional(z.uuid()),
    entityId: optional(z.uuid()),
    code: z.string().trim().min(1).max(20).toUpperCase(),
    name: z.string().trim().min(1).max(120),
    start: time,
    end: time,
    // A split shift's second part.
    start2: optional(time),
    end2: optional(time),
    breakMinutes: z.coerce.number().int().min(0).max(600),
    isActive: checkbox,
  }),
  authorize: async (user, input) => {
    const existing = input.id ? await getShift(input.id) : null;
    if (input.id && !existing) return false;
    return canManageAttendanceConfig(user.principal, existing ? existing.entityId : input.entityId);
  },
  run: async ({ input }) => {
    if (!!input.start2 !== !!input.end2) throw new ActionError("pattern_bad_time");
    const segments = [{ start: input.start, end: input.end }, ...(input.start2 && input.end2 ? [{ start: input.start2, end: input.end2 }] : [])];
    const { before, after } = await saveShift({ id: input.id, entityId: input.entityId, code: input.code, name: input.name, segments, breakMinutes: input.breakMinutes, isActive: input.isActive });
    refresh();
    const facts = (row: typeof after) => ({ code: row.code, name: row.name, segments: row.segments, breakMinutes: row.breakMinutes, isActive: row.isActive });
    return { data: { id: after.id }, audit: { resource: { type: "shift", id: after.id, entityId: after.entityId }, summary: `${after.code} ${after.name}`, before: before ? facts(before) : null, after: facts(after) } };
  },
});
export async function saveShiftAction(input: unknown) {
  return saveShiftPipeline(input);
}

// ── Schedules ───────────────────────────────────────────────────────────────────────────────

const dayRule = z.discriminatedUnion("type", [
  z.object({ type: z.literal("working"), segments: z.array(segment).min(1).max(3), breakMinutes: z.number().int().min(0).max(600), flexible: z.boolean().optional(), requiredMinutes: z.number().int().min(1).max(1440).optional() }),
  z.object({ type: z.literal("untracked"), creditMinutes: z.number().int().min(0).max(1440) }),
  z.object({ type: z.literal("off") }),
]);
const weekday = z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5), z.literal(6), z.literal(7)]);
const pattern = z.object({
  days: z.object({ 1: dayRule, 2: dayRule, 3: dayRule, 4: dayRule, 5: dayRule, 6: dayRule, 7: dayRule }),
  alternate: z.array(z.object({ weekday, anchor: day, rule: dayRule })).max(7).optional(),
});

const saveSchedulePipeline = createAction({
  name: "attendance.schedule.save",
  input: z.object({ id: optional(z.uuid()), entityId: optional(z.uuid()), name: z.string().trim().min(1).max(120), kind: z.enum(["fixed", "flexible", "shift"]), pattern: json(pattern), isDefault: checkbox, isActive: checkbox }),
  authorize: async (user, input) => {
    const existing = input.id ? await getSchedule(input.id) : null;
    if (input.id && !existing) return false;
    return canManageAttendanceConfig(user.principal, existing ? existing.entityId : input.entityId);
  },
  run: async ({ input }) => {
    const { before, after } = await saveSchedule(input);
    refresh();
    const facts = (row: typeof after) => ({ name: row.name, kind: row.kind, pattern: row.pattern, isDefault: row.isDefault, isActive: row.isActive });
    return { data: { id: after.id }, audit: { resource: { type: "work_schedule", id: after.id, entityId: after.entityId }, summary: after.name, before: before ? facts(before) : null, after: facts(after) } };
  },
});
export async function saveScheduleAction(input: unknown) {
  return saveSchedulePipeline(input);
}

// ── Assignments ─────────────────────────────────────────────────────────────────────────────

const assignPipeline = createAction({
  name: "attendance.schedule.assign",
  input: z.object({ scope: z.enum(["entity", "department", "person"]), entityId: optional(z.uuid()), departmentId: optional(z.uuid()), personId: optional(z.uuid()), scheduleId: z.uuid(), validFrom: day, validTo: optional(day), note: optional(z.string().trim().max(300)) }),
  authorize: async (user, input) => canAssignSchedule(user.principal, input, input.scope === "person" && input.personId ? await getPersonTarget(input.personId) : null),
  run: async ({ user, input }) => {
    // Only the columns of the chosen scope count, whatever else the form posted.
    const scoped = { ...input, entityId: input.scope === "person" ? null : input.entityId, departmentId: input.scope === "department" ? input.departmentId : null, personId: input.scope === "person" ? input.personId : null };
    const { assignment, closed } = await assignSchedule(scoped, user.person.id);
    refresh();
    return { data: { id: assignment.id }, audit: { resource: { type: "schedule_assignment", id: assignment.id, entityId: assignment.entityId }, summary: `${assignment.scope} → schedule ${assignment.scheduleId} from ${assignment.validFrom}`, before: closed ? { closedAssignmentId: closed.id, validTo: closed.validTo } : null, after: scoped } };
  },
});
export async function assignScheduleAction(input: unknown) {
  return assignPipeline(input);
}

const removeAssignmentPipeline = createAction({
  name: "attendance.schedule.unassign",
  input: z.object({ id: z.uuid() }),
  authorize: async (user, input) => {
    const row = await getAssignment(input.id);
    return !!row && canAssignSchedule(user.principal, row, row.personId ? await getPersonTarget(row.personId) : null);
  },
  run: async ({ input }) => {
    const row = await removeAssignment(input.id);
    refresh();
    return { data: { id: row.id }, audit: { resource: { type: "schedule_assignment", id: row.id, entityId: row.entityId }, summary: `${row.scope} assignment removed`, before: { scheduleId: row.scheduleId, personId: row.personId, departmentId: row.departmentId, validFrom: row.validFrom, validTo: row.validTo } } };
  },
});
export async function removeAssignmentAction(input: unknown) {
  return removeAssignmentPipeline(input);
}

// ── Roster ──────────────────────────────────────────────────────────────────────────────────

const rosterPipeline = createAction({
  name: "attendance.roster.set",
  input: z.object({ personId: z.uuid(), from: day, to: day, shiftId: z.union([z.uuid(), z.literal("off"), z.literal("clear")]), note: optional(z.string().trim().max(200)) }),
  authorize: async (user, input) => canAssignSchedule(user.principal, { scope: "person", entityId: null, departmentId: null }, await getPersonTarget(input.personId)),
  run: async ({ input }) => {
    const { dates } = await setRoster(input);
    refresh();
    const target = await getPersonTarget(input.personId);
    return { data: { dates }, audit: { resource: { type: "person", id: input.personId, entityId: target?.entityId ?? null }, summary: `roster ${input.from} → ${input.to}: ${input.shiftId}`, after: { shiftId: input.shiftId, dates } } };
  },
});
export async function setRosterAction(input: unknown) {
  return rosterPipeline(input);
}
