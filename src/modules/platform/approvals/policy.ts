// Who may do what with an approval request, independent of its type. Pure.
// Deciding is not here on purpose: whose turn it is comes from the flow state (engine/flow.ts),
// and what else an approver needs (a permission, a sensitivity tier) is the owning module's rule.

type RequestParties = { requesterPersonId: string; status: string };

/** Opening a request: its requester, anyone who is or was asked to approve it, and whoever the owning module lets in. */
export function canOpenRequest(request: RequestParties, viewer: { personId: string; isApprover: boolean; typeAllows: boolean }): boolean {
  return request.requesterPersonId === viewer.personId || viewer.isApprover || viewer.typeAllows;
}

/** Taking a request back is the requester's call alone, until it is decided. */
export function canWithdraw(request: RequestParties, personId: string): boolean {
  return request.requesterPersonId === personId && (request.status === "pending" || request.status === "returned");
}
