// Who may see and move a task. Pure. Each task kind names the permission that manages it; Phase 3
// adds its kinds (work tasks, obligations) here rather than new rules.
import { can, type Principal } from "../rbac/policy";
import type { Permission } from "../rbac/roles";

export const KIND_MANAGE_PERMISSION: Record<string, Exclude<Permission, "*">> = { checklist: "person:manage", work: "work:manage", obligation: "ops:manage" };

// Kinds whose tasks move through the engine's own generic actions (task.status, task.reassign).
// A work task carries a workflow state and an obligation cannot close without its evidence, so
// those kinds are moved by their own module's actions only.
export const GENERIC_ACTION_KINDS: readonly string[] = ["checklist"];
export const movesThroughEngine = (task: { kind: string }): boolean => GENERIC_ACTION_KINDS.includes(task.kind);

export type TaskParties = { kind: string; entityId: string | null; assigneePersonId: string | null; subjectPersonId: string | null; createdByPersonId: string | null };

/** Everything: reassign, cancel, reopen, complete on someone's behalf. */
export function canManageTask(principal: Principal, task: TaskParties): boolean {
  const permission = KIND_MANAGE_PERMISSION[task.kind];
  return !!permission && can(principal, permission, task.entityId ? { entityId: task.entityId } : {});
}

/** Start, finish or reopen: the assignee's own task, or a manager of the kind. */
export function canMoveTask(principal: Principal, task: TaskParties): boolean {
  return (!!principal.personId && task.assigneePersonId === principal.personId) || canManageTask(principal, task);
}

export function canViewTask(principal: Principal, task: TaskParties): boolean {
  const self = principal.personId;
  return canMoveTask(principal, task) || (!!self && (task.subjectPersonId === self || task.createdByPersonId === self));
}

/** Checklist templates belong to HR: anyone who manages people somewhere may read them; changing one takes authority over its entity (or the group for shared ones). */
export function canManageTemplates(principal: Principal, template?: { entityId: string | null }): boolean {
  return can(principal, "person:manage", template ? (template.entityId ? { entityId: template.entityId } : {}) : undefined);
}
