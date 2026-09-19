// The approval engine's rules: what a flow is, and how a request moves through it. Pure: no I/O.
//
// A flow is an ordered list of steps; each step names its approvers by *rule* (line manager, whoever
// holds a permission over the requester, a named person…). The service turns the rules into people
// when the request is submitted; from then on only the state machine below decides what happens.
//
// Phase 1 uses one-step flows. The machine already handles several steps in sequence, "any" and
// "all" steps, conditions, return-for-changes and delegation, so Phase 2 (FR-PLT-20..22) adds
// configuration and screens on top, not a new engine. Two things Phase 2 still has to bring:
// parallel *steps* (parallel approvers inside one step exist: mode "all"), and — for bulk approve —
// a registry from request type to its definition at a composition root, because a request's
// effect lives in the module that owns the type and platform code cannot import feature modules.

export type ApproverRule =
  | { rule: "line_manager" }
  | { rule: "department_head" }
  /** The subject's manager `level` levels up: 1 = line manager, 2 = their manager, … */
  | { rule: "manager_level"; level: number }
  /** Everyone whose roles name this permission over the subject (owners' "*" is the fallback, not the rule). */
  | { rule: "permission"; permission: string }
  | { rule: "role"; role: string }
  | { rule: "person"; personId: string };

/** A test on the request's data, e.g. { field: "days", op: "gt", value: 3 } adds the department head. */
export type Condition = { field: string; op: "eq" | "ne" | "gt" | "gte" | "lt" | "lte" | "in"; value: string | number | boolean | readonly (string | number)[] };

export type StepMode = "any" | "all";
export type StepDefinition = { key: string; mode: StepMode; approvers: readonly ApproverRule[]; condition?: Condition };
export type FlowDefinition = { steps: readonly StepDefinition[] };

export function conditionHolds(condition: Condition | undefined, data: Record<string, unknown>): boolean {
  if (!condition) return true;
  const actual = data[condition.field];
  const { op, value } = condition;
  if (op === "in") return Array.isArray(value) && (value as readonly unknown[]).includes(actual);
  if (op === "eq") return actual === value;
  if (op === "ne") return actual !== value;
  if (typeof actual !== "number" || typeof value !== "number") return false;
  return op === "gt" ? actual > value : op === "gte" ? actual >= value : op === "lt" ? actual < value : actual <= value;
}

// ── State ───────────────────────────────────────────────────────────────────────────────────

export type RequestStatus = "pending" | "approved" | "rejected" | "returned" | "withdrawn" | "cancelled";
export type StepStatus = "waiting" | "pending" | "approved" | "rejected" | "skipped";
export type AssigneeStatus = "pending" | "approved" | "rejected" | "returned";

export type AssigneeState = { personId: string; status: AssigneeStatus; delegatedFrom?: string | null };
export type StepState = { key: string; mode: StepMode; status: StepStatus; assignees: AssigneeState[] };
export type RequestState = { requesterId: string; status: RequestStatus; currentStep: number; steps: StepState[] };

/** A step after its rules were turned into people. `applies: false` = its condition did not hold. */
export type ResolvedStep = { key: string; mode: StepMode; applies: boolean; approverIds: readonly string[] };

function activate(steps: StepState[], from: number): { currentStep: number; done: boolean } {
  for (let index = from; index < steps.length; index++) {
    if (steps[index].status === "skipped") continue;
    steps[index].status = "pending";
    return { currentStep: index, done: false };
  }
  return { currentStep: Math.max(0, steps.length - 1), done: true };
}

/**
 * The state of a request that was just submitted. Nobody approves their own request: the requester
 * is dropped from every step, and a step left without approvers is an error the service must
 * prevent (it falls back to the owners). A flow whose every step is skipped is approved at once.
 */
export function startFlow(requesterId: string, resolved: readonly ResolvedStep[]): RequestState {
  const steps: StepState[] = resolved.map((step) => {
    const approverIds = [...new Set(step.approverIds)].filter((personId) => personId !== requesterId);
    if (step.applies && approverIds.length === 0) throw new Error(`step_${step.key}_has_no_approver`);
    return { key: step.key, mode: step.mode, status: step.applies ? "waiting" : "skipped", assignees: step.applies ? approverIds.map((personId) => ({ personId, status: "pending" as const })) : [] };
  });
  const { currentStep, done } = activate(steps, 0);
  return { requesterId, status: done ? "approved" : "pending", currentStep, steps };
}

export type DecisionAction = "approve" | "reject" | "return" | "withdraw";
export type Decision = { actorId: string; action: DecisionAction };
export type Refusal = "not_pending" | "not_assignee" | "not_requester" | "own_request";

export type DecisionResult =
  | { ok: true; state: RequestState; /** "pending" = the request moves on but is not decided yet. */ outcome: RequestStatus; /** People whose turn it has just become. */ nowWaitingFor: string[] }
  | { ok: false; reason: Refusal };

const clone = (state: RequestState): RequestState => ({ ...state, steps: state.steps.map((step) => ({ ...step, assignees: step.assignees.map((assignee) => ({ ...assignee })) })) });

export function applyDecision(current: RequestState, decision: Decision): DecisionResult {
  const state = clone(current);

  if (decision.action === "withdraw") {
    // Taking a request back is the requester's call alone, for as long as it is not decided.
    if (decision.actorId !== state.requesterId) return { ok: false, reason: "not_requester" };
    if (state.status !== "pending" && state.status !== "returned") return { ok: false, reason: "not_pending" };
    state.status = "withdrawn";
    return { ok: true, state, outcome: "withdrawn", nowWaitingFor: [] };
  }

  if (state.status !== "pending") return { ok: false, reason: "not_pending" };
  if (decision.actorId === state.requesterId) return { ok: false, reason: "own_request" };
  const step = state.steps[state.currentStep];
  const assignee = step?.status === "pending" ? step.assignees.find((candidate) => candidate.personId === decision.actorId && candidate.status === "pending") : undefined;
  if (!step || !assignee) return { ok: false, reason: "not_assignee" };

  if (decision.action === "reject" || decision.action === "return") {
    // One "no" is enough in either mode: nobody else needs to spend time on it.
    assignee.status = decision.action === "reject" ? "rejected" : "returned";
    step.status = decision.action === "reject" ? "rejected" : "waiting";
    state.status = decision.action === "reject" ? "rejected" : "returned";
    return { ok: true, state, outcome: state.status, nowWaitingFor: [] };
  }

  assignee.status = "approved";
  const stepDone = step.mode === "any" || step.assignees.every((candidate) => candidate.status === "approved");
  if (!stepDone) return { ok: true, state, outcome: "pending", nowWaitingFor: [] };

  step.status = "approved";
  const { currentStep, done } = activate(state.steps, state.currentStep + 1);
  if (done) {
    state.status = "approved";
    return { ok: true, state, outcome: "approved", nowWaitingFor: [] };
  }
  state.currentStep = currentStep;
  return { ok: true, state, outcome: "pending", nowWaitingFor: state.steps[currentStep].assignees.map((candidate) => candidate.personId) };
}

/** After "return for changes": the requester sends it again and the flow starts over from its first step. */
export function resubmit(current: RequestState, actorId: string): DecisionResult {
  if (actorId !== current.requesterId) return { ok: false, reason: "not_requester" };
  if (current.status !== "returned") return { ok: false, reason: "not_pending" };
  const state = clone(current);
  for (const step of state.steps) {
    if (step.status === "skipped") continue;
    step.status = "waiting";
    for (const assignee of step.assignees) assignee.status = "pending";
  }
  const { currentStep, done } = activate(state.steps, 0);
  state.currentStep = currentStep;
  state.status = done ? "approved" : "pending";
  return { ok: true, state, outcome: state.status, nowWaitingFor: done ? [] : state.steps[currentStep].assignees.map((candidate) => candidate.personId) };
}

/** Hands the actor's turn in the current step to someone else (never the requester, never someone already on the step). */
export function delegate(current: RequestState, actorId: string, toPersonId: string): DecisionResult {
  if (current.status !== "pending") return { ok: false, reason: "not_pending" };
  if (toPersonId === current.requesterId) return { ok: false, reason: "own_request" };
  const state = clone(current);
  const step = state.steps[state.currentStep];
  const assignee = step?.assignees.find((candidate) => candidate.personId === actorId && candidate.status === "pending");
  if (!step || !assignee || step.assignees.some((candidate) => candidate.personId === toPersonId)) return { ok: false, reason: "not_assignee" };
  assignee.delegatedFrom = assignee.delegatedFrom ?? actorId;
  assignee.personId = toPersonId;
  return { ok: true, state, outcome: "pending", nowWaitingFor: [toPersonId] };
}

/** Whose answer the request is waiting for right now. */
export function waitingFor(state: RequestState): string[] {
  if (state.status !== "pending") return [];
  const step = state.steps[state.currentStep];
  return step?.status === "pending" ? step.assignees.filter((assignee) => assignee.status === "pending").map((assignee) => assignee.personId) : [];
}
