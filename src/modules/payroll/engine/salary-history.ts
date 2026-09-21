// A person's salary history as steps (FR-PAY-04): each structure beside the one before it, so a
// reader sees at a glance what went up, what went down and by how much. Pure, no I/O.
import type { SalaryTerms } from "../enums";

export type SalaryDirection = "up" | "down" | "same";
export type SalaryDelta = { amount: number; /** Basis points of the earlier figure; null when that was 0. */ bp: number | null; direction: SalaryDirection };

export type SalaryStep<T> = {
  structure: T;
  /** Base salary plus every fixed allowance: the monthly pay the terms promise. */
  total: number;
  /** Against the structure before it; null for the first one. */
  base: SalaryDelta | null;
  totalChange: SalaryDelta | null;
};

export const termsTotal = (terms: SalaryTerms): number => terms.baseSalary + terms.allowances.reduce((sum, line) => sum + line.amount, 0);

export function delta(before: number, after: number): SalaryDelta {
  const amount = after - before;
  return { amount, bp: before === 0 ? null : Math.round((amount * 10_000) / before), direction: amount > 0 ? "up" : amount < 0 ? "down" : "same" };
}

/** `structures` in any order; the steps come back newest first, like the rest of the person page. */
export function salarySteps<T extends { validFrom: string; terms: SalaryTerms }>(structures: readonly T[]): SalaryStep<T>[] {
  const oldestFirst = [...structures].sort((a, b) => (a.validFrom < b.validFrom ? -1 : a.validFrom > b.validFrom ? 1 : 0));
  const steps = oldestFirst.map((structure, index): SalaryStep<T> => {
    const previous = index > 0 ? oldestFirst[index - 1] : undefined;
    const total = termsTotal(structure.terms);
    return {
      structure,
      total,
      base: previous ? delta(previous.terms.baseSalary, structure.terms.baseSalary) : null,
      totalChange: previous ? delta(termsTotal(previous.terms), total) : null,
    };
  });
  return steps.reverse();
}
