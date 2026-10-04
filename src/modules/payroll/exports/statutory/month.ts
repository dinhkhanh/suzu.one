// Which runs a filing is built from, and how one person's month is read out of them (FR-PAY-35).
// Pure. Shared by the statutory exports and by the reports that are held against a filing.
//
// **Two rules, both about counting a month once.**
//
// 1. *Only what the CEO signed.* A filing reports what the company paid and withheld. A run that
//    is merely calculated or proposed may still change or be sent back, so nothing of it belongs
//    in a declaration: figures are taken from runs that are approved or further on.
//
// 2. *A month is a month, however many runs paid it.* A month can hold the regular run and an
//    off-cycle bonus (FR-PAY-19). Their stored PIT results do **not** simply add up, because
//    progressive tax is worked out on the month, not on the payment (`engine/pit.ts`):
//
//      taxableIncome                        each run stores **its own** income      → added
//      tax                                  each run stores what **it** withheld    → added
//      personal / dependent deductions      given once, by the month, and stored    → taken once
//      insurance and other deductions       again by every run that follows another → taken once
//      assessableIncome                     in the same month, already aggregated   → taken once
//
//    The run that was calculated **last** saw every other run of the month as its `priorInMonth`,
//    so its deductions and assessable income are the month's. (Golden case 16: a regular run of
//    30,000,000 then a bonus of 20,000,000 — the bonus run stores assessable 31,350,000, the
//    month's, not 4,500,000 of its own.) Adding the runs' deductions together, as this used to,
//    counted the personal deduction twice and the assessable income nearly twice in exactly the
//    bonus month.
//
//    A flat-rate run (no contract, non-resident) is taxed per payment and never aggregates, so
//    flat-rate figures are added as they stand. A month whose runs were taxed by *different*
//    methods — a profile changed between two runs — is added the same way and may then overstate
//    assessable income; it is rare enough to be left to the accountant's eye.
import type { PitResult } from "../../engine/types";

/** A run whose figures may appear in a filing: signed by the CEO, or further on. */
export const FILED_RUN_STATUSES = ["approved", "payment_prepared", "paid", "locked"] as const;
export const isFiledRunStatus = (status: string): boolean => (FILED_RUN_STATUSES as readonly string[]).includes(status);

/** One run's PIT result for a person, with what is needed to put a month's runs in order. */
export type MonthRun = { pit: PitResult; kind: "regular" | "off_cycle"; calculatedAt: Date | null; createdAt: Date };

export type MonthPit = {
  method: PitResult["method"];
  taxableIncome: number;
  insuranceDeduction: number;
  personalDeduction: number;
  dependentDeduction: number;
  otherDeductions: number;
  assessableIncome: number;
  dependents: number;
  tax: number;
};

/** The order the month's runs were calculated in: the last one carries the month's totals. */
const byCalculation = (left: MonthRun, right: MonthRun): number =>
  (left.calculatedAt?.getTime() ?? 0) - (right.calculatedAt?.getTime() ?? 0) || Number(left.kind === "off_cycle") - Number(right.kind === "off_cycle") || left.createdAt.getTime() - right.createdAt.getTime();

/** One person's PIT for one month, from every counted run of that month. At least one run. */
export function pitOfMonth(runs: readonly MonthRun[]): MonthPit {
  const ordered = [...runs].sort(byCalculation);
  const sum = (pick: (pit: PitResult) => number, among: readonly MonthRun[] = ordered) => among.reduce((total, run) => total + pick(run.pit), 0);
  // The month's deductions and assessable income are on the last progressive run, once.
  const carrier = ordered.findLast((run) => run.pit.method === "progressive")?.pit ?? null;
  const flat = ordered.filter((run) => run.pit.method !== "progressive");
  const last = ordered.at(-1)!.pit;

  return {
    // The person is declared under the method of the month's regular run; a bonus run follows it.
    method: (ordered.findLast((run) => run.kind === "regular") ?? ordered.at(-1)!).pit.method,
    taxableIncome: sum((pit) => pit.taxableIncome),
    insuranceDeduction: (carrier?.insuranceDeduction ?? 0) + sum((pit) => pit.insuranceDeduction, flat),
    personalDeduction: (carrier?.personalDeduction ?? 0) + sum((pit) => pit.personalDeduction, flat),
    dependentDeduction: (carrier?.dependentDeduction ?? 0) + sum((pit) => pit.dependentDeduction, flat),
    otherDeductions: (carrier?.otherDeductions ?? 0) + sum((pit) => pit.otherDeductions, flat),
    assessableIncome: (carrier?.assessableIncome ?? 0) + sum((pit) => pit.assessableIncome, flat),
    dependents: (carrier ?? last).dependents,
    tax: sum((pit) => pit.tax),
  };
}

/** Several months of one person added together — a quarter, or the year. At least one month. */
export function sumMonths(months: readonly MonthPit[]): MonthPit {
  const last = months.at(-1)!;
  const sum = (pick: (month: MonthPit) => number) => months.reduce((total, month) => total + pick(month), 0);
  return {
    // The method and the dependants of the latest month are the ones the person is declared under.
    method: last.method,
    taxableIncome: sum((month) => month.taxableIncome),
    insuranceDeduction: sum((month) => month.insuranceDeduction),
    personalDeduction: sum((month) => month.personalDeduction),
    dependentDeduction: sum((month) => month.dependentDeduction),
    otherDeductions: sum((month) => month.otherDeductions),
    assessableIncome: sum((month) => month.assessableIncome),
    dependents: last.dependents,
    tax: sum((month) => month.tax),
  };
}

/** A person's runs of a period, month by month in order, each month read once. */
export function pitOfPeriod(runs: readonly (MonthRun & { month: string })[]): MonthPit {
  const byMonth = new Map<string, MonthRun[]>();
  for (const run of runs) byMonth.set(run.month, [...(byMonth.get(run.month) ?? []), run]);
  return sumMonths([...byMonth.keys()].sort().map((month) => pitOfMonth(byMonth.get(month)!)));
}
