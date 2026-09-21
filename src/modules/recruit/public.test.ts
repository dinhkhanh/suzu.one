// The public careers surface against a real Postgres (PGlite). What is worth testing here is not
// that an application can be written but everything that must happen *around* it: that a stranger
// learns nothing, that a machine is caught, that a renamed executable is refused, and that a
// candidate's file lands somewhere only the hiring team can reach.
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => import("../../../tests/helpers/db"));
vi.mock("@/lib/env", () => ({ env: () => ({ BETTER_AUTH_SECRET: "a-test-secret-long-enough-to-sign-with" }) }));
// Only the network layer is replaced: `storeIncomingFile`'s own checks — the type allow-list and
// the magic bytes — are the thing under test and run for real.
const objects = new Map<string, { bytes: Uint8Array; contentType: string }>();
vi.mock("@/modules/platform/files/storage", () => ({
  putObject: async (objectPath: string, bytes: Uint8Array, contentType: string) => void objects.set(objectPath, { bytes, contentType }),
  currentBucket: () => "test-bucket",
  createSignedUploadUrl: async () => "https://example.invalid/upload",
  createSignedDownloadUrl: async () => "https://example.invalid/download",
  inspectObject: async () => null,
  removeObject: async () => {},
  StorageError: class StorageError extends Error {},
}));

import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { migrateTestDb } from "../../../tests/helpers/db";
import { canOpenCandidateFile } from "./policy";
import type { Principal } from "../platform/rbac/policy";
import { PIPELINE_SEED } from "./seed-pipelines";
import { createOpening, savePipeline, setOpeningStatus, setOpeningTeam } from "./service";
import { MIN_FILL_MS } from "./engine/form-token";
import { CAREERS_LIMITS } from "./engine/rate-limit";
import { answersFor, applyToOpening, countPublicHit, findPublicOpening, issueFormToken, listPublicOpenings } from "./public";

const principal = (personId: string | null, grants: Principal["grants"] = []): Principal => ({ personId, workforceType: "employee", grants });

/** A four-byte PDF header and some text: enough for `matchesSignature` to accept it. */
const pdfBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, ...new TextEncoder().encode("-1.7\nfake but honest")]);
/** A Windows executable that somebody renamed. */
const exeBytes = new Uint8Array([0x4d, 0x5a, 0x90, 0x00, ...new TextEncoder().encode("this is not a pdf")]);

const ids = {} as Record<"szm" | "vid" | "pipeline" | "recruiterPerson" | "headPerson" | "employeePerson", string>;
let slug: string;
let openingId: string;
let draftSlug: string;

/** A fresh visitor per test, so one test's submissions never spend another's allowance. */
let counter = 0;
const nextVisitor = () => ({ ipHash: `visitor${String(++counter).padStart(10, "0")}`, userAgent: "test" });

const filled = (slugFor: string, overrides: Record<string, unknown> = {}) => ({
  slug: slugFor,
  website: "",
  // Minted in the past, so the form looks like one a person spent time on.
  formToken: issueFormToken(slugFor, new Date(Date.now() - MIN_FILL_MS - 1_000)),
  fullName: "Trần Thị Mai",
  email: "mai.tran@example.com",
  phone: "0912345678",
  location: "Hà Nội",
  currentTitle: "Editor",
  currentEmployer: "Somewhere",
  links: ["https://behance.net/mai"],
  coverLetter: "Tôi muốn ứng tuyển.",
  answers: {},
  salaryExpectationVnd: "20000000",
  consent: true,
  talentPool: false,
  cv: null,
  ...overrides,
});

beforeAll(async () => {
  await migrateTestDb();
  const [szm] = await db().insert(schema.entity).values({ code: "SZM", legalName: "Công ty SuZu Media", shortName: "SuZu Media" }).returning();
  const [vid] = await db().insert(schema.orgUnit).values({ code: "VID", name: "Video" }).returning();
  Object.assign(ids, { szm: szm.id, vid: vid.id });
  for (const [key, fullName] of [
    ["recruiterPerson", "Người tuyển dụng"],
    ["headPerson", "Trưởng phòng Video"],
    ["employeePerson", "Nhân viên thường"],
  ] as const) {
    const [row] = await db().insert(schema.person).values({ fullName, searchName: key, primaryEntityId: szm.id, orgUnitId: vid.id, status: "active" }).returning();
    ids[key] = row.id;
  }
  for (const seed of PIPELINE_SEED) {
    const { after } = await savePipeline(null, { ...seed, isActive: true, stages: seed.stages.map((stage) => ({ ...stage })) });
    if (seed.code === "STANDARD") ids.pipeline = after.id;
  }

  const base = {
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
  };
  const opening = await createOpening(
    {
      ...base,
      title: "Video Editor",
      questions: [
        { key: "portfolio_reel", label: "Link showreel", labelEn: "Showreel link", kind: "text", required: true, choices: [] },
        { key: "availability", label: "Khi nào bạn có thể bắt đầu?", labelEn: "When can you start?", kind: "choice", required: false, choices: ["Ngay lập tức", "Sau 1 tháng"] },
      ],
    },
    { salaryMinVnd: 18_000_000, salaryMaxVnd: 25_000_000, salaryPublic: false },
    ids.recruiterPerson,
  );
  await setOpeningStatus(opening.id, "open", null);
  await setOpeningTeam(opening.id, [{ personId: ids.headPerson, role: "hiring_manager" }]);
  slug = opening.publicSlug;
  openingId = opening.id;

  const draft = await createOpening({ ...base, title: "Producer", questions: [] }, null, ids.recruiterPerson);
  draftSlug = draft.publicSlug;
});

beforeEach(() => objects.clear());

describe("what the public may see", () => {
  it("lists published openings only, and carries no identifier but the slug", async () => {
    const openings = await listPublicOpenings();
    expect(openings.map((row) => row.title)).toEqual(["Video Editor"]);
    expect(JSON.stringify(openings)).not.toContain(openingId);
    expect(JSON.stringify(openings)).not.toContain(ids.szm);
    expect(JSON.stringify(openings)).not.toContain(ids.recruiterPerson);
  });

  it("hides a salary band nobody decided to publish", async () => {
    expect((await findPublicOpening(slug))?.salary).toBeNull();
  });

  it("answers the same for a draft, a closed job and a slug out of thin air", async () => {
    expect(await findPublicOpening(draftSlug)).toBeNull();
    expect(await findPublicOpening("definitely-not-a-slug")).toBeNull();
  });
});

describe("answersFor", () => {
  const questions = [
    { key: "reel", label: "Reel", labelEn: null, kind: "text" as const, required: true, choices: [] },
    { key: "start", label: "Start", labelEn: null, kind: "choice" as const, required: false, choices: ["now", "later"] },
  ];

  it("keeps what was asked and drops what was not", () => {
    expect(answersFor(questions, { reel: "https://x", start: "now", smuggled: "value" })).toEqual({ reel: "https://x", start: "now" });
  });

  it("insists on a required answer", () => {
    expect(() => answersFor(questions, { start: "now" })).toThrow("careers_answer_required");
    expect(() => answersFor(questions, { reel: "   " })).toThrow("careers_answer_required");
  });

  it("refuses a choice that is not one of the choices", () => {
    expect(() => answersFor(questions, { reel: "https://x", start: "whenever" })).toThrow("careers_answer_invalid");
  });
});

describe("applying", () => {
  it("creates the candidate, the application and its first event, with the consent recorded", async () => {
    const result = await applyToOpening(filled(slug, { email: "first.applicant@example.com", answers: { portfolio_reel: "https://vimeo.com/x" } }), nextVisitor());
    expect(result).toEqual({ ok: true, data: { received: true } });

    const [candidate] = await db().select().from(schema.candidate).where(eq(schema.candidate.email, "first.applicant@example.com"));
    expect(candidate.source).toBe("careers_page");
    expect(candidate.createdByPersonId).toBeNull();
    expect(candidate.consentAt).not.toBeNull();
    expect(candidate.consentVersion).toBeTruthy();
    expect(candidate.talentPoolConsent).toBe(false);
    // The retention clock starts on the day they applied (FR-REC-13).
    expect(candidate.retainUntil).toBeTruthy();

    const [application] = await db().select().from(schema.jobApplication).where(eq(schema.jobApplication.candidateId, candidate.id));
    expect(application.source).toBe("careers_page");
    expect(application.answers).toEqual({ portfolio_reel: "https://vimeo.com/x" });
    expect(application.portfolioLinks).toEqual(["https://behance.net/mai"]);
    // Compensation-tier and stored, because the applicant volunteered it; who is shown it is policy's problem.
    expect(application.salaryExpectationVnd).toBe(20_000_000);

    const events = await db().select().from(schema.applicationEvent).where(eq(schema.applicationEvent.applicationId, application.id));
    expect(events.map((event) => event.type)).toEqual(["applied"]);
    // Nobody inside the company did this.
    expect(events[0].actorPersonId).toBeNull();
  });

  it("answers a repeat application exactly like a first one, and writes nothing the second time", async () => {
    const email = "repeat@example.com";
    const first = await applyToOpening(filled(slug, { email, phone: "0900000001", answers: { portfolio_reel: "https://a" } }), nextVisitor());
    const second = await applyToOpening(filled(slug, { email, phone: "0900000001", answers: { portfolio_reel: "https://b" } }), nextVisitor());
    expect(second).toEqual(first);

    const [candidate] = await db().select().from(schema.candidate).where(eq(schema.candidate.email, email));
    const applications = await db().select().from(schema.jobApplication).where(eq(schema.jobApplication.candidateId, candidate.id));
    expect(applications).toHaveLength(1);
    expect(applications[0].answers).toEqual({ portfolio_reel: "https://a" });
  });

  it("joins a new application to the person already on file rather than making a second record", async () => {
    const [before] = await db().select().from(schema.candidate).where(eq(schema.candidate.email, "repeat@example.com"));
    // Same address, a different spelling of the name and no phone: still the same mailbox.
    await applyToOpening(filled(slug, { email: "repeat@example.com", fullName: "Tran Thi Mai Anh", phone: null, answers: { portfolio_reel: "https://c" } }), nextVisitor());
    const rows = await db().select().from(schema.candidate).where(eq(schema.candidate.email, "repeat@example.com"));
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(before.id);
  });

  it("records a talent-pool tick as a new permission and never withdraws one", async () => {
    const email = "pool@example.com";
    await applyToOpening(filled(slug, { email, phone: "0900000002", talentPool: true, answers: { portfolio_reel: "https://a" } }), nextVisitor());
    const [after] = await db().select().from(schema.candidate).where(eq(schema.candidate.email, email));
    expect(after.talentPoolConsent).toBe(true);
    // Applying again without ticking it leaves the permission they already gave alone.
    await applyToOpening(filled(slug, { email, phone: "0900000002", talentPool: false, answers: { portfolio_reel: "https://a" } }), nextVisitor());
    const [again] = await db().select().from(schema.candidate).where(eq(schema.candidate.email, email));
    expect(again.talentPoolConsent).toBe(true);
  });

  it("refuses an application to a draft or a closed opening without saying which", async () => {
    const result = await applyToOpening(filled(draftSlug, { email: "draft@example.com" }), nextVisitor());
    expect(result).toEqual({ ok: false, error: "failed", message: "careers_opening_closed" });
  });

  it("refuses an application with no consent — there is no lawful basis to store it", async () => {
    const result = await applyToOpening(filled(slug, { email: "noconsent@example.com", consent: false }), nextVisitor());
    expect(result).toEqual({ ok: false, error: "invalid" });
    expect(await db().select().from(schema.candidate).where(eq(schema.candidate.email, "noconsent@example.com"))).toHaveLength(0);
  });

  it("refuses a required question that was not answered", async () => {
    const result = await applyToOpening(filled(slug, { email: "noanswer@example.com", answers: {} }), nextVisitor());
    expect(result).toEqual({ ok: false, error: "failed", message: "careers_answer_required" });
  });
});

describe("spam defence", () => {
  it("drops a submission that filled in the honeypot, and answers it like a success", async () => {
    const result = await applyToOpening(filled(slug, { email: "bot@example.com", website: "http://spam.example", answers: { portfolio_reel: "https://a" } }), nextVisitor());
    expect(result).toEqual({ ok: true, data: { received: true } });
    expect(await db().select().from(schema.candidate).where(eq(schema.candidate.email, "bot@example.com"))).toHaveLength(0);
  });

  it("drops a submission that arrived faster than anybody can type", async () => {
    const result = await applyToOpening(filled(slug, { email: "fast@example.com", formToken: issueFormToken(slug), answers: { portfolio_reel: "https://a" } }), nextVisitor());
    expect(result).toEqual({ ok: true, data: { received: true } });
    expect(await db().select().from(schema.candidate).where(eq(schema.candidate.email, "fast@example.com"))).toHaveLength(0);
  });

  it("refuses a token minted for another opening, out loud, because a person can act on it", async () => {
    const result = await applyToOpening(filled(slug, { email: "replay@example.com", formToken: issueFormToken(draftSlug, new Date(Date.now() - 60_000)) }), nextVisitor());
    expect(result).toEqual({ ok: false, error: "rejected", message: "careers_form_invalid" });
  });

  it("refuses a missing or forged token", async () => {
    expect((await applyToOpening(filled(slug, { email: "a@example.com", formToken: "" }), nextVisitor())).ok).toBe(false);
    expect((await applyToOpening(filled(slug, { email: "b@example.com", formToken: "123456789.abc" }), nextVisitor())).ok).toBe(false);
  });
});

describe("the rate limit", () => {
  it("counts per visitor and refuses past the allowance", async () => {
    const visitor = nextVisitor();
    for (let hit = 1; hit <= CAREERS_LIMITS.apply.max; hit++) expect(await countPublicHit("apply", visitor)).toEqual({ ok: true });
    const refused = await countPublicHit("apply", visitor);
    expect(refused.ok).toBe(false);
    expect(refused.ok === false && refused.retryAfterSeconds).toBeGreaterThan(0);
    // Somebody else's allowance is untouched.
    expect(await countPublicHit("apply", nextVisitor())).toEqual({ ok: true });
  });

  it("stops applications once the visitor is over the limit, before anything is written", async () => {
    const visitor = nextVisitor();
    for (let hit = 0; hit <= CAREERS_LIMITS.apply.max; hit++) await countPublicHit("apply", visitor);
    const result = await applyToOpening(filled(slug, { email: "flood@example.com", answers: { portfolio_reel: "https://a" } }), visitor);
    expect(result).toEqual({ ok: false, error: "rate_limited", message: "rate_limited" });
    expect(await db().select().from(schema.candidate).where(eq(schema.candidate.email, "flood@example.com"))).toHaveLength(0);
  });
});

describe("the CV", () => {
  it("is stored, marked not scanned, owned by the application, and uploaded by nobody", async () => {
    await applyToOpening(filled(slug, { email: "withcv@example.com", phone: "0900000003", cv: { fileName: "cv mai.pdf", bytes: pdfBytes }, answers: { portfolio_reel: "https://a" } }), nextVisitor());
    const [candidate] = await db().select().from(schema.candidate).where(eq(schema.candidate.email, "withcv@example.com"));
    const [application] = await db().select().from(schema.jobApplication).where(eq(schema.jobApplication.candidateId, candidate.id));
    expect(application.cvFileId).toBeTruthy();

    const [file] = await db().select().from(schema.storedFile).where(eq(schema.storedFile.id, application.cvFileId!));
    expect(file.status).toBe("ready");
    // There is no virus scanner in this system, and the row says so rather than claiming clean.
    expect(file.scanStatus).toBe("not_scanned");
    expect(file.uploadedByPersonId).toBeNull();
    expect(file.tier).toBe("personal");
    // The owner is the application, which is what `canOpenCandidateFile` is asked about.
    expect(file.ownerType).toBe("job_application");
    expect(file.ownerId).toBe(application.id);
    // Nothing the applicant typed is in the stored path.
    expect(file.objectPath).not.toContain("mai");
    expect(objects.has(file.objectPath)).toBe(true);
  });

  it("refuses an executable wearing a .pdf name — and the application is not written either", async () => {
    const result = await applyToOpening(filled(slug, { email: "malware@example.com", cv: { fileName: "cv.pdf", bytes: exeBytes }, answers: { portfolio_reel: "https://a" } }), nextVisitor());
    expect(result).toEqual({ ok: false, error: "failed", message: "file_content_mismatch" });
    expect(await db().select().from(schema.candidate).where(eq(schema.candidate.email, "malware@example.com"))).toHaveLength(0);
    expect(objects.size).toBe(0);
  });

  it("refuses a type that is not on the allow-list, whatever its bytes say", async () => {
    const result = await applyToOpening(filled(slug, { email: "script@example.com", cv: { fileName: "cv.svg", bytes: pdfBytes }, answers: { portfolio_reel: "https://a" } }), nextVisitor());
    expect(result).toEqual({ ok: false, error: "failed", message: "file_type_not_allowed" });
    expect(objects.size).toBe(0);
  });
});

describe("who can reach a candidate's CV", () => {
  const opening = () => ({ entityId: ids.szm, departmentId: ids.vid, teamId: null });

  it("the recruiter who runs the opening, and the hiring manager on its team", () => {
    expect(canOpenCandidateFile(principal(ids.recruiterPerson, [{ role: "recruiter", scope: { type: "entity", id: ids.szm } }]), opening(), false)).toBe(true);
    expect(canOpenCandidateFile(principal(ids.headPerson, [{ role: "department_head", scope: { type: "unit", id: ids.vid } }]), opening(), true)).toBe(true);
  });

  it("nobody else in the company — not a colleague, not finance, not a head off the team", () => {
    expect(canOpenCandidateFile(principal(ids.employeePerson), opening(), false)).toBe(false);
    expect(canOpenCandidateFile(principal(ids.employeePerson, [{ role: "finance", scope: { type: "group" } }]), opening(), false)).toBe(false);
    expect(canOpenCandidateFile(principal(ids.employeePerson, [{ role: "auditor", scope: { type: "group" } }]), opening(), false)).toBe(false);
    expect(canOpenCandidateFile(principal(ids.headPerson, [{ role: "department_head", scope: { type: "unit", id: ids.vid } }]), opening(), false)).toBe(false);
  });
});
