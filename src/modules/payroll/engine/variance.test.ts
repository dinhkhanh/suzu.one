import { describe, expect, it } from "vitest";
import { changeInBp, compareRuns, type VarianceInput } from "./variance";
import type { PayTotals, PersonPayResult } from "./types";

const totals = (over: Partial<PayTotals> = {}): PayTotals => ({
  grossEarnings: 20_000_000,
  taxableIncome: 20_000_000,
  exemptIncome: 0,
  employeeInsurance: 2_100_000,
  employerInsurance: 4_300_000,
  unionDues: 0,
  unionFund: 0,
  pit: 0,
  otherDeductions: 0,
  totalDeductions: 2_100_000,
  net: 17_900_000,
  employerCost: 24_300_000,
  ...over,
});

const person = (personId: string, over: Partial<PayTotals> = {}, warnings: PersonPayResult["warnings"] = []) => ({ personId, result: { totals: totals(over), warnings, profile: "statutory" as const } });

const facts = (personId: string, over: Partial<VarianceInput["facts"][number]> = {}) => ({ personId, hasBankAccount: true, hasTaxCode: true, profile: "statutory" as const, paidInCash: false, ...over });

const run = (over: Partial<VarianceInput> = {}) => compareRuns({ current: [], previous: [], facts: [], thresholdBp: 1000, ...over });

describe("changeInBp", () => {
  it("is signed and in basis points", () => {
    expect(changeInBp(11_000_000, 10_000_000)).toBe(1000); // +10%
    expect(changeInBp(9_000_000, 10_000_000)).toBe(-1000);
    expect(changeInBp(10_000_000, 10_000_000)).toBe(0);
  });

  it("has no answer without something to compare", () => {
    expect(changeInBp(10_000_000, null)).toBeNull();
    // Paid nothing last month: a rise from zero is not a percentage.
    expect(changeInBp(10_000_000, 0)).toBeNull();
  });
});

describe("compareRuns", () => {
  it("passes a month that looks like the one before it", () => {
    const report = run({ current: [person("a")], previous: [person("a")], facts: [facts("a")] });
    expect(report.flagged).toEqual([]);
    expect(report.people[0].changeBp).toBe(0);
    expect(report.totals).toMatchObject({ headcount: 1, previousHeadcount: 1, changeBp: 0 });
  });

  it("flags a net change beyond the threshold, and leaves one inside it alone", () => {
    const previous = [person("a", { net: 10_000_000 })];
    const facts0 = [facts("a")];
    // +9% against a 10% threshold.
    expect(run({ current: [person("a", { net: 10_900_000 })], previous, facts: facts0 }).flagged).toEqual([]);
    const loud = run({ current: [person("a", { net: 12_000_000 })], previous, facts: facts0 });
    expect(loud.flagged[0].flags).toEqual(["net_change"]);
    expect(loud.flagged[0].changeBp).toBe(2000);
    expect(loud.counts.net_change).toBe(1);
    // A fall is just as loud as a rise.
    expect(run({ current: [person("a", { net: 8_000_000 })], previous, facts: facts0 }).flagged[0].changeBp).toBe(-2000);
  });

  it("names people who arrived and people who went, and never calls an arrival a change", () => {
    const report = run({ current: [person("new")], previous: [person("gone")], facts: [facts("new")] });
    expect(report.people.find((row) => row.personId === "new")).toMatchObject({ flags: ["new_person"], changeBp: null });
    expect(report.people.find((row) => row.personId === "gone")).toMatchObject({ flags: ["removed_person"], net: 0, previousNet: 17_900_000 });
    expect(report.counts).toMatchObject({ new_person: 1, removed_person: 1, net_change: 0 });
    // The leaver is not counted in this month's headcount, but their last month's pay is compared.
    expect(report.totals).toMatchObject({ headcount: 1, previousHeadcount: 1 });
  });

  it("flags a negative net and a zero net, but never both", () => {
    const negative = run({ current: [person("a", { net: -500_000 })], previous: [person("a")], facts: [facts("a")] });
    expect(negative.flagged[0].flags).toContain("negative_net");
    expect(negative.flagged[0].flags).not.toContain("zero_net");
    expect(run({ current: [person("a", { net: 0 })], previous: [person("a")], facts: [facts("a")] }).flagged[0].flags).toContain("zero_net");
  });

  it("wants a bank account for everyone the bank must reach, and not for cash", () => {
    const missing = run({ current: [person("a")], previous: [person("a")], facts: [facts("a", { hasBankAccount: false })] });
    expect(missing.flagged[0].flags).toContain("missing_bank_account");
    // The Simple profile is paid in cash (FR-PAY-39): no account, nothing to flag.
    expect(run({ current: [person("a")], previous: [person("a")], facts: [facts("a", { hasBankAccount: false, paidInCash: true })] }).flagged).toEqual([]);
    // Nothing to transfer either way.
    expect(run({ current: [person("a", { net: 0 })], previous: [person("a", { net: 0 })], facts: [facts("a", { hasBankAccount: false })] }).flagged[0].flags).not.toContain("missing_bank_account");
  });

  it("wants a tax code only from someone whose tax is actually withheld", () => {
    expect(run({ current: [person("a", { pit: 900_000 })], previous: [person("a", { pit: 900_000 })], facts: [facts("a", { hasTaxCode: false })] }).flagged[0].flags).toContain("missing_tax_code");
    expect(run({ current: [person("a", { pit: 0 })], previous: [person("a", { pit: 0 })], facts: [facts("a", { hasTaxCode: false })] }).flagged).toEqual([]);
  });

  it("carries the engine's own warnings through, and shows a person who has one but no flag", () => {
    const report = run({ current: [person("a", {}, ["no_salary_structure"])], previous: [person("a")], facts: [facts("a")] });
    expect(report.flagged).toHaveLength(1);
    expect(report.flagged[0]).toMatchObject({ flags: [], warnings: ["no_salary_structure"] });
  });

  it("puts the worst line first", () => {
    const report = run({
      current: [person("change", { net: 30_000_000 }), person("negative", { net: -1 }), person("new")],
      previous: [person("change", { net: 10_000_000 }), person("negative")],
      facts: [facts("change"), facts("negative"), facts("new")],
    });
    expect(report.flagged.map((row) => row.personId)).toEqual(["negative", "new", "change"]);
  });

  it("totals both months and reports the change between them", () => {
    const report = run({
      current: [person("a", { net: 10_000_000, grossEarnings: 12_000_000 }), person("b", { net: 10_000_000, grossEarnings: 12_000_000 })],
      previous: [person("a", { net: 10_000_000, grossEarnings: 12_000_000 })],
      facts: [facts("a"), facts("b")],
    });
    expect(report.totals).toMatchObject({ net: 20_000_000, previousNet: 10_000_000, gross: 24_000_000, previousGross: 12_000_000, changeBp: 10_000 });
  });

  it("has no percentage for the first run an entity ever makes", () => {
    const report = run({ current: [person("a")], previous: [], facts: [facts("a")] });
    expect(report.totals.changeBp).toBeNull();
    expect(report.counts.new_person).toBe(1);
  });
});
