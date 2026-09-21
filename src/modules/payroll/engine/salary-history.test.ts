import { describe, expect, it } from "vitest";
import { delta, salarySteps, termsTotal } from "./salary-history";

const structure = (validFrom: string, baseSalary: number, allowances: number[] = []) => ({
  validFrom,
  terms: { baseSalary, insuranceSalary: baseSalary, allowances: allowances.map((amount, index) => ({ code: `A${index}`, amount })) },
});

describe("salary history", () => {
  it("adds the allowances to the base", () => {
    expect(termsTotal(structure("2026-01-01", 10_000_000, [500_000, 1_000_000]).terms)).toBe(11_500_000);
  });

  it("names the direction and the size of a change", () => {
    expect(delta(10_000_000, 12_000_000)).toEqual({ amount: 2_000_000, bp: 2_000, direction: "up" });
    expect(delta(12_000_000, 9_000_000)).toEqual({ amount: -3_000_000, bp: -2_500, direction: "down" });
    expect(delta(9_000_000, 9_000_000)).toEqual({ amount: 0, bp: 0, direction: "same" });
    expect(delta(0, 5_000_000)).toEqual({ amount: 5_000_000, bp: null, direction: "up" });
  });

  it("compares each structure with the one before it, newest first", () => {
    const steps = salarySteps([structure("2026-06-01", 12_000_000, [1_000_000]), structure("2025-01-01", 10_000_000), structure("2026-09-01", 11_000_000, [1_000_000])]);
    expect(steps.map((step) => step.structure.validFrom)).toEqual(["2026-09-01", "2026-06-01", "2025-01-01"]);
    expect(steps.map((step) => step.base?.direction ?? null)).toEqual(["down", "up", null]);
    expect(steps[1]?.totalChange).toEqual({ amount: 3_000_000, bp: 3_000, direction: "up" });
    expect(steps[0]?.totalChange?.amount).toBe(-1_000_000);
  });

  it("has nothing to compare for a single structure", () => {
    expect(salarySteps([])).toEqual([]);
    expect(salarySteps([structure("2026-01-01", 8_000_000)])[0]).toMatchObject({ total: 8_000_000, base: null, totalChange: null });
  });
});
