// Take-home assignments against a real Postgres (PGlite).
//
// The interesting half is the public one. A stranger holding a link can write to this system, so
// what is tested is not that a submission can be stored but that every way the link can fail gives
// the *same* answer, that the token cannot be read back out of the database, and that nothing the
// candidate posts reaches anybody it should not.
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => import("../../../tests/helpers/db"));
vi.mock("@/lib/env", () => ({ env: () => ({ BETTER_AUTH_URL: "https://suzu.one", BETTER_AUTH_SECRET: "a-test-secret-long-enough-to-sign-with" }) }));
// Storage is a network call to Supabase; the bytes themselves are the files module's business and
// are tested there. Here the file is a stub so the *flow* around it can be exercised.
vi.mock("@/modules/platform/files/service", () => ({
  storeIncomingFile: vi.fn(async () => ({ id: "00000000-0000-4000-8000-000000000001" })),
  reownFile: vi.fn(async () => undefined),
  softDeleteFile: vi.fn(async () => undefined),
}));

import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import type { Visitor } from "@/lib/public-action";
import { migrateTestDb } from "../../../tests/helpers/db";
import { cancelAssignment, findAssignment, findPublicAssignment, listAssignments, rateAssignment, sendAssignment, submitAssignment } from "./assignments";
import { PIPELINE_SEED } from "./seed-pipelines";
import { createApplication, createCandidate, createOpening, savePipeline, setOpeningStatus } from "./service";

const fails = (promise: Promise<unknown>) =>
  promise.then(
    () => "no error",
    (error: Error) => error.message,
  );

const ids = {} as Record<"szm" | "pipeline" | "openingId" | "applicationId" | "recruiterPerson", string>;
/** Each test gets its own visitor, so one test's rate limit is not another's problem. */
let visitorCounter = 0;
const nextVisitor = (): Visitor => ({ ipHash: `visitor${visitorCounter++}`, userAgent: "test" });
const inDays = (days: number) => new Date(Date.now() + days * 24 * 60 * 60 * 1000);

beforeAll(async () => {
  await migrateTestDb();
  const [szm] = await db().insert(schema.entity).values({ code: "SZM", legalName: "Công ty Suzu Media", shortName: "Suzu Media" }).returning();
  const [person] = await db().insert(schema.person).values({ fullName: "Người tuyển dụng", searchName: "recruiter", primaryEntityId: szm.id, status: "active" }).returning();
  ids.szm = szm.id;
  ids.recruiterPerson = person.id;

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
      pipelineId: after.id,
      targetStartDate: null,
      questions: [],
    },
    null,
    ids.recruiterPerson,
  );
  ids.openingId = opening.id;
  await setOpeningStatus(opening.id, "open", null);

  const candidate = await createCandidate(
    { fullName: "Phạm Minh Anh", email: "minhanh@example.test", phone: null, currentTitle: null, currentEmployer: null, location: null, links: [], source: "careers_page", sourceDetail: null, referredByPersonId: null, tags: [], notes: null },
    ids.recruiterPerson,
    { confirmedNotDuplicate: true },
  );
  const application = await createApplication(
    { candidateId: candidate.id, openingId: opening.id, source: "careers_page", sourceDetail: null, coverLetter: null, answers: {}, cvFileId: null, portfolioLinks: [], salaryExpectationVnd: null, salaryExpectationNote: null },
    ids.recruiterPerson,
  );
  ids.applicationId = application.id;
});

const send = (title = "Bài dựng 30 giây") => sendAssignment({ applicationId: ids.applicationId, title, brief: "Dựng một đoạn 30 giây từ tư liệu đính kèm.", dueAt: inDays(5) }, ids.recruiterPerson);

describe("sending a brief", () => {
  it("returns the link once and stores only its hash", async () => {
    const { assignment, token } = await send();
    expect(token.length).toBeGreaterThan(20);
    const [row] = await db().select().from(schema.recruitAssignment).where(eq(schema.recruitAssignment.id, assignment.id));
    // The token is nowhere in the row — only a SHA-256 of it.
    expect(JSON.stringify(row)).not.toContain(token);
    expect(row.tokenHash).toBe(createHash("sha256").update(token).digest("hex"));
  });

  it("lets the link outlive the deadline by a few days", async () => {
    const { assignment } = await send();
    expect(assignment.tokenExpiresAt.getTime()).toBeGreaterThan(assignment.dueAt.getTime());
  });

  it("refuses a deadline in the past", async () => {
    expect(await fails(sendAssignment({ applicationId: ids.applicationId, title: "x", brief: "y", dueAt: inDays(-1) }, ids.recruiterPerson))).toBe("assignment_due_in_the_past");
  });

  it("writes the fact to the application's history", async () => {
    await send("Bài thứ hai");
    const events = await db().select().from(schema.applicationEvent).where(eq(schema.applicationEvent.applicationId, ids.applicationId));
    expect(events.map((event) => event.type)).toContain("assignment_sent");
  });
});

describe("what the candidate can open", () => {
  it("shows the brief, the deadline and the job — and no identifier of any kind", async () => {
    const { token, assignment } = await send();
    const view = await findPublicAssignment(token);
    expect(view?.title).toBe(assignment.title);
    expect(view?.jobTitle).toBe("Video Editor");
    const text = JSON.stringify(view);
    for (const id of [assignment.id, ids.applicationId, ids.openingId, ids.szm]) expect(text).not.toContain(id);
  });

  it("answers nothing for an invented token, a cancelled brief and an expired link alike", async () => {
    expect(await findPublicAssignment("not-a-real-token-at-all-xx")).toBeNull();
    expect(await findPublicAssignment("short")).toBeNull();

    const cancelled = await send();
    await cancelAssignment(cancelled.assignment.id, ids.recruiterPerson);
    expect(await findPublicAssignment(cancelled.token)).toBeNull();

    const expired = await send();
    await db().update(schema.recruitAssignment).set({ tokenExpiresAt: inDays(-1) }).where(eq(schema.recruitAssignment.id, expired.assignment.id));
    expect(await findPublicAssignment(expired.token)).toBeNull();
  });
});

describe("receiving one", () => {
  it("takes the work and tells the history, without naming the candidate in the audit summary", async () => {
    const { assignment, token } = await send();
    const result = await submitAssignment({ token, website: "", note: "Em nộp bản 1080p.", links: ["https://vimeo.test/abc"], file: null }, nextVisitor());
    expect(result).toEqual({ ok: true, data: { received: true } });

    const after = await findAssignment(assignment.id);
    expect(after?.status).toBe("received");
    expect(after?.submissionLinks).toEqual(["https://vimeo.test/abc"]);
    expect(after?.submittedAt).not.toBeNull();

    const events = await db().select().from(schema.applicationEvent).where(eq(schema.applicationEvent.applicationId, ids.applicationId));
    expect(events.map((event) => event.type)).toContain("assignment_received");

    const audit = await db().select().from(schema.auditLog);
    const row = audit.find((entry) => entry.action === "careers.assignment.submit");
    expect(row?.summary).toContain(assignment.title);
    expect(row?.summary).not.toContain("Phạm Minh Anh");
    // A public call is never attributed to a person, and the address never appears.
    expect(row?.actorPersonId).toBeNull();
  });

  it("refuses a submission with neither a file nor a link", async () => {
    const { token } = await send();
    expect(await submitAssignment({ token, website: "", note: "quên đính kèm", links: [], file: null }, nextVisitor())).toEqual({
      ok: false,
      error: "failed",
      message: "assignment_nothing_submitted",
    });
  });

  it("gives one answer to an unknown, expired, cancelled and already-submitted link", async () => {
    const closed = { ok: false, error: "failed", message: "assignment_link_closed" };
    const body = { website: "", note: null, links: ["https://example.test/x"], file: null };

    expect(await submitAssignment({ ...body, token: "made-up-token-of-the-right-length" }, nextVisitor())).toEqual(closed);

    const twice = await send();
    await submitAssignment({ ...body, token: twice.token }, nextVisitor());
    // The second attempt with a perfectly valid token is refused exactly like a made-up one.
    expect(await submitAssignment({ ...body, token: twice.token }, nextVisitor())).toEqual(closed);

    const cancelled = await send();
    await cancelAssignment(cancelled.assignment.id, ids.recruiterPerson);
    expect(await submitAssignment({ ...body, token: cancelled.token }, nextVisitor())).toEqual(closed);

    const expired = await send();
    await db().update(schema.recruitAssignment).set({ tokenExpiresAt: inDays(-1) }).where(eq(schema.recruitAssignment.id, expired.assignment.id));
    expect(await submitAssignment({ ...body, token: expired.token }, nextVisitor())).toEqual(closed);
  });

  it("drops a honeypotted submission silently and answers like a success", async () => {
    const { assignment, token } = await send();
    expect(await submitAssignment({ token, website: "http://spam.test", note: "x", links: ["https://example.test/x"], file: null }, nextVisitor())).toEqual({ ok: true, data: { received: true } });
    // Nothing was written: the brief is still waiting.
    expect((await findAssignment(assignment.id))?.status).toBe("sent");
  });

  it("stops counting after the allowance and writes nothing more", async () => {
    const visitor = nextVisitor();
    const body = { website: "", note: null, links: ["https://example.test/x"], file: null };
    const outcomes = [];
    for (let attempt = 0; attempt < 6; attempt++) {
      const { token } = await send();
      outcomes.push(await submitAssignment({ ...body, token }, visitor));
    }
    expect(outcomes.slice(0, 4).every((outcome) => outcome.ok)).toBe(true);
    expect(outcomes[4]).toEqual({ ok: false, error: "rate_limited", message: "rate_limited" });
    expect(outcomes[5]).toEqual({ ok: false, error: "rate_limited", message: "rate_limited" });
  });

  it("caps what a stranger can post", async () => {
    const { token } = await send();
    const result = await submitAssignment({ token, website: "", note: "x".repeat(50_000), links: [], file: null }, nextVisitor());
    expect(result.ok).toBe(false);
    // A public refusal is a coarse kind and never a map of the schema.
    expect(result).toEqual({ ok: false, error: "invalid" });
  });
});

describe("rating one", () => {
  it("records the rating and says in the history that it happened, not what it was", async () => {
    const { assignment, token } = await send();
    await submitAssignment({ token, website: "", note: null, links: ["https://example.test/x"], file: null }, nextVisitor());
    const rated = await rateAssignment(assignment.id, { rating: 4, note: "Dựng chắc tay" }, ids.recruiterPerson);
    expect(rated.status).toBe("rated");
    expect(rated.rating).toBe(4);

    const events = await db().select().from(schema.applicationEvent).where(eq(schema.applicationEvent.applicationId, ids.applicationId));
    expect(JSON.stringify(events)).not.toContain("Dựng chắc tay");
  });

  it("clamps a rating posted outside the scale", async () => {
    const { assignment, token } = await send();
    await submitAssignment({ token, website: "", note: null, links: ["https://example.test/x"], file: null }, nextVisitor());
    expect((await rateAssignment(assignment.id, { rating: 99, note: null }, ids.recruiterPerson)).rating).toBe(4);
  });

  it("refuses to rate work that has not arrived, or a cancelled brief", async () => {
    const waiting = await send();
    expect(await fails(rateAssignment(waiting.assignment.id, { rating: 3, note: null }, ids.recruiterPerson))).toBe("recruit_assignment_not_submitted");

    const cancelled = await send();
    await cancelAssignment(cancelled.assignment.id, ids.recruiterPerson);
    expect(await fails(rateAssignment(cancelled.assignment.id, { rating: 3, note: null }, ids.recruiterPerson))).toBe("recruit_assignment_closed");
  });

  it("refuses to cancel twice", async () => {
    const { assignment } = await send();
    await cancelAssignment(assignment.id, ids.recruiterPerson);
    expect(await fails(cancelAssignment(assignment.id, ids.recruiterPerson))).toBe("recruit_assignment_closed");
  });
});

describe("the recruiter's list", () => {
  it("shows every brief on the application, newest first", async () => {
    const rows = await listAssignments(ids.applicationId);
    expect(rows.length).toBeGreaterThan(1);
    for (let index = 1; index < rows.length; index++) expect(rows[index - 1].sentAt.getTime()).toBeGreaterThanOrEqual(rows[index].sentAt.getTime());
  });
});
