// Who may read and write a review (FR-PRF-03, FR-PRF-08). Pure; no I/O.
//
// A review is **personal tier** — it is prose about a person's work, never a figure about their
// pay. The bonus the final result later drives is compensation and lives in payroll; nothing in
// this module is compensation tier, which is why a line manager may read all of it.
//
// The rules, in one place:
//   · a **draft** belongs to its author alone — not to HR, not to the person's manager. Somebody
//     halfway through writing an honest review must not be read over the shoulder.
//   · the **subject** sees their own self review always, and everything else **only after their
//     review is released**. Before release a manager's assessment is a work in progress and
//     calibration may still move it.
//   · the **management chain** above the subject (direct or skip-level) and holders of
//     `performance:read` / `performance:manage` covering them read submitted forms at any time.
//   · **peers** are never shown to the subject by name while the cycle is anonymous, and a peer
//     never reads another peer.
//   · **colleagues read nothing**, whatever they hold over other parts of the company.
import { can, type Principal } from "../platform/rbac/policy";
import type { ReviewCycleStatus, ReviewFormKind, ReviewStage } from "./enums";
import { canManagePerformanceOf, canReadPerformanceOf, type PersonContext } from "./policy";

/** One person's review as the policy needs it: who it is about, who writes it, how far it has got. */
export type ReviewParties = {
  /** The person being reviewed, with their reporting line. */
  subject: PersonContext;
  /** The manager snapshotted when the cycle launched — the one who owes the manager review. */
  managerPersonId: string | null;
  stage: ReviewStage;
  /** Has this participant's review been released to them? */
  released: boolean;
  cycleStatus: ReviewCycleStatus;
  peerAnonymous: boolean;
};

const isSelf = (principal: Principal, parties: ReviewParties) => !!principal.personId && principal.personId === parties.subject.personId;
const isAbove = (principal: Principal, parties: ReviewParties) => !!principal.personId && parties.subject.chainAbove.includes(principal.personId);
const isHr = (principal: Principal, parties: ReviewParties) => canManagePerformanceOf(principal, parties.subject) || can(principal, "performance:read", parties.subject);

/** The reviewing manager: the one named at launch, or — if they have gone — anyone above the subject. */
export const isReviewingManager = (principal: Principal, parties: ReviewParties): boolean => (!!principal.personId && principal.personId === parties.managerPersonId) || isAbove(principal, parties);

/** Does this review exist for the viewer at all? (The list, the person's name, how far it has got.) */
export const canSeeParticipant = (principal: Principal, parties: ReviewParties): boolean => canReadPerformanceOf(principal, parties.subject);

/**
 * Reading one filled form. A draft is its author's alone; after that the rules above apply.
 * `authorPersonId` matters for peer forms — a peer reads their own, never another's.
 */
export function canReadReviewForm(principal: Principal, parties: ReviewParties, form: { kind: ReviewFormKind; authorPersonId: string; status: "draft" | "submitted" }): boolean {
  if (!principal.personId) return false;
  // Your own draft, and your own submitted form, are always yours.
  if (principal.personId === form.authorPersonId) return true;
  if (form.status === "draft") return false;

  switch (form.kind) {
    case "self":
      // The subject wrote it; their line and HR read it as soon as it is submitted.
      return isAbove(principal, parties) || isHr(principal, parties);
    case "manager":
      // The subject waits for release; everyone above them, and HR, do not.
      if (isSelf(principal, parties)) return parties.released;
      return isAbove(principal, parties) || isHr(principal, parties);
    case "peer":
      // Peers go to the manager and HR. The subject sees them only after release, and only when
      // the cycle is not anonymous — otherwise the content is shown without the author elsewhere.
      if (isSelf(principal, parties)) return parties.released && !parties.peerAnonymous;
      return isAbove(principal, parties) || isHr(principal, parties);
  }
}

/**
 * The subject's own copy of the peer feedback when the cycle is anonymous: after release they read
 * **what was said**, never **who said it**. The UI drops the author; this says whether to show it.
 */
export const canReadAnonymisedPeers = (principal: Principal, parties: ReviewParties): boolean => isSelf(principal, parties) && parties.released;

/** Writing one's own self review: only while the cycle is collecting, and only one's own. */
export const canWriteSelfReview = (principal: Principal, parties: ReviewParties): boolean => isSelf(principal, parties) && parties.cycleStatus === "active";

/**
 * Writing the manager review: the manager named at launch, anyone above the subject (a manager who
 * has left must not stall a cycle), or HR over them — and never about oneself, whatever one holds.
 */
export const canWriteManagerReview = (principal: Principal, parties: ReviewParties): boolean => !isSelf(principal, parties) && parties.cycleStatus === "active" && (isReviewingManager(principal, parties) || canManagePerformanceOf(principal, parties.subject));

/** Writing peer feedback: the nominated peer, while the cycle collects, and never about oneself. */
export const canWritePeerReview = (principal: Principal, parties: ReviewParties, nominated: boolean): boolean => !isSelf(principal, parties) && nominated && parties.cycleStatus === "active";

/** Calibration and release: the reviewing manager or HR over the person. Never the subject. */
export const canReleaseReview = (principal: Principal, parties: ReviewParties): boolean => !isSelf(principal, parties) && (isReviewingManager(principal, parties) || canManagePerformanceOf(principal, parties.subject));

/** Acknowledging: the subject, once it has been released to them (FR-PRF-03's last step). */
export const canAcknowledgeReview = (principal: Principal, parties: ReviewParties): boolean => isSelf(principal, parties) && parties.released;

// ── Cycles and templates (HR) ───────────────────────────────────────────────────────────────

/** Building, launching and closing a cycle: HR over the entity it covers; a group cycle needs a group grant. */
export const canManageCycle = (principal: Principal, entityId: string | null): boolean => can(principal, "performance:manage", entityId ? { entityId } : {});

/** The form templates are the group's, like the KPI library. */
export const canManageReviewTemplates = (principal: Principal): boolean => can(principal, "performance:manage", {});

/** Is there a review desk for this viewer at all? Navigation only — every page checks again. */
export const canOpenReviews = (): boolean => true;
