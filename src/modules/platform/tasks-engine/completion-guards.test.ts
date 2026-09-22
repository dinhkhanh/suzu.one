import { describe, expect, it } from "vitest";
import { checkCompletion, type GuardedTask, registerCompletionGuard, registeredCompletionGuards } from "./completion-guards";

const task = (id: string, contextType: string | null = null): GuardedTask => ({ id, kind: "checklist", contextType, contextId: null, subjectPersonId: null });

describe("completion guards", () => {
  it("let a task close when no guard objects, and the first refusal wins", async () => {
    const seen: string[] = [];
    registerCompletionGuard("test.first", async () => async (_executor, row) => {
      seen.push(`first:${row.id}`);
      return row.id === "held" ? { reason: "held_by_first", details: { count: 2 } } : null;
    });
    registerCompletionGuard("test.second", async () => async (_executor, row) => {
      seen.push(`second:${row.id}`);
      return row.id === "held" || row.id === "second-only" ? { reason: "held_by_second" } : null;
    });
    expect(await checkCompletion(null, task("free"))).toBeNull();
    expect(await checkCompletion(null, task("held"))).toEqual({ reason: "held_by_first", details: { count: 2 } });
    expect(await checkCompletion(null, task("second-only"))).toEqual({ reason: "held_by_second" });
    expect(seen).toEqual(["first:free", "second:free", "first:held", "first:second-only", "second:second-only"]);
  });
  it("keep one guard per name: registering again replaces it", async () => {
    registerCompletionGuard("test.replaced", async () => async () => ({ reason: "old" }));
    registerCompletionGuard("test.replaced", async () => async (_executor, row) => (row.contextType === "x" ? { reason: "new" } : null));
    expect(registeredCompletionGuards().filter((name) => name === "test.replaced")).toHaveLength(1);
    expect(await checkCompletion(null, task("free"))).toBeNull();
    expect(await checkCompletion(null, task("free", "x"))).toEqual({ reason: "new" });
  });
  it("load a guard only when a task is completed", async () => {
    let loads = 0;
    registerCompletionGuard("test.lazy", async () => {
      loads += 1;
      return async () => null;
    });
    expect(loads).toBe(0);
    await checkCompletion(null, task("free"));
    expect(loads).toBe(1);
  });
});
