// Week 2 against a real Postgres (PGlite): peer/360 nominations and their anonymity, the bulk
// release, the final yearly result (compute → owner override → lock → publish) and the one rule
// Phase 3.5 asked Phase 8 to enforce — a KPI month a bonus run has been approved from refuses to
// reopen.
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => import("../../../tests/helpers/db"));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/action", () => ({
  ActionError: class ActionError extends Error {
    constructor(
      message: string,
      readonly details?: unknown,
    ) {
      super(message);
    }
  },
  createAction: () => async () => ({ ok: false, error: "failed" }),
}));
vi.mock("@/modules/platform/notifications/service", () => ({ notify: async () => undefined, queueEmail: async () => undefined }));
vi.mock("@/modules/platform/rbac/service", () => ({ listOwnerPersonIds: async () => [] }));

import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { migrateTestDb } from "../../../tests/helpers/db";
import { markScoresConsumed, releaseConsumedScores } from "./consumption";
import { DEFAULT_PERFORMANCE_WEIGHTING, type RatingPoint, type ReviewSection } from "./enums";
import { computeResults, findResult, listFinalResults, lockResult, overrideResult, publishResult, unlockResult } from "./final-results";
import { reopenMonth } from "./kpi-scores";
import { loadDirectory } from "./people";
import { canReadReviewForm, canSeeNominations, canNominatePeer, canDecideNomination, nominationIsApproved } from "./review-policy";
import {
  type CycleInput,
  decideNomination,
  isApprovedPeer,
  launchReviewCycle,
  listCycleParticipants,
  listPeerInvitations,
  nominatePeer,
  partiesOfParticipant,
  peerCandidates,
  releaseCycle,
  saveReviewCycle,
  saveReviewForm,
  saveReviewTemplate,
  withdrawNomination,
} from "./reviews";
import { decideWeighting, getWeighting, proposeWeighting } from "./weighting";

type Who = "owner" | "mai" | "long" | "tam" | "huy" | "linh";
const ids = {} as Record<Who | "szm", string>;
const fails = (promise: Promise<unknown>) => promise.then(() => "no error", (error: Error) => error.message);
const detailsOf = (promise: Promise<unknown>) => promise.then(() => null, (error: Error & { details?: unknown }) => error.details);

const principal = (who: Who | null, grants: { role: string; scope: { type: string; id?: string } }[] = []) =>
  ({ personId: who ? ids[who] : null, workforceType: "employee" as const, grants: grants as never });
const GROUP_HR = [{ role: "hr_admin", scope: { type: "group" } }];

const SCALE: RatingPoint[] = [
  { value: 1, label: "Chưa đạt", labelEn: "Below", scoreBp: 4000 },
  { value: 3, label: "Đạt yêu cầu", labelEn: "Meets", scoreBp: 10_000 },
  { value: 5, label: "Xuất sắc", labelEn: "Outstanding", scoreBp: 13_000 },
];
const SECTIONS: ReviewSection[] = [
  { key: "quality", title: "Chất lượng", titleEn: "Quality", kind: "rating", weight: 1, required: true, askedOf: ["self", "manager", "peer"] },
  { key: "notes", title: "Ghi chú", titleEn: "Notes", kind: "text", weight: 0, required: false, askedOf: ["self", "manager", "peer"] },
];

const cycleInput = (templateId: string, over: Partial<CycleInput> = {}): CycleInput => ({
  entityId: ids.szm,
  name: "Đánh giá năm 2026",
  kind: "annual",
  year: 2026,
  periodStart: "2026-01-01",
  periodEnd: "2026-12-31",
  templateId,
  selfDueOn: "2026-12-10",
  managerDueOn: "2026-12-20",
  peerDueOn: "2026-12-15",
  calibrationOn: "2026-12-22",
  releaseOn: "2026-12-28",
  peersEnabled: true,
  peerMin: 1,
  peerMax: 2,
  peerAnonymous: true,
  ...over,
});

let cycleId = "";
let participantOf: Map<string, string> = new Map();
const partiesFor = async (personId: string) => {
  const [participant] = await db().select().from(schema.reviewParticipant).where(eq(schema.reviewParticipant.id, participantOf.get(personId)!));
  const [cycle] = await db().select().from(schema.reviewCycle).where(eq(schema.reviewCycle.id, cycleId));
  return partiesOfParticipant(participant, cycle, await loadDirectory())!;
};

beforeAll(async () => {
  await migrateTestDb();
  const [szm] = await db().insert(schema.entity).values({ code: "SZM", legalName: "SuZu Media", shortName: "Media" }).returning();
  const [dept] = await db().insert(schema.orgUnit).values({ code: "VID", name: "Video" }).returning();
  ids.szm = szm.id;
  // owner → long → tam → huy, and linh beside huy under tam.
  const people: [Who, Who | null][] = [
    ["owner", null],
    ["mai", "owner"],
    ["long", "owner"],
    ["tam", "long"],
    ["huy", "tam"],
    ["linh", "tam"],
  ];
  for (const [key, manager] of people) {
    const [row] = await db()
      .insert(schema.person)
      .values({ fullName: key, searchName: key, workEmail: `${key}@suzu.group`, status: "active", workforceType: "employee", primaryEntityId: szm.id, departmentId: dept.id, managerId: manager ? ids[manager] : null })
      .returning();
    ids[key] = row.id;
  }

  const templateId = (await saveReviewTemplate(null, { name: "Đánh giá năm", nameEn: "Annual", description: null, sections: SECTIONS, ratingScale: SCALE, isActive: true }, ids.mai)).after.id;
  cycleId = (await saveReviewCycle(null, cycleInput(templateId), ids.mai)).after.id;
  await launchReviewCycle(cycleId, ids.mai);
  participantOf = new Map((await listCycleParticipants(cycleId)).map((line) => [line.personId, line.participantId]));
});

// ── Peer / 360 ──────────────────────────────────────────────────────────────────────────────

describe("peer nominations", () => {
  it("lets the person nominate — waiting for their manager — and the manager nominate outright", async () => {
    const huy = await partiesFor(ids.huy);
    expect(canNominatePeer(principal("huy"), huy)).toBe(true);
    expect(nominationIsApproved(principal("huy"), huy)).toBe(false);
    expect(nominationIsApproved(principal("tam"), huy)).toBe(true);
    // A colleague at the same level cannot put somebody forward to review a third person.
    expect(canNominatePeer(principal("linh"), huy)).toBe(false);

    const own = await nominatePeer({ participantId: participantOf.get(ids.huy)!, peerPersonId: ids.linh, approved: false, note: null }, ids.huy);
    expect(own.nomination.status).toBe("pending");
    expect(await isApprovedPeer(participantOf.get(ids.huy)!, ids.linh)).toBe(false);

    const byManager = await nominatePeer({ participantId: participantOf.get(ids.huy)!, peerPersonId: ids.mai, approved: true, note: null }, ids.tam);
    expect(byManager.nomination.status).toBe("approved");
    expect(await isApprovedPeer(participantOf.get(ids.huy)!, ids.mai)).toBe(true);
  });

  it("refuses the subject as their own peer, a repeat, and more than the cycle's maximum", async () => {
    const participantId = participantOf.get(ids.huy)!;
    expect(await fails(nominatePeer({ participantId, peerPersonId: ids.huy, approved: true, note: null }, ids.tam))).toBe("review_peer_is_subject");
    expect(await fails(nominatePeer({ participantId, peerPersonId: ids.mai, approved: true, note: null }, ids.tam))).toBe("review_peer_exists");
    // peerMax is 2 and one is already approved; approving the pending one fills it, the next fails.
    const pending = (await db().select().from(schema.reviewPeerNomination).where(eq(schema.reviewPeerNomination.peerPersonId, ids.linh)))[0];
    await decideNomination(pending.id, "approve", ids.tam);
    expect(await fails(nominatePeer({ participantId, peerPersonId: ids.long, approved: true, note: null }, ids.tam))).toBe("review_peer_max");
  });

  it("offers as candidates everyone but the subject and the people already asked", async () => {
    const candidates = await peerCandidates(participantOf.get(ids.huy)!);
    const names = candidates.map((row) => row.id);
    expect(names).not.toContain(ids.huy);
    expect(names).not.toContain(ids.linh);
    expect(names).not.toContain(ids.mai);
    expect(names).toContain(ids.tam);
  });

  it("shows a peer the invitation, and refuses to withdraw one once they have written", async () => {
    const invitations = await listPeerInvitations(ids.linh);
    expect(invitations).toHaveLength(1);
    expect(invitations[0].subjectPersonId).toBe(ids.huy);
    expect(invitations[0].written).toBe(false);

    await saveReviewForm({ participantId: participantOf.get(ids.huy)!, kind: "peer", answers: { quality: 5 }, comment: "Rất tốt", submit: true }, ids.linh, "2026-12-14");
    expect((await listPeerInvitations(ids.linh))[0].submitted).toBe(true);
    const written = (await db().select().from(schema.reviewPeerNomination).where(eq(schema.reviewPeerNomination.peerPersonId, ids.linh)))[0];
    expect(await fails(withdrawNomination(written.id))).toBe("review_nomination_has_form");
  });

  it("refuses a second answer to a nomination that has been decided", async () => {
    const decided = (await db().select().from(schema.reviewPeerNomination).where(eq(schema.reviewPeerNomination.peerPersonId, ids.mai)))[0];
    expect(await fails(decideNomination(decided.id, "approve", ids.tam))).toBe("review_nomination_decided");
  });
});

describe("anonymity (FR-PRF-03: the cycle is anonymous)", () => {
  it("never lets the subject read a peer form, even after release; the chain and HR do", async () => {
    const huy = { ...(await partiesFor(ids.huy)), released: true };
    const peerForm = { kind: "peer" as const, authorPersonId: ids.linh, status: "submitted" as const };
    // The subject: the content is shown anonymised elsewhere, the form itself never.
    expect(canReadReviewForm(principal("huy"), huy, peerForm)).toBe(false);
    // The manager who has to weigh it, the skip-level manager and HR do read it with its author.
    expect(canReadReviewForm(principal("tam"), huy, peerForm)).toBe(true);
    expect(canReadReviewForm(principal("long"), huy, peerForm)).toBe(true);
    // HR is a person like anybody else — `canReadReviewForm` answers no to a session with no
    // person at all, so the grant is carried by somebody outside the reporting line.
    expect(canReadReviewForm(principal("mai", GROUP_HR), huy, peerForm)).toBe(true);
    // Another peer reads nothing of a colleague's form.
    expect(canReadReviewForm(principal("mai"), huy, peerForm)).toBe(false);
    // …and the author always reads their own.
    expect(canReadReviewForm(principal("linh"), huy, peerForm)).toBe(true);
  });

  it("shows the subject who was asked, but not which of them wrote what", async () => {
    const huy = await partiesFor(ids.huy);
    expect(canSeeNominations(principal("huy"), huy)).toBe(true);
    expect(canSeeNominations(principal("mai"), huy)).toBe(false);
    expect(canDecideNomination(principal("huy"), huy)).toBe(false);
  });

  it("a non-anonymous cycle does show the subject the peer form after release", async () => {
    const open = { ...(await partiesFor(ids.huy)), released: true, peerAnonymous: false };
    expect(canReadReviewForm(principal("huy"), open, { kind: "peer", authorPersonId: ids.linh, status: "submitted" })).toBe(true);
  });
});

describe("releasing a whole cycle", () => {
  it("releases the people whose manager review is in and reports back the ones it skipped", async () => {
    for (const who of ["huy", "linh"] as const) {
      await saveReviewForm({ participantId: participantOf.get(ids[who])!, kind: "self", answers: { quality: 3 }, comment: null, submit: true }, ids[who], "2026-12-09");
      await saveReviewForm({ participantId: participantOf.get(ids[who])!, kind: "manager", answers: { quality: who === "huy" ? 5 : 3 }, comment: null, submit: true }, ids.tam, "2026-12-18");
    }
    const result = await releaseCycle(cycleId, ids.mai);
    expect(result.released).toHaveLength(2);
    // Nobody else has a manager review, so they are skipped with the reason rather than released.
    expect(result.skipped.every((row) => row.reason === "review_manager_not_submitted")).toBe(true);
    expect(result.skipped.length).toBeGreaterThan(0);

    const lines = await listCycleParticipants(cycleId);
    expect(lines.find((line) => line.personId === ids.huy)?.reviewScoreBp).toBe(13_000);
    expect(lines.find((line) => line.personId === ids.linh)?.reviewScoreBp).toBe(10_000);
  });
});

// ── The final yearly result ─────────────────────────────────────────────────────────────────

describe("the weighting is configuration the owner approves", () => {
  it("refuses to compute before a version is approved, and uses the version in force at year end", async () => {
    expect(await fails(computeResults({ personIds: [ids.huy], year: 2026 }, ids.mai))).toBe("weighting_missing");
    const proposal = await proposeWeighting({ entityId: null, value: DEFAULT_PERFORMANCE_WEIGHTING, validFrom: "2026-01-01", note: null }, ids.mai);
    // Still nothing: a proposal is not a rule.
    expect(await fails(getWeighting(null, "2026-12-31"))).toBe("weighting_missing");
    await decideWeighting(proposal.id, "approve", ids.owner);
    expect((await getWeighting(null, "2026-12-31")).value.kpiBp).toBe(DEFAULT_PERFORMANCE_WEIGHTING.kpiBp);
  });

  it("refuses a version that starts before the one in force, and closes the old one when it succeeds", async () => {
    const early = await proposeWeighting({ entityId: null, value: DEFAULT_PERFORMANCE_WEIGHTING, validFrom: "2025-06-01", note: null }, ids.mai);
    expect(await fails(decideWeighting(early.id, "approve", ids.owner))).toBe("weighting_before_current_version");
    const later = await proposeWeighting({ entityId: null, value: { ...DEFAULT_PERFORMANCE_WEIGHTING, reviewBp: 4000, kpiBp: 4000, okrBp: 2000 }, validFrom: "2027-01-01", note: null }, ids.mai);
    await decideWeighting(later.id, "approve", ids.owner);
    // 2026 still reads the first version; 2027 reads the new one.
    expect((await getWeighting(null, "2026-12-31")).value.reviewBp).toBe(3000);
    expect((await getWeighting(null, "2027-12-31")).value.reviewBp).toBe(4000);
  });

  it("refuses weights that do not add up", async () => {
    expect(await fails(proposeWeighting({ entityId: null, value: { ...DEFAULT_PERFORMANCE_WEIGHTING, reviewBp: 9000 }, validFrom: "2028-01-01", note: null }, ids.mai))).toBe("weighting_weights_not_full");
    expect(await fails(proposeWeighting({ entityId: null, value: { ...DEFAULT_PERFORMANCE_WEIGHTING, okrMix: { ...DEFAULT_PERFORMANCE_WEIGHTING.okrMix, groupBp: 9000 } }, validFrom: "2028-01-01", note: null }, ids.mai))).toBe("weighting_okr_mix_not_full");
  });
});

describe("compute → override → lock → publish", () => {
  it("computes from the released review with the KPI and OKR components missing, and renormalises", async () => {
    const summary = await computeResults({ personIds: [ids.huy, ids.linh], year: 2026 }, ids.mai);
    expect(summary.computed).toBe(2);
    const row = (await findResult(ids.huy, 2026))!;
    // Only the review has a figure, so it carries the whole weight: the score is the review's.
    expect(row.reviewScoreBp).toBe(13_000);
    expect(row.kpiScoreBp).toBeNull();
    expect(row.computedScoreBp).toBe(13_000);
    expect(row.trace.renormalised).toBe(true);
    expect(row.trace.notes).toContain("missing_kpi");
    expect(row.finalBand).toBe("outstanding");
    expect(row.multiplierBp).toBe(15_000);
    expect(row.status).toBe("draft");
  });

  it("keeps the computed figure beside the owner's override and needs a reason", async () => {
    const row = (await findResult(ids.huy, 2026))!;
    const { after } = await overrideResult(row.id, { scoreBp: 10_500, reason: "Cân đối với mặt bằng chung của bộ phận" }, ids.owner);
    expect(after.computedScoreBp).toBe(13_000);
    expect(after.overrideScoreBp).toBe(10_500);
    expect(after.finalScoreBp).toBe(10_500);
    expect(after.finalBand).toBe("exceeds");
    expect(after.multiplierBp).toBe(12_500);
    expect(after.trace.override?.reason).toContain("Cân đối");
    expect(after.trace.notes).toContain("overridden");
  });

  it("keeps the override when the row is recomputed", async () => {
    await computeResults({ personIds: [ids.huy], year: 2026 }, ids.mai);
    const row = (await findResult(ids.huy, 2026))!;
    expect(row.overrideScoreBp).toBe(10_500);
    expect(row.finalScoreBp).toBe(10_500);
  });

  it("locks, refuses a second override, publishes, and only then hands the figure to the bonus run", async () => {
    const row = (await findResult(ids.huy, 2026))!;
    expect((await listFinalResults({ year: 2026 })).has(ids.huy)).toBe(false);

    await lockResult(row.id, ids.mai);
    expect(await fails(overrideResult(row.id, { scoreBp: 12_000, reason: "Nghĩ lại" }, ids.owner))).toBe("result_locked");
    expect(await fails(lockResult(row.id, ids.mai))).toBe("result_locked");
    // Locked is already enough for the bonus run: it does not wait for the person to be told.
    expect((await listFinalResults({ year: 2026 })).get(ids.huy)?.finalScoreBp).toBe(10_500);

    await publishResult(row.id, ids.mai);
    expect((await findResult(ids.huy, 2026))?.status).toBe("published");
    expect(await fails(publishResult(row.id, ids.mai))).toBe("result_published");
  });

  it("leaves a settled row alone when the year is recomputed, and says so", async () => {
    const summary = await computeResults({ personIds: [ids.huy, ids.linh], year: 2026 }, ids.mai);
    expect(summary.computed).toBe(1);
    expect(summary.skipped).toEqual([{ personId: ids.huy, reason: "published" }]);
  });

  it("refuses to lock a result nothing scored", async () => {
    await computeResults({ personIds: [ids.tam], year: 2026 }, ids.mai);
    const row = (await findResult(ids.tam, 2026))!;
    expect(row.computedScoreBp).toBeNull();
    expect(row.trace.notes).toContain("nothing_scored");
    expect(await fails(lockResult(row.id, ids.mai))).toBe("result_nothing_scored");
  });
});

// ── What Phase 3.5 asked Phase 8 to enforce ─────────────────────────────────────────────────

describe("a KPI month a bonus run has been approved from cannot be reopened", () => {
  it("reopens freely until a run consumes the month, then refuses with the consumer's id", async () => {
    // A closed month with one stored score, exactly as Phase 3.5 leaves it.
    await db().insert(schema.kpiPeriod).values({ entityId: ids.szm, month: "2026-11", status: "closed", closedByPersonId: ids.mai, closedAt: new Date() });
    const [score] = await db()
      .insert(schema.kpiScore)
      .values({ personId: ids.huy, entityId: ids.szm, month: "2026-11", revision: 1, scoreBp: 10_500, trace: { version: 1, month: "2026-11", lines: [], missingAs: "excluded", countedWeight: 0, scoreBp: 10_500, notes: [] } as never, inputsHash: "hash" })
      .returning();

    // Nothing has been paid from it yet, so HR may still take it back.
    const reopened = await reopenMonth(ids.mai, { entityId: ids.szm, month: "2026-11", reason: "Sai số liệu tháng 11" });
    expect(reopened.superseded).toBe(1);

    // Close it again: a stored score is never rewritten (a trigger refuses it), so the re-close
    // writes revision 2 beside the superseded one — exactly what Phase 3.5's `closeMonth` does.
    const [revision2] = await db()
      .insert(schema.kpiScore)
      .values({ personId: ids.huy, entityId: ids.szm, month: "2026-11", revision: 2, scoreBp: 10_800, trace: score.trace, inputsHash: "hash2" })
      .returning();
    await db().update(schema.kpiPeriod).set({ status: "closed" }).where(eq(schema.kpiPeriod.entityId, ids.szm));
    const runId = "00000000-0000-4000-8000-0000000000aa";
    const use = [{ scoreId: revision2.id, personId: ids.huy, entityId: ids.szm, month: "2026-11" }];
    expect(await markScoresConsumed({ consumerType: "bonus_run", consumerId: runId, year: 2026, uses: use })).toBe(1);
    // Marking it twice is harmless: the same run approved again consumes nothing new.
    expect(await markScoresConsumed({ consumerType: "bonus_run", consumerId: runId, year: 2026, uses: use })).toBe(0);

    const refusal = reopenMonth(ids.mai, { entityId: ids.szm, month: "2026-11", reason: "Vẫn muốn sửa" });
    expect(await fails(refusal)).toBe("kpi_month_consumed");
    expect(await detailsOf(reopenMonth(ids.mai, { entityId: ids.szm, month: "2026-11", reason: "Vẫn muốn sửa" }))).toEqual({ consumerType: "bonus_run", consumerIds: [runId] });
    // The score the run was approved off is untouched by the refused reopen.
    expect((await db().select().from(schema.kpiScore).where(eq(schema.kpiScore.id, revision2.id)))[0].supersededAt).toBeNull();

    // A cancelled run gives the month back.
    expect(await releaseConsumedScores(runId)).toBe(1);
    expect((await reopenMonth(ids.mai, { entityId: ids.szm, month: "2026-11", reason: "Run đã huỷ" })).superseded).toBe(1);
  });

  it("refuses to unlock a result whose year has been paid from", async () => {
    const row = (await findResult(ids.linh, 2026))!;
    await lockResult(row.id, ids.mai);
    const runId = "00000000-0000-4000-8000-0000000000bb";
    const [score] = await db().select().from(schema.kpiScore).limit(1);
    await markScoresConsumed({ consumerType: "bonus_run", consumerId: runId, year: 2026, uses: [{ scoreId: score.id, personId: ids.linh, entityId: ids.szm, month: "2026-11" }] });
    expect(await fails(unlockResult(row.id))).toBe("result_consumed");
    await releaseConsumedScores(runId);
    expect((await unlockResult(row.id)).after.status).toBe("draft");
  });
});
