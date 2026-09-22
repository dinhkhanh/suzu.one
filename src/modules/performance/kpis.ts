// The KPI library, the templates per position and what each person is measured on (FR-PRF-02).
// Authorization happens in the actions; the rules that protect a stored score live here:
// nothing that a closed month was computed from can be changed afterwards.
import "server-only";
import { and, asc, eq, gte, inArray, isNull, or } from "drizzle-orm";
import { ActionError } from "@/lib/action";
import { cached, invalidate } from "@/lib/cache";
import { db, schema, type Tx } from "@/lib/db";
import { listPositionHolders, listPositions } from "@/modules/core-hr/service";
import type { Principal } from "../platform/rbac/policy";
import { targetProblem } from "./engine/kpi-score";
import { coversMonth, isKpiMonth, type KpiDirection, type KpiFrequency, type KpiUnit, parseMetricValue, scoringMonthOf } from "./enums";
import { type Directory, loadDirectory } from "./people";
import { canManageAssignmentsOf } from "./policy";

type Executor = Tx | ReturnType<typeof db>;
export type KpiRow = Omit<typeof schema.kpiDefinition.$inferSelect, "unit" | "direction" | "frequency"> & { unit: KpiUnit; direction: KpiDirection; frequency: KpiFrequency };
export type PositionKpiRow = typeof schema.positionKpi.$inferSelect;
export type KpiAssignmentRow = typeof schema.kpiAssignment.$inferSelect;

const asKpi = (row: typeof schema.kpiDefinition.$inferSelect): KpiRow => row as KpiRow;

// ── Library ─────────────────────────────────────────────────────────────────────────────────

// The library and the position templates are configuration (tens of rows): cached whole, filtered
// here, and cleared by the use-cases below once their change has committed.
const KPI_CACHE = { library: "performance:kpis", positionKpis: "performance:position-kpis" } as const;
const KPI_TTL = 60 * 60;

/** The whole library, by code. Inside a transaction pass it, and the rows come from that transaction, not the cache. */
function allKpis(executor?: Executor): Promise<(typeof schema.kpiDefinition.$inferSelect)[]> {
  const load = (from: Executor) => from.select().from(schema.kpiDefinition).orderBy(asc(schema.kpiDefinition.code));
  return executor ? load(executor) : cached(KPI_CACHE.library, KPI_TTL, () => load(db()));
}

export async function listKpis(options: { includeInactive?: boolean } = {}, executor?: Executor): Promise<KpiRow[]> {
  const rows = await allKpis(executor);
  return (options.includeInactive ? rows : rows.filter((row) => row.isActive)).map(asKpi);
}

export type KpiInput = { code: string; name: string; description: string | null; unit: KpiUnit; direction: KpiDirection; frequency: KpiFrequency; capBp: number; floorBp: number; isActive: boolean };

export async function saveKpi(kpiId: string | null, input: KpiInput): Promise<{ before: KpiRow | null; after: KpiRow }> {
  if (input.floorBp > input.capBp) throw new ActionError("kpi_floor_above_cap");
  const saved = await db().transaction(async (tx): Promise<{ before: KpiRow | null; after: KpiRow }> => {
    const [clash] = await tx.select({ id: schema.kpiDefinition.id }).from(schema.kpiDefinition).where(eq(schema.kpiDefinition.code, input.code)).limit(1);
    if (clash && clash.id !== kpiId) throw new ActionError("kpi_code_taken");
    if (!kpiId) {
      const [after] = await tx.insert(schema.kpiDefinition).values({ ...input, editedAt: new Date() }).returning();
      return { before: null, after: asKpi(after) };
    }
    const [before] = await tx.select().from(schema.kpiDefinition).where(eq(schema.kpiDefinition.id, kpiId)).limit(1).for("update");
    if (!before) throw new ActionError("kpi_not_found");
    // What a KPI measures cannot change under the people already measured on it: make a new KPI instead.
    if (before.unit !== input.unit || before.direction !== input.direction || before.frequency !== input.frequency || before.code !== input.code) {
      const [used] = await tx.select({ id: schema.kpiAssignment.id }).from(schema.kpiAssignment).where(eq(schema.kpiAssignment.kpiId, kpiId)).limit(1);
      if (used) throw new ActionError("kpi_in_use");
    }
    const [after] = await tx.update(schema.kpiDefinition).set({ ...input, editedAt: new Date(), updatedAt: new Date() }).where(eq(schema.kpiDefinition.id, kpiId)).returning();
    return { before: asKpi(before), after: asKpi(after) };
  });
  await invalidate(KPI_CACHE.library);
  return saved;
}

// ── Templates per position ──────────────────────────────────────────────────────────────────

export type PositionTemplate = { positionId: string; positionName: string; entityId: string | null; totalWeight: number; lines: { id: string; kpi: KpiRow; weight: number; targetValue: number; sortOrder: number }[] };

/** Every position's lines. Outside a transaction: the three cached catalogues, joined here in the query's order. */
async function templateRows(executor?: Executor): Promise<{ line: PositionKpiRow; kpi: typeof schema.kpiDefinition.$inferSelect; positionName: string }[]> {
  if (executor) {
    return executor
      .select({ line: schema.positionKpi, kpi: schema.kpiDefinition, positionName: schema.position.name })
      .from(schema.positionKpi)
      .innerJoin(schema.kpiDefinition, eq(schema.kpiDefinition.id, schema.positionKpi.kpiId))
      .innerJoin(schema.position, eq(schema.position.id, schema.positionKpi.positionId))
      .orderBy(asc(schema.position.searchName), asc(schema.positionKpi.sortOrder), asc(schema.kpiDefinition.code));
  }
  const [lines, kpis, positions] = await Promise.all([cached(KPI_CACHE.positionKpis, KPI_TTL, () => db().select().from(schema.positionKpi)), allKpis(), listPositions()]);
  const kpiOf = new Map(kpis.map((kpi) => [kpi.id, kpi]));
  // The position catalogue comes ordered by search name: its index is the first sort key.
  const positionOf = new Map(positions.map((position, index) => [position.id, { name: position.name, rank: index }]));
  return lines
    .flatMap((line) => {
      const kpi = kpiOf.get(line.kpiId);
      const position = positionOf.get(line.positionId);
      return kpi && position ? [{ line, kpi, positionName: position.name, rank: position.rank }] : [];
    })
    .sort((a, b) => a.rank - b.rank || a.line.sortOrder - b.line.sortOrder || (a.kpi.code < b.kpi.code ? -1 : a.kpi.code > b.kpi.code ? 1 : 0))
    .map(({ line, kpi, positionName }) => ({ line, kpi, positionName }));
}

export async function listPositionTemplates(executor?: Executor): Promise<PositionTemplate[]> {
  const rows = await templateRows(executor);
  const templates = new Map<string, PositionTemplate>();
  for (const { line, kpi, positionName } of rows) {
    const key = `${line.positionId}:${line.entityId ?? ""}`;
    const template = templates.get(key) ?? { positionId: line.positionId, positionName, entityId: line.entityId, totalWeight: 0, lines: [] };
    template.lines.push({ id: line.id, kpi: asKpi(kpi), weight: line.weight, targetValue: line.targetValue, sortOrder: line.sortOrder });
    template.totalWeight += line.weight;
    templates.set(key, template);
  }
  return [...templates.values()];
}

/** An entity's own set replaces the group's for that position. */
export const templateFor = (templates: readonly PositionTemplate[], positionId: string, entityId: string | null): PositionTemplate | null =>
  templates.find((template) => template.positionId === positionId && entityId !== null && template.entityId === entityId) ?? templates.find((template) => template.positionId === positionId && template.entityId === null) ?? null;

/** "95", "4,5", "1.500.000" → the stored integer, or the reason it cannot be a target. */
export function parseTarget(kpi: Pick<KpiRow, "unit" | "direction">, text: string): number {
  const value = parseMetricValue(kpi.unit, text);
  if (value === null) throw new ActionError("kpi_bad_value");
  const problem = targetProblem(kpi.direction, value);
  if (problem) throw new ActionError(problem);
  return value;
}

export async function findPositionKpi(id: string, executor: Executor = db()): Promise<PositionKpiRow | null> {
  const [row] = await executor.select().from(schema.positionKpi).where(eq(schema.positionKpi.id, id)).limit(1);
  return row ?? null;
}

export async function savePositionKpi(input: { positionId: string; entityId: string | null; kpiId: string; weight: number; target: string; sortOrder: number }): Promise<{ before: PositionKpiRow | null; after: PositionKpiRow }> {
  const saved = await db().transaction(async (tx) => {
    const [kpi] = await tx.select().from(schema.kpiDefinition).where(eq(schema.kpiDefinition.id, input.kpiId)).limit(1);
    const [position] = await tx.select({ id: schema.position.id }).from(schema.position).where(eq(schema.position.id, input.positionId)).limit(1);
    if (!kpi || !position) throw new ActionError("kpi_not_found");
    const targetValue = parseTarget(asKpi(kpi), input.target);
    const [before] = await tx
      .select()
      .from(schema.positionKpi)
      .where(and(eq(schema.positionKpi.positionId, input.positionId), eq(schema.positionKpi.kpiId, input.kpiId), input.entityId ? eq(schema.positionKpi.entityId, input.entityId) : isNull(schema.positionKpi.entityId)))
      .limit(1);
    const values = { weight: input.weight, targetValue, sortOrder: input.sortOrder };
    const [after] = before
      ? await tx.update(schema.positionKpi).set({ ...values, updatedAt: new Date() }).where(eq(schema.positionKpi.id, before.id)).returning()
      : await tx.insert(schema.positionKpi).values({ positionId: input.positionId, entityId: input.entityId, kpiId: input.kpiId, ...values }).returning();
    return { before: before ?? null, after };
  });
  await invalidate(KPI_CACHE.positionKpis);
  return saved;
}

/** A template is a starting point, not a record: removing a line leaves the assignments made from it alone. */
export async function removePositionKpi(id: string): Promise<PositionKpiRow> {
  const [row] = await db().delete(schema.positionKpi).where(eq(schema.positionKpi.id, id)).returning();
  if (!row) throw new ActionError("kpi_not_found");
  await invalidate(KPI_CACHE.positionKpis);
  return row;
}

// ── Assignments ─────────────────────────────────────────────────────────────────────────────

export type AssignmentView = KpiAssignmentRow & { kpi: KpiRow };

export async function listAssignments(filter: { personIds?: readonly string[]; entityId?: string }, executor: Executor = db()): Promise<AssignmentView[]> {
  if (filter.personIds?.length === 0) return [];
  const rows = await executor
    .select({ assignment: schema.kpiAssignment, kpi: schema.kpiDefinition })
    .from(schema.kpiAssignment)
    .innerJoin(schema.kpiDefinition, eq(schema.kpiDefinition.id, schema.kpiAssignment.kpiId))
    .where(and(filter.personIds ? inArray(schema.kpiAssignment.personId, [...filter.personIds]) : undefined, filter.entityId ? eq(schema.kpiAssignment.entityId, filter.entityId) : undefined))
    .orderBy(asc(schema.kpiDefinition.code), asc(schema.kpiAssignment.fromPeriod));
  return rows.map(({ assignment, kpi }) => ({ ...assignment, kpi: asKpi(kpi) }));
}

export async function findAssignment(id: string, executor: Executor = db()): Promise<KpiAssignmentRow | null> {
  const [row] = await executor.select().from(schema.kpiAssignment).where(eq(schema.kpiAssignment.id, id)).limit(1);
  return row ?? null;
}

const overlaps = (a: { fromPeriod: string; toPeriod: string | null }, b: { fromPeriod: string; toPeriod: string | null }) => (a.toPeriod === null || b.fromPeriod <= a.toPeriod) && (b.toPeriod === null || a.fromPeriod <= b.toPeriod);

/** Months of this entity already closed from `fromPeriod` on (and up to `toPeriod`): the scores there are stored. */
async function closedMonthsWithin(tx: Executor, entityId: string, range: { fromPeriod: string; toPeriod: string | null }): Promise<string[]> {
  const rows = await tx
    .select({ month: schema.kpiPeriod.month })
    .from(schema.kpiPeriod)
    .where(and(eq(schema.kpiPeriod.entityId, entityId), eq(schema.kpiPeriod.status, "closed"), gte(schema.kpiPeriod.month, range.fromPeriod)));
  return rows.map((row) => row.month).filter((month) => coversMonth(range, month)).sort();
}

export type AssignmentInput = { personId: string; kpiId: string; weight: number; target: string; fromPeriod: string; toPeriod: string | null };

export async function createAssignment(actorPersonId: string, input: AssignmentInput): Promise<KpiAssignmentRow> {
  if (!isKpiMonth(input.fromPeriod) || (input.toPeriod !== null && (!isKpiMonth(input.toPeriod) || input.toPeriod < input.fromPeriod))) throw new ActionError("kpi_bad_period");
  return db().transaction(async (tx) => {
    const [kpi] = await tx.select().from(schema.kpiDefinition).where(eq(schema.kpiDefinition.id, input.kpiId)).limit(1);
    const [person] = await tx.select({ id: schema.person.id, entityId: schema.person.primaryEntityId }).from(schema.person).where(eq(schema.person.id, input.personId)).limit(1).for("update");
    if (!kpi || !person?.entityId) throw new ActionError("kpi_not_found");
    if (!kpi.isActive) throw new ActionError("kpi_inactive");
    const targetValue = parseTarget(asKpi(kpi), input.target);
    const existing = await tx.select().from(schema.kpiAssignment).where(and(eq(schema.kpiAssignment.personId, input.personId), eq(schema.kpiAssignment.kpiId, input.kpiId)));
    if (existing.some((row) => overlaps(row, input))) throw new ActionError("kpi_assignment_overlaps");
    // A closed month's score was computed without this KPI; it cannot appear there afterwards.
    if ((await closedMonthsWithin(tx, person.entityId, input)).length > 0) throw new ActionError("kpi_month_closed");
    const [row] = await tx.insert(schema.kpiAssignment).values({ personId: input.personId, entityId: person.entityId, kpiId: input.kpiId, weight: input.weight, targetValue, fromPeriod: input.fromPeriod, toPeriod: input.toPeriod, createdByPersonId: actorPersonId }).returning();
    return row;
  });
}

/** Weight and target: only while no month of the assignment is closed. Afterwards: end it and start a new one. */
export async function updateAssignment(assignmentId: string, input: { weight: number; target: string }): Promise<{ before: KpiAssignmentRow; after: KpiAssignmentRow }> {
  return db().transaction(async (tx) => {
    const [before] = await tx.select().from(schema.kpiAssignment).where(eq(schema.kpiAssignment.id, assignmentId)).limit(1).for("update");
    if (!before) throw new ActionError("kpi_not_found");
    const [kpi] = await tx.select().from(schema.kpiDefinition).where(eq(schema.kpiDefinition.id, before.kpiId)).limit(1);
    const targetValue = parseTarget(asKpi(kpi), input.target);
    const closed = await closedMonthsWithin(tx, before.entityId, before);
    if (closed.length > 0) throw new ActionError("kpi_assignment_has_closed_months", { closedMonths: closed });
    const [after] = await tx.update(schema.kpiAssignment).set({ weight: input.weight, targetValue, updatedAt: new Date() }).where(eq(schema.kpiAssignment.id, assignmentId)).returning();
    return { before, after };
  });
}

/** The last month the KPI counts. Not before a closed month it was scored in, nor before an actual already entered. */
export async function endAssignment(assignmentId: string, toPeriod: string): Promise<{ before: KpiAssignmentRow; after: KpiAssignmentRow }> {
  if (!isKpiMonth(toPeriod)) throw new ActionError("kpi_bad_period");
  return db().transaction(async (tx) => {
    const [before] = await tx.select().from(schema.kpiAssignment).where(eq(schema.kpiAssignment.id, assignmentId)).limit(1).for("update");
    if (!before) throw new ActionError("kpi_not_found");
    if (toPeriod < before.fromPeriod) throw new ActionError("kpi_bad_period");
    const closed = await closedMonthsWithin(tx, before.entityId, before);
    if (closed.some((month) => month > toPeriod)) throw new ActionError("kpi_month_closed");
    const actuals = await tx.select({ periodKey: schema.kpiActual.periodKey }).from(schema.kpiActual).where(eq(schema.kpiActual.assignmentId, assignmentId));
    if (actuals.some((actual) => scoringMonthOf(actual.periodKey) > toPeriod)) throw new ActionError("kpi_actuals_after_end");
    const [after] = await tx.update(schema.kpiAssignment).set({ toPeriod, updatedAt: new Date() }).where(eq(schema.kpiAssignment.id, assignmentId)).returning();
    return { before, after };
  });
}

export type ApplyResult = { holders: number; created: number; skipped: number; withoutTemplate: number; people: string[] };

/**
 * Give the holders of a position (or one person) the KPIs of their position's template from a
 * month on. Idempotent: a KPI the person already carries in that range is left exactly as it is.
 * Only people the actor looks after as HR are touched; the rest are not even counted.
 */
export async function applyTemplates(actor: { principal: Principal; personId: string }, input: { fromPeriod: string; positionId: string | null; personId: string | null }, today: string, executor: ReturnType<typeof db> = db()): Promise<ApplyResult> {
  if (!isKpiMonth(input.fromPeriod)) throw new ActionError("kpi_bad_period");
  const firstDay = `${input.fromPeriod}-01`;
  return executor.transaction(async (tx) => {
    const [directory, templates, holders] = await Promise.all([loadDirectory(tx), listPositionTemplates(tx), listPositionHolders(firstDay > today ? firstDay : today, tx)]);
    const chosen = holders.filter((holder) => (!input.positionId || holder.positionId === input.positionId) && (!input.personId || holder.personId === input.personId) && inScope(actor.principal, directory, holder.personId));
    const result: ApplyResult = { holders: chosen.length, created: 0, skipped: 0, withoutTemplate: 0, people: [] };
    if (chosen.length === 0) return result;
    const existing = await tx.select().from(schema.kpiAssignment).where(and(inArray(schema.kpiAssignment.personId, chosen.map((holder) => holder.personId)), or(isNull(schema.kpiAssignment.toPeriod), gte(schema.kpiAssignment.toPeriod, input.fromPeriod))));
    const closedByEntity = new Map<string, string[]>();
    for (const holder of chosen) {
      const person = directory.get(holder.personId)!;
      const entityId = person.entityId ?? holder.entityId;
      const template = templateFor(templates, holder.positionId, entityId);
      if (!template) {
        result.withoutTemplate++;
        continue;
      }
      let touched = false;
      for (const line of template.lines) {
        if (!line.kpi.isActive || existing.some((row) => row.personId === holder.personId && row.kpiId === line.kpi.id)) {
          result.skipped++;
          continue;
        }
        // Something new would land in a month whose scores are stored: start from the next open month instead.
        if (!closedByEntity.has(entityId)) closedByEntity.set(entityId, await closedMonthsWithin(tx, entityId, { fromPeriod: input.fromPeriod, toPeriod: null }));
        if (closedByEntity.get(entityId)!.length > 0) throw new ActionError("kpi_month_closed", { closedMonths: closedByEntity.get(entityId) });
        await tx.insert(schema.kpiAssignment).values({ personId: holder.personId, entityId, kpiId: line.kpi.id, weight: line.weight, targetValue: line.targetValue, fromPeriod: input.fromPeriod, toPeriod: null, sourcePositionId: holder.positionId, createdByPersonId: actor.personId });
        result.created++;
        touched = true;
      }
      if (touched) result.people.push(holder.personId);
    }
    return result;
  });
}

const inScope = (principal: Principal, directory: Directory, personId: string): boolean => {
  const person = directory.get(personId);
  return !!person && person.status !== "offboarded" && canManageAssignmentsOf(principal, person);
};
