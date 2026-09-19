// Golden cases for the contract rules. Limits are the Labour Code 2019 values as seeded; a change
// in the law adds a dated case here and a new version in the statutory store.
import { describe, expect, it } from "vitest";
import { addMonths, checkContract, type ContractDraft, type ContractLimits, daysBetween, type ExistingContract } from "./contract-rules";

const LIMITS: ContractLimits = { fixedTerm: { maxMonths: 36, maxFixedTermRenewals: 1 }, probation: { managerDays: 180, professionalDays: 60, intermediateDays: 30, otherDays: 6 } };
const draft = (overrides: Partial<ContractDraft>): ContractDraft => ({ type: "fixed_term", startDate: "2026-01-01", endDate: "2026-12-31", jobCategory: null, parentContractId: null, ...overrides });
const past = (id: string, type: ExistingContract["type"], startDate: string, endDate: string | null, terminatedOn: string | null = null): ExistingContract => ({ id, type, startDate, endDate, terminatedOn });

describe("date helpers", () => {
  it("adds calendar months, clamping to the end of short months", () => {
    expect(addMonths("2026-01-01", 36)).toBe("2029-01-01");
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2024-01-31", 1)).toBe("2024-02-29");
    expect(addMonths("2026-11-15", 3)).toBe("2027-02-15");
    expect(daysBetween("2026-01-01", "2026-03-01")).toBe(59);
  });
});

describe("contract rules", () => {
  it("accepts ordinary contracts", () => {
    expect(checkContract(draft({}), [], LIMITS)).toEqual([]);
    expect(checkContract(draft({ type: "indefinite", endDate: null }), [], LIMITS)).toEqual([]);
    expect(checkContract(draft({ type: "service", endDate: null }), [], LIMITS)).toEqual([]);
    expect(checkContract(draft({ type: "nda", endDate: null }), [past("a", "indefinite", "2020-01-01", null)], LIMITS)).toEqual([]);
  });

  it("rejects an end before the start, and an end date on an indefinite contract", () => {
    expect(checkContract(draft({ endDate: "2025-12-31" }), [], LIMITS)).toEqual(["contract_end_before_start"]);
    expect(checkContract(draft({ type: "indefinite" }), [], LIMITS)).toEqual(["contract_indefinite_has_end"]);
  });

  it("caps a fixed term at 36 months to the day", () => {
    expect(checkContract(draft({ endDate: "2028-12-31" }), [], LIMITS)).toEqual([]);
    expect(checkContract(draft({ endDate: "2029-01-01" }), [], LIMITS)).toEqual(["contract_fixed_term_too_long"]);
    expect(checkContract(draft({ endDate: null }), [], LIMITS)).toEqual(["contract_end_required"]);
  });

  it("allows one fixed-term renewal, then insists on indefinite", () => {
    const first = past("a", "fixed_term", "2023-01-01", "2023-12-31");
    const second = past("b", "fixed_term", "2024-01-01", "2025-12-31");
    expect(checkContract(draft({}), [first], LIMITS)).toEqual([]);
    expect(checkContract(draft({}), [first, second], LIMITS)).toEqual(["contract_must_be_indefinite"]);
    expect(checkContract(draft({ type: "indefinite", endDate: null }), [first, second], LIMITS)).toEqual([]);
    // A probation before the first fixed term does not count as a term.
    expect(checkContract(draft({}), [past("p", "probation", "2022-11-01", "2022-12-31"), first], LIMITS)).toEqual([]);
  });

  it("limits probation by job category, counting both the first and the last day", () => {
    const probation = (endDate: string, jobCategory: ContractDraft["jobCategory"]) => draft({ type: "probation", startDate: "2026-03-01", endDate, jobCategory });
    expect(checkContract(probation("2026-04-29", "professional"), [], LIMITS)).toEqual([]); // 60 days
    expect(checkContract(probation("2026-04-30", "professional"), [], LIMITS)).toEqual(["contract_probation_too_long"]);
    expect(checkContract(probation("2026-03-30", "intermediate"), [], LIMITS)).toEqual([]); // 30 days
    expect(checkContract(probation("2026-03-31", "intermediate"), [], LIMITS)).toEqual(["contract_probation_too_long"]);
    expect(checkContract(probation("2026-03-06", "other"), [], LIMITS)).toEqual([]); // 6 days
    expect(checkContract(probation("2026-03-07", "other"), [], LIMITS)).toEqual(["contract_probation_too_long"]);
    expect(checkContract(probation("2026-08-27", "manager"), [], LIMITS)).toEqual([]); // 180 days
    expect(checkContract(probation("2026-08-28", "manager"), [], LIMITS)).toEqual(["contract_probation_too_long"]);
    expect(checkContract(probation("2026-03-30", null), [], LIMITS)).toEqual(["contract_job_category_required"]);
  });

  it("allows one probation per employment", () => {
    const again = draft({ type: "probation", startDate: "2026-03-01", endDate: "2026-03-30", jobCategory: "professional" });
    expect(checkContract(again, [past("p", "probation", "2025-01-01", "2025-02-28")], LIMITS)).toEqual(["contract_probation_repeated"]);
  });

  it("keeps labour contracts from overlapping, but lets an NDA or a terminated contract sit alongside", () => {
    expect(checkContract(draft({}), [past("a", "indefinite", "2020-01-01", null)], LIMITS)).toEqual(["contract_overlap"]);
    expect(checkContract(draft({}), [past("a", "indefinite", "2020-01-01", null, "2025-12-31")], LIMITS)).toEqual([]);
    expect(checkContract(draft({}), [past("a", "probation", "2025-11-01", "2026-01-01")], LIMITS)).toEqual(["contract_overlap"]);
    expect(checkContract(draft({}), [past("a", "nda", "2020-01-01", null)], LIMITS)).toEqual([]);
  });

  it("ties an appendix to a contract of the same employment", () => {
    const parent = past("a", "indefinite", "2020-01-01", null);
    expect(checkContract(draft({ type: "appendix", endDate: null }), [parent], LIMITS)).toEqual(["contract_appendix_needs_parent"]);
    expect(checkContract(draft({ type: "appendix", endDate: null, parentContractId: "zzz" }), [parent], LIMITS)).toEqual(["contract_parent_not_found"]);
    expect(checkContract(draft({ type: "appendix", endDate: null, parentContractId: "a" }), [parent], LIMITS)).toEqual([]);
  });
});
