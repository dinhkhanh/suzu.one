// Who may send, read and triage feedback about the app. Pure.
//
// Sending needs nothing: everybody who can sign in — collaborators included — uses the app and
// may say what is wrong with it. The submitter reads their own items and the reply. The inbox is
// for `feedback:manage` (triage) and `feedback:read` (read only), over the people their grant
// covers: an entity's HR works the feedback of that entity's staff.
import { can, permissionReach, type Principal, type Target, type TierReach } from "../platform/rbac/policy";

/** Where a feedback item sits: its submitter's place in the organisation. */
export type FeedbackTarget = Target & { personId: string };

export const canTriageFeedback = (principal: Principal, target: FeedbackTarget): boolean => can(principal, "feedback:manage", target);

export const canReadFeedback = (principal: Principal, target: FeedbackTarget): boolean =>
  (!!principal.personId && principal.personId === target.personId) || can(principal, "feedback:manage", target) || can(principal, "feedback:read", target);

/** Navigation and the inbox page: does the principal read anybody's feedback anywhere? */
export const canOpenFeedbackInbox = (principal: Principal): boolean => can(principal, "feedback:manage") || can(principal, "feedback:read");

/** The inbox's reach: the union of both permissions' reaches. `matchesReach` is its meaning. */
export function feedbackReach(principal: Principal): TierReach {
  const manage = permissionReach(principal, "feedback:manage");
  const read = permissionReach(principal, "feedback:read");
  if (manage.all || read.all) return { all: true };
  return { all: false, entityIds: [...new Set([...manage.entityIds, ...read.entityIds])], unitIds: [...new Set([...manage.unitIds, ...read.unitIds])], managerOf: null };
}
