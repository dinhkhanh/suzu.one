import { describe, expect, it } from "vitest";
import { defaultReceiver, fieldValueValid, keptValues, missingItems, noteIsEmpty, normalizeNote, packageFor, packageProblem, stageOutcome } from "./handoff";

// The Video team's workflow: Script → Design → Edit → Client review.
const pkg = (id: string, fromStateId: string | null, toStateId: string, extra: object = {}) => ({ id, fromStateId, toStateId, fields: [], checklist: [], requireLink: false, requireFile: false, requireAccept: true, isActive: true, ...extra });
const scriptToDesign = pkg("script-design", "script", "design", {
  fields: [
    { key: "version", label: "Bản kịch bản đã duyệt", type: "text", required: true },
    { key: "assets", label: "Link brand assets", type: "url", required: true },
    { key: "deadline", label: "Hạn thiết kế", type: "date", required: true },
    { key: "notes", label: "Ghi chú", type: "text", required: false },
  ],
  checklist: [{ id: "tone", text: "Đã chốt tone màu với khách" }],
});
const anyToReview = pkg("any-review", null, "client_review", { fields: [{ key: "duration", label: "Thời lượng (giây)", type: "number", required: true }], checklist: [{ id: "subs", text: "Đã kiểm tra phụ đề" }], requireLink: true, requireFile: true });
const editToReview = pkg("edit-review", "edit", "client_review", { requireLink: true });
const empty = { values: {}, checked: [], links: [], fileId: null };

describe("which package a move needs (FR-PJM-40)", () => {
  it("a package naming the state left beats one for any state; no package, no gate", () => {
    const packages = [anyToReview, scriptToDesign, editToReview];
    expect(packageFor(packages, "script", "design")?.id).toBe("script-design");
    expect(packageFor(packages, "edit", "client_review")?.id).toBe("edit-review");
    expect(packageFor(packages, "design", "client_review")?.id).toBe("any-review");
    expect(packageFor(packages, "design", "edit")).toBeNull();
    expect(packageFor(packages, "design", "design")).toBeNull();
    expect(packageFor([{ ...scriptToDesign, isActive: false }], "script", "design")).toBeNull();
  });
});

describe("package completeness", () => {
  it("lists every missing item in the sheet's order until all is there", () => {
    expect(missingItems(scriptToDesign, empty)).toEqual([
      { kind: "field", key: "version", label: "Bản kịch bản đã duyệt" },
      { kind: "field", key: "assets", label: "Link brand assets" },
      { kind: "field", key: "deadline", label: "Hạn thiết kế" },
      { kind: "check", id: "tone", text: "Đã chốt tone màu với khách" },
    ]);
    const filled = { values: { version: "v3", assets: "https://drive.google.com/brand", deadline: "2026-10-05" }, checked: ["tone"], links: [], fileId: null };
    expect(missingItems(scriptToDesign, filled)).toEqual([]);
  });
  it("a filled field must read as its type", () => {
    const wrong = { values: { version: "v3", assets: "drive/brand", deadline: "05/10/2026" }, checked: ["tone"], links: [], fileId: null };
    expect(missingItems(scriptToDesign, wrong)).toEqual([
      { kind: "invalid", key: "assets", label: "Link brand assets" },
      { kind: "invalid", key: "deadline", label: "Hạn thiết kế" },
    ]);
    expect(fieldValueValid("date", "2026-02-30")).toBe(false);
    expect(fieldValueValid("number", "45")).toBe(true);
    expect(fieldValueValid("number", "bốn lăm")).toBe(false);
    expect(fieldValueValid("url", "javascript:alert(1)")).toBe(false);
  });
  it("a link may come from the note or a URL field; a file must be attached", () => {
    expect(missingItems(anyToReview, { values: { duration: "30" }, checked: ["subs"], links: [], fileId: null })).toEqual([{ kind: "link" }, { kind: "file" }]);
    expect(missingItems(anyToReview, { values: { duration: "30" }, checked: ["subs"], links: ["https://drive.google.com/export"], fileId: "file-1" })).toEqual([]);
    expect(missingItems({ ...scriptToDesign, requireLink: true }, { values: { version: "v3", assets: "https://drive.google.com/brand", deadline: "2026-10-05" }, checked: ["tone"], links: [], fileId: null })).toEqual([]);
  });
  it("keeps only the answers the package asks for", () => {
    expect(keptValues(scriptToDesign, { version: " v3 ", notes: "", smuggled: "x" })).toEqual({ version: "v3" });
  });
});

describe("package definitions", () => {
  it("refuses a loop, an empty package, blank or repeated labels", () => {
    expect(packageProblem(pkg("x", "edit", "edit"))).toBe("handoff_package_same_state");
    expect(packageProblem(pkg("x", null, "edit", { requireAccept: false }))).toBe("handoff_package_empty");
    expect(packageProblem(pkg("x", null, "edit"))).toBeNull();
    expect(packageProblem(pkg("x", null, "edit", { fields: [{ key: "a", label: " ", type: "text", required: true }] }))).toBe("handoff_package_field_label");
    expect(packageProblem(pkg("x", null, "edit", { fields: [{ key: "a", label: "Link", type: "url", required: true }, { key: "b", label: "link", type: "text", required: false }] }))).toBe("handoff_package_field_duplicate");
    expect(packageProblem(pkg("x", null, "edit", { checklist: [{ id: "a", text: "" }] }))).toBe("handoff_package_check_text");
    expect(packageProblem(scriptToDesign)).toBeNull();
  });
});

describe("the hand-off note (FR-PJM-43)", () => {
  it("is trimmed, keeps web links only, once each", () => {
    expect(normalizeNote({ context: "  Clip 20/10 cho Vinamilk ", done: "", next: "Dựng bản 2", links: ["https://drive.google.com/a", "https://drive.google.com/a", "ftp://x", "javascript:alert(1)"] })).toEqual({ context: "Clip 20/10 cho Vinamilk", next: "Dựng bản 2", links: ["https://drive.google.com/a"] });
    expect(noteIsEmpty({ context: " ", links: ["nope"] })).toBe(true);
    expect(noteIsEmpty({ questions: "Khách có duyệt nhạc chưa?" })).toBe(false);
  });
});

describe("who receives, and whether they must accept (FR-PJM-41)", () => {
  it("the stage's assignee by default, never the sender", () => {
    expect(defaultReceiver("huy", "tam")).toBe("huy");
    expect(defaultReceiver("tam", "tam")).toBeNull();
    expect(defaultReceiver(null, "tam")).toBeNull();
  });
  it("waits for the receiver only when the package asks and someone else receives", () => {
    expect(stageOutcome(true, "huy", "tam")).toBe("pending");
    expect(stageOutcome(true, "tam", "tam")).toBe("recorded");
    expect(stageOutcome(false, "huy", "tam")).toBe("recorded");
    expect(stageOutcome(true, null, "tam")).toBe("recorded");
  });
});
