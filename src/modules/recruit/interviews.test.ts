// Interviews and scorecards against a real Postgres (PGlite).
//
// Most of this file is about one rule. FR-REC-06 says an interviewer's feedback is hidden from the
// other interviewers until they have submitted their own, and a rule like that is only worth
// anything if it lives where a hand-posted request meets it. So every assertion below calls
// `scorecardsFor` — the service — rather than rendering a page and looking at it.
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => import("../../../tests/helpers/db"));
vi.mock("@/lib/env", () => ({ env: () => ({ BETTER_AUTH_URL: "https://suzu.one", BETTER_AUTH_SECRET: "a-test-secret-long-enough-to-sign-with" }) }));

import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { migrateTestDb } from "../../../tests/helpers/db";
import type { Principal } from "../platform/rbac/policy";
import { DEFAULT_INTERVIEW_KIT } from "./enums";
import {
  clashesFor,
  getInterviewView,
  icsForInterview,
  interviewerAvailability,
  isInterviewerOnApplication,
  listInterviewsOfApplication,
  listMyInterviews,
  pendingScorecardCount,
  rescheduleInterview,
  saveScorecard,
  scheduleInterview,
  scorecardsFor,
  setInterviewStatus,
} from "./interviews";
import { PIPELINE_SEED } from "./seed-pipelines";
import { createApplication, createCandidate, createOpening, savePipeline, setOpeningStatus, setOpeningTeam } from "./service";

const fails = (promise: Promise<unknown>) =>
  promise.then(
    () => "no error",
    (error: Error) => error.message,
  );
const principal = (personId: string | null, grants: Principal["grants"] = []): Principal => ({ personId, workforceType: "employee", grants });
const viewerOf = (p: Principal) => ({ principal: p, personId: p.personId });

const ids = {} as Record<
  "szm" | "vid" | "pipeline" | "openingId" | "applicationId" | "recruiterPerson" | "headPerson" | "interviewerA" | "interviewerB" | "strangerPerson" | "interviewId",
  string
>;
let recruiter: Principal;
let head: Principal;
let alice: Principal;
let bao: Principal;
let stranger: Principal;

/** Days from now, so the fixture is always inside the scheduling window whenever it runs. */
const day = (offsetDays: number) => new Date(Date.now() + offsetDays * 24 * 60 * 60 * 1000);
const slot = (offsetDays: number, startHour: number, minutes = 60) => {
  const start = day(offsetDays);
  start.setUTCHours(startHour, 0, 0, 0);
  return { startAt: start, endAt: new Date(start.getTime() + minutes * 60_000) };
};

beforeAll(async () => {
  await migrateTestDb();
  const [szm] = await db().insert(schema.entity).values({ code: "SZM", legalName: "Công ty SuZu Media", shortName: "SuZu Media" }).returning();
  const [vid] = await db().insert(schema.orgUnit).values({ code: "VID", name: "Video" }).returning();
  ids.szm = szm.id;
  ids.vid = vid.id;

  for (const [key, fullName, email] of [
    ["recruiterPerson", "Người tuyển dụng", "recruiter@suzu.group"],
    ["headPerson", "Trưởng phòng Video", "head@suzu.group"],
    ["interviewerA", "Nguyễn Thị Hà", "ha@suzu.group"],
    ["interviewerB", "Trần Văn Bảo", "bao@suzu.group"],
    ["strangerPerson", "Nhân viên thường", "nv@suzu.group"],
  ] as const) {
    const [row] = await db()
      .insert(schema.person)
      .values({ fullName, searchName: key, workEmail: email, primaryEntityId: szm.id, departmentId: vid.id, status: "active" })
      .returning();
    ids[key] = row.id;
  }

  recruiter = principal(ids.recruiterPerson, [{ role: "recruiter", scope: { type: "entity", id: szm.id } }]);
  head = principal(ids.headPerson, [{ role: "department_head", scope: { type: "unit", id: vid.id } }]);
  // The two interviewers hold **no recruitment role at all** — that is the point of them.
  alice = principal(ids.interviewerA);
  bao = principal(ids.interviewerB);
  stranger = principal(ids.strangerPerson);

  const { after } = await savePipeline(null, { ...PIPELINE_SEED[0], isActive: true, stages: PIPELINE_SEED[0].stages.map((stage) => ({ ...stage })) });
  ids.pipeline = after.id;

  const opening = await createOpening(
    {
      title: "Video Editor",
      titleEn: null,
      entityId: szm.id,
      departmentId: vid.id,
      teamId: null,
      positionName: null,
      jobLevel: null,
      employmentType: "employee",
      workMode: "onsite",
      workLocation: "Hà Nội",
      headcount: 1,
      description: "",
      requirements: "",
      benefits: "",
      pipelineId: after.id,
      targetStartDate: null,
      questions: [],
    },
    null,
    ids.recruiterPerson,
  );
  ids.openingId = opening.id;
  await setOpeningStatus(opening.id, "open", null);
  await setOpeningTeam(opening.id, [{ personId: ids.headPerson, role: "hiring_manager" }]);

  const candidate = await createCandidate(
    {
      fullName: "Phạm Minh Anh",
      email: "minhanh@example.test",
      phone: "0901234567",
      currentTitle: null,
      currentEmployer: null,
      location: null,
      links: [],
      source: "careers_page",
      sourceDetail: null,
      referredByPersonId: null,
      tags: [],
      notes: null,
    },
    ids.recruiterPerson,
    { confirmedNotDuplicate: true },
  );
  const application = await createApplication(
    {
      candidateId: candidate.id,
      openingId: opening.id,
      source: "careers_page",
      sourceDetail: null,
      coverLetter: null,
      answers: {},
      cvFileId: null,
      portfolioLinks: [],
      salaryExpectationVnd: null,
      salaryExpectationNote: null,
    },
    ids.recruiterPerson,
  );
  ids.applicationId = application.id;

  const { interview } = await scheduleInterview(
    {
      applicationId: application.id,
      stageId: null,
      kind: "panel",
      title: "Phỏng vấn vòng 1",
      ...slot(4, 2),
      mode: "onsite",
      location: "Tầng 4, Hà Nội",
      meetingUrl: null,
      notesForCandidate: "Mang theo portfolio",
      interviewerPersonIds: [ids.interviewerA, ids.interviewerB],
    },
    ids.recruiterPerson,
  );
  ids.interviewId = interview.id;
});

describe("scheduling", () => {
  it("books the interview and writes it to the application's history", async () => {
    const interviews = await listInterviewsOfApplication(ids.applicationId);
    expect(interviews).toHaveLength(1);
    expect(interviews[0].interviewers.map((row) => row.personId).sort()).toEqual([ids.interviewerA, ids.interviewerB].sort());

    const events = await db().select().from(schema.applicationEvent).where(eq(schema.applicationEvent.applicationId, ids.applicationId));
    expect(events.map((event) => event.type)).toContain("interview_scheduled");
  });

  it("copies the opening's kit onto the interview, so a later edit does not rewrite it", async () => {
    const [row] = await db().select().from(schema.interview).where(eq(schema.interview.id, ids.interviewId));
    expect(row.criteria.map((criterion) => criterion.key)).toEqual(DEFAULT_INTERVIEW_KIT.map((criterion) => criterion.key));

    await db().update(schema.jobOpening).set({ interviewKit: [{ key: "later", label: "Thêm sau", labelEn: null, hint: null }] }).where(eq(schema.jobOpening.id, ids.openingId));
    const [again] = await db().select().from(schema.interview).where(eq(schema.interview.id, ids.interviewId));
    expect(again.criteria.map((criterion) => criterion.key)).toEqual(DEFAULT_INTERVIEW_KIT.map((criterion) => criterion.key));
    await db().update(schema.jobOpening).set({ interviewKit: [] }).where(eq(schema.jobOpening.id, ids.openingId));
  });

  it("records that the calendar was only simulated — with no service account nothing left the machine", async () => {
    const [row] = await db().select().from(schema.interview).where(eq(schema.interview.id, ids.interviewId));
    expect(row.calendarDriver).toBe("local");
    expect(row.calendarStatus).toBe("simulated");
    expect(row.calendarEventId).toBeNull();
  });

  it("refuses a slot that ends before it starts, and one with nobody in it", async () => {
    const bad = { ...slot(4, 2), endAt: day(3) };
    expect(
      await fails(
        scheduleInterview(
          { applicationId: ids.applicationId, stageId: null, kind: "technical", title: "x", ...bad, mode: "phone", location: null, meetingUrl: null, notesForCandidate: null, interviewerPersonIds: [ids.interviewerA] },
          ids.recruiterPerson,
        ),
      ),
    ).toBe("interview_ends_before_it_starts");

    expect(
      await fails(
        scheduleInterview(
          { applicationId: ids.applicationId, stageId: null, kind: "technical", title: "x", ...slot(5, 2), mode: "phone", location: null, meetingUrl: null, notesForCandidate: null, interviewerPersonIds: [] },
          ids.recruiterPerson,
        ),
      ),
    ).toBe("interview_no_interviewer");
  });

  it("refuses a stage belonging to another pipeline", async () => {
    const { after: other } = await savePipeline(null, { ...PIPELINE_SEED[1], isActive: true, stages: PIPELINE_SEED[1].stages.map((stage) => ({ ...stage })) });
    const [stage] = await db().select().from(schema.recruitPipelineStage).where(eq(schema.recruitPipelineStage.pipelineId, other.id)).limit(1);
    expect(
      await fails(
        scheduleInterview(
          { applicationId: ids.applicationId, stageId: stage.id, kind: "technical", title: "x", ...slot(6, 2), mode: "phone", location: null, meetingUrl: null, notesForCandidate: null, interviewerPersonIds: [ids.interviewerA] },
          ids.recruiterPerson,
        ),
      ),
    ).toBe("recruit_stage_not_found");
  });
});

describe("who may open an interview", () => {
  it("opens for the recruiter and the hiring manager", async () => {
    expect(await getInterviewView(viewerOf(recruiter), ids.interviewId)).not.toBeNull();
    expect(await getInterviewView(viewerOf(head), ids.interviewId)).not.toBeNull();
  });

  it("opens for an interviewer who holds no recruitment role whatsoever", async () => {
    const view = await getInterviewView(viewerOf(alice), ids.interviewId);
    expect(view?.candidateName).toBe("Phạm Minh Anh");
    expect(view?.amInterviewing).toBe(true);
    // And it does not make them a recruiter: they may not schedule.
    expect(view?.canSchedule).toBe(false);
  });

  it("is invisible to everybody else", async () => {
    expect(await getInterviewView(viewerOf(stranger), ids.interviewId)).toBeNull();
    expect(await getInterviewView({ principal: principal(null), personId: null }, ids.interviewId)).toBeNull();
  });

  it("admits an interviewer to this candidate's CV and to nothing else", async () => {
    expect(await isInterviewerOnApplication(ids.applicationId, ids.interviewerA)).toBe(true);
    expect(await isInterviewerOnApplication(ids.applicationId, ids.strangerPerson)).toBe(false);
  });

  it("gives an interviewer their own list and nobody else's", async () => {
    const mine = await listMyInterviews(ids.interviewerA);
    expect(mine.map((row) => row.id)).toContain(ids.interviewId);
    expect(await listMyInterviews(ids.strangerPerson)).toEqual([]);
  });
});

describe("blind feedback (FR-REC-06)", () => {
  it("shows an interviewer nothing of the others before they have submitted", async () => {
    // Hà submits first, with a clear view.
    await saveScorecard(ids.interviewId, ids.interviewerA, { ratings: { craft: 4, motivation: 3 }, recommendation: "strong_yes", strengths: "Dựng nhanh", concerns: null, notes: null }, { submit: true });

    const forBao = await scorecardsFor(viewerOf(bao), ids.interviewId);
    expect(forBao?.blind).toBe(true);
    expect(forBao?.others).toEqual([]);
    // Not even a count of the ratings, and certainly not Hà's recommendation.
    expect(JSON.stringify(forBao)).not.toContain("strong_yes");
    expect(JSON.stringify(forBao)).not.toContain("Dựng nhanh");
  });

  it("keeps a draft from lifting the blind — only a submission does", async () => {
    await saveScorecard(ids.interviewId, ids.interviewerB, { ratings: { craft: 2 }, recommendation: null, strengths: null, concerns: null, notes: "chưa xong" }, { submit: false });
    const stillBlind = await scorecardsFor(viewerOf(bao), ids.interviewId);
    expect(stillBlind?.blind).toBe(true);
    expect(stillBlind?.others).toEqual([]);
    expect(stillBlind?.mine?.notes).toBe("chưa xong");
  });

  it("shows the others the moment their own card is in", async () => {
    await saveScorecard(ids.interviewId, ids.interviewerB, { ratings: { craft: 3, collaboration: 4 }, recommendation: "yes", strengths: null, concerns: "Ít kinh nghiệm quảng cáo", notes: null }, { submit: true });

    const forBao = await scorecardsFor(viewerOf(bao), ids.interviewId);
    expect(forBao?.blind).toBe(false);
    expect(forBao?.others.map((row) => row.interviewerPersonId)).toEqual([ids.interviewerA]);
    expect(forBao?.others[0].recommendation).toBe("strong_yes");

    // And symmetrically: Hà now sees Bảo's.
    const forAlice = await scorecardsFor(viewerOf(alice), ids.interviewId);
    expect(forAlice?.others.map((row) => row.recommendation)).toEqual(["yes"]);
  });

  it("refuses to change a submitted card, so nobody scores after reading the panel", async () => {
    expect(await fails(saveScorecard(ids.interviewId, ids.interviewerA, { ratings: { craft: 1 }, recommendation: "no", strengths: null, concerns: null, notes: null }, { submit: true }))).toBe(
      "recruit_scorecard_submitted",
    );
  });

  it("refuses a card from somebody who was not in the room", async () => {
    expect(await fails(saveScorecard(ids.interviewId, ids.strangerPerson, { ratings: {}, recommendation: "yes", strengths: null, concerns: null, notes: null }, { submit: true }))).toBe(
      "recruit_not_an_interviewer",
    );
    // Including the recruiter who booked it: a scorecard is testimony, not an opinion.
    expect(await fails(saveScorecard(ids.interviewId, ids.recruiterPerson, { ratings: {}, recommendation: "yes", strengths: null, concerns: null, notes: null }, { submit: true }))).toBe(
      "recruit_not_an_interviewer",
    );
  });

  it("refuses a submission with no recommendation, but keeps a half-finished draft", async () => {
    const { interview } = await scheduleInterview(
      { applicationId: ids.applicationId, stageId: null, kind: "technical", title: "Vòng kỹ thuật", ...slot(7, 2), mode: "video", location: null, meetingUrl: null, notesForCandidate: null, interviewerPersonIds: [ids.interviewerA] },
      ids.recruiterPerson,
    );
    expect(await fails(saveScorecard(interview.id, ids.interviewerA, { ratings: { craft: 3 }, recommendation: null, strengths: null, concerns: null, notes: null }, { submit: true }))).toBe(
      "recruit_scorecard_needs_recommendation",
    );
    const draft = await saveScorecard(interview.id, ids.interviewerA, { ratings: { craft: 3 }, recommendation: null, strengths: null, concerns: null, notes: null }, { submit: false });
    expect(draft.submittedAt).toBeNull();
  });

  it("drops a score for a criterion this interview never asked about, and clamps the rest", async () => {
    const card = await scorecardsFor(viewerOf(alice), ids.interviewId);
    expect(card?.others[0].ratings).toEqual({ craft: 3, collaboration: 4 });

    const { interview } = await scheduleInterview(
      { applicationId: ids.applicationId, stageId: null, kind: "culture", title: "Vòng văn hoá", ...slot(8, 2), mode: "phone", location: null, meetingUrl: null, notesForCandidate: null, interviewerPersonIds: [ids.interviewerB] },
      ids.recruiterPerson,
    );
    const saved = await saveScorecard(interview.id, ids.interviewerB, { ratings: { craft: 9, invented: 4, motivation: -3 }, recommendation: "no", strengths: null, concerns: null, notes: null }, { submit: true });
    expect(saved.ratings).toEqual({ craft: 4, motivation: 1 });
  });

  it("shows every submitted card to a recruiter who is not interviewing, and no draft to anybody", async () => {
    // The recruiter has no card of their own to be influenced, and somebody has to read the panel.
    const forRecruiter = await scorecardsFor(viewerOf(recruiter), ids.interviewId);
    expect(forRecruiter?.blind).toBe(false);
    expect(forRecruiter?.others.map((row) => row.interviewerName).sort()).toEqual(["Nguyễn Thị Hà", "Trần Văn Bảo"]);
    expect(forRecruiter?.canScore).toBe(false);
  });

  it("tells nobody outside the opening anything at all", async () => {
    expect(await scorecardsFor(viewerOf(stranger), ids.interviewId)).toBeNull();
  });

  it("records that a card arrived without recording what it said", async () => {
    const events = await db().select().from(schema.applicationEvent).where(eq(schema.applicationEvent.applicationId, ids.applicationId));
    const submitted = events.filter((event) => event.type === "scorecard_submitted");
    expect(submitted.length).toBeGreaterThan(0);
    const text = JSON.stringify(submitted);
    for (const secret of ["strong_yes", "Dựng nhanh", "Ít kinh nghiệm quảng cáo"]) expect(text).not.toContain(secret);
  });

  it("counts what is still outstanding", async () => {
    // Two later interviews were booked above; one has a draft and one a submitted card.
    expect(await pendingScorecardCount(ids.applicationId)).toBeGreaterThanOrEqual(1);
  });
});

describe("availability and clashes", () => {
  it("reports a person's other interviews in the window", async () => {
    const { startAt, endAt } = slot(4, 2);
    const availability = await interviewerAvailability([ids.interviewerA], { from: startAt, to: endAt });
    expect(availability[0].busy.map((block) => block.interviewId)).toContain(ids.interviewId);
  });

  it("names the interviewers a proposed slot would double-book", async () => {
    const { startAt, endAt } = slot(4, 2);
    const clashes = await clashesFor([ids.interviewerA, ids.strangerPerson], { from: startAt, to: endAt });
    expect(clashes.map((row) => row.personId)).toEqual([ids.interviewerA]);
  });

  it("does not report an interview against itself when it is being moved", async () => {
    const { startAt, endAt } = slot(4, 2);
    expect(await clashesFor([ids.interviewerA], { from: startAt, to: endAt }, ids.interviewId)).toEqual([]);
  });

  it("reports leave as days away and never as a reason", async () => {
    const availability = await interviewerAvailability([ids.interviewerA], slotWindow());
    // Nobody is on leave in this fixture; the shape is what matters — dates, and nothing else.
    expect(availability[0]).toHaveProperty("awayDays");
    expect(JSON.stringify(availability[0])).not.toContain("leaveTypeId");
  });
});

function slotWindow() {
  const { startAt, endAt } = slot(4, 2);
  return { from: startAt, to: endAt };
}

describe("rescheduling and cancelling", () => {
  it("moves an interview, keeping its identity", async () => {
    const { interview } = await rescheduleInterview(
      ids.interviewId,
      { ...slot(5, 3), location: "Tầng 5", meetingUrl: null, interviewerPersonIds: [ids.interviewerA, ids.interviewerB] },
      ids.recruiterPerson,
    );
    expect(interview.id).toBe(ids.interviewId);
    expect(interview.location).toBe("Tầng 5");
  });

  it("cancels once, and refuses to cancel again", async () => {
    const { interview } = await scheduleInterview(
      { applicationId: ids.applicationId, stageId: null, kind: "final", title: "Vòng cuối", ...slot(9, 2), mode: "onsite", location: null, meetingUrl: null, notesForCandidate: null, interviewerPersonIds: [ids.interviewerA] },
      ids.recruiterPerson,
    );
    const cancelled = await setInterviewStatus(interview.id, "cancelled", "Ứng viên xin dời", ids.recruiterPerson);
    expect(cancelled.status).toBe("cancelled");
    expect(cancelled.cancelReason).toBe("Ứng viên xin dời");
    expect(await fails(setInterviewStatus(interview.id, "cancelled", null, ids.recruiterPerson))).toBe("recruit_interview_status_unchanged");
    // A cancelled interview takes no more scorecards.
    expect(await fails(saveScorecard(interview.id, ids.interviewerA, { ratings: {}, recommendation: "no", strengths: null, concerns: null, notes: null }, { submit: true }))).toBe("recruit_interview_closed");
  });

  it("frees the slot: a cancelled interview is not a clash", async () => {
    const { interview } = await scheduleInterview(
      { applicationId: ids.applicationId, stageId: null, kind: "phone_screen", title: "Sàng lọc", ...slot(10, 2), mode: "phone", location: null, meetingUrl: null, notesForCandidate: null, interviewerPersonIds: [ids.interviewerB] },
      ids.recruiterPerson,
    );
    const window = { from: interview.startAt, to: interview.endAt };
    expect(await clashesFor([ids.interviewerB], window)).toHaveLength(1);
    await setInterviewStatus(interview.id, "cancelled", null, ids.recruiterPerson);
    expect(await clashesFor([ids.interviewerB], window)).toEqual([]);
  });
});

describe("the calendar file", () => {
  it("is offered to whoever may open the interview, and to nobody else", async () => {
    expect(await icsForInterview(viewerOf(alice), ids.interviewId)).not.toBeNull();
    expect(await icsForInterview(viewerOf(stranger), ids.interviewId)).toBeNull();
  });

  it("carries the candidate, the interviewers and the place — and no judgement of anybody", async () => {
    const file = (await icsForInterview(viewerOf(recruiter), ids.interviewId))!;
    expect(file.fileName.endsWith(".ics")).toBe(true);
    expect(file.body).toContain("BEGIN:VCALENDAR");
    expect(file.body).toContain(`UID:interview-${ids.interviewId}@suzu.one`);
    expect(file.body).toContain("mailto:ha@suzu.group");
    expect(file.body).toContain("mailto:bao@suzu.group");
    // A calendar entry is read on a phone on a train.
    for (const secret of ["strong_yes", "Dựng nhanh"]) expect(file.body).not.toContain(secret);
  });
});
