// PIT family deductions count per registered month (FR-PAY-13). Pure.

/** How many of the dependents are registered for `month` ("2026-08")? `deductionTo` is the last month, inclusive. */
export function countDependentsInMonth(dependents: readonly { deductionFrom: string; deductionTo: string | null }[], month: string): number {
  return dependents.filter((dependent) => dependent.deductionFrom.slice(0, 7) <= month && (dependent.deductionTo === null || dependent.deductionTo.slice(0, 7) >= month)).length;
}
