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
//   · the manager **proposes** a rating; only HR (`performance:manage`) **calibrates and
//     releases**, and only once the cycle has reached its calibration stage — or, in a rolling
//     probation cycle, once that one person's review is in.
//   · after release the manager (or HR) records the **sign-off conversation**; where the cycle
//     asks for one, the person acknowledges only after it.
//   · **peers** are never shown to the subject by name while the cycle is anonymous, and a peer
//     never reads another peer.
//   · **colleagues read nothing**, whatever they hold over other parts of the company.
import { can, type Principal } from "../platform/rbac/policy";
import { releasable, type ReviewCycleStatus, type ReviewFormKind, type ReviewStage } from "./enums";
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
  /** A rolling probation cycle: each review is released on its own, while the cycle stays open. */
  rolling: boolean;
  /** Does the cycle ask for the sign-off conversation before the acknowledgement? */
  signOffRequired: boolean;
  /** Has the sign-off conversation been recorded? */
  signedOff: boolean;
};

const isSelf = (principal: Principal, parties: ReviewParties) => !!principal.personId && principal.personId === parties.subject.personId;
const isAbove = (principal: Principal, parties: ReviewParties) => !!principal.personId && parties.subject.chainAbove.includes(principal.personId);
const isHr = (principal: Principal, parties: ReviewParties) => canManagePerformanceOf(principal, parties.subject) || can(principal, "performance:read", parties.subject);

/** The reviewing manager: the one named at launch, or — if they have gone — anyone above the subject. */
export const isReviewingManager = (principal: Principal, parties: ReviewParties): boolean => (!!principal.personId && principal.personId === parties.managerPersonId) || isAbove(principal, parties);

/**
 * Does this review exist for the viewer at all? (The list, the person's name, how far it has got.)
 *
 * A **nominated peer** is admitted too, otherwise they could not write the feedback they were
 * asked for — but only that: every block on the page is behind `canReadReviewForm`, which lets a
 * peer read their own form and nothing else.
 */
export const canSeeParticipant = (principal: Principal, parties: ReviewParties, nominated = false): boolean =>
  canReadPerformanceOf(principal, parties.subject) || (nominated && !!principal.personId && principal.personId !== parties.subject.personId);

/**
 * Reading one filled form. A draft is its author's alone — and oversight's; after that the rules
 * below apply.
 * `authorPersonId` matters for peer forms — a peer reads their own, never another's.
 */
export function canReadReviewForm(principal: Principal, parties: ReviewParties, form: { kind: ReviewFormKind; authorPersonId: string; status: "draft" | "submitted" }): boolean {
  if (!principal.personId) return false;
  // Your own draft, and your own submitted form, are always yours.
  if (principal.personId === form.authorPersonId) return true;
  // Oversight (`performance:oversee`, the owner's — decision of 2026-09-28) reads every form,
  // drafts included, with its author — but a review about oneself follows the subject's rules below.
  if (!isSelf(principal, parties) && can(principal, "performance:oversee", parties.subject)) return true;
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

/**
 * Is this review still being written? While the cycle collects and the review has not been handed
 * over — a rolling cycle stays open after one person's review is released, and that one is done.
 */
const collecting = (parties: ReviewParties): boolean => parties.cycleStatus === "active" && !parties.released;

/** Writing one's own self review: only while the cycle is collecting, and only one's own. */
export const canWriteSelfReview = (principal: Principal, parties: ReviewParties): boolean => isSelf(principal, parties) && collecting(parties);

/**
 * Writing the manager review: the manager named at launch, anyone above the subject (a manager who
 * has left must not stall a cycle), or HR over them — and never about oneself, whatever one holds.
 */
export const canWriteManagerReview = (principal: Principal, parties: ReviewParties): boolean =>
  !isSelf(principal, parties) && collecting(parties) && (isReviewingManager(principal, parties) || canManagePerformanceOf(principal, parties.subject));

/** Writing peer feedback: the nominated peer, while the cycle collects, and never about oneself. */
export const canWritePeerReview = (principal: Principal, parties: ReviewParties, nominated: boolean): boolean => !isSelf(principal, parties) && nominated && collecting(parties);

// ── Peer nominations (week 2) ───────────────────────────────────────────────────────────────

/**
 * Putting a peer forward: the person themself (it is their 360), anyone above them, or HR.
 * A colleague cannot nominate somebody to review a third person.
 */
export const canNominatePeer = (principal: Principal, parties: ReviewParties): boolean => collecting(parties) && (isSelf(principal, parties) || isReviewingManager(principal, parties) || canManagePerformanceOf(principal, parties.subject));

/**
 * Whether that nomination takes effect at once. The subject's own choices are a request their
 * manager answers (FR-PRF-03's "optional peers/360" step); a manager's or HR's choice is the
 * decision itself, so it needs nobody else's approval.
 */
export const nominationIsApproved = (principal: Principal, parties: ReviewParties): boolean => !isSelf(principal, parties) && (isReviewingManager(principal, parties) || canManagePerformanceOf(principal, parties.subject));

/** Approving or declining a pending nomination: the reviewing manager or HR — never the subject. */
export const canDecideNomination = (principal: Principal, parties: ReviewParties): boolean => nominationIsApproved(principal, parties);

/**
 * Who may see the list of who was asked. HR and the line always; the subject sees **their own**
 * nominations because they made them — but on an anonymous cycle they are shown who was *asked*,
 * never which of them wrote what, which is `canReadReviewForm`'s business.
 */
export const canSeeNominations = (principal: Principal, parties: ReviewParties): boolean => isSelf(principal, parties) || isAbove(principal, parties) || isHr(principal, parties);

/**
 * Who calibrates and releases a review: HR over the person (`performance:manage`), and never the
 * person themself. The reviewing manager writes the review and proposes a rating — being the
 * manager opens neither calibration nor release (owner's decision, 2026-10-05; PRF-02). Oversight
 * (`performance:oversee`) reads and never acts.
 */
export const isReviewCalibrator = (principal: Principal, parties: ReviewParties): boolean => !isSelf(principal, parties) && canManagePerformanceOf(principal, parties.subject);

/**
 * Calibration and release: the calibrator, and only once the cycle has reached its calibration
 * stage (or is closed) — in a rolling probation cycle, while it is open (`releasable`).
 */
export const canReleaseReview = (principal: Principal, parties: ReviewParties): boolean => isReviewCalibrator(principal, parties) && releasable({ status: parties.cycleStatus, rolling: parties.rolling });

/**
 * Sending a submitted form back to its author for changes: HR over the person, while the review is
 * still being written. Once it is calibrated or released the figure is settled; the use-case says so.
 */
export const canReturnReviewForm = (principal: Principal, parties: ReviewParties): boolean => isReviewCalibrator(principal, parties) && collecting(parties);

/**
 * Recording the sign-off conversation (FR-PRF-03): the manager who held it — the one named at
 * launch, or anyone above — or HR over the person, once the review has been released. Never the
 * person themself: it is the record that the conversation was had with them.
 */
export const canRecordSignOff = (principal: Principal, parties: ReviewParties): boolean =>
  !isSelf(principal, parties) && parties.released && !parties.signedOff && (isReviewingManager(principal, parties) || isReviewCalibrator(principal, parties));

/**
 * Acknowledging: the subject, once it has been released to them (FR-PRF-03's last step) — and,
 * where the cycle asks for a sign-off conversation, once it has been recorded.
 */
export const canAcknowledgeReview = (principal: Principal, parties: ReviewParties): boolean => isSelf(principal, parties) && parties.released && (!parties.signOffRequired || parties.signedOff);

// ── Cycles and templates (HR) ───────────────────────────────────────────────────────────────

/** Building, launching and closing a cycle: HR over the entity it covers; a group cycle needs a group grant. */
export const canManageCycle = (principal: Principal, entityId: string | null): boolean => can(principal, "performance:manage", entityId ? { entityId } : {});

/** The form templates are the group's, like the KPI library. */
export const canManageReviewTemplates = (principal: Principal): boolean => can(principal, "performance:manage", {});

/** Is there a review desk for this viewer at all? Navigation only — every page checks again. */
export const canOpenReviews = (): boolean => true;
