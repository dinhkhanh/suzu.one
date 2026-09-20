// Properties the payroll engine must hold for *every* input, not just the cases someone thought
// of (development plan, Phase 5 week 3). Where a golden case says "this month comes to this
// figure", these say "whatever the month, this can never happen".
//
// The generators are deliberately bounded — salaries up to ten billion đồng, a month of 28–31
// days — so the suite stays fast and the arithmetic stays inside safe integers.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { DEFAULT_PAYROLL_POLICY, type PayrollPolicyValue } from "../enums";
import { calculatePerson } from "./calculate";
import { seededComponents, seededStatutory } from "./golden/fixtures";
import { grossForNet, netOf, type OfferTerms } from "./net-to-gross";
import { payPeriodOf, type ProfileFacts } from "./period";
import { progressiveTax } from "./pit";
import type { PersonPayInput } from "./types";

const STATUTORY = seededStatutory("2026-08-31");
const COMPONENTS = seededComponents();
const RUNS = { numRuns: 60 } as const;

const vnd = (max: number) => fc.integer({ min: 0, max });
const minutes = fc.integer({ min: 0, max: 40 * 60 });

// Weighted towards the ordinary case, or the generator would spend its runs on exotic months and
// almost never exercise the path most people are actually paid through: an insured resident on a
// labour contract, present all month. (A probe of 300 unweighted draws contributed insurance 7
// times.) The unusual cases still come up often enough to be tested.
const profileArbitrary: fc.Arbitrary<ProfileFacts> = fc.record({
  profile: fc.oneof({ weight: 3, arbitrary: fc.constant("statutory" as const) }, { weight: 1, arbitrary: fc.constant("simple" as const) }),
  taxResidency: fc.oneof({ weight: 5, arbitrary: fc.constant("resident" as const) }, { weight: 1, arbitrary: fc.constant("non_resident" as const) }),
  pitMethod: fc.oneof({ weight: 4, arbitrary: fc.constant("progressive" as const) }, { weight: 1, arbitrary: fc.constant("flat_without_contract" as const) }, { weight: 1, arbitrary: fc.constant("flat_non_resident" as const) }),
  pitCommitment: fc.oneof({ weight: 4, arbitrary: fc.constant(false) }, { weight: 1, arbitrary: fc.constant(true) }),
  insuranceExemption: fc.oneof(
    { weight: 6, arbitrary: fc.constant(null) },
    { weight: 1, arbitrary: fc.constantFrom("probation" as const, "retiree" as const, "insured_elsewhere" as const, "foreigner" as const, "other" as const) },
  ),
  unionMember: fc.boolean(),
});

const policyArbitrary: fc.Arbitrary<PayrollPolicyValue> = fc.record({
  prorationBasis: fc.constantFrom("working_days" as const, "calendar_days" as const, "fixed_days" as const),
  hoursPerDay: fc.integer({ min: 6, max: 10 }),
  overtimeBase: fc.constantFrom("base_salary" as const, "base_plus_insurable_allowances" as const),
  unionEnabled: fc.boolean(),
  simplePitTreatment: fc.constantFrom("none" as const, "flat_withholding" as const),
}).map((partial) => ({ ...DEFAULT_PAYROLL_POLICY, ...partial, fixedDays: partial.prorationBasis === "fixed_days" ? 26 : null }));

/** A month someone could really have: bounded, but free in every way that matters. */
const inputArbitrary: fc.Arbitrary<PersonPayInput> = fc
  .record({
    monthStandardDays: fc.integer({ min: 18, max: 27 }),
    // Everyday salaries, with the occasional very large one to reach the caps and the top bracket.
    baseSalary: fc.oneof({ weight: 4, arbitrary: fc.integer({ min: 5_000_000, max: 200_000_000 }) }, { weight: 1, arbitrary: vnd(10_000_000_000) }),
    insuranceSalary: fc.oneof({ weight: 4, arbitrary: fc.integer({ min: 5_000_000, max: 80_000_000 }) }, { weight: 1, arbitrary: vnd(200_000_000) }),
    meal: vnd(3_000_000),
    // Mostly a full or nearly full month; sometimes a heavily absent one.
    paidShareBp: fc.oneof({ weight: 4, arbitrary: fc.integer({ min: 9_000, max: 10_000 }) }, { weight: 1, arbitrary: fc.integer({ min: 0, max: 9_000 }) }),
    dependents: fc.integer({ min: 0, max: 6 }),
    nightMinutes: minutes,
    otWeekday: minutes,
    otRestDayNight: minutes,
    otHoliday: minutes,
    insuranceLeaveDays: fc.oneof({ weight: 5, arbitrary: fc.constant(0) }, { weight: 1, arbitrary: fc.integer({ min: 1, max: 20 }) }),
    bonus: fc.oneof({ weight: 3, arbitrary: fc.constant(0) }, { weight: 2, arbitrary: vnd(500_000_000) }),
    advance: fc.oneof({ weight: 3, arbitrary: fc.constant(0) }, { weight: 2, arbitrary: vnd(50_000_000) }),
    retro: fc.oneof({ weight: 3, arbitrary: fc.constant(0) }, { weight: 2, arbitrary: fc.integer({ min: -50_000_000, max: 50_000_000 }) }),
    profile: profileArbitrary,
    policy: policyArbitrary,
    wageRegion: fc.constantFrom(1 as const, 2 as const, 3 as const, 4 as const),
    runKind: fc.oneof({ weight: 5, arbitrary: fc.constant("regular" as const) }, { weight: 1, arbitrary: fc.constant("off_cycle" as const) }),
  })
  .map((draft): PersonPayInput => {
    const period = payPeriodOf("2026-08", draft.monthStandardDays);
    const paidDaysCenti = Math.round((draft.monthStandardDays * 100 * draft.paidShareBp) / 10_000);
    const unpaidDaysCenti = draft.monthStandardDays * 100 - paidDaysCenti;
    return {
      personId: "property",
      entityId: "e",
      period,
      wageRegion: draft.wageRegion,
      employment: { startDate: null, endDate: null, dependents: draft.dependents, serviceMonths: 24, kpiScoreBp: 0 },
      profile: draft.profile,
      segments: [{ from: period.start, to: period.end, standardDays: draft.monthStandardDays, paidDaysCenti, unpaidDaysCenti, terms: { baseSalary: draft.baseSalary, insuranceSalary: draft.insuranceSalary, allowances: [{ code: "ALW_MEAL", amount: draft.meal }] } }],
      timesheet: {
        standardDays: draft.monthStandardDays,
        standardMinutes: draft.monthStandardDays * draft.policy.hoursPerDay * 60,
        paidDaysCenti,
        unpaidDaysCenti,
        workedMinutes: draft.monthStandardDays * draft.policy.hoursPerDay * 60,
        nightMinutes: draft.nightMinutes,
        overtime: { weekday: { day: draft.otWeekday, night: 0 }, restDay: { day: 0, night: draft.otRestDayNight }, holiday: { day: draft.otHoliday, night: 0 } },
      },
      insuranceLeaveDays: draft.insuranceLeaveDays,
      unpaidWorkingDays: Math.round(unpaidDaysCenti / 100),
      components: COMPONENTS,
      inputs: [
        { code: "BONUS", amount: draft.bonus },
        { code: "ADVANCE", amount: draft.advance },
      ],
      retro: draft.retro === 0 ? [] : [{ sourceMonth: "2026-07", amount: draft.retro, kind: "manual" }],
      otherPitDeductions: 0,
      priorInMonth: null,
      runKind: draft.runKind,
      policy: draft.policy,
      statutory: STATUTORY,
    };
  });

describe("whatever the month", () => {
  it("every line is a whole number of đồng and never negative", () => {
    fc.assert(
      fc.property(inputArbitrary, (input) => {
        for (const line of calculatePerson(input).lines) {
          expect(Number.isSafeInteger(line.amount)).toBe(true);
          expect(line.amount).toBeGreaterThanOrEqual(0);
          expect(line.taxable).toBeLessThanOrEqual(line.amount);
          expect(line.insurable).toBeLessThanOrEqual(line.amount);
        }
      }),
      RUNS,
    );
  });

  it("the lines add up to the totals", () => {
    fc.assert(
      fc.property(inputArbitrary, (input) => {
        const result = calculatePerson(input);
        const sum = (kind: string) => result.lines.filter((line) => line.kind === kind).reduce((total, line) => total + line.amount, 0);
        expect(sum("earning")).toBe(result.totals.grossEarnings);
        expect(sum("deduction")).toBe(result.totals.totalDeductions);
        expect(result.totals.grossEarnings - result.totals.totalDeductions).toBe(result.totals.net);
        expect(result.totals.employerCost).toBe(result.totals.grossEarnings + result.totals.employerInsurance + result.totals.unionFund);
      }),
      RUNS,
    );
  });

  it("net never exceeds gross", () => {
    fc.assert(
      fc.property(inputArbitrary, (input) => {
        const { totals } = calculatePerson(input);
        expect(totals.net).toBeLessThanOrEqual(totals.grossEarnings);
      }),
      RUNS,
    );
  });

  it("a negative net is always explained by a real deduction, and always flagged", () => {
    fc.assert(
      fc.property(inputArbitrary, (input) => {
        const result = calculatePerson(input);
        if (result.totals.net >= 0) return;
        // Money is never invented: something must have been deducted. This rules out a negative
        // net arising from a negative earning line or a rounding slip.
        const { employeeInsurance, unionDues, pit, otherDeductions } = result.totals;
        expect(employeeInsurance + unionDues + pit + otherDeductions).toBeGreaterThan(0);
        // And a person who ends the month owing the company is never quietly paid out.
        expect(result.warnings).toContain("negative_net");
      }),
      RUNS,
    );
  });

  it("insurance never passes its caps, and is charged on the declared base or not at all", () => {
    fc.assert(
      fc.property(inputArbitrary, (input) => {
        const result = calculatePerson(input);
        const caps = input.statutory.insuranceCapMultipliers;
        const socialCap = input.statutory.referenceLevel.amount * caps.bhxhBhyt;
        const unemploymentCap = input.statutory.regionalMinimumWage[`region${input.wageRegion}` as const] * caps.bhtn;
        expect(result.insurance.bhxhBhytBase).toBeLessThanOrEqual(socialCap);
        expect(result.insurance.bhtnBase).toBeLessThanOrEqual(unemploymentCap);
        if (!result.insurance.covered) {
          expect(result.totals.employeeInsurance).toBe(0);
          expect(result.totals.employerInsurance).toBe(0);
          expect(result.insurance.reason).not.toBeNull();
        }
      }),
      RUNS,
    );
  });

  it("tax never exceeds the income it is charged on", () => {
    fc.assert(
      fc.property(inputArbitrary, (input) => {
        const result = calculatePerson(input);
        expect(result.totals.pit).toBeLessThanOrEqual(result.totals.taxableIncome);
        expect(result.totals.pit).toBeGreaterThanOrEqual(0);
      }),
      RUNS,
    );
  });

  it("is reproducible: the same input always gives the same result (FR-PAY-20)", () => {
    fc.assert(
      fc.property(inputArbitrary, (input) => {
        expect(JSON.stringify(calculatePerson(input))).toBe(JSON.stringify(calculatePerson(structuredClone(input))));
      }),
      RUNS,
    );
  });

  it("an off-cycle run pays only what is typed into it", () => {
    fc.assert(
      fc.property(inputArbitrary, (input) => {
        const result = calculatePerson({ ...input, runKind: "off_cycle" });
        expect(result.lines.some((line) => line.code === "BASE" || line.code === "ALW_MEAL")).toBe(false);
        expect(result.insurance.covered).toBe(false);
      }),
      RUNS,
    );
  });
});

describe("progressive tax", () => {
  const brackets = STATUTORY.pitBrackets;

  it("never falls as income rises, and never takes more than the income", () => {
    fc.assert(
      fc.property(vnd(5_000_000_000), fc.integer({ min: 0, max: 500_000_000 }), (income, step) => {
        const lower = progressiveTax(income, brackets).tax;
        const higher = progressiveTax(income + step, brackets).tax;
        expect(higher).toBeGreaterThanOrEqual(lower);
        expect(lower).toBeLessThanOrEqual(income);
      }),
      RUNS,
    );
  });

  it("never takes more of one more đồng than the top rate", () => {
    fc.assert(
      fc.property(vnd(5_000_000_000), (income) => {
        // The marginal tax on a single đồng cannot exceed the highest bracket's rate.
        const extra = progressiveTax(income + 1, brackets).tax - progressiveTax(income, brackets).tax;
        expect(extra).toBeLessThanOrEqual(1);
        expect(extra).toBeGreaterThanOrEqual(0);
      }),
      RUNS,
    );
  });

  it("adds its slices up to the total", () => {
    fc.assert(
      fc.property(vnd(5_000_000_000), (income) => {
        const { tax, slices } = progressiveTax(income, brackets);
        expect(slices.reduce((sum, slice) => sum + slice.tax, 0)).toBe(tax);
        expect(slices.reduce((sum, slice) => sum + slice.amount, 0)).toBe(Math.min(income, slices.reduce((ceiling, slice) => Math.max(ceiling, slice.upTo ?? income), 0)));
      }),
      RUNS,
    );
  });
});

describe("the net → gross converter", () => {
  const offer = (dependents: number, profile: ProfileFacts): OfferTerms => ({
    month: "2026-08",
    monthStandardDays: 22,
    wageRegion: 1,
    dependents,
    profile,
    insuranceSalary: { mode: "follow_gross" },
    allowances: [],
    policy: DEFAULT_PAYROLL_POLICY,
    statutory: STATUTORY,
    components: COMPONENTS,
  });

  const resident: ProfileFacts = { profile: "statutory", taxResidency: "resident", pitMethod: "progressive", pitCommitment: false, insuranceExemption: null, unionMember: false };

  it("round-trips: an exact answer nets exactly what was asked for", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1_000_000, max: 500_000_000 }), fc.integer({ min: 0, max: 4 }), (target, dependents) => {
        const terms = offer(dependents, resident);
        const answer = grossForNet(terms, target);
        if (answer.exact) expect(netOf(terms, answer.gross).net).toBe(target);
        else expect(answer.net).toBeGreaterThan(target);
      }),
      { numRuns: 20 },
    );
  });

  it("gives the smallest gross that reaches the target", () => {
    fc.assert(
      fc.property(fc.integer({ min: 5_000_000, max: 200_000_000 }), (target) => {
        const terms = offer(0, resident);
        const answer = grossForNet(terms, target);
        if (answer.gross > 0) expect(netOf(terms, answer.gross - 1).net).toBeLessThan(target);
      }),
      { numRuns: 20 },
    );
  });

  it("never asks for a gross below the net", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1_000_000, max: 300_000_000 }), (target) => {
        expect(grossForNet(offer(0, resident), target).gross).toBeGreaterThanOrEqual(target);
      }),
      { numRuns: 20 },
    );
  });
});

