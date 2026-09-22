// SQL pieces the attendance screens share when they list people: who a set of reaches admits
// (so a list never loads the whole person table to throw most of it away) and the employee code
// of the latest employment, read in the same query.
import "server-only";
import { desc, eq, or, type SQL, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { reachesNothing, type TierReach } from "@/modules/platform/rbac/policy";
import { personInReachSql } from "@/modules/platform/rbac/reach-sql";

/**
 * People any of `reaches` admits, or who meet any of `extra`. `person` must be in the query
 * un-aliased. undefined = everyone (a reach over everyone); a false condition when nothing admits anyone.
 * The screens still ask their policy function of each row: this only keeps the rest out of the query.
 */
export function anyReachSql(reaches: readonly TierReach[], ...extra: (SQL | undefined)[]): SQL | undefined {
  if (reaches.some((reach) => reach.all)) return undefined;
  const clauses = [...reaches.filter((reach) => !reachesNothing(reach)).map(personInReachSql), ...extra].filter((clause): clause is SQL => !!clause);
  return clauses.length ? or(...clauses) : sql`false`;
}

/** The employee code of the person's latest employment (what `listEmploymentFacts` calls `employeeCode`), as a column. */
export const latestEmployeeCode = (): SQL<string | null> =>
  sql<string | null>`(${db().select({ code: schema.employment.employeeCode }).from(schema.employment).where(eq(schema.employment.personId, schema.person.id)).orderBy(desc(schema.employment.startDate)).limit(1)})`;
