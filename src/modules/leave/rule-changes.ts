// Leave rules take effect only on the owner's word (FR-PLT-39, D17). HR proposes a leave type or a
// leave policy; the proposal is an ordinary approval request whose only approver is the owner, and
// its approval writes the change — in the same transaction, through the same save functions HR's
// own form used to call directly. The owner's own change needs nobody's approval and is saved at
// once, as statutory parameters and pay rules already work (`payroll:rules`).
import "server-only";
import { ActionError } from "@/lib/action";
import { db, type Tx } from "@/lib/db";
import { decideRequest, defineRequestType, getRequest, type RequestView, submitRequest } from "@/modules/platform/approvals/service";
import { can, type Principal } from "@/modules/platform/rbac/policy";
import { getLeaveType, type LeavePolicyInput, type LeavePolicyRow, type LeaveTypeInput, type LeaveTypeRow, listPolicies, saveLeavePolicy, saveLeaveType } from "./types";

export const leaveRuleRequest = defineRequestType({
  type: "leave_rule",
  // The owner, whatever an administrator of flows configures: deciding the rule is the point.
  flow: { steps: [{ key: "owner", mode: "any", approvers: [{ rule: "role", role: "owner" }] }] },
  fixedFlow: true,
  bulkApprovable: () => false,
  // Whoever keeps leave configuration follows what was proposed.
  canView: (viewer) => can(viewer, "leave:manage") || can(viewer, "payroll:rules", {}),
});

/** Saving leave rules directly, without a proposal: the owner. */
export const decidesLeaveRules = (principal: Principal) => can(principal, "payroll:rules", {});

/** What a proposal holds: the whole input the form sent, and the row as it stood (for the diff). */
export type LeaveRuleChange =
  | { kind: "leave_type"; input: LeaveTypeInput; before: Partial<LeaveTypeRow> | null }
  | { kind: "leave_policy"; input: LeavePolicyInput; before: Partial<LeavePolicyRow> | null; typeName: string };

/** Only the fields the form edits, JSON-safe, so the before/after sheet compares like with like. */
function pick<Row extends object>(row: Row | null | undefined, keys: readonly string[]): Partial<Row> | null {
  if (!row) return null;
  return Object.fromEntries(keys.filter((key) => key in row).map((key) => [key, (row as Record<string, unknown>)[key]])) as Partial<Row>;
}

const formatDay = (date: string) => date.split("-").reverse().join("/");

async function apply(tx: Tx, change: LeaveRuleChange, actorPersonId: string): Promise<void> {
  if (change.kind === "leave_type") await saveLeaveType(change.input, tx);
  else await saveLeavePolicy(change.input, actorPersonId, tx);
}

/** HR proposes; nothing changes until the owner approves. Returns the approval request. */
export async function proposeLeaveRuleChange(change: { kind: "leave_type"; input: LeaveTypeInput } | { kind: "leave_policy"; input: LeavePolicyInput }, actorPersonId: string): Promise<{ requestId: string; outcome: string }> {
  return db().transaction(async (tx) => {
    let payload: LeaveRuleChange;
    let summary: string;
    if (change.kind === "leave_type") {
      const current = change.input.id ? await getLeaveType(change.input.id, tx) : null;
      if (change.input.id && !current) throw new ActionError("leave_type_not_found");
      payload = { kind: "leave_type", input: change.input, before: pick(current, Object.keys(change.input)) };
      // Read in the owner's inbox beside "Leave rule change", in their language: facts only (UI-01) —
      // the code and name, marked "+" when the type is new.
      summary = `${current ? "" : "+ "}${change.input.code}: ${change.input.name}`;
    } else {
      const type = await getLeaveType(change.input.leaveTypeId, tx);
      if (!type) throw new ActionError("leave_type_not_found");
      const current = (await listPolicies([type.id], tx)).find((row) => row.entityId === (change.input.entityId ?? null) && row.validTo === null);
      payload = { kind: "leave_policy", input: change.input, before: pick(current, Object.keys(change.input)), typeName: type.name };
      summary = `${type.name} → ${formatDay(change.input.validFrom)}`;
    }
    const entityId = change.input.entityId ?? null;
    const { request, outcome } = await submitRequest(tx, leaveRuleRequest, {
      entityId,
      requesterPersonId: actorPersonId,
      subjectPersonId: null,
      subjectType: change.kind,
      subjectId: change.kind === "leave_type" ? change.input.id : change.input.leaveTypeId,
      summary,
      payload: payload as unknown as Record<string, unknown>,
      link: (id) => `/approvals/rule/${id}`,
      target: entityId ? { entityId } : {},
    });
    // Approved on filing means there was no owner to ask: a rule never takes effect on HR's word alone.
    if (outcome === "approved") throw new ActionError("rule_no_owner");
    return { requestId: request.id, outcome };
  });
}

export type LeaveRuleView = RequestView & { change: LeaveRuleChange };

export async function getLeaveRuleChange(viewer: { personId: string; principal: Principal }, requestId: string): Promise<LeaveRuleView | null> {
  const view = await getRequest(viewer, leaveRuleRequest, requestId);
  return view ? { ...view, change: view.request.payload as unknown as LeaveRuleChange } : null;
}

/** The owner's answer. Approved, the change is written in the same transaction — or not at all. */
export async function decideLeaveRuleChange(actorPersonId: string, requestId: string, decision: { action: "approve" | "reject" | "return"; comment: string | null }) {
  return db().transaction(async (tx) => {
    const decided = await decideRequest(tx, leaveRuleRequest, requestId, actorPersonId, decision);
    if (decided.outcome === "approved") await apply(tx, decided.request.payload as unknown as LeaveRuleChange, decided.request.requesterPersonId);
    return decided;
  });
}
