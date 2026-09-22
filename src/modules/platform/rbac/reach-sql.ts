// `matchesReach` as WHERE clauses, so list queries never load people the viewer may not read and
// then throw them away. The pure semantics live in `policy.ts`; a test keeps the two in step.
import "server-only";
import { arrayOverlaps, eq, inArray, or, type SQL } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import type { Tx } from "@/lib/db";
import { listOrgUnits } from "../org/service";
import type { TierReach } from "./policy";

/** The units whose path passes through any of `unitIds` (self included), from rows already loaded. */
export function unitsBelow(units: readonly { id: string; path: readonly string[] }[], unitIds: readonly string[]): string[] {
  const wanted = new Set(unitIds);
  return units.filter((unit) => unit.path.some((id) => wanted.has(id))).map((unit) => unit.id);
}

type Executor = Tx | ReturnType<typeof db>;
type UuidColumn = typeof schema.person.departmentId;

/**
 * The units a grant on `unitIds` reaches: those units and every unit below them (FR-PLT-16).
 * For rows that store one unit id and no path of their own — an assignment, a job opening.
 */
export async function unitsWithin(unitIds: readonly string[], executor?: Executor): Promise<string[]> {
  if (unitIds.length === 0) return [];
  // Outside a transaction the tree comes from the shared cache: no round trip before the real query.
  if (!executor) return unitsBelow(await listOrgUnits(), unitIds);
  const rows = await executor
    .select({ id: schema.orgUnit.id })
    .from(schema.orgUnit)
    .where(arrayOverlaps(schema.orgUnit.path, [...unitIds]));
  return rows.map((row) => row.id);
}

/**
 * Which of `person` the reach admits. `person` must be selected from (or joined) un-aliased.
 * Returns undefined for a reach over everyone — the caller then adds no condition at all.
 */
export function personInReachSql(reach: TierReach): SQL | undefined {
  if (reach.all) return undefined;
  const clauses = [
    reach.entityIds.length ? inArray(schema.person.primaryEntityId, reach.entityIds) : undefined,
    // The person's own unit or any unit above it: one array overlap, whatever the depth.
    reach.unitIds.length ? arrayOverlaps(schema.person.orgUnitPath, reach.unitIds) : undefined,
    reach.managerOf ? eq(schema.person.managerId, reach.managerOf) : undefined,
  ].filter((clause): clause is SQL => !!clause);
  return clauses.length ? or(...clauses) : undefined;
}

/** The same question about a row that names a unit of its own (an assignment): `unitIds` already expanded by `unitsWithin`. */
export const unitColumnInReachSql = (column: UuidColumn, expandedUnitIds: readonly string[]): SQL | undefined => (expandedUnitIds.length ? inArray(column, [...expandedUnitIds]) : undefined);
