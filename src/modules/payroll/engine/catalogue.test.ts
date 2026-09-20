import { describe, expect, it } from "vitest";
import { checkComponentDraft, type ComponentDraft, pickCatalogue } from "./catalogue";

const row = (id: string, code: string, entityId: string | null, validFrom: string, validTo: string | null = null, status = "approved", sortOrder = 100) => ({ id, code, entityId, validFrom, validTo, status, sortOrder });

describe("pickCatalogue", () => {
  const rows = [
    row("g-base", "BASE", null, "2026-01-01", null, "approved", 10),
    row("g-meal-old", "MEAL", null, "2026-01-01", "2026-06-30", "approved", 20),
    row("g-meal", "MEAL", null, "2026-07-01", null, "approved", 20),
    row("szm-meal", "MEAL", "szm", "2026-08-01", null, "approved", 20),
    row("szc-phone", "PHONE", "szc", "2026-01-01", null, "approved", 30),
    row("g-draft", "BONUS", null, "2026-01-01", null, "proposed", 40),
  ];

  it("takes approved versions in force, the entity's own over the group's", () => {
    expect(pickCatalogue(rows, "szm", "2026-08-31").map((r) => r.id)).toEqual(["g-base", "szm-meal"]);
    expect(pickCatalogue(rows, "szm", "2026-07-31").map((r) => r.id)).toEqual(["g-base", "g-meal"]);
    expect(pickCatalogue(rows, "szc", "2026-06-30").map((r) => r.id)).toEqual(["g-base", "g-meal-old", "szc-phone"]);
    expect(pickCatalogue(rows, null, "2026-08-31").map((r) => r.id)).toEqual(["g-base", "g-meal"]);
    expect(pickCatalogue(rows, "szm", "2025-12-31")).toEqual([]);
  });
});

describe("checkComponentDraft", () => {
  const draft = (changes: Partial<ComponentDraft>): ComponentDraft => ({ code: "RESP", source: "formula", formula: "pct(base_salary, 1000)", taxTreatment: "taxable", exemptCap: null, roundingRule: "half_up", ...changes });

  it("accepts a formula over known variables and other components", () => {
    expect(checkComponentDraft(draft({}), ["BASE"])).toBeNull();
    expect(checkComponentDraft(draft({ formula: "c_meal + pct(base_salary, 500)" }), ["MEAL"])).toBeNull();
  });

  it("refuses what cannot be computed", () => {
    expect(checkComponentDraft(draft({ formula: null }), [])?.code).toBe("formula_required");
    expect(checkComponentDraft(draft({ source: "structure" }), [])?.code).toBe("formula_not_allowed");
    expect(checkComponentDraft(draft({ formula: "c_resp * 2" }), ["RESP", "MEAL"])?.code).toBe("formula_reads_itself");
    const invalid = checkComponentDraft(draft({ formula: "salary * 2" }), []);
    expect(invalid?.code).toBe("formula_invalid");
    expect(invalid?.formulaError?.code).toBe("unknown_variable");
    expect(checkComponentDraft(draft({ formula: "base_salary / 2" }), [])?.formulaError?.code).toBe("division_operator");
    expect(checkComponentDraft(draft({ roundingRule: "constructor" }), [])?.code).toBe("rounding_rule_unknown");
    expect(checkComponentDraft(draft({ taxTreatment: "exempt_up_to_cap" }), [])?.code).toBe("cap_required");
    expect(checkComponentDraft(draft({ exemptCap: 730_000 }), [])?.code).toBe("cap_not_allowed");
  });
});
