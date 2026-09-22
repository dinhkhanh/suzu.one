import { describe, expect, it } from "vitest";
import { formatJobNumber, jobPrefix, jobYear } from "./job-number";

describe("job numbers (FR-PJM-02)", () => {
  it("reads entity code, two-digit year, three-digit sequence", () => {
    expect(formatJobNumber({ prefix: "SZM", year: 2026, sequence: 42 })).toBe("SZM-26-042");
    expect(formatJobNumber({ prefix: "SZ", year: 2030, sequence: 1 })).toBe("SZ-30-001");
    expect(formatJobNumber({ prefix: "SZC", year: 2026, sequence: 1234 })).toBe("SZC-26-1234");
  });
  it("cleans the entity code and falls back to the group prefix", () => {
    expect(jobPrefix("szm")).toBe("SZM");
    expect(jobPrefix("SZ-M ")).toBe("SZM");
    expect(jobPrefix(null)).toBe("SZ");
    expect(jobPrefix("--")).toBe("SZ");
    expect(jobYear("2026-12-31")).toBe(2026);
  });
});
