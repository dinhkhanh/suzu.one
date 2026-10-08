// Was a version used by a run that can no longer be undone? (PAY-13.)
//
// An approved version that turned out to be wrong — a salary structure, a pay profile, a pay
// component, a pay policy, a statutory value — may be voided, unless pay was already worked out
// from it in a run that has gone too far to be calculated again:
//
//   payment_prepared, paid, locked   the money is on its way or gone: the wrong version is part of
//                                    what was paid, and the correction is a retro item instead.
//   proposed, approved               the run is with the CEO: it is returned to HR first, and then
//                                    the version may go (the run goes stale and is calculated again).
//
// A run still with C&B (draft, calculated) does not stand in the way; `run-readiness.ts` calls it
// stale once a version it used is voided. A rule version is "used" when the run's stored context
// names it; a person's structure or profile when the person is in a run of a month it covers.
//
// Statuses only — never a figure. No authorization inside.
import "server-only";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db, schema, type Tx } from "@/lib/db";
import type { IsoDate } from "@/lib/dates";
import type { ParameterVoidGuard } from "@/modules/platform/statutory/void-guards";

type Executor = Tx | ReturnType<typeof db>;

const IN_REVIEW = ["proposed", "approved"] as const;
const SETTLED = ["payment_prepared", "paid", "locked"] as const;
const BLOCKING = [...IN_REVIEW, ...SETTLED];

/** The refusal's message key for the runs found, or null when none stands in the way. */
function refusalOf(statuses: readonly string[]): string | null {
  if (statuses.some((status) => (SETTLED as readonly string[]).includes(status))) return "void_used_by_paid_run";
  if (statuses.some((status) => (IN_REVIEW as readonly string[]).includes(status))) return "void_run_in_review";
  return null;
}

export type RuleVersionKind = "policy" | "component" | "parameter";

/** A rule version (a pay policy, a pay component, a statutory value) named in a run's stored context. */
export async function ruleVersionRefusal(kind: RuleVersionKind, versionId: string, executor: Executor = db()): Promise<string | null> {
  const run = schema.payrollRun;
  const named =
    kind === "policy"
      ? sql`${run.context} ->> 'policyVersionId' = ${versionId}`
      : kind === "component"
        ? sql`jsonb_exists(${run.context} -> 'componentVersionIds', ${versionId})`
        : sql`exists (select 1 from jsonb_each_text(${run.context} -> 'parameterVersions') as used where used.value = ${versionId})`;
  const rows = await executor
    .selectDistinct({ status: run.status })
    .from(run)
    .where(and(inArray(run.status, BLOCKING), named));
  return refusalOf(rows.map((row) => row.status));
}

/**
 * A person's own version (a salary structure, a pay profile) of one entity, in force from `from`
 * to `to`: used by every run of that entity the person is in, for a month the dates reach.
 */
export async function personVersionRefusal(version: { personId: string; entityId: string; validFrom: IsoDate; validTo: IsoDate | null }, executor: Executor = db()): Promise<string | null> {
  const run = schema.payrollRun;
  const line = schema.payrollRunPerson;
  const rows = await executor
    .selectDistinct({ status: run.status })
    .from(line)
    .innerJoin(run, eq(run.id, line.runId))
    .where(
      and(
        eq(line.personId, version.personId),
        eq(run.entityId, version.entityId),
        inArray(run.status, BLOCKING),
        sql`${run.month} >= to_char(${version.validFrom}::date, 'YYYY-MM')`,
        version.validTo ? sql`${run.month} <= to_char(${version.validTo}::date, 'YYYY-MM')` : undefined,
      ),
    );
  return refusalOf(rows.map((row) => row.status));
}

/** Registered with the statutory store (`schema.ts`): a statutory value a run still stands on is not voided. */
export const parameterVoidGuard: ParameterVoidGuard = (tx, versionId) => ruleVersionRefusal("parameter", versionId, tx as Executor);
