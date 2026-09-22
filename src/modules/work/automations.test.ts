// Automations (FR-PJM-33) and the app frame's counts against a real Postgres (PGlite): rules run in
// the transaction of the change that set them off, a failing action is written down without undoing
// the change, a rule's change sets off rules one level deep only, the morning's due-date job and a
// quota alert each run a rule once, the starter rules work on a real workflow — and every figure of
// `app.shell_counts` is what the matching service answers.
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
import { addDays, todayInVietnam } from "@/lib/dates";
import { db, schema } from "@/lib/db";
import { loadShellCounts } from "@/modules/platform/shell/service";
import { countMyOpenTasks } from "@/modules/platform/tasks-engine/service";
import { migrateTestDb } from "../../../tests/helpers/db";
import { addPresetAutomation, fireProjectAutomations, listAutomationRuns, runDueDateAutomations, saveAutomation } from "./automations";
import { raiseBlocker, listBlockersWaitingOn } from "./blockers";
import { saveReviewChain } from "./chains";
import { listComments } from "./comments";
import { addWorkingDays, officeDayOff, type RuleInput } from "./engine/automation";
import { handOffStage, listPendingHandoffsFor, savePackage } from "./handoffs";
import { createProject } from "./projects";
import { countReviewsWaitingFor, recordClientDecision, submitDeliverable } from "./reviews";
import { createWorkTask, listActivity, loadTask, updateWorkTask, updateWorkTaskIn } from "./tasks";
import { createTeam, listStates, setTeamMember } from "./teams";

type Key = "long" | "tam" | "huy" | "bao";
const ids = {} as Record<Key | "szm", string>;
const actor = (key: Key) => ({ personId: ids[key], fullName: key });
const TODAY = todayInVietnam();
const noticesOf = async (key: Key, kind: string) => db().select().from(schema.notification).where(and(eq(schema.notification.recipientPersonId, ids[key]), eq(schema.notification.kind, kind)));
const runsOf = async (automationId: string) => db().select().from(schema.workAutomationRun).where(eq(schema.workAutomationRun.automationId, automationId));

/** A team of its own for each case, so one case's rules never fire in another's. Content workflow, led by long. */
async function newTeam(key: string) {
  const team = await createTeam({ key, name: key, description: null, entityId: ids.szm, departmentId: null, defaultVisibility: "team", isActive: true }, "content", {}, ids.long);
  for (const member of ["tam", "huy", "bao"] as const) await setTeamMember(team.id, ids[member], "member");
  const states = Object.fromEntries((await listStates([team.id], db())).map((state) => [state.name, state.id]));
  return { id: team.id, states };
}
const rule = (teamId: string, input: RuleInput, projectId: string | null = null) => saveAutomation({ teamId, projectId }, null, { ...input, isActive: true }, ids.long).then((saved) => saved.after);

beforeAll(async () => {
  await migrateTestDb();
  const [szm] = await db().insert(schema.entity).values({ code: "SZM", legalName: "SuZu Media", shortName: "Media" }).returning();
  ids.szm = szm.id;
  for (const key of ["long", "tam", "huy", "bao"] as const) {
    const [row] = await db().insert(schema.person).values({ fullName: key, searchName: key, workEmail: `${key}@suzu.group`, status: "active", primaryEntityId: szm.id }).returning();
    ids[key] = row.id;
  }
});

describe("rules run in the transaction of the change", () => {
  it("state entered → assign and a due date two working days out, logged with no actor and the rule's name", async () => {
    const team = await newTeam("AUA");
    const automation = await rule(team.id, { name: "Khách duyệt", trigger: { type: "state_entered", stateId: team.states.client_review }, conditions: [], actions: [{ type: "assign", personId: ids.bao }, { type: "set_due", days: 2 }] });
    const { task } = await createWorkTask({ teamId: team.id, title: "Clip 20/10", stateId: team.states.edit, assigneePersonId: ids.huy }, ids.tam);

    // The same transaction: when the change is rolled back, so is everything the rule did.
    await db()
      .transaction(async (tx) => {
        await updateWorkTaskIn(tx, task.id, { stateId: team.states.client_review }, ids.tam);
        expect((await loadTask(task.id, tx))!.task.assigneePersonId).toBe(ids.bao);
        throw new Error("rolled back");
      })
      .catch(() => undefined);
    expect((await loadTask(task.id))!.task.assigneePersonId).toBe(ids.huy);
    expect(await runsOf(automation.id)).toHaveLength(0);

    await updateWorkTask(task.id, { stateId: team.states.client_review }, ids.tam);
    const after = (await loadTask(task.id))!;
    expect(after.task.assigneePersonId).toBe(ids.bao);
    expect(after.task.dueDate).toBe(addWorkingDays(TODAY, 2, officeDayOff(new Set())));
    const [run] = await runsOf(automation.id);
    expect(run).toMatchObject({ taskId: task.id, trigger: "state_entered", outcome: "ok" });
    const activity = await listActivity(task.id);
    expect(activity.find((entry) => entry.type === "automation_ran")).toMatchObject({ actorName: null, toValue: { name: "Khách duyệt", outcome: "ok" } });
    // The rule's own changes carry no actor either.
    expect(activity.filter((entry) => entry.field === "assignee" || entry.field === "dueDate").every((entry) => entry.actorName === null)).toBe(true);
    expect(await noticesOf("bao", "tasks.work_assigned")).toHaveLength(1);
  });

  it("a failing action is recorded and rolled back alone; the person's change and the other actions stand", async () => {
    const team = await newTeam("AUB");
    const [label] = await db().insert(schema.workLabel).values({ teamId: team.id, name: "Gấp", color: "red" }).returning();
    const automation = await rule(team.id, { name: "Vào thiết kế", trigger: { type: "state_entered", stateId: team.states.design }, conditions: [], actions: [{ type: "set_due", days: 1 }, { type: "add_label", labelId: label.id }] });
    // Starts in two months: a due date tomorrow would end before it starts, and the update refuses it.
    const { task } = await createWorkTask({ teamId: team.id, title: "Key visual", stateId: team.states.script, startDate: addDays(TODAY, 60) }, ids.tam);
    await updateWorkTask(task.id, { stateId: team.states.design }, ids.tam);

    const after = (await loadTask(task.id))!;
    expect(after.work.stateId).toBe(team.states.design);
    expect(after.task.dueDate).toBeNull();
    const labels = await db().select().from(schema.workTaskLabel).where(eq(schema.workTaskLabel.taskId, task.id));
    expect(labels.map((row) => row.labelId)).toEqual([label.id]);
    const [run] = await runsOf(automation.id);
    expect(run.outcome).toBe("failed");
    expect((run.detail as { results: unknown[] }).results).toEqual([
      { action: "set_due", status: "failed", error: "task_dates_invalid" },
      { action: "add_label", status: "done" },
    ]);
    expect((await listActivity(task.id)).some((entry) => entry.type === "automation_failed")).toBe(true);
    const [shown] = await listAutomationRuns([automation.id]);
    expect(shown).toMatchObject({ taskId: task.id, outcome: "failed", taskKey: "AUB-1" });
  });

  it("a rule's change sets off rules one level deep only", async () => {
    const team = await newTeam("AUC");
    const [label] = await db().insert(schema.workLabel).values({ teamId: team.id, name: "Chuỗi", color: "blue" }).returning();
    const a = await rule(team.id, { name: "A", trigger: { type: "state_entered", stateId: team.states.script }, conditions: [], actions: [{ type: "move_state", stateId: team.states.design }] });
    const b = await rule(team.id, { name: "B", trigger: { type: "state_entered", stateId: team.states.design }, conditions: [], actions: [{ type: "move_state", stateId: team.states.edit }] });
    const c = await rule(team.id, { name: "C", trigger: { type: "state_entered", stateId: team.states.edit }, conditions: [], actions: [{ type: "add_label", labelId: label.id }] });
    const { task } = await createWorkTask({ teamId: team.id, title: "Chuỗi", stateId: team.states.brief }, ids.tam);
    await updateWorkTask(task.id, { stateId: team.states.script }, ids.tam);

    // The person's move set A off; A's move set B off; B's move sets nothing off.
    expect((await loadTask(task.id))!.work.stateId).toBe(team.states.edit);
    expect([(await runsOf(a.id)).length, (await runsOf(b.id)).length, (await runsOf(c.id)).length]).toEqual([1, 1, 0]);
    expect(await db().select().from(schema.workTaskLabel).where(eq(schema.workTaskLabel.taskId, task.id))).toEqual([]);
    expect(((await runsOf(b.id))[0].detail as { depth: number }).depth).toBe(1);
  });

  it("conditions decide, and a project's rule covers its project only", async () => {
    const team = await newTeam("AUD");
    const project = await createProject({ teamId: team.id, name: "Tết", description: null, clientId: null, status: "active", visibility: "team", leadPersonId: ids.tam, startDate: null, dueDate: null }, ids.long);
    const urgent = await rule(team.id, { name: "Gấp thì báo", trigger: { type: "field_changed", field: "priority" }, conditions: [{ field: "priority", op: "eq", value: 1 }], actions: [{ type: "notify", to: "role:lead", text: "Việc gấp" }] });
    const own = await rule(team.id, { name: "Của dự án", trigger: { type: "field_changed", field: "priority" }, conditions: [], actions: [{ type: "comment", text: "Đã đổi ưu tiên" }] }, project.id);
    const { task: loose } = await createWorkTask({ teamId: team.id, title: "Ngoài dự án" }, ids.tam);
    const { task: inProject } = await createWorkTask({ teamId: team.id, projectId: project.id, title: "Trong dự án" }, ids.tam);
    await updateWorkTask(loose.id, { priority: 3 }, ids.tam);
    await updateWorkTask(loose.id, { priority: 1 }, ids.tam);
    await updateWorkTask(inProject.id, { priority: 2 }, ids.tam);

    expect((await runsOf(urgent.id)).map((run) => run.taskId)).toEqual([loose.id]);
    expect((await runsOf(own.id)).map((run) => run.taskId)).toEqual([inProject.id]);
    const [comment] = await listComments(inProject.id);
    expect(comment).toMatchObject({ authorPersonId: null, authorName: "Của dự án", byAutomation: true, body: "Đã đổi ưu tiên" });
    expect((await noticesOf("long", "tasks.automation")).some((notice) => (notice.params as { rule: string }).rule === "Gấp thì báo")).toBe(true);
  });

  it("all sub-tasks done → tasks from a template, linked to the parent", async () => {
    const team = await newTeam("AUE");
    const [template] = await db().insert(schema.taskTemplate).values({ purpose: "work_task", name: "Báo cáo", description: null, ownerId: team.id, isActive: true }).returning();
    await db().insert(schema.taskTemplateItem).values({ templateId: template.id, title: "Báo cáo kết quả", assigneeRule: "role:owner", dueOffsetDays: 2, sortOrder: 1 });
    const automation = await rule(team.id, { name: "Xong hết thì báo cáo", trigger: { type: "all_subtasks_done" }, conditions: [], actions: [{ type: "create_task", templateId: template.id }] });
    const { task: parent } = await createWorkTask({ teamId: team.id, title: "Chiến dịch", assigneePersonId: ids.huy }, ids.tam);
    const { task: one } = await createWorkTask({ teamId: team.id, title: "Việc 1", parentTaskId: parent.id }, ids.tam);
    const { task: two } = await createWorkTask({ teamId: team.id, title: "Việc 2", parentTaskId: parent.id }, ids.tam);
    await updateWorkTask(one.id, { stateId: team.states.published }, ids.tam);
    expect(await runsOf(automation.id)).toHaveLength(0);
    await updateWorkTask(two.id, { stateId: team.states.cancelled }, ids.tam);

    const [run] = await runsOf(automation.id);
    expect(run).toMatchObject({ taskId: parent.id, outcome: "ok" });
    const [created] = (run.detail as { results: { created: string[] }[] }).results[0].created;
    const made = (await loadTask(created))!;
    // Every role of the template is played by the parent's assignee.
    expect([made.task.title, made.task.assigneePersonId]).toEqual(["Báo cáo kết quả", ids.huy]);
    const [link] = await db().select().from(schema.workTaskDependency).where(eq(schema.workTaskDependency.blockedTaskId, created));
    expect(link).toMatchObject({ blockerTaskId: parent.id, type: "relates" });
  });
});

describe("jobs and project events", () => {
  it("due date reached runs once per task and due date, however often the job runs", async () => {
    const team = await newTeam("AUF");
    const automation = await addPresetAutomation({ teamId: team.id, projectId: null }, "overdue_notify_lead", { name: "Quá hạn 1 ngày", text: "Việc đã quá hạn." }, ids.long);
    const { task } = await createWorkTask({ teamId: team.id, title: "Đăng bài", assigneePersonId: ids.huy, dueDate: addDays(TODAY, -1) }, ids.tam);
    const { task: long } = await createWorkTask({ teamId: team.id, title: "Cũ lắm rồi", dueDate: addDays(TODAY, -30) }, ids.tam);
    const { task: today } = await createWorkTask({ teamId: team.id, title: "Hạn hôm nay", dueDate: TODAY }, ids.tam);

    const before = (await noticesOf("long", "tasks.automation")).length;
    await runDueDateAutomations(TODAY);
    await runDueDateAutomations(TODAY);
    const runs = await runsOf(automation.id);
    expect(runs.map((run) => run.taskId)).toEqual([task.id]);
    expect(runs[0].detail).toMatchObject({ dueDate: addDays(TODAY, -1) });
    expect((await noticesOf("long", "tasks.automation")).length).toBe(before + 1);
    expect([long.id, today.id].some((id) => runs.some((run) => run.taskId === id))).toBe(false);

    // A new due date is a new "reached": moved and missed again, it runs again.
    await updateWorkTask(task.id, { dueDate: addDays(TODAY, -2) }, ids.tam);
    await runDueDateAutomations(TODAY);
    expect(await runsOf(automation.id)).toHaveLength(2);
  });

  it("a quota alert runs a project's rules once per alert key", async () => {
    const team = await newTeam("AUG");
    const project = await createProject({ teamId: team.id, name: "Retainer Vinamilk", description: null, clientId: null, status: "active", visibility: "team", leadPersonId: ids.tam, startDate: null, dueDate: null }, ids.long);
    const automation = await rule(team.id, { name: "Hạn mức 80%", trigger: { type: "quota_threshold", percent: 80 }, conditions: [], actions: [{ type: "notify", to: "role:lead", text: "Retainer đã dùng 80%" }] }, project.id);
    const fired = await db().transaction(async (tx) => [await fireProjectAutomations(tx, project.id, { type: "quota_threshold", percent: 100, key: "line-1:100" }), await fireProjectAutomations(tx, project.id, { type: "quota_threshold", percent: 100, key: "line-1:100" })]);
    expect(fired).toEqual([1, 0]);
    const [run] = await runsOf(automation.id);
    expect(run).toMatchObject({ taskId: null, trigger: "quota_threshold", outcome: "ok", detail: { projectId: project.id, key: "line-1:100" } });
    for (const key of ["tam", "long"] as const) expect((await noticesOf(key, "tasks.automation")).filter((notice) => notice.link === `/work/projects/${project.id}`)).toHaveLength(1);
  });
});

describe("starter rules", () => {
  it("client review → due in 2 working days; client changes → back to work and the assignee told", async () => {
    const team = await newTeam("AUH");
    const texts = { name: "Khách yêu cầu sửa", text: "Khách yêu cầu chỉnh sửa." };
    await addPresetAutomation({ teamId: team.id, projectId: null }, "client_review_due", { name: "Hẹn khách 2 ngày", text: "" }, ids.long);
    const reopen = await addPresetAutomation({ teamId: team.id, projectId: null }, "client_changes_reopen", texts, ids.long);
    expect(reopen.actions).toEqual([{ type: "move_state", stateId: team.states.edit }, { type: "notify", to: "role:assignee", text: texts.text }]);

    const { task } = await createWorkTask({ teamId: team.id, title: "TVC", stateId: team.states.internal_review }, ids.tam);
    await updateWorkTask(task.id, { stateId: team.states.client_review }, ids.tam);
    expect((await loadTask(task.id))!.task.dueDate).toBe(addWorkingDays(TODAY, 2, officeDayOff(new Set())));

    const { task: clip } = await createWorkTask({ teamId: team.id, title: "Clip", stateId: team.states.edit, assigneePersonId: ids.huy }, ids.tam);
    const { deliverable } = await submitDeliverable(clip.id, { kind: "link", url: "https://drive.google.com/clip", note: null }, actor("huy"));
    await recordClientDecision(deliverable.id, { decision: "changes_required", comment: "Đổi nhạc", client: { channel: "zalo", decidedByName: "Chị Mai", decidedOn: TODAY, evidenceFileId: null, evidenceUrl: "https://zalo.me/evidence" } }, actor("tam"));

    expect((await loadTask(clip.id))!.work.stateId).toBe(team.states.edit);
    const [run] = await runsOf(reopen.id);
    expect(run).toMatchObject({ taskId: clip.id, trigger: "client_decision", outcome: "ok" });
    // Already back at work (the review sent it): the move had nothing to do; the notice went.
    expect((run.detail as { results: unknown[] }).results).toEqual([
      { action: "move_state", status: "skipped", reason: "unchanged" },
      { action: "notify", status: "done" },
    ]);
    const told = (await noticesOf("huy", "tasks.automation")).find((notice) => notice.link === `/work/tasks/${clip.id}`);
    expect(told?.params).toMatchObject({ rule: "Khách yêu cầu sửa", text: texts.text, task: expect.stringContaining("Clip") });
  });

  it("a workflow without review has no client-review rule", async () => {
    const plain = await createTeam({ key: "AUI", name: "AUI", description: null, entityId: ids.szm, departmentId: null, defaultVisibility: "team", isActive: true }, "simple", {}, ids.long);
    await expect(addPresetAutomation({ teamId: plain.id, projectId: null }, "client_changes_reopen", { name: "x", text: "y" }, ids.long)).resolves.toBeTruthy();
    const noReview = await createTeam({ key: "AUJ", name: "AUJ", description: null, entityId: ids.szm, departmentId: null, defaultVisibility: "team", isActive: true }, "simple", {}, ids.long);
    await db().update(schema.workState).set({ isActive: false }).where(and(eq(schema.workState.teamId, noReview.id), eq(schema.workState.category, "in_review")));
    await expect(addPresetAutomation({ teamId: noReview.id, projectId: null }, "client_review_due", { name: "x", text: "y" }, ids.long)).rejects.toThrow("automation_preset_unavailable");
  });

  it("a rule naming another team's state is refused", async () => {
    const [mine, other] = [await newTeam("AUK"), await newTeam("AUL")];
    await expect(rule(mine.id, { name: "Sai", trigger: { type: "state_entered", stateId: other.states.edit }, conditions: [], actions: [{ type: "set_due", days: 1 }] })).rejects.toThrow("automation_state_invalid");
  });
});

describe("the app frame's counts (app.shell_counts)", () => {
  it("equal what the services answer, with a chain stage, a pending hand-off and a blocker", async () => {
    const team = await newTeam("AUM");
    await saveReviewChain({ teamId: team.id, projectId: null }, null, { name: "Bao duyệt", contentFormat: null, stages: [{ name: "Bao", reviewer: `person:${ids.bao}`, dueHours: 24 }], isActive: true }, ids.long);
    const { task: reviewed } = await createWorkTask({ teamId: team.id, title: "Có chuỗi duyệt", stateId: team.states.edit, assigneePersonId: ids.huy }, ids.tam);
    await submitDeliverable(reviewed.id, { kind: "link", url: "https://drive.google.com/v1", note: null }, actor("huy"));

    await savePackage(team.id, null, { name: "Kịch bản → Thiết kế", fromStateId: team.states.script, toStateId: team.states.design, fields: [], checklist: [], requireLink: false, requireFile: false, requireAccept: true, isActive: true }, ids.long);
    const { task: handed } = await createWorkTask({ teamId: team.id, title: "Bàn giao", stateId: team.states.script, assigneePersonId: ids.huy }, ids.tam);
    await handOffStage(handed.id, { toStateId: team.states.design, values: {}, checked: [], links: [], fileId: null, toPersonId: ids.bao, note: { context: "Kịch bản đã chốt" } }, actor("huy"));

    const { task: blocked } = await createWorkTask({ teamId: team.id, title: "Chờ Bao", assigneePersonId: ids.huy }, ids.tam);
    await raiseBlocker(blocked.id, { reason: "Chờ logo", neededPersonId: ids.bao }, actor("huy"));
    await createWorkTask({ teamId: team.id, title: "Của Bao", assigneePersonId: ids.bao }, ids.tam);

    const counts = await loadShellCounts(ids.bao);
    const expected = { reviews: await countReviewsWaitingFor(ids.bao), handoffs: (await listPendingHandoffsFor(ids.bao)).length, blockers: (await listBlockersWaitingOn(ids.bao)).length, openTasks: await countMyOpenTasks(ids.bao) };
    expect(expected).toMatchObject({ reviews: 1, handoffs: 1, blockers: 1 });
    expect(expected.openTasks).toBeGreaterThanOrEqual(1);
    expect({ reviews: counts.reviews, handoffs: counts.handoffs, blockers: counts.blockers, openTasks: counts.openTasks }).toEqual(expected);
    // The task's own reviewer is not whom a chain version waits for.
    expect((await loadShellCounts(ids.long)).reviews).toBe(await countReviewsWaitingFor(ids.long));
  });
});
