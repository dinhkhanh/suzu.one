// Who may do what with the request builder. Pure.
//
// Two rules, and they are deliberately blunt:
//  - **designing** a request type is administering the organisation (`org:manage`), the same
//    permission that already governs approval flows — a form and its flow are one decision;
//  - **filing** a request is something every member of the workforce does. No permission gates it;
//    what a request may then *reach* is its flow's business.
//
// Reading someone else's request is the approval engine's own rule (requester, approver, or the
// type's `canView`), so nothing here needs to repeat it.
import { can, type Principal } from "@/modules/platform/rbac/policy";

/** Designing, editing and switching off request types; also the tracking screen across everybody. */
export const canManageRequestTypes = (principal: Principal, entityId: string | null = null) => can(principal, "org:manage", entityId ? { entityId } : {});

/** Filing a request: anybody who is a person in the system. Collaborators included — they buy things too. */
export const canFileRequests = (principal: Principal) => principal.personId !== null;

/**
 * Settling expense claims (FR-REQ-03) — reading the list of what is owed and putting the waiting
 * ones into a run. Whoever pays the company's people: the claim is paid through the payroll run,
 * so the same hands do both. With no entity it asks "anywhere at all", for the screen's door.
 */
export const canSettleExpenseClaims = (principal: Principal, entityId: string | null = null) => can(principal, "payroll:pay", entityId ? { entityId } : {});
