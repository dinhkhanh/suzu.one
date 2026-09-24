import { describe, expect, it } from "vitest";
import { matchesReach, type Grant, type Principal } from "../platform/rbac/policy";
import { canOpenFeedbackInbox, canReadFeedback, canTriageFeedback, feedbackReach } from "./policy";
import { areaOfPath } from "./enums";

const A = "entity-a";
const B = "entity-b";
const DESIGN = "unit-design";
const principal = (grants: Grant[], personId = "viewer"): Principal => ({ personId, workforceType: "employee", grants });
const lan = { personId: "lan", entityId: A, unitPath: [DESIGN], managerId: "boss" };
const khoi = { personId: "khoi", entityId: B, unitPath: ["unit-video"], managerId: null };

describe("feedback policy", () => {
  it("lets the sender read their own feedback and nobody's else without a grant", () => {
    expect(canReadFeedback(principal([], "lan"), lan)).toBe(true);
    expect(canReadFeedback(principal([], "khoi"), lan)).toBe(false);
    // A line manager reads their report's personal data, not their feedback about the app.
    expect(canReadFeedback(principal([], "boss"), lan)).toBe(false);
    expect(canOpenFeedbackInbox(principal([]))).toBe(false);
  });

  it("confines triage and reading to the grant's scope", () => {
    const hrA = principal([{ role: "hr_admin", scope: { type: "entity", id: A } }]);
    expect(canTriageFeedback(hrA, lan)).toBe(true);
    expect(canTriageFeedback(hrA, khoi)).toBe(false);
    const ceo = principal([{ role: "c_level", scope: { type: "group" } }]);
    expect(canReadFeedback(ceo, khoi)).toBe(true);
    expect(canTriageFeedback(ceo, khoi)).toBe(false);
    expect(canOpenFeedbackInbox(ceo)).toBe(true);
  });

  it("builds an inbox reach that agrees with canReadFeedback for staff", () => {
    const cases: Grant[][] = [
      [{ role: "hr_admin", scope: { type: "entity", id: A } }],
      [{ role: "entity_director", scope: { type: "entity", id: B } }, { role: "hr_admin", scope: { type: "unit", id: DESIGN } }],
      [{ role: "c_level", scope: { type: "group" } }],
      [{ role: "department_head", scope: { type: "unit", id: DESIGN } }],
    ];
    for (const grants of cases) {
      const who = principal(grants);
      const reach = feedbackReach(who);
      for (const target of [lan, khoi]) expect(matchesReach(reach, target), JSON.stringify(grants)).toBe(canReadFeedback(who, target));
    }
  });
});

describe("areaOfPath", () => {
  it("takes the first segment of an app path", () => {
    expect(areaOfPath("/projects/abc/tasks?x=1")).toBe("projects");
    expect(areaOfPath("/attendance/check-in")).toBe("attendance");
    expect(areaOfPath("/")).toBeNull();
    expect(areaOfPath(null)).toBeNull();
    expect(areaOfPath("/<script>")).toBeNull();
  });
});
