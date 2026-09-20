// Turning "which entities may this principal see pay in?" into SQL (FR-ACL-04): every payroll
// list, report and export filters in the query, never after it. A test keeps each query honest.
import { inArray, type SQL, sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";

export type EntityReach = { all: true } | { all: false; entityIds: string[] };

/** undefined = no restriction (group-wide grant); otherwise a condition on the entity column — `false` when the reach is empty. */
export function withinReach(column: AnyPgColumn, reach: EntityReach): SQL | undefined {
  if (reach.all) return undefined;
  return reach.entityIds.length === 0 ? sql`false` : inArray(column, reach.entityIds);
}
