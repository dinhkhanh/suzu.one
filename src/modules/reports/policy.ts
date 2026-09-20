// Who may do what with reports. Pure.
//
// **The decision recorded here (nobody was available to ask, so it is written down):** there is no
// new RBAC permission for reports. Scheduling is not a power of its own — it is a way of receiving
// something you may already read. So:
//
//  - **who may schedule a report**: anybody who may read that report *today*, decided by the
//    catalogue entry's own `canSee`, which is the same predicate the report's screen checks. A
//    department head may schedule the headcount report (they hold `report:read`, scoped); they may
//    not schedule the payroll cost report, because `/payroll/reports` refuses them too.
//  - **who may be a recipient**: anybody. Being named on a schedule grants nothing: the job builds
//    the report again for each recipient with that recipient's own principal, and a recipient who
//    may not read it is recorded as `not_permitted` and sent nothing (see `schedules.ts`).
//  - **who may see and change a schedule**: its creator, and holders of `org:manage` — the same
//    people who configure request types and approval flows. `audit:read` holders see the list
//    read-only through the audit trail, not here.
//
// That leaves exactly one way to widen what somebody receives: give them the permission the report
// itself needs. There is no path through this module.
import { can, type Principal } from "../platform/rbac/policy";

export type ScheduleFacts = { createdByPersonId: string; deletedAt: Date | null };
export type ScheduleViewer = { personId: string | null; principal: Principal };

/** The reports screen itself: anybody signed in may open it. Each tile decides for itself. */
export function canOpenReports(): boolean {
  return true;
}

/** Managing schedules at all — the entry in the navigation and the "new schedule" button. */
export function canManageSchedules(principal: Principal): boolean {
  return can(principal, "report:read") || can(principal, "org:manage") || can(principal, "ops:read") || can(principal, "ops:manage");
}

export function canEditSchedule(viewer: ScheduleViewer, schedule: ScheduleFacts): boolean {
  if (schedule.deletedAt) return false;
  return can(viewer.principal, "org:manage") || (!!viewer.personId && schedule.createdByPersonId === viewer.personId);
}

export const canViewSchedule = canEditSchedule;
