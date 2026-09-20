import { describe, expect, it } from "vitest";
import { planTree, roleKeysOf, type TreeItem } from "./templates";

const item = (id: string, dueOffsetDays: number, extra: Partial<TreeItem> = {}): TreeItem => ({ id, parentItemId: null, title: id, description: null, assigneeRule: "none", assigneePersonId: null, dueOffsetDays, sortOrder: 0, estimateMinutes: null, ...extra });
const sunday = (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay() === 0;

const retainer: TreeItem[] = [
  item("plan", 3, { sortOrder: 0, assigneeRule: "role:strategist" }),
  item("posts", 20, { sortOrder: 1, assigneeRule: "role:account" }),
  item("copy", 8, { sortOrder: 0, parentItemId: "posts", assigneeRule: "role:copywriter", estimateMinutes: 480 }),
  item("design", 12, { sortOrder: 1, parentItemId: "posts", assigneeRule: "role:designer" }),
  item("report", 30, { sortOrder: 2, assigneeRule: "role:account" }),
];

describe("roleKeysOf", () => {
  it("lists each role once, in template order", () => {
    expect(roleKeysOf(retainer)).toEqual(["strategist", "account", "copywriter", "designer"]);
  });
});

describe("planTree", () => {
  it("counts from the start date, parents before children, roles turned into people", () => {
    const plan = planTree(retainer, { mode: "start", date: "2026-10-01" }, { strategist: "p-strat", account: "p-acc", designer: null });
    expect(plan.map((node) => [node.templateItemId, node.parentItemId, node.dueDate, node.assigneePersonId, node.depth])).toEqual([
      ["plan", null, "2026-10-04", "p-strat", 0],
      ["posts", null, "2026-10-21", "p-acc", 0],
      ["copy", "posts", "2026-10-09", null, 1],
      ["design", "posts", "2026-10-13", null, 1],
      ["report", null, "2026-10-31", "p-acc", 0],
    ]);
    expect(plan[2]).toMatchObject({ roleKey: "copywriter", estimateMinutes: 480 });
  });
  it("counts back from an end date: the last step lands on it", () => {
    const plan = planTree(retainer, { mode: "end", date: "2026-10-31" }, {});
    expect(plan.map((node) => node.dueDate)).toEqual(["2026-10-04", "2026-10-21", "2026-10-09", "2026-10-13", "2026-10-31"]);
  });
  it("moves off a day off: forward from a start, backward from a deadline", () => {
    // 2026-10-04 is a Sunday.
    expect(planTree([item("a", 3)], { mode: "start", date: "2026-10-01" }, {}, sunday)[0].dueDate).toBe("2026-10-05");
    expect(planTree([item("a", 0), item("b", 27)], { mode: "end", date: "2026-10-31" }, {}, sunday)[0].dueDate).toBe("2026-10-03");
  });
  it("keeps a named person and leaves an unmapped role unassigned", () => {
    const plan = planTree([item("a", 0, { assigneeRule: "person", assigneePersonId: "p1" }), item("b", 0, { sortOrder: 1, assigneeRule: "role:editor" })], { mode: "start", date: "2026-10-01" }, {});
    expect(plan.map((node) => node.assigneePersonId)).toEqual(["p1", null]);
  });
  it("turns an orphan or a loop into top-level tasks instead of losing them", () => {
    const plan = planTree([item("orphan", 1, { parentItemId: "gone" }), item("x", 2, { sortOrder: 1, parentItemId: "y" }), item("y", 3, { sortOrder: 2, parentItemId: "x" })], { mode: "start", date: "2026-10-01" }, {});
    expect(plan.map((node) => node.templateItemId).sort()).toEqual(["orphan", "x", "y"]);
    expect(plan.find((node) => node.templateItemId === "orphan")?.parentItemId).toBeNull();
  });
});
