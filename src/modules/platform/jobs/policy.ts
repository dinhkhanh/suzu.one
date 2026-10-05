// Who sees the scheduled jobs, and who may start one by hand (Admin → Jobs).
import { can, type Principal } from "../rbac/policy";

/** System health is a group-level concern, the same audience as the full audit log. */
export const canSeeJobs = (principal: Principal): boolean => can(principal, "audit:read", {});

/**
 * Running a job by hand changes data across every module with nobody's name on the change but the
 * job's — a roll-over, an accrual, a purge. It belongs with the group-level power to decide who
 * holds which role (`rbac:manage`), which no role lists: today the owner's alone. An auditor or an
 * HR admin sees the runs; they do not start them.
 */
export const canRunJobs = (principal: Principal): boolean => can(principal, "rbac:manage", {});
