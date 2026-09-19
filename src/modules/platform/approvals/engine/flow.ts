// The approval engine's rules: what a flow is, and how a request moves through it. Pure: no I/O.
//
// A flow is an ordered list of steps; each step names its approvers by *rule* (line manager, whoever
// holds a permission over the requester, a named person…). The service turns the rules into people
// when the request is submitted; from then on only the state machine below decides what happens.
//
// The machine handles steps in sequence, steps that open together (`parallel`), "any" and "all"
// steps, conditions, return-for-changes and delegation (FR-PLT-20..22). Flows are configuration:
// a request type ships a default in code, and `approval_flow` rows override it per entity.
// Bulk approve needs to reach every type's own decide action; that registry lives at a
// composition root under `src/app/`, because platform code cannot import feature modules.

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
export type StepDefinition = {
  key: string;
  mode: StepMode;
  approvers: readonly ApproverRule[];
  condition?: Condition;
  /** Opens together with the step before it; the request moves on when every step of the group is done. */
  parallel?: boolean;
};
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
export type StepState = { key: string; mode: StepMode; status: StepStatus; assignees: AssigneeState[]; parallel?: boolean };
export type RequestState = { requesterId: string; status: RequestStatus; currentStep: number; steps: StepState[] };

/**
 * A step after its rules were turned into people. `applies: false` = its condition did not hold.
 * `delegatedFrom` maps an approver to the person whose standing delegation put them there.
 */
export type ResolvedStep = { key: string; mode: StepMode; applies: boolean; approverIds: readonly string[]; parallel?: boolean; delegatedFrom?: Readonly<Record<string, string>> };

/** The last index of the group of steps that opens together with the step at `start`. */
function groupEnd(steps: readonly StepState[], start: number): number {
  let end = start;
  while (end + 1 < steps.length && steps[end + 1].parallel) end++;
  return end;
}

/** The first index of the group the step at `index` belongs to. */
function groupStart(steps: readonly StepState[], index: number): number {
  let start = index;
  while (start > 0 && steps[start].parallel) start--;
  return start;
}

// Opens the next group of steps that has anything to answer, starting at the group at `from`.
function activate(steps: StepState[], from: number): { currentStep: number; done: boolean } {
  for (let start = from; start < steps.length; ) {
    const end = groupEnd(steps, start);
    let first = -1;
    for (let index = start; index <= end; index++) {
      if (steps[index].status === "skipped") continue;
      steps[index].status = "pending";
      if (first < 0) first = index;
    }
    if (first >= 0) return { currentStep: first, done: false };
    start = end + 1;
  }
  return { currentStep: Math.max(0, steps.length - 1), done: true };
}

/** The steps that are open right now: the pending ones of the current group. */
function openSteps(state: RequestState): StepState[] {
  if (state.status !== "pending" || state.steps.length === 0) return [];
  const start = groupStart(state.steps, state.currentStep);
  return state.steps.slice(start, groupEnd(state.steps, start) + 1).filter((step) => step.status === "pending");
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
    const assignees = step.applies ? approverIds.map((personId) => ({ personId, status: "pending" as const, ...(step.delegatedFrom?.[personId] ? { delegatedFrom: step.delegatedFrom[personId] } : {}) })) : [];
    return { key: step.key, mode: step.mode, status: step.applies ? "waiting" : "skipped", assignees, ...(step.parallel ? { parallel: true } : {}) };
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
  // Someone asked on two steps that are open together answers both at once.
  const open = openSteps(state);
  const turns = open.flatMap((step) => step.assignees.filter((candidate) => candidate.personId === decision.actorId && candidate.status === "pending").map((assignee) => ({ step, assignee })));
  if (turns.length === 0) return { ok: false, reason: "not_assignee" };

  if (decision.action === "reject" || decision.action === "return") {
    // One "no" is enough in either mode: nobody else needs to spend time on it.
    for (const { step, assignee } of turns) {
      assignee.status = decision.action === "reject" ? "rejected" : "returned";
      step.status = decision.action === "reject" ? "rejected" : "waiting";
    }
    if (decision.action === "return") for (const step of open) step.status = "waiting";
    state.status = decision.action === "reject" ? "rejected" : "returned";
    return { ok: true, state, outcome: state.status, nowWaitingFor: [] };
  }

  for (const { step, assignee } of turns) {
    assignee.status = "approved";
    if (step.mode === "any" || step.assignees.every((candidate) => candidate.status === "approved")) step.status = "approved";
  }
  const start = groupStart(state.steps, state.currentStep);
  const end = groupEnd(state.steps, start);
  const groupDone = state.steps.slice(start, end + 1).every((step) => step.status === "approved" || step.status === "skipped");
  if (!groupDone) return { ok: true, state, outcome: "pending", nowWaitingFor: [] };

  const { currentStep, done } = activate(state.steps, end + 1);
  if (done) {
    state.status = "approved";
    return { ok: true, state, outcome: "approved", nowWaitingFor: [] };
  }
  state.currentStep = currentStep;
  return { ok: true, state, outcome: "pending", nowWaitingFor: waitingFor(state) };
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
  return { ok: true, state, outcome: state.status, nowWaitingFor: done ? [] : waitingFor(state) };
}

/** Hands the actor's turn in the current step to someone else (never the requester, never someone already on the step). */
export function delegate(current: RequestState, actorId: string, toPersonId: string): DecisionResult {
  if (current.status !== "pending") return { ok: false, reason: "not_pending" };
  if (toPersonId === current.requesterId) return { ok: false, reason: "own_request" };
  const state = clone(current);
  const turns = openSteps(state).flatMap((step) => step.assignees.filter((candidate) => candidate.personId === actorId && candidate.status === "pending").map((assignee) => ({ step, assignee })));
  if (turns.length === 0 || turns.some(({ step }) => step.assignees.some((candidate) => candidate.personId === toPersonId))) return { ok: false, reason: "not_assignee" };
  for (const { assignee } of turns) {
    assignee.delegatedFrom = assignee.delegatedFrom ?? actorId;
    assignee.personId = toPersonId;
  }
  return { ok: true, state, outcome: "pending", nowWaitingFor: [toPersonId] };
}

/** Whose answer the request is waiting for right now. */
export function waitingFor(state: RequestState): string[] {
  return [...new Set(openSteps(state).flatMap((step) => step.assignees.filter((assignee) => assignee.status === "pending").map((assignee) => assignee.personId)))];
}

// ── Flows as configuration ──────────────────────────────────────────────────────────────────

export type FlowProblem = "no_steps" | "too_many_steps" | "duplicate_key" | "no_approvers" | "first_step_parallel" | "no_unconditional_step" | "bad_level";

/**
 * What a flow saved by an administrator must satisfy beyond its shape: a request always meets at
 * least one step (so nothing is approved by nobody), and keys identify steps.
 */
export function flowProblems(flow: FlowDefinition): FlowProblem[] {
  const problems = new Set<FlowProblem>();
  if (flow.steps.length === 0) problems.add("no_steps");
  if (flow.steps.length > 8) problems.add("too_many_steps");
  if (new Set(flow.steps.map((step) => step.key)).size !== flow.steps.length) problems.add("duplicate_key");
  if (flow.steps.some((step) => step.approvers.length === 0)) problems.add("no_approvers");
  if (flow.steps[0]?.parallel) problems.add("first_step_parallel");
  if (flow.steps.length > 0 && flow.steps.every((step) => step.condition)) problems.add("no_unconditional_step");
  if (flow.steps.some((step) => step.approvers.some((rule) => rule.rule === "manager_level" && (!Number.isInteger(rule.level) || rule.level < 1 || rule.level > 6)))) problems.add("bad_level");
  return [...problems];
}
