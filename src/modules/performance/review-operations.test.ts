// Review cycles made operable (PRF-01) against a real Postgres (PGlite): templates for a kind of
// cycle, a rolling probation cycle fed by probation contracts, people added by hand with their own
// deadlines, the sign-off conversation, a form sent back for changes, the launch notices and the
// morning reminders.
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

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
type Notice = { recipients: readonly string[]; kind: string; params?: Record<string, unknown>; link?: string | null };
const notify = vi.fn<(input: Notice) => Promise<void>>(async () => undefined);
vi.mock("@/modules/platform/notifications/service", () => ({ notify: (input: never) => notify(input) }));

import { and, eq } from "drizzle-orm";
import { addDays, todayInVietnam } from "@/lib/dates";
import { db, schema } from "@/lib/db";
import { migrateTestDb } from "../../../tests/helpers/db";
import type { RatingPoint, ReviewSection } from "./enums";
import { loadDirectory } from "./people";
import { enrolProbationReviews } from "./probation-reviews";
import { sendOpenNotices } from "./review-notices";
import { sendReviewReminders } from "./review-reminders";
import {
  acknowledgeParticipant,
  addParticipant,
  advanceReviewCycle,
  type CycleInput,
  launchReviewCycle,
  listCycleParticipants,
  loadParticipant,
  partiesOfParticipant,
  recordSignOff,
  releaseParticipant,
  removeParticipant,
  returnReviewForm,
  saveReviewCycle,
  saveReviewForm,
  saveReviewTemplate,
  type TemplateInput,
} from "./reviews";

type Who = "mai" | "tam" | "huy" | "linh" | "an" | "ngo";
const ids = {} as Record<Who | "szm" | "vid" | "annual" | "probation", string>;
const fails = (promise: Promise<unknown>) =>
  promise.then(
    () => "no error",
    (error: Error) => error.message,
  );

const SCALE: RatingPoint[] = [
  { value: 1, label: "Chưa đạt", labelEn: null, scoreBp: 5000 },
  { value: 2, label: "Đạt", labelEn: null, scoreBp: 10000 },
];
const SECTIONS: ReviewSection[] = [{ key: "quality", title: "Chất lượng", titleEn: null, kind: "rating", weight: 1, required: true, askedOf: ["self", "manager"] }];
const template = (over: Partial<TemplateInput> = {}): TemplateInput => ({ name: "Đánh giá năm", nameEn: null, description: null, kinds: ["annual"], sections: SECTIONS, ratingScale: SCALE, isActive: true, ...over });
const cycle = (over: Partial<CycleInput> = {}): CycleInput => ({
  entityId: ids.szm,
  name: "Đánh giá năm 2026",
  kind: "annual",
  year: 2026,
  periodStart: "2026-01-01",
  periodEnd: "2026-12-31",
  templateId: ids.annual,
  selfDueOn: "2026-12-10",
  managerDueOn: "2026-12-20",
  peerDueOn: null,
  calibrationOn: null,
  releaseOn: null,
  peersEnabled: false,
  peerMin: 0,
  peerMax: 0,
  peerAnonymous: true,
  signOffRequired: false,
  isRolling: false,
  ...over,
});
const answer = { quality: 2 };
const lineOf = async (cycleId: string, personId: string) => (await listCycleParticipants(cycleId)).find((line) => line.personId === personId)!;
const callsOf = (kind: string) => notify.mock.calls.map(([input]) => input).filter((input) => input.kind === kind);

/** A probation contract on a fresh employment; `next` adds the labour contract that follows it. */
async function probation(personId: string, code: string, start: string, end: string, next = false) {
  const [employment] = await db().insert(schema.employment).values({ personId, entityId: ids.szm, employeeCode: code, startDate: start, seniorityDate: start }).returning();
  await db()
    .insert(schema.contract)
    .values({ employmentId: employment.id, personId, entityId: ids.szm, number: `${code}/TV`, type: "probation", startDate: start, endDate: end });
  if (next)
    await db()
      .insert(schema.contract)
      .values({ employmentId: employment.id, personId, entityId: ids.szm, number: `${code}/HĐ`, type: "indefinite", startDate: addDays(end, 1) });
}

beforeAll(async () => {
  await migrateTestDb();
  const [szm] = await db().insert(schema.entity).values({ code: "SZM", legalName: "SuZu Media", shortName: "Media" }).returning();
  const [vid] = await db().insert(schema.orgUnit).values({ code: "VID", name: "Video" }).returning();
  Object.assign(ids, { szm: szm.id, vid: vid.id });
  // mai is HR; tam manages huy, linh, an and the collaborator ngo.
  const people: [Who, Who | null, "employee" | "probation" | "collaborator"][] = [
    ["mai", null, "employee"],
    ["tam", null, "employee"],
    ["huy", "tam", "employee"],
    ["linh", "tam", "probation"],
    ["an", "tam", "probation"],
    ["ngo", "tam", "collaborator"],
  ];
  for (const [key, manager, workforceType] of people) {
    const [row] = await db()
      .insert(schema.person)
      .values({ fullName: key, searchName: key, workEmail: `${key}@suzu.group`, status: "active", workforceType, primaryEntityId: szm.id, orgUnitId: vid.id, managerId: manager ? ids[manager] : null })
      .returning();
    ids[key] = row.id;
  }
  // The company's probation countdown (company practice, HR's alert): 10 and 3 days before the end.
  await db()
    .insert(schema.statutoryParameter)
    .values({ key: "hr.alert_thresholds", validFrom: "2021-01-01", value: { contractExpiryDays: [30], probationEndDays: [10, 3], documentExpiryDays: [30] }, status: "approved", isVerified: false, legalReference: "test" });
  ids.annual = (await saveReviewTemplate(null, template(), ids.mai)).after.id;
  ids.probation = (await saveReviewTemplate(null, template({ name: "Hết thử việc", kinds: ["probation"] }), ids.mai)).after.id;
});

beforeEach(() => notify.mockClear());

describe("a template is for a kind of cycle", () => {
  it("is offered to that kind only, and checked again at launch", async () => {
    expect(await fails(saveReviewCycle(null, cycle({ templateId: ids.probation }), ids.mai))).toBe("review_template_wrong_kind");
    expect((await saveReviewCycle(null, cycle({ kind: "probation", templateId: ids.probation }), ids.mai)).after.kind).toBe("probation");
    // A template that names no kind suits every cycle.
    const any = (await saveReviewTemplate(null, template({ name: "Chung", kinds: [] }), ids.mai)).after.id;
    expect((await saveReviewCycle(null, cycle({ kind: "mid_year", templateId: any }), ids.mai)).after.templateId).toBe(any);

    // Narrowed after the cycle was built: the launch refuses it rather than ask the wrong questions.
    const draft = (await saveReviewCycle(null, cycle({ name: "Narrowed", kind: "mid_year", templateId: any }), ids.mai)).after;
    await saveReviewTemplate(any, template({ name: "Chung", kinds: ["annual"] }), ids.mai);
    expect(await fails(launchReviewCycle(draft.id, ids.mai))).toBe("review_template_wrong_kind");
  });

  it("refuses a form whose manager is asked nothing that scores, with every problem in the details", async () => {
    const failure = await saveReviewTemplate(null, template({ name: "", sections: [{ ...SECTIONS[0], askedOf: ["self"] }] }), ids.mai).then(
      () => null,
      (error: Error & { details?: { problems: string[] } }) => error,
    );
    expect(failure?.message).toBe("review_template_name_empty");
    expect(failure?.details?.problems).toEqual(["review_template_name_empty", "review_template_manager_unscored"]);
  });
});

describe("a rolling probation cycle", () => {
  let cycleId = "";

  it("is only for probation, and launches with nobody in it", async () => {
    expect(await fails(saveReviewCycle(null, cycle({ isRolling: true }), ids.mai))).toBe("review_rolling_not_probation");
    const created = (await saveReviewCycle(null, cycle({ name: "Hết thử việc 2026", kind: "probation", templateId: ids.probation, isRolling: true, selfDueOn: null, managerDueOn: null }), ids.mai)).after;
    const launched = await launchReviewCycle(created.id, ids.mai);
    expect(launched.cycle.status).toBe("active");
    expect(launched.participants).toBe(0);
    cycleId = created.id;
  });

  it("takes in each probation as it nears its end, with deadlines from its last day", async () => {
    // linh's probation ends 14 November; an's ends 30 November; huy's was already followed by a
    // labour contract; the collaborator is never reviewed.
    await probation(ids.linh, "SZM-0101", "2026-09-15", "2026-11-14");
    await probation(ids.an, "SZM-0102", "2026-10-01", "2026-11-30");
    await probation(ids.huy, "SZM-0103", "2026-09-01", "2026-11-12", true);
    await probation(ids.ngo, "SZM-0104", "2026-09-01", "2026-11-13");

    // Four days before linh's window opens: nobody.
    expect(await enrolProbationReviews("2026-11-01")).toEqual([]);
    // Inside it: linh, with the person's day 7 and the manager's 3 days before the end.
    const enrolled = await enrolProbationReviews("2026-11-04");
    expect(enrolled.map((row) => row.personId)).toEqual([ids.linh]);
    expect(enrolled[0]).toMatchObject({ cycleId, managerPersonId: ids.tam, selfDueOn: "2026-11-07", managerDueOn: "2026-11-11", cycleName: "Hết thử việc 2026" });
    // A second run the same day, or the next, puts nobody in twice.
    expect(await enrolProbationReviews("2026-11-04")).toEqual([]);
    expect(await enrolProbationReviews("2026-11-05")).toEqual([]);

    // Told: linh that her review is open, tam that he owes one.
    await sendOpenNotices(enrolled);
    expect(callsOf("performance.review_open")).toEqual([expect.objectContaining({ recipients: [ids.linh], params: { cycle: "Hết thử việc 2026", date: "2026-11-07" } })]);
    expect(callsOf("performance.reviews_owed")).toEqual([expect.objectContaining({ recipients: [ids.tam], params: { cycle: "Hết thử việc 2026", date: "2026-11-11", count: 1 } })]);
  });

  it("does not put back somebody HR took out", async () => {
    const enrolled = await enrolProbationReviews("2026-11-21");
    expect(enrolled.map((row) => row.personId)).toEqual([ids.an]);
    await removeParticipant(enrolled[0].participantId);
    expect(await enrolProbationReviews("2026-11-22")).toEqual([]);
    // HR may still put them in by hand, with deadlines of their own.
    const { participant } = await addParticipant(cycleId, ids.an, await loadDirectory(), undefined, { selfDueOn: "2026-11-25", managerDueOn: "2026-11-27" });
    expect(participant).toMatchObject({ selfDueOn: "2026-11-25", managerDueOn: "2026-11-27" });
    expect(await fails(addParticipant(cycleId, ids.huy, await loadDirectory(), undefined, { selfDueOn: "2026-11-27", managerDueOn: "2026-11-25" }))).toBe("review_timeline_backwards");
  });

  it("holds the manager to the person's own self-review deadline", async () => {
    const linh = await lineOf(cycleId, ids.linh);
    expect(linh).toMatchObject({ selfDueOn: "2026-11-07", managerDueOn: "2026-11-11" });
    expect(await fails(saveReviewForm({ participantId: linh.participantId, kind: "manager", answers: answer, comment: null, submit: true }, ids.tam, "2026-11-06"))).toBe("review_self_not_submitted");
    const late = await saveReviewForm({ participantId: linh.participantId, kind: "manager", answers: answer, comment: null, submit: true }, ids.tam, "2026-11-08");
    expect(late.participant.stage).toBe("manager_done");
  });

  it("lets HR release one review while the cycle stays open, and that one is then closed to writing", async () => {
    const linh = await lineOf(cycleId, ids.linh);
    const released = await releaseParticipant(linh.participantId, ids.mai);
    expect(released.after.reviewScoreBp).toBe(10000);
    expect(await fails(saveReviewForm({ participantId: linh.participantId, kind: "self", answers: answer, comment: null, submit: false }, ids.linh))).toBe("review_already_released");
    // Another person's review in the same cycle has not been written yet: nothing to release.
    const an = await lineOf(cycleId, ids.an);
    expect(await fails(releaseParticipant(an.participantId, ids.mai))).toBe("review_manager_not_submitted");
    // The policy agrees with the use-case on the stored rows.
    const loaded = (await loadParticipant(an.participantId))!;
    expect(partiesOfParticipant(loaded.participant, loaded.cycle, loaded.directory)).toMatchObject({ rolling: true, released: false, signOffRequired: false, signedOff: false });
  });

  it("closes straight from active: there is no calibration round", async () => {
    expect(await fails(advanceReviewCycle(cycleId, "calibration"))).toBe("review_cycle_bad_step");
    expect((await advanceReviewCycle(cycleId, "closed")).after.status).toBe("closed");
    expect(await fails(addParticipant(cycleId, ids.huy, await loadDirectory()))).toBe("review_cycle_not_collecting");
  });
});

describe("launch notices", () => {
  it("tell every participant their review is open and every manager how many they owe", async () => {
    const created = (await saveReviewCycle(null, cycle({ name: "Launch notices" }), ids.mai)).after;
    const launched = await launchReviewCycle(created.id, ids.mai);
    // Five people (the collaborator is not reviewed), each with the cycle's deadlines.
    expect(launched.enrolled).toHaveLength(5);
    expect(launched.enrolled.every((row) => row.selfDueOn === "2026-12-10" && row.managerDueOn === "2026-12-20")).toBe(true);
    const told = await sendOpenNotices(launched.enrolled);
    expect(told).toEqual({ people: 5, managers: 1 });
    // One call for everybody who shares the cycle and the deadline; one for tam, who owes three.
    const open = callsOf("performance.review_open");
    expect(open).toHaveLength(1);
    expect([...open[0].recipients].sort()).toEqual([ids.mai, ids.tam, ids.huy, ids.linh, ids.an].sort());
    expect(callsOf("performance.reviews_owed")).toEqual([expect.objectContaining({ recipients: [ids.tam], params: { cycle: "Launch notices", date: "2026-12-20", count: 3 } })]);
  });
});

describe("sending a form back", () => {
  it("makes it a draft again with the reason on it, and the stage follows what is still in", async () => {
    const created = (await saveReviewCycle(null, cycle({ name: "Returns" }), ids.mai)).after;
    await launchReviewCycle(created.id, ids.mai);
    const huy = await lineOf(created.id, ids.huy);
    const self = await saveReviewForm({ participantId: huy.participantId, kind: "self", answers: answer, comment: null, submit: true }, ids.huy);
    expect(self.participant.stage).toBe("self_done");

    expect(await fails(returnReviewForm(self.after.id, "mine", ids.huy))).toBe("review_own");
    const returned = await returnReviewForm(self.after.id, "Hãy bổ sung ví dụ cụ thể.", ids.mai);
    expect(returned.after).toMatchObject({ status: "draft", overallRatingBp: null, submittedAt: null, returnReason: "Hãy bổ sung ví dụ cụ thể.", returnedByPersonId: ids.mai });
    expect(returned.participant.stage).toBe("pending");
    expect(await fails(returnReviewForm(self.after.id, "again", ids.mai))).toBe("review_form_not_submitted");

    // The author fixes it and sends it again; the reason stays on the record.
    const again = await saveReviewForm({ participantId: huy.participantId, kind: "self", answers: answer, comment: "Đã bổ sung.", submit: true }, ids.huy);
    expect(again.after).toMatchObject({ status: "submitted", overallRatingBp: 10000, returnReason: "Hãy bổ sung ví dụ cụ thể." });
    expect(again.participant.stage).toBe("self_done");

    // Returning the self review leaves a submitted manager review where it is.
    const manager = await saveReviewForm({ participantId: huy.participantId, kind: "manager", answers: answer, comment: null, submit: true }, ids.tam);
    expect((await returnReviewForm(again.after.id, "once more", ids.mai)).participant.stage).toBe("manager_done");
    await saveReviewForm({ participantId: huy.participantId, kind: "self", answers: answer, comment: null, submit: true }, ids.huy);

    // Once writing has stopped, nothing is sent back.
    await advanceReviewCycle(created.id, "calibration");
    expect(await fails(returnReviewForm(manager.after.id, "late", ids.mai))).toBe("review_cycle_not_collecting");
  });
});

describe("the sign-off conversation", () => {
  it("comes after release and before the acknowledgement, where the cycle asks for it", async () => {
    const created = (await saveReviewCycle(null, cycle({ name: "Sign-off", signOffRequired: true }), ids.mai)).after;
    await launchReviewCycle(created.id, ids.mai);
    const huy = await lineOf(created.id, ids.huy);
    await saveReviewForm({ participantId: huy.participantId, kind: "self", answers: answer, comment: null, submit: true }, ids.huy);
    await saveReviewForm({ participantId: huy.participantId, kind: "manager", answers: answer, comment: null, submit: true }, ids.tam);
    const today = todayInVietnam();
    expect(await fails(recordSignOff(huy.participantId, { heldOn: today, note: null }, ids.tam, today))).toBe("review_not_released");
    await advanceReviewCycle(created.id, "calibration");
    await releaseParticipant(huy.participantId, ids.mai);

    expect(await fails(acknowledgeParticipant(huy.participantId, null))).toBe("review_sign_off_missing");
    expect(await fails(recordSignOff(huy.participantId, { heldOn: addDays(today, -1), note: null }, ids.tam, today))).toBe("review_sign_off_date");
    expect(await fails(recordSignOff(huy.participantId, { heldOn: addDays(today, 1), note: null }, ids.tam, today))).toBe("review_sign_off_date");
    expect(await fails(recordSignOff(huy.participantId, { heldOn: today, note: null }, ids.huy, today))).toBe("review_own");
    const signed = await recordSignOff(huy.participantId, { heldOn: today, note: "Thống nhất mục tiêu quý 1." }, ids.tam, today);
    expect(signed.after).toMatchObject({ stage: "signed_off", signOffOn: today, signOffNote: "Thống nhất mục tiêu quý 1.", signOffByPersonId: ids.tam });
    expect(await fails(recordSignOff(huy.participantId, { heldOn: today, note: null }, ids.tam, today))).toBe("review_sign_off_recorded");

    expect((await acknowledgeParticipant(huy.participantId, null)).after.stage).toBe("acknowledged");
  });
});

describe("the morning reminders", () => {
  let cycleId = "";
  const sent = async (personId: string) => db().select().from(schema.performanceReminderSent).where(eq(schema.performanceReminderSent.personId, personId));

  beforeAll(async () => {
    // Its own entity and the only cycle still collecting, so the other cycles of this file stay out of the counts.
    await db().update(schema.reviewCycle).set({ status: "closed" }).where(eq(schema.reviewCycle.status, "active"));
    const [szc] = await db().insert(schema.entity).values({ code: "SZC", legalName: "SuZu Creative", shortName: "Creative" }).returning();
    await db().update(schema.person).set({ primaryEntityId: szc.id }).where(eq(schema.person.id, ids.an));
    cycleId = (await saveReviewCycle(null, cycle({ name: "Reminders", entityId: szc.id, signOffRequired: true }), ids.mai)).after.id;
    await launchReviewCycle(cycleId, ids.mai);
    await db().update(schema.person).set({ primaryEntityId: ids.szm }).where(eq(schema.person.id, ids.an));
  });

  it("tells the person once that their form is due soon, then weekly once it is overdue", async () => {
    const before = (await sent(ids.an)).length;
    await sendReviewReminders("2026-12-06"); // four days ahead: not yet
    expect((await sent(ids.an)).length).toBe(before);

    await sendReviewReminders("2026-12-08");
    expect(callsOf("performance.review_due")).toContainEqual(expect.objectContaining({ recipients: [ids.an], params: { count: 1, date: "2026-12-10" } }));
    notify.mockClear();
    await sendReviewReminders("2026-12-08"); // a second run the same morning
    await sendReviewReminders("2026-12-09");
    expect(notify).not.toHaveBeenCalled();

    await sendReviewReminders("2026-12-11"); // the day after the deadline
    expect(callsOf("performance.review_overdue")).toEqual([expect.objectContaining({ recipients: [ids.an], params: { count: 1, date: "2026-12-10" } })]);
    notify.mockClear();
    await sendReviewReminders("2026-12-15"); // same week of lateness
    expect(callsOf("performance.review_overdue")).toEqual([]);
    await sendReviewReminders("2026-12-18"); // a week on
    expect(callsOf("performance.review_overdue")).toHaveLength(1);
    // …and the manager hears that theirs is due on the 20th.
    expect(callsOf("performance.review_due")).toContainEqual(expect.objectContaining({ recipients: [ids.tam], params: { count: 1, date: "2026-12-20" } }));
  });

  it("chases the sign-off, then the acknowledgement, a few days after release", async () => {
    const an = await lineOf(cycleId, ids.an);
    await saveReviewForm({ participantId: an.participantId, kind: "self", answers: answer, comment: null, submit: true }, ids.an);
    await saveReviewForm({ participantId: an.participantId, kind: "manager", answers: answer, comment: null, submit: true }, ids.tam);
    await advanceReviewCycle(cycleId, "calibration");
    await releaseParticipant(an.participantId, ids.mai);
    const today = todayInVietnam();

    notify.mockClear();
    await sendReviewReminders(today); // released just now: nobody is chased yet
    expect(callsOf("performance.sign_off_waiting")).toEqual([]);

    const fiveDaysAgo = new Date(Date.now() - 5 * 86_400_000);
    await db().update(schema.reviewParticipant).set({ releasedAt: fiveDaysAgo }).where(eq(schema.reviewParticipant.id, an.participantId));
    await sendReviewReminders(today);
    expect(callsOf("performance.sign_off_waiting")).toEqual([expect.objectContaining({ recipients: [ids.tam] })]);
    // The person is not asked to acknowledge before the conversation has been held.
    expect(callsOf("performance.ack_waiting")).toEqual([]);

    await db()
      .update(schema.reviewParticipant)
      .set({ signOffOn: addDays(today, -4), signOffRecordedAt: fiveDaysAgo, signOffByPersonId: ids.tam })
      .where(eq(schema.reviewParticipant.id, an.participantId));
    notify.mockClear();
    await sendReviewReminders(today);
    expect(callsOf("performance.ack_waiting")).toEqual([expect.objectContaining({ recipients: [ids.an] })]);
    notify.mockClear();
    await sendReviewReminders(today);
    expect(notify).not.toHaveBeenCalled();
    const rows = await db()
      .select()
      .from(schema.performanceReminderSent)
      .where(and(eq(schema.performanceReminderSent.personId, ids.an), eq(schema.performanceReminderSent.kind, "ack_waiting")));
    expect(rows).toHaveLength(1);
  });
});
