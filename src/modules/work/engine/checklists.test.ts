import { describe, expect, it } from "vitest";
import type { TaskChecklistItem } from "../schema";
import { appendChecklists, checklistProblem, gateApplies, gatedStages, partlyRemoved, libraryCheckId, mergeChecklistPatch, missingRequired, normalizeItems, packageChecks, removedFrom, resolveLinked } from "./checklists";

const counter = () => {
  let next = 0;
  return () => `n${++next}`;
};
const brief = {
  id: "11111111-2222-3333-4444-555555555555",
  name: "Nhận brief",
  isActive: true,
  items: [
    { id: "i_a", text: "Đủ deadline" },
    { id: "i_b", text: "Có brand guideline", linkUrl: "/kb/pages/brand" },
  ],
};
const handoff = { id: "99999999-2222-3333-4444-555555555555", name: "Trước bàn giao", isActive: true, items: [{ id: "i_c", text: "Đã xuất file gốc" }] };

describe("normalizeItems", () => {
  it("keeps valid ids, gives new ones, trims, drops blanks and empty links", () => {
    expect(normalizeItems([{ id: "i_a", text: " Đủ deadline " }, { id: "BAD ID", text: "Có logo", linkUrl: " " }, { text: "   " }, { text: "Link", linkUrl: " https://drive.google.com/x " }], counter())).toEqual([
      { id: "i_a", text: "Đủ deadline" },
      { id: "i_n1", text: "Có logo" },
      { id: "i_n2", text: "Link", linkUrl: "https://drive.google.com/x" },
    ]);
  });
});

describe("checklistProblem", () => {
  it("accepts a named list of items", () => {
    expect(checklistProblem(brief)).toBeNull();
  });
  it("names what is wrong", () => {
    expect(checklistProblem({ name: " ", items: brief.items })).toBe("checklist_name_required");
    expect(checklistProblem({ name: "X", items: [] })).toBe("checklist_empty");
    expect(checklistProblem({ name: "X", items: Array.from({ length: 41 }, (_, index) => ({ id: `i_${index}`, text: "x" })) })).toBe("checklist_too_many");
    expect(checklistProblem({ name: "X", items: [{ id: "i_a", text: "x".repeat(201) }] })).toBe("checklist_item_text");
    expect(checklistProblem({ name: "X", items: [{ id: "i_a", text: "x", linkUrl: "javascript:alert(1)" }] })).toBe("checklist_item_link");
    expect(checklistProblem({ name: "X", items: [{ id: "i_a", text: "x", linkUrl: "//evil.example" }] })).toBe("checklist_item_link");
    expect(
      checklistProblem({
        name: "X",
        items: [
          { id: "i_a", text: "x" },
          { id: "i_a", text: "y" },
        ],
      }),
    ).toBe("checklist_item_duplicate");
  });
});

describe("resolveLinked", () => {
  it("keeps the order asked, each once, and leaves out unknown, retired and empty checklists", () => {
    const retired = { ...handoff, id: "r", isActive: false };
    const empty = { ...handoff, id: "e", items: [] };
    expect(resolveLinked([handoff.id, "missing", brief.id, handoff.id, "r", "e"], [brief, handoff, retired, empty]).map((list) => list.id)).toEqual([handoff.id, brief.id]);
  });
});

describe("appendChecklists", () => {
  it("copies the items with their origin, once per checklist", () => {
    const own: TaskChecklistItem[] = [{ id: "x", text: "Việc riêng", done: true }];
    const first = appendChecklists(own, [brief, brief], counter());
    expect(first.added).toEqual([{ id: brief.id, name: "Nhận brief" }]);
    expect(first.items).toEqual([
      { id: "x", text: "Việc riêng", done: true },
      { id: "n1", text: "Đủ deadline", done: false, checklistId: brief.id, checklistName: "Nhận brief" },
      { id: "n2", text: "Có brand guideline", done: false, checklistId: brief.id, checklistName: "Nhận brief", linkUrl: "/kb/pages/brand" },
    ]);
    // Entering the stage again (sent back, then forward) does not add the brief a second time.
    const again = appendChecklists(first.items, [brief, handoff], counter());
    expect(again.added).toEqual([{ id: handoff.id, name: "Trước bàn giao" }]);
    expect(again.items).toHaveLength(4);
  });
});

describe("mergeChecklistPatch", () => {
  const stored: TaskChecklistItem[] = [
    { id: "x", text: "Việc riêng", done: false },
    { id: "n1", text: "Đủ deadline", done: false, checklistId: brief.id, checklistName: "Nhận brief" },
  ];
  it("changes a copied box's tick only, whatever else is sent", () => {
    expect(
      mergeChecklistPatch(stored, [
        { id: "x", text: "Việc riêng (sửa)", done: true },
        { id: "n1", text: "Không cần deadline", done: true },
      ]),
    ).toEqual([
      { id: "x", text: "Việc riêng (sửa)", done: true },
      { id: "n1", text: "Đủ deadline", done: true, checklistId: brief.id, checklistName: "Nhận brief" },
    ]);
  });
  it("never takes an origin from what is sent", () => {
    const forged = { id: "new", text: "Giả mạo", done: true, checklistId: handoff.id, checklistName: "Trước bàn giao" } as { id: string; text: string; done: boolean };
    expect(mergeChecklistPatch(stored, [forged])).toEqual([{ id: "new", text: "Giả mạo", done: true }]);
  });
  it("reports the copied boxes of the given checklists that a patch takes away", () => {
    const next = mergeChecklistPatch(stored, [{ id: "x", text: "Việc riêng", done: false }]);
    expect(removedFrom(stored, next, new Set([brief.id])).map((item) => item.id)).toEqual(["n1"]);
    expect(removedFrom(stored, next, new Set([handoff.id]))).toEqual([]);
  });
});

describe("missingRequired", () => {
  it("lists the unticked boxes of each required checklist, and every item of one the task does not carry", () => {
    const items: TaskChecklistItem[] = [
      { id: "n1", text: "Đủ deadline", done: true, checklistId: brief.id, checklistName: "Nhận brief" },
      { id: "n2", text: "Có brand guideline", done: false, checklistId: brief.id, checklistName: "Nhận brief" },
    ];
    expect(missingRequired(items, [brief, handoff])).toEqual([
      { checklistId: brief.id, checklistName: "Nhận brief", text: "Có brand guideline" },
      { checklistId: handoff.id, checklistName: "Trước bàn giao", text: "Đã xuất file gốc" },
    ]);
    expect(
      missingRequired(
        items.map((item) => ({ ...item, done: true })),
        [brief],
      ),
    ).toEqual([]);
  });
  it("asks for the boxes as copied, not as the checklist reads today", () => {
    const copied: TaskChecklistItem[] = [{ id: "n1", text: "Bản cũ", done: false, checklistId: brief.id, checklistName: "Nhận brief (cũ)" }];
    expect(missingRequired(copied, [brief])).toEqual([{ checklistId: brief.id, checklistName: "Nhận brief (cũ)", text: "Bản cũ" }]);
  });
});

describe("gateApplies", () => {
  const brief = { sortOrder: 20, category: "todo" };
  it("holds a move forward, and one sideways to a stage at the same place", () => {
    expect(gateApplies(brief, { sortOrder: 30, category: "in_progress" })).toBe(true);
    expect(gateApplies(brief, { sortOrder: 20, category: "in_progress" })).toBe(true);
  });
  it("lets the task go back or be cancelled", () => {
    expect(gateApplies(brief, { sortOrder: 10, category: "backlog" })).toBe(false);
    expect(gateApplies(brief, { sortOrder: 90, category: "cancelled" })).toBe(false);
  });
});

describe("gatedStages", () => {
  const stages = [
    { id: "backlog", sortOrder: 10, category: "backlog" },
    { id: "brief", sortOrder: 20, category: "in_progress" },
    { id: "script", sortOrder: 30, category: "in_progress" },
    { id: "done", sortOrder: 40, category: "done" },
    { id: "cancelled", sortOrder: 90, category: "cancelled" },
  ];
  const at = (id: string) => stages.find((stage) => stage.id === id)!;

  it("holds a move forward to the stage it leaves and every one it passes over", () => {
    expect(gatedStages(at("brief"), at("script"), stages)).toEqual(["brief"]);
    expect(gatedStages(at("backlog"), at("done"), stages)).toEqual(["backlog", "brief", "script"]);
  });

  it("lets a move back or a cancellation go, and makes a task leaving 'cancelled' start from the top", () => {
    expect(gatedStages(at("script"), at("backlog"), stages)).toEqual([]);
    expect(gatedStages(at("script"), at("cancelled"), stages)).toEqual([]);
    expect(gatedStages(at("cancelled"), at("script"), stages)).toEqual(["backlog", "brief"]);
  });
});

describe("partlyRemoved", () => {
  const item = (id: string, checklistId?: string): TaskChecklistItem => ({ id, text: id, done: false, ...(checklistId ? { checklistId, checklistName: checklistId } : {}) });
  const stored = [item("a1", "A"), item("a2", "A"), item("own")];

  it("refuses dropping one box of a checklist while the rest stays, not dropping all of it or one's own", () => {
    expect(partlyRemoved(stored, [item("a2", "A"), item("own")]).map((row) => row.id)).toEqual(["a1"]);
    expect(partlyRemoved(stored, [item("own")])).toEqual([]);
    expect(partlyRemoved(stored, [item("a1", "A"), item("a2", "A")])).toEqual([]);
  });
});

describe("package checks", () => {
  it("follows the package's own checks with the library's, under stable short ids", () => {
    expect(libraryCheckId(brief.id, "i_a")).toBe("l_111111112222_i_a");
    expect(packageChecks([{ id: "c_1", text: "Đã chốt tone màu" }], [brief])).toEqual([
      { id: "c_1", text: "Đã chốt tone màu" },
      { id: "l_111111112222_i_a", text: "Đủ deadline" },
      { id: "l_111111112222_i_b", text: "Có brand guideline" },
    ]);
  });
});
