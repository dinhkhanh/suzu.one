// Recruitment against a real Postgres (PGlite). What is worth testing here is not that rows can be
// written but **who is shown them**: the candidate database is the one place in the product that
// holds personal data about people who do not work here, and the rule that a hiring manager sees
// their own opening and nothing else is enforced by a WHERE clause that has to be exercised.
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => import("../../../tests/helpers/db"));
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

import { eq, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { migrateTestDb } from "../../../tests/helpers/db";
import type { Principal } from "../platform/rbac/policy";
import type { DuplicateMatch, RedactedDuplicateMatch } from "./engine/duplicates";
import { type FunnelApplication, funnelReport } from "./engine/funnel";
import { getRecruitReport } from "./reports";
import { PIPELINE_SEED, pipelineSeedProblems } from "./seed-pipelines";
import {
  canReachCandidate,
  createApplication,
  createCandidate,
  createOpening,
  findLikelyCandidateDuplicates,
  findOpeningBySlug,
  getApplicationView,
  getCandidateView,
  getOpeningView,
  headcountPlan,
  isOpeningMember,
  listApplications,
  listCandidates,
  listOpenings,
  moveApplicationStage,
  newPublicSlug,
  nextOpeningCode,
  reachableCandidateIds,
  rejectApplication,
  savePipeline,
  setOpeningStatus,
  setOpeningTeam,
  stagesOf,
  updateOpening,
} from "./service";

const fails = (promise: Promise<unknown>) =>
  promise.then(
    () => "no error",
    (error: Error) => error.message,
  );
const principal = (personId: string | null, grants: Principal["grants"] = []): Principal => ({ personId, workforceType: "employee", grants });

const ids = {} as Record<"szm" | "szc" | "vid" | "des" | "pipeline" | "shortPipeline" | "recruiterPerson" | "szcRecruiterPerson" | "headPerson" | "otherHeadPerson" | "hrPerson" | "employeePerson", string>;
let recruiter: Principal;
let szcRecruiter: Principal;
let hrAdmin: Principal;
let head: Principal;
let otherHead: Principal;
let employee: Principal;

beforeAll(async () => {
  await migrateTestDb();
  const [szm] = await db().insert(schema.entity).values({ code: "SZM", legalName: "SuZu Media", shortName: "Media" }).returning();
  const [szc] = await db().insert(schema.entity).values({ code: "SZC", legalName: "SuZu Creative", shortName: "Creative" }).returning();
  const [vid] = await db().insert(schema.orgUnit).values({ code: "VID", name: "Video" }).returning();
  const [des] = await db().insert(schema.orgUnit).values({ code: "DES", name: "Design" }).returning();
  Object.assign(ids, { szm: szm.id, szc: szc.id, vid: vid.id, des: des.id });

  for (const [key, fullName] of [
    ["recruiterPerson", "Người tuyển dụng"],
    ["szcRecruiterPerson", "Tuyển dụng Creative"],
    ["headPerson", "Trưởng phòng Video"],
    ["otherHeadPerson", "Trưởng phòng Design"],
    ["hrPerson", "Giám đốc Nhân sự"],
    ["employeePerson", "Nhân viên thường"],
  ] as const) {
    const [row] = await db().insert(schema.person).values({ fullName, searchName: key, primaryEntityId: szm.id, orgUnitId: vid.id, status: "active" }).returning();
    ids[key] = row.id;
  }

  for (const seed of PIPELINE_SEED) {
    expect(pipelineSeedProblems(seed)).toEqual([]);
    const { after } = await savePipeline(null, { ...seed, description: seed.description, isActive: true, stages: seed.stages.map((stage) => ({ ...stage, nameEn: stage.nameEn })) });
    if (seed.code === "STANDARD") ids.pipeline = after.id;
    if (seed.code === "SHORT") ids.shortPipeline = after.id;
  }

  recruiter = principal(ids.recruiterPerson, [{ role: "recruiter", scope: { type: "entity", id: szm.id } }]);
  szcRecruiter = principal(ids.szcRecruiterPerson, [{ role: "recruiter", scope: { type: "entity", id: szc.id } }]);
  hrAdmin = principal(ids.hrPerson, [{ role: "hr_admin", scope: { type: "group" } }]);
  head = principal(ids.headPerson, [{ role: "department_head", scope: { type: "unit", id: vid.id } }]);
  otherHead = principal(ids.otherHeadPerson, [{ role: "department_head", scope: { type: "unit", id: des.id } }]);
  employee = principal(ids.employeePerson);
});

const baseOpening = () => ({
  title: "Video Editor",
  titleEn: "Video Editor",
  entityId: ids.szm,
  departmentId: ids.vid,
  teamId: null,
  positionName: "Video Editor",
  jobLevel: "Middle",
  employmentType: "employee" as const,
  workMode: "onsite" as const,
  workLocation: "Hà Nội",
  headcount: 1,
  description: "Dựng phim quảng cáo.",
  requirements: "2 năm kinh nghiệm.",
  benefits: "Bảo hiểm đầy đủ.",
  pipelineId: ids.pipeline,
  targetStartDate: null,
  questions: [],
});

describe("pipelines", () => {
  it("seeds both starter pipelines with their stages in order", async () => {
    const stages = await stagesOf(ids.pipeline);
    expect(stages.map((stage) => stage.key)).toEqual(["applied", "screening", "phone_screen", "interview", "assignment", "final_interview", "offer", "hired"]);
    expect(stages[0].category).toBe("applied");
    expect(stages.at(-1)!.category).toBe("hired");
  });

  it("keeps exactly one default", async () => {
    const rows = await db().select().from(schema.recruitPipeline).where(eq(schema.recruitPipeline.isDefault, true));
    expect(rows).toHaveLength(1);
    expect(rows[0].code).toBe("STANDARD");
  });

  it("refuses a pipeline with nowhere for an application to start", async () => {
    expect(await fails(savePipeline(null, { code: "BAD", name: "Bad", nameEn: null, description: null, isDefault: false, isActive: true, stages: [{ key: "offer", name: "Offer", nameEn: null, category: "offer" }] }))).toBe("recruit_pipeline_no_entry");
  });
});

describe("openings", () => {
  it("numbers openings per entity and year", async () => {
    const opening = await createOpening(baseOpening(), { salaryMinVnd: 18_000_000, salaryMaxVnd: 25_000_000, salaryPublic: false }, ids.recruiterPerson);
    expect(opening.code).toMatch(/^SZM-\d{4}-001$/);
    const second = await createOpening({ ...baseOpening(), title: "Motion Designer" }, null, ids.recruiterPerson);
    expect(second.code).toMatch(/^SZM-\d{4}-002$/);
    // A different entity starts at 001 of its own.
    const other = await createOpening({ ...baseOpening(), entityId: ids.szc, departmentId: ids.des, title: "Account Executive" }, null, ids.recruiterPerson);
    expect(other.code).toMatch(/^SZC-\d{4}-001$/);
    expect(await nextOpeningCode(db(), "SZM", Number(opening.code.slice(4, 8)))).toMatch(/-003$/);
  });

  it("mints a readable public slug from the title, with a random tail, that is not the id", async () => {
    const opening = await createOpening({ ...baseOpening(), title: "Copywriter" }, null, ids.recruiterPerson);
    expect(opening.publicSlug).not.toContain(opening.id);
    expect(opening.publicSlug).toMatch(/^copywriter-[a-z2-9]{8}$/);
    expect(newPublicSlug("Kỹ sư phần mềm (Đà Nẵng)")).toMatch(/^ky-su-phan-mem-da-nang-[a-z2-9]{8}$/);
    expect(newPublicSlug("Copywriter")).not.toBe(newPublicSlug("Copywriter"));
    expect(newPublicSlug("—")).toMatch(/^[a-z2-9]{16}$/);
    expect(newPublicSlug("x".repeat(200)).length).toBeLessThanOrEqual(64);
  });

  // Nobody holds the link before the first publication; afterwards it must never move.
  it("renames the slug with the title only until the opening is first published", async () => {
    const opening = await createOpening({ ...baseOpening(), title: "Copywriter" }, null, ids.recruiterPerson);
    const renamed = (await updateOpening(opening.id, { ...baseOpening(), title: "Senior Copywriter" }, null)).after;
    expect(renamed.publicSlug).toMatch(/^senior-copywriter-/);
    await setOpeningStatus(opening.id, "open", null);
    await setOpeningStatus(opening.id, "on_hold", null);
    const kept = (await updateOpening(opening.id, { ...baseOpening(), title: "Lead Copywriter" }, null)).after;
    expect(kept.publicSlug).toBe(renamed.publicSlug);
  });

  // The rule the careers page (week 2) rests on: a draft is indistinguishable from nothing.
  it("answers for a slug only while the opening is published", async () => {
    const opening = await createOpening({ ...baseOpening(), title: "Producer" }, null, ids.recruiterPerson);
    expect(await findOpeningBySlug(opening.publicSlug)).toBeUndefined();
    await setOpeningStatus(opening.id, "open", null);
    expect((await findOpeningBySlug(opening.publicSlug))?.id).toBe(opening.id);
    await setOpeningStatus(opening.id, "closed", "Đã tuyển đủ");
    expect(await findOpeningBySlug(opening.publicSlug)).toBeUndefined();
    expect(await findOpeningBySlug("not-a-slug")).toBeUndefined();
  });

  it("refuses a band whose floor is above its ceiling", async () => {
    expect(await fails(createOpening(baseOpening(), { salaryMinVnd: 30_000_000, salaryMaxVnd: 10_000_000, salaryPublic: false }, ids.recruiterPerson))).toBe("recruit_salary_range_invalid");
  });
});

// The heart of this module's access rules, against the database rather than the pure policy.
describe("who sees which openings", () => {
  let szmOpening: string;
  let szcOpening: string;

  beforeAll(async () => {
    const mine = await createOpening({ ...baseOpening(), title: "Editor cho danh sách" }, { salaryMinVnd: 20_000_000, salaryMaxVnd: 28_000_000, salaryPublic: false }, ids.recruiterPerson);
    const theirs = await createOpening({ ...baseOpening(), entityId: ids.szc, departmentId: ids.des, title: "Designer cho danh sách" }, null, ids.recruiterPerson);
    szmOpening = mine.id;
    szcOpening = theirs.id;
    await setOpeningTeam(szmOpening, [{ personId: ids.headPerson, role: "hiring_manager" }]);
  });

  it("a recruiter sees their entity's openings and not another entity's", async () => {
    const mine = await listOpenings(recruiter);
    expect(mine.map((row) => row.id)).toContain(szmOpening);
    expect(mine.map((row) => row.id)).not.toContain(szcOpening);
    const theirs = await listOpenings(szcRecruiter);
    expect(theirs.map((row) => row.id)).toContain(szcOpening);
    expect(theirs.map((row) => row.id)).not.toContain(szmOpening);
  });

  it("group-wide HR sees both", async () => {
    const all = await listOpenings(hrAdmin);
    expect(all.map((row) => row.id)).toEqual(expect.arrayContaining([szmOpening, szcOpening]));
  });

  it("a hiring manager sees exactly the opening they are on", async () => {
    const rows = await listOpenings(head);
    expect(rows.map((row) => row.id)).toEqual([szmOpening]);
    expect(await isOpeningMember(szmOpening, ids.headPerson)).toBe(true);
    expect(await isOpeningMember(szcOpening, ids.headPerson)).toBe(false);
  });

  it("a department head who is on no hiring team sees nothing at all", async () => {
    expect(await listOpenings(otherHead)).toEqual([]);
    expect(await getOpeningView({ principal: otherHead, personId: ids.otherHeadPerson }, szmOpening)).toBeNull();
  });

  it("a plain employee sees nothing at all", async () => {
    expect(await listOpenings(employee)).toEqual([]);
    expect(await getOpeningView({ principal: employee, personId: ids.employeePerson }, szmOpening)).toBeNull();
  });

  // A refused opening answers exactly like one that does not exist.
  it("a recruiter of another entity is refused an opening, not told it exists", async () => {
    expect(await getOpeningView({ principal: szcRecruiter, personId: ids.szcRecruiterPerson }, szmOpening)).toBeNull();
  });

  it("cuts the salary band by tier before it leaves the service", async () => {
    const forHr = await getOpeningView({ principal: hrAdmin, personId: ids.hrPerson }, szmOpening);
    expect(forHr?.salary).toEqual({ minVnd: 20_000_000, maxVnd: 28_000_000, isPublic: false });
    // The recruiter runs the whole pipeline and never sees the figure.
    const forRecruiter = await getOpeningView({ principal: recruiter, personId: ids.recruiterPerson }, szmOpening);
    expect(forRecruiter).not.toBeNull();
    expect(forRecruiter?.salary).toBeNull();
    expect(forRecruiter?.canEdit).toBe(true);
    // Nor does the hiring manager: line managers never see compensation.
    const forHead = await getOpeningView({ principal: head, personId: ids.headPerson }, szmOpening);
    expect(forHead?.isMember).toBe(true);
    expect(forHead?.salary).toBeNull();
    expect(forHead?.canEdit).toBe(false);
  });
});

describe("candidates and duplicate detection", () => {
  const someone = {
    fullName: "Trần Thị Mai",
    email: "tran.thi.mai@gmail.com",
    phone: "0912 345 678",
    currentTitle: "Video Editor",
    currentEmployer: "Studio X",
    location: "Hà Nội",
    links: ["https://behance.net/mai"],
    source: "careers_page" as const,
    sourceDetail: null,
    referredByPersonId: null,
    tags: ["video"],
    notes: null,
  };

  it("stores the normalised keys and a default retention date", async () => {
    const created = await createCandidate(someone, ids.recruiterPerson);
    expect(created.emailKey).toBe("tranthimai@gmail.com");
    expect(created.phoneKey).toBe("912345678");
    expect(created.searchName).toBe("tran thi mai");
    expect(created.retainUntil).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("refuses the same mailbox typed differently, and says who it clashes with", async () => {
    const error = await createCandidate({ ...someone, fullName: "Mai Tran", email: "TranThiMai+cv@gmail.com", phone: null }, ids.recruiterPerson).catch((thrown: Error & { details?: { duplicates: DuplicateMatch[] } }) => thrown);
    expect((error as Error).message).toBe("recruit_candidate_duplicate");
    const details = (error as Error & { details?: { duplicates: DuplicateMatch[] } }).details;
    expect(details?.duplicates[0].fullName).toBe("Trần Thị Mai");
    expect(details?.duplicates[0].signals).toContain("email");
  });

  it("refuses the same number typed differently", async () => {
    expect(await fails(createCandidate({ ...someone, fullName: "Ai Đó Khác", email: "khac@example.com", phone: "+84 912 345 678" }, ids.recruiterPerson))).toBe("recruit_candidate_duplicate");
  });

  // A shared name is a question a recruiter answers, not a refusal the system insists on.
  it("queries a bare name match once, then takes the recruiter's word for it", async () => {
    const input = { ...someone, email: "mai.khac@example.com", phone: "0900111222" };
    expect(await fails(createCandidate(input, ids.recruiterPerson))).toBe("recruit_candidate_possible_duplicate");
    const created = await createCandidate(input, ids.recruiterPerson, { confirmedNotDuplicate: true });
    expect(created.id).toBeTruthy();
  });

  it("lets somebody with nothing in common straight through", async () => {
    const created = await createCandidate({ ...someone, fullName: "Phạm Quốc Bảo", email: "bao.pham@example.com", phone: "0977000111" }, ids.recruiterPerson);
    expect(created.fullName).toBe("Phạm Quốc Bảo");
    expect(await findLikelyCandidateDuplicates({ fullName: "Hoàn Toàn Khác Biệt", email: "nobody@example.com", phone: "0966000222" })).toEqual([]);
  });
});

describe("applications", () => {
  let openingId: string;
  let candidateId: string;
  let applicationId: string;

  beforeAll(async () => {
    const opening = await createOpening({ ...baseOpening(), title: "Editor có hồ sơ" }, { salaryMinVnd: 18_000_000, salaryMaxVnd: 24_000_000, salaryPublic: false }, ids.recruiterPerson);
    openingId = opening.id;
    await setOpeningStatus(openingId, "open", null);
    await setOpeningTeam(openingId, [{ personId: ids.headPerson, role: "hiring_manager" }]);
    const candidate = await createCandidate(
      { fullName: "Lê Hoàng Yến", email: "yen.le@example.com", phone: "0933111222", currentTitle: null, currentEmployer: null, location: null, links: [], source: "careers_page", sourceDetail: null, referredByPersonId: null, tags: [], notes: null },
      null,
    );
    candidateId = candidate.id;
    const application = await createApplication(
      { candidateId, openingId, source: "careers_page", sourceDetail: null, coverLetter: "Em rất mong được hợp tác.", answers: {}, cvFileId: null, portfolioLinks: [], salaryExpectationVnd: 22_000_000, salaryExpectationNote: null },
      null,
    );
    applicationId = application.id;
  });

  it("starts at the pipeline's first stage and writes the history", async () => {
    const view = await getApplicationView({ principal: recruiter, personId: ids.recruiterPerson }, applicationId);
    expect(view?.stage.key).toBe("applied");
    expect(view?.events.map((event) => event.type)).toEqual(["applied"]);
  });

  it("refuses a second application to the same opening", async () => {
    expect(
      await fails(createApplication({ candidateId, openingId, source: "direct", sourceDetail: null, coverLetter: null, answers: {}, cvFileId: null, portfolioLinks: [], salaryExpectationVnd: null, salaryExpectationNote: null }, ids.recruiterPerson)),
    ).toBe("recruit_already_applied");
  });

  it("moves between stages of its own pipeline and records the move", async () => {
    const stages = await stagesOf(ids.pipeline);
    const screening = stages.find((stage) => stage.key === "screening")!;
    const { after } = await moveApplicationStage(applicationId, screening.id, ids.recruiterPerson, "Hồ sơ tốt");
    expect(after.stageId).toBe(screening.id);
    const view = await getApplicationView({ principal: recruiter, personId: ids.recruiterPerson }, applicationId);
    expect(view?.events[0]).toMatchObject({ type: "stage_moved", toStageName: screening.name, note: "Hồ sơ tốt" });
  });

  it("refuses a stage belonging to another pipeline", async () => {
    const otherStages = await stagesOf(ids.shortPipeline);
    expect(await fails(moveApplicationStage(applicationId, otherStages[1].id, ids.recruiterPerson, null))).toBe("recruit_stage_not_found");
  });

  it("hides the salary expectation from everyone but a compensation-tier grant", async () => {
    const forHr = await getApplicationView({ principal: hrAdmin, personId: ids.hrPerson }, applicationId);
    expect(forHr?.salaryExpectationVnd).toBe(22_000_000);
    expect(forHr?.canReadMoney).toBe(true);
    const forRecruiter = await getApplicationView({ principal: recruiter, personId: ids.recruiterPerson }, applicationId);
    expect(forRecruiter?.salaryExpectationVnd).toBeNull();
    expect(forRecruiter?.canReadMoney).toBe(false);
    const forHead = await getApplicationView({ principal: head, personId: ids.headPerson }, applicationId);
    expect(forHead?.canAct).toBe(true);
    expect(forHead?.salaryExpectationVnd).toBeNull();
  });

  it("is refused outright to anybody who may not see the opening", async () => {
    expect(await getApplicationView({ principal: employee, personId: ids.employeePerson }, applicationId)).toBeNull();
    expect(await getApplicationView({ principal: otherHead, personId: ids.otherHeadPerson }, applicationId)).toBeNull();
    expect(await getApplicationView({ principal: szcRecruiter, personId: ids.szcRecruiterPerson }, applicationId)).toBeNull();
    expect(await listApplications({ principal: employee, personId: ids.employeePerson }, openingId)).toEqual([]);
    expect(await listApplications({ principal: szcRecruiter, personId: ids.szcRecruiterPerson }, openingId)).toEqual([]);
  });

  it("lists for the hiring manager of that opening", async () => {
    const rows = await listApplications({ principal: head, personId: ids.headPerson }, openingId);
    expect(rows.map((row) => row.candidateName)).toContain("Lê Hoàng Yến");
  });

  // Rejection keeps the stage, which is what makes a funnel report possible at all.
  it("keeps the stage on rejection and will not move a closed application", async () => {
    const stages = await stagesOf(ids.pipeline);
    const screening = stages.find((stage) => stage.key === "screening")!;
    const { after } = await rejectApplication(applicationId, { reason: "experience", note: "Chưa đủ kinh nghiệm" }, ids.recruiterPerson);
    expect(after.status).toBe("rejected");
    expect(after.stageId).toBe(screening.id);
    expect(after.rejectionReason).toBe("experience");
    const interview = stages.find((stage) => stage.key === "interview")!;
    expect(await fails(moveApplicationStage(applicationId, interview.id, ids.recruiterPerson, null))).toBe("recruit_application_closed");
    expect(await fails(rejectApplication(applicationId, { reason: "other", note: null }, ids.recruiterPerson))).toBe("recruit_application_closed");
  });
});

describe("the candidate database", () => {
  it("is browsed by recruit:manage and by nobody else", async () => {
    expect((await listCandidates(hrAdmin)).length).toBeGreaterThan(0);
    expect(await listCandidates(head)).toEqual([]);
    expect(await listCandidates(employee)).toEqual([]);
    expect(await listCandidates(otherHead)).toEqual([]);
  });

  it("shows an entity's recruiter only the candidates who applied within their reach", async () => {
    const rows = await listCandidates(szcRecruiter);
    // Every candidate so far applied (or was sourced) against SZM openings.
    expect(rows.map((row) => row.fullName)).not.toContain("Lê Hoàng Yến");
  });

  it("lets a recruiter touch only the candidates they can find — the rule the actions check", async () => {
    const all = await listCandidates(hrAdmin);
    const applied = all.find((row) => row.applications > 0 && !row.anonymised)!;
    expect(await canReachCandidate(recruiter, applied.id)).toBe(true);
    expect(await canReachCandidate(hrAdmin, applied.id)).toBe(true);
    // Another entity's recruiter may neither edit this person nor pull them into their opening.
    expect(await canReachCandidate(szcRecruiter, applied.id)).toBe(false);
    expect(await canReachCandidate(head, applied.id)).toBe(false);
    expect([...(await reachableCandidateIds(szcRecruiter, all.map((row) => row.id)))]).toEqual((await listCandidates(szcRecruiter)).map((row) => row.id).filter((id) => all.some((row) => row.id === id)));
  });

  it("opens a lead who has applied nowhere to a group-wide grant only", async () => {
    const lead = await createCandidate({ fullName: "Ứng Viên Tiềm Năng", email: "lead.only@example.com", phone: null, currentTitle: null, currentEmployer: null, location: null, links: [], source: "direct", sourceDetail: null, referredByPersonId: null, tags: [], notes: null }, ids.hrPerson);
    expect(await getCandidateView({ principal: hrAdmin, personId: ids.hrPerson }, lead.id)).not.toBeNull();
    expect(await getCandidateView({ principal: recruiter, personId: ids.recruiterPerson }, lead.id)).toBeNull();
    expect(await getCandidateView({ principal: szcRecruiter, personId: ids.szcRecruiterPerson }, lead.id)).toBeNull();
    expect(await canReachCandidate(recruiter, lead.id)).toBe(false);
  });

  it("tells a recruiter a clash exists, but not who it is when they cannot reach them", async () => {
    const all = await listCandidates(hrAdmin);
    const applied = (await Promise.all(all.filter((row) => row.applications > 0 && !row.anonymised).map((row) => db().select().from(schema.candidate).where(eq(schema.candidate.id, row.id))))).flat().find((row) => row.email)!;
    const clash = { fullName: "Khác Hẳn", email: applied.email, phone: null, currentTitle: null, currentEmployer: null, location: null, links: [], source: "direct" as const, sourceDetail: null, referredByPersonId: null, tags: [], notes: null };
    const detailsFor = async (viewer: Principal) =>
      ((await createCandidate(clash, viewer.personId, { viewer }).catch((thrown: Error & { details?: { duplicates: RedactedDuplicateMatch[] } }) => thrown)) as Error & { details?: { duplicates: RedactedDuplicateMatch[] } }).details!.duplicates;
    const hidden = await detailsFor(szcRecruiter);
    expect(hidden[0]).toMatchObject({ id: null, fullName: null, certain: true });
    expect(hidden[0].signals).toContain("email");
    expect((await detailsFor(recruiter))[0]).toMatchObject({ id: applied.id, fullName: applied.fullName });
  });

  it("refuses a candidate page to somebody who may not browse and has no opening in common", async () => {
    const [someone] = await db().select({ id: schema.candidate.id }).from(schema.candidate).limit(1);
    expect(await getCandidateView({ principal: employee, personId: ids.employeePerson }, someone.id)).toBeNull();
    expect(await getCandidateView({ principal: otherHead, personId: ids.otherHeadPerson }, someone.id)).toBeNull();
  });
});

describe("headcount planning (FR-CHR-17)", () => {
  it("counts approved heads against the ones turned into openings", async () => {
    await db().insert(schema.hiringRequest).values({
      entityId: ids.szm,
      departmentId: ids.vid,
      positionTitle: "Editor thứ hai",
      headcount: 2,
      reason: "Mở rộng đội ngũ",
      requestedByPersonId: ids.headPerson,
      status: "approved",
    });
    await db().insert(schema.hiringRequest).values({
      entityId: ids.szm,
      departmentId: ids.vid,
      positionTitle: "Editor đã mở",
      headcount: 1,
      reason: "Thay người nghỉ",
      requestedByPersonId: ids.headPerson,
      status: "fulfilled",
    });
    const rows = await headcountPlan(hrAdmin);
    const video = rows.find((row) => row.departmentName === "Video");
    expect(video).toMatchObject({ approvedHeads: 3, openHeads: 2, hired: 1 });
    // Somebody with no recruitment reach gets no plan at all.
    expect(await headcountPlan(employee)).toEqual([]);
  });
});

describe("recruitment reports (FR-REC-11)", () => {
  it("counts the grouped funnel exactly as it would one row per application", async () => {
    // A spread of applications on a fresh opening: several stages, sources and outcomes, two hires.
    const opening = await createOpening({ ...baseOpening(), title: "Report fixture" }, null, ids.recruiterPerson);
    const stages = await stagesOf(ids.pipeline);
    const candidates = await db().select({ id: schema.candidate.id }).from(schema.candidate);
    const shapes = [
      { stage: 0, status: "active", source: "careers_page" },
      { stage: 0, status: "active", source: "careers_page" },
      { stage: 3, status: "rejected", source: "referral" },
      { stage: 3, status: "active", source: "referral" },
      { stage: 7, status: "hired", source: "referral", days: 12 },
      { stage: 7, status: "hired", source: "careers_page", days: 30 },
      { stage: 1, status: "withdrawn", source: "careers_page" },
    ] as const;
    for (const [index, shape] of shapes.entries()) {
      const candidateId = candidates[index]?.id ?? (await createCandidate({ fullName: `Ứng viên báo cáo ${index}`, email: `report${index}@example.com`, phone: null, currentTitle: null, currentEmployer: null, location: null, links: [], source: shape.source, sourceDetail: null, referredByPersonId: null, tags: [], notes: null }, ids.recruiterPerson, { confirmedNotDuplicate: true })).id;
      const appliedAt = new Date("2026-03-01T00:00:00Z");
      const closedAt = "days" in shape ? new Date(appliedAt.getTime() + shape.days * 86_400_000) : null;
      await db().insert(schema.jobApplication).values({ candidateId, openingId: opening.id, stageId: stages[shape.stage].id, status: shape.status, source: shape.source, appliedAt, closedAt });
    }
    const rows = await db()
      .select({
        category: schema.recruitPipelineStage.category,
        status: schema.jobApplication.status,
        source: schema.jobApplication.source,
        days: sql<number | null>`case when ${schema.jobApplication.status} = 'hired' then extract(day from coalesce(${schema.jobApplication.closedAt}, ${schema.jobApplication.updatedAt}) - ${schema.jobApplication.appliedAt})::int else null end`,
      })
      .from(schema.jobApplication)
      .innerJoin(schema.recruitPipelineStage, eq(schema.recruitPipelineStage.id, schema.jobApplication.stageId));
    expect(rows.length).toBeGreaterThan(shapes.length);
    const expected = funnelReport(rows.map((row) => ({ category: row.category, status: row.status, source: row.source, daysToHire: row.days === null ? null : Number(row.days) }) as FunnelApplication));
    const report = await getRecruitReport(hrAdmin);
    expect({ ...report, openings: undefined, openOpenings: undefined }).toEqual({ ...expected, openings: undefined, openOpenings: undefined });
    expect(report.openings.length).toBeGreaterThan(0);
    expect(report.timeToHire.hires).toBeGreaterThanOrEqual(2);
    expect(report.sources.length).toBeGreaterThanOrEqual(2);
    // Nobody in reach, nothing counted.
    expect((await getRecruitReport(employee)).applications).toBe(0);
  });
});
