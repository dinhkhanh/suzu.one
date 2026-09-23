// Who may hand a client a review link, and who may take it back (D24, FR-PJM-51a). Pure, like
// `policy.ts` next door, and a separate file only because Phase 10's parallel build had that one
// locked — everything here is part of the same policy and is asked in the same way.
//
// The rule is short on purpose: **a review link is a client decision by another route**, so whoever
// may record what the client decided (FR-PJM-51) may let the client say it themselves, and nobody
// else. That is the project's account manager or whoever runs the project; for work outside a
// project, the client's own account manager or the team's leads. It follows that `work:manage` over
// a team does not reach into a private project's links, because it does not reach its decisions.
import { canModerateTask, canRecordClientDecision, type TaskFacts, type WorkViewer } from "./policy";

export type PreviewLinkFacts = { createdByPersonId: string };
type ClientFacts = { accountManagerPersonId: string | null };

/**
 * Creating a link, and seeing the list of the ones that exist with their state. A link is a
 * capability handed outside the company, so the list is not directory information: only the people
 * who may act for the client see who was sent what, and when they looked.
 */
export function canManagePreviewLinks(viewer: WorkViewer, task: TaskFacts, client: ClientFacts): boolean {
  return canRecordClientDecision(viewer, task, client);
}

/**
 * Revoking one. Wider than creating on purpose: a link given to the wrong person has to be stopped
 * by whoever notices, so anyone who may moderate the task can take it back even if the account
 * side made it. Cutting a link off can only ever be safe — the client's answer, if they gave one,
 * is already recorded.
 */
export function canRevokePreviewLink(viewer: WorkViewer, task: TaskFacts, client: ClientFacts): boolean {
  return canManagePreviewLinks(viewer, task, client) || canModerateTask(viewer, task);
}
