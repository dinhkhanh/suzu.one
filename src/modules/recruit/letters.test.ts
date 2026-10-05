// The candidate hears from us (REC-04), against a real Postgres (PGlite) with the mail provider
// faked the way the rest of the suite fakes it: there is no `RESEND_API_KEY`, so what is under test
// is what lands in the one outbox — to whom, in which language, with which file — and what the
// application's history and the recruiters' notices say about it.
//
// And the exit criterion's other half: a purged candidate leaves no name behind, in the letters,
// in the notices about them, or in the link that opened their privacy page.
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => import("../../../tests/helpers/db"));
vi.mock("@/lib/env", () => ({
  env: () => ({ BETTER_AUTH_URL: "https://suzu.one", BETTER_AUTH_SECRET: "a-test-secret-long-enough-to-sign-with" }),
  isDevelopmentEnvironment: () => true,
}));

import { and, eq, like } from "drizzle-orm";
import { addDays, todayInVietnam } from "@/lib/dates";
import { db, schema } from "@/lib/db";
import { migrateTestDb } from "../../../tests/helpers/db";
import { deliverPendingEmails } from "../platform/notifications/service";
import type { Principal } from "../platform/rbac/policy";
import { saveEmailTemplate } from "./emails";
import { MIN_FILL_MS } from "./engine/form-token";
import { scheduleInterview, setInterviewStatus } from "./interviews";
import { anonymiseCandidate } from "./jobs";
import { rejectApplicationAndTell } from "./letters";
import { makeOffer, sendOffer } from "./offers";
import { findPublicPrivacyView, leaveTalentPool, setTalentPool } from "./privacy";
import { applyToOpening, issueFormToken } from "./public";
import { EMAIL_TEMPLATE_SEED } from "./seed-email-templates";
import { PIPELINE_SEED } from "./seed-pipelines";
import { createApplication, createCandidate, createOpening, getApplicationView, listCandidates, listUndeliveredLetters, savePipeline, setOpeningStatus, setOpeningTeam } from "./service";

const principal = (personId: string | null, grants: Principal["grants"] = []): Principal => ({ personId, workforceType: "employee", grants });

const ids = {} as Record<"szm" | "vid" | "pipeline" | "openingId" | "slug" | "recruiterPerson" | "interviewerPerson" | "hrAdmin" | "letterTemplateId", string>;
let recruiter: Principal;
const recruiterActor = { personId: "", fullName: "Người Tuyển Dụng" };

let visitors = 0;
const nextVisitor = () => ({ ipHash: `letters${String(++visitors).padStart(10, "0")}`, userAgent: "test" });

const filled = (overrides: Record<string, unknown> = {}) => ({
  slug: ids.slug,
  website: "",
  formToken: issueFormToken(ids.slug, new Date(Date.now() - MIN_FILL_MS - 1_000)),
  fullName: "Nguyễn Thị Lan",
  email: "lan@example.com",
  phone: null,
  location: null,
  currentTitle: null,
  currentEmployer: null,
  links: [],
  coverLetter: null,
  answers: {},
  salaryExpectationVnd: "",
  consent: true,
  talentPool: false,
  cv: null,
  locale: "vi",
  ...overrides,
});

const outboxTo = (address: string) => db().select().from(schema.emailOutbox).where(eq(schema.emailOutbox.toEmail, address)).orderBy(schema.emailOutbox.createdAt);
const eventsOf = (applicationId: string) => db().select().from(schema.applicationEvent).where(eq(schema.applicationEvent.applicationId, applicationId));
const applicationOf = async (email: string) => {
  const [row] = await db()
    .select({ id: schema.jobApplication.id, candidateId: schema.candidate.id })
    .from(schema.jobApplication)
    .innerJoin(schema.candidate, eq(schema.candidate.id, schema.jobApplication.candidateId))
    .where(eq(schema.candidate.email, email));
  return row;
};
/** An attached `.ics`, decoded and unfolded (RFC 5545 folds long lines at 75 octets). */
const decoded = (base64: string) => Buffer.from(base64, "base64").toString("utf8").replace(/\r\n /g, "");

/** A candidate entered by hand, with an application on the opening. */
async function freshApplication(fullName: string, email: string | null, locale: "vi" | "en" = "vi"): Promise<{ applicationId: string; candidateId: string }> {
  const candidate = await createCandidate(
    { fullName, email, phone: null, currentTitle: null, currentEmployer: null, location: null, links: [], source: "direct", sourceDetail: null, referredByPersonId: null, tags: [], notes: null, locale },
    ids.recruiterPerson,
    { confirmedNotDuplicate: true },
  );
  const application = await createApplication(
    { candidateId: candidate.id, openingId: ids.openingId, source: "direct", sourceDetail: null, coverLetter: null, answers: {}, cvFileId: null, portfolioLinks: [], salaryExpectationVnd: null, salaryExpectationNote: null },
    ids.recruiterPerson,
  );
  return { applicationId: application.id, candidateId: candidate.id };
}

/** Days ahead, at a fixed hour UTC — inside the scheduling window whenever this runs. */
const slot = (offsetDays: number, startHourUtc: number) => {
  const start = new Date(Date.now() + offsetDays * 24 * 60 * 60 * 1000);
  start.setUTCHours(startHourUtc, 30, 0, 0);
  return { startAt: start, endAt: new Date(start.getTime() + 60 * 60_000) };
};

beforeAll(async () => {
  await migrateTestDb();
  const [szm] = await db().insert(schema.entity).values({ code: "SZM", legalName: "Công ty SuZu Media", shortName: "SuZu Media" }).returning();
  const [vid] = await db().insert(schema.orgUnit).values({ code: "VID", name: "Video" }).returning();
  Object.assign(ids, { szm: szm.id, vid: vid.id });
  for (const [key, fullName, email] of [
    ["recruiterPerson", "Người Tuyển Dụng", "recruiter@suzu.group"],
    ["interviewerPerson", "Trần Văn Bảo", "bao@suzu.group"],
    ["hrAdmin", "Trưởng phòng Nhân sự", "hr@suzu.group"],
  ] as const) {
    const [row] = await db().insert(schema.person).values({ fullName, searchName: key, workEmail: email, primaryEntityId: szm.id, orgUnitId: vid.id, status: "active" }).returning();
    ids[key] = row.id;
  }
  recruiterActor.personId = ids.recruiterPerson;
  recruiter = principal(ids.recruiterPerson, [{ role: "recruiter", scope: { type: "entity", id: szm.id } }]);

  for (const seed of EMAIL_TEMPLATE_SEED) await saveEmailTemplate(null, { ...seed, isActive: true }, ids.recruiterPerson);
  const { after: pipeline } = await savePipeline(null, { ...PIPELINE_SEED[0], isActive: true, stages: PIPELINE_SEED[0].stages.map((stage) => ({ ...stage })) });
  ids.pipeline = pipeline.id;

  const opening = await createOpening(
    {
      title: "Biên tập video",
      titleEn: "Video Editor",
      entityId: szm.id,
      departmentId: vid.id,
      teamId: null,
      positionName: "Biên tập video",
      seniorityLevel: null,
      positionLevel: null,
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
  ids.slug = opening.publicSlug;
  await setOpeningStatus(opening.id, "open", null);
  await setOpeningTeam(opening.id, [{ personId: ids.recruiterPerson, role: "recruiter" }]);

  const [template] = await db()
    .insert(schema.documentTemplate)
    .values({ code: "TM-TEST", name: "Thư mời nhận việc", kind: "offer", tier: "compensation", body: "{{person.fullName}} — {{person.position}} — {{salary.total}} đồng", letterhead: { companyName: "SuZu Media" } })
    .returning();
  ids.letterTemplateId = template.id;
});

describe("the acknowledgement", () => {
  it("goes to the address typed, in the language of the form, with the link to their privacy page", async () => {
    const result = await applyToOpening(filled({ fullName: "Nguyễn Thị Lan", email: "lan@example.com", locale: "en", talentPool: true }), nextVisitor());
    expect(result).toEqual({ ok: true, data: { received: true } });

    const [letter] = await outboxTo("lan@example.com");
    expect(letter.subject).toBe("We have received your application for Video Editor — SuZu Media");
    expect(letter.bodyText).toContain("Hello Nguyễn Thị Lan");
    expect(letter.bodyText).toContain("https://suzu.one/careers/privacy/");
    expect(letter.bodyText).not.toContain("{{");

    const { id, candidateId } = await applicationOf("lan@example.com");
    const [candidate] = await db().select().from(schema.candidate).where(eq(schema.candidate.id, candidateId));
    expect(candidate.locale).toBe("en");
    expect(candidate.privacyTokenHash).toMatch(/^[0-9a-f]{64}$/);
    const emailed = (await eventsOf(id)).find((event) => event.type === "emailed")!;
    // Which wording and which outbox row — so the page can say whether it went.
    expect(emailed.detail).toMatchObject({ templateCode: "ACK_APPLICATION", automatic: true, outboxId: letter.id });
  });

  it("tells the opening's recruiter at once, naming the job and never the applicant", async () => {
    const { id } = await applicationOf("lan@example.com");
    const notices = await db().select().from(schema.notification).where(eq(schema.notification.kind, "recruit.application_received"));
    const notice = notices.find((row) => row.link === `/recruit/applications/${id}`)!;
    expect(notice.recipientPersonId).toBe(ids.recruiterPerson);
    expect(notice.params).toMatchObject({ title: "Biên tập video" });
    expect(JSON.stringify(notice.params)).not.toContain("Lan");
    // The recruiter's own email copy of it says no more than the card.
    const [mail] = await outboxTo("recruiter@suzu.group");
    expect(`${mail.subject}${mail.bodyText}`).not.toContain("Lan");
  });

  it("joined to a record by its number, greets the name typed — and carries no link to that record's page", async () => {
    await createCandidate(
      { fullName: "Người Thật", email: "real.person@example.com", phone: "0911222333", currentTitle: null, currentEmployer: null, location: null, links: [], source: "direct", sourceDetail: null, referredByPersonId: null, tags: [], notes: null },
      ids.recruiterPerson,
      { confirmedNotDuplicate: true },
    );
    await applyToOpening(filled({ fullName: "Kẻ Lạ", email: "stranger@example.com", phone: "0911222333" }), nextVisitor());

    const [letter] = await outboxTo("stranger@example.com");
    expect(letter.bodyText).toContain("Kẻ Lạ");
    expect(letter.bodyText).not.toContain("Người Thật");
    expect(letter.bodyText).not.toContain("/careers/privacy/");
    expect(await outboxTo("real.person@example.com")).toEqual([]);
    const [record] = await db().select().from(schema.candidate).where(eq(schema.candidate.email, "real.person@example.com"));
    expect(record.privacyTokenHash).toBeNull();
  });

  it("is sent once: a repeat application writes nothing and sends nothing", async () => {
    await applyToOpening(filled({ fullName: "Nguyễn Thị Lan", email: "lan@example.com", locale: "en" }), nextVisitor());
    expect(await outboxTo("lan@example.com")).toHaveLength(1);
  });
});

describe("the interview letter", () => {
  it("states the time in Vietnam's zone and the place, and attaches an .ics naming the candidate alone", async () => {
    const { applicationId } = await freshApplication("Lê Minh Châu", "chau@example.com");
    const { interview, letter } = await scheduleInterview(
      { applicationId, stageId: null, kind: "panel", title: "Phỏng vấn vòng 1", ...slot(5, 2), mode: "onsite", location: "Tầng 4, 12 Lý Thường Kiệt", meetingUrl: null, notesForCandidate: null, interviewerPersonIds: [ids.interviewerPerson] },
      ids.recruiterPerson,
      { senderName: "Người Tuyển Dụng" },
    );
    expect(letter).toMatchObject({ queued: true });

    const [mail] = await outboxTo("chau@example.com");
    expect(mail.bodyText).toContain("Thời gian:");
    expect(mail.bodyText).toContain("09:30–10:30 GMT+7");
    expect(mail.bodyText).toContain("Địa điểm: Tầng 4, 12 Lý Thường Kiệt");
    // No note for the candidate: the line is left out rather than sent as braces.
    expect(mail.bodyText).not.toContain("Ghi chú");
    expect(mail.bodyText).not.toContain("{{");

    expect(mail.attachments).toHaveLength(1);
    const [ics] = mail.attachments!;
    expect(ics.contentType).toContain("text/calendar");
    const file = decoded(ics.contentBase64);
    expect(file).toContain("METHOD:REQUEST");
    expect(file).toContain(`UID:interview-${interview.id}@suzu.one`);
    expect(file).toContain("mailto:chau@example.com");
    expect(file).toContain("ORGANIZER;CN=Người Tuyển Dụng:mailto:recruiter@suzu.group");
    // The panel is the company's business.
    expect(file).not.toContain("bao@suzu.group");
  });

  it("tells the interviewers which job, not which candidate", async () => {
    const notices = await db().select().from(schema.notification).where(and(eq(schema.notification.kind, "recruit.interview_scheduled"), eq(schema.notification.recipientPersonId, ids.interviewerPerson)));
    expect(notices.length).toBeGreaterThan(0);
    for (const notice of notices) {
      expect(notice.params).toMatchObject({ title: "Phỏng vấn vòng 1", job: "Biên tập video" });
      expect(JSON.stringify(notice.params)).not.toContain("Châu");
    }
  });

  it("on a cancellation says it is off and removes it from their calendar — never why", async () => {
    const { applicationId } = await freshApplication("Đỗ Hải Yến", "yen@example.com", "en");
    const { interview } = await scheduleInterview(
      { applicationId, stageId: null, kind: "technical", title: "Technical round", ...slot(6, 3), mode: "video", location: null, meetingUrl: "https://meet.example.com/abc", notesForCandidate: "Bring your reel", interviewerPersonIds: [ids.interviewerPerson] },
      ids.recruiterPerson,
      { senderName: "Người Tuyển Dụng" },
    );
    const [invite] = await outboxTo("yen@example.com");
    expect(invite.subject).toBe("Your interview for Video Editor — SuZu Media");
    expect(invite.bodyText).toContain("Where: https://meet.example.com/abc");
    expect(invite.bodyText).toContain("Note: Bring your reel");

    await setInterviewStatus(interview.id, "cancelled", "Đã tuyển được người khác", ids.recruiterPerson, { senderName: "Người Tuyển Dụng" });
    const cancellation = (await outboxTo("yen@example.com")).find((row) => row.id !== invite.id)!;
    expect(cancellation.subject).toBe("Interview cancelled — Video Editor at SuZu Media");
    expect(cancellation.bodyText).not.toContain("Đã tuyển được người khác");
    expect(decoded(cancellation.attachments![0].contentBase64)).toContain("METHOD:CANCEL");
  });

  it("sends nothing when the recruiter books the room before the time is agreed", async () => {
    const { applicationId } = await freshApplication("Phan Quốc Anh", "quocanh@example.com");
    const { letter } = await scheduleInterview(
      { applicationId, stageId: null, kind: "panel", title: "Phỏng vấn", ...slot(7, 2), mode: "onsite", location: null, meetingUrl: null, notesForCandidate: null, interviewerPersonIds: [ids.interviewerPerson] },
      ids.recruiterPerson,
    );
    expect(letter).toBeNull();
    expect(await outboxTo("quocanh@example.com")).toEqual([]);
  });
});

describe("the rejection", () => {
  it("is written in the candidate's language and carries neither the reason nor the note", async () => {
    const { applicationId } = await freshApplication("Hoàng Mai Anh", "maianh@example.com", "en");
    const { after, letter } = await rejectApplicationAndTell(applicationId, { reason: "salary", note: "Đòi lương quá cao" }, recruiterActor, true);
    expect(after.status).toBe("rejected");
    expect(letter).toMatchObject({ queued: true });
    const [mail] = await outboxTo("maianh@example.com");
    expect(mail.subject).toBe("Your application for Video Editor — SuZu Media");
    expect(mail.bodyText).toContain("Hello Hoàng Mai Anh");
    expect(mail.bodyText).not.toMatch(/lương|salary/i);
    // Sent to the address on the record, so the record's own privacy link rides along.
    expect(mail.bodyText).toContain("https://suzu.one/careers/privacy/");
  });

  it("sends nothing when the recruiter untick the box", async () => {
    const { applicationId } = await freshApplication("Không Báo", "khongbao@example.com");
    const { letter } = await rejectApplicationAndTell(applicationId, { reason: "experience", note: null }, recruiterActor, false);
    expect(letter).toBeNull();
    expect(await outboxTo("khongbao@example.com")).toEqual([]);
    expect((await eventsOf(applicationId)).some((event) => event.type === "emailed")).toBe(false);
  });

  it("says why when it cannot go — no address — and still turns the application down", async () => {
    const { applicationId } = await freshApplication("Không Có Email", null);
    const { after, letter } = await rejectApplicationAndTell(applicationId, { reason: "experience", note: null }, recruiterActor, true);
    expect(after.status).toBe("rejected");
    expect(letter).toEqual({ queued: false, reason: "no_address" });
    const emailed = (await eventsOf(applicationId)).find((event) => event.type === "emailed")!;
    expect(emailed.detail).toMatchObject({ templateCode: "REJECT_AFTER_REVIEW", skipped: "no_address" });
  });

  it("is not sent when HR has switched the wording off", async () => {
    const [row] = await db().select().from(schema.recruitEmailTemplate).where(eq(schema.recruitEmailTemplate.code, "REJECT_AFTER_REVIEW"));
    await saveEmailTemplate(row.id, { code: row.code, name: row.name, kind: row.kind, subject: row.subject, body: row.body, subjectEn: row.subjectEn, bodyEn: row.bodyEn, isActive: false }, ids.recruiterPerson);
    const { applicationId } = await freshApplication("Tắt Thư", "tatthu@example.com");
    const { letter } = await rejectApplicationAndTell(applicationId, { reason: "experience", note: null }, recruiterActor, true);
    expect(letter).toEqual({ queued: false, reason: "switched_off" });
    expect(await outboxTo("tatthu@example.com")).toEqual([]);
    await saveEmailTemplate(row.id, { code: row.code, name: row.name, kind: row.kind, subject: row.subject, body: row.body, subjectEn: row.subjectEn, bodyEn: row.bodyEn, isActive: true }, ids.recruiterPerson);
  });
});

describe("the offer", () => {
  const offerFor = (applicationId: string) =>
    makeOffer(
      {
        applicationId,
        positionName: "Biên tập video",
        seniorityLevel: null,
        positionLevel: null,
        employmentType: "employee",
        workLocation: "Hà Nội",
        managerPersonId: null,
        startDate: addDays(todayInVietnam(), 30),
        expiresOn: null,
        probationMonths: 2,
        probationSalaryPercent: 85,
        baseSalaryVnd: 22_000_000,
        allowancesVnd: 1_000_000,
        letterTemplateId: ids.letterTemplateId,
        note: "Ứng viên mặc cả lương",
      },
      ids.hrAdmin,
    );

  it("goes out as the offer note with the letter attached — the figure in the PDF, never in the email", async () => {
    const { applicationId } = await freshApplication("Vũ Thanh Tâm", "tam@example.com");
    const offer = await offerFor(applicationId);
    await db().update(schema.jobOffer).set({ status: "approved" }).where(eq(schema.jobOffer.id, offer.id));

    const { offer: sent, letter } = await sendOffer(offer.id, { personId: ids.hrAdmin, fullName: "Trưởng phòng Nhân sự" });
    expect(sent.status).toBe("sent");
    expect(letter).toMatchObject({ queued: true });
    const [mail] = await outboxTo("tam@example.com");
    expect(mail.subject).toContain("Biên tập video");
    expect(`${mail.subject}${mail.bodyText}`).not.toMatch(/23[.,]?000[.,]?000|22[.,]?000[.,]?000|mặc cả/);
    expect(mail.attachments).toHaveLength(1);
    expect(mail.attachments![0].contentType).toBe("application/pdf");
    expect(Buffer.from(mail.attachments![0].contentBase64, "base64").subarray(0, 4).toString("latin1")).toBe("%PDF");
  });

  it("is still sent to a candidate with no address — by hand — and the history says the email did not go", async () => {
    const { applicationId } = await freshApplication("Gửi Tay", null);
    const offer = await offerFor(applicationId);
    await db().update(schema.jobOffer).set({ status: "approved" }).where(eq(schema.jobOffer.id, offer.id));
    const { offer: sent, letter } = await sendOffer(offer.id, { personId: ids.hrAdmin, fullName: "Trưởng phòng Nhân sự" });
    expect(sent.status).toBe("sent");
    expect(letter).toEqual({ queued: false, reason: "no_address" });
  });
});

describe("what a recruiter sees of a letter", () => {
  it("shows on the application whether it went, and lists the ones that failed on the recruitment home", async () => {
    const { applicationId } = await freshApplication("Thư Lỗi", "bounce@example.com");
    await rejectApplicationAndTell(applicationId, { reason: "experience", note: null }, recruiterActor, true);
    const view = await getApplicationView({ principal: recruiter, personId: ids.recruiterPerson }, applicationId);
    const line = view!.events.find((event) => event.type === "emailed")!;
    expect(line.delivery).toMatchObject({ status: "pending", error: null });

    const [mail] = await outboxTo("bounce@example.com");
    await db().update(schema.emailOutbox).set({ status: "failed", attempts: 5, lastError: "422 invalid recipient" }).where(eq(schema.emailOutbox.id, mail.id));
    const again = await getApplicationView({ principal: recruiter, personId: ids.recruiterPerson }, applicationId);
    expect(again!.events.find((event) => event.type === "emailed")!.delivery).toEqual({ status: "failed", error: "422 invalid recipient", attempts: 5 });

    const failed = await listUndeliveredLetters(recruiter);
    expect(failed.map((row) => row.applicationId)).toContain(applicationId);
    // Somebody who runs no recruitment here is shown none of it.
    expect(await listUndeliveredLetters(principal(ids.interviewerPerson))).toEqual([]);
  });

  it("drops an attachment from the outbox once the email is done with — sent, or skipped with no provider", async () => {
    await deliverPendingEmails(200);
    const [offerMail] = await outboxTo("tam@example.com");
    expect(offerMail.status).toBe("skipped");
    expect(offerMail.attachments).toBeNull();
  });
});

/** The privacy token in a letter's link. */
const tokenFrom = (body: string) => body.match(/\/careers\/privacy\/([A-Za-z0-9_-]+)/)![1];

describe("the talent pool", () => {
  it("is a list a recruiter can see, and a page the candidate can leave it from", async () => {
    const [ack] = await outboxTo("lan@example.com");
    const token = tokenFrom(ack.bodyText);
    expect(await findPublicPrivacyView(token)).toEqual({ inTalentPool: true });
    expect((await listCandidates(recruiter, { talentPool: true })).map((row) => row.fullName)).toContain("Nguyễn Thị Lan");

    expect(await leaveTalentPool({ token }, nextVisitor())).toEqual({ ok: true, data: { left: true } });
    expect(await findPublicPrivacyView(token)).toEqual({ inTalentPool: false });
    expect((await listCandidates(recruiter, { talentPool: true })).map((row) => row.fullName)).not.toContain("Nguyễn Thị Lan");
  });

  it("opens nothing for a token nobody issued", async () => {
    const made = "A".repeat(43);
    expect(await findPublicPrivacyView(made)).toBeNull();
    expect(await leaveTalentPool({ token: made }, nextVisitor())).toEqual({ ok: false, error: "failed", message: "privacy_link_closed" });
  });

  it("records a candidate's answer given in person", async () => {
    const { candidateId } = await freshApplication("Ở Lại", "olai@example.com");
    expect(await setTalentPool(candidateId, true)).toEqual({ before: false, after: true });
    expect((await listCandidates(recruiter, { talentPool: true })).map((row) => row.fullName)).toContain("Ở Lại");
  });
});

describe("a purged candidate", () => {
  it("leaves no name in the letters, in the colleagues' notices, or behind the privacy link", async () => {
    const { applicationId, candidateId } = await freshApplication("Tô Bích Ngọc", "ngoc@example.com");
    await scheduleInterview(
      { applicationId, stageId: null, kind: "panel", title: "Phỏng vấn cuối", ...slot(8, 2), mode: "onsite", location: null, meetingUrl: null, notesForCandidate: null, interviewerPersonIds: [ids.interviewerPerson] },
      ids.recruiterPerson,
      { senderName: "Người Tuyển Dụng" },
    );
    const { after } = await rejectApplicationAndTell(applicationId, { reason: "experience", note: null }, recruiterActor, true);
    expect(after.status).toBe("rejected");
    // The rejection carries the privacy link (the invitation does not).
    const token = tokenFrom((await outboxTo("ngoc@example.com")).find((row) => row.bodyText.includes("/careers/privacy/"))!.bodyText);
    expect(await findPublicPrivacyView(token)).toEqual({ inTalentPool: false });
    // A notice written the old way, with the name in it, about this candidate's application.
    await db().insert(schema.notification).values({ recipientPersonId: ids.recruiterPerson, kind: "recruit.assignment_received", params: { title: "Bài test", candidate: "Tô Bích Ngọc" }, link: `/recruit/applications/${applicationId}` });

    await anonymiseCandidate(candidateId, { reason: "erasure", actorPersonId: ids.hrAdmin });

    expect(await findPublicPrivacyView(token)).toBeNull();
    const letters = await db().select().from(schema.emailOutbox).where(like(schema.emailOutbox.bodyText, "%Ngọc%"));
    expect(letters).toEqual([]);
    const withFiles = (await db().select().from(schema.emailOutbox)).filter((row) => row.toEmail === "" && row.attachments !== null);
    expect(withFiles).toEqual([]);
    const notices = await db().select().from(schema.notification);
    expect(notices.filter((row) => JSON.stringify(row.params).includes("Ngọc"))).toEqual([]);
    const history = await eventsOf(applicationId);
    expect(history.filter((row) => JSON.stringify(row).includes("Ngọc"))).toEqual([]);
  });
});
