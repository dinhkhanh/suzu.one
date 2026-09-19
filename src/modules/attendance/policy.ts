// Who may change attendance configuration. Pure. Everything here is `attendance:manage` (HR);
// what differs is where the thing being changed sits.
import { can, type Principal, type Target } from "@/modules/platform/rbac/policy";

/** Sees the attendance settings at all: holds `attendance:manage` somewhere. */
export const canOpenAttendanceSettings = (principal: Principal): boolean => can(principal, "attendance:manage");

/** Calendar rows, shifts and schedules belong to one entity, or (entity null) to the whole group — which takes a group-wide grant. */
export const canManageAttendanceConfig = (principal: Principal, entityId: string | null): boolean => can(principal, "attendance:manage", entityId ? { entityId } : {});

export type AssignmentScope = { scope: "entity" | "department" | "person"; entityId: string | null; departmentId: string | null };

/**
 * Who follows which schedule. An entity's HR assigns for the entity, for a department narrowed to
 * the entity, and for its people; a shared department as a whole takes a grant that covers it.
 */
export function canAssignSchedule(principal: Principal, assignment: AssignmentScope, person: (Target & { personId: string }) | null): boolean {
  if (assignment.scope === "person") return !!person && can(principal, "attendance:manage", person);
  if (assignment.scope === "department") return can(principal, "attendance:manage", assignment.entityId ? { entityId: assignment.entityId, departmentId: assignment.departmentId } : { departmentId: assignment.departmentId });
  return can(principal, "attendance:manage", { entityId: assignment.entityId });
}
