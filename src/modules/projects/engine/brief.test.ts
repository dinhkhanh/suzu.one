import { describe, expect, it } from "vitest";
import { briefContactsEditable, briefEditable, briefProblems, briefSubmittable, isClientWork, withOpenFields } from "./brief";

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
  it("keeps only the contacts and links of an approved brief editable, and nothing of what was agreed", () => {
    expect(["draft", "submitted", "approved", "returned"].map((status) => briefContactsEditable(status as never))).toEqual([false, false, true, false]);
    const approved = { objective: "Ra mắt", scopeIn: "3 video", successCriteria: "Hai vòng duyệt", clientContacts: [{ name: "Anh Nam" }], links: ["https://drive.google.com/a"] };
    const next = withOpenFields(approved, { clientContacts: [{ name: "Chị Mai", role: "Brand manager" }], links: [] });
    expect(next).toEqual({ objective: "Ra mắt", scopeIn: "3 video", successCriteria: "Hai vòng duyệt", clientContacts: [{ name: "Chị Mai", role: "Brand manager" }] });
    // Whatever else is handed in with them is not taken: the agreed text is the stored one.
    expect(withOpenFields(approved, { clientContacts: [], links: ["https://drive.google.com/b"], objective: "Khác" } as never)).toEqual({
      objective: "Ra mắt",
      scopeIn: "3 video",
      successCriteria: "Hai vòng duyệt",
      links: ["https://drive.google.com/b"],
    });
  });
  it("tells work done for a client under contract from work that answers to no client", () => {
    expect(["client", "retainer", "pitch", "internal", null, undefined].map((kind) => isClientWork(kind))).toEqual([true, true, false, false, false, false]);
  });
});
