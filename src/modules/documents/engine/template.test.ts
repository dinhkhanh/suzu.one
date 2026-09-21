import { describe, expect, it } from "vitest";
import { atLeast, findPlaceholder, MAX_BODY_LENGTH, placeholdersIn, PLACEHOLDERS, renderTemplate, requiredTier, templateProblems, unknownPlaceholders } from "./template";

const draft = (over: Partial<Parameters<typeof templateProblems>[0]> = {}) => ({ name: "Giấy xác nhận công tác", body: "Xác nhận {{person.fullName}} đang làm việc tại {{company.name}}.", tier: "personal" as const, ...over });

describe("the placeholder catalogue", () => {
  it("has no duplicate keys", () => {
    expect(new Set(PLACEHOLDERS.map((p) => p.key)).size).toBe(PLACEHOLDERS.length);
  });

  it("puts every money placeholder at the compensation tier and nothing else there", () => {
    const money = PLACEHOLDERS.filter((p) => p.key.startsWith("salary."));
    expect(money.length).toBeGreaterThan(0);
    expect(money.every((p) => p.tier === "compensation")).toBe(true);
    // The whole compensation tier, named one key at a time on purpose: adding a placeholder here
    // is a decision about what a `personal` letter can never print, so it has to be deliberate.
    // `offer.probationSalary` is an offer letter's probation pay (FR-REC-08) — a figure like the rest.
    expect(PLACEHOLDERS.filter((p) => p.tier === "compensation").map((p) => p.key).sort()).toEqual(
      ["offer.probationSalary", "salary.allowances", "salary.base", "salary.effectiveFrom", "salary.insurance", "salary.total", "salary.totalInWords"].sort(),
    );
  });

  it("keeps the rest of an offer letter below the money", () => {
    // How long probation lasts and when the offer lapses are dates and counts, not amounts: a
    // recruiter's personal-tier wording may say them.
    expect(findPlaceholder("offer.probationMonths")?.tier).toBe("personal");
    expect(findPlaceholder("offer.expiryDate")?.tier).toBe("personal");
  });

  it("keeps a name and a job title at the personal tier, and a date of birth above it", () => {
    expect(findPlaceholder("person.fullName")?.tier).toBe("personal");
    expect(findPlaceholder("person.position")?.tier).toBe("personal");
    expect(findPlaceholder("person.dateOfBirth")?.tier).toBe("restricted");
    expect(findPlaceholder("company.name")?.tier).toBe("public_internal");
  });
});

describe("reading a body", () => {
  it("finds the placeholders, without duplicates, and tolerates spaces inside the braces", () => {
    expect(placeholdersIn("{{person.fullName}} và {{ person.fullName }} tại {{company.name}}")).toEqual(["person.fullName", "company.name"]);
  });

  it("ignores anything that is not a plain dotted name — nothing resembling an expression parses", () => {
    expect(placeholdersIn("{{ person.fullName() }} {{1+1}} {{a['b']}} {{__proto__}} {{ }}")).toEqual([]);
  });

  it("names the placeholders the catalogue does not know", () => {
    expect(unknownPlaceholders("{{person.fullName}} {{person.shoeSize}}")).toEqual(["person.shoeSize"]);
  });

  it("reports the highest tier the body needs", () => {
    expect(requiredTier(["company.name"])).toBe("public_internal");
    expect(requiredTier(["company.name", "person.fullName"])).toBe("personal");
    expect(requiredTier(["person.fullName", "person.dateOfBirth"])).toBe("restricted");
    expect(requiredTier(["person.fullName", "salary.total"])).toBe("compensation");
    // An unknown key contributes nothing; `templateProblems` refuses it separately.
    expect(requiredTier(["nonsense"])).toBe("public_internal");
  });
});

describe("what may be saved", () => {
  it("accepts an ordinary letter", () => {
    expect(templateProblems(draft())).toEqual([]);
  });

  it("refuses an empty name or body, and one that is far too long", () => {
    expect(templateProblems(draft({ name: "  " }))).toContain("template_name_empty");
    expect(templateProblems(draft({ body: "   " }))).toContain("template_body_empty");
    expect(templateProblems(draft({ body: "x".repeat(MAX_BODY_LENGTH + 1) }))).toContain("template_body_too_long");
  });

  it("refuses a placeholder nobody can fill", () => {
    expect(templateProblems(draft({ body: "Xin chào {{person.favouriteColour}}" }))).toContain("template_unknown_placeholder");
  });

  // The rule this module exists to enforce.
  it("REFUSES a template that names a salary at a tier below compensation", () => {
    const leaky = draft({ body: "Xác nhận {{person.fullName}} có mức lương {{salary.total}} đồng.", tier: "personal" });
    expect(templateProblems(leaky)).toContain("template_tier_too_low");
    expect(templateProblems({ ...leaky, tier: "restricted" })).toContain("template_tier_too_low");
    // At the compensation tier it is a perfectly good salary-confirmation letter.
    expect(templateProblems({ ...leaky, tier: "compensation" })).toEqual([]);
  });

  it("refuses a date of birth on a public template, and allows it at restricted", () => {
    const body = "{{person.fullName}}, sinh ngày {{person.dateOfBirth}}";
    expect(templateProblems(draft({ body, tier: "public_internal" }))).toContain("template_tier_too_low");
    expect(templateProblems(draft({ body, tier: "personal" }))).toContain("template_tier_too_low");
    expect(templateProblems(draft({ body, tier: "restricted" }))).toEqual([]);
  });

  it("lets a template sit above the tier it needs — stricter is always allowed", () => {
    expect(templateProblems(draft({ tier: "compensation" }))).toEqual([]);
  });
});

describe("rendering", () => {
  it("fills the holes", () => {
    const { text, missing } = renderTemplate("Xác nhận {{person.fullName}} tại {{company.name}}.", { "person.fullName": "Hồ Gia Huy", "company.name": "SuZu Media" });
    expect(text).toBe("Xác nhận Hồ Gia Huy tại SuZu Media.");
    expect(missing).toEqual([]);
  });

  it("leaves a VISIBLE marker where a value is missing, and says which", () => {
    const { text, missing } = renderTemplate("Lương: {{salary.total}} đồng", {});
    // Nobody signs a contract with an invisible gap where the figure should be.
    expect(text).toBe("Lương: [salary.total] đồng");
    expect(missing).toEqual(["salary.total"]);
  });

  it("treats an empty string as missing too", () => {
    expect(renderTemplate("{{person.position}}", { "person.position": "" }).missing).toEqual(["person.position"]);
  });

  it("substitutes a value literally — a value that looks like a placeholder is not re-expanded", () => {
    const { text } = renderTemplate("{{person.fullName}}", { "person.fullName": "{{salary.total}}" });
    expect(text).toBe("{{salary.total}}");
  });

  it("does not reach into the prototype chain for a value", () => {
    const { text, missing } = renderTemplate("{{toString}} {{constructor}}", {});
    // Neither is a catalogue key, and neither resolves to anything from Object.prototype.
    expect(text).toBe("[toString] [constructor]");
    expect(missing).toEqual(["toString", "constructor"]);
  });
});

describe("atLeast", () => {
  it("orders the tiers", () => {
    expect(atLeast("compensation", "personal")).toBe(true);
    expect(atLeast("personal", "personal")).toBe(true);
    expect(atLeast("personal", "restricted")).toBe(false);
    expect(atLeast("public_internal", "personal")).toBe(false);
  });
});
