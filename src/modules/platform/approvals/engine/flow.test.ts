import { describe, expect, it } from "vitest";
import { applyDecision, conditionHolds, delegate, type FlowDefinition, flowProblems, type RequestState, type ResolvedStep, resubmit, startFlow, waitingFor } from "./flow";

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

describe("parallel steps", () => {
  // manager → (HR ‖ finance) → director: the middle two open together.
  const resolved: ResolvedStep[] = [
    { key: "manager", mode: "any", applies: true, approverIds: ["m"] },
    { key: "hr", mode: "any", applies: true, approverIds: ["h1", "h2"] },
    { key: "finance", mode: "all", applies: true, approverIds: ["f1", "f2"], parallel: true },
    { key: "director", mode: "any", applies: true, approverIds: ["d"] },
  ];
  const approve = (state: RequestState, actorId: string) => {
    const result = applyDecision(state, { actorId, action: "approve" });
    if (!result.ok) throw new Error(result.reason);
    return result;
  };

  it("opens the steps of a group together and moves on only when all of them are done", () => {
    let result = approve(startFlow("r", resolved), "m");
    expect(result.nowWaitingFor.sort()).toEqual(["f1", "f2", "h1", "h2"]);
    expect(result.state.steps.map((step) => step.status)).toEqual(["approved", "pending", "pending", "waiting"]);

    result = approve(result.state, "f1");
    expect(result.outcome).toBe("pending");
    result = approve(result.state, "h2");
    expect(result.state.steps[1].status).toBe("approved");
    expect(waitingFor(result.state)).toEqual(["f2"]);
    // HR's step is done: a second HR answer is nobody's turn.
    expect(applyDecision(result.state, { actorId: "h1", action: "approve" })).toEqual({ ok: false, reason: "not_assignee" });

    result = approve(result.state, "f2");
    expect(result.nowWaitingFor).toEqual(["d"]);
    expect(result.state.currentStep).toBe(3);
    expect(approve(result.state, "d").outcome).toBe("approved");
  });

  it("skips a conditional step inside a group, and a group whose every step is skipped", () => {
    const state = startFlow("r", [resolved[0], { ...resolved[1], applies: false, approverIds: [] }, resolved[2], resolved[3]]);
    const afterManager = approve(state, "m");
    expect(afterManager.nowWaitingFor.sort()).toEqual(["f1", "f2"]);

    const bothSkipped = startFlow("r", [resolved[0], { ...resolved[1], applies: false, approverIds: [] }, { ...resolved[2], applies: false, approverIds: [] }, resolved[3]]);
    expect(approve(bothSkipped, "m").nowWaitingFor).toEqual(["d"]);
  });

  it("one answer covers both steps when the same person sits on two open steps", () => {
    const state = startFlow("r", [
      { key: "a", mode: "any", applies: true, approverIds: ["x"] },
      { key: "b", mode: "any", applies: true, approverIds: ["x", "y"], parallel: true },
    ]);
    expect(approve(state, "x").outcome).toBe("approved");
  });

  it("a return closes the whole group and a resubmit reopens the flow from the start", () => {
    const open = approve(startFlow("r", resolved), "m").state;
    const returned = applyDecision(open, { actorId: "h1", action: "return" });
    if (!returned.ok) throw new Error(returned.reason);
    expect(returned.state.status).toBe("returned");
    expect(returned.state.steps.map((step) => step.status)).toEqual(["approved", "waiting", "waiting", "waiting"]);
    const again = resubmit(returned.state, "r");
    if (!again.ok) throw new Error(again.reason);
    expect(again.nowWaitingFor).toEqual(["m"]);
    expect(again.state.steps.map((step) => step.status)).toEqual(["pending", "waiting", "waiting", "waiting"]);
  });

  it("delegates a turn on a parallel step", () => {
    const open = approve(startFlow("r", resolved), "m").state;
    const handed = delegate(open, "f2", "z");
    if (!handed.ok) throw new Error(handed.reason);
    expect(handed.state.steps[2].assignees[1]).toEqual({ personId: "z", status: "pending", delegatedFrom: "f2" });
    expect(delegate(open, "f2", "f1")).toEqual({ ok: false, reason: "not_assignee" });
  });

  it("keeps who a standing delegation replaced", () => {
    const state = startFlow("r", [{ key: "manager", mode: "any", applies: true, approverIds: ["deputy"], delegatedFrom: { deputy: "m" } }]);
    expect(state.steps[0].assignees).toEqual([{ personId: "deputy", status: "pending", delegatedFrom: "m" }]);
  });
});

describe("flowProblems", () => {
  const step = (key: string, extra: Partial<FlowDefinition["steps"][number]> = {}) => ({ key, mode: "any" as const, approvers: [{ rule: "line_manager" as const }], ...extra });
  it("accepts a plain flow", () => {
    expect(flowProblems({ steps: [step("manager"), step("head", { condition: { field: "days", op: "gt", value: 3 } })] })).toEqual([]);
  });
  it("names what is wrong", () => {
    expect(flowProblems({ steps: [] })).toEqual(["no_steps"]);
    expect(flowProblems({ steps: [step("a", { parallel: true }), step("a")] }).sort()).toEqual(["duplicate_key", "first_step_parallel"]);
    expect(flowProblems({ steps: [step("a", { condition: { field: "days", op: "gt", value: 3 } })] })).toEqual(["no_unconditional_step"]);
    expect(flowProblems({ steps: [step("a", { approvers: [] })] })).toEqual(["no_approvers"]);
    expect(flowProblems({ steps: [step("a", { approvers: [{ rule: "manager_level", level: 0 }] })] })).toEqual(["bad_level"]);
  });
});
