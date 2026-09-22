import { describe, expect, it } from "vitest";
import { type OwnedItem, ownershipSummary, reassignProblem } from "./exit";

const item = (kind: OwnedItem["kind"], id: string): OwnedItem => ({ kind, id, label: id, context: null });

describe("exit ownership (FR-PJM-45)", () => {
  it("counts what is still held, kind by kind, in the page's order; clear only when nothing is", () => {
    const summary = ownershipSummary([item("team_lead", "VID"), item("task", "VID-12"), item("task", "VID-13"), item("time_week", "2026-09-14"), item("account_manager", "TVC Tết"), item("review", "SOC-4")]);
    expect(summary).toEqual({ total: 6, byKind: { team_lead: 1, task: 2, time_week: 1, account_manager: 1, review: 1 }, clear: false, reassignable: 5, blocking: ["task", "review", "account_manager", "team_lead", "time_week"] });
    expect(ownershipSummary([])).toEqual({ total: 0, byKind: {}, clear: true, reassignable: 0, blocking: [] });
  });
  it("a bulk reassignment names items, someone else, and no time weeks", () => {
    expect(reassignProblem({ leaverId: "lan", toPersonId: "huy", items: [item("task", "a"), item("recurrence", "b")] })).toBeNull();
    expect(reassignProblem({ leaverId: "lan", toPersonId: "lan", items: [item("task", "a")] })).toBe("exit_reassign_to_self");
    expect(reassignProblem({ leaverId: "lan", toPersonId: "huy", items: [] })).toBe("exit_reassign_nothing");
    expect(reassignProblem({ leaverId: "lan", toPersonId: "huy", items: [item("time_week", "w")] })).toBe("exit_reassign_time_week");
  });
});
