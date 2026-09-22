import { describe, expect, it } from "vitest";
import { matchTriageRules, ruleMatches, triageRuleProblem } from "./triage";

const arrival = { source: "intake", intakeFormId: "form-video", title: "Clip chúc mừng 20/10", description: "Quay dựng video ngắn cho Facebook" };
const rule = (id: string, match: object, set: object, sortOrder = 0) => ({ id, match, set, sortOrder, isActive: true });

describe("triage rules", () => {
  it("must set something and name a known source", () => {
    expect(triageRuleProblem({ match: {}, set: {} })).toBe("triage_rule_sets_nothing");
    expect(triageRuleProblem({ match: { source: "email" }, set: { priority: 2 } })).toBe("triage_rule_source_invalid");
    expect(triageRuleProblem({ match: { keyword: "video" }, set: { labelIds: ["video"] } })).toBeNull();
  });
  it("match on every condition they name; keywords ignore accents and allow alternatives", () => {
    expect(ruleMatches({}, arrival)).toBe(true);
    expect(ruleMatches({ source: "handoff" }, arrival)).toBe(false);
    expect(ruleMatches({ source: "intake", intakeFormId: "form-video" }, arrival)).toBe(true);
    expect(ruleMatches({ intakeFormId: "form-design" }, arrival)).toBe(false);
    expect(ruleMatches({ keyword: "chuc mung" }, arrival)).toBe(true);
    expect(ruleMatches({ keyword: "tiktok, facebook" }, arrival)).toBe(true);
    expect(ruleMatches({ keyword: "tiktok, poster" }, arrival)).toBe(false);
  });
  it("first matching rule wins each attribute, labels add up, inactive rules sleep", () => {
    const rules = [
      rule("catch-all", {}, { priority: 3, labelIds: ["request"] }, 90),
      rule("video-form", { intakeFormId: "form-video" }, { assigneePersonId: "huy", projectId: "noi-bo", labelIds: ["video"] }, 10),
      rule("facebook", { keyword: "facebook" }, { assigneePersonId: "tam", priority: 2, labelIds: ["video", "facebook"] }, 20),
      { ...rule("off", {}, { assigneePersonId: "long" }, 0), isActive: false },
      rule("handoff", { source: "handoff" }, { priority: 1 }, 0),
    ];
    expect(matchTriageRules(rules, arrival)).toEqual({ set: { assigneePersonId: "huy", projectId: "noi-bo", priority: 2, labelIds: ["video", "facebook", "request"] }, ruleIds: ["video-form", "facebook", "catch-all"] });
    expect(matchTriageRules(rules, { ...arrival, source: "handoff", intakeFormId: null, description: null, title: "Poster" })).toEqual({ set: { priority: 1, labelIds: ["request"] }, ruleIds: ["handoff", "catch-all"] });
    expect(matchTriageRules([], arrival)).toEqual({ set: {}, ruleIds: [] });
  });
});
