import { describe, expect, it } from "vitest";
import { briefEditable, briefProblems, briefSubmittable } from "./brief";

describe("the brief and its gate (FR-PJM-03)", () => {
  it("needs an objective and a scope; client work also its success criteria", () => {
    expect(briefProblems({}, "client")).toEqual(["objective", "scopeIn", "successCriteria"]);
    expect(briefProblems({ objective: "Ra mắt", scopeIn: "3 video", successCriteria: " " }, "retainer")).toEqual(["successCriteria"]);
    expect(briefProblems({ objective: "Ra mắt", scopeIn: "3 video" }, "internal")).toEqual([]);
    expect(briefProblems({ objective: "Ra mắt", scopeIn: "3 video" }, "pitch")).toEqual([]);
  });
  it("is edited and submitted while a draft or returned, not while waiting or approved", () => {
    expect(["draft", "submitted", "approved", "returned"].map((status) => briefEditable(status as never))).toEqual([true, false, false, true]);
    expect(["draft", "submitted", "approved", "returned"].map((status) => briefSubmittable(status as never))).toEqual([true, false, false, true]);
  });
});
