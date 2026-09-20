// 1:1 notes and review outcomes against a real database (PGlite): an action item becomes a task
// in the engine, the private notes never travel with the meeting, and a salary adjustment goes
// out through payroll's own approval request rather than being written here.
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => import("../../../tests/helpers/db"));
vi.mock("@/lib/env", () => ({
  env: () => ({ allowedWorkspaceDomains: ["suzu.vn", "suzu.group"], bootstrapOwnerEmails: [], BETTER_AUTH_URL: "https://suzu.one", DATA_ENCRYPTION_KEYS: `k1:${Buffer.alloc(32, 7).toString("base64")}`, DATA_BLIND_INDEX_KEY: Buffer.alloc(32, 9).toString("base64") }),
}));
vi.mock("@/lib/action", () => ({
  ActionError: class ActionError extends Error {
    constructor(
      message: string,
      readonly details?: unknown,
    ) {
      super(message);
    }
  },
}));

import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { hirePerson } from "@/modules/core-hr/service";
import { migrateTestDb } from "../../../tests/helpers/db";
import { DEFAULT_PERFORMANCE_WEIGHTING } from "./enums";
import { finalResult } from "./engine/result";
import { addOneOnOneAction, completeOneOnOneAction, createOneOnOne, listOneOnOnes, loadOneOnOne, shareOneOnOne } from "./one-on-ones";
import { decideOutcome, listOutcomes, raiseOutcome } from "./outcomes";

const ids = {} as Record<"entity" | "actor" | "manager" | "report", string>;

beforeAll(async () => {
  await migrateTestDb();
  const [entity] = await db().insert(schema.entity).values({ code: "SZM", legalName: "SuZu Media", shortName: "Media", wageRegion: 1 }).returning();
  const [department] = await db().insert(schema.department).values({ code: "VID", name: "Video" }).returning();
  const [actor] = await db().insert(schema.person).values({ fullName: "Seed Actor", searchName: "seed actor", status: "offboarded" }).returning();
  ids.entity = entity.id;
  ids.actor = actor.id;

  const hire = async (name: string, managerId: string | null) => {
    const { person } = await hirePerson(
      {
        fullName: name,
        workEmail: `${name.toLowerCase().replace(/\s+/g, ".")}@suzu.group`,
        profile: { dateOfBirth: null, gender: null, maritalStatus: null, nationality: null, phone: null, personalEmail: null, permanentAddress: null, currentAddress: null },
        entityId: entity.id,
        employeeCode: null,
        startDate: "2024-01-08",
        seniorityDate: null,
        placement: { workforceType: "employee", branchId: null, departmentId: department.id, teamId: null, positionName: null, jobLevel: null, managerId, dottedManagerId: null, workLocation: null },
      },
      actor.id,
      { onboarding: false },
    );
    return person.id;
  };
  ids.manager = await hire("Dang Hoang Long", null);
  ids.report = await hire("Ho Gia Huy", ids.manager);
});

describe("1:1 meeting notes", () => {
  it("keeps the private notes out of what anyone but the manager loads", async () => {
    const meeting = await createOneOnOne({ personId: ids.report, meetingOn: "2026-09-15", agenda: "Quý IV", sharedNotes: "Đang chạy tốt", privateNotes: "Cân nhắc đề bạt, chưa nói" }, ids.manager);

    const asManager = await loadOneOnOne(meeting.id, { seesPrivate: true });
    const asSubject = await loadOneOnOne(meeting.id, { seesPrivate: false });

    expect(asManager!.privateNotes).toBe("Cân nhắc đề bạt, chưa nói");
    expect(asSubject!.privateNotes).toBeNull();
    // The shared half is the same for both.
    expect(asSubject!.agenda).toBe("Quý IV");
    expect(asSubject!.sharedNotes).toBe("Đang chạy tốt");
  });

  it("refuses a 1:1 with oneself", async () => {
    await expect(createOneOnOne({ personId: ids.manager, meetingOn: "2026-09-15", agenda: null, sharedNotes: null, privateNotes: null }, ids.manager)).rejects.toThrow("one_on_one_with_self");
  });

  it("turns an action item into a real task, and ticking it off closes the task", async () => {
    const [meeting] = await db().select().from(schema.oneOnOne);
    const action = await addOneOnOneAction({ meetingId: meeting.id, title: "Viết đề cương khoá đào tạo dựng phim", assigneePersonId: ids.report, dueOn: "2026-10-01" }, ids.manager);

    expect(action.taskId).not.toBeNull();
    const [task] = await db().select().from(schema.task).where(eq(schema.task.id, action.taskId!));
    expect(task.kind).toBe("one_on_one");
    expect(task.assigneePersonId).toBe(ids.report);
    expect(task.subjectPersonId).toBe(ids.report);
    expect(task.contextType).toBe("one_on_one");
    expect(task.contextId).toBe(meeting.id);
    expect(task.status).toBe("todo");

    await completeOneOnOneAction(action.id, ids.report);
    const [done] = await db().select().from(schema.task).where(eq(schema.task.id, action.taskId!));
    expect(done.status).toBe("done");
  });

  it("lists the meeting for both parties, with its action count", async () => {
    const forManager = await listOneOnOnes(ids.manager);
    const forReport = await listOneOnOnes(ids.report);
    expect(forManager).toHaveLength(1);
    expect(forReport).toHaveLength(1);
    expect(forManager[0].actionCount).toBe(1);
    expect(forReport[0].personName).toBe("Ho Gia Huy");
  });

  it("shares once and refuses to share twice", async () => {
    const [meeting] = await db().select().from(schema.oneOnOne);
    const { after } = await shareOneOnOne(meeting.id);
    expect(after.status).toBe("shared");
    expect(after.sharedAt).not.toBeNull();
    await expect(shareOneOnOne(meeting.id)).rejects.toThrow("one_on_one_shared");
  });
});

describe("review outcomes", () => {
  async function settledResult(status: "draft" | "locked") {
    const [weighting] = await db().select().from(schema.performanceWeighting);
    const versionId = weighting?.id ?? (await db().insert(schema.performanceWeighting).values({ entityId: null, value: DEFAULT_PERFORMANCE_WEIGHTING, validFrom: "2026-01-01", status: "approved" }).returning())[0].id;
    const trace = finalResult({ reviewScoreBp: 11_000, kpiScoreBp: 11_500, okr: { individual: { progressBp: 11_000, goals: 2 }, team: { progressBp: null, goals: 0 }, department: { progressBp: null, goals: 0 }, entity: { progressBp: null, goals: 0 }, group: { progressBp: null, goals: 0 } }, weightingVersionId: versionId }, DEFAULT_PERFORMANCE_WEIGHTING);
    const [row] = await db()
      .insert(schema.performanceResult)
      .values({ personId: ids.report, entityId: ids.entity, year: 2026, weightingVersionId: versionId, reviewScoreBp: 11_000, kpiScoreBp: 11_500, okrScoreBp: trace.okr.scoreBp, computedScoreBp: trace.computedScoreBp, computedBand: trace.computedBand?.key ?? null, finalScoreBp: trace.finalScoreBp, finalBand: trace.finalBand?.key ?? null, multiplierBp: trace.multiplierBp, trace, status, ...(status === "locked" ? { lockedAt: new Date() } : {}) })
      .returning();
    return row;
  }

  it("refuses to be raised off a draft figure", async () => {
    const draft = await settledResult("draft");
    await expect(raiseOutcome({ resultId: draft.id, type: "promotion", note: null }, ids.manager)).rejects.toThrow("result_not_locked");
    await db().delete(schema.performanceResult).where(eq(schema.performanceResult.id, draft.id));
  });

  it("raises a promotion as a task for HR, and can be decided", async () => {
    const result = await settledResult("locked");
    const outcome = await raiseOutcome({ resultId: result.id, type: "promotion", note: "Đề bạt lên Senior Editor" }, ids.manager);

    expect(outcome.taskId).not.toBeNull();
    expect(outcome.salaryRequestId).toBeNull();
    const [task] = await db().select().from(schema.task).where(eq(schema.task.id, outcome.taskId!));
    expect(task.kind).toBe("review_outcome");
    expect(task.subjectPersonId).toBe(ids.report);

    const { after } = await decideOutcome(outcome.id, "accept", ids.actor);
    expect(after.status).toBe("accepted");
    await expect(decideOutcome(outcome.id, "reject", ids.actor)).rejects.toThrow("outcome_decided");

    expect(await listOutcomes({ personId: ids.report, year: 2026 })).toHaveLength(1);
  });

  it("refuses a salary adjustment with no terms — payroll decides the figure, not this module", async () => {
    const [result] = await db().select().from(schema.performanceResult).where(eq(schema.performanceResult.status, "locked"));
    await expect(raiseOutcome({ resultId: result.id, type: "salary_adjustment", note: null, salary: null }, ids.manager)).rejects.toThrow("salary_terms_required");
    // And nothing about pay was written here in the attempt.
    expect(await db().select().from(schema.salaryStructure)).toHaveLength(0);
  });
});
