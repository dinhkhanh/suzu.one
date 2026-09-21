// Referrals and candidate retention against a real Postgres (PGlite).
//
// Two rules here are worth a test rather than a comment. A **referrer learns nothing**: putting
// forward somebody already in the database answers exactly like putting forward a stranger, and
// the list they see afterwards is their own and nobody else's. And the **retention job empties
// the right rows**: the candidate who consented survives, the one who did not is hollowed out,
// the hire is never touched, and running it twice changes nothing more.
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => import("../../../tests/helpers/db"));
vi.mock("@/lib/env", () => ({ env: () => ({ BETTER_AUTH_SECRET: "a-test-secret-long-enough-to-sign-with" }) }));
vi.mock("@/modules/platform/files/storage", () => ({
  putObject: async () => {},
  currentBucket: () => "test-bucket",
  createSignedUploadUrl: async () => "https://example.invalid/upload",
  createSignedDownloadUrl: async () => "https://example.invalid/download",
  inspectObject: async () => null,
  removeObject: async () => {},
  StorageError: class StorageError extends Error {},
}));

import { and, eq } from "drizzle-orm";
import type { IsoDate } from "@/lib/dates";
import { db, schema } from "@/lib/db";
import { migrateTestDb } from "../../../tests/helpers/db";
import type { Principal } from "../platform/rbac/policy";
import { ANONYMISED_NAME } from "./engine/retention";
import { anonymiseCandidate, runCandidateRetention } from "./jobs";
import { listMyReferrals, listOpeningsForReferral, listReferrals, settleReferralBonus, submitReferral } from "./referrals";
import { PIPELINE_SEED } from "./seed-pipelines";
import { createApplication, createCandidate, createOpening, rejectApplication, savePipeline, setOpeningStatus } from "./service";

const fails = (promise: Promise<unknown>) =>
  promise.then(
    () => "no error",
    (error: Error) => error.message,
  );
const principal = (personId: string | null, grants: Principal["grants"] = []): Principal => ({ personId, workforceType: "employee", grants });

const ids = {} as Record<"szm" | "szc" | "vid" | "pipeline" | "opening" | "draftOpening" | "szcOpening" | "hrPerson" | "referrerPerson" | "otherReferrerPerson", string>;
let hrAdmin: Principal;
let szcRecruiter: Principal;

beforeAll(async () => {
  await migrateTestDb();
  const [szm] = await db().insert(schema.entity).values({ code: "SZM", legalName: "SuZu Media", shortName: "Media" }).returning();
  const [szc] = await db().insert(schema.entity).values({ code: "SZC", legalName: "SuZu Creative", shortName: "Creative" }).returning();
  const [vid] = await db().insert(schema.orgUnit).values({ code: "VID", name: "Video" }).returning();
  Object.assign(ids, { szm: szm.id, szc: szc.id, vid: vid.id });

  for (const [key, fullName] of [
    ["hrPerson", "Giám đốc Nhân sự"],
    ["referrerPerson", "Người giới thiệu"],
    ["otherReferrerPerson", "Đồng nghiệp khác"],
  ] as const) {
    const [row] = await db().insert(schema.person).values({ fullName, searchName: key, primaryEntityId: szm.id, orgUnitId: vid.id, status: "active" }).returning();
    ids[key] = row.id;
  }

  const seed = PIPELINE_SEED.find((row) => row.code === "STANDARD")!;
  const { after } = await savePipeline(null, { ...seed, isActive: true, stages: seed.stages.map((stage) => ({ ...stage })) });
  ids.pipeline = after.id;

  hrAdmin = principal(ids.hrPerson, [{ role: "hr_admin", scope: { type: "group" } }]);
  szcRecruiter = principal(ids.hrPerson, [{ role: "recruiter", scope: { type: "entity", id: szc.id } }]);

  const base = {
    titleEn: null,
    departmentId: ids.vid,
    teamId: null,
    positionName: "Video Editor",
    jobLevel: null,
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

  const draft = await createOpening({ ...base, title: "Draft role", entityId: ids.szm }, null, ids.hrPerson);
  ids.draftOpening = draft.id;

  const szcOpening = await createOpening({ ...base, title: "Creative role", entityId: ids.szc, departmentId: null }, null, ids.hrPerson);
  await setOpeningStatus(szcOpening.id, "open", null);
  ids.szcOpening = szcOpening.id;
});

const referral = (overrides: Partial<Parameters<typeof submitReferral>[0]> = {}) => ({
  openingId: ids.opening,
  fullName: "Lê Thị Giới Thiệu",
  email: "gioi.thieu@example.com",
  phone: "0901000111",
  currentTitle: "Editor",
  currentEmployer: "Studio khác",
  links: ["https://example.com/reel"],
  note: "Làm chung dự án năm ngoái.",
  cv: null,
  ...overrides,
});

describe("submitReferral", () => {
  it("puts a name forward as an ordinary candidate and application", async () => {
    expect(await submitReferral(referral(), ids.referrerPerson)).toEqual({ received: true });

    const [candidate] = await db().select().from(schema.candidate).where(eq(schema.candidate.email, "gioi.thieu@example.com"));
    expect(candidate.source).toBe("referral");
    expect(candidate.referredByPersonId).toBe(ids.referrerPerson);
    // Nobody agreed to anything: a colleague passed the details on. The clock still starts.
    expect(candidate.consentAt).toBeNull();
    expect(candidate.retainUntil).not.toBeNull();

    const [application] = await db().select().from(schema.jobApplication).where(eq(schema.jobApplication.candidateId, candidate.id));
    expect(application.source).toBe("referral");
    expect(application.status).toBe("active");

    const [row] = await db().select().from(schema.referral).where(eq(schema.referral.applicationId, application.id));
    expect(row.referredByPersonId).toBe(ids.referrerPerson);
  });

  it("answers identically when the candidate is already on file, and writes no second record", async () => {
    const before = await db().select().from(schema.candidate);
    // Same mailbox: a certain duplicate. The second referrer is told exactly what the first was.
    expect(await submitReferral(referral({ fullName: "Lê Thị G.", phone: null }), ids.otherReferrerPerson)).toEqual({ received: true });
    const after = await db().select().from(schema.candidate);
    expect(after).toHaveLength(before.length);
    // One referral per application: the second colleague's claim is not written.
    const referrals = await db().select().from(schema.referral);
    expect(referrals.filter((row) => row.referredByPersonId === ids.otherReferrerPerson)).toHaveLength(0);
  });

  it("refuses an opening that is not published, without saying whether it exists", async () => {
    expect(await fails(submitReferral(referral({ openingId: ids.draftOpening, email: "a@example.com", phone: "0902000222" }), ids.referrerPerson))).toBe("recruit_opening_not_open");
    expect(await fails(submitReferral(referral({ openingId: crypto.randomUUID(), email: "b@example.com", phone: "0903000333" }), ids.referrerPerson))).toBe("recruit_opening_not_open");
  });

  it("offers only published openings to refer into", async () => {
    const openings = await listOpeningsForReferral();
    expect(openings.map((row) => row.id)).toContain(ids.opening);
    expect(openings.map((row) => row.id)).not.toContain(ids.draftOpening);
  });
});

describe("reading referrals", () => {
  it("shows a referrer their own and nobody else's", async () => {
    await submitReferral(referral({ openingId: ids.szcOpening, fullName: "Người của Creative", email: "creative@example.com", phone: "0904000444" }), ids.otherReferrerPerson);

    const mine = await listMyReferrals(ids.referrerPerson);
    expect(mine.every((row) => row.referredByPersonId === ids.referrerPerson)).toBe(true);
    const theirs = await listMyReferrals(ids.otherReferrerPerson);
    expect(theirs.every((row) => row.referredByPersonId === ids.otherReferrerPerson)).toBe(true);
    expect(mine.map((row) => row.id)).not.toEqual(expect.arrayContaining(theirs.map((row) => row.id)));
  });

  it("scopes the recruitment desk's book to the entities it covers", async () => {
    const all = await listReferrals(hrAdmin);
    expect(all.length).toBeGreaterThanOrEqual(2);
    const creativeOnly = await listReferrals(szcRecruiter);
    expect(creativeOnly.map((row) => row.openingId)).toEqual([ids.szcOpening]);
  });

  it("gives an employee with no recruitment grant nothing at all", async () => {
    expect(await listReferrals(principal(ids.referrerPerson))).toEqual([]);
  });

  it("is pending while the candidate is in the pipeline and not earned once they are turned down", async () => {
    const mine = await listMyReferrals(ids.referrerPerson);
    expect(mine[0].bonus).toBe("pending");

    await rejectApplication(mine[0].applicationId, { reason: "experience", note: null }, ids.hrPerson);
    expect((await listMyReferrals(ids.referrerPerson))[0].bonus).toBe("not_earned");
  });

  it("refuses to settle a bonus nobody has earned", async () => {
    const mine = await listMyReferrals(ids.referrerPerson);
    expect(await fails(settleReferralBonus(mine[0].id, ids.hrPerson, null))).toBe("recruit_referral_not_earned");
  });
});

// ── Retention (FR-REC-13) ───────────────────────────────────────────────────────────────────

const past = "2020-01-01" as IsoDate;
const today = "2026-09-20" as IsoDate;

async function candidateWith(name: string, options: { talentPool?: boolean; retainUntil?: IsoDate | null } = {}) {
  const row = await createCandidate(
    {
      fullName: name,
      email: `${name.replace(/\W+/g, "")}@example.com`,
      phone: null,
      currentTitle: "Editor",
      currentEmployer: "Nơi khác",
      location: "Hà Nội",
      links: ["https://example.com/portfolio"],
      source: "careers_page",
      sourceDetail: "google",
      referredByPersonId: null,
      tags: ["video"],
      notes: "Ghi chú riêng của nhà tuyển dụng.",
    },
    null,
    { confirmedNotDuplicate: true, consent: { at: new Date(), version: "test", talentPool: !!options.talentPool } },
  );
  await db()
    .update(schema.candidate)
    .set({ retainUntil: options.retainUntil === undefined ? past : options.retainUntil })
    .where(eq(schema.candidate.id, row.id));
  const application = await createApplication(
    { candidateId: row.id, openingId: ids.opening, source: "careers_page", sourceDetail: null, coverLetter: "Thư xin việc.", answers: { why: "Vì thích." }, cvFileId: null, portfolioLinks: ["https://example.com/reel"], salaryExpectationVnd: 22_000_000, salaryExpectationNote: "thoả thuận" },
    null,
  );
  return { candidate: row, application };
}

describe("candidate retention", () => {
  it("empties an unsuccessful candidate past their window and leaves the counts standing", async () => {
    const { candidate, application } = await candidateWith("Ứng viên hết hạn");
    await rejectApplication(application.id, { reason: "not_qualified", note: null }, ids.hrPerson);

    const result = await runCandidateRetention(today);
    expect(result.anonymised).toBeGreaterThanOrEqual(1);

    const [after] = await db().select().from(schema.candidate).where(eq(schema.candidate.id, candidate.id));
    expect(after.fullName).toBe(ANONYMISED_NAME);
    expect([after.email, after.phone, after.emailKey, after.phoneKey, after.currentTitle, after.currentEmployer, after.location, after.notes, after.sourceDetail]).toEqual([null, null, null, null, null, null, null, null, null]);
    expect(after.links).toEqual([]);
    expect(after.tags).toEqual([]);
    expect(after.anonymisedAt).not.toBeNull();
    // The facts the funnel counts on survive.
    expect(after.source).toBe("careers_page");

    const [emptied] = await db().select().from(schema.jobApplication).where(eq(schema.jobApplication.id, application.id));
    expect(emptied.coverLetter).toBeNull();
    expect(emptied.answers).toEqual({});
    expect(emptied.portfolioLinks).toEqual([]);
    expect(emptied.salaryExpectationVnd).toBeNull();
    // The row itself, its stage, its status and its rejection reason are all still there.
    expect(emptied.status).toBe("rejected");
    expect(emptied.rejectionReason).toBe("not_qualified");
    expect(emptied.stageId).not.toBeNull();

    const events = await db().select().from(schema.applicationEvent).where(and(eq(schema.applicationEvent.applicationId, application.id), eq(schema.applicationEvent.type, "anonymised")));
    expect(events).toHaveLength(1);
  });

  it("keeps somebody who consented to the talent pool", async () => {
    const { candidate, application } = await candidateWith("Ứng viên đồng ý", { talentPool: true });
    await rejectApplication(application.id, { reason: "position_filled", note: null }, ids.hrPerson);

    await runCandidateRetention(today);
    const [after] = await db().select().from(schema.candidate).where(eq(schema.candidate.id, candidate.id));
    expect(after.anonymisedAt).toBeNull();
    expect(after.fullName).toBe("Ứng viên đồng ý");
  });

  it("never touches somebody still being considered", async () => {
    const { candidate } = await candidateWith("Ứng viên đang xét");
    await runCandidateRetention(today);
    const [after] = await db().select().from(schema.candidate).where(eq(schema.candidate.id, candidate.id));
    expect(after.anonymisedAt).toBeNull();
  });

  it("never touches somebody who became a colleague", async () => {
    const { candidate, application } = await candidateWith("Ứng viên đã vào làm");
    const [person] = await db().insert(schema.person).values({ fullName: "Đồng nghiệp mới", searchName: "dong nghiep moi", primaryEntityId: ids.szm, status: "preboarding" }).returning();
    await db().update(schema.jobApplication).set({ status: "hired", hiredPersonId: person.id, closedAt: new Date() }).where(eq(schema.jobApplication.id, application.id));

    await runCandidateRetention(today);
    const [after] = await db().select().from(schema.candidate).where(eq(schema.candidate.id, candidate.id));
    expect(after.anonymisedAt).toBeNull();
    expect(after.fullName).toBe("Ứng viên đã vào làm");
  });

  it("is a no-op the second night", async () => {
    const first = await runCandidateRetention(today);
    const second = await runCandidateRetention(today);
    expect(second.anonymised).toBe(0);
    expect(second.applications).toBe(0);
    expect(first.considered).toBeGreaterThanOrEqual(second.considered);
  });

  it("anonymising one candidate twice changes nothing the second time", async () => {
    const { candidate, application } = await candidateWith("Ứng viên gọi hai lần");
    await rejectApplication(application.id, { reason: "other", note: null }, ids.hrPerson);
    await anonymiseCandidate(candidate.id);
    const [once] = await db().select().from(schema.candidate).where(eq(schema.candidate.id, candidate.id));
    await anonymiseCandidate(candidate.id);
    const [twice] = await db().select().from(schema.candidate).where(eq(schema.candidate.id, candidate.id));
    expect(twice.anonymisedAt?.getTime()).toBe(once.anonymisedAt?.getTime());
  });

  it("sweeps the rate limiter's counters", async () => {
    await db().insert(schema.recruitPublicHit).values({ bucket: "apply", visitorHash: "deadbeefdeadbeef", windowStart: new Date("2020-01-01T00:00:00Z"), hits: 3 });
    const result = await runCandidateRetention(today);
    expect(result.publicHits).toBeGreaterThanOrEqual(1);
    const left = await db().select().from(schema.recruitPublicHit).where(eq(schema.recruitPublicHit.visitorHash, "deadbeefdeadbeef"));
    expect(left).toHaveLength(0);
  });

  it("leaves a candidate whose window has not passed alone", async () => {
    const { candidate, application } = await candidateWith("Ứng viên còn hạn", { retainUntil: "2027-01-01" as IsoDate });
    await rejectApplication(application.id, { reason: "salary", note: null }, ids.hrPerson);
    await runCandidateRetention(today);
    const [after] = await db().select().from(schema.candidate).where(eq(schema.candidate.id, candidate.id));
    expect(after.anonymisedAt).toBeNull();
  });
});
