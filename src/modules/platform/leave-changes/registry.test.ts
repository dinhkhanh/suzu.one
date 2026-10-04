import { describe, expect, it } from "vitest";
import { registeredLeaveChangeHooks, registerLeaveChangeHook, runLeaveChangeHooks } from "./registry";

describe("leave-change hooks", () => {
  it("run one after another, in the order they were registered, each told whose leave changed", async () => {
    const seen: string[] = [];
    registerLeaveChangeHook("test.first", async () => async ({ personId }) => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      seen.push(`first:${personId}`);
    });
    registerLeaveChangeHook("test.second", async () => async ({ personId }) => void seen.push(`second:${personId}`));
    await runLeaveChangeHooks({ personId: "p1" });
    expect(seen).toEqual(["first:p1", "second:p1"]);
  });

  it("keep one hook per name: registering again replaces it", async () => {
    const seen: string[] = [];
    registerLeaveChangeHook("test.replaced", async () => async () => void seen.push("old"));
    registerLeaveChangeHook("test.replaced", async () => async () => void seen.push("new"));
    expect(registeredLeaveChangeHooks().filter((name) => name === "test.replaced")).toHaveLength(1);
    await runLeaveChangeHooks({ personId: "p2" });
    expect(seen).toEqual(["new"]);
  });

  it("load a hook only when leave changes, and hand its failure to the caller", async () => {
    let loads = 0;
    registerLeaveChangeHook("test.lazy", async () => {
      loads += 1;
      return async ({ personId }) => {
        if (personId === "broken") throw new Error("no_cover");
      };
    });
    expect(loads).toBe(0);
    await runLeaveChangeHooks({ personId: "p3" });
    expect(loads).toBe(1);
    // The leave is already committed: what a failed follow-up is worth is the caller's call.
    await expect(runLeaveChangeHooks({ personId: "broken" })).rejects.toThrow("no_cover");
  });
});
