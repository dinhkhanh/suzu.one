// Net → gross for offers (FR-PAY-03). Pure.
//
// Contracts are gross-based (SRS D12), so payroll never calculates from a net figure. What HR
// needs is a different thing: a candidate negotiates "35 triệu net" and HR must know what gross to
// write into the offer. This turns one into the other.
//
// It does **not** re-implement the payroll rules. It builds a full, ordinary month for the person
// and calls `calculatePerson` — the same engine, the same statutory snapshot, the same catalogue —
// and searches for the gross whose net is the one asked for. So the converter can never drift away
// from payroll: if the brackets change, both change together.
//
// The search is a binary search over whole đồng. Net rises with gross but not by one đồng at a
// time (rounding makes small plateaus and the brackets make steps), so a net figure may have no
// exact gross at all — the result says so and gives the closest gross on each side rather than
// pretending. `netOf(grossOf(net))` returns the net asked for whenever `exact` is true.
import type { ComponentDefinition } from "./components";
import { calculatePerson } from "./calculate";
import { BASE_CODE } from "./earnings";
import { payPeriodOf, type ProfileFacts } from "./period";
import type { PayrollPolicyValue } from "../enums";
import type { PersonPayInput, PersonPayResult, StatutoryParams } from "./types";

/** The offer being priced: one ordinary full month, no overtime, no absence. */
export type OfferTerms = {
  /** The month the offer is priced in — decides which statutory values apply. */
  month: string;
  /** Working days the month asks of a full-time person: the divisor. */
  monthStandardDays: number;
  wageRegion: 1 | 2 | 3 | 4;
  dependents: number;
  profile: ProfileFacts;
  /**
   * The contribution base declared for insurance. `follow_gross` declares the whole base salary
   * (the honest default); `fixed` declares a figure of its own, which is what many companies do.
   */
  insuranceSalary: { mode: "follow_gross" } | { mode: "fixed"; amount: number };
  /** Allowances the offer includes beside the base salary, in đồng per month. */
  allowances: { code: string; amount: number }[];
  policy: PayrollPolicyValue;
  statutory: StatutoryParams;
  components: ComponentDefinition[];
};

export type ConversionResult = {
  /** The gross base salary the offer should say. */
  gross: number;
  /** What that gross actually nets — equal to the target when `exact`. */
  net: number;
  exact: boolean;
  /** When no gross nets exactly the target: the nearest below and above, so HR can choose. */
  nearest?: { below: { gross: number; net: number } | null; above: { gross: number; net: number } | null };
  /** The full payslip of the answer, so the offer letter can show the breakdown. */
  result: PersonPayResult;
};

/** The largest base salary the search will consider — a guard, not a rule. */
const MAX_GROSS = 10_000_000_000;

/** The full month this person would be paid for, at a given base salary. */
export function offerInput(terms: OfferTerms, baseSalary: number): PersonPayInput {
  const period = payPeriodOf(terms.month, terms.monthStandardDays);
  const insuranceSalary = terms.insuranceSalary.mode === "fixed" ? terms.insuranceSalary.amount : baseSalary;
  const paidDaysCenti = terms.monthStandardDays * 100;
  return {
    personId: "offer",
    entityId: "offer",
    period,
    wageRegion: terms.wageRegion,
    employment: { startDate: null, endDate: null, dependents: terms.dependents, serviceMonths: 0, kpiScoreBp: 0 },
    profile: terms.profile,
    segments: [{ from: period.start, to: period.end, terms: { baseSalary, insuranceSalary, allowances: terms.allowances }, standardDays: terms.monthStandardDays, paidDaysCenti, unpaidDaysCenti: 0 }],
    timesheet: { standardDays: terms.monthStandardDays, standardMinutes: terms.monthStandardDays * terms.policy.hoursPerDay * 60, paidDaysCenti, unpaidDaysCenti: 0, workedMinutes: terms.monthStandardDays * terms.policy.hoursPerDay * 60, nightMinutes: 0, overtime: { weekday: { day: 0, night: 0 }, restDay: { day: 0, night: 0 }, holiday: { day: 0, night: 0 } } },
    insuranceLeaveDays: 0,
    unpaidWorkingDays: 0,
    components: terms.components,
    inputs: [],
    retro: [],
    otherPitDeductions: 0,
    priorInMonth: null,
    runKind: "regular",
    policy: terms.policy,
    statutory: terms.statutory,
  };
}

/** What a gross base salary nets, under the ordinary full month of `terms`. */
export function netOf(terms: OfferTerms, baseSalary: number): { net: number; result: PersonPayResult } {
  const result = calculatePerson(offerInput(terms, baseSalary));
  return { net: result.totals.net, result };
}

/**
 * The gross base salary that nets `targetNet`.
 *
 * Binary search for the smallest gross whose net reaches the target: net never falls as gross
 * rises, so the smallest such gross is the offer to make. When its net overshoots, no gross nets
 * the target exactly and `exact` is false — the last gross below is given as well.
 */
export function grossForNet(terms: OfferTerms, targetNet: number): ConversionResult {
  if (!Number.isSafeInteger(targetNet) || targetNet < 0) throw new RangeError("target net must be a whole number of đồng, not negative");

  const allowanceTotal = terms.allowances.reduce((sum, allowance) => sum + allowance.amount, 0);
  const atZero = netOf(terms, 0);
  if (atZero.net >= targetNet) {
    // The allowances alone already net the target: the base salary cannot go below zero.
    return { gross: 0, net: atZero.net, exact: atZero.net === targetNet, ...(atZero.net === targetNet ? {} : { nearest: { below: null, above: { gross: 0, net: atZero.net } } }), result: atZero.result };
  }

  // An upper bound: net is at most gross, so the answer is never past target + what tax and
  // insurance could take. Doubling from the target is cheap and always terminates.
  let high = Math.max(1, targetNet - allowanceTotal);
  let highNet = netOf(terms, high).net;
  while (highNet < targetNet && high < MAX_GROSS) {
    high = Math.min(MAX_GROSS, high * 2);
    highNet = netOf(terms, high).net;
  }
  if (highNet < targetNet) throw new RangeError("no gross in range nets that much");

  let low = 0;
  // Invariant: net(low) < target ≤ net(high). Narrow until they touch.
  while (high - low > 1) {
    const middle = low + Math.floor((high - low) / 2);
    if (netOf(terms, middle).net >= targetNet) high = middle;
    else low = middle;
  }

  const answer = netOf(terms, high);
  if (answer.net === targetNet) return { gross: high, net: answer.net, exact: true, result: answer.result };
  const below = netOf(terms, low);
  return {
    gross: high,
    net: answer.net,
    exact: false,
    nearest: { below: { gross: low, net: below.net }, above: { gross: high, net: answer.net } },
    result: answer.result,
  };
}

/** The base salary component must exist in the catalogue or an offer has nothing to price. */
export const offerNeedsBaseComponent = (components: readonly ComponentDefinition[]): boolean => !components.some((component) => component.code === BASE_CODE && component.source === "structure");
