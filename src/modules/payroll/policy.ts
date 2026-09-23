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

/**
 * A figure typed into one person's line of a run (an allowance, a deduction, an adjustment): C&B
 * over both the run's entity and the person's — and never on their own line, whoever they are.
 */
export const canSetRunInputFor = (principal: Principal, run: InEntity, person: PersonInEntity): boolean =>
  canManageCompensation(principal, run) && canManageCompensation(principal, person) && principal.personId !== person.personId;

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

// ── The year-end bonus (FR-PAY-21, Phase 8 week 3) ──────────────────────────────────────────
// A bonus amount is compensation like any other figure in this module, so the rules above hold
// unchanged: a line manager, a department head and an entity director see **nothing** here,
// however much of the person's review and performance band they may read in the performance
// module. The band is about performance; the đồng are pay.

/** Build, simulate and rebuild a run over these entities: C&B over every one of them. */
export const canManageBonusRun = (principal: Principal, entityIds: readonly string[]): boolean => entityIds.length > 0 && entityIds.every((entityId) => canManageCompensation(principal, { entityId }));

/** HR puts the run up to the CEO — the same desk that proposes a payroll run. */
export const canProposeBonusRun = canManageBonusRun;

/** The owner adjusts an individual amount, with a reason (SRS D13). Nobody else, not the CEO. */
export const canAdjustBonusLine = (principal: Principal): boolean => canDecidePayRules(principal);

/** The CEO signs the run, over every entity it covers. */
export const canApproveBonusRun = (principal: Principal, entityIds: readonly string[]): boolean => entityIds.length > 0 && entityIds.every((entityId) => canApprovePayroll(principal, { entityId }));

/** Paying it is creating payroll runs, which is C&B's — the payroll lifecycle then takes over. */
export const canPayBonusRun = canManageBonusRun;

/** Reading the register and its totals: any payroll reader over every entity in the run. */
export const canReadBonusRun = (principal: Principal, entityIds: readonly string[]): boolean => entityIds.length > 0 && entityIds.every((entityId) => canReadPayroll(principal, { entityId }));

/** One person's amount and the working out behind it: their own, or C&B over their entity. */
export const canViewBonusOf = canViewCompensationOf;

/** The bonus scheme is a pay rule: C&B proposes a version, the owner decides it (FR-PLT-39). */
export const canProposeBonusScheme = canProposePayRules;
export const canDecideBonusScheme = canDecidePayRules;
