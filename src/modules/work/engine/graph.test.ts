import { describe, expect, it } from "vitest";
import { rankBetween, wouldCreateDependencyCycle, wouldCreateParentCycle } from "./graph";

const edge = (blockerTaskId: string, blockedTaskId: string) => ({ blockerTaskId, blockedTaskId });

describe("dependency cycles", () => {
  const edges = [edge("script", "shoot"), edge("shoot", "edit"), edge("edit", "publish"), edge("brief", "script")];
  it("accepts an edge that points forward", () => {
    expect(wouldCreateDependencyCycle(edges, "brief", "publish")).toBe(false);
    expect(wouldCreateDependencyCycle(edges, "music", "edit")).toBe(false);
  });
  it("refuses an edge that points back into its own past, however long the chain", () => {
    expect(wouldCreateDependencyCycle(edges, "publish", "brief")).toBe(true);
    expect(wouldCreateDependencyCycle(edges, "edit", "shoot")).toBe(true);
  });
  it("refuses a task blocking itself", () => {
    expect(wouldCreateDependencyCycle([], "a", "a")).toBe(true);
  });
  it("terminates on data that already holds a loop", () => {
    expect(wouldCreateDependencyCycle([edge("a", "b"), edge("b", "a")], "c", "a")).toBe(false);
  });
});

describe("sub-task tree", () => {
  const parentOf = new Map<string, string | null>([["campaign", null], ["video", "campaign"], ["cut", "video"]]);
  it("lets a task move under an unrelated task", () => {
    expect(wouldCreateParentCycle(parentOf, "cut", "campaign")).toBe(false);
  });
  it("refuses a task under itself or under its own descendant", () => {
    expect(wouldCreateParentCycle(parentOf, "video", "video")).toBe(true);
    expect(wouldCreateParentCycle(parentOf, "campaign", "cut")).toBe(true);
  });
});

describe("rankBetween", () => {
  it("places a card at either end or between two neighbours", () => {
    expect(rankBetween(null, null)).toBe(1000);
    expect(rankBetween(null, 1000)).toBe(0);
    expect(rankBetween(3000, null)).toBe(4000);
    expect(rankBetween(1000, 2000)).toBe(1500);
  });
});
