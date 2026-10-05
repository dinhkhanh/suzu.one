// Probations coming to an end, for the performance module's probation reviews (FR-PRF-03).
// Re-exported by service.ts, the only door into this module. Contract type, number and dates are
// personal tier — the line manager is told when a probation ends; the caller decides who sees it.
import "server-only";
import { and, asc, between, eq, isNull, sql } from "drizzle-orm";
import type { IsoDate } from "@/lib/dates";
import { db, schema, type Tx } from "@/lib/db";

type Executor = Tx | ReturnType<typeof db>;

export type ProbationEnding = { contractId: string; personId: string; entityId: string; endDate: IsoDate };

/**
 * Probation contracts in force whose last day falls between `from` and `to`, inclusive. One whose
 * employment already has a labour contract starting after it is left out: that probation has been
 * decided, and there is nothing left to review.
 */
export async function listProbationsEnding(window: { from: IsoDate; to: IsoDate }, executor: Executor = db()): Promise<ProbationEnding[]> {
  const contract = schema.contract;
  const rows = await executor
    .select({ contractId: contract.id, personId: contract.personId, entityId: contract.entityId, endDate: contract.endDate })
    .from(contract)
    .where(
      and(
        eq(contract.type, "probation"),
        isNull(contract.deletedAt),
        isNull(contract.terminatedOn),
        between(contract.endDate, window.from, window.to),
        sql`not exists (select 1 from ${contract} as next where next.employment_id = ${contract.employmentId} and next.id <> ${contract.id} and next.deleted_at is null and next.type in ('fixed_term', 'indefinite') and next.start_date > ${contract.endDate})`,
      ),
    )
    .orderBy(asc(contract.endDate), asc(contract.personId));
  return rows.map((row) => ({ ...row, endDate: row.endDate! }));
}
