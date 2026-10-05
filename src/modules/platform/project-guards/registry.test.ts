import { describe, expect, it } from "vitest";
import { checkProjectStatusChange, checkProjectWork, registeredProjectGuards, registerProjectStatusGuard, registerProjectWorkGuard } from "./registry";

const change = { projectId: "p1", from: "planned", to: "active", restoring: false };

describe("project guards", () => {
  it("let a status change through as asked when no guard objects, inside the changing transaction", async () => {
    const seen: string[] = [];
    const tx = { name: "the transaction" };
    registerProjectStatusGuard("test.silent", async () => async (executor, asked) => {
      seen.push(`${asked.projectId}:${asked.from}>${asked.to}:${executor === tx}`);
      return null;
    });
    expect(await checkProjectStatusChange(tx, change)).toEqual({ refusal: null, to: "active" });
    expect(seen).toEqual(["p1:planned>active:true"]);
  });

  it("stop at the first refusal, in the order the guards were registered", async () => {
    const seen: string[] = [];
    registerProjectStatusGuard("test.refuses", async () => async (_tx, asked) => (asked.projectId === "gated" ? { refusal: { reason: "project_needs_kickoff", details: { projectId: asked.projectId } } } : null));
    registerProjectStatusGuard("test.after", async () => async (_tx, asked) => {
      seen.push(asked.projectId);
      return null;
    });
    expect(await checkProjectStatusChange(null, { ...change, projectId: "gated" })).toEqual({ refusal: { reason: "project_needs_kickoff", details: { projectId: "gated" } }, to: "active" });
    expect(seen).toEqual([]);
    expect((await checkProjectStatusChange(null, change)).refusal).toBeNull();
    expect(seen).toEqual(["p1"]);
  });

  it("let a guard name where a project returns to from the archive — and only then", async () => {
    const asked: string[] = [];
    registerProjectStatusGuard("test.redirects", async () => async (_tx, move) => (move.projectId === "closed" ? { to: "done" } : null));
    registerProjectStatusGuard("test.sees", async () => async (_tx, move) => {
      asked.push(`${move.projectId}:${move.to}`);
      return null;
    });
    expect(await checkProjectStatusChange(null, { projectId: "closed", from: "archived", to: "active", restoring: true })).toEqual({ refusal: null, to: "done" });
    // A plain update is refused or let through; it is never quietly turned into another status.
    expect(await checkProjectStatusChange(null, { projectId: "closed", from: "archived", to: "active", restoring: false })).toEqual({ refusal: null, to: "active" });
    // The guards after it are asked about the category the project will really take.
    expect(asked.filter((entry) => entry.startsWith("closed:"))).toEqual(["closed:done", "closed:active"]);
  });

  it("keep one guard per name, load it only when asked, and refuse work the first guard refuses", async () => {
    let loads = 0;
    registerProjectWorkGuard("test.closed", async () => async () => ({ reason: "old" }));
    registerProjectWorkGuard("test.closed", async () => {
      loads += 1;
      return async (_tx, work) => (work.projectId === "closed" ? { reason: "project_closed", details: { action: work.action } } : null);
    });
    expect(registeredProjectGuards().work.filter((name) => name === "test.closed")).toHaveLength(1);
    expect(loads).toBe(0);
    expect(await checkProjectWork(null, { projectId: "open", action: "task_create" })).toBeNull();
    expect(await checkProjectWork(null, { projectId: "closed", action: "time_entry" })).toEqual({ reason: "project_closed", details: { action: "time_entry" } });
    expect(loads).toBe(2);
  });
});
