import { describe, expect, it } from "vitest";
import { boardColumns, isSamePlace, planDrop } from "./board";

const cards = [
  { id: "a", stateId: "todo", boardRank: 1000 },
  { id: "b", stateId: "todo", boardRank: 2000 },
  { id: "c", stateId: "todo", boardRank: 3000 },
  { id: "d", stateId: "doing", boardRank: 500 },
];

describe("board", () => {
  it("orders each column by rank and keeps empty columns", () => {
    const columns = boardColumns([...cards].reverse(), ["todo", "doing", "done"]);
    expect(columns.get("todo")?.map((card) => card.id)).toEqual(["a", "b", "c"]);
    expect(columns.get("doing")?.map((card) => card.id)).toEqual(["d"]);
    expect(columns.get("done")).toEqual([]);
  });

  it("ranks a drop between its neighbours", () => {
    const todo = boardColumns(cards, ["todo"]).get("todo")!;
    expect(planDrop(todo, "d", 1)).toEqual({ beforeTaskId: "a", afterTaskId: "b", boardRank: 1500 });
    expect(planDrop(todo, "d", 0)).toEqual({ beforeTaskId: null, afterTaskId: "a", boardRank: 0 });
    expect(planDrop(todo, "d", 99)).toEqual({ beforeTaskId: "c", afterTaskId: null, boardRank: 4000 });
    expect(planDrop([], "d", 0)).toEqual({ beforeTaskId: null, afterTaskId: null, boardRank: 1000 });
  });

  it("ignores the moving card when it is reordered inside its own column", () => {
    const todo = boardColumns(cards, ["todo"]).get("todo")!;
    // "a" dropped at the end: after "c".
    expect(planDrop(todo, "a", 2)).toEqual({ beforeTaskId: "c", afterTaskId: null, boardRank: 4000 });
    expect(isSamePlace(todo, todo[1], "todo", 1)).toBe(true);
    expect(isSamePlace(todo, todo[1], "todo", 2)).toBe(false);
    expect(isSamePlace(todo, todo[1], "doing", 1)).toBe(false);
  });
});
