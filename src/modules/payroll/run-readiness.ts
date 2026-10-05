// Is this run fit to be put forward? (FR-PAY-30, FR-PAY-31.)
//
// Three questions, asked of a run that is still with C&B, and answered from what is in the
// database now — nothing is stored, so the answer is never out of date:
//
//   * **Is it stale?** Something the figures were worked out from has changed since the last
//     calculation: a typed-in figure, a retro item waiting for the people in it, the locked
//     timesheet, a salary decision, a leaver's unused leave paid out. A stale run is calculated again before anything else.
//   * **Is something in the way?** (`blockers`) The figures themselves are wrong or incomplete,
//     and only a change to the run puts that right: a person the month owes pay to who is not in
//     it, a figure somebody typed that the calculation did not pay, a net below zero.
//   * **What else should be looked at?** (`warnings`) Things that are settled in a person's
//     record without touching the figures — no bank account, no tax code — or that may be meant:
//     somebody paid by the piece has no salary structure. Payment and the filings deal with these
//     (`payments.ts` will not call a run paid while somebody could not be paid).
//
// `stepRun` refuses to propose a run that is stale or blocked; the run screen shows all three, by
// name. Statutory values the chief accountant has not confirmed yet are deliberately **not**
// here: the parallel run happens before that sign-off, so they are a notice on the screen and
// never a refusal.
//
// No authorization inside; ids, codes and names of rules — never a figure.
import "server-only";
import { and, eq, gt, gte, isNull, lt, lte, or, sql } from "drizzle-orm";
import { db, schema, type Tx } from "@/lib/db";
import { getLockedTimesheets } from "@/modules/attendance/service";
import { listPayoutTotals } from "@/modules/leave/service";
import { type CalculationContext, listPeopleWithoutProfile } from "./calculation";
import { payPeriodOf } from "./engine/period";
import { UNPAID_FIGURE_WARNINGS } from "./engine/types";
import type { PayrollRunRow } from "./run-storage";
import { type RunVariance, runBlockers } from "./variance";

type Executor = Tx | ReturnType<typeof db>;

/** Why a calculated run no longer says what it would pay. */
export type StaleReason = "inputs_changed" | "retro_waiting" | "timesheet_changed" | "salary_changed" | "leave_payout_posted";

export type IssueKind =
  // On the locked timesheet without a pay profile: the calculation refuses the whole month.
  | "no_pay_profile"
  // On the locked timesheet but not in the calculated run.
  | "not_in_run"
  // A figure typed in for somebody the run does not pay: it would simply vanish.
  | "input_outside_run"
  // The engine left a typed-in figure or a retro item out of the result (`UNPAID_FIGURE_WARNINGS`).
  | "figure_not_paid"
  | "no_salary_structure"
  // Leaves this month: the rest of the final settlement is typed in (FR-PAY-18).
  | "final_settlement"
  // What the variance check already knows (FR-PAY-31).
  | "negative_net"
  | "missing_bank_account"
  | "missing_tax_code";

/**
 * The kinds that refuse a proposal: the ones only a change to the run's own figures can cure.
 * The others are settled elsewhere and do not stop the run being put forward — move a kind into
 * this list and `stepRun` refuses it, nothing else needs to change.
 */
export const REFUSES_PROPOSAL: readonly IssueKind[] = ["no_pay_profile", "not_in_run", "input_outside_run", "figure_not_paid", "negative_net"];

export type RunIssue = { kind: IssueKind; personId: string; /** The component codes concerned, for a typed-in figure. */ codes?: string[] };

export type RunReadiness = { stale: StaleReason[]; blockers: RunIssue[]; warnings: RunIssue[] };

export const READY: RunReadiness = { stale: [], blockers: [], warnings: [] };

/**
 * What stands between this run and its proposal. Only a run still open for editing is asked: once
 * proposed it is evidence, and nothing here could change it anyway.
 */
export async function getRunReadiness(run: PayrollRunRow, options: { executor?: Executor; variance?: Pick<RunVariance, "flagged"> } = {}): Promise<RunReadiness> {
  if (run.status !== "draft" && run.status !== "calculated") return READY;
  const executor = options.executor ?? db();
  const regular = run.kind === "regular";
  const calculated = !!run.calculatedAt;
  const period = payPeriodOf(run.month, 0);

  const [inputs, people, locked, waiting, salaries, payouts, flagged] = await Promise.all([
    // Codes and times only: the amounts stay sealed.
    executor.select({ personId: schema.payrollRunInput.personId, code: schema.payrollRunInput.code, touchedAt: sql<Date>`greatest(${schema.payrollRunInput.createdAt}, ${schema.payrollRunInput.updatedAt})`.mapWith(schema.payrollRunInput.updatedAt) }).from(schema.payrollRunInput).where(eq(schema.payrollRunInput.runId, run.id)),
    executor.select({ personId: schema.payrollRunPerson.personId, warnings: schema.payrollRunPerson.warnings }).from(schema.payrollRunPerson).where(eq(schema.payrollRunPerson.runId, run.id)),
    regular ? getLockedTimesheets(run.entityId, run.month, executor) : Promise.resolve(null),
    // Differences of earlier months that no run has carried yet (FR-PAY-17).
    regular
      ? executor.selectDistinct({ personId: schema.payrollRetroItem.personId }).from(schema.payrollRetroItem).where(and(eq(schema.payrollRetroItem.entityId, run.entityId), eq(schema.payrollRetroItem.status, "open"), lt(schema.payrollRetroItem.sourceMonth, run.month)))
      : Promise.resolve([]),
    // Salary decisions taken after the calculation that apply inside the month.
    regular && run.calculatedAt
      ? executor
          .selectDistinct({ personId: schema.salaryStructure.personId })
          .from(schema.salaryStructure)
          .where(and(eq(schema.salaryStructure.entityId, run.entityId), gt(schema.salaryStructure.createdAt, run.calculatedAt), lte(schema.salaryStructure.validFrom, period.end), or(isNull(schema.salaryStructure.validTo), gte(schema.salaryStructure.validTo, period.start))))
      : Promise.resolve([]),
    // Unused leave the ledger paid out to a leaver after the calculation (the daily leave job posts it the day after the last day).
    regular && run.calculatedAt ? listPayoutTotals(run.entityId, period.start, period.end, executor, { postedAfter: run.calculatedAt }) : Promise.resolve([]),
    calculated ? runBlockers(run, options.executor, options.variance) : Promise.resolve([]),
  ]);

  const inRun = new Set(people.map((row) => row.personId));
  const onTimesheet = new Set((locked?.people ?? []).map((row) => row.personId));
  // Who the run pays: the people it was calculated for, or — before the first calculation — the
  // people of the locked month. An off-cycle run pays exactly the people typed into it.
  const population = calculated ? inRun : regular && locked ? onTimesheet : null;

  const stale: StaleReason[] = [];
  if (run.calculatedAt) {
    const since = run.calculatedAt.getTime();
    // A run sent back to draft by a change has already said so with its status.
    if (run.status === "draft" || inputs.some((row) => row.touchedAt.getTime() > since)) stale.push("inputs_changed");
    if (waiting.some((row) => inRun.has(row.personId))) stale.push("retro_waiting");
    if (regular && lockOf(run) !== (locked?.lockedAt.getTime() ?? null)) stale.push("timesheet_changed");
    if (salaries.some((row) => inRun.has(row.personId))) stale.push("salary_changed");
    if (payouts.some((row) => inRun.has(row.personId))) stale.push("leave_payout_posted");
  }

  const issues: RunIssue[] = [];
  const withoutProfile = regular && locked ? await listPeopleWithoutProfile(run.entityId, run.month, executor, locked) : [];
  for (const person of withoutProfile) issues.push({ kind: "no_pay_profile", personId: person.personId });
  if (calculated && regular) {
    const noProfile = new Set(withoutProfile.map((person) => person.personId));
    for (const personId of onTimesheet) if (!inRun.has(personId) && !noProfile.has(personId)) issues.push({ kind: "not_in_run", personId });
  }
  if (population) {
    const outside = new Map<string, string[]>();
    for (const row of inputs) if (!population.has(row.personId)) outside.set(row.personId, [...(outside.get(row.personId) ?? []), row.code]);
    for (const [personId, codes] of outside) issues.push({ kind: "input_outside_run", personId, codes: codes.sort() });
  }
  for (const person of people) {
    if (person.warnings.some((warning) => (UNPAID_FIGURE_WARNINGS as readonly string[]).includes(warning))) issues.push({ kind: "figure_not_paid", personId: person.personId });
    if (person.warnings.includes("no_salary_structure")) issues.push({ kind: "no_salary_structure", personId: person.personId });
    if (person.warnings.includes("leaves_in_period")) issues.push({ kind: "final_settlement", personId: person.personId });
  }
  for (const person of flagged) for (const flag of person.flags) issues.push({ kind: flag, personId: person.personId });

  return { stale, blockers: issues.filter((issue) => REFUSES_PROPOSAL.includes(issue.kind)), warnings: issues.filter((issue) => !REFUSES_PROPOSAL.includes(issue.kind)) };
}

/** The moment the timesheet the run was calculated from was locked, as the run recorded it. */
function lockOf(run: PayrollRunRow): number | null {
  const lockedAt = (run.context as Pick<CalculationContext, "lockedAt"> | null)?.lockedAt;
  // The context is stored as JSON, so the date comes back as text.
  return lockedAt ? new Date(lockedAt).getTime() : null;
}
