// Who may change attendance configuration. Pure. Everything here is `attendance:manage` (HR);
// what differs is where the thing being changed sits.
import { can, canReadTier, type Principal, type Target } from "@/modules/platform/rbac/policy";

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

type PersonTarget = Target & { personId: string };

/** Work locations belong to one entity. */
export const canManageLocation = (principal: Principal, entityId: string): boolean => can(principal, "attendance:manage", { entityId });

/**
 * Where, from which address and on which device someone checked in is personal-tier: the person,
 * their line manager and the HR who keep their attendance. Colleagues see a status, nothing more.
 */
export const canSeePunchDetailOf = (principal: Principal, person: PersonTarget): boolean =>
  principal.personId === person.personId || (!!principal.personId && person.managerId === principal.personId) || can(principal, "attendance:manage", person);

/** Accepting or rejecting a flagged check-in: the line manager or HR — never the person themselves. */
export const canReviewPunchOf = (principal: Principal, person: PersonTarget): boolean =>
  principal.personId !== person.personId && ((!!principal.personId && person.managerId === principal.personId) || can(principal, "attendance:manage", person));

/**
 * A person's timesheet (hours, lateness, absences — no positions) is personal-tier: the person,
 * whoever reads their personal tier (line manager, department head, HR) and the HR who keep their
 * attendance. Colleagues never.
 */
export const canSeeTimesheetOf = (principal: Principal, person: PersonTarget): boolean =>
  principal.personId === person.personId || canReadTier(principal, person, "personal") || can(principal, "attendance:manage", person);

/** Recomputing on demand, device logs and the ID map: HR over the entity. */
export const canManageDevices = (principal: Principal, entityId: string): boolean => can(principal, "attendance:manage", { entityId });

// ── Week 5: requests, the monthly timesheet, the anomaly console ────────────────────────────

/** An attendance request is one's own; HR files on behalf of the people they keep attendance for. */
export const canFileAttendanceRequestFor = (principal: Principal, person: PersonTarget): boolean => principal.personId === person.personId || can(principal, "attendance:manage", person);

/** HR over the person — the anomaly console's actions, cancelling a request that has started, adjustments after the lock. */
export const canManageAttendanceOf = (principal: Principal, person: PersonTarget): boolean => can(principal, "attendance:manage", person);

/** Confirming the hours of approved overtime or holiday work: the line manager or HR — never one's own. */
export const canConfirmHoursOf = (principal: Principal, person: PersonTarget): boolean =>
  principal.personId !== person.personId && ((!!principal.personId && person.managerId === principal.personId) || can(principal, "attendance:manage", person));

/** Approving (or sending back) someone's monthly timesheet: the line manager or HR — never one's own. */
export const canApproveMonthOf = (principal: Principal, person: PersonTarget): boolean =>
  principal.personId !== person.personId && ((!!principal.personId && person.managerId === principal.personId) || can(principal, "attendance:manage", person));

/** Locking an entity's month, and reading its progress: HR over the entity. */
export const canLockPeriod = (principal: Principal, entityId: string): boolean => can(principal, "attendance:manage", { entityId });
