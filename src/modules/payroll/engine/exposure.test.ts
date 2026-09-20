import { describe, expect, it } from "vitest";
import { exposureFlags, monthsOn } from "./exposure";

const base = { since: "2026-06-01", reviewDate: null, contractType: "probation", today: "2026-09-20", longestProbationDays: 180 };

describe("Simple-profile exposure (FR-PAY-08)", () => {
  it("counts whole months on the profile", () => {
    expect(monthsOn("2026-06-01", "2026-09-20")).toBe(3);
    expect(monthsOn("2026-06-21", "2026-09-20")).toBe(2);
    expect(monthsOn("2026-09-20", "2026-09-20")).toBe(0);
    expect(monthsOn("2026-10-01", "2026-09-20")).toBe(0);
    expect(monthsOn("2025-12-31", "2026-01-31")).toBe(1);
  });

  it("flags nothing for a probationer inside the limit", () => {
    expect(exposureFlags({ ...base, basis: "probation" })).toEqual([]);
  });

  it("flags a probation past the longest limit the law knows, from the parameter it is given", () => {
    expect(exposureFlags({ ...base, basis: "probation", since: "2026-01-01" })).toEqual(["probation_longer_than_limit"]);
    expect(exposureFlags({ ...base, basis: "probation", longestProbationDays: 60 })).toEqual(["probation_longer_than_limit"]);
  });

  it("flags a short-term basis that has lasted a month, a passed review date, a labour contract behind a service basis, and no document at all", () => {
    expect(exposureFlags({ ...base, basis: "short_term", contractType: "service", since: "2026-08-20" })).toEqual(["short_term_longer_than_a_month"]);
    expect(exposureFlags({ ...base, basis: "short_term", contractType: "service", since: "2026-08-21" })).toEqual([]);
    expect(exposureFlags({ ...base, basis: "retiree", contractType: "fixed_term", reviewDate: "2026-09-20" })).toEqual(["review_date_passed"]);
    expect(exposureFlags({ ...base, basis: "service_contract", contractType: "indefinite" })).toEqual(["service_contract_with_labour_contract"]);
    expect(exposureFlags({ ...base, basis: "other", contractType: null })).toEqual(["no_basis_document"]);
  });
});
