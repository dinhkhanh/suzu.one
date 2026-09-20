// The variance check (FR-PAY-31): what a human must look at before a run is proposed and signed.
// Pure, no I/O — the same shape as every other engine file, so the rules are testable on their own.
//
// It compares this run with the month before, per person and in total, and names anomalies. It
// never decides anything: a flagged run can still be proposed and approved. The point is that
// nobody signs a payroll without having been shown what changed.
import type { PersonPayResult } from "./types";

/** Why a line is worth looking at. Names only — the amounts live beside them, encrypted. */
export type VarianceFlag =
  // Net moved more than the entity's threshold against last month.
  | "net_change"
  // Paid this month, not last month — and the other way round.
  | "new_person"
  | "removed_person"
  // Pays out nothing, or less than nothing.
  | "negative_net"
  | "zero_net"
  // Cannot be paid by transfer, or declared, as things stand (FR-PAY-31).
  | "missing_bank_account"
  | "missing_tax_code";

/** What the check needs to know about a person besides their two results. */
export type VariancePersonFacts = {
  personId: string;
  hasBankAccount: boolean;
  hasTaxCode: boolean;
  /** Cash-paid people need no bank account; a Simple-profile person may have no tax code. */
  profile: "statutory" | "simple";
  paidInCash: boolean;
};

export type VarianceInput = {
  current: readonly { personId: string; result: Pick<PersonPayResult, "totals" | "warnings" | "profile"> }[];
  previous: readonly { personId: string; result: Pick<PersonPayResult, "totals"> }[];
  facts: readonly VariancePersonFacts[];
  /** FR-PAY-31: a net change beyond this many basis points is an anomaly (policy). */
  thresholdBp: number;
};

export type PersonVariance = {
  personId: string;
  flags: VarianceFlag[];
  net: number;
  previousNet: number | null;
  /** Signed change against last month in basis points; null when there is nothing to compare. */
  changeBp: number | null;
  /** The engine's own warnings (`negative_net`, `no_salary_structure`, …), carried through. */
  warnings: readonly string[];
};

export type VarianceReport = {
  people: PersonVariance[];
  /** Only the people with something to look at, worst first — what the screens show. */
  flagged: PersonVariance[];
  totals: { net: number; previousNet: number; changeBp: number | null; headcount: number; previousHeadcount: number; gross: number; previousGross: number };
  counts: Record<VarianceFlag, number>;
};

const EMPTY_COUNTS = (): Record<VarianceFlag, number> => ({ net_change: 0, new_person: 0, removed_person: 0, negative_net: 0, zero_net: 0, missing_bank_account: 0, missing_tax_code: 0 });

/**
 * Change in basis points, signed. A person who was paid nothing last month and something this
 * month has no percentage — they are flagged as new, not as an infinite rise.
 */
export function changeInBp(net: number, previousNet: number | null): number | null {
  if (previousNet === null || previousNet === 0) return null;
  // Integer arithmetic throughout (DR-01): the ratio is scaled before it is divided.
  return Math.round(((net - previousNet) * 10_000) / previousNet);
}

/** How loud a line is, for sorting: the worst thing about it first, then the size of the change. */
const severity = (person: PersonVariance): number => {
  if (person.flags.includes("negative_net")) return 5;
  if (person.flags.includes("missing_bank_account") || person.flags.includes("missing_tax_code")) return 4;
  if (person.flags.includes("new_person") || person.flags.includes("removed_person")) return 3;
  if (person.flags.includes("zero_net")) return 2;
  return 1;
};

export function compareRuns(input: VarianceInput): VarianceReport {
  const previousByPerson = new Map(input.previous.map((row) => [row.personId, row.result.totals]));
  const factsByPerson = new Map(input.facts.map((row) => [row.personId, row]));
  const counts = EMPTY_COUNTS();
  const people: PersonVariance[] = [];

  for (const { personId, result } of input.current) {
    const previous = previousByPerson.get(personId) ?? null;
    const previousNet = previous?.net ?? null;
    const changeBp = changeInBp(result.totals.net, previousNet);
    const facts = factsByPerson.get(personId);
    const flags: VarianceFlag[] = [];

    if (previous === null) flags.push("new_person");
    else if (changeBp !== null && Math.abs(changeBp) > input.thresholdBp) flags.push("net_change");

    if (result.totals.net < 0) flags.push("negative_net");
    else if (result.totals.net === 0) flags.push("zero_net");

    // A cash-paid person needs no account; everybody the bank has to reach does (FR-PAY-33).
    if (facts && !facts.paidInCash && !facts.hasBankAccount && result.totals.net > 0) flags.push("missing_bank_account");
    // Only tax that is actually withheld has to be declared under a tax code (FR-PAY-35).
    if (facts && !facts.hasTaxCode && result.totals.pit > 0) flags.push("missing_tax_code");

    for (const flag of flags) counts[flag]++;
    people.push({ personId, flags, net: result.totals.net, previousNet, changeBp, warnings: result.warnings });
  }

  // Someone who was paid last month and is not in this run at all: a leaver, or someone forgotten.
  const current = new Set(input.current.map((row) => row.personId));
  for (const row of input.previous) {
    if (current.has(row.personId)) continue;
    counts.removed_person++;
    people.push({ personId: row.personId, flags: ["removed_person"], net: 0, previousNet: row.result.totals.net, changeBp: null, warnings: [] });
  }

  const sum = (rows: readonly { result: { totals: { net: number; grossEarnings: number } } }[], field: "net" | "grossEarnings") => rows.reduce((total, row) => total + row.result.totals[field], 0);
  const net = sum(input.current, "net");
  const previousNet = sum(input.previous, "net");

  const flagged = people
    .filter((person) => person.flags.length > 0 || person.warnings.length > 0)
    .sort((left, right) => severity(right) - severity(left) || Math.abs(right.changeBp ?? 0) - Math.abs(left.changeBp ?? 0));

  return {
    people,
    flagged,
    totals: {
      net,
      previousNet,
      changeBp: changeInBp(net, input.previous.length === 0 ? null : previousNet),
      headcount: input.current.length,
      previousHeadcount: input.previous.length,
      gross: sum(input.current, "grossEarnings"),
      previousGross: sum(input.previous, "grossEarnings"),
    },
    counts,
  };
}
