import { describe, expect, it } from "vitest";
import { countDependentsInMonth } from "./dependents";

describe("countDependentsInMonth", () => {
  const dependents = [
    { deductionFrom: "2026-01-01", deductionTo: null },
    { deductionFrom: "2026-08-01", deductionTo: "2026-10-01" },
    { deductionFrom: "2025-01-01", deductionTo: "2026-07-01" },
  ];

  it("counts a dependent from the first registered month to the last, inclusive", () => {
    expect(countDependentsInMonth(dependents, "2026-07")).toBe(2);
    expect(countDependentsInMonth(dependents, "2026-08")).toBe(2);
    expect(countDependentsInMonth(dependents, "2026-10")).toBe(2);
    expect(countDependentsInMonth(dependents, "2026-11")).toBe(1);
    expect(countDependentsInMonth(dependents, "2024-12")).toBe(0);
    expect(countDependentsInMonth([], "2026-08")).toBe(0);
  });
});
