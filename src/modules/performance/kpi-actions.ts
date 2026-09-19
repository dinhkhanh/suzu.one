"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createAction } from "@/lib/action";
import { todayInVietnam } from "@/lib/dates";
import { KPI_DIRECTIONS, KPI_FREQUENCIES, KPI_UNITS, MONTH_KEY } from "./enums";
import { kpiActualImport } from "./kpi-import";
import { closeMonth, peopleOfEntries, reopenMonth, saveActuals } from "./kpi-scores";
import { applyTemplates, createAssignment, endAssignment, findAssignment, findPositionKpi, type KpiRow, removePositionKpi, saveKpi, savePositionKpi, updateAssignment } from "./kpis";
import { loadDirectory } from "./people";
import { canCloseKpiMonth, canEnterActualsFor, canManageAssignmentsOf, canManageKpiLibrary, canManagePositionKpis, canOpenKpiAdmin, canReopenKpiMonth } from "./policy";

const blankToNull = (value: unknown) => (typeof value === "string" && value.trim() === "" ? null : value);
const optional = <Schema extends z.ZodType>(schema: Schema) => z.preprocess(blankToNull, schema.nullable().default(null));
const checkbox = z.preprocess((value) => value === "on" || value === true || value === "true", z.boolean());
const month = z.string().regex(MONTH_KEY);
const weight = z.coerce.number().int().min(1).max(1000);
// Percent of the target, as typed ("120"); stored in basis points.
const percentBp = (fallback: number) => z.preprocess((value) => (blankToNull(value) === null ? fallback / 100 : value), z.coerce.number().min(0).max(1000)).transform((value) => Math.round(value * 100));

const refresh = () => revalidatePath("/performance", "layout");
const kpiFacts = (kpi: KpiRow) => ({ code: kpi.code, name: kpi.name, unit: kpi.unit, direction: kpi.direction, frequency: kpi.frequency, capBp: kpi.capBp, floorBp: kpi.floorBp, isActive: kpi.isActive });

// ── Library ─────────────────────────────────────────────────────────────────────────────────

const saveKpiPipeline = createAction({
  name: "performance.kpi.save",
  input: z.object({
    kpiId: optional(z.uuid()),
    code: z.string().trim().toUpperCase().regex(/^[A-Z0-9][A-Z0-9_-]{1,39}$/),
    name: z.string().trim().min(1).max(200),
    description: optional(z.string().trim().max(2000)),
    unit: z.enum(KPI_UNITS),
    direction: z.enum(KPI_DIRECTIONS),
    frequency: z.enum(KPI_FREQUENCIES),
    capPercent: percentBp(12000),
    floorPercent: percentBp(0),
    isActive: checkbox,
  }),
  authorize: (user) => canManageKpiLibrary(user.principal),
  run: async ({ input }) => {
    const { before, after } = await saveKpi(input.kpiId, { code: input.code, name: input.name, description: input.description, unit: input.unit, direction: input.direction, frequency: input.frequency, capBp: input.capPercent, floorBp: input.floorPercent, isActive: input.isActive });
    refresh();
    return { data: { id: after.id }, audit: { resource: { type: "kpi_definition", id: after.id }, summary: after.code, before: before ? kpiFacts(before) : undefined, after: kpiFacts(after) } };
  },
});
export async function saveKpiAction(input: unknown) {
  return saveKpiPipeline(input);
}

// ── Templates per position ──────────────────────────────────────────────────────────────────

const savePositionKpiPipeline = createAction({
  name: "performance.positionKpi.save",
  input: z.object({ positionId: z.uuid(), entityId: optional(z.uuid()), kpiId: z.uuid(), weight, target: z.string().trim().min(1).max(30), sortOrder: z.coerce.number().int().min(0).max(999).default(0) }),
  authorize: (user, input) => canManagePositionKpis(user.principal, input.entityId),
  run: async ({ input }) => {
    const { before, after } = await savePositionKpi(input);
    refresh();
    return { data: { id: after.id }, audit: { resource: { type: "position_kpi", id: after.id, entityId: after.entityId }, summary: "template line", before: before ?? undefined, after } };
  },
});
export async function savePositionKpiAction(input: unknown) {
  return savePositionKpiPipeline(input);
}

const removePositionKpiPipeline = createAction({
  name: "performance.positionKpi.remove",
  input: z.object({ id: z.uuid() }),
  authorize: async (user, input) => {
    const row = await findPositionKpi(input.id);
    return !!row && canManagePositionKpis(user.principal, row.entityId);
  },
  run: async ({ input }) => {
    const row = await removePositionKpi(input.id);
    refresh();
    return { data: { id: row.id }, audit: { resource: { type: "position_kpi", id: row.id, entityId: row.entityId }, summary: "removed", before: row } };
  },
});
export async function removePositionKpiAction(input: unknown) {
  return removePositionKpiPipeline(input);
}

// ── Assignments ─────────────────────────────────────────────────────────────────────────────

const managesPerson = async (user: { principal: Parameters<typeof canManageAssignmentsOf>[0] }, personId: string) => {
  const person = (await loadDirectory()).get(personId);
  return !!person && canManageAssignmentsOf(user.principal, person);
};

const applyPipeline = createAction({
  name: "performance.assignment.apply",
  input: z.object({ fromPeriod: month, positionId: optional(z.uuid()), personId: optional(z.uuid()) }),
  // HR somewhere; the use-case then touches only the holders this HR looks after. One named person is checked here.
  authorize: async (user, input) => (input.personId ? managesPerson(user, input.personId) : canOpenKpiAdmin(user.principal)),
  run: async ({ user, input }) => {
    const result = await applyTemplates({ principal: user.principal, personId: user.person.id }, input, todayInVietnam());
    refresh();
    return { data: { holders: result.holders, created: result.created, skipped: result.skipped, withoutTemplate: result.withoutTemplate }, audit: { resource: { type: "kpi_assignment", id: input.personId ?? input.positionId ?? "all" }, summary: `from ${input.fromPeriod}: ${result.created} created, ${result.skipped} kept`, after: result } };
  },
});
export async function applyTemplatesAction(input: unknown) {
  return applyPipeline(input);
}

const saveAssignmentPipeline = createAction({
  name: "performance.assignment.save",
  input: z.object({ assignmentId: optional(z.uuid()), personId: optional(z.uuid()), kpiId: optional(z.uuid()), weight, target: z.string().trim().min(1).max(30), fromPeriod: optional(month), toPeriod: optional(month) }),
  authorize: async (user, input) => {
    const personId = input.assignmentId ? (await findAssignment(input.assignmentId))?.personId : input.personId;
    return !!personId && managesPerson(user, personId);
  },
  run: async ({ user, input }) => {
    if (input.assignmentId) {
      const { before, after } = await updateAssignment(input.assignmentId, { weight: input.weight, target: input.target });
      refresh();
      return { data: { id: after.id }, audit: { resource: { type: "kpi_assignment", id: after.id, entityId: after.entityId }, summary: "weight / target", before, after } };
    }
    if (!input.personId || !input.kpiId || !input.fromPeriod) throw new Error("unreachable: authorize needs a person");
    const row = await createAssignment(user.person.id, { personId: input.personId, kpiId: input.kpiId, weight: input.weight, target: input.target, fromPeriod: input.fromPeriod, toPeriod: input.toPeriod });
    refresh();
    return { data: { id: row.id }, audit: { resource: { type: "kpi_assignment", id: row.id, entityId: row.entityId }, summary: `assigned from ${row.fromPeriod}`, after: row } };
  },
});
export async function saveAssignmentAction(input: unknown) {
  return saveAssignmentPipeline(input);
}

const endAssignmentPipeline = createAction({
  name: "performance.assignment.end",
  input: z.object({ assignmentId: z.uuid(), toPeriod: month }),
  authorize: async (user, input) => {
    const row = await findAssignment(input.assignmentId);
    return !!row && managesPerson(user, row.personId);
  },
  run: async ({ input }) => {
    const { before, after } = await endAssignment(input.assignmentId, input.toPeriod);
    refresh();
    return { data: { id: after.id }, audit: { resource: { type: "kpi_assignment", id: after.id, entityId: after.entityId }, summary: `ends ${input.toPeriod}`, before, after } };
  },
});
export async function endAssignmentAction(input: unknown) {
  return endAssignmentPipeline(input);
}

// ── Actuals ─────────────────────────────────────────────────────────────────────────────────

const entry = z.object({ assignmentId: z.uuid(), periodKey: z.string().regex(/^\d{4}-(0[1-9]|1[0-2]|Q[1-4])$/), actual: optional(z.string().trim().max(30)), notApplicable: checkbox.default(false), note: optional(z.string().trim().max(500)) });

const saveActualsPipeline = createAction({
  name: "performance.actual.save",
  // The grid posts `entries.<n>.<field>`: an object keyed by row number, or a plain array over HTTP.
  input: z.object({ entries: z.preprocess((value) => (value && typeof value === "object" && !Array.isArray(value) ? Object.values(value) : value), z.array(entry).min(1).max(500)) }),
  // Every line must be someone the actor may enter for — one foreign line refuses the lot, and nobody enters their own.
  authorize: async (user, input) => {
    const personIds = await peopleOfEntries(input.entries.map((item) => item.assignmentId));
    if (!personIds) return false;
    const directory = await loadDirectory();
    return personIds.every((personId) => {
      const person = directory.get(personId);
      return !!person && canEnterActualsFor(user.principal, person);
    });
  },
  run: async ({ user, input }) => {
    const result = await saveActuals(user.person.id, input.entries, "manual");
    refresh();
    return {
      data: { saved: result.saved, cleared: result.cleared, unchanged: result.unchanged },
      audit: { resource: { type: "kpi_actual", id: result.personIds.length === 1 ? result.personIds[0] : "bulk", entityId: result.entityIds.length === 1 ? result.entityIds[0] : null }, summary: `${result.saved} saved, ${result.cleared} cleared, ${result.unchanged} unchanged`, before: result.before, after: result.after },
    };
  },
});
export async function saveActualsAction(input: unknown) {
  return saveActualsPipeline(input);
}

// ── Close and reopen ────────────────────────────────────────────────────────────────────────

const closePipeline = createAction({
  name: "performance.period.close",
  input: z.object({ entityId: z.uuid(), month, overrideReason: optional(z.string().trim().min(5).max(1000)) }),
  authorize: (user, input) => canCloseKpiMonth(user.principal, input.entityId),
  run: async ({ user, input }) => {
    const result = await closeMonth(user.person.id, input, todayInVietnam());
    refresh();
    return {
      data: { people: result.people, scored: result.scored, averageBp: result.averageBp, exceptions: result.exceptions.length },
      audit: { resource: { type: "kpi_period", id: result.period.id, entityId: input.entityId }, summary: `${input.month} closed: ${result.people} people${result.exceptions.length > 0 ? `, ${result.exceptions.length} missing actuals overridden` : ""}`, after: { month: input.month, people: result.people, averageBp: result.averageBp, overrideReason: result.period.overrideReason, exceptions: result.period.exceptions } },
    };
  },
});
export async function closeKpiMonthAction(input: unknown) {
  return closePipeline(input);
}

const reopenPipeline = createAction({
  name: "performance.period.reopen",
  input: z.object({ entityId: z.uuid(), month, reason: z.string().trim().min(5).max(1000) }),
  authorize: (user) => canReopenKpiMonth(user.principal),
  run: async ({ user, input }) => {
    const { before, after, superseded } = await reopenMonth(user.person.id, input);
    refresh();
    return { data: { superseded }, audit: { resource: { type: "kpi_period", id: after.id, entityId: input.entityId }, summary: `${input.month} reopened: ${superseded} scores superseded — ${input.reason}`, before: { status: before.status, closedAt: before.closedAt }, after: { status: after.status, reopenReason: after.reopenReason, superseded } } };
  },
});
export async function reopenKpiMonthAction(input: unknown) {
  return reopenPipeline(input);
}

// ── Import ──────────────────────────────────────────────────────────────────────────────────

export async function stageKpiActualsAction(input: unknown) {
  return kpiActualImport.stage(input);
}
export async function commitKpiActualsAction(input: unknown) {
  return kpiActualImport.commit(input);
}
