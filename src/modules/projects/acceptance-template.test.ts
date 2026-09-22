// The acceptance template (biên bản nghiệm thu, FR-PJM-55) is seeded straight into the database,
// past the documents module's checks. These tests hold it to the same rule an administrator's edit
// on Admin → Document templates meets: every placeholder it names is in the catalogue, and none of
// them lifts it above public_internal — the acceptance record counts units, never money.
import { describe, expect, it } from "vitest";
import { findPlaceholder, placeholdersIn, requiredTier, templateProblems, unknownPlaceholders } from "../documents/engine/template";
import { ACCEPTANCE_TEMPLATE_BODY } from "./seed";

describe("the acceptance template against the placeholder catalogue", () => {
  it("names only placeholders the catalogue knows", () => {
    expect(unknownPlaceholders(ACCEPTANCE_TEMPLATE_BODY)).toEqual([]);
  });

  it("can be saved as it was seeded: a public_internal document", () => {
    expect(templateProblems({ name: "Biên bản nghiệm thu", body: ACCEPTANCE_TEMPLATE_BODY, tier: "public_internal" })).toEqual([]);
    expect(requiredTier(placeholdersIn(ACCEPTANCE_TEMPLATE_BODY))).toBe("public_internal");
  });

  it("lists the project, client and acceptance facts at public_internal", () => {
    for (const key of ["project.name", "project.jobNumber", "client.name", "acceptance.scope", "acceptance.items", "acceptance.totals"]) {
      expect(findPlaceholder(key)?.tier, key).toBe("public_internal");
      expect(findPlaceholder(key)?.group, key).toBe("project");
    }
  });

  it("still refuses an unknown project fact", () => {
    expect(templateProblems({ name: "x", body: "{{project.feeVnd}}", tier: "compensation" })).toContain("template_unknown_placeholder");
  });
});
