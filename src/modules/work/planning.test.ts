// Week 3 against a real Postgres (PGlite): the review step, templates, recurring tasks, the leader's
// view and the nudge.
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => import("../../../tests/helpers/db"));
vi.mock("@/lib/env", () => ({ env: () => ({ BETTER_AUTH_URL: "https://suzu.one" }) }));
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

import { and, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { migrateTestDb } from "../../../tests/helpers/db";
import { getLeaderView, listMyWorkItems, nudgeTask } from "./leader";
import { canDecideReview, canManageTemplate, canNudgeTask, canSubmitDeliverable } from "./policy";
import { createProject } from "./projects";
import { changeRecurrence, createRecurrence, generateOccurrences, listRecurrences } from "./recurrences";
import { decideReview, listDeliverables, listReviewsWaitingFor, submitDeliverable } from "./reviews";
import { addDependency, createWorkTask, listActivity, listProjectTasks, loadTask } from "./tasks";
import { createTeam, listStates, setTeamMember, teamFacts } from "./teams";
import { addWorkTemplateItem, applyTemplate, createProjectFromTemplate, listWorkTemplates, saveWorkTemplate } from "./templates";
import { viewerOfPerson } from "./viewer";

const ids = {} as Record<"szm" | "long" | "tam" | "huy" | "khoi" | "video" | "project" | "task", string>;
const fails = (promise: Promise<unknown>) => promise.then(() => "no error", (error: Error) => error.message);
const named = (key: "long" | "tam" | "huy") => ({ personId: ids[key], fullName: { long: "Long Dang", tam: "Tam Bui", huy: "Huy Ho" }[key] });
const noticesOf = async (personId: string, kind: string) => (await db().select().from(schema.notification).where(and(eq(schema.notification.recipientPersonId, personId), eq(schema.notification.kind, kind))));

beforeAll(async () => {
  await migrateTestDb();
  const [szm] = await db().insert(schema.entity).values({ code: "SZM", legalName: "Suzu Media", shortName: "Media" }).returning();
  ids.szm = szm.id;
  for (const [key, name] of [["long", "Long Dang"], ["tam", "Tam Bui"], ["huy", "Huy Ho"], ["khoi", "Khoi Ly"]] as const) {
    const [row] = await db().insert(schema.person).values({ fullName: name, searchName: name.toLowerCase(), workEmail: `${key}@suzu.group`, status: "active", primaryEntityId: szm.id }).returning();
    ids[key] = row.id;
  }
  const video = await createTeam({ key: "VID", name: "Video Production", description: null, entityId: szm.id, departmentId: null, defaultVisibility: "team", isActive: true }, "content", {}, ids.long);
  ids.video = video.id;
  for (const personId of [ids.tam, ids.huy]) await setTeamMember(video.id, personId, "member");
  ids.project = (await createProject({ teamId: video.id, name: "TVC Tet", description: null, clientId: null, status: "active", visibility: "team", leadPersonId: ids.tam, startDate: null, dueDate: null }, ids.long)).id;
  const edit = (await listStates([video.id])).find((state) => state.name === "edit" || state.category === "in_progress")!;
  ids.task = (await createWorkTask({ teamId: video.id, projectId: ids.project, title: "Rough cut", assigneePersonId: ids.huy, requesterPersonId: ids.long, stateId: edit.id, dueDate: "2026-09-25" }, ids.long)).task.id;
});

describe("review step", () => {
  it("only the people doing the work hand in; the submitter never decides", async () => {
    const task = (await loadTask(ids.task))!;
    const [huy, tam, long] = await Promise.all([viewerOfPerson(db(), ids.huy), viewerOfPerson(db(), ids.tam), viewerOfPerson(db(), ids.long)]);
    expect(canSubmitDeliverable(huy!, task.facts)).toBe(true);
    expect(canSubmitDeliverable(long!, task.facts)).toBe(false);
    const review = { reviewerPersonId: ids.tam, submittedByPersonId: ids.huy };
    expect(canDecideReview(tam!, task.facts, review)).toBe(true);
    // The team's lead may step in for the reviewer; the submitter may not, even as the named reviewer.
    expect(canDecideReview(long!, task.facts, review)).toBe(true);
    expect(canDecideReview(huy!, task.facts, { reviewerPersonId: ids.huy, submittedByPersonId: ids.huy })).toBe(false);
  });

  it("hand in → review state, reviewer = project lead; changes → back to work and a round; again → approved and on", async () => {
    const first = await submitDeliverable(ids.task, { kind: "link", url: "https://drive.google.com/rough-cut-v1", note: "Bản dựng thô" }, named("huy"));
    expect(first.deliverable.version).toBe(1);
    expect(first.reviewerPersonId).toBe(ids.tam);
    const afterSubmit = (await loadTask(ids.task))!;
    expect(afterSubmit.work.reviewStatus).toBe("submitted");
    const states = await listStates([ids.video]);
    expect(states.find((state) => state.id === afterSubmit.work.stateId)!.category).toBe("in_review");
    expect(await noticesOf(ids.tam, "tasks.review_requested")).toHaveLength(1);
    expect(await noticesOf(ids.huy, "tasks.review_requested")).toHaveLength(0);
    expect((await listReviewsWaitingFor(ids.tam)).map((row) => [row.taskId, row.version])).toEqual([[ids.task, 1]]);

    expect(await fails(decideReview(ids.task, "approved", null, named("huy")))).toBe("review_own_work");
    expect(await fails(decideReview(ids.task, "changes_requested", null, named("tam")))).toBe("review_comment_required");
    const changes = await decideReview(ids.task, "changes_requested", "Nhạc nền quá to ở 0:15", named("tam"));
    expect(changes.revisionRounds).toBe(1);
    const afterChanges = (await loadTask(ids.task))!;
    expect(afterChanges.work.reviewStatus).toBe("changes_requested");
    expect(states.find((state) => state.id === afterChanges.work.stateId)!.category).toBe("in_progress");
    expect((await noticesOf(ids.huy, "tasks.review_decided"))[0].params).toMatchObject({ decision: "changes_requested", version: 1 });
    expect(await listReviewsWaitingFor(ids.tam)).toHaveLength(0);
    expect(await fails(decideReview(ids.task, "approved", null, named("tam")))).toBe("review_not_pending");

    // A second hand-in replaced before anyone looked is no round.
    await submitDeliverable(ids.task, { kind: "link", url: "https://drive.google.com/rough-cut-v2", note: null }, named("huy"));
    await submitDeliverable(ids.task, { kind: "link", url: "https://drive.google.com/rough-cut-v3", note: null }, named("huy"));
    const approved = await decideReview(ids.task, "approved", "Ổn", named("tam"));
    expect(approved.deliverable.version).toBe(3);
    expect(approved.revisionRounds).toBe(1);
    expect((await listDeliverables(ids.task)).map((row) => [row.version, row.decision])).toEqual([[3, "approved"], [2, "superseded"], [1, "changes_requested"]]);
    // Internal review approved → the next step of the content workflow.
    const final = (await loadTask(ids.task))!;
    expect(final.work.reviewStatus).toBe("approved");
    expect(states.find((state) => state.id === final.work.stateId)!.sortOrder).toBeGreaterThan(states.find((state) => state.id === afterSubmit.work.stateId)!.sortOrder);
    expect((await listActivity(ids.task)).filter((entry) => entry.type.startsWith("review_")).map((entry) => entry.type).sort()).toEqual(["review_approved", "review_changes_requested", "review_submitted", "review_submitted", "review_submitted"]);
  });

  it("refuses when nobody but the submitter could review, and a file that is not on the task", async () => {
    const solo = await createProject({ teamId: ids.video, name: "Solo", description: null, clientId: null, status: "active", visibility: "team", leadPersonId: ids.long, startDate: null, dueDate: null }, ids.long);
    const { task } = await createWorkTask({ teamId: ids.video, projectId: solo.id, title: "Own work", assigneePersonId: ids.long }, ids.long);
    expect(await fails(submitDeliverable(task.id, { kind: "link", url: "https://example.com/x", note: null }, named("long")))).toBe("review_no_reviewer");
    expect(await fails(submitDeliverable(ids.task, { kind: "file", fileId: "00000000-0000-4000-8000-000000000000", note: null }, named("huy")))).toBe("file_not_found");
  });
});

describe("templates", () => {
  it("a team lead keeps the team's templates; shared ones take work:manage over the group", async () => {
    const [long, huy] = await Promise.all([viewerOfPerson(db(), ids.long), viewerOfPerson(db(), ids.huy)]);
    const [team] = await db().select().from(schema.workTeam).where(eq(schema.workTeam.id, ids.video));
    expect(canManageTemplate(long!, teamFacts(team))).toBe(true);
    expect(canManageTemplate(huy!, teamFacts(team))).toBe(false);
    expect(canManageTemplate(long!, null)).toBe(false);
  });

  it("makes a project with the whole tree, dates from the anchor, roles turned into people and members", async () => {
    const { after: template } = await saveWorkTemplate(null, { purpose: "work_project", name: "Video production", description: null, ownerId: ids.video, isActive: true });
    const pre = await addWorkTemplateItem(template.id, { title: "Tiền kỳ", description: null, parentItemId: null, roleKey: "producer", dueOffsetDays: 5, estimateMinutes: null, sortOrder: 0 });
    await addWorkTemplateItem(template.id, { title: "Kịch bản", description: null, parentItemId: pre.id, roleKey: "copywriter", dueOffsetDays: 3, estimateMinutes: 480, sortOrder: 0 });
    await addWorkTemplateItem(template.id, { title: "Dựng phim", description: null, parentItemId: null, roleKey: "editor", dueOffsetDays: 12, estimateMinutes: null, sortOrder: 1 });
    const sub = (await db().select().from(schema.taskTemplateItem).where(eq(schema.taskTemplateItem.title, "Kịch bản")))[0];
    expect(await fails(addWorkTemplateItem(template.id, { title: "Too deep", description: null, parentItemId: sub.id, roleKey: null, dueOffsetDays: 0, estimateMinutes: null, sortOrder: 0 }))).toBe("template_too_deep");
    expect((await listWorkTemplates([ids.video]))[0].roleKeys).toEqual(["producer", "copywriter", "editor"]);
    // Checklist screens never see it.
    const { listTemplates } = await import("../platform/tasks-engine/service");
    expect((await listTemplates()).some((row) => row.id === template.id)).toBe(false);

    const { project, taskIds } = await createProjectFromTemplate(
      { teamId: ids.video, name: "TVC Trung thu", description: null, clientId: null, status: "active", visibility: "private", leadPersonId: null, startDate: "2026-10-01", dueDate: null },
      { templateId: template.id, anchor: { mode: "start", date: "2026-10-01" }, roles: { producer: ids.tam, editor: ids.khoi, stranger: ids.huy } },
      ids.long,
    );
    expect(taskIds).toHaveLength(3);
    const tasks = await listProjectTasks(project.id);
    const byTitle = Object.fromEntries(tasks.map((task) => [task.title, task]));
    expect(byTitle["Tiền kỳ"]).toMatchObject({ dueDate: "2026-10-06", assigneePersonId: ids.tam, parentTaskId: null });
    // 2026-10-04 is a Sunday: the script moves to Monday. Nobody plays the copywriter: unassigned.
    expect(byTitle["Kịch bản"]).toMatchObject({ dueDate: "2026-10-05", assigneePersonId: null, parentTaskId: byTitle["Tiền kỳ"].id, estimateMinutes: 480 });
    expect(byTitle["Dựng phim"]).toMatchObject({ dueDate: "2026-10-13", assigneePersonId: ids.khoi });
    // Khoi is in no team: playing a role made him a member of the private project.
    const members = await db().select().from(schema.workProjectMember).where(eq(schema.workProjectMember.projectId, project.id));
    expect(members.map((member) => member.personId).sort()).toEqual([ids.long, ids.tam, ids.khoi].sort());
    // One notice per person for the whole tree.
    expect(await noticesOf(ids.tam, "tasks.assigned")).toHaveLength(1);

    const again = await applyTemplate({ templateId: template.id, anchor: { mode: "end", date: "2026-11-20" }, roles: {} }, project.id, ids.long);
    expect(again.taskIds).toHaveLength(3);
    expect((await listProjectTasks(project.id)).filter((task) => task.title === "Dựng phim").map((task) => task.dueDate).sort()).toEqual(["2026-10-13", "2026-11-20"]);
  });
});

describe("recurring tasks", () => {
  it("makes each occurrence once, a lead time ahead, and stops when paused or ended", async () => {
    const { recurrence, made } = await createRecurrence({ projectId: ids.project, title: "Báo cáo tuần", rule: { freq: "weekly", interval: 1, weekdays: [5] }, startDate: "2026-09-01", endDate: null, leadDays: 7, draft: { assigneePersonId: ids.huy, priority: 2 } }, ids.long, "2026-09-20");
    // Fridays within [today, today + 7]: 25 Sep. Nothing is back-filled before today.
    expect(made).toBe(1);
    expect(await generateOccurrences("2026-09-20")).toMatchObject({ made: 0 });
    expect(await generateOccurrences("2026-09-27")).toMatchObject({ made: 1 });
    const tasks = (await listProjectTasks(ids.project)).filter((task) => task.title === "Báo cáo tuần");
    expect(tasks.map((task) => task.dueDate).sort()).toEqual(["2026-09-25", "2026-10-02"]);
    expect(tasks.every((task) => task.assigneePersonId === ids.huy && task.priority === 2)).toBe(true);

    // Even if the bookmark is lost, the unique occurrence stops a second copy.
    await db().update(schema.workRecurrence).set({ generatedThrough: null }).where(eq(schema.workRecurrence.id, recurrence.id));
    expect(await generateOccurrences("2026-09-27")).toMatchObject({ made: 0 });

    await changeRecurrence(recurrence.id, { isActive: false });
    expect(await generateOccurrences("2026-10-10")).toMatchObject({ made: 0 });
    await changeRecurrence(recurrence.id, { isActive: true });
    // Catches up on what the pause skipped: 9 and 16 Oct.
    expect(await generateOccurrences("2026-10-10")).toMatchObject({ made: 2 });
    await changeRecurrence(recurrence.id, { endDate: "2026-10-10" });
    expect(await generateOccurrences("2026-11-01")).toMatchObject({ made: 0 });
    const [view] = await listRecurrences(ids.project, "2026-11-01");
    expect(view).toMatchObject({ made: 4, nextDate: null, assigneeName: "Huy Ho" });
    expect(await fails(createRecurrence({ projectId: ids.project, title: "x", rule: { freq: "weekly", interval: 1, weekdays: [] }, startDate: "2026-09-01", endDate: null, leadDays: 7, draft: {} }, ids.long, "2026-09-20"))).toBe("recurrence_rule_invalid");
  });
});

describe("leader view and nudge", () => {
  it("shows other people's open work by person with overdue and at-risk, and nudges once a day", async () => {
    const { task: late } = await createWorkTask({ teamId: ids.video, projectId: ids.project, title: "Late shot list", assigneePersonId: ids.huy, dueDate: "2026-09-10" }, ids.long);
    const { task: blocked } = await createWorkTask({ teamId: ids.video, projectId: ids.project, title: "Colour grade", assigneePersonId: ids.tam, dueDate: "2026-12-01" }, ids.long);
    await addDependency(late.id, blocked.id, "blocks", ids.long);
    await createWorkTask({ teamId: ids.video, projectId: ids.project, title: "Long's own", assigneePersonId: ids.long }, ids.long);

    const view = await getLeaderView((await viewerOfPerson(db(), ids.long))!, "2026-09-20");
    const huy = view.people.find((person) => person.personId === ids.huy)!;
    expect(huy.tasks[0]).toMatchObject({ title: "Late shot list", risk: "overdue" });
    expect(view.people.find((person) => person.personId === ids.tam)!.tasks.find((task) => task.title === "Colour grade")).toMatchObject({ risk: "at_risk" });
    expect(view.people.some((person) => person.personId === ids.long)).toBe(false);
    expect(view.totals.overdue).toBeGreaterThanOrEqual(1);
    // A plain member leads nothing and asked for nothing.
    expect((await getLeaderView((await viewerOfPerson(db(), ids.khoi))!, "2026-09-20")).people).toEqual([]);

    const facts = (await loadTask(late.id))!.facts;
    expect(canNudgeTask((await viewerOfPerson(db(), ids.long))!, facts)).toBe(true);
    expect(canNudgeTask((await viewerOfPerson(db(), ids.huy))!, facts)).toBe(false);
    await nudgeTask(late.id, named("long"), "2026-09-20");
    expect(await fails(nudgeTask(late.id, named("tam"), "2026-09-20"))).toBe("nudge_already_sent");
    await nudgeTask(late.id, named("long"), "2026-09-21");
    expect(await noticesOf(ids.huy, "tasks.nudge")).toHaveLength(2);
    expect(await fails(nudgeTask((await createWorkTask({ teamId: ids.video, projectId: ids.project, title: "Nobody's" }, ids.long)).task.id, named("long"), "2026-09-20"))).toBe("nudge_nobody");

    const mine = await listMyWorkItems(ids.tam);
    expect(mine.find((item) => item.title === "Colour grade")).toMatchObject({ blockedBy: 1, key: expect.stringMatching(/^VID-\d+$/) });
  });
});
