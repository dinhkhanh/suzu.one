// The statutory filings (FR-PAY-35): who may build them, what lands in each block, and that the
// period arithmetic (month / quarter / year) is right.
import { beforeAll, describe, expect, it } from "vitest";
import type { PitResult } from "./engine/types";
import { buildD02lt, D02LT_REASONS, type D02ltRow } from "./exports/statutory/d02lt";
import { FILED_RUN_STATUSES, isFiledRunStatus, type MonthRun, pitOfMonth, pitOfPeriod } from "./exports/statutory/month";
import { buildDependants } from "./exports/statutory/dependants";
import { buildFinalization, buildFinalizationAppendix1, buildFinalizationAppendix2, type FinalizationRow, finalizationIndicators, flatRows, residentRows } from "./exports/statutory/pit-finalization";
import { buildPitMonthly, buildPitWorkingSheet, type PitPersonRow, pitIndicators } from "./exports/statutory/pit-monthly";
import { UNVERIFIED_CAVEAT } from "./exports/statutory/format";

const pitRow = (over: Partial<PitPersonRow> = {}): PitPersonRow => ({
  personId: "p1",
  fullName: "Nguyễn Văn A",
  employeeCode: "SZM-0001",
  taxCode: "8012345678",
  method: "progressive",
  taxableIncome: 30_000_000,
  deductions: 18_650_000,
  assessableIncome: 11_350_000,
  dependents: 0,
  tax: 635_000,
  ...over,
});

const finalRow = (over: Partial<FinalizationRow> = {}): FinalizationRow => ({
  personId: "p1",
  fullName: "Nguyễn Văn A",
  employeeCode: "SZM-0001",
  taxCode: "8012345678",
  nationalId: "079090001234",
  method: "progressive",
  hasImportedPeriod: false,
  taxableIncome: 360_000_000,
  insuranceDeduction: 37_800_000,
  personalDeduction: 186_000_000,
  dependentDeduction: 0,
  otherDeductions: 0,
  dependents: 0,
  assessableIncome: 136_200_000,
  taxWithheld: 7_620_000,
  taxDue: 7_620_000,
  ...over,
});

describe("statutory export formats", () => {
  it("marks every file as unverified against the official template", () => {
    const files = [
      buildPitMonthly({ entityCode: "SZM", period: "2026-08", rows: [pitRow()] }),
      buildFinalization({ entityCode: "SZM", year: 2026, rows: [finalRow()] }),
      buildD02lt({ entityCode: "SZM", month: "2026-08", rows: [] }),
      buildDependants({ entityCode: "SZM", period: "2026-08", rows: [] }),
    ];
    // Nothing here has been checked against HTKK or the BHXH portal; the file must say so itself.
    for (const file of files) expect(file.caveats[0]).toBe(UNVERIFIED_CAVEAT);
  });

  it("splits the PIT indicators by tax method and never counts a person twice", () => {
    const rows = [
      pitRow({ personId: "p1" }),
      pitRow({ personId: "p2", method: "flat_without_contract", taxableIncome: 5_000_000, assessableIncome: 5_000_000, deductions: 0, tax: 500_000 }),
      pitRow({ personId: "p3", method: "flat_non_resident", taxableIncome: 40_000_000, assessableIncome: 40_000_000, deductions: 0, tax: 8_000_000 }),
      pitRow({ personId: "p4", tax: 0 }),
    ];
    const value = (code: string) => pitIndicators(rows).find((indicator) => indicator.code === code)?.value;

    expect(value("[21]")).toBe(4);
    expect(value("[22]")).toBe(2);
    // Only three of the four had tax withheld.
    expect(value("[23]")).toBe(3);
    expect(value("[24]")).toBe(30_000_000 + 5_000_000 + 40_000_000 + 30_000_000);
    expect(value("[25]")).toBe(60_000_000);
    expect(value("[26]")).toBe(5_000_000);
    expect(value("[27]")).toBe(40_000_000);
    expect(value("[29]")).toBe(635_000 + 500_000 + 8_000_000 + 0);
    expect(value("[30]")).toBe(635_000);
    expect(value("[31]")).toBe(500_000);
    expect(value("[32]")).toBe(8_000_000);
  });

  it("puts each individual in exactly one finalization appendix", () => {
    const rows = [finalRow({ personId: "p1" }), finalRow({ personId: "p2", method: "flat_without_contract" }), finalRow({ personId: "p3", method: "flat_non_resident" })];
    expect(residentRows(rows).map((row) => row.personId)).toEqual(["p1"]);
    expect(flatRows(rows).map((row) => row.personId)).toEqual(["p2", "p3"]);
    expect(residentRows(rows).length + flatRows(rows).length).toBe(rows.length);

    const appendix1 = buildFinalizationAppendix1({ entityCode: "SZM", year: 2026, rows });
    const appendix2 = buildFinalizationAppendix2({ entityCode: "SZM", year: 2026, rows });
    expect(appendix1.rowCount).toBe(1);
    expect(appendix2.rowCount).toBe(2);
  });

  it("reports tax overpaid and still owed from the year's own arithmetic", () => {
    const value = (rows: FinalizationRow[], code: string) => finalizationIndicators(rows).find((indicator) => indicator.code === code)?.value;
    const overpaid = [finalRow({ taxWithheld: 9_000_000, taxDue: 7_620_000 })];
    const owing = [finalRow({ taxWithheld: 6_000_000, taxDue: 7_620_000 })];

    expect(value(overpaid, "[34]")).toBe(1_380_000);
    expect(value(overpaid, "[35]")).toBe(0);
    expect(value(owing, "[34]")).toBe(0);
    expect(value(owing, "[35]")).toBe(1_620_000);
    // The company holds no register of who authorised it to finalize on their behalf.
    expect(value(owing, "[37]")).toBe("");
  });

  it("writes the D02-LT change codes the portal is believed to use", () => {
    const row = (over: Partial<D02ltRow>): D02ltRow => ({
      fullName: "Trần Thị B",
      socialInsuranceNumber: "0123456789",
      nationalId: "079090005678",
      dateOfBirth: "1995-03-14",
      gender: "female",
      positionName: "Chuyên viên",
      month: "2026-08",
      previousBase: 0,
      newBase: 15_000_000,
      reason: "new_participant",
      note: null,
      employeeCode: "SZM-0002",
      ...over,
    });
    const file = buildD02lt({ entityCode: "SZM", month: "2026-08", rows: [row({}), row({ reason: "left", previousBase: 15_000_000, newBase: 0 }), row({ reason: "unpaid_leave", previousBase: 15_000_000, newBase: 0 })] });

    expect(file.rowCount).toBe(3);
    const lines = file.content.split("\r\n");
    expect(lines[1]).toContain(D02LT_REASONS.new_participant.code);
    expect(lines[2]).toContain(D02LT_REASONS.left.code);
    expect(lines[3]).toContain(D02LT_REASONS.unpaid_leave.code);
    // Dates go to the forms the way the forms write them.
    expect(lines[1]).toContain("14/03/1995");
    // The month the change applies from is mm/yyyy, not the ISO month.
    expect(lines[1]).toContain("08/2026");
  });

  it("keeps the working sheet apart from the declaration", () => {
    const rows = [pitRow()];
    const declaration = buildPitMonthly({ entityCode: "SZM", period: "2026-08", rows });
    const sheet = buildPitWorkingSheet({ entityCode: "SZM", period: "2026-08", rows });
    // The declaration is indicators; the sheet names the person behind them.
    expect(declaration.content).not.toContain("Nguyễn Văn A");
    expect(sheet.content).toContain("Nguyễn Văn A");
    expect(sheet.caveats.some((caveat) => caveat.includes("không nộp"))).toBe(true);
  });
});

describe("one person's month, read from its runs (PAY-06)", () => {
  const pit = (over: Partial<PitResult> = {}): PitResult => ({ method: "progressive", taxableIncome: 0, exemptIncome: 0, personalDeduction: 0, dependentDeduction: 0, dependents: 0, insuranceDeduction: 0, otherDeductions: 0, assessableIncome: 0, brackets: [], monthTax: 0, priorTax: 0, tax: 0, ...over });
  const at = (day: number) => new Date(Date.UTC(2026, 8, day));
  // Golden case 16: a salary of 30,000,000 by the regular run, then a bonus of 20,000,000 by an
  // off-cycle run of the same month. The bonus run stores the **month's** deductions and
  // assessable income (`engine/pit.ts`), and only its own income and its own withholding.
  const regular: MonthRun = { kind: "regular", calculatedAt: at(2), createdAt: at(1), pit: pit({ taxableIncome: 30_000_000, insuranceDeduction: 3_150_000, personalDeduction: 15_500_000, assessableIncome: 11_350_000, monthTax: 635_000, tax: 635_000 }) };
  const bonus: MonthRun = { kind: "off_cycle", calculatedAt: at(20), createdAt: at(20), pit: pit({ taxableIncome: 20_000_000, insuranceDeduction: 3_150_000, personalDeduction: 15_500_000, assessableIncome: 31_350_000, monthTax: 2_770_000, priorTax: 635_000, tax: 2_135_000 }) };

  it("adds income and tax withheld, and takes the deductions and assessable income once", () => {
    const month = pitOfMonth([regular, bonus]);
    expect(month).toMatchObject({ method: "progressive", taxableIncome: 50_000_000, insuranceDeduction: 3_150_000, personalDeduction: 15_500_000, assessableIncome: 31_350_000, tax: 2_770_000 });
    // What the declaration is checked against: the month's tax is what the runs withheld.
    expect(month.tax).toBe(bonus.pit.monthTax);
    expect(month.taxableIncome - month.insuranceDeduction - month.personalDeduction).toBe(month.assessableIncome);
  });

  it("does not depend on the order the runs are handed over in: the last one calculated carries the month", () => {
    expect(pitOfMonth([bonus, regular])).toEqual(pitOfMonth([regular, bonus]));
    // A bonus paid on the 20th, before the month's regular run is calculated on the 2nd of the next:
    // then it is the regular run that aggregates, and the regular run that is read.
    const early: MonthRun = { ...bonus, calculatedAt: at(1), pit: pit({ taxableIncome: 20_000_000, personalDeduction: 15_500_000, assessableIncome: 4_500_000, monthTax: 225_000, tax: 225_000 }) };
    const late: MonthRun = { ...regular, calculatedAt: at(28), pit: pit({ taxableIncome: 30_000_000, insuranceDeduction: 3_150_000, personalDeduction: 15_500_000, assessableIncome: 31_350_000, monthTax: 2_770_000, priorTax: 225_000, tax: 2_545_000 }) };
    expect(pitOfMonth([early, late])).toMatchObject({ taxableIncome: 50_000_000, personalDeduction: 15_500_000, assessableIncome: 31_350_000, tax: 2_770_000 });
  });

  it("leaves a month with one run exactly as that run stored it", () => {
    expect(pitOfMonth([regular])).toMatchObject({ taxableIncome: 30_000_000, insuranceDeduction: 3_150_000, personalDeduction: 15_500_000, assessableIncome: 11_350_000, tax: 635_000 });
  });

  it("adds flat-rate payments as they stand: each is taxed on its own and never aggregates", () => {
    const first: MonthRun = { kind: "regular", calculatedAt: at(2), createdAt: at(1), pit: pit({ method: "flat_without_contract", taxableIncome: 5_000_000, assessableIncome: 5_000_000, monthTax: 500_000, tax: 500_000 }) };
    const second: MonthRun = { kind: "off_cycle", calculatedAt: at(20), createdAt: at(20), pit: pit({ method: "flat_without_contract", taxableIncome: 3_000_000, assessableIncome: 3_000_000, monthTax: 800_000, priorTax: 500_000, tax: 300_000 }) };
    expect(pitOfMonth([first, second])).toMatchObject({ method: "flat_without_contract", taxableIncome: 8_000_000, assessableIncome: 8_000_000, personalDeduction: 0, tax: 800_000 });
  });

  it("adds months to a period, a month at a time", () => {
    const july = { ...regular, month: "2026-07" };
    const august = [
      { ...regular, month: "2026-08" },
      { ...bonus, month: "2026-08" },
    ];
    expect(pitOfPeriod([...august, july])).toMatchObject({ taxableIncome: 80_000_000, personalDeduction: 31_000_000, insuranceDeduction: 6_300_000, assessableIncome: 42_700_000, tax: 3_405_000 });
  });

  it("files only what the CEO has signed", () => {
    expect(["draft", "calculated", "proposed", "approved", "payment_prepared", "paid", "locked", "cancelled"].filter(isFiledRunStatus)).toEqual(["approved", "payment_prepared", "paid", "locked"]);
    expect([...FILED_RUN_STATUSES]).toEqual(["approved", "payment_prepared", "paid", "locked"]);
  });
});

describe("declaration periods", () => {
  let monthsOfPeriod: (period: string) => string[];
  let lastMonthOf: (period: string) => string;
  let shiftMonth: (month: string, by: number) => string;

  beforeAll(async () => {
    ({ monthsOfPeriod, lastMonthOf, shiftMonth } = await import("./statutory-exports"));
  });

  it("expands a month, a quarter and a year", () => {
    expect(monthsOfPeriod("2026-08")).toEqual(["2026-08"]);
    expect(monthsOfPeriod("2026-Q3")).toEqual(["2026-07", "2026-08", "2026-09"]);
    expect(monthsOfPeriod("2026-Q1")).toEqual(["2026-01", "2026-02", "2026-03"]);
    expect(monthsOfPeriod("2026")).toHaveLength(12);
    expect(lastMonthOf("2026-Q4")).toBe("2026-12");
  });

  it("steps across a year boundary", () => {
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
  });
});
