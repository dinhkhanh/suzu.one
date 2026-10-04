// What "anonymised" has to mean (FR-REC-13, NFR-PRV-04), against a real Postgres (PGlite).
//
// The retention job and the erase action promise the same thing: afterwards the person is not in
// the system. That is a claim about *every* table the module wrote their name into, so the test is
// a scan — build a candidate the way the product does (a referral, an application through the
// public form, a recruiter's notes, letters, a take-home, an offer), erase them, and look for their
// name, their address and their number in every row that is left — and in storage.
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => import("../../../tests/helpers/db"));
vi.mock("@/lib/env", () => ({ env: () => ({ BETTER_AUTH_SECRET: "a-test-secret-long-enough-to-sign-with" }) }));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined, revalidateTag: () => undefined }));
const session = vi.hoisted(() => ({ user: null as unknown }));
vi.mock("@/modules/platform/auth/session", () => ({ getCurrentUser: async () => session.user, requireUser: async () => session.user }));
// Only the network layer is replaced, with a bucket that can be looked into.
const objects = new Map<string, Uint8Array>();
vi.mock("@/modules/platform/files/storage", () => ({
  putObject: async (objectPath: string, bytes: Uint8Array) => void objects.set(objectPath, bytes),
  currentBucket: () => "test-bucket",
  createSignedUploadUrl: async () => "https://example.invalid/upload",
  createSignedDownloadUrl: async () => "https://example.invalid/download",
  inspectObject: async () => null,
  removeObject: async (objectPath: string) => void objects.delete(objectPath),
  StorageError: class StorageError extends Error {},
}));

import { eq, inArray } from "drizzle-orm";
import type { IsoDate } from "@/lib/dates";
import { db, schema } from "@/lib/db";
import { migrateTestDb } from "../../../tests/helpers/db";
import { storeIncomingFile } from "../platform/files/service";
import type { Principal } from "../platform/rbac/policy";
import { createCandidateAction, eraseCandidateAction, updateCandidateAction } from "./actions";
import { MIN_FILL_MS } from "./engine/form-token";
import { ANONYMISED_NAME } from "./engine/retention";
import { anonymiseCandidate, eraseCandidate, runCandidateRetention } from "./jobs";
import { applyToOpening, issueFormToken } from "./public";
import { listMyReferrals, submitReferral } from "./referrals";
import { PIPELINE_SEED } from "./seed-pipelines";
import { createApplication, createCandidate, createOpening, getCandidateView, moveApplicationStage, rejectApplication, savePipeline, setOpeningStatus, stagesOf, withdrawApplication } from "./service";

const fails = (promise: Promise<unknown>) =>
  promise.then(
    () => "no error",
    (error: Error) => error.message,
  );
const principal = (personId: string | null, grants: Principal["grants"] = []): Principal => ({ personId, workforceType: "employee", grants });
const pdfBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, ...new TextEncoder().encode("-1.7\nfake but honest")]);

const ids = {} as Record<"szm" | "szc" | "vid" | "pipeline" | "opening" | "szcOpening" | "hrPerson" | "referrerPerson", string>;
let szcSlug: string;
let hrAdmin: Principal;
let szmRecruiter: Principal;
let counter = 0;
const nextVisitor = () => ({ ipHash: `erasure${String(++counter).padStart(9, "0")}`, userAgent: "test" });
const signInAs = (who: Principal) => {
  session.user = { userId: "u1", email: "hr@suzu.vn", person: { id: ids.hrPerson, fullName: "Giám đốc Nhân sự" }, principal: who, request: { ipAddress: null, userAgent: null } };
};

beforeAll(async () => {
  await migrateTestDb();
  const [szm] = await db().insert(schema.entity).values({ code: "SZM", legalName: "SuZu Media", shortName: "Media" }).returning();
  const [szc] = await db().insert(schema.entity).values({ code: "SZC", legalName: "SuZu Creative", shortName: "Creative" }).returning();
  const [vid] = await db().insert(schema.orgUnit).values({ code: "VID", name: "Video" }).returning();
  Object.assign(ids, { szm: szm.id, szc: szc.id, vid: vid.id });
  for (const [key, fullName, workEmail] of [
    ["hrPerson", "Giám đốc Nhân sự", "hr@suzu.vn"],
    ["referrerPerson", "Người giới thiệu", "nguoi.gioi.thieu@suzu.vn"],
  ] as const) {
    const [row] = await db().insert(schema.person).values({ fullName, searchName: key, workEmail, primaryEntityId: szm.id, orgUnitId: vid.id, status: "active" }).returning();
    ids[key] = row.id;
  }
  const seed = PIPELINE_SEED.find((row) => row.code === "STANDARD")!;
  const { after } = await savePipeline(null, { ...seed, isActive: true, stages: seed.stages.map((stage) => ({ ...stage })) });
  ids.pipeline = after.id;
  hrAdmin = principal(ids.hrPerson, [{ role: "hr_admin", scope: { type: "group" } }]);
  szmRecruiter = principal(ids.hrPerson, [{ role: "recruiter", scope: { type: "entity", id: szm.id } }]);

  const base = {
    titleEn: null,
    departmentId: ids.vid,
    teamId: null,
    positionName: "Video Editor",
    seniorityLevel: null,
    positionLevel: null,
    employmentType: "employee" as const,
    workMode: "onsite" as const,
    workLocation: "Hà Nội",
    headcount: 1,
    description: "Dựng phim.",
    requirements: "2 năm.",
    benefits: "",
    pipelineId: ids.pipeline,
    targetStartDate: null,
    questions: [],
  };
  const opening = await createOpening({ ...base, title: "Video Editor", entityId: ids.szm }, null, ids.hrPerson);
  await setOpeningStatus(opening.id, "open", null);
  ids.opening = opening.id;
  const szcOpening = await createOpening({ ...base, title: "Creative role", entityId: ids.szc, departmentId: null }, null, ids.hrPerson);
  await setOpeningStatus(szcOpening.id, "open", null);
  ids.szcOpening = szcOpening.id;
  szcSlug = szcOpening.publicSlug;
});

/** Everything of one person's that must be gone afterwards, however it was spelled. */
const NAME = "Phạm Thị Cần Xoá";
const TYPED_NAME = "Pham Thi Can Xoa";
const EMAIL = "can.xoa@example.com";
const PHONE = "0907000999";
const MARKERS = [NAME, TYPED_NAME, "Cần Xoá", "can-xoa", EMAIL, "can.xoa", PHONE, "907000999"];

/**
 * A candidate with a past in every corner of the module: referred into one company's opening with
 * a CV, applied to another company's through the public form (joining the record by address),
 * moved along and turned down with notes, written to, sent a take-home, made an offer.
 */
async function personOnFile() {
  await submitReferral(
    { openingId: ids.opening, fullName: NAME, email: EMAIL, phone: PHONE, currentTitle: "Editor", currentEmployer: "Studio khác", links: ["https://example.com/can-xoa"], note: `${NAME} làm chung với tôi năm ngoái.`, cv: { fileName: "cv-pham-thi-can-xoa.pdf", bytes: pdfBytes } },
    ids.referrerPerson,
  );
  const applied = await applyToOpening(
    {
      slug: szcSlug,
      website: "",
      formToken: issueFormToken(szcSlug, new Date(Date.now() - MIN_FILL_MS - 1_000)),
      fullName: TYPED_NAME,
      email: EMAIL,
      phone: null,
      location: "Đà Nẵng",
      currentTitle: null,
      currentEmployer: null,
      links: ["https://behance.net/can-xoa"],
      coverLetter: `Tôi là ${NAME}.`,
      answers: {},
      salaryExpectationVnd: "20000000",
      consent: true,
      talentPool: false,
      cv: { fileName: "Pham Thi Can Xoa - CV.pdf", bytes: pdfBytes },
    },
    nextVisitor(),
  );
  expect(applied).toEqual({ ok: true, data: { received: true } });

  const [candidate] = await db().select().from(schema.candidate).where(eq(schema.candidate.email, EMAIL));
  const applications = await db().select().from(schema.jobApplication).where(eq(schema.jobApplication.candidateId, candidate.id));
  expect(applications).toHaveLength(2);
  const referred = applications.find((row) => row.openingId === ids.opening)!;
  const applicant = applications.find((row) => row.openingId === ids.szcOpening)!;

  // A recruiter's words on a move and on a rejection, and a withdrawal with a reason.
  const stages = await stagesOf(ids.pipeline);
  await moveApplicationStage(referred.id, stages[1].id, ids.hrPerson, `Đã gọi cho ${NAME}, hẹn phỏng vấn.`);

  // A take-home, sent back with a note and a file.
  const [assignment] = await db()
    .insert(schema.recruitAssignment)
    .values({ applicationId: referred.id, openingId: ids.opening, title: "Dựng thử 30 giây", brief: "Dựng một đoạn 30 giây.", dueAt: new Date(), tokenHash: "hash-of-a-token", tokenExpiresAt: new Date(), sentByPersonId: ids.hrPerson, status: "received", submissionNote: `Bài của ${NAME}`, submissionLinks: ["https://example.com/can-xoa/bai"] })
    .returning();
  const submission = await storeIncomingFile({ ownerType: "recruit_assignment", ownerId: assignment.id, entityId: ids.szm, tier: "personal" }, { fileName: "bai-lam-can-xoa.pdf", bytes: pdfBytes });
  await db().update(schema.recruitAssignment).set({ submissionFileId: submission.id }).where(eq(schema.recruitAssignment.id, assignment.id));

  // An offer that was declined, with what was said about it.
  await db().insert(schema.jobOffer).values({
    applicationId: referred.id,
    openingId: ids.opening,
    candidateId: candidate.id,
    entityId: ids.szm,
    number: `SZM-TM-2026-${String(++counter).padStart(4, "0")}`,
    positionName: "Video Editor",
    startDate: "2026-11-01",
    baseSalaryVnd: 20_000_000,
    expiresOn: "2026-10-20",
    status: "declined",
    note: `${NAME} muốn bắt đầu sớm hơn.`,
    declineNote: `${NAME} nhận lời nơi khác.`,
    createdByPersonId: ids.hrPerson,
  });

  await rejectApplication(referred.id, { reason: "salary", note: `${NAME} từ chối mức đề nghị.` }, ids.hrPerson);
  await withdrawApplication(applicant.id, ids.hrPerson, `${TYPED_NAME} báo rút hồ sơ qua điện thoại.`);

  // Letters: one that went out, one still waiting — and a colleague's, which is nobody's business here.
  await db().insert(schema.emailOutbox).values([
    { toEmail: EMAIL, subject: `Mời phỏng vấn — ${NAME}`, bodyText: `Chào ${NAME},\nMời bạn đến phỏng vấn.`, status: "sent", sentAt: new Date() },
    { toEmail: EMAIL, subject: "Kết quả ứng tuyển", bodyText: `Chào ${NAME},\nRất tiếc…`, status: "pending" },
    { toEmail: "nguoi.gioi.thieu@suzu.vn", subject: "Việc của đồng nghiệp", bodyText: "Không liên quan.", status: "pending" },
  ]);

  const files = await db().select().from(schema.storedFile).where(inArray(schema.storedFile.ownerId, [referred.id, applicant.id, assignment.id]));
  expect(files).toHaveLength(3);
  for (const file of files) expect(objects.has(file.objectPath)).toBe(true);
  return { candidate, referred, applicant, assignment, files };
}

/** Every row of every table the module writes about a candidate, as one string to search. */
async function everythingOnFile(): Promise<Record<string, string>> {
  const tables = {
    candidate: schema.candidate,
    job_application: schema.jobApplication,
    application_event: schema.applicationEvent,
    referral: schema.referral,
    job_offer: schema.jobOffer,
    recruit_assignment: schema.recruitAssignment,
    interview_scorecard: schema.interviewScorecard,
    email_outbox: schema.emailOutbox,
    stored_file: schema.storedFile,
  };
  const found: Record<string, string> = {};
  for (const [name, table] of Object.entries(tables)) found[name] = JSON.stringify(await db().select().from(table));
  return found;
}

describe("erasing a candidate on request", () => {
  it("leaves the name, the address and the number in no table, and the files in no bucket", async () => {
    const { candidate, referred, applicant, files } = await personOnFile();
    // The scan is worth something only if it finds the person before: every table holds them now.
    const before = await everythingOnFile();
    for (const table of ["candidate", "job_application", "application_event", "referral", "job_offer", "recruit_assignment", "email_outbox", "stored_file"]) {
      expect(MARKERS.some((marker) => before[table].includes(marker)), `${table} should hold the person before the erasure`).toBe(true);
    }

    const erased = await eraseCandidate(candidate.id, ids.hrPerson);
    expect(erased).toEqual({ applications: 2, files: 3 });

    const after = await everythingOnFile();
    for (const [table, rows] of Object.entries(after)) {
      for (const marker of MARKERS) expect(rows.includes(marker), `${table} still holds "${marker}"`).toBe(false);
    }

    // The bytes went with the rows, at once — not a grace period later.
    for (const file of files) expect(objects.has(file.objectPath)).toBe(false);
    const stored = await db().select().from(schema.storedFile).where(inArray(schema.storedFile.id, files.map((file) => file.id)));
    for (const file of stored) {
      expect(file.deletedAt).not.toBeNull();
      expect(file.purgedAt).not.toBeNull();
    }

    // What the reports count on is still there: two applications, how each ended, and why.
    const [row] = await db().select().from(schema.candidate).where(eq(schema.candidate.id, candidate.id));
    expect(row.fullName).toBe(ANONYMISED_NAME);
    expect(row.anonymisedAt).not.toBeNull();
    const applications = await db().select().from(schema.jobApplication).where(eq(schema.jobApplication.candidateId, candidate.id));
    expect(applications.map((application) => application.status).sort()).toEqual(["rejected", "withdrawn"]);
    expect(applications.find((application) => application.id === referred.id)?.rejectionReason).toBe("salary");

    // The history says what happened, who did it and why — and the earlier entries kept their kind.
    const events = await db().select().from(schema.applicationEvent).where(inArray(schema.applicationEvent.applicationId, [referred.id, applicant.id]));
    const closing = events.filter((event) => event.type === "anonymised");
    expect(closing).toHaveLength(2);
    for (const event of closing) expect(event).toMatchObject({ actorPersonId: ids.hrPerson, detail: { reason: "erasure" } });
    expect(events.filter((event) => event.type === "stage_moved")).toHaveLength(1);
    expect(events.every((event) => event.note === null)).toBe(true);
    // The marks the history entries are found by survive; only the names in them went.
    expect(events.some((event) => (event.detail as { referral?: boolean } | null)?.referral === true)).toBe(true);
    expect(events.some((event) => (event.detail as { possibleDuplicate?: boolean } | null)?.possibleDuplicate === true)).toBe(true);

    // The letter that was waiting is never sent; the colleague's is untouched.
    const outbox = await db().select().from(schema.emailOutbox);
    expect(outbox.filter((email) => email.toEmail === "").map((email) => email.status).sort()).toEqual(["sent", "skipped"]);
    expect(outbox.find((email) => email.toEmail === "nguoi.gioi.thieu@suzu.vn")).toMatchObject({ status: "pending", bodyText: "Không liên quan." });

    // The referrer's own list no longer shows the name they typed.
    const mine = await listMyReferrals(ids.referrerPerson);
    expect(mine).toHaveLength(1);
    expect(mine[0].name).toBeNull();
  });

  it("is refused while an application is still open, and for somebody who became a colleague", async () => {
    const open = await createCandidate({ fullName: "Ứng viên đang xét", email: "dang.xet@example.com", phone: null, currentTitle: null, currentEmployer: null, location: null, links: [], source: "direct", sourceDetail: null, referredByPersonId: null, tags: [], notes: null }, ids.hrPerson, { confirmedNotDuplicate: true });
    const application = await createApplication({ candidateId: open.id, openingId: ids.opening, source: "direct", sourceDetail: null, coverLetter: null, answers: {}, cvFileId: null, portfolioLinks: [], salaryExpectationVnd: null, salaryExpectationNote: null }, ids.hrPerson);
    expect(await fails(eraseCandidate(open.id, ids.hrPerson))).toBe("recruit_candidate_in_progress");

    const [person] = await db().insert(schema.person).values({ fullName: "Đồng nghiệp mới", searchName: "dong nghiep moi", primaryEntityId: ids.szm, status: "preboarding" }).returning();
    await db().update(schema.jobApplication).set({ status: "hired", hiredPersonId: person.id, closedAt: new Date() }).where(eq(schema.jobApplication.id, application.id));
    expect(await fails(eraseCandidate(open.id, ids.hrPerson))).toBe("recruit_candidate_hired");

    const [untouched] = await db().select().from(schema.candidate).where(eq(schema.candidate.id, open.id));
    expect(untouched.fullName).toBe("Ứng viên đang xét");
    expect(untouched.anonymisedAt).toBeNull();
  });

  it("is refused for nobody, and a second time", async () => {
    expect(await fails(eraseCandidate("00000000-0000-4000-8000-000000000000", ids.hrPerson))).toBe("recruit_candidate_not_found");
    const lead = await createCandidate({ fullName: "Ứng viên xoá hai lần", email: "hai.lan@example.com", phone: null, currentTitle: null, currentEmployer: null, location: null, links: [], source: "direct", sourceDetail: null, referredByPersonId: null, tags: [], notes: null }, ids.hrPerson, { confirmedNotDuplicate: true });
    expect(await eraseCandidate(lead.id, ids.hrPerson)).toEqual({ applications: 0, files: 0 });
    expect(await fails(eraseCandidate(lead.id, ids.hrPerson))).toBe("recruit_candidate_anonymised");
  });

  it("does not take a colleague's notifications for a candidate's letters", async () => {
    // An internal applicant: the address on the candidate record is a mailbox on the books.
    const internal = await createCandidate({ fullName: "Người giới thiệu", email: "nguoi.gioi.thieu@suzu.vn", phone: null, currentTitle: null, currentEmployer: null, location: null, links: [], source: "direct", sourceDetail: null, referredByPersonId: null, tags: [], notes: null }, ids.hrPerson, { confirmedNotDuplicate: true });
    await anonymiseCandidate(internal.id);
    const mail = await db().select().from(schema.emailOutbox).where(eq(schema.emailOutbox.toEmail, "nguoi.gioi.thieu@suzu.vn"));
    expect(mail).toHaveLength(1);
    expect(mail[0]).toMatchObject({ status: "pending", subject: "Việc của đồng nghiệp" });
  });
});

describe("the nightly job", () => {
  it("removes a lapsed candidate's CV from storage the same night, and writes the history once", async () => {
    const candidate = await createCandidate({ fullName: "Ứng viên hết hạn có CV", email: "het.han@example.com", phone: null, currentTitle: null, currentEmployer: null, location: null, links: [], source: "careers_page", sourceDetail: null, referredByPersonId: null, tags: [], notes: null }, null, { confirmedNotDuplicate: true });
    const application = await createApplication({ candidateId: candidate.id, openingId: ids.opening, source: "careers_page", sourceDetail: null, coverLetter: null, answers: {}, cvFileId: null, portfolioLinks: [], salaryExpectationVnd: null, salaryExpectationNote: null }, null);
    const cv = await storeIncomingFile({ ownerType: "job_application", ownerId: application.id, entityId: ids.szm, tier: "personal" }, { fileName: "cv.pdf", bytes: pdfBytes });
    await rejectApplication(application.id, { reason: "not_qualified", note: null }, ids.hrPerson);
    await db().update(schema.jobApplication).set({ closedAt: new Date("2020-06-01T03:00:00Z") }).where(eq(schema.jobApplication.id, application.id));
    await db().update(schema.candidate).set({ retainUntil: "2020-01-01" }).where(eq(schema.candidate.id, candidate.id));
    expect(objects.has(cv.objectPath)).toBe(true);

    const night = await runCandidateRetention("2026-09-20" as IsoDate);
    expect(night).toMatchObject({ anonymised: 1, applications: 1, files: 1 });
    expect(objects.has(cv.objectPath)).toBe(false);

    // Called again for the same person — a second trigger, a retry — it finds nothing to claim.
    await anonymiseCandidate(candidate.id);
    const events = await db().select().from(schema.applicationEvent).where(eq(schema.applicationEvent.applicationId, application.id));
    expect(events.filter((event) => event.type === "anonymised")).toHaveLength(1);
    expect(events.find((event) => event.type === "anonymised")).toMatchObject({ actorPersonId: null, detail: { reason: "retention" } });
  });
});

describe("who is offered the erase action, and what the audit log is told", () => {
  const input = (overrides: Record<string, unknown> = {}) => ({ fullName: "Đỗ Thị Trong Nhật Ký", email: "nhat.ky@example.com", phone: "0908000111", source: "direct", ...overrides });
  const auditText = async () => JSON.stringify(await db().select({ action: schema.auditLog.action, summary: schema.auditLog.summary, before: schema.auditLog.before, after: schema.auditLog.after }).from(schema.auditLog));

  it("writes a candidate into the audit log by id, never by name — adding, editing and erasing", async () => {
    signInAs(hrAdmin);
    const created = await createCandidateAction(input());
    if (!created.ok) throw new Error(created.message ?? created.error);
    const candidateId = created.data.id;
    expect(await updateCandidateAction(input({ candidateId, fullName: "Đỗ Thị Đổi Tên Nhật Ký", currentTitle: "Editor" }))).toMatchObject({ ok: true });
    expect(await eraseCandidateAction({ candidateId })).toEqual({ ok: true, data: { applications: 0, files: 0 } });

    const log = await auditText();
    for (const marker of ["Trong Nhật Ký", "Đổi Tên", "nhat.ky@example.com", "0908000111"]) expect(log.includes(marker), `the audit log holds "${marker}"`).toBe(false);

    const rows = await db().select().from(schema.auditLog).where(eq(schema.auditLog.resourceId, candidateId));
    expect(rows.map((row) => row.action).sort()).toEqual(["recruit.candidate.create", "recruit.candidate.erase", "recruit.candidate.update"]);
    // The edit says which fields changed, and that is all it says.
    expect(rows.find((row) => row.action === "recruit.candidate.update")?.after).toEqual({ changed: ["fullName", "currentTitle"] });
    expect(rows.find((row) => row.action === "recruit.candidate.erase")).toMatchObject({ summary: "candidate erased on request", after: { applications: 0, files: 0 }, actorPersonId: ids.hrPerson });
  });

  it("offers it to whoever runs recruitment over every opening the candidate applied to, and refuses anybody else", async () => {
    // Applied in two companies; turned down in both.
    const candidate = await createCandidate({ fullName: "Ứng viên hai công ty", email: "hai.cong.ty@example.com", phone: null, currentTitle: null, currentEmployer: null, location: null, links: [], source: "direct", sourceDetail: null, referredByPersonId: null, tags: [], notes: null }, ids.hrPerson, { confirmedNotDuplicate: true });
    for (const openingId of [ids.opening, ids.szcOpening]) {
      const application = await createApplication({ candidateId: candidate.id, openingId, source: "direct", sourceDetail: null, coverLetter: null, answers: {}, cvFileId: null, portfolioLinks: [], salaryExpectationVnd: null, salaryExpectationNote: null }, ids.hrPerson);
      await rejectApplication(application.id, { reason: "other", note: null }, ids.hrPerson);
    }

    // One company's recruiter sees the candidate (through their own opening) and is not offered the action…
    expect(await getCandidateView({ principal: szmRecruiter, personId: ids.hrPerson }, candidate.id)).toMatchObject({ canManage: true, canErase: false });
    expect(await getCandidateView({ principal: hrAdmin, personId: ids.hrPerson }, candidate.id)).toMatchObject({ canManage: true, canErase: true });
    // …and posting it by hand is refused before anything is read, and recorded.
    signInAs(szmRecruiter);
    expect(await eraseCandidateAction({ candidateId: candidate.id })).toEqual({ ok: false, error: "forbidden" });
    const [untouched] = await db().select().from(schema.candidate).where(eq(schema.candidate.id, candidate.id));
    expect(untouched.anonymisedAt).toBeNull();
    const denied = await db().select().from(schema.auditLog).where(eq(schema.auditLog.action, "recruit.candidate.erase.denied"));
    expect(denied).toHaveLength(1);

    signInAs(hrAdmin);
    expect(await eraseCandidateAction({ candidateId: candidate.id })).toEqual({ ok: true, data: { applications: 2, files: 0 } });
    // Nothing left to erase: the action is no longer offered.
    expect(await getCandidateView({ principal: hrAdmin, personId: ids.hrPerson }, candidate.id)).toMatchObject({ canErase: false });
  });
});
