import { describe, expect, it } from "vitest";
import { applyDecision, conditionHolds, delegate, type RequestState, type ResolvedStep, resubmit, startFlow, waitingFor } from "./flow";

const step = (key: string, approverIds: string[], mode: "any" | "all" = "any", applies = true): ResolvedStep => ({ key, mode, applies, approverIds });
const decide = (state: RequestState, actorId: string, action: "approve" | "reject" | "return" | "withdraw") => {
  const result = applyDecision(state, { actorId, action });
  if (!result.ok) throw new Error(result.reason);
  return result;
};
const refusal = (state: RequestState, actorId: string, action: "approve" | "reject" | "return" | "withdraw") => {
  const result = applyDecision(state, { actorId, action });
  return result.ok ? "ok" : result.reason;
};

describe("startFlow", () => {
  it("opens the first step and leaves the rest waiting", () => {
    const state = startFlow("huy", [step("hr", ["bao", "mai"]), step("director", ["ha"])]);
    expect(state.status).toBe("pending");
    expect(state.steps.map((s) => s.status)).toEqual(["pending", "waiting"]);
    expect(waitingFor(state)).toEqual(["bao", "mai"]);
  });

  it("never lets the requester approve their own request", () => {
    const state = startFlow("bao", [step("hr", ["bao", "mai", "mai"])]);
    expect(state.steps[0].assignees.map((a) => a.personId)).toEqual(["mai"]);
    expect(() => startFlow("bao", [step("hr", ["bao"])])).toThrow("step_hr_has_no_approver");
  });

  it("skips steps whose condition does not hold, and approves a flow with nothing left to ask", () => {
    const state = startFlow("huy", [step("head", [], "any", false), step("hr", ["mai"])]);
    expect(state.currentStep).toBe(1);
    expect(state.steps.map((s) => s.status)).toEqual(["skipped", "pending"]);
    expect(startFlow("huy", [step("head", [], "any", false)]).status).toBe("approved");
  });
});

describe("applyDecision", () => {
  it("any: the first approval decides a single-step request", () => {
    const result = decide(startFlow("huy", [step("hr", ["bao", "mai"])]), "mai", "approve");
    expect(result.outcome).toBe("approved");
    expect(result.state.steps[0].assignees).toEqual([
      { personId: "bao", status: "pending" },
      { personId: "mai", status: "approved" },
    ]);
    expect(refusal(result.state, "bao", "approve")).toBe("not_pending");
  });

  it("all: everyone must approve, one rejection ends it", () => {
    const start = startFlow("huy", [step("board", ["ha", "khanh"], "all")]);
    const first = decide(start, "ha", "approve");
    expect(first.outcome).toBe("pending");
    expect(waitingFor(first.state)).toEqual(["khanh"]);
    expect(refusal(first.state, "ha", "approve")).toBe("not_assignee");
    expect(decide(first.state, "khanh", "approve").outcome).toBe("approved");
    expect(decide(first.state, "khanh", "reject").outcome).toBe("rejected");
  });

  it("walks through steps in order and tells whose turn it becomes", () => {
    const start = startFlow("huy", [step("manager", ["long"]), step("head", [], "any", false), step("hr", ["bao", "mai"])]);
    expect(refusal(start, "mai", "approve")).toBe("not_assignee");
    const first = decide(start, "long", "approve");
    expect(first.outcome).toBe("pending");
    expect(first.state.currentStep).toBe(2);
    expect(first.nowWaitingFor).toEqual(["bao", "mai"]);
    const second = decide(first.state, "bao", "approve");
    expect(second.outcome).toBe("approved");
    expect(second.state.steps.map((s) => s.status)).toEqual(["approved", "skipped", "approved"]);
  });

  it("refuses strangers, the requester, and anything after the decision", () => {
    const start = startFlow("huy", [step("hr", ["mai"])]);
    expect(refusal(start, "long", "approve")).toBe("not_assignee");
    expect(refusal(start, "huy", "approve")).toBe("own_request");
    const rejected = decide(start, "mai", "reject").state;
    expect(refusal(rejected, "mai", "approve")).toBe("not_pending");
    expect(refusal(rejected, "huy", "withdraw")).toBe("not_pending");
  });

  it("withdraw: only the requester, while pending or returned", () => {
    const start = startFlow("huy", [step("hr", ["mai"])]);
    expect(refusal(start, "mai", "withdraw")).toBe("not_requester");
    expect(decide(start, "huy", "withdraw").outcome).toBe("withdrawn");
    const returned = decide(start, "mai", "return").state;
    expect(decide(returned, "huy", "withdraw").outcome).toBe("withdrawn");
  });

  it("return for changes, then resubmit: the flow starts over", () => {
    const start = startFlow("huy", [step("manager", ["long"]), step("hr", ["mai"])]);
    const atHr = decide(start, "long", "approve").state;
    const returned = decide(atHr, "mai", "return");
    expect(returned.outcome).toBe("returned");
    expect(waitingFor(returned.state)).toEqual([]);
    expect(refusal(returned.state, "mai", "approve")).toBe("not_pending");

    expect(resubmit(returned.state, "mai")).toEqual({ ok: false, reason: "not_requester" });
    expect(resubmit(start, "huy")).toEqual({ ok: false, reason: "not_pending" });
    const again = resubmit(returned.state, "huy");
    if (!again.ok) throw new Error(again.reason);
    expect(again.state.status).toBe("pending");
    expect(again.state.currentStep).toBe(0);
    expect(again.nowWaitingFor).toEqual(["long"]);
    expect(again.state.steps.flatMap((s) => s.assignees.map((a) => a.status))).toEqual(["pending", "pending"]);
  });

  it("does not change the state it was given", () => {
    const start = startFlow("huy", [step("hr", ["mai"])]);
    const snapshot = JSON.stringify(start);
    decide(start, "mai", "approve");
    expect(JSON.stringify(start)).toBe(snapshot);
  });
});

describe("delegate", () => {
  it("hands a pending turn to someone else, once", () => {
    const start = startFlow("huy", [step("hr", ["mai", "bao"])]);
    const result = delegate(start, "mai", "ha");
    if (!result.ok) throw new Error(result.reason);
    expect(result.state.steps[0].assignees[0]).toEqual({ personId: "ha", status: "pending", delegatedFrom: "mai" });
    expect(refusal(result.state, "mai", "approve")).toBe("not_assignee");
    expect(decide(result.state, "ha", "approve").outcome).toBe("approved");
    expect(delegate(start, "mai", "huy")).toEqual({ ok: false, reason: "own_request" });
    expect(delegate(start, "mai", "bao")).toEqual({ ok: false, reason: "not_assignee" });
    expect(delegate(start, "long", "ha")).toEqual({ ok: false, reason: "not_assignee" });
  });
});

describe("conditionHolds", () => {
  it("compares request data", () => {
    expect(conditionHolds(undefined, {})).toBe(true);
    expect(conditionHolds({ field: "days", op: "gt", value: 3 }, { days: 5 })).toBe(true);
    expect(conditionHolds({ field: "days", op: "gt", value: 3 }, { days: 3 })).toBe(false);
    expect(conditionHolds({ field: "days", op: "lte", value: 3 }, { days: "many" })).toBe(false);
    expect(conditionHolds({ field: "amount", op: "gte", value: 20_000_000 }, { amount: 20_000_000 })).toBe(true);
    expect(conditionHolds({ field: "kind", op: "in", value: ["bank", "id"] }, { kind: "bank" })).toBe(true);
    expect(conditionHolds({ field: "kind", op: "ne", value: "bank" }, { kind: "bank" })).toBe(false);
    expect(conditionHolds({ field: "kind", op: "eq", value: "bank" }, {})).toBe(false);
  });
});
