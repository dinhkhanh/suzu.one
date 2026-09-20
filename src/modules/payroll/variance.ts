// The variance check of a stored run (FR-PAY-31): gathering what the pure comparator needs.
//
// Nothing is stored. The comparison is made when it is asked for, from this run's results and the
// previous month's, so it is never stale — and so no second copy of everyone's pay is written down.
// No authorization inside; the screens check `canReadPayroll` / `canManageCompensation` first.
import "server-only";
import { and, eq, ne } from "drizzle-orm";
import { db, schema, type Tx } from "@/lib/db";
import { listPayrollFacts } from "@/modules/core-hr/service";
import { compareRuns, type VarianceReport } from "./engine/variance";
import { getPayrollPolicyVersion } from "./policies";
import { openResult, type PayrollRunRow } from "./run-storage";

type Executor = Tx | ReturnType<typeof db>;

/** "2026-08" → "2026-07". */
export function previousMonth(month: string): string {
  const [year, index] = month.split("-").map(Number);
  return index === 1 ? `${year - 1}-12` : `${year}-${String(index - 1).padStart(2, "0")}`;
}

export type RunVariance = VarianceReport & {
  previousMonth: string;
  /** False when the entity has no earlier run at all: everybody is "new" and that means nothing. */
  hasPrevious: boolean;
  names: Map<string, { fullName: string; employeeCode: string | null }>;
};

/**
 * This run against the month before it. The comparison is per person and in total (FR-PAY-31);
 * `missing_bank_account` and `missing_tax_code` are checked against the people's records **as they
 * stand now**, not as they stood when the run was calculated — the point is whether this payroll
 * can be paid and declared today.
 */
export async function getRunVariance(run: PayrollRunRow, executor: Executor = db()): Promise<RunVariance> {
  const month = previousMonth(run.month);
  const [currentRows, previousRun] = await Promise.all([
    executor.select().from(schema.payrollRunPerson).where(eq(schema.payrollRunPerson.runId, run.id)),
    lastComparableRun(run, month, executor),
  ]);
  const previousRows = previousRun ? await executor.select().from(schema.payrollRunPerson).where(eq(schema.payrollRunPerson.runId, previousRun.id)) : [];

  const current = currentRows.map((row) => ({ personId: row.personId, result: openResult(row) }));
  const previous = previousRows.map((row) => ({ personId: row.personId, result: openResult(row) }));

  const personIds = [...new Set([...current.map((row) => row.personId), ...previous.map((row) => row.personId)])];
  const facts = personIds.length > 0 ? await listPayrollFacts({ personIds }, run.month, executor) : [];
  const profileOf = new Map(current.map((row) => [row.personId, row.result.profile]));

  const report = compareRuns({
    current,
    previous,
    thresholdBp: await thresholdOf(run, executor),
    facts: facts.map((fact) => {
      const profile = profileOf.get(fact.personId) ?? "statutory";
      return {
        personId: fact.personId,
        hasBankAccount: !!fact.bankAccount,
        hasTaxCode: fact.hasTaxCode,
        profile,
        // The Simple profile is paid in cash by the chief accountant (SRS D18, FR-PAY-39).
        paidInCash: profile === "simple",
      };
    }),
  });

  return {
    ...report,
    previousMonth: month,
    hasPrevious: !!previousRun,
    names: new Map(facts.map((fact) => [fact.personId, { fullName: fact.fullName, employeeCode: fact.employeeCode }])),
  };
}

/** The regular run of the month before — the only one worth comparing a month with. */
async function lastComparableRun(run: PayrollRunRow, month: string, executor: Executor): Promise<PayrollRunRow | null> {
  // An off-cycle run is compared with nothing: a bonus has no "last month".
  if (run.kind !== "regular") return null;
  const [previous] = await executor
    .select()
    .from(schema.payrollRun)
    .where(and(eq(schema.payrollRun.entityId, run.entityId), eq(schema.payrollRun.month, month), eq(schema.payrollRun.kind, "regular"), ne(schema.payrollRun.status, "cancelled")))
    .limit(1);
  return previous ?? null;
}

/**
 * The entity's anomaly threshold, from the very policy version the run was calculated with — so a
 * policy changed since does not silently re-flag a month that was already looked at.
 */
async function thresholdOf(run: PayrollRunRow, executor: Executor): Promise<number> {
  const policyVersionId = (run.context as { policyVersionId?: string } | null)?.policyVersionId;
  if (!policyVersionId) return DEFAULT_THRESHOLD_BP;
  const policy = await getPayrollPolicyVersion(policyVersionId, executor).catch(() => null);
  return policy?.value.varianceThresholdBp ?? DEFAULT_THRESHOLD_BP;
}

/** Used only when a run carries no policy of its own: 10%. */
export const DEFAULT_THRESHOLD_BP = 1000;

/** People in the run who are missing something the payment or the declaration needs. */
export async function runBlockers(run: PayrollRunRow, executor: Executor = db()): Promise<{ personId: string; flags: string[] }[]> {
  const variance = await getRunVariance(run, executor);
  return variance.flagged
    .filter((person) => person.flags.includes("missing_bank_account") || person.flags.includes("missing_tax_code") || person.flags.includes("negative_net"))
    .map((person) => ({ personId: person.personId, flags: person.flags }));
}
