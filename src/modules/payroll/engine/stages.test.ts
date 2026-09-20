// Each stage of the payroll engine on its own: the boundaries the golden cases cannot all carry,
// and the rules a reader would want to see stated (FR-PAY-11..16).
import { describe, expect, it } from "vitest";
import { DEFAULT_PAYROLL_POLICY } from "../enums";
import { calculatePerson } from "./calculate";
import { taxablePart } from "./components";
import { calculateInsurance, calculateUnion } from "./insurance";
import { seededComponents, seededStatutory } from "./golden/fixtures";
import { hourlyRate } from "./overtime";
import { daysBetween, payableOvertime, payPeriodOf } from "./period";
import { overtimeExemption, pitMethodFor, progressiveTax } from "./pit";
import { divisorDays, employedDaysIn, segmentShare, uncoveredWorkingDays } from "./proration";
import type { PersonPayInput } from "./types";

const STATUTORY = seededStatutory("2026-08-31");
const COMPONENTS = seededComponents();

/** A full-month statutory person on 30,000,000; each test changes just what it is about. */
function personInput(overrides: Partial<PersonPayInput> = {}): PersonPayInput {
  return {
    personId: "p",
    entityId: "e",
    period: payPeriodOf("2026-08", 22),
    wageRegion: 1,
    employment: { startDate: null, endDate: null, dependents: 0, serviceMonths: 12, kpiScoreBp: 0 },
    profile: { profile: "statutory", taxResidency: "resident", pitMethod: "progressive", pitCommitment: false, insuranceExemption: null, unionMember: false },
    segments: [{ from: "2026-08-01", to: "2026-08-31", standardDays: 22, paidDaysCenti: 2200, unpaidDaysCenti: 0, terms: { baseSalary: 30_000_000, insuranceSalary: 30_000_000, allowances: [] } }],
    timesheet: { standardDays: 22, standardMinutes: 10_560, paidDaysCenti: 2200, unpaidDaysCenti: 0, workedMinutes: 10_560, nightMinutes: 0, overtime: { weekday: { day: 0, night: 0 }, restDay: { day: 0, night: 0 }, holiday: { day: 0, night: 0 } } },
    insuranceLeaveDays: 0,
    unpaidWorkingDays: 0,
    components: COMPONENTS,
    inputs: [],
    retro: [],
    priorInMonth: null,
    runKind: "regular",
    otherPitDeductions: 0,
    policy: DEFAULT_PAYROLL_POLICY,
    statutory: STATUTORY,
    ...overrides,
  };
}

describe("the period", () => {
  it("knows how long each month is", () => {
    expect(payPeriodOf("2026-08", 22)).toMatchObject({ start: "2026-08-01", end: "2026-08-31", calendarDays: 31, standardDays: 22 });
    expect(payPeriodOf("2027-02", 20).end).toBe("2027-02-28");
    expect(payPeriodOf("2028-02", 20).end).toBe("2028-02-29");
  });

  it("refuses something that is not a month", () => {
    expect(() => payPeriodOf("2026-13", 22)).toThrow();
    expect(() => payPeriodOf("August", 22)).toThrow();
  });

  it("counts days inclusively", () => {
    expect(daysBetween("2026-08-01", "2026-08-31")).toBe(31);
    expect(daysBetween("2026-08-17", "2026-08-17")).toBe(1);
  });
});

describe("overtime taken as time off in lieu", () => {
  const overtime = { weekday: { day: 600, night: 0 }, restDay: { day: 300, night: 0 }, holiday: { day: 100, night: 0 } };

  it("leaves the minutes alone when none were taken as time off", () => {
    expect(payableOvertime(overtime, 0)).toEqual(overtime);
  });

  it("takes them off each category in proportion, to the exact total", () => {
    const left = payableOvertime(overtime, 500);
    const total = left.weekday.day + left.restDay.day + left.holiday.day;
    expect(total).toBe(1000 - 500);
    expect(left).toEqual({ weekday: { day: 300, night: 0 }, restDay: { day: 150, night: 0 }, holiday: { day: 50, night: 0 } });
  });

  it("spends the remainder on the largest share first, never losing or inventing a minute", () => {
    const left = payableOvertime({ weekday: { day: 100, night: 0 }, restDay: { day: 100, night: 0 }, holiday: { day: 100, night: 0 } }, 100);
    expect(left.weekday.day + left.restDay.day + left.holiday.day).toBe(200);
  });

  it("never pays overtime twice when more was taken off than exists", () => {
    const left = payableOvertime(overtime, 5000);
    expect(left).toEqual({ weekday: { day: 0, night: 0 }, restDay: { day: 0, night: 0 }, holiday: { day: 0, night: 0 } });
  });
});

describe("pro-rating (FR-PAY-16)", () => {
  const period = payPeriodOf("2026-08", 22);

  it("divides by what the policy names", () => {
    expect(divisorDays("working_days", DEFAULT_PAYROLL_POLICY, period)).toBe(22);
    expect(divisorDays("calendar_days", DEFAULT_PAYROLL_POLICY, period)).toBe(31);
    expect(divisorDays("fixed_days", { ...DEFAULT_PAYROLL_POLICY, fixedDays: 26 }, period)).toBe(26);
  });

  it("falls back to the calendar rather than dividing by zero", () => {
    expect(divisorDays("working_days", DEFAULT_PAYROLL_POLICY, payPeriodOf("2026-08", 0))).toBe(31);
    expect(divisorDays("fixed_days", DEFAULT_PAYROLL_POLICY, period)).toBe(31);
  });

  it("counts the days someone was actually employed", () => {
    expect(employedDaysIn(period, null, null)).toBe(31);
    expect(employedDaysIn(period, "2026-08-17", null)).toBe(15);
    expect(employedDaysIn(period, null, "2026-08-07")).toBe(7);
    // Employment entirely outside the month.
    expect(employedDaysIn(period, "2026-09-01", null)).toBe(0);
  });

  it("cuts attendance components by paid days and fixed ones by the segment's share", () => {
    const segment = { from: "2026-08-01", to: "2026-08-16", standardDays: 12, paidDaysCenti: 1200, unpaidDaysCenti: 0, terms: { baseSalary: 0, insuranceSalary: 0, allowances: [] } };
    expect(segmentShare(segment, "attendance", 22, 31)).toEqual({ numerator: 1200, denominator: 2200, rule: "attendance_prorated" });
    expect(segmentShare(segment, "fixed", 22, 31)).toEqual({ numerator: 16, denominator: 31, rule: "fixed_segment_share" });
    // One segment covering the whole employment is not cut at all.
    expect(segmentShare({ ...segment, to: "2026-08-31" }, "fixed", 22, 31)).toEqual({ numerator: 1, denominator: 1, rule: "fixed_full" });
  });

  it("counts uncovered working days the same way for a joiner, a leaver and unpaid leave", () => {
    expect(uncoveredWorkingDays(22, 2200, 0)).toBe(0);
    expect(uncoveredWorkingDays(22, 1100, 0)).toBe(11);
    expect(uncoveredWorkingDays(22, 800, 0)).toBe(14);
    // Days the insurance fund pays (maternity, long sick) are uncovered even though they are paid.
    expect(uncoveredWorkingDays(22, 1200, 10)).toBe(10);
  });
});

describe("insurance (FR-PAY-11)", () => {
  const run = (input: PersonPayInput, declared: number, uncovered: number) => calculateInsurance(input, declared, uncovered);

  it("is all or nothing for the month, never pro-rated", () => {
    const full = run(personInput(), 30_000_000, 0).result;
    const joiner = run(personInput(), 30_000_000, 11).result;
    expect(joiner.employee).toEqual(full.employee);
  });

  it("stops at the threshold of uncovered days, and one day before it does not", () => {
    expect(run(personInput(), 30_000_000, 13).result.covered).toBe(true);
    const over = run(personInput(), 30_000_000, 14).result;
    expect(over).toMatchObject({ covered: false, reason: "unpaid_leave_threshold" });
    expect(over.employee).toEqual({ bhxh: 0, bhyt: 0, bhtn: 0 });
  });

  it("caps social and health at the reference level but unemployment at the regional minimum", () => {
    const result = run(personInput(), 200_000_000, 0).result;
    expect(result.bhxhBhytBase).toBe(50_600_000); // 20 × 2,530,000
    expect(result.bhtnBase).toBe(106_200_000); // 20 × 5,310,000 (region I)
  });

  it("uses the entity's own region for the unemployment cap", () => {
    expect(run(personInput({ wageRegion: 4 }), 200_000_000, 0).result.bhtnBase).toBe(74_000_000); // 20 × 3,700,000
  });

  it.each([
    ["probation", "probation"],
    ["retiree", "retiree"],
    ["insured_elsewhere", "insured_elsewhere"],
    ["other", "other_exemption"],
  ] as const)("%s contributes to nothing", (exemption, reason) => {
    const result = run(personInput({ profile: { ...personInput().profile, insuranceExemption: exemption } }), 30_000_000, 0).result;
    expect(result).toMatchObject({ covered: false, reason });
  });

  it("lets a foreigner pay social and health insurance but not unemployment insurance", () => {
    const result = run(personInput({ profile: { ...personInput().profile, insuranceExemption: "foreigner" } }), 50_000_000, 0).result;
    expect(result.covered).toBe(true);
    expect(result.employee.bhxh).toBe(4_000_000);
    expect(result.employee.bhtn).toBe(0);
    expect(result.funds).toEqual({ bhxh: true, bhyt: true, bhtn: false });
  });

  it("gives the Simple profile no insurance at all", () => {
    const result = run(personInput({ profile: { ...personInput().profile, profile: "simple" } }), 30_000_000, 0).result;
    expect(result).toMatchObject({ covered: false, reason: "simple_profile" });
  });

  it("contributes nothing on no salary", () => {
    expect(run(personInput(), 0, 0).result).toMatchObject({ covered: false, reason: "no_salary" });
  });
});

describe("union (FR-PAY-12)", () => {
  const insured = calculateInsurance(personInput(), 40_000_000, 0).result;

  it("stays out of an entity without a union", () => {
    expect(calculateUnion(personInput(), insured)).toMatchObject({ dues: 0, fund: 0, lines: [] });
  });

  it("charges the employer's fund even when nobody is a member", () => {
    const result = calculateUnion(personInput({ policy: { ...DEFAULT_PAYROLL_POLICY, unionEnabled: true } }), insured);
    expect(result.fund).toBe(800_000); // 2% of 40,000,000
    expect(result.dues).toBe(0);
  });

  it("caps a member's dues at a share of the reference level", () => {
    const input = personInput({ policy: { ...DEFAULT_PAYROLL_POLICY, unionEnabled: true }, profile: { ...personInput().profile, unionMember: true } });
    // 1% of 40,000,000 would be 400,000; the cap is 10% of 2,530,000.
    expect(calculateUnion(input, insured).dues).toBe(253_000);
  });

  it("charges nothing in a month with no insurance to charge it on", () => {
    const uninsured = calculateInsurance(personInput(), 40_000_000, 20).result;
    expect(calculateUnion(personInput({ policy: { ...DEFAULT_PAYROLL_POLICY, unionEnabled: true } }), uninsured).fund).toBe(0);
  });
});

describe("PIT (FR-PAY-13, FR-PAY-14)", () => {
  const brackets = STATUTORY.pitBrackets;

  it("taxes slice by slice, each bracket keeping its own part", () => {
    expect(progressiveTax(0, brackets).tax).toBe(0);
    expect(progressiveTax(10_000_000, brackets).tax).toBe(500_000);
    // One đồng into the second bracket.
    expect(progressiveTax(10_000_001, brackets).tax).toBe(500_000);
    expect(progressiveTax(30_000_000, brackets).tax).toBe(2_500_000);
    // 10M×5% + 20M×10% + 30M×20% + 40M×30% + 100M×35% = 0.5 + 2 + 6 + 12 + 35 million.
    expect(progressiveTax(200_000_000, brackets).tax).toBe(55_500_000);
  });

  it("records what fell in each bracket", () => {
    const { slices } = progressiveTax(46_493_000, brackets);
    expect(slices.map((slice) => slice.amount)).toEqual([10_000_000, 20_000_000, 16_493_000]);
    expect(slices.at(-1)).toMatchObject({ rateBp: 2000, tax: 3_298_600 });
  });

  it("picks the method from the profile, and from the policy for the Simple profile", () => {
    const base = personInput();
    expect(pitMethodFor(base)).toBe("progressive");
    expect(pitMethodFor(personInput({ profile: { ...base.profile, profile: "simple" } }))).toBe("none");
    expect(pitMethodFor(personInput({ profile: { ...base.profile, profile: "simple" }, policy: { ...DEFAULT_PAYROLL_POLICY, simplePitTreatment: "flat_withholding" } }))).toBe("flat_without_contract");
    expect(pitMethodFor(personInput({ profile: { ...base.profile, profile: "simple", taxResidency: "non_resident" }, policy: { ...DEFAULT_PAYROLL_POLICY, simplePitTreatment: "flat_withholding" } }))).toBe("flat_non_resident");
  });

  it("withholds nothing below the per-payment threshold", () => {
    const input = personInput({
      profile: { ...personInput().profile, profile: "simple" },
      policy: { ...DEFAULT_PAYROLL_POLICY, simplePitTreatment: "flat_withholding" },
      segments: [{ from: "2026-08-01", to: "2026-08-31", standardDays: 22, paidDaysCenti: 2200, unpaidDaysCenti: 0, terms: { baseSalary: 1_900_000, insuranceSalary: 0, allowances: [] } }],
    });
    expect(calculatePerson(input).totals.pit).toBe(0);
  });

  it("exempts overtime either down to the ordinary rate or in full", () => {
    expect(overtimeExemption("premium_only", 5_987_500, 3_000_000)).toBe(2_987_500);
    expect(overtimeExemption("full", 5_987_500, 3_000_000)).toBe(5_987_500);
    // Never negative, whatever the figures.
    expect(overtimeExemption("premium_only", 1_000, 5_000)).toBe(0);
  });

  it("taxes an allowance only above its cap", () => {
    expect(taxablePart({ taxTreatment: "taxable", exemptCap: null }, 730_000)).toBe(730_000);
    expect(taxablePart({ taxTreatment: "exempt", exemptCap: null }, 730_000)).toBe(0);
    expect(taxablePart({ taxTreatment: "exempt_up_to_cap", exemptCap: 730_000 }, 730_000)).toBe(0);
    expect(taxablePart({ taxTreatment: "exempt_up_to_cap", exemptCap: 730_000 }, 1_000_000)).toBe(270_000);
  });

  it("deducts charity and voluntary pension before the brackets", () => {
    const without = calculatePerson(personInput()).pit.assessableIncome;
    const with2m = calculatePerson(personInput({ otherPitDeductions: 2_000_000 })).pit.assessableIncome;
    expect(without - with2m).toBe(2_000_000);
  });
});

describe("overtime rate", () => {
  it("is the monthly rate over the month's ordinary hours", () => {
    expect(hourlyRate(22_000_000, 22, 8)).toBe(125_000);
    expect(hourlyRate(30_000_000, 22, 8)).toBe(170_455); // 170,454.54… half up
  });

  it("is zero in a month that asks no hours, rather than dividing by zero", () => {
    expect(hourlyRate(22_000_000, 0, 8)).toBe(0);
  });

  it("multiplies the allowances that count as salary when the policy says so", () => {
    const withAllowance = personInput({
      segments: [{ from: "2026-08-01", to: "2026-08-31", standardDays: 22, paidDaysCenti: 2200, unpaidDaysCenti: 0, terms: { baseSalary: 22_000_000, insuranceSalary: 22_000_000, allowances: [{ code: "ALW_RESPONSIBILITY", amount: 4_400_000 }] } }],
      timesheet: { ...personInput().timesheet, overtime: { weekday: { day: 600, night: 0 }, restDay: { day: 0, night: 0 }, holiday: { day: 0, night: 0 } } },
    });
    const onBase = calculatePerson(withAllowance).lines.find((line) => line.code === "OT_WEEKDAY")!.amount;
    const onBasePlus = calculatePerson({ ...withAllowance, policy: { ...DEFAULT_PAYROLL_POLICY, overtimeBase: "base_plus_insurable_allowances" } }).lines.find((line) => line.code === "OT_WEEKDAY")!.amount;
    expect(onBase).toBe(1_875_000);
    // (22,000,000 + 4,400,000) / 176 = 150,000 an hour × 10 hours × 150%.
    expect(onBasePlus).toBe(2_250_000);
  });
});

describe("the whole calculation", () => {
  it("warns rather than refusing when a run would pay a negative net", () => {
    const result = calculatePerson(personInput({ inputs: [{ code: "ADVANCE", amount: 40_000_000 }] }));
    expect(result.totals.net).toBeLessThan(0);
    expect(result.warnings).toContain("negative_net");
  });

  it("notices a month nobody was paid for, and a person with no pay terms", () => {
    const empty = calculatePerson(
      personInput({
        segments: [{ from: "2026-08-01", to: "2026-08-31", standardDays: 22, paidDaysCenti: 0, unpaidDaysCenti: 2200, terms: { baseSalary: 0, insuranceSalary: 0, allowances: [] } }],
        timesheet: { ...personInput().timesheet, paidDaysCenti: 0, unpaidDaysCenti: 2200 },
      }),
    );
    expect(empty.warnings).toEqual(expect.arrayContaining(["no_salary_structure", "zero_paid_days"]));
    expect(empty.totals.net).toBe(0);
  });

  it("takes a typed-in bonus into tax but an advance only out of the net", () => {
    const withBonus = calculatePerson(personInput({ inputs: [{ code: "BONUS", amount: 5_000_000 }] }));
    const withAdvance = calculatePerson(personInput({ inputs: [{ code: "ADVANCE", amount: 5_000_000 }] }));
    const plain = calculatePerson(personInput());
    expect(withBonus.totals.taxableIncome - plain.totals.taxableIncome).toBe(5_000_000);
    expect(withAdvance.totals.taxableIncome).toBe(plain.totals.taxableIncome);
    expect(plain.totals.net - withAdvance.totals.net).toBe(5_000_000);
  });

  it("ignores a typed-in figure for a component the catalogue does not have as an input", () => {
    // BASE comes from the structure; a run may not overwrite it by typing a number in.
    const result = calculatePerson(personInput({ inputs: [{ code: "BASE", amount: 999_000_000 }, { code: "NOT_A_CODE", amount: 1_000 }] }));
    expect(result.totals.grossEarnings).toBe(30_000_000);
  });

  it("puts earnings, deductions and employer costs in that order, each by the catalogue's order", () => {
    const result = calculatePerson(personInput({ policy: { ...DEFAULT_PAYROLL_POLICY, unionEnabled: true } }));
    const kinds = result.lines.map((line) => line.kind);
    expect(kinds).toEqual([...kinds].sort((a, b) => ["earning", "deduction", "employer_cost"].indexOf(a) - ["earning", "deduction", "employer_cost"].indexOf(b)));
  });

  it("keeps every parameter it used out of the code and in the snapshot", () => {
    // Change the law, and the result changes with it — nothing legal is frozen in the engine.
    const cheaper = calculatePerson(personInput({ statutory: { ...STATUTORY, pitDeductions: { personal: 20_000_000, dependent: 6_200_000 } } }));
    expect(cheaper.totals.pit).toBeLessThan(calculatePerson(personInput()).totals.pit);
  });
});
