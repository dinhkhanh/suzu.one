// Candidate emails against a real Postgres (PGlite). The interesting questions are not whether a
// letter renders — `engine/email-template.ts` is tested for that — but whether it goes through the
// one outbox, whether the history records that it happened, and whether anything that should never
// leave the company can ride along in it.
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => import("../../../tests/helpers/db"));
vi.mock("@/lib/env", () => ({ env: () => ({ BETTER_AUTH_URL: "https://suzu.one", BETTER_AUTH_SECRET: "a-test-secret-long-enough-to-sign-with" }) }));

import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { migrateTestDb } from "../../../tests/helpers/db";
import { findEmailTemplate, listEmailTemplates, previewCandidateEmail, saveEmailTemplate, sendCandidateEmail } from "./emails";
import { EMAIL_TEMPLATE_SEED } from "./seed-email-templates";
import { PIPELINE_SEED } from "./seed-pipelines";
import { createApplication, createCandidate, createOpening, savePipeline, setOpeningStatus } from "./service";

const fails = (promise: Promise<unknown>) => promise.then(() => "no error", (error: Error) => error.message);

const ids = {} as Record<"szm" | "pipeline" | "recruiterPerson" | "openingId" | "applicationId" | "silentApplicationId" | "inviteTemplateId", string>;
const sender = { personId: "", fullName: "Người tuyển dụng" };

beforeAll(async () => {
  await migrateTestDb();
  const [szm] = await db().insert(schema.entity).values({ code: "SZM", legalName: "Công ty Suzu Media", shortName: "Suzu Media" }).returning();
  const [person] = await db().insert(schema.person).values({ fullName: "Người tuyển dụng", searchName: "nguoi tuyen dung", primaryEntityId: szm.id, status: "active" }).returning();
  ids.szm = szm.id;
  ids.recruiterPerson = person.id;
  sender.personId = person.id;

  const { after } = await savePipeline(null, { ...PIPELINE_SEED[0], isActive: true, stages: PIPELINE_SEED[0].stages.map((stage) => ({ ...stage })) });
  ids.pipeline = after.id;

  const opening = await createOpening(
    {
      title: "Video Editor",
      titleEn: null,
      entityId: szm.id,
      departmentId: null,
      teamId: null,
      positionName: null,
      jobLevel: null,
      employmentType: "employee",
      workMode: "onsite",
      workLocation: null,
      headcount: 1,
      description: "",
      requirements: "",
      benefits: "",
      pipelineId: ids.pipeline,
      targetStartDate: null,
      questions: [],
    },
    { salaryMinVnd: 18_000_000, salaryMaxVnd: 25_000_000, salaryPublic: false },
    person.id,
  );
  await setOpeningStatus(opening.id, "open", null);
  ids.openingId = opening.id;

  const blank = { currentTitle: null, currentEmployer: null, location: null, links: [], source: "careers_page" as const, sourceDetail: null, referredByPersonId: null, tags: [], notes: null };
  const candidate = await createCandidate({ ...blank, fullName: "Trần Thị Mai", email: "mai@example.com", phone: "0912345678" }, person.id);
  const silent = await createCandidate({ ...blank, fullName: "Không Có Email", email: null, phone: "0900000000" }, person.id);
  const application = await createApplication(
    { candidateId: candidate.id, openingId: opening.id, source: "careers_page", sourceDetail: null, coverLetter: null, answers: {}, cvFileId: null, portfolioLinks: [], salaryExpectationVnd: 30_000_000, salaryExpectationNote: null },
    person.id,
  );
  const silentApplication = await createApplication(
    { candidateId: silent.id, openingId: opening.id, source: "direct", sourceDetail: null, coverLetter: null, answers: {}, cvFileId: null, portfolioLinks: [], salaryExpectationVnd: null, salaryExpectationNote: null },
    person.id,
  );
  ids.applicationId = application.id;
  ids.silentApplicationId = silentApplication.id;

  for (const seed of EMAIL_TEMPLATE_SEED) {
    const { after: saved } = await saveEmailTemplate(null, { ...seed, isActive: true }, person.id);
    if (seed.code === "INVITE_INTERVIEW") ids.inviteTemplateId = saved.id;
  }
});

describe("the seeded wordings", () => {
  it("all save — every placeholder they name is one the system knows, in both languages", async () => {
    expect((await listEmailTemplates()).map((row) => row.code).sort()).toEqual(EMAIL_TEMPLATE_SEED.map((seed) => seed.code).sort());
  });

  it("name no figure: an amount belongs in the offer letter, not in a wording anyone may edit", () => {
    for (const seed of EMAIL_TEMPLATE_SEED) {
      expect(`${seed.subject}${seed.body}${seed.subjectEn}${seed.bodyEn}`).not.toMatch(/\{\{\s*(salary|amount|offer_amount|budget)/);
    }
  });
});

describe("saving a wording", () => {
  it("refuses a placeholder the system cannot fill — including one hiding in the English body", async () => {
    const draft = { code: "BAD", name: "Bad", kind: "general" as const, subject: "Hi", body: "Hi {{candidate_name}}", subjectEn: "Hi", bodyEn: "Hi {{candidat_name}}", isActive: true };
    expect(await fails(saveEmailTemplate(null, draft, ids.recruiterPerson))).toBe("email_template_unknown_placeholder");
  });

  it("refuses an empty body", async () => {
    expect(await fails(saveEmailTemplate(null, { code: "EMPTY", name: "Empty", kind: "general", subject: "Hi", body: "   ", subjectEn: null, bodyEn: null, isActive: true }, ids.recruiterPerson))).toBe("email_template_body_empty");
  });
});

describe("sending", () => {
  it("renders from the records, queues one email in the shared outbox and writes the history", async () => {
    const sent = await sendCandidateEmail(ids.applicationId, ids.inviteTemplateId, sender, "vi");
    expect(sent.to).toBe("mai@example.com");
    expect(sent.subject).toContain("Video Editor");
    expect(sent.subject).toContain("Suzu Media");

    const [email] = await db().select().from(schema.emailOutbox).where(eq(schema.emailOutbox.toEmail, "mai@example.com"));
    expect(email.status).toBe("pending");
    expect(email.bodyText).toContain("Trần Thị Mai");
    expect(email.bodyText).toContain("Người tuyển dụng");
    // Nothing is left unfilled in a seeded wording sent from a real application.
    expect(email.bodyText).not.toContain("{{");

    const events = await db().select().from(schema.applicationEvent).where(eq(schema.applicationEvent.applicationId, ids.applicationId));
    const emailed = events.find((event) => event.type === "emailed")!;
    expect(emailed.actorPersonId).toBe(ids.recruiterPerson);
    // Which wording went, not what it said.
    expect(emailed.detail).toMatchObject({ templateCode: "INVITE_INTERVIEW", kind: "invite" });
  });

  it("never carries a figure, even though the application has one", async () => {
    const [email] = await db().select().from(schema.emailOutbox).where(eq(schema.emailOutbox.toEmail, "mai@example.com"));
    expect(`${email.subject}${email.bodyText}`).not.toMatch(/30[.,]?000[.,]?000|30000000/);
  });

  it("writes the English wording when that is the candidate's language", async () => {
    const preview = await previewCandidateEmail(ids.applicationId, ids.inviteTemplateId, sender, "en");
    expect(preview?.subject).toMatch(/Interview invitation/);
    expect(preview?.missing).toEqual([]);
    // A preview reads and writes nothing.
    expect(await db().select().from(schema.emailOutbox).where(eq(schema.emailOutbox.toEmail, "mai@example.com"))).toHaveLength(1);
  });

  it("points the candidate at the public careers page and nowhere else inside the product", async () => {
    const reject = (await listEmailTemplates()).find((row) => row.code === "REJECT_AFTER_REVIEW")!;
    const preview = await previewCandidateEmail(ids.applicationId, reject.id, sender, "vi");
    expect(preview?.body).toContain("https://suzu.one/careers");
    expect(preview?.body).not.toMatch(/\/recruit\//);
  });

  it("refuses a candidate with no address rather than sending into the void", async () => {
    expect(await fails(sendCandidateEmail(ids.silentApplicationId, ids.inviteTemplateId, sender, "vi"))).toBe("recruit_candidate_no_email");
  });

  it("refuses a wording that has been turned off", async () => {
    const [row] = await db().select().from(schema.recruitEmailTemplate).where(eq(schema.recruitEmailTemplate.code, "OFFER_NOTE"));
    await saveEmailTemplate(row.id, { code: row.code, name: row.name, kind: row.kind, subject: row.subject, body: row.body, subjectEn: row.subjectEn, bodyEn: row.bodyEn, isActive: false }, ids.recruiterPerson);
    expect(await findEmailTemplate(row.id)).toBeUndefined();
    expect(await fails(sendCandidateEmail(ids.applicationId, row.id, sender, "vi"))).toBe("recruit_email_template_not_found");
  });
});
