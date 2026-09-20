// The statutory filings (FR-PAY-35): who may build them, what lands in each block, and that the
// period arithmetic (month / quarter / year) is right.
import { beforeAll, describe, expect, it } from "vitest";
import { buildD02lt, D02LT_REASONS, type D02ltRow } from "./exports/statutory/d02lt";
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
