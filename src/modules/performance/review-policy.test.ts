// Confidentiality of a review (FR-PRF-08) and who may write one (FR-PRF-03). Pure, no I/O.
import { describe, expect, it } from "vitest";
import { readableTier } from "../platform/rbac/policy";
import type { Grant, Principal } from "../platform/rbac/policy";
import { chainAbove, type PersonContext } from "./policy";
import { canAcknowledgeReview, canManageCycle, canManageReviewTemplates, canReadAnonymisedPeers, canReadReviewForm, canReleaseReview, canSeeParticipant, canWriteManagerReview, canWritePeerReview, canWriteSelfReview, isReviewingManager, type ReviewParties } from "./review-policy";

const SZM = "entity-szm";
const SZC = "entity-szc";
const VID = "dept-vid";
const DES = "dept-des";

const principal = (personId: string, grants: Grant[] = [], workforceType: Principal["workforceType"] = "employee"): Principal => ({ personId, workforceType, grants });

// owner → ceo → long (head of VID) → tam → huy; chi heads DES at SZC.
const managerOf = new Map<string, string | null>([["owner", null], ["ceo", "owner"], ["long", "ceo"], ["tam", "long"], ["huy", "tam"], ["linh", "tam"], ["chi", "ceo"], ["khoi", "chi"]]);
const person = (personId: string, entityId: string, unitId: string): PersonContext => ({ personId, entityId, unitPath: [unitId], managerId: managerOf.get(personId) ?? null, chainAbove: chainAbove(managerOf, personId) });

const huy = person("huy", SZM, VID);
const khoi = person("khoi", SZC, DES);

const parties = (subject: PersonContext, over: Partial<ReviewParties> = {}): ReviewParties => ({ subject, managerPersonId: managerOf.get(subject.personId) ?? null, stage: "manager_done", released: false, cycleStatus: "active", peerAnonymous: true, ...over });

const owner = principal("owner", [{ role: "owner", scope: { type: "group" } }]);
const hrSzm = principal("bao", [{ role: "hr_staff", scope: { type: "entity", id: SZM } }]);
const hrAdmin = principal("mai", [{ role: "hr_admin", scope: { type: "group" } }]);
const headVid = principal("long", [{ role: "department_head", scope: { type: "unit", id: VID } }]);
const headDes = principal("chi", [{ role: "department_head", scope: { type: "unit", id: DES } }]);
const auditor = principal("aud", [{ role: "auditor", scope: { type: "group" } }]);
const lineManager = principal("tam");
const colleague = principal("linh");

const submitted = { status: "submitted" as const };
const selfForm = { kind: "self" as const, authorPersonId: "huy", ...submitted };
const managerForm = { kind: "manager" as const, authorPersonId: "tam", ...submitted };
const peerForm = { kind: "peer" as const, authorPersonId: "linh", ...submitted };

describe("reading a review (FR-PRF-08)", () => {
  it("keeps a draft to its author — not HR, not the manager, not the owner", () => {
    const draft = { kind: "manager" as const, authorPersonId: "tam", status: "draft" as const };
    expect(canReadReviewForm(lineManager, parties(huy), draft)).toBe(true);
    expect(canReadReviewForm(headVid, parties(huy), draft)).toBe(false);
    expect(canReadReviewForm(hrSzm, parties(huy), draft)).toBe(false);
    expect(canReadReviewForm(owner, parties(huy), draft)).toBe(false);
    expect(canReadReviewForm(principal("huy"), parties(huy), draft)).toBe(false);
  });

  it("shows a submitted self review to the line, the skip-level and HR — never a colleague", () => {
    expect(canReadReviewForm(principal("huy"), parties(huy), selfForm)).toBe(true); // their own
    expect(canReadReviewForm(lineManager, parties(huy), selfForm)).toBe(true);
    expect(canReadReviewForm(headVid, parties(huy), selfForm)).toBe(true); // skip-level
    expect(canReadReviewForm(principal("ceo"), parties(huy), selfForm)).toBe(true);
    expect(canReadReviewForm(hrSzm, parties(huy), selfForm)).toBe(true);
    expect(canReadReviewForm(auditor, parties(huy), selfForm)).toBe(true);
    expect(canReadReviewForm(colleague, parties(huy), selfForm)).toBe(false);
    expect(canReadReviewForm(headDes, parties(huy), selfForm)).toBe(false); // another department's head
    expect(canReadReviewForm(hrSzm, parties(khoi), selfForm)).toBe(false); // another entity's HR
  });

  it("holds the manager review back from the subject until it is released", () => {
    const before = parties(huy, { released: false });
    const after = parties(huy, { released: true, stage: "released" });
    expect(canReadReviewForm(principal("huy"), before, managerForm)).toBe(false);
    expect(canReadReviewForm(principal("huy"), after, managerForm)).toBe(true);
    // Everyone above them and HR read it either way — release is about the subject.
    for (const viewer of [lineManager, headVid, hrSzm, owner]) {
      expect(canReadReviewForm(viewer, before, managerForm)).toBe(true);
      expect(canReadReviewForm(viewer, after, managerForm)).toBe(true);
    }
    expect(canReadReviewForm(colleague, after, managerForm)).toBe(false);
  });

  it("never names a peer to the subject while the cycle is anonymous", () => {
    const released = parties(huy, { released: true, peerAnonymous: true });
    expect(canReadReviewForm(principal("huy"), released, peerForm)).toBe(false);
    expect(canReadAnonymisedPeers(principal("huy"), released)).toBe(true); // the content, without the name
    expect(canReadAnonymisedPeers(principal("huy"), parties(huy, { released: false }))).toBe(false);
    expect(canReadAnonymisedPeers(lineManager, released)).toBe(false); // the manager reads the named form instead
    const open = parties(huy, { released: true, peerAnonymous: false });
    expect(canReadReviewForm(principal("huy"), open, peerForm)).toBe(true);
    // The peer reads their own; another peer does not.
    expect(canReadReviewForm(colleague, released, peerForm)).toBe(true);
    expect(canReadReviewForm(principal("duc"), released, peerForm)).toBe(false);
    expect(canReadReviewForm(lineManager, released, peerForm)).toBe(true);
    expect(canReadReviewForm(hrSzm, released, peerForm)).toBe(true);
  });

  it("agrees with canReadPerformanceOf about whose review exists at all", () => {
    expect(canSeeParticipant(principal("huy"), parties(huy))).toBe(true);
    expect(canSeeParticipant(lineManager, parties(huy))).toBe(true);
    expect(canSeeParticipant(headVid, parties(huy))).toBe(true);
    expect(canSeeParticipant(colleague, parties(huy))).toBe(false);
    expect(canSeeParticipant(hrSzm, parties(khoi))).toBe(false);
  });

  /**
   * The point of FR-PRF-08 next to SRS §2.2: a line manager reads the whole review — it is
   * personal-tier prose — and still reads nothing of the person's pay. The bonus the final result
   * later drives is compensation and lives in payroll, which uses payroll permissions, not the
   * org chart. Here: the manager may read every review form, and `readableTier` stops at personal.
   */
  it("gives a line manager the review content and nothing compensation-shaped", () => {
    const released = parties(huy, { released: true });
    for (const form of [selfForm, managerForm, peerForm]) expect(canReadReviewForm(lineManager, released, form)).toBe(true);
    expect(readableTier(lineManager, { ...huy, managerId: "tam" })).toBe("personal");
    expect(readableTier(headVid, { ...huy, managerId: "tam" })).toBe("personal");
    // Nothing a review carries is a figure about pay: the shape has answers, a rating and prose.
    const reviewFields = ["kind", "authorPersonId", "status", "answers", "overallRatingBp", "comment"];
    expect(reviewFields.some((field) => /salary|bonus|amount|pay|vnd/i.test(field))).toBe(false);
  });
});

describe("writing a review (FR-PRF-03)", () => {
  it("lets only the person write their own self review, and only while the cycle collects", () => {
    expect(canWriteSelfReview(principal("huy"), parties(huy))).toBe(true);
    expect(canWriteSelfReview(lineManager, parties(huy))).toBe(false);
    expect(canWriteSelfReview(hrSzm, parties(huy))).toBe(false);
    expect(canWriteSelfReview(owner, parties(huy))).toBe(false);
    expect(canWriteSelfReview(principal("huy"), parties(huy, { cycleStatus: "calibration" }))).toBe(false);
    expect(canWriteSelfReview(principal("huy"), parties(huy, { cycleStatus: "draft" }))).toBe(false);
  });

  it("lets the named manager, anyone above and HR write the manager review — never about oneself", () => {
    expect(canWriteManagerReview(lineManager, parties(huy))).toBe(true);
    expect(canWriteManagerReview(headVid, parties(huy))).toBe(true); // skip-level, when the manager has gone
    expect(canWriteManagerReview(hrSzm, parties(huy))).toBe(true);
    expect(canWriteManagerReview(owner, parties(huy))).toBe(true);
    expect(canWriteManagerReview(colleague, parties(huy))).toBe(false);
    expect(canWriteManagerReview(headDes, parties(huy))).toBe(false);
    expect(canWriteManagerReview(auditor, parties(huy))).toBe(false); // reads, never writes
    expect(canWriteManagerReview(principal("huy"), parties(huy))).toBe(false);
    // Holding everything changes nothing about writing one's own.
    expect(canWriteManagerReview(owner, parties(person("owner", SZM, "dept-bod")))).toBe(false);
    expect(canWriteManagerReview(lineManager, parties(huy, { cycleStatus: "calibration" }))).toBe(false);
    // A manager who has left: the snapshot still names them, and the chain covers the gap.
    const orphan = parties(huy, { managerPersonId: null });
    expect(isReviewingManager(headVid, orphan)).toBe(true);
    expect(canWriteManagerReview(headVid, orphan)).toBe(true);
    expect(canWriteManagerReview(colleague, orphan)).toBe(false);
  });

  it("lets a nominated peer write, and nobody else", () => {
    expect(canWritePeerReview(colleague, parties(huy), true)).toBe(true);
    expect(canWritePeerReview(colleague, parties(huy), false)).toBe(false);
    expect(canWritePeerReview(principal("huy"), parties(huy), true)).toBe(false); // never about oneself
    expect(canWritePeerReview(colleague, parties(huy, { cycleStatus: "calibration" }), true)).toBe(false);
  });

  it("keeps calibration and release with the manager or HR, and the acknowledgement with the person", () => {
    expect(canReleaseReview(lineManager, parties(huy))).toBe(true);
    expect(canReleaseReview(headVid, parties(huy))).toBe(true);
    expect(canReleaseReview(hrSzm, parties(huy))).toBe(true);
    expect(canReleaseReview(principal("huy"), parties(huy))).toBe(false);
    expect(canReleaseReview(colleague, parties(huy))).toBe(false);
    expect(canReleaseReview(auditor, parties(huy))).toBe(false);

    expect(canAcknowledgeReview(principal("huy"), parties(huy, { released: true }))).toBe(true);
    expect(canAcknowledgeReview(principal("huy"), parties(huy, { released: false }))).toBe(false);
    expect(canAcknowledgeReview(lineManager, parties(huy, { released: true }))).toBe(false);
    expect(canAcknowledgeReview(hrSzm, parties(huy, { released: true }))).toBe(false);
  });
});

describe("building a cycle", () => {
  it("ties a cycle to the grant's scope and the templates to the group", () => {
    expect(canManageCycle(hrSzm, SZM)).toBe(true);
    expect(canManageCycle(hrSzm, SZC)).toBe(false);
    expect(canManageCycle(hrSzm, null)).toBe(false); // a group cycle needs a group grant
    expect(canManageCycle(hrAdmin, null)).toBe(true);
    expect(canManageCycle(hrAdmin, SZC)).toBe(true);
    expect(canManageCycle(owner, null)).toBe(true);
    expect(canManageCycle(headVid, SZM)).toBe(false);
    expect(canManageCycle(auditor, SZM)).toBe(false);

    expect(canManageReviewTemplates(hrAdmin)).toBe(true);
    expect(canManageReviewTemplates(hrSzm)).toBe(false);
    expect(canManageReviewTemplates(owner)).toBe(true);
  });
});

describe("a nominated peer", () => {
  it("can open the review to write their feedback, and reads nothing else there", () => {
    const released = parties(huy, { released: true });
    // Without a nomination a colleague does not know the review exists.
    expect(canSeeParticipant(colleague, released)).toBe(false);
    expect(canSeeParticipant(colleague, released, true)).toBe(true);
    // …but the only form they read is their own.
    expect(canReadReviewForm(colleague, released, peerForm)).toBe(true);
    expect(canReadReviewForm(colleague, released, selfForm)).toBe(false);
    expect(canReadReviewForm(colleague, released, managerForm)).toBe(false);
    expect(canReadReviewForm(colleague, released, { kind: "peer", authorPersonId: "duc", status: "submitted" })).toBe(false);
    // Nor can they calibrate, release or acknowledge.
    expect(canReleaseReview(colleague, released)).toBe(false);
    expect(canAcknowledgeReview(colleague, released)).toBe(false);
    // A nomination never lets somebody peer-review themselves.
    expect(canSeeParticipant(principal("huy"), released, true)).toBe(true); // it is their own review anyway
    expect(canWritePeerReview(principal("huy"), released, true)).toBe(false);
  });
});
