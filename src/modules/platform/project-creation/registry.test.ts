import { describe, expect, it } from "vitest";
import { registeredProjectCreationHooks, registerProjectCreationHook, runProjectCreationHooks } from "./registry";

describe("project-creation hooks", () => {
  it("run one after another in the creating transaction, in the order they were registered", async () => {
    const seen: string[] = [];
    const tx = { name: "the transaction" };
    registerProjectCreationHook("test.first", async () => async (executor, project) => {
      // Slower than the second, and still finished before it starts: they share one connection.
      await new Promise((resolve) => setTimeout(resolve, 5));
      seen.push(`first:${project.id}:${executor === tx}`);
    });
    registerProjectCreationHook("test.second", async () => async (executor, project) => {
      seen.push(`second:${project.id}:${executor === tx}`);
    });
    await runProjectCreationHooks(tx, { id: "p1" });
    expect(seen).toEqual(["first:p1:true", "second:p1:true"]);
  });
  it("keep one hook per name: registering again replaces it", async () => {
    const seen: string[] = [];
    registerProjectCreationHook("test.replaced", async () => async () => void seen.push("old"));
    registerProjectCreationHook("test.replaced", async () => async () => void seen.push("new"));
    expect(registeredProjectCreationHooks().filter((name) => name === "test.replaced")).toHaveLength(1);
    await runProjectCreationHooks(null, { id: "p2" });
    expect(seen).toEqual(["new"]);
  });
  it("load a hook only when a project is created, and let its refusal reach the creator", async () => {
    let loads = 0;
    registerProjectCreationHook("test.lazy", async () => {
      loads += 1;
      return async (_tx, project) => {
        if (project.id === "refused") throw new Error("no_plan");
      };
    });
    expect(loads).toBe(0);
    await runProjectCreationHooks(null, { id: "p3" });
    expect(loads).toBe(1);
    // The error is the creator's to roll back on: the project is not made without what the hook adds.
    await expect(runProjectCreationHooks(null, { id: "refused" })).rejects.toThrow("no_plan");
  });
});
