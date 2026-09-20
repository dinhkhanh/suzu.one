// Review cycles against a real Postgres (PGlite): the template's checks, launch (snapshot of the
// form and of each manager), the self → manager ordering rule, calibration, release, the
// acknowledgement, and the figure week 2's final yearly result reads back.
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

import { and, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { migrateTestDb } from "../../../tests/helpers/db";
import type { RatingPoint, ReviewSection } from "./enums";
import { loadDirectory } from "./people";
import { canReadReviewForm, canWriteManagerReview } from "./review-policy";
import {
  acknowledgeParticipant,
  addParticipant,
  advanceReviewCycle,
  calibrateParticipant,
  cycleProgress,
  type CycleInput,
  launchReviewCycle,
  listCycleParticipants,
  listMyParticipations,
  listReleasedReviewScores,
  listReviewsIOwe,
  loadParticipant,
  partiesOfParticipant,
  releaseParticipant,
  removeParticipant,
  saveReviewCycle,
  saveReviewForm,
  saveReviewTemplate,
} from "./reviews";

type Who = "owner" | "mai" | "long" | "tam" | "huy" | "linh" | "ngo";
const ids = {} as Record<Who | "szm" | "szc" | "vid" | "bod", string>;
const fails = (promise: Promise<unknown>) => promise.then(() => "no error", (error: Error & { details?: unknown }) => error.message);
const detailsOf = (promise: Promise<unknown>) => promise.then(() => null, (error: Error & { details?: unknown }) => error.details);

const SCALE: RatingPoint[] = [
  { value: 1, label: "Chưa đạt", labelEn: "Below", scoreBp: 4000 },
  { value: 3, label: "Đạt yêu cầu", labelEn: "Meets", scoreBp: 10000 },
  { value: 5, label: "Xuất sắc", labelEn: "Outstanding", scoreBp: 13000 },
];
const SECTIONS: ReviewSection[] = [
  { key: "quality", title: "Chất lượng công việc", titleEn: "Quality", kind: "rating", weight: 3, required: true, askedOf: ["self", "manager", "peer"] },
  { key: "teamwork", title: "Phối hợp", titleEn: "Teamwork", kind: "rating", weight: 2, required: true, askedOf: ["self", "manager", "peer"] },
  { key: "highlights", title: "Điểm nổi bật", titleEn: "Highlights", kind: "text", weight: 0, required: false, askedOf: ["self", "manager", "peer"] },
];

const template = (over: Partial<Parameters<typeof saveReviewTemplate>[1]> = {}) => ({ name: "Đánh giá năm", nameEn: "Annual", description: null, sections: SECTIONS, ratingScale: SCALE, isActive: true, ...over });
const cycle = (over: Partial<CycleInput> = {}): CycleInput => ({
  entityId: ids.szm,
  name: "Đánh giá năm 2026",
  kind: "annual",
  year: 2026,
  periodStart: "2026-01-01",
  periodEnd: "2026-12-31",
  templateId: "",
  selfDueOn: "2026-12-10",
  managerDueOn: "2026-12-20",
  peerDueOn: "2026-12-15",
  calibrationOn: "2026-12-22",
  releaseOn: "2026-12-28",
  peersEnabled: true,
  peerMin: 1,
  peerMax: 3,
  peerAnonymous: true,
  ...over,
});

let templateId = "";

beforeAll(async () => {
  await migrateTestDb();
  const [szm] = await db().insert(schema.entity).values({ code: "SZM", legalName: "Suzu Media", shortName: "Media" }).returning();
  const [vid] = await db().insert(schema.department).values({ code: "VID", name: "Video" }).returning();
  const [bod] = await db().insert(schema.department).values({ code: "BOD", name: "Board" }).returning();
  // A second entity nobody works at: a cycle aimed there has no participants.
  const [szc] = await db().insert(schema.entity).values({ code: "SZC", legalName: "Suzu Creative", shortName: "Creative" }).returning();
  Object.assign(ids, { szm: szm.id, szc: szc.id, vid: vid.id, bod: bod.id });

  // owner → long → tam → huy; linh also under tam; ngo is a collaborator and never a participant.
  const people: [Who, string, Who | null, "active", "employee" | "collaborator"][] = [
    ["owner", bod.id, null, "active", "employee"],
    ["mai", bod.id, "owner", "active", "employee"],
    ["long", vid.id, "owner", "active", "employee"],
    ["tam", vid.id, "long", "active", "employee"],
    ["huy", vid.id, "tam", "active", "employee"],
    ["linh", vid.id, "tam", "active", "employee"],
    ["ngo", vid.id, "tam", "active", "collaborator"],
  ];
  for (const [key, departmentId, manager, status, workforceType] of people) {
    const [row] = await db().insert(schema.person).values({ fullName: key, searchName: key, workEmail: `${key}@suzu.group`, status, workforceType, primaryEntityId: szm.id, departmentId, managerId: manager ? ids[manager] : null }).returning();
    ids[key] = row.id;
  }
  templateId = (await saveReviewTemplate(null, template(), ids.mai)).after.id;
});

describe("templates", () => {
  it("refuses a template that scores nothing, has a one-point scale or repeats a key", async () => {
    expect(await fails(saveReviewTemplate(null, template({ sections: [{ ...SECTIONS[2] }] }), ids.mai))).toBe("review_template_unscored");
    expect(await fails(saveReviewTemplate(null, template({ ratingScale: [SCALE[0]] }), ids.mai))).toBe("review_template_scale_short");
    expect(await fails(saveReviewTemplate(null, template({ sections: [SECTIONS[0], { ...SECTIONS[1], key: "quality" }] }), ids.mai))).toBe("review_template_duplicate_key");
    expect(await fails(saveReviewTemplate(null, template({ sections: [{ ...SECTIONS[0], askedOf: [] }] }), ids.mai))).toBe("review_template_unasked_section");
    expect(await fails(saveReviewTemplate(null, template({ sections: [] }), ids.mai))).toBe("review_template_empty");
  });
});

describe("a cycle's timeline and launch", () => {
  it("refuses a period that runs backwards and a timeline out of order", async () => {
    expect(await fails(saveReviewCycle(null, cycle({ templateId, periodStart: "2026-12-31", periodEnd: "2026-01-01" }), ids.mai))).toBe("review_period_backwards");
    expect(await fails(saveReviewCycle(null, cycle({ templateId, selfDueOn: "2026-12-20", managerDueOn: "2026-12-10" }), ids.mai))).toBe("review_timeline_backwards");
    expect(await fails(saveReviewCycle(null, cycle({ templateId, selfDueOn: "2025-12-01" }), ids.mai))).toBe("review_timeline_before_period");
    expect(await fails(saveReviewCycle(null, cycle({ templateId, peerMin: 4, peerMax: 2 }), ids.mai))).toBe("review_peer_range");
    expect(await fails(saveReviewCycle(null, cycle({ templateId: "00000000-0000-4000-8000-000000000000" }), ids.mai))).toBe("review_template_not_found");
  });

  it("snapshots the form and every manager at launch, and leaves collaborators out", async () => {
    const created = (await saveReviewCycle(null, cycle({ templateId }), ids.mai)).after;
    expect(created.status).toBe("draft");
    expect(created.formSnapshot).toBeNull();

    const launched = await launchReviewCycle(created.id, ids.mai);
    expect(launched.cycle.status).toBe("active");
    expect(launched.cycle.formSnapshot?.sections).toHaveLength(3);
    expect(launched.cycle.formSnapshot?.ratingScale).toEqual(SCALE);
    // Six employees of SZM; the collaborator is not reviewed.
    expect(launched.participants).toBe(6);
    const lines = await listCycleParticipants(created.id);
    expect(lines.map((line) => line.personName).sort()).toEqual(["huy", "linh", "long", "mai", "owner", "tam"]);
    expect(lines.find((line) => line.personName === "huy")!.managerName).toBe("tam");
    expect(lines.every((line) => line.stage === "pending")).toBe(true);

    // Editing a launched cycle, and launching it twice, are both refused.
    expect(await fails(saveReviewCycle(created.id, cycle({ templateId, name: "other" }), ids.mai))).toBe("review_cycle_launched");
    expect(await fails(launchReviewCycle(created.id, ids.mai))).toBe("review_cycle_launched");

    // Changing the template afterwards leaves the snapshot alone — what people were asked is fixed.
    await saveReviewTemplate(templateId, template({ sections: [...SECTIONS, { key: "extra", title: "Thêm", titleEn: null, kind: "rating", weight: 5, required: true, askedOf: ["manager"] }] }), ids.mai);
    const reread = await loadParticipant(lines[0].participantId);
    expect(reread!.shape!.sections).toHaveLength(3);
    // Put the template back for the other tests.
    await saveReviewTemplate(templateId, template(), ids.mai);
  });

  it("refuses to launch a cycle nobody is in", async () => {
    const empty = (await saveReviewCycle(null, cycle({ templateId, name: "Nobody", entityId: ids.szc }), ids.mai)).after;
    expect(await fails(launchReviewCycle(empty.id, ids.mai))).toBe("review_cycle_no_participants");
  });
});

describe("writing, releasing and acknowledging", () => {
  let cycleId = "";
  let huyParticipant = "";
  let linhParticipant = "";

  beforeAll(async () => {
    cycleId = (await saveReviewCycle(null, cycle({ templateId, name: "Main cycle" }), ids.mai)).after.id;
    await launchReviewCycle(cycleId, ids.mai);
    const lines = await listCycleParticipants(cycleId);
    huyParticipant = lines.find((line) => line.personName === "huy")!.participantId;
    linhParticipant = lines.find((line) => line.personName === "linh")!.participantId;
  });

  it("saves a draft, keeps it out of the score, then scores it on submission", async () => {
    const draft = await saveReviewForm({ participantId: huyParticipant, kind: "self", answers: { quality: 5 }, comment: null, submit: false }, ids.huy);
    expect(draft.after.status).toBe("draft");
    expect(draft.after.overallRatingBp).toBeNull();
    expect(draft.participant.stage).toBe("pending");

    // A required section left blank refuses the submission and names it.
    expect(await fails(saveReviewForm({ participantId: huyParticipant, kind: "self", answers: { quality: 5 }, comment: null, submit: true }, ids.huy))).toBe("review_form_incomplete");
    expect(await detailsOf(saveReviewForm({ participantId: huyParticipant, kind: "self", answers: { quality: 5 }, comment: null, submit: true }, ids.huy))).toEqual({ missing: ["teamwork"] });

    const done = await saveReviewForm({ participantId: huyParticipant, kind: "self", answers: { quality: 5, teamwork: 3, highlights: "Học xong DaVinci." }, comment: "Một năm tốt.", submit: true }, ids.huy);
    // (3 × 13000 + 2 × 10000) / 5 = 59000 / 5 = 11800
    expect(done.after.overallRatingBp).toBe(11800);
    expect(done.after.scoreTrace?.lines).toHaveLength(3);
    expect(done.participant.stage).toBe("self_done");
    // A submitted form is not reopened by saving over it.
    expect(await fails(saveReviewForm({ participantId: huyParticipant, kind: "self", answers: { quality: 1, teamwork: 1 }, comment: null, submit: false }, ids.huy))).toBe("review_form_submitted");
  });

  it("will not let a manager submit before the person has had their say", async () => {
    // linh has not written; the self due date has not passed on this date.
    expect(await fails(saveReviewForm({ participantId: linhParticipant, kind: "manager", answers: { quality: 3, teamwork: 3 }, comment: null, submit: true }, ids.tam, "2026-12-01"))).toBe("review_self_not_submitted");
    // A draft is fine at any time — only the submission waits.
    expect((await saveReviewForm({ participantId: linhParticipant, kind: "manager", answers: { quality: 3 }, comment: null, submit: false }, ids.tam, "2026-12-01")).after.status).toBe("draft");
    // Once the self-review due date has passed, the manager is no longer blocked by silence.
    const late = await saveReviewForm({ participantId: linhParticipant, kind: "manager", answers: { quality: 3, teamwork: 3 }, comment: null, submit: true }, ids.tam, "2026-12-11");
    expect(late.after.status).toBe("submitted");
    expect(late.participant.stage).toBe("manager_done");
  });

  it("carries the manager's figure through calibration and release, and freezes it", async () => {
    const manager = await saveReviewForm({ participantId: huyParticipant, kind: "manager", answers: { quality: 3, teamwork: 5, highlights: "Tiến bộ rõ." }, comment: "Đồng ý phần lớn.", submit: true }, ids.tam, "2026-12-15");
    // (3 × 10000 + 2 × 13000) / 5 = 56000 / 5 = 11200
    expect(manager.after.overallRatingBp).toBe(11200);

    // Release before calibration takes the manager's figure as it stands.
    const other = await releaseParticipant(linhParticipant, ids.tam);
    expect(other.after.reviewScoreBp).toBe(10000);
    expect(other.after.stage).toBe("released");
    expect(await fails(releaseParticipant(linhParticipant, ids.tam))).toBe("review_already_released");

    // Calibration moves the figure the yearly result reads, with a note, and leaves the form alone.
    const levelled = await calibrateParticipant(huyParticipant, { reviewScoreBp: 10800, note: "Cân đối với phòng." }, ids.long);
    expect(levelled.after.reviewScoreBp).toBe(10800);
    expect(levelled.after.stage).toBe("calibrated");
    const forms = await loadParticipant(huyParticipant);
    expect(forms!.forms.find((form) => form.kind === "manager")!.overallRatingBp).toBe(11200);

    const released = await releaseParticipant(huyParticipant, ids.tam);
    expect(released.after.reviewScoreBp).toBe(10800); // the calibrated one wins
    expect(await fails(calibrateParticipant(huyParticipant, { reviewScoreBp: 9000, note: "too late" }, ids.long))).toBe("review_already_released");
  });

  it("refuses to release before the manager has written", async () => {
    const lines = await listCycleParticipants(cycleId);
    const untouched = lines.find((line) => line.personName === "owner")!;
    expect(await fails(releaseParticipant(untouched.participantId, ids.mai))).toBe("review_manager_not_submitted");
  });

  it("takes the acknowledgement once, and only after release", async () => {
    const lines = await listCycleParticipants(cycleId);
    const tam = lines.find((line) => line.personName === "tam")!;
    expect(await fails(acknowledgeParticipant(tam.participantId, null))).toBe("review_not_released");

    const done = await acknowledgeParticipant(huyParticipant, "Đã đọc và đồng ý.");
    expect(done.after.stage).toBe("acknowledged");
    expect(done.after.acknowledgementNote).toBe("Đã đọc và đồng ý.");
    expect(await fails(acknowledgeParticipant(huyParticipant, null))).toBe("review_already_acknowledged");
  });

  it("reads back what the screens and week 2 need", async () => {
    const mine = await listMyParticipations(ids.huy);
    expect(mine.map((line) => line.participantId)).toContain(huyParticipant);
    expect(mine.find((line) => line.participantId === huyParticipant)!.reviewScoreBp).toBe(10800);

    // Every live cycle tam owes a review in — this one has both of their reports.
    const owed = await listReviewsIOwe(ids.tam);
    expect(owed.filter((line) => line.cycleId === cycleId).map((line) => line.personName).sort()).toEqual(["huy", "linh"]);
    expect(owed.every((line) => line.managerPersonId === ids.tam)).toBe(true);

    const progress = (await cycleProgress([cycleId])).get(cycleId)!;
    expect(progress.participants).toBe(6);
    expect(progress.selfDone).toBe(1);
    expect(progress.managerDone).toBe(2);
    expect(progress.released).toBe(2);

    // What FR-PRF-09 will read in week 2: the released figure per person for the year.
    const scores = await listReleasedReviewScores(2026);
    expect(scores.get(ids.huy)?.reviewScoreBp).toBe(10800);
    expect(scores.get(ids.linh)?.reviewScoreBp).toBe(10000);
    expect(scores.has(ids.owner)).toBe(false);
  });

  it("hands the policy parties that match what was stored", async () => {
    const loaded = await loadParticipant(huyParticipant);
    const parties = partiesOfParticipant(loaded!.participant, loaded!.cycle, loaded!.directory)!;
    expect(parties.subject.personId).toBe(ids.huy);
    expect(parties.managerPersonId).toBe(ids.tam);
    expect(parties.released).toBe(true);
    expect(parties.peerAnonymous).toBe(true);
    // The rules hold against real rows, not only against hand-made ones.
    const principal = (personId: string) => ({ personId, workforceType: "employee" as const, grants: [] });
    const managerForm = loaded!.forms.find((form) => form.kind === "manager")!;
    const shape = { kind: "manager" as const, authorPersonId: managerForm.authorPersonId, status: "submitted" as const };
    expect(canReadReviewForm(principal(ids.huy), parties, shape)).toBe(true); // released
    expect(canReadReviewForm(principal(ids.linh), parties, shape)).toBe(false); // a colleague
    expect(canWriteManagerReview(principal(ids.tam), parties)).toBe(true);
    expect(canWriteManagerReview(principal(ids.huy), parties)).toBe(false);
  });

  it("moves the cycle forward one step at a time", async () => {
    expect(await fails(advanceReviewCycle(cycleId, "closed"))).toBe("review_cycle_bad_step");
    expect((await advanceReviewCycle(cycleId, "calibration")).after.status).toBe("calibration");
    // Writing stops once the cycle leaves "active".
    expect(await fails(saveReviewForm({ participantId: huyParticipant, kind: "self", answers: {}, comment: null, submit: false }, ids.huy))).toBe("review_cycle_not_collecting");
    expect((await advanceReviewCycle(cycleId, "released")).after.status).toBe("released");
    expect((await advanceReviewCycle(cycleId, "closed")).after.closedAt).not.toBeNull();
  });
});

describe("participants HR adds and removes by hand", () => {
  it("adds somebody who was missed and refuses to remove one who has been written about", async () => {
    const created = (await saveReviewCycle(null, cycle({ templateId, name: "Hand-edited", entityId: ids.szm }), ids.mai)).after;
    await launchReviewCycle(created.id, ids.mai);
    const directory = await loadDirectory();
    // The collaborator was left out; HR can still put them in deliberately.
    const added = await addParticipant(created.id, ids.ngo, directory);
    expect(added.managerPersonId).toBe(ids.tam);
    expect(await fails(addParticipant(created.id, ids.ngo, directory))).toBe("review_participant_exists");

    await removeParticipant(added.id);
    expect((await listCycleParticipants(created.id)).some((line) => line.personId === ids.ngo)).toBe(false);

    const huyLine = (await listCycleParticipants(created.id)).find((line) => line.personId === ids.huy)!;
    await saveReviewForm({ participantId: huyLine.participantId, kind: "self", answers: { quality: 3 }, comment: null, submit: false }, ids.huy);
    expect(await fails(removeParticipant(huyLine.participantId))).toBe("review_participant_has_forms");
  });
});

describe("the record on disk", () => {
  it("keeps one form per author and kind, and stores the trace beside the figure", async () => {
    const rows = await db().select().from(schema.reviewForm).where(and(eq(schema.reviewForm.kind, "self"), eq(schema.reviewForm.status, "submitted")));
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.scoreTrace).not.toBeNull();
      expect(row.scoreTrace!.scoreBp).toBe(row.overallRatingBp);
      expect(row.submittedAt).not.toBeNull();
    }
  });
});
