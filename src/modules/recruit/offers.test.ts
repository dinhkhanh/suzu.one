// Offers and the conversion to an employee, against a real Postgres (PGlite).
//
// Three rules are worth the file. The **figure** must reach exactly two roles and nobody else, and
// the check has to live in the service rather than on a page. **Converting twice** must be
// impossible — proved once through the use-case and once by reaching past it into the table. And
// the **letter** must refuse a reader who may not see a salary the same way a missing id refuses.
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => import("../../../tests/helpers/db"));
vi.mock("@/lib/env", () => ({
  env: () => ({ BETTER_AUTH_URL: "https://suzu.one", BETTER_AUTH_SECRET: "a-test-secret-long-enough-to-sign-with" }),
  isDevelopmentEnvironment: () => true,
}));

import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { migrateTestDb } from "../../../tests/helpers/db";
import { DOCUMENT_TEMPLATE_SEED } from "../documents/seed-templates";
import type { Principal } from "../platform/rbac/policy";
import { convertToEmployee, findOffer, getOfferView, listOffers, makeOffer, offerLetter, recordOfferResponse, sendOffer, submitOfferForApproval, updateOffer, withdrawOffer } from "./offers";
import { PIPELINE_SEED } from "./seed-pipelines";
import { createApplication, createCandidate, createOpening, findApplication, savePipeline, setOpeningStatus, setOpeningTeam } from "./service";

const fails = (promise: Promise<unknown>) =>
  promise.then(
    () => "no error",
    (error: Error) => error.message,
  );
const principal = (personId: string | null, grants: Principal["grants"] = []): Principal => ({ personId, workforceType: "employee", grants });
const viewerOf = (p: Principal) => ({ principal: p, personId: p.personId });

/** Far enough ahead that the offer's start date is always in the future whenever this runs. */
const isoDay = (offsetDays: number) => new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10);

const ids = {} as Record<"szm" | "vid" | "pipeline" | "openingId" | "applicationId" | "candidateId" | "hrAdmin" | "hrStaff" | "recruiterPerson" | "headPerson" | "strangerPerson" | "templateId" | "personalTemplateId", string>;
let owner: Principal;
let hrAdmin: Principal;
let hrStaff: Principal;
let recruiter: Principal;
let head: Principal;
let stranger: Principal;

const offerInput = (over: Partial<Parameters<typeof makeOffer>[0]> = {}) => ({
  applicationId: ids.applicationId,
  positionName: "Video Editor",
  jobLevel: "Middle",
  employmentType: "employee" as const,
  workLocation: "Hà Nội",
  managerPersonId: ids.headPerson,
  startDate: isoDay(30),
  expiresOn: null,
  probationMonths: 2,
  probationSalaryPercent: 85,
  baseSalaryVnd: 22_000_000,
  allowancesVnd: 1_500_000,
  letterTemplateId: ids.templateId,
  note: null,
  ...over,
});

/** A fresh candidate + application, so each test that ends an offer starts from a clean one. */
async function freshApplication(name: string, email: string): Promise<string> {
  const candidate = await createCandidate(
    { fullName: name, email, phone: null, currentTitle: null, currentEmployer: null, location: "Hà Nội", links: [], source: "careers_page", sourceDetail: null, referredByPersonId: null, tags: [], notes: null },
    ids.recruiterPerson,
  );
  const application = await createApplication(
    { candidateId: candidate.id, openingId: ids.openingId, source: "careers_page", sourceDetail: null, coverLetter: null, answers: {}, cvFileId: null, portfolioLinks: [], salaryExpectationVnd: null, salaryExpectationNote: null },
    ids.recruiterPerson,
  );
  return application.id;
}

beforeAll(async () => {
  await migrateTestDb();
  const [szm] = await db().insert(schema.entity).values({ code: "SZM", legalName: "Công ty SuZu Media", shortName: "SuZu Media" }).returning();
  const [vid] = await db().insert(schema.orgUnit).values({ code: "VID", name: "Video" }).returning();
  ids.szm = szm.id;
  ids.vid = vid.id;

  for (const [key, fullName, email] of [
    ["hrAdmin", "Trưởng phòng Nhân sự", "hr@suzu.group"],
    ["hrStaff", "Chuyên viên Nhân sự", "hrstaff@suzu.group"],
    ["recruiterPerson", "Người tuyển dụng", "recruiter@suzu.group"],
    ["headPerson", "Trưởng phòng Video", "head@suzu.group"],
    ["strangerPerson", "Nhân viên thường", "nv@suzu.group"],
  ] as const) {
    const [row] = await db().insert(schema.person).values({ fullName, searchName: key, workEmail: email, primaryEntityId: szm.id, orgUnitId: vid.id, status: "active" }).returning();
    ids[key] = row.id;
  }

  // The approval flow resolves its approvers from `role_assignment`, not from the in-memory
  // principals: the department head signs off on the person, whoever may approve payroll on the
  // money. Without these rows a submitted offer has nobody to go to.
  await db().insert(schema.roleAssignment).values([
    { personId: ids.headPerson, role: "department_head", scopeType: "unit", scopeId: vid.id },
    { personId: ids.hrAdmin, role: "hr_admin", scopeType: "entity", scopeId: szm.id },
    { personId: ids.strangerPerson, role: "c_level", scopeType: "group", scopeId: null },
  ]);

  owner = principal(ids.hrAdmin, [{ role: "owner", scope: { type: "group" } }]);
  hrAdmin = principal(ids.hrAdmin, [{ role: "hr_admin", scope: { type: "entity", id: szm.id } }]);
  hrStaff = principal(ids.hrStaff, [{ role: "hr_staff", scope: { type: "entity", id: szm.id } }]);
  recruiter = principal(ids.recruiterPerson, [{ role: "recruiter", scope: { type: "entity", id: szm.id } }]);
  head = principal(ids.headPerson, [{ role: "department_head", scope: { type: "unit", id: vid.id } }]);
  stranger = principal(ids.strangerPerson);

  const { after: pipeline } = await savePipeline(null, { ...PIPELINE_SEED[0], isActive: true, stages: PIPELINE_SEED[0].stages.map((stage) => ({ ...stage })) });
  ids.pipeline = pipeline.id;

  const opening = await createOpening(
    {
      title: "Video Editor",
      titleEn: null,
      entityId: szm.id,
      departmentId: vid.id,
      teamId: null,
      positionName: "Video Editor",
      jobLevel: null,
      employmentType: "employee",
      workMode: "onsite",
      workLocation: "Hà Nội",
      headcount: 1,
      description: "",
      requirements: "",
      benefits: "",
      pipelineId: pipeline.id,
      targetStartDate: null,
      questions: [],
    },
    null,
    ids.recruiterPerson,
  );
  ids.openingId = opening.id;
  await setOpeningStatus(opening.id, "open", null);
  await setOpeningTeam(opening.id, [{ personId: ids.headPerson, role: "hiring_manager" }]);

  // Two wordings: one that prints a salary, one that does not. The pair is what proves the letter
  // refuses by tier rather than by which page asked for it.
  const [template] = await db()
    .insert(schema.documentTemplate)
    .values({ code: "TM-TEST", name: "Thư mời nhận việc", kind: "offer", tier: "compensation", body: "{{person.fullName}} — {{person.position}} — {{salary.total}} đồng — đến {{offer.expiryDate}}", letterhead: { companyName: "SuZu Media" } })
    .returning();
  ids.templateId = template.id;
  const [plain] = await db()
    .insert(schema.documentTemplate)
    .values({ code: "TM-TEST-PLAIN", name: "Thư mời (không lương)", kind: "offer", tier: "personal", body: "{{person.fullName}} — {{person.position}} — bắt đầu {{employment.startDate}}", letterhead: {} })
    .returning();
  ids.personalTemplateId = plain.id;

  ids.applicationId = await freshApplication("Phạm Minh Anh", "minhanh@example.test");
  const application = await findApplication(ids.applicationId);
  ids.candidateId = application!.candidateId;
});

describe("making an offer", () => {
  it("copies the job off the opening and numbers the letter", async () => {
    const offer = await makeOffer(offerInput(), ids.hrAdmin);
    expect(offer.number).toBe(`SZM-TM-${new Date().getUTCFullYear()}-0001`);
    expect(offer.departmentId).toBe(ids.vid);
    expect(offer.status).toBe("draft");
    // No expiry given: a week, or the start date, whichever comes first.
    expect(offer.expiresOn).toBe(isoDay(7));
    await withdrawOffer(offer.id, ids.hrAdmin, null);
  });

  it("refuses a second live offer on the same application", async () => {
    const first = await makeOffer(offerInput(), ids.hrAdmin);
    expect(await fails(makeOffer(offerInput(), ids.hrAdmin))).toBe("offer_already_open");
    // Once it is off the table the next one may be drafted.
    await withdrawOffer(first.id, ids.hrAdmin, null);
    const second = await makeOffer(offerInput(), ids.hrAdmin);
    expect(second.id).not.toBe(first.id);
    await withdrawOffer(second.id, ids.hrAdmin, null);
  });

  it("refuses a figure or a date the engine would not accept", async () => {
    expect(await fails(makeOffer(offerInput({ baseSalaryVnd: 0 }), ids.hrAdmin))).toBe("offer_amount_invalid");
    expect(await fails(makeOffer(offerInput({ startDate: isoDay(-1) }), ids.hrAdmin))).toBe("offer_start_date_past");
    expect(await fails(makeOffer(offerInput({ expiresOn: isoDay(60) }), ids.hrAdmin))).toBe("offer_expiry_after_start");
    expect(await fails(makeOffer(offerInput({ probationSalaryPercent: 50 }), ids.hrAdmin))).toBe("offer_probation_percent_invalid");
  });

  it("will not be drafted against a closed application", async () => {
    const applicationId = await freshApplication("Ứng viên đã rút", "rut@example.test");
    await db().update(schema.jobApplication).set({ status: "withdrawn" }).where(eq(schema.jobApplication.id, applicationId));
    expect(await fails(makeOffer(offerInput({ applicationId }), ids.hrAdmin))).toBe("recruit_application_closed");
  });
});

describe("the money reaches two roles and no others", () => {
  it("shows the figure to the owner and to hr_admin, and hides it from everybody else", async () => {
    const offer = await makeOffer(offerInput(), ids.hrAdmin);
    for (const [name, who] of [
      ["owner", owner],
      ["hr_admin", hrAdmin],
    ] as const) {
      const view = await getOfferView(viewerOf(who), offer.id);
      expect(view?.money, name).not.toBeNull();
      expect(view?.money?.totalVnd, name).toBe(23_500_000);
      expect(view?.money?.probationMonthlyVnd, name).toBe(19_975_000);
    }

    // hr_staff and a recruiter run the whole pipeline; the hiring manager is on the team. None of
    // them is ever handed a đồng, and the row they get back simply does not contain one.
    for (const [name, who] of [
      ["hr_staff", hrStaff],
      ["recruiter", recruiter],
      ["hiring manager", head],
    ] as const) {
      const view = await getOfferView(viewerOf(who), offer.id);
      expect(view, name).not.toBeNull();
      expect(view?.money, name).toBeNull();
      expect(JSON.stringify(view?.money), name).not.toContain("22000000");
    }

    // Nobody else sees the offer at all — not even that it exists.
    expect(await getOfferView(viewerOf(stranger), offer.id)).toBeNull();
    await withdrawOffer(offer.id, ids.hrAdmin, null);
  });

  it("keeps the figure out of the list as well", async () => {
    const offer = await makeOffer(offerInput(), ids.hrAdmin);
    const rows = await listOffers(hrAdmin, ids.hrAdmin);
    expect(rows.map((row) => row.number)).toContain(offer.number);
    // A list is glanced at over a shoulder: it carries a name, a job and a date.
    expect(JSON.stringify(rows)).not.toContain("22000000");
    expect(await listOffers(stranger, ids.strangerPerson)).toEqual([]);
    await withdrawOffer(offer.id, ids.hrAdmin, null);
  });
});

describe("the letter", () => {
  it("renders for a reader who may see a salary", async () => {
    const offer = await makeOffer(offerInput(), ids.hrAdmin);
    const letter = await offerLetter(viewerOf(hrAdmin), offer.id);
    expect(letter?.text).toContain("Phạm Minh Anh");
    expect(letter?.text).toContain("23.500.000");
    expect(letter?.missing).toEqual([]);
    await withdrawOffer(offer.id, ids.hrAdmin, null);
  });

  it("refuses a compensation letter to everybody else, exactly as a missing id refuses", async () => {
    const offer = await makeOffer(offerInput(), ids.hrAdmin);
    for (const [name, who] of [
      ["hr_staff", hrStaff],
      ["recruiter", recruiter],
      ["hiring manager", head],
      ["stranger", stranger],
    ] as const) {
      expect(await offerLetter(viewerOf(who), offer.id), name).toBeNull();
    }
    // The same answer as an offer that does not exist: a 404 says nothing about which it was.
    expect(await offerLetter(viewerOf(hrAdmin), "00000000-0000-4000-8000-000000000000")).toBeNull();
    await withdrawOffer(offer.id, ids.hrAdmin, null);
  });

  it("renders the wording the company actually ships with no holes in it", async () => {
    // The seeded `TM-NHAN-VIEC` body, not a fixture: a placeholder nobody fills would print
    // "[salary.total]" on a letter somebody signs, and `missing` is the only thing that says so.
    const seeded = DOCUMENT_TEMPLATE_SEED.find((template) => template.kind === "offer");
    expect(seeded).toBeTruthy();
    const [row] = await db().insert(schema.documentTemplate).values({ ...seeded!, code: "TM-SEEDED-TEST" }).returning();
    const offer = await makeOffer(offerInput({ letterTemplateId: row.id }), ids.hrAdmin);
    const letter = await offerLetter(viewerOf(hrAdmin), offer.id);
    expect(letter?.missing).toEqual([]);
    expect(letter?.text).toContain("Phạm Minh Anh");
    expect(letter?.text).toContain("23.500.000");
    // Probation pay, spelled out in đồng, and the day the offer lapses.
    expect(letter?.text).toContain("19.975.000");
    expect(letter?.text).toContain(isoDay(7).split("-").reverse().join("/"));
    await withdrawOffer(offer.id, ids.hrAdmin, null);
  });

  it("gives a personal-tier wording to the pipeline without a figure in it", async () => {
    const offer = await makeOffer(offerInput({ letterTemplateId: ids.personalTemplateId }), ids.hrAdmin);
    const letter = await offerLetter(viewerOf(hrStaff), offer.id);
    expect(letter?.text).toContain("Phạm Minh Anh");
    expect(letter?.text).not.toContain("22.000.000");
    await withdrawOffer(offer.id, ids.hrAdmin, null);
  });
});

describe("the offer's life, enforced in the service", () => {
  it("cannot be sent before it is approved, and cannot be edited after it is submitted", async () => {
    const applicationId = await freshApplication("Ứng viên chờ duyệt", "choduyet@example.test");
    const offer = await makeOffer(offerInput({ applicationId }), ids.hrAdmin);
    expect(await fails(sendOffer(offer.id, ids.hrAdmin))).toBe("offer_not_sendable");

    // The flow's first step is the opening's own department head — resolved from `role_assignment`,
    // not from whoever happened to file it.
    const { requestId } = await submitOfferForApproval(offer.id, ids.hrAdmin);
    const [request] = await db().select().from(schema.approvalRequest).where(eq(schema.approvalRequest.id, requestId));
    expect(request.status).toBe("pending");
    // The summary is read in an inbox, an email and a chat card. A name and a job, never a figure.
    expect(request.summary).not.toMatch(/22|23[.,]?5|000/);
    expect(JSON.stringify(request.payload)).not.toContain("22000000");

    expect((await findOffer(offer.id))?.status).toBe("pending_approval");
    expect(await fails(updateOffer(offer.id, offerInput({ applicationId })))).toBe("offer_not_editable");
    expect(await fails(sendOffer(offer.id, ids.hrAdmin))).toBe("offer_not_sendable");
  });

  it("cannot be answered before it has been sent", async () => {
    const applicationId = await freshApplication("Chưa gửi thư", "chuagui@example.test");
    const offer = await makeOffer(offerInput({ applicationId }), ids.hrAdmin);
    expect(await fails(recordOfferResponse(offer.id, { answer: "accept", reason: null, note: null }, ids.recruiterPerson))).toBe("offer_not_answerable");
  });

  it("is not answerable once its last day has gone by", async () => {
    const applicationId = await freshApplication("Thư đã hết hạn", "hethan@example.test");
    const offer = await makeOffer(offerInput({ applicationId }), ids.hrAdmin);
    await db().update(schema.jobOffer).set({ status: "sent", expiresOn: isoDay(-1) }).where(eq(schema.jobOffer.id, offer.id));
    expect(await fails(recordOfferResponse(offer.id, { answer: "accept", reason: null, note: null }, ids.recruiterPerson))).toBe("offer_expired");
    // And it reads as expired without anything having been written to say so.
    expect((await getOfferView(viewerOf(hrAdmin), offer.id))?.status).toBe("expired");
  });

  it("ends the application when the candidate declines, and keeps the reason", async () => {
    const applicationId = await freshApplication("Ứng viên từ chối", "tuchoi@example.test");
    const offer = await makeOffer(offerInput({ applicationId }), ids.hrAdmin);
    await db().update(schema.jobOffer).set({ status: "sent" }).where(eq(schema.jobOffer.id, offer.id));

    const { after } = await recordOfferResponse(offer.id, { answer: "decline", reason: "another_offer", note: "Đã nhận việc nơi khác" }, ids.recruiterPerson);
    expect(after.status).toBe("declined");
    expect(after.declineReason).toBe("another_offer");
    const application = await findApplication(applicationId);
    expect(application?.status).toBe("rejected");
    // The stage is left where it stood, so the funnel can say people fall out at the offer.
    expect(application?.stageId).toBeTruthy();
    // A decline is not a conversion.
    expect(application?.hiredPersonId).toBeNull();
  });
});

describe("becoming an employee", () => {
  it("carries everything the candidate typed onto a pre-boarding person, and proposes the salary", async () => {
    const applicationId = await freshApplication("Lê Hoàng Nam", "nam@example.test");
    const offer = await makeOffer(offerInput({ applicationId }), ids.hrAdmin);
    await db().update(schema.jobOffer).set({ status: "sent" }).where(eq(schema.jobOffer.id, offer.id));
    await recordOfferResponse(offer.id, { answer: "accept", reason: null, note: null }, ids.recruiterPerson);

    const result = await convertToEmployee(offer.id, ids.hrAdmin, { employeeCode: "SZM0999" });
    const [person] = await db().select().from(schema.person).where(eq(schema.person.id, result.personId));
    // Nothing was retyped: the name, the phone, the address and the start date all came across.
    expect(person.fullName).toBe("Lê Hoàng Nam");
    // A future start date means pre-boarding — Phase 1's roll-over makes them active on the morning.
    expect(person.status).toBe("preboarding");
    expect(person.primaryEntityId).toBe(ids.szm);
    expect(person.departmentId).toBe(ids.vid);
    expect(person.managerId).toBe(ids.headPerson);
    // A work address is issued during onboarding, never guessed from the personal one.
    expect(person.workEmail).toBeNull();

    const [profile] = await db().select().from(schema.personProfile).where(eq(schema.personProfile.personId, result.personId));
    expect(profile.personalEmail).toBe("nam@example.test");
    expect(profile.currentAddress).toBe("Hà Nội");

    const [employment] = await db().select().from(schema.employment).where(eq(schema.employment.personId, result.personId));
    expect(employment.employeeCode).toBe("SZM0999");
    expect(employment.startDate).toBe(isoDay(30));

    const application = await findApplication(applicationId);
    expect(application?.hiredPersonId).toBe(result.personId);
    expect(application?.status).toBe("hired");

    // Payroll has no component catalogue in this fixture, so the proposal cannot be made — and the
    // person exists anyway, with the reason handed back rather than swallowed.
    expect(result.salaryRequestId === null ? result.salaryProblem : "proposed").toBeTruthy();
  });

  it("refuses a second conversion through the use-case", async () => {
    const applicationId = await freshApplication("Đỗ Thị Mai", "mai@example.test");
    const offer = await makeOffer(offerInput({ applicationId }), ids.hrAdmin);
    await db().update(schema.jobOffer).set({ status: "sent" }).where(eq(schema.jobOffer.id, offer.id));
    await recordOfferResponse(offer.id, { answer: "accept", reason: null, note: null }, ids.recruiterPerson);
    await convertToEmployee(offer.id, ids.hrAdmin, { employeeCode: "SZM0998" });

    expect(await fails(convertToEmployee(offer.id, ids.hrAdmin, { employeeCode: "SZM0997" }))).toBe("recruit_already_converted");
  });

  it("refuses a second person for one application past the use-case, in the database", async () => {
    const applicationId = await freshApplication("Vũ Quốc Khánh", "khanh@example.test");
    const offer = await makeOffer(offerInput({ applicationId }), ids.hrAdmin);
    await db().update(schema.jobOffer).set({ status: "sent" }).where(eq(schema.jobOffer.id, offer.id));
    await recordOfferResponse(offer.id, { answer: "accept", reason: null, note: null }, ids.recruiterPerson);
    const { personId } = await convertToEmployee(offer.id, ids.hrAdmin, { employeeCode: "SZM0996" });

    // Reaching straight past the use-case and pointing a second application at the same person:
    // the partial unique index is what answers, not the code.
    const otherApplicationId = await freshApplication("Người khác", "khac@example.test");
    const error = await db()
      .update(schema.jobApplication)
      .set({ hiredPersonId: personId })
      .where(eq(schema.jobApplication.id, otherApplicationId))
      .then(
        () => null,
        // Drizzle wraps the driver's error: the SQLSTATE is on `cause`.
        (problem: Error & { cause?: { code?: string; constraint?: string } }) => problem.cause,
      );
    expect(error?.code).toBe("23505");
    expect(error?.constraint).toBe("job_application_hired_person_key");
  });

  it("will not convert an offer nobody accepted", async () => {
    const applicationId = await freshApplication("Chưa trả lời", "chua@example.test");
    const offer = await makeOffer(offerInput({ applicationId }), ids.hrAdmin);
    expect(await fails(convertToEmployee(offer.id, ids.hrAdmin))).toBe("offer_not_accepted");
  });
});
