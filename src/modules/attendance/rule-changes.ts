// The attendance policy takes effect only on the owner's word (FR-PLT-39, D17) — the same shape as
// leave's rule proposals (leave/rule-changes.ts): HR proposes a new version, the owner approves it
// as an ordinary approval request, and the approval writes the version in its own transaction.
import "server-only";
import { ActionError } from "@/lib/action";
import { db } from "@/lib/db";
import { decideRequest, defineRequestType, getRequest, type RequestView, submitRequest } from "@/modules/platform/approvals/service";
import { can, type Principal } from "@/modules/platform/rbac/policy";
import { type AttendancePolicyRow, loadPolicies, type PolicyInput, savePolicy } from "./attendance-policies";

export const attendanceRuleRequest = defineRequestType({
  type: "attendance_rule",
  // The owner, whatever an administrator of flows configures: deciding the rule is the point.
  flow: { steps: [{ key: "owner", mode: "any", approvers: [{ rule: "role", role: "owner" }] }] },
  fixedFlow: true,
  bulkApprovable: () => false,
  canView: (viewer) => can(viewer, "attendance:manage") || can(viewer, "payroll:rules", {}),
});

/** Saving the attendance policy directly, without a proposal: the owner. */
export const decidesAttendanceRules = (principal: Principal) => can(principal, "payroll:rules", {});

export type AttendanceRuleChange = { kind: "attendance_policy"; input: PolicyInput; before: Partial<AttendancePolicyRow> | null };

const formatDay = (date: string) => date.split("-").reverse().join("/");

/** HR proposes; nothing changes until the owner approves. */
export async function proposeAttendancePolicy(input: PolicyInput, actorPersonId: string): Promise<{ requestId: string }> {
  return db().transaction(async (tx) => {
    const current = (await loadPolicies(tx)).find((row) => row.entityId === (input.entityId ?? null) && row.validTo === null);
    const before = current ? (Object.fromEntries(Object.keys(input).map((key) => [key, (current as Record<string, unknown>)[key]])) as Partial<AttendancePolicyRow>) : null;
    const change: AttendanceRuleChange = { kind: "attendance_policy", input, before };
    const entityId = input.entityId ?? null;
    const { request, outcome } = await submitRequest(tx, attendanceRuleRequest, {
      entityId,
      requesterPersonId: actorPersonId,
      subjectPersonId: null,
      subjectType: "attendance_policy",
      subjectId: current?.id ?? null,
      // Read in the owner's inbox beside "Attendance rule change", in their language: the date only (UI-01).
      summary: `→ ${formatDay(input.validFrom)}`,
      payload: change as unknown as Record<string, unknown>,
      link: (id) => `/approvals/rule/${id}`,
      target: entityId ? { entityId } : {},
    });
    // Approved on filing means there was no owner to ask: a rule never takes effect on HR's word alone.
    if (outcome === "approved") throw new ActionError("rule_no_owner");
    return { requestId: request.id };
  });
}

export type AttendanceRuleView = RequestView & { change: AttendanceRuleChange };

export async function getAttendanceRuleChange(viewer: { personId: string; principal: Principal }, requestId: string): Promise<AttendanceRuleView | null> {
  const view = await getRequest(viewer, attendanceRuleRequest, requestId);
  return view ? { ...view, change: view.request.payload as unknown as AttendanceRuleChange } : null;
}

/** The owner's answer. Approved, the version is written in the same transaction — or not at all. */
export async function decideAttendanceRuleChange(actorPersonId: string, requestId: string, decision: { action: "approve" | "reject"; comment: string | null }) {
  return db().transaction(async (tx) => {
    const decided = await decideRequest(tx, attendanceRuleRequest, requestId, actorPersonId, decision);
    const saved = decided.outcome === "approved" ? await savePolicy((decided.request.payload as unknown as AttendanceRuleChange).input, decided.request.requesterPersonId, tx) : null;
    return { ...decided, saved };
  });
}
