// Who may do what with leave. Pure. Employees act on their own leave without a permission;
// approvers act through the approval engine; everything else is `leave:manage` (HR), checked
// against where the person or the configuration sits.
import { can, canReadTier, type Principal, type Target } from "@/modules/platform/rbac/policy";

type PersonTarget = Target & { personId: string };

/** Sees the leave administration at all: holds `leave:manage` somewhere. */
export const canOpenLeaveAdmin = (principal: Principal): boolean => can(principal, "leave:manage");

/** Types, policies and staffing rules belong to one entity, or (entity null) to the whole group — which takes a group-wide grant. */
export const canManageLeaveConfig = (principal: Principal, entityId: string | null): boolean => can(principal, "leave:manage", entityId ? { entityId } : {});

/** Balances, ledger, adjustments, cancelling approved leave, filing on someone's behalf. */
export const canManageLeaveOf = (principal: Principal, person: PersonTarget): boolean => can(principal, "leave:manage", person);

/** One's own leave, or HR for the people they look after. */
export const canFileLeaveFor = (principal: Principal, person: PersonTarget): boolean => principal.personId === person.personId || canManageLeaveOf(principal, person);

/** Balances are the person's own, their line manager's (who plans around them) and HR's. */
export const canSeeBalancesOf = (principal: Principal, person: PersonTarget): boolean => principal.personId === person.personId || person.managerId === principal.personId || canManageLeaveOf(principal, person);

/**
 * On the team calendar everyone sees *that* a colleague is away; *why* (the leave type — sick,
 * maternity) is personal-tier: the person, whoever reads their personal data (line manager,
 * department head, HR) and nobody else.
 */
export const seesLeaveTypeOf = (principal: Principal, person: PersonTarget): boolean => principal.personId === person.personId || canReadTier(principal, person, "personal") || canManageLeaveOf(principal, person);
