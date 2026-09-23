// Who may do what with an approval request, independent of its type. Pure.
// Deciding is not here on purpose: whose turn it is comes from the flow state (engine/flow.ts),
// and what else an approver needs (a permission, a sensitivity tier) is the owning module's rule.

type RequestParties = { requesterPersonId: string; status: string };

/** Opening a request: its requester, anyone who is or was asked to approve it, and whoever the owning module lets in. */
export function canOpenRequest(request: RequestParties, viewer: { personId: string; isApprover: boolean; typeAllows: boolean }): boolean {
  return request.requesterPersonId === viewer.personId || viewer.isApprover || viewer.typeAllows;
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
