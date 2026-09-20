// Retro items (FR-PAY-17) and off-cycle taxation (FR-PAY-19) as rules a reader can check.
import { describe, expect, it } from "vitest";
import { DEFAULT_PAYROLL_POLICY } from "../enums";
import { calculatePerson } from "./calculate";
import { seededComponents, seededStatutory } from "./golden/fixtures";
import { payPeriodOf } from "./period";
import { applyAdjustmentDeltas, calculateRetroLines, differenceBetween, insuranceAdjustmentNeeded } from "./retro";
import type { PersonPayInput } from "./types";

const STATUTORY = seededStatutory("2026-08-31");
const COMPONENTS = seededComponents();

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

const lineOf = (result: ReturnType<typeof calculatePerson>, code: string) => result.lines.find((line) => line.code === code);

describe("retro lines", () => {
  it("pays a positive difference as its own earning line, taxable in the month it is paid", () => {
    const plain = calculatePerson(personInput());
    const withRetro = calculatePerson(personInput({ retro: [{ sourceMonth: "2026-07", amount: 2_000_000, kind: "salary_change" }] }));
    expect(lineOf(withRetro, "RETRO_PAY")?.amount).toBe(2_000_000);
    expect(withRetro.totals.grossEarnings).toBe(plain.totals.grossEarnings + 2_000_000);
    expect(withRetro.totals.taxableIncome).toBe(plain.totals.taxableIncome + 2_000_000);
  });

  it("never adds retro to this month's insurance base", () => {
    const plain = calculatePerson(personInput());
    const withRetro = calculatePerson(personInput({ retro: [{ sourceMonth: "2026-07", amount: 5_000_000, kind: "salary_change" }] }));
    expect(lineOf(withRetro, "RETRO_PAY")?.insurable).toBe(0);
    expect(withRetro.totals.employeeInsurance).toBe(plain.totals.employeeInsurance);
    expect(withRetro.insurance.bhxhBhytBase).toBe(plain.insurance.bhxhBhytBase);
  });

  it("recovers a negative difference as a deduction, never as a negative earning", () => {
    const result = calculatePerson(personInput({ retro: [{ sourceMonth: "2026-07", amount: -1_500_000, kind: "timesheet_adjustment" }] }));
    const line = lineOf(result, "RETRO_RECOVERY");
    expect(line).toMatchObject({ kind: "deduction", amount: 1_500_000, taxable: 0 });
    expect(result.lines.every((entry) => entry.amount >= 0)).toBe(true);
    expect(result.totals.otherDeductions).toBe(1_500_000);
  });

  it("keeps one line per source month and direction", () => {
    const result = calculatePerson(
      personInput({
        retro: [
          { sourceMonth: "2026-06", amount: 400_000, kind: "manual" },
          { sourceMonth: "2026-06", amount: 600_000, kind: "manual" },
          { sourceMonth: "2026-07", amount: -100_000, kind: "timesheet_adjustment" },
        ],
      }),
    );
    expect(result.lines.filter((line) => line.code === "RETRO_PAY")).toHaveLength(1);
    expect(lineOf(result, "RETRO_PAY")?.amount).toBe(1_000_000);
    expect(lineOf(result, "RETRO_RECOVERY")?.amount).toBe(100_000);
    // The trace names each month so a payslip can be explained line by line.
    expect(result.trace.filter((step) => step.stage === "retro").map((step) => step.detail.sourceMonth)).toEqual(["2026-06", "2026-07"]);
  });

  it("ignores a zero difference", () => {
    const result = calculatePerson(personInput({ retro: [{ sourceMonth: "2026-07", amount: 0, kind: "manual" }] }));
    expect(result.lines.some((line) => line.code.startsWith("RETRO"))).toBe(false);
  });

  it("flags a difference whose insurance base changed, for the BHXH adjustment declaration", () => {
    expect(insuranceAdjustmentNeeded([{ sourceMonth: "2026-07", amount: 1_000, kind: "salary_change", insuranceBaseChanged: true }])).toBe(true);
    expect(insuranceAdjustmentNeeded([{ sourceMonth: "2026-07", amount: 1_000, kind: "salary_change" }])).toBe(false);
    // A flag on an item that cancels out is not an adjustment either.
    expect(insuranceAdjustmentNeeded([{ sourceMonth: "2026-07", amount: 0, kind: "salary_change", insuranceBaseChanged: true }])).toBe(false);
  });

  it("produces nothing when the catalogue has no retro component", () => {
    const withoutRetro = COMPONENTS.filter((component) => !component.code.startsWith("RETRO"));
    const result = calculatePerson(personInput({ components: withoutRetro, retro: [{ sourceMonth: "2026-07", amount: 2_000_000, kind: "manual" }] }));
    expect(result.lines.some((line) => line.code.startsWith("RETRO"))).toBe(false);
  });

  it("is the difference of two calculations of the same month", () => {
    const before = calculatePerson(personInput());
    const after = calculatePerson(personInput({ segments: [{ from: "2026-08-01", to: "2026-08-31", standardDays: 22, paidDaysCenti: 2200, unpaidDaysCenti: 0, terms: { baseSalary: 33_000_000, insuranceSalary: 33_000_000, allowances: [] } }] }));
    const difference = differenceBetween(before, after);
    expect(difference.amount).toBe(3_000_000);
    expect(difference.byCode).toEqual([{ code: "BASE", amount: 3_000_000 }]);
    // A backdated raise changes the month's declared contribution base as well — payroll cannot
    // put that right, so it says so.
    expect(difference.insuranceBaseChanged).toBe(true);
    expect(difference.sourceMonth).toBe("2026-08");
  });

  it("turns a timesheet correction into money by recalculating the month it belongs to", () => {
    // The month as it was paid: two days of unpaid absence.
    const paid = personInput({
      timesheet: { standardDays: 22, standardMinutes: 10_560, paidDaysCenti: 2000, unpaidDaysCenti: 200, workedMinutes: 9_600, nightMinutes: 0, overtime: { weekday: { day: 0, night: 0 }, restDay: { day: 0, night: 0 }, holiday: { day: 0, night: 0 } } },
      segments: [{ from: "2026-08-01", to: "2026-08-31", standardDays: 22, paidDaysCenti: 2000, unpaidDaysCenti: 200, terms: { baseSalary: 30_000_000, insuranceSalary: 30_000_000, allowances: [] } }],
    });
    const before = calculatePerson(paid);
    // HR later finds the two days were approved leave after all: +200 hundredths of a paid day.
    const corrected = applyAdjustmentDeltas(paid, { paidDaysCenti: 200, leavePaidMinutes: 960 });
    const after = calculatePerson(corrected);
    const difference = differenceBetween(before, after);

    expect(corrected.timesheet.paidDaysCenti).toBe(2200);
    expect(corrected.segments[0].paidDaysCenti).toBe(2200);
    // Two working days of a 22-day month on 30,000,000: 30,000,000 × 200 ÷ 2,200 = 2,727,273.
    expect(difference.amount).toBe(2_727_273);
    expect(difference.insuranceBaseChanged).toBe(false);
  });

  it("carries no retro of its own into a recalculation", () => {
    const input = personInput({ retro: [{ sourceMonth: "2026-06", amount: 900_000, kind: "manual" }], priorInMonth: { runId: "r", taxableIncome: 1_000_000, employeeInsurance: 0, otherDeductions: 0, tax: 50_000 }, runKind: "off_cycle" });
    const replayed = applyAdjustmentDeltas(input, {});
    expect(replayed.retro).toEqual([]);
    expect(replayed.priorInMonth).toBeNull();
    expect(replayed.runKind).toBe("regular");
  });

  it("never pushes a timesheet figure below zero", () => {
    const input = personInput();
    const corrected = applyAdjustmentDeltas(input, { workedMinutes: -999_999, paidDaysCenti: -999_999, otWeekdayMinutes: -60 });
    expect(corrected.timesheet.workedMinutes).toBe(0);
    expect(corrected.timesheet.paidDaysCenti).toBe(0);
    expect(corrected.timesheet.overtime.weekday.day).toBe(0);
    expect(corrected.segments[0].paidDaysCenti).toBe(0);
  });

  it("groups without a component lookup when asked directly", () => {
    const { lines, trace } = calculateRetroLines(personInput({ retro: [{ sourceMonth: "2026-05", amount: 1_000, kind: "manual", reason: "Điều chỉnh" }] }));
    expect(lines).toHaveLength(1);
    expect(trace[0].detail.kinds).toBe("manual");
  });
});

describe("an off-cycle run taxes the month, not the payment (FR-PAY-19)", () => {
  // A bonus of 20,000,000 paid on its own, after a regular month of 30,000,000.
  const regular = calculatePerson(personInput());
  const prior = { runId: "regular", taxableIncome: regular.totals.taxableIncome, employeeInsurance: regular.totals.employeeInsurance, otherDeductions: 0, tax: regular.totals.pit };
  const bonusInput = personInput({
    runKind: "off_cycle",
    priorInMonth: prior,
    // An off-cycle run pays no salary and counts no attendance: only what is typed into it.
    segments: [{ from: "2026-08-01", to: "2026-08-31", standardDays: 0, paidDaysCenti: 0, unpaidDaysCenti: 0, terms: { baseSalary: 0, insuranceSalary: 0, allowances: [] } }],
    timesheet: { standardDays: 0, standardMinutes: 0, paidDaysCenti: 0, unpaidDaysCenti: 0, workedMinutes: 0, nightMinutes: 0, overtime: { weekday: { day: 0, night: 0 }, restDay: { day: 0, night: 0 }, holiday: { day: 0, night: 0 } } },
    inputs: [{ code: "BONUS", amount: 20_000_000 }],
  });
  const bonus = calculatePerson(bonusInput);

  it("withholds the difference between the month's tax and what was already taken", () => {
    // The whole month at once, for comparison: salary + bonus on one payslip.
    const together = calculatePerson(personInput({ inputs: [{ code: "BONUS", amount: 20_000_000 }] }));
    expect(bonus.pit.priorTax).toBe(regular.totals.pit);
    expect(bonus.pit.monthTax).toBe(together.totals.pit);
    expect(regular.totals.pit + bonus.totals.pit).toBe(together.totals.pit);
  });

  it("gives the personal and dependent deductions once, not twice", () => {
    const deductions = STATUTORY.pitDeductions;
    expect(bonus.pit.personalDeduction).toBe(deductions.personal);
    // The assessable income is the month's, so the deduction cannot be taken a second time.
    expect(bonus.pit.assessableIncome).toBe(Math.max(0, regular.totals.taxableIncome + 20_000_000 - regular.totals.employeeInsurance - deductions.personal));
  });

  it("charges no insurance twice: an off-cycle run has no contribution of its own", () => {
    expect(bonus.totals.employeeInsurance).toBe(0);
    expect(bonus.insurance.covered).toBe(false);
    expect(bonus.insurance.reason).toBe("off_cycle_run");
  });

  it("never pays tax back through payroll", () => {
    const overWithheld = calculatePerson(personInput({ ...bonusInput, priorInMonth: { ...prior, tax: prior.tax + 50_000_000 }, inputs: [{ code: "BONUS", amount: 1_000_000 }] }));
    expect(overWithheld.totals.pit).toBe(0);
    expect(overWithheld.totals.net).toBe(1_000_000);
  });

  it("taxes a flat-rate payment on its own, because the threshold is per payment", () => {
    const simple = personInput({
      profile: { profile: "simple", taxResidency: "resident", pitMethod: "flat_without_contract", pitCommitment: false, insuranceExemption: null, unionMember: false },
      policy: { ...DEFAULT_PAYROLL_POLICY, simplePitTreatment: "flat_withholding" },
      runKind: "off_cycle",
      priorInMonth: { runId: "regular", taxableIncome: 15_000_000, employeeInsurance: 0, otherDeductions: 0, tax: 1_500_000 },
      segments: [{ from: "2026-08-01", to: "2026-08-31", standardDays: 0, paidDaysCenti: 0, unpaidDaysCenti: 0, terms: { baseSalary: 0, insuranceSalary: 0, allowances: [] } }],
      timesheet: { standardDays: 0, standardMinutes: 0, paidDaysCenti: 0, unpaidDaysCenti: 0, workedMinutes: 0, nightMinutes: 0, overtime: { weekday: { day: 0, night: 0 }, restDay: { day: 0, night: 0 }, holiday: { day: 0, night: 0 } } },
      inputs: [{ code: "BONUS", amount: 5_000_000 }],
    });
    const result = calculatePerson(simple);
    // 10% of this payment, with no credit for what the regular run withheld.
    expect(result.totals.pit).toBe(500_000);
    expect(result.pit.monthTax).toBe(2_000_000);
  });

  it("withholds nothing on a payment under the per-payment threshold", () => {
    const small = calculatePerson(
      personInput({
        profile: { profile: "simple", taxResidency: "resident", pitMethod: "flat_without_contract", pitCommitment: false, insuranceExemption: null, unionMember: false },
        policy: { ...DEFAULT_PAYROLL_POLICY, simplePitTreatment: "flat_withholding" },
        segments: [{ from: "2026-08-01", to: "2026-08-31", standardDays: 22, paidDaysCenti: 2200, unpaidDaysCenti: 0, terms: { baseSalary: 1_500_000, insuranceSalary: 0, allowances: [] } }],
      }),
    );
    expect(STATUTORY.pitFlatRates.withoutContractThreshold).toBe(2_000_000);
    expect(small.totals.pit).toBe(0);
  });

  it("withholds nothing when form 08/CK-TNCN is on file, however large the payment", () => {
    const committed = calculatePerson(
      personInput({
        profile: { profile: "simple", taxResidency: "resident", pitMethod: "flat_without_contract", pitCommitment: true, insuranceExemption: null, unionMember: false },
        policy: { ...DEFAULT_PAYROLL_POLICY, simplePitTreatment: "flat_withholding" },
      }),
    );
    expect(committed.totals.pit).toBe(0);
    expect(committed.pit.method).toBe("flat_without_contract");
  });

  it("gives a non-resident no deduction and no commitment-form relief", () => {
    const nonResident = calculatePerson(
      personInput({
        profile: { profile: "statutory", taxResidency: "non_resident", pitMethod: "flat_non_resident", pitCommitment: true, insuranceExemption: null, unionMember: false },
      }),
    );
    // 20% of the whole taxable income, whatever the deductions or the commitment form say.
    expect(nonResident.totals.pit).toBe(Math.round(nonResident.totals.taxableIncome * 0.2));
    expect(nonResident.pit.personalDeduction).toBe(0);
  });
});
