// Who may do what with an approval request, independent of its type. Pure.
// Deciding is not here on purpose: whose turn it is comes from the flow state (engine/flow.ts),
// and what else an approver needs (a permission, a sensitivity tier) is the owning module's rule.
import { can, type Principal, type Target } from "../rbac/policy";

type RequestParties = { requesterPersonId: string; status: string };

/**
 * Moving somebody's turn on to another person, for an approver who is away, suspended or simply
 * not answering (PLT-02): whoever holds `person:manage` over the person the request is about — over
 * its requester when it is about nobody — which the owner always does. `where` is that person's
 * place in the organisation. Never on a request one filed or is the subject of: choosing one's own
 * approver is approving one's own request by another road.
 */
export function canReassignTurns(principal: Principal, request: { requesterPersonId: string; subjectPersonId: string | null }, where: Target | null): boolean {
  if (!principal.personId || principal.personId === request.requesterPersonId || principal.personId === request.subjectPersonId) return false;
  return !!where && can(principal, "person:manage", where);
}

/**
 * Setting, or ending, a standing delegation for someone who cannot do it themselves (FR-ACL-06):
 * `person:manage` over that person. One's own delegation is one's own business and needs nothing.
 */
export function canDelegateFor(principal: Principal, person: (Target & { personId: string }) | null): boolean {
  return !!person && !!principal.personId && principal.personId !== person.personId && can(principal, "person:manage", person);
}

/** Opening a request: its requester, anyone who is or was asked to approve it, and whoever the owning module lets in. */
export function canOpenRequest(request: RequestParties, viewer: { personId: string; isApprover: boolean; typeAllows: boolean }): boolean {
  return request.requesterPersonId === viewer.personId || viewer.isApprover || viewer.typeAllows;
}

/** Following every request in the entity (or the group, without one) without being a party to it. */
export function canOverseeRequests(principal: Principal, where?: { entityId: string | null }): boolean {
  return can(principal, "approval:oversee", where ? { entityId: where.entityId } : undefined);
}

/**
 * The types whose whole state is the request itself, so the generic "withdraw" is all there is to
 * taking one back: a resignation, a profile change, and the request builder's types ("request:…").
 * Every other type (leave, attendance, a raise, an offer, a page review, a project change…) keeps a
 * row of its own in step with the request, and is taken back only through its module's cancel
 * action — withdrawing it here would leave that row pending for ever. Deny by default: a new type
 * is not withdrawable here until it is named.
 */
const WITHDRAWN_HERE: ReadonlySet<string> = new Set(["resignation", "profile_change"]);
export const withdrawnHere = (type: string): boolean => WITHDRAWN_HERE.has(type) || type.startsWith("request:");

/** Taking a request back is the requester's call alone, until it is decided — and, here, only for a type with no row of its own. */
export function canWithdraw(request: RequestParties & { type: string }, personId: string): boolean {
  return withdrawnHere(request.type) && request.requesterPersonId === personId && (request.status === "pending" || request.status === "returned");
}
