// Reading the encrypted parts of a stored run. Its own file so that `runs.ts` (which carries a
// run forward) and `retro.ts` (which reads back what a month was paid on) can both use it without
// importing each other.
import "server-only";
import { eq } from "drizzle-orm";
import { cache } from "react";
import { fieldCipher } from "@/lib/crypto";
import { db, schema, type Tx } from "@/lib/db";
import type { PersonPayInput, PersonPayResult } from "./engine/types";
import { runInputContext, runResultContext, runTotalsContext } from "./field-contexts";

export type PayrollRunRow = typeof schema.payrollRun.$inferSelect;
export type PayrollRunPersonRow = typeof schema.payrollRunPerson.$inferSelect;

/** A run's own totals: the sum of its people, kept encrypted beside the run. */
export type RunTotals = {
  headcount: number;
  grossEarnings: number;
  employeeInsurance: number;
  employerInsurance: number;
  unionDues: number;
  unionFund: number;
  pit: number;
  totalDeductions: number;
  net: number;
  employerCost: number;
  /** Cash and bank are reported apart (FR-PAY-39); the split by profile is the first cut of it. */
  netStatutory: number;
  netSimple: number;
};

export const EMPTY_TOTALS: RunTotals = { headcount: 0, grossEarnings: 0, employeeInsurance: 0, employerInsurance: 0, unionDues: 0, unionFund: 0, pit: 0, totalDeductions: 0, net: 0, employerCost: 0, netStatutory: 0, netSimple: 0 };

export const openTotals = (run: PayrollRunRow): RunTotals => (run.totalsEnc ? (JSON.parse(fieldCipher().decrypt(run.totalsEnc, runTotalsContext(run.id))) as RunTotals) : EMPTY_TOTALS);

/** One person's calculated payslip. */
export const openResult = (row: PayrollRunPersonRow): PersonPayResult => JSON.parse(fieldCipher().decrypt(row.resultEnc, runResultContext(row.id))) as PersonPayResult;

/** The input that payslip was calculated from — what a retro difference is derived against (FR-PAY-17). */
export const openInput = (row: PayrollRunPersonRow): PersonPayInput => JSON.parse(fieldCipher().decrypt(row.inputEnc, runInputContext(row.id))) as PersonPayInput;

export type OpenedRunPerson = { row: PayrollRunPersonRow; result: PersonPayResult };

/**
 * A run's people with their results opened. Outside a transaction the answer is remembered for the
 * request (React `cache`): the run screen's register, variance check and payslip list all read the
 * same rows, and each is read and decrypted once. Inside one, pass it — the rows come from there.
 */
export function loadRunPeople(runId: string, executor?: Tx | ReturnType<typeof db>): Promise<OpenedRunPerson[]> {
  return executor ? readRunPeople(runId, executor) : runPeopleOnce(runId);
}
const readRunPeople = async (runId: string, executor: Tx | ReturnType<typeof db>): Promise<OpenedRunPerson[]> =>
  (await executor.select().from(schema.payrollRunPerson).where(eq(schema.payrollRunPerson.runId, runId))).map((row) => ({ row, result: openResult(row) }));
const runPeopleOnce = cache((runId: string) => readRunPeople(runId, db()));

export function sumTotals(people: readonly { result: PersonPayResult }[]): RunTotals {
  return people.reduce<RunTotals>((totals, { result }) => {
    const t = result.totals;
    return {
      headcount: totals.headcount + 1,
      grossEarnings: totals.grossEarnings + t.grossEarnings,
      employeeInsurance: totals.employeeInsurance + t.employeeInsurance,
      employerInsurance: totals.employerInsurance + t.employerInsurance,
      unionDues: totals.unionDues + t.unionDues,
      unionFund: totals.unionFund + t.unionFund,
      pit: totals.pit + t.pit,
      totalDeductions: totals.totalDeductions + t.totalDeductions,
      net: totals.net + t.net,
      employerCost: totals.employerCost + t.employerCost,
      netStatutory: totals.netStatutory + (result.profile === "statutory" ? t.net : 0),
      netSimple: totals.netSimple + (result.profile === "simple" ? t.net : 0),
    };
  }, EMPTY_TOTALS);
}
