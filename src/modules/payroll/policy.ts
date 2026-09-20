// Who may see and do what in payroll. Pure; no I/O. (SRS §2.2, D17, FR-ACL-04.)
//
// Compensation never follows the org chart: a line manager, a department head, an entity director
// and HR staff get nothing here. `readableTier()` — with its "manager reads personal data" clause —
// is deliberately not used by this module; every rule below is a payroll permission held over the
// **entity** the pay belongs to, or "it is your own".
//
//   payroll:propose  C&B and the HR lead — salary structures, profiles, runs up to "proposed",
//                    individual payslips, payslip queries
//   payroll:read     the run register and reports (adds the CEO, the chief accountant, auditors)
//   payroll:approve  the CEO signs a run
//   payroll:pay      the chief accountant prepares and records payment
//   rules:propose    propose components, formulas and pay policies
//   payroll:rules    the owner decides rules, profile moves, and sees the Simple-profile exposure report
import { can, entityReach, type Principal } from "@/modules/platform/rbac/policy";

type InEntity = { entityId?: string | null };
type PersonInEntity = InEntity & { personId: string };

const over = (where: InEntity) => ({ entityId: where.entityId ?? null });
// A person with no entity belongs to nobody's payroll scope: only a group-wide grant reaches them.
const holds = (principal: Principal, permission: "payroll:read" | "payroll:propose" | "payroll:approve" | "payroll:pay", where: InEntity) => can(principal, permission, over(where));

/** Salary structures, pay profiles and individual payslips of other people: C&B over the entity, and the owner ("*"). */
export const canManageCompensation = (principal: Principal, where: InEntity): boolean => holds(principal, "payroll:propose", where);

/** One person's salary or payslip: their own, or `canManageCompensation`. Nobody else — not their manager, not the CEO. */
export const canViewCompensationOf = (principal: Principal, person: PersonInEntity): boolean => (!!principal.personId && principal.personId === person.personId) || canManageCompensation(principal, person);

/** The run register, totals and reports of an entity. */
export const canReadPayroll = (principal: Principal, where: InEntity): boolean => holds(principal, "payroll:read", where);
export const canApprovePayroll = (principal: Principal, where: InEntity): boolean => holds(principal, "payroll:approve", where);
export const canPayPayroll = (principal: Principal, where: InEntity): boolean => holds(principal, "payroll:pay", where);

/**
 * A salary change is answered by whoever the flow names (the owner by default) — and on top of
 * that they must be someone payroll trusts with figures: the owner, the CEO or C&B over the entity.
 */
export const canDecideSalaryChange = (principal: Principal, where: InEntity): boolean => can(principal, "payroll:rules", over(where)) || holds(principal, "payroll:approve", where) || holds(principal, "payroll:propose", where);

/** Pay components, formulas, pay policies (FR-PLT-39): group-wide permissions, like the statutory store. */
export const canProposePayRules = (principal: Principal): boolean => can(principal, "rules:propose", {});
export const canDecidePayRules = (principal: Principal): boolean => can(principal, "payroll:rules", {});
/** Reading the rules is harmless next to reading pay; anyone with a payroll role somewhere may. */
export const canReadPayRules = (principal: Principal): boolean => canProposePayRules(principal) || canDecidePayRules(principal) || can(principal, "payroll:read") || can(principal, "payroll:propose");

/** FR-PAY-08 / risk R11: who is on the Simple profile and why — the owner's eyes only. */
export const canSeeSimpleProfileReport = (principal: Principal): boolean => canDecidePayRules(principal);

/** For list queries: the entities whose compensation the principal manages. Turned into SQL by the services. */
export const compensationReach = (principal: Principal) => entityReach(principal, "payroll:propose");
export const payrollReadReach = (principal: Principal) => entityReach(principal, "payroll:read");

/** Does any payroll screen exist for this person? Navigation only. */
export const hasPayrollDesk = (principal: Principal): boolean => can(principal, "payroll:read") || can(principal, "payroll:propose") || can(principal, "payroll:approve") || can(principal, "payroll:pay");
