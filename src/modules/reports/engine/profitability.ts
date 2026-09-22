// Project and client profitability (FR-PJM-63). Pure, integer VND throughout.
//
//   fee    = what the client pays for the period, from the best source there is:
//            invoiced billing items (FR-PJM-56) › the retainer's monthly fee × its months in the
//            period (FR-PJM-06) › the project's fee (FR-PJM-09). Which one was used is said.
//   cost   = Σ over people and months: minutes logged on the project × that person's loaded cost
//            rate for that month (payroll's signed run). A month without a signed run uses the
//            person's latest signed month before it, or failing that the nearest after, and the
//            project is flagged as estimated. Minutes with no rate at all are counted, not costed.
//   margin = fee − cost; margin % = margin ÷ fee.
//
// **Nobody's cost is shown alone.** Rates come in per person because they have to, and they leave
// this file only inside sums: per project, per client, and a breakdown by team or role in which a
// group of fewer than `MIN_GROUP_PEOPLE` people is folded into "other" — so a role held by one
// person does not become that person's pay divided by their hours.

export const MIN_GROUP_PEOPLE = 2;
export const OTHER_GROUP = "__other__";

export type RateRow = { personId: string; month: string; ratePerHourVnd: number };
export type ResolvedRate = { ratePerHourVnd: number; exact: boolean };

/** A person's rate for a month: that month's, else the latest before it, else the nearest after. */
export function resolveRate(rates: readonly RateRow[], personId: string, month: string): ResolvedRate | null {
  const own = rates.filter((row) => row.personId === personId).sort((a, b) => a.month.localeCompare(b.month));
  const exact = own.find((row) => row.month === month);
  if (exact) return { ratePerHourVnd: exact.ratePerHourVnd, exact: true };
  const before = own.filter((row) => row.month < month).at(-1);
  const after = own.find((row) => row.month > month);
  const fallback = before ?? after;
  return fallback ? { ratePerHourVnd: fallback.ratePerHourVnd, exact: false } : null;
}

/** Cost of some minutes at an hourly rate, in whole VND. */
export const costOf = (minutes: number, ratePerHourVnd: number): number => Math.round((minutes * ratePerHourVnd) / 60);

/** "2026-09" … "2026-11" → the months in between, inclusive. */
export function monthsBetween(fromMonth: string, toMonth: string): string[] {
  const months: string[] = [];
  let [year, month] = [Number(fromMonth.slice(0, 4)), Number(fromMonth.slice(5, 7))];
  while (`${year}-${String(month).padStart(2, "0")}` <= toMonth) {
    months.push(`${year}-${String(month).padStart(2, "0")}`);
    month += 1;
    if (month > 12) [year, month] = [year + 1, 1];
  }
  return months;
}

export type FeeFacts = {
  /** The project's fee (FR-PJM-09), whole project. */
  feeVnd: number | null;
  /** The retainer's monthly fee and the months it runs, when the project is a retainer. */
  retainer: { feePerMonthVnd: number | null; startMonth: string; endMonth: string | null } | null;
  /** Billing items marked invoiced with an invoice date in the period. */
  invoicedVnd: number;
};
export type FeeBasis = "invoiced" | "retainer" | "project_fee" | "none";

export function projectFee(facts: FeeFacts, periodMonths: readonly string[]): { feeVnd: number | null; basis: FeeBasis } {
  if (facts.invoicedVnd > 0) return { feeVnd: facts.invoicedVnd, basis: "invoiced" };
  const retainer = facts.retainer;
  if (retainer?.feePerMonthVnd) {
    const months = periodMonths.filter((month) => month >= retainer.startMonth && (retainer.endMonth === null || month <= retainer.endMonth)).length;
    return { feeVnd: retainer.feePerMonthVnd * months, basis: "retainer" };
  }
  if (facts.feeVnd !== null) return { feeVnd: facts.feeVnd, basis: "project_fee" };
  return { feeVnd: null, basis: "none" };
}

/** Minutes one person logged on one project in one month, with the groups the breakdown uses. */
export type TimeLine = { projectId: string; personId: string; month: string; minutes: number; teamKey: string; roleKey: string };

export type Margin = { feeVnd: number | null; costVnd: number; marginVnd: number | null; marginRate: number | null };
const marginOf = (feeVnd: number | null, costVnd: number): Margin => ({ feeVnd, costVnd, marginVnd: feeVnd === null ? null : feeVnd - costVnd, marginRate: feeVnd ? (feeVnd - costVnd) / feeVnd : null });

export type BreakdownRow = { key: string; minutes: number; costVnd: number };
export type ProjectProfit = Margin & { projectId: string; basis: FeeBasis; minutes: number; unratedMinutes: number; estimated: boolean; byTeam: BreakdownRow[]; byRole: BreakdownRow[] };
export type ClientProfit = Margin & { clientId: string | null; projects: number; minutes: number; estimated: boolean };

/** Sums per group; groups of fewer than `MIN_GROUP_PEOPLE` people are folded into "other" until "other" is safe too. */
export function breakdown(lines: readonly { key: string; personId: string; minutes: number; costVnd: number }[]): BreakdownRow[] {
  const groups = new Map<string, { people: Set<string>; minutes: number; costVnd: number }>();
  for (const line of lines) {
    const group = groups.get(line.key) ?? { people: new Set<string>(), minutes: 0, costVnd: 0 };
    group.people.add(line.personId);
    group.minutes += line.minutes;
    group.costVnd += line.costVnd;
    groups.set(line.key, group);
  }
  const other = { people: new Set<string>(), minutes: 0, costVnd: 0 };
  const fold = (key: string) => {
    const group = groups.get(key)!;
    for (const person of group.people) other.people.add(person);
    other.minutes += group.minutes;
    other.costVnd += group.costVnd;
    groups.delete(key);
  };
  for (const [key, group] of [...groups]) if (group.people.size < MIN_GROUP_PEOPLE) fold(key);
  // One person left in "other" is still one person: fold the smallest named group in with them.
  while (other.people.size > 0 && other.people.size < MIN_GROUP_PEOPLE && groups.size > 0) {
    const smallest = [...groups].sort((a, b) => a[1].people.size - b[1].people.size || a[1].minutes - b[1].minutes)[0][0];
    fold(smallest);
  }
  const rows = [...groups].map(([key, group]) => ({ key, minutes: group.minutes, costVnd: group.costVnd })).sort((a, b) => b.costVnd - a.costVnd || a.key.localeCompare(b.key));
  if (other.people.size > 0) rows.push({ key: OTHER_GROUP, minutes: other.minutes, costVnd: other.costVnd });
  return rows;
}

export type ProfitProject = { projectId: string; clientId: string | null; fee: FeeFacts };

export function profitability(input: { projects: readonly ProfitProject[]; time: readonly TimeLine[]; rates: readonly RateRow[]; periodMonths: readonly string[] }): { projects: ProjectProfit[]; clients: ClientProfit[]; total: Margin & { minutes: number; estimated: boolean } } {
  const timeOf = Map.groupBy(input.time, (line) => line.projectId);
  const projects = input.projects.map((project): ProjectProfit => {
    const costed = (timeOf.get(project.projectId) ?? []).map((line) => {
      const resolved = resolveRate(input.rates, line.personId, line.month);
      return { ...line, costVnd: resolved ? costOf(line.minutes, resolved.ratePerHourVnd) : 0, rated: !!resolved, exact: resolved?.exact ?? true };
    });
    const fee = projectFee(project.fee, input.periodMonths);
    const costVnd = costed.reduce((total, line) => total + line.costVnd, 0);
    const rated = costed.filter((line) => line.rated);
    return {
      projectId: project.projectId,
      basis: fee.basis,
      ...marginOf(fee.feeVnd, costVnd),
      minutes: costed.reduce((total, line) => total + line.minutes, 0),
      unratedMinutes: costed.filter((line) => !line.rated).reduce((total, line) => total + line.minutes, 0),
      estimated: costed.some((line) => !line.rated || !line.exact),
      byTeam: breakdown(rated.map((line) => ({ key: line.teamKey, personId: line.personId, minutes: line.minutes, costVnd: line.costVnd }))),
      byRole: breakdown(rated.map((line) => ({ key: line.roleKey, personId: line.personId, minutes: line.minutes, costVnd: line.costVnd }))),
    };
  });

  const clientOf = new Map(input.projects.map((project) => [project.projectId, project.clientId]));
  const clients = [...Map.groupBy(projects, (project) => clientOf.get(project.projectId) ?? null)].map(([clientId, rows]): ClientProfit => {
    const fees = rows.filter((row) => row.feeVnd !== null);
    return { clientId, projects: rows.length, minutes: rows.reduce((total, row) => total + row.minutes, 0), estimated: rows.some((row) => row.estimated), ...marginOf(fees.length ? fees.reduce((total, row) => total + (row.feeVnd ?? 0), 0) : null, rows.reduce((total, row) => total + row.costVnd, 0)) };
  });

  const fees = projects.filter((row) => row.feeVnd !== null);
  return {
    projects,
    clients: clients.sort((a, b) => (b.marginVnd ?? -Infinity) - (a.marginVnd ?? -Infinity)),
    total: { minutes: projects.reduce((total, row) => total + row.minutes, 0), estimated: projects.some((row) => row.estimated), ...marginOf(fees.length ? fees.reduce((total, row) => total + (row.feeVnd ?? 0), 0) : null, projects.reduce((total, row) => total + row.costVnd, 0)) },
  };
}
