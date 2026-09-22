import { describe, expect, it } from "vitest";
import { chainFor, chainProblems, fromVietnamLocal, isPublishMissing, isPublishStateName, latestMetrics, parseReviewerRule, pinProblem, publishFlag, resolveStageReviewer, stageDueAt, stageOutcome, toVietnamLocal, cleanMetrics, formatTimecode, freezesVersion } from "./delivery";

const PERSON = "7b0f7a52-6d8f-4d9e-9a36-2f1b8c0c1e11";

describe("review chain stages (FR-PJM-50)", () => {
  it("moves on after approval — with or without changes — and approves at the last stage", () => {
    expect(stageOutcome(3, 0, "approved")).toEqual({ kind: "next", stageIndex: 1 });
    expect(stageOutcome(3, 1, "approved_with_changes")).toEqual({ kind: "next", stageIndex: 2 });
    expect(stageOutcome(3, 2, "approved")).toEqual({ kind: "approved" });
    expect(stageOutcome(3, 2, "approved_with_changes")).toEqual({ kind: "approved" });
    expect(stageOutcome(1, 0, "approved")).toEqual({ kind: "approved" });
  });
  it("sends the version back to work from any stage when changes are required", () => {
    for (const index of [0, 1, 2]) expect(stageOutcome(3, index, "changes_required")).toEqual({ kind: "changes" });
  });
  it("gives a stage its due time from when it started", () => {
    const start = new Date("2026-09-22T02:00:00Z");
    expect(stageDueAt(start, 24)?.toISOString()).toBe("2026-09-23T02:00:00.000Z");
    expect(stageDueAt(start, null)).toBeNull();
  });
  it("checks a chain before it is saved", () => {
    const stage = (reviewer: string, name = "Duyệt") => ({ key: "k", name, reviewer, dueHours: 24 });
    expect(chainProblems([stage("team_lead"), stage("client")])).toEqual([]);
    expect(chainProblems([])).toEqual(["chain_needs_stage"]);
    expect(chainProblems([stage("client"), stage("team_lead")])).toEqual(["chain_client_not_last"]);
    expect(chainProblems([stage("boss")])).toEqual(["chain_reviewer_invalid"]);
    expect(chainProblems([stage(`person:${PERSON}`, " ")])).toEqual(["chain_stage_name_required"]);
    expect(chainProblems([{ ...stage("team_lead"), dueHours: 0 }])).toEqual(["chain_due_invalid"]);
  });
  it("reads reviewer rules", () => {
    expect(parseReviewerRule("account_manager")).toEqual({ kind: "account_manager" });
    expect(parseReviewerRule(`person:${PERSON}`)).toEqual({ kind: "person", personId: PERSON });
    expect(parseReviewerRule("person:someone")).toBeNull();
  });
});

describe("which chain applies", () => {
  const at = (minutes: number) => new Date(Date.UTC(2026, 8, 1, 0, minutes));
  const chain = (id: string, over: Partial<Parameters<typeof chainFor>[0][number]> = {}) => ({ id, teamId: "team", projectId: null, contentFormat: null, isActive: true, stageCount: 2, createdAt: at(0), ...over });
  const task = { teamId: "team", projectId: "project", contentFormat: "short_video" };
  it("prefers the project's chain to the team's, and a format's to one for every format", () => {
    const chains = [chain("team-any"), chain("team-video", { contentFormat: "short_video" }), chain("project-any", { projectId: "project", teamId: null }), chain("project-video", { projectId: "project", teamId: null, contentFormat: "short_video" })];
    expect(chainFor(chains, task)?.id).toBe("project-video");
    expect(chainFor(chains.slice(0, 3), task)?.id).toBe("project-any");
    expect(chainFor(chains.slice(0, 2), task)?.id).toBe("team-video");
    expect(chainFor(chains.slice(0, 2), { ...task, contentFormat: "post" })?.id).toBe("team-any");
  });
  it("skips inactive, empty, other projects' and other formats' chains; ties go to the oldest", () => {
    expect(chainFor([chain("off", { isActive: false }), chain("empty", { stageCount: 0 }), chain("other", { projectId: "elsewhere", teamId: null }), chain("post", { contentFormat: "post" })], task)).toBeNull();
    expect(chainFor([chain("newer", { createdAt: at(5) }), chain("older", { createdAt: at(1) })], task)?.id).toBe("older");
    expect(chainFor([], task)).toBeNull();
  });
});

describe("stage reviewer resolution", () => {
  const facts = { taskReviewerId: "rev", projectLeadIds: ["pl"], teamLeadIds: ["tl1", "tl2"], accountManagerIds: ["am"], active: new Set(["rev", "pl", "tl1", "tl2", "am", PERSON]) };
  it("follows the rule", () => {
    expect(resolveStageReviewer("task_reviewer", facts, "doer")).toBe("rev");
    expect(resolveStageReviewer("project_lead", facts, "doer")).toBe("pl");
    expect(resolveStageReviewer("team_lead", facts, "doer")).toBe("tl1");
    expect(resolveStageReviewer("account_manager", facts, "doer")).toBe("am");
    expect(resolveStageReviewer("client", facts, "doer")).toBe("am");
    expect(resolveStageReviewer(`person:${PERSON}`, facts, "doer")).toBe(PERSON);
  });
  it("never picks the submitter, and falls back when the rule names nobody usable", () => {
    expect(resolveStageReviewer("team_lead", facts, "tl1")).toBe("tl2");
    expect(resolveStageReviewer("account_manager", facts, "am")).toBe("rev");
    expect(resolveStageReviewer("account_manager", { ...facts, accountManagerIds: [] }, "doer")).toBe("rev");
    expect(resolveStageReviewer("task_reviewer", { ...facts, active: new Set(["tl2"]) }, "doer")).toBe("tl2");
    expect(resolveStageReviewer("team_lead", { ...facts, taskReviewerId: null, projectLeadIds: [], teamLeadIds: ["solo"], active: new Set(["solo"]) }, "solo")).toBeNull();
  });
});

describe("client decisions", () => {
  it("freeze the version on approval, not on changes required", () => {
    expect(freezesVersion("approved")).toBe(true);
    expect(freezesVersion("approved_with_changes")).toBe(true);
    expect(freezesVersion("changes_required")).toBe(false);
  });
});

describe("pins (FR-PJM-52)", () => {
  it("sit inside an image, as fractions of its width and height", () => {
    expect(pinProblem({ x: 0, y: 1, timecodeMs: null }, "image")).toBeNull();
    expect(pinProblem({ x: 0.5, y: 0.25, timecodeMs: null }, "image")).toBeNull();
    expect(pinProblem({ x: 1.2, y: 0.5, timecodeMs: null }, "image")).toBe("pin_position_invalid");
    expect(pinProblem({ x: -0.1, y: 0.5, timecodeMs: null }, "image")).toBe("pin_position_invalid");
    expect(pinProblem({ x: 0.5, y: null, timecodeMs: null }, "image")).toBe("pin_position_invalid");
    expect(pinProblem({ x: Number.NaN, y: 0.5, timecodeMs: null }, "image")).toBe("pin_position_invalid");
    expect(pinProblem({ x: 0.5, y: 0.5, timecodeMs: 1000 }, "image")).toBe("pin_position_invalid");
  });
  it("mark a moment of a video, never a point", () => {
    expect(pinProblem({ x: null, y: null, timecodeMs: 65_000 }, "video")).toBeNull();
    expect(pinProblem({ x: null, y: null, timecodeMs: -1 }, "video")).toBe("pin_timecode_invalid");
    expect(pinProblem({ x: null, y: null, timecodeMs: 1.5 }, "video")).toBe("pin_timecode_invalid");
    expect(pinProblem({ x: 0.5, y: 0.5, timecodeMs: 1000 }, "video")).toBe("pin_position_invalid");
    expect(pinProblem({ x: 0.5, y: 0.5, timecodeMs: null }, null)).toBe("pin_not_media");
  });
  it("read timecodes as a player shows them", () => {
    expect(formatTimecode(65_000)).toBe("1:05");
    expect(formatTimecode(3_723_000)).toBe("1:02:03");
  });
});

describe("publish log (FR-PJM-54)", () => {
  const now = new Date("2026-09-22T05:00:00Z");
  it("flags a planned post whose time has passed as late", () => {
    expect(publishFlag({ status: "planned", plannedAt: new Date("2026-09-22T04:59:00Z") }, now)).toBe("late");
    expect(publishFlag({ status: "planned", plannedAt: new Date("2026-09-22T05:01:00Z") }, now)).toBe("planned");
    expect(publishFlag({ status: "published", plannedAt: new Date("2026-09-20T00:00:00Z") }, now)).toBe("published");
    expect(publishFlag({ status: "planned", plannedAt: null }, now)).toBe("unscheduled");
    expect(publishFlag({ status: "cancelled", plannedAt: new Date("2026-09-20T00:00:00Z") }, now)).toBe("cancelled");
  });
  it("flags a content task due without any post as missing", () => {
    expect(isPublishMissing({ channel: "facebook", dueDate: "2026-09-22", status: "done" }, 0, "2026-09-22")).toBe(true);
    expect(isPublishMissing({ channel: "facebook", dueDate: "2026-09-23", status: "todo" }, 0, "2026-09-22")).toBe(false);
    expect(isPublishMissing({ channel: "facebook", dueDate: "2026-09-21", status: "todo" }, 1, "2026-09-22")).toBe(false);
    expect(isPublishMissing({ channel: null, dueDate: "2026-09-21", status: "todo" }, 0, "2026-09-22")).toBe(false);
    expect(isPublishMissing({ channel: "tiktok", dueDate: "2026-09-21", status: "cancelled" }, 0, "2026-09-22")).toBe(false);
  });
  it("knows a Published state by its name, in either language", () => {
    for (const name of ["Published", "Đã đăng", "đã ĐĂNG", "Da dang", "Đã xuất bản"]) expect(isPublishStateName(name)).toBe(true);
    for (const name of ["Scheduled", "Đã lên lịch", "Done", "Đăng ký"]) expect(isPublishStateName(name)).toBe(false);
  });
  it("reads a planned time in Vietnam's clock", () => {
    expect(fromVietnamLocal("2026-10-20T19:30")?.toISOString()).toBe("2026-10-20T12:30:00.000Z");
    expect(fromVietnamLocal("20/10/2026 19:30")).toBeNull();
    expect(toVietnamLocal(new Date("2026-10-20T12:30:00Z"))).toBe("2026-10-20T19:30");
  });
});

describe("results (FR-PJM-57)", () => {
  it("keep whole, non-negative figures only", () => {
    expect(cleanMetrics({ reach: 1200, spendVnd: 1_500_000, views: null })).toEqual({ reach: 1200, spendVnd: 1_500_000 });
    expect(cleanMetrics({ reach: -1 })).toBeNull();
    expect(cleanMetrics({ spendVnd: 10.5 })).toBeNull();
    expect(cleanMetrics({})).toBeNull();
  });
  it("count the latest reading of each figure, never the sum of readings", () => {
    const rows = [
      { recordedOn: "2026-10-21", metrics: { reach: 1000, views: 500 } },
      { recordedOn: "2026-10-23", metrics: { reach: 3000 } },
      { recordedOn: "2026-10-22", metrics: { reach: 2000, views: 900, spendVnd: 200_000 } },
    ];
    expect(latestMetrics(rows)).toEqual({ reach: 3000, views: 900, spendVnd: 200_000 });
  });
});
