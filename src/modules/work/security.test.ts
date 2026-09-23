// What a private project keeps to itself, and what a right over a team is not a right to do
// (security review of Phase 10). Against a real Postgres (PGlite): account handover, automations,
// leave cover, the exit handover and triage, each asked from someone who may run the team but not
// the project.
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
import { migrateTestDb } from "../../../tests/helpers/db";
import { automationPanel, saveAutomation } from "./automations";
import { getCoverPlan, handBackCover, submitCoverPlan } from "./cover";
import { getExitHandover, reassignOwnership } from "./exit";
import { isProjectPerson } from "../projects/membership";
import { removeReviewChain, saveReviewChain } from "./chains";
import { changeAccountManager, handOffStage } from "./handoffs";
import { moveTaskToTeam } from "./move";
import { createProject, listAssignable, setProjectMember } from "./projects";
import { submitDeliverable } from "./reviews";
import { createWorkTask, getTaskDetail, loadTask, updateWorkTask } from "./tasks";
import { createTeam, listStates, saveClient, setTeamMember } from "./teams";
import { listMergeTargets, listTriage, sendToTriage } from "./triage";
import { viewerOfPerson } from "./viewer";

type Key = "long" | "huy" | "bao" | "khoi" | "boss" | "ngoai";
const ids = {} as Record<Key | "szm" | "video" | "social" | "open" | "secret" | "client" | "script" | "design", string>;
const fails = (promise: Promise<unknown>) => promise.then(() => "no error", (error: Error) => error.message);
const actor = (key: Key) => ({ personId: ids[key], fullName: key });
const viewer = async (key: Key) => (await viewerOfPerson(db(), ids[key]))!;
const TODAY = todayInVietnam();

beforeAll(async () => {
  await migrateTestDb();
  const [szm] = await db().insert(schema.entity).values({ code: "SZM", legalName: "SuZu Media", shortName: "Media" }).returning();
  ids.szm = szm.id;
  for (const key of ["long", "huy", "bao", "khoi", "boss", "ngoai"] as const) {
    const [row] = await db()
      .insert(schema.person)
      .values({ fullName: key, searchName: key, workEmail: `${key}@suzu.group`, status: "active", primaryEntityId: szm.id, workforceType: key === "ngoai" ? "collaborator" : "employee" })
      .returning();
    ids[key] = row.id;
  }
  // The leader with `work:manage` over the whole group: a director, not a member of any project.
  await db().insert(schema.roleAssignment).values({ personId: ids.boss, role: "owner", scopeType: "group", scopeId: null, validFrom: "2020-01-01" });

  const video = await createTeam({ key: "VID", name: "Video", description: null, entityId: szm.id, departmentId: null, defaultVisibility: "team", isActive: true }, "simple", {}, ids.long);
  const social = await createTeam({ key: "SOC", name: "Social", description: null, entityId: szm.id, departmentId: null, defaultVisibility: "team", isActive: true }, "simple", {}, ids.khoi);
  Object.assign(ids, { video: video.id, social: social.id });
  for (const key of ["huy", "bao"] as const) await setTeamMember(video.id, ids[key], "member");
  const client = await saveClient(null, { code: "VNM", name: "Vinamilk", kind: "client", parentId: null, entityId: szm.id, note: null, isActive: true });
  ids.client = client.after.id;
  ids.open = (await createProject({ teamId: video.id, name: "TVC Tết", description: null, clientId: ids.client, status: "active", visibility: "team", leadPersonId: ids.long, startDate: null, dueDate: null }, ids.long)).id;
  // The private project: Huy's alone — the team's lead may run it, nobody else outside it.
  ids.secret = (await createProject({ teamId: video.id, name: "Pitch bí mật", description: null, clientId: ids.client, status: "active", visibility: "private", leadPersonId: ids.huy, startDate: null, dueDate: null }, ids.huy)).id;
  const states = [...(await listStates([video.id]))].sort((a, b) => a.sortOrder - b.sortOrder);
  Object.assign(ids, { script: states[0].id, design: states[1].id });
});

describe("account handover (FR-PJM-46)", () => {
  it("moves the role only on the projects the leader may run, and never to an outside collaborator", async () => {
    await setProjectMember(ids.open, ids.huy, "account_manager");
    await db().update(schema.workClient).set({ accountManagerPersonId: ids.huy }).where(eq(schema.workClient.id, ids.client));
    expect(await fails(changeAccountManager(ids.client, { toPersonId: ids.ngoai, note: { context: "x" } }, actor("boss"), await viewer("boss")))).toBe("account_manager_ineligible");

    const result = await changeAccountManager(ids.client, { toPersonId: ids.bao, note: { context: "Huy đổi khách" } }, actor("boss"), await viewer("boss"));
    expect(result.projects.map((project) => project.id)).toEqual([ids.open]);
    // The private project is neither changed nor named back.
    expect(result.withheld).toBe(1);
    expect(result.skipped).toEqual([]);
    const members = await db().select().from(schema.workProjectMember).where(eq(schema.workProjectMember.projectId, ids.secret));
    expect(members.map((member) => member.personId)).toEqual([ids.huy]);
  });
});

describe("automations (FR-PJM-33)", () => {
  const runs = async (automationId: string) => db().select().from(schema.workAutomationRun).where(eq(schema.workAutomationRun.automationId, automationId));

  it("a team-wide rule of a leader outside a private project does not run on its work", async () => {
    const rule = (await saveAutomation({ teamId: ids.video, projectId: null }, null, { name: "Báo cho sếp", trigger: { type: "state_entered", stateId: ids.design }, conditions: [], actions: [{ type: "notify", to: "role:lead", text: "Đã sang thiết kế" }], isActive: true }, ids.boss)).after;
    const { task } = await createWorkTask({ teamId: ids.video, projectId: ids.secret, title: "Deck", stateId: ids.script, assigneePersonId: ids.huy }, ids.huy);
    await updateWorkTask(task.id, { stateId: ids.design }, ids.huy);
    expect(await runs(rule.id)).toEqual([]);

    // On work outside the private project the same rule runs as before.
    const open = (await createWorkTask({ teamId: ids.video, projectId: ids.open, title: "Bản dựng", stateId: ids.script, assigneePersonId: ids.huy }, ids.long)).task;
    await updateWorkTask(open.id, { stateId: ids.design }, ids.huy);
    expect((await runs(rule.id)).map((run) => run.outcome)).toEqual(["ok"]);
    await db().delete(schema.workAutomation).where(eq(schema.workAutomation.id, rule.id));
  });

  it("drops the people a rule names who may not open the task, and writes them down in the run", async () => {
    const rule = (await saveAutomation({ teamId: ids.video, projectId: null }, null, { name: "Giao cho Khôi", trigger: { type: "state_entered", stateId: ids.design }, conditions: [], actions: [{ type: "assign", personId: ids.khoi }, { type: "notify", personId: ids.khoi, text: "Việc mới" }], isActive: true }, ids.long)).after;
    const { task } = await createWorkTask({ teamId: ids.video, projectId: ids.secret, title: "Kịch bản pitch", stateId: ids.script, assigneePersonId: ids.huy }, ids.huy);
    await updateWorkTask(task.id, { stateId: ids.design }, ids.huy);

    const [run] = await runs(rule.id);
    expect(run.detail.dropped).toEqual([{ action: "assign", personId: ids.khoi }, { action: "notify", personId: ids.khoi }]);
    expect((run.detail.results as { action: string; status: string; reason?: string }[]).every((step) => step.status === "skipped")).toBe(true);
    expect((await loadTask(task.id))!.task.assigneePersonId).toBe(ids.huy);
    expect(await db().select().from(schema.notification).where(and(eq(schema.notification.recipientPersonId, ids.khoi), eq(schema.notification.kind, "tasks.automation")))).toEqual([]);
    await db().delete(schema.workAutomation).where(eq(schema.workAutomation.id, rule.id));
  });

  it("hides the rules of a project the reader may not open", async () => {
    const rule = (await saveAutomation({ teamId: ids.video, projectId: ids.secret }, null, { name: "Quy tắc của pitch", trigger: { type: "state_entered", stateId: ids.design }, conditions: [], actions: [{ type: "notify", to: "role:lead", text: "x" }], isActive: true }, ids.huy)).after;
    expect((await automationPanel({ teamId: ids.video, projectId: null }, await viewer("huy"))).rules.map((row) => row.id)).toContain(rule.id);
    expect((await automationPanel({ teamId: ids.video, projectId: null }, await viewer("bao"))).rules.map((row) => row.id)).not.toContain(rule.id);
    await db().delete(schema.workAutomation).where(eq(schema.workAutomation.id, rule.id));
  });
});

describe("leave cover (FR-PJM-44)", () => {
  const planWith = async (items: { itemId: string; coverPersonId?: string }[], over: { from?: string; to?: string; status?: string; appliedAt?: Date } = {}) => {
    const [plan] = await db()
      .insert(schema.workCoverPlan)
      .values({ personId: ids.huy, leaveRequestId: crypto.randomUUID(), fromDate: over.from ?? addDays(TODAY, 1), toDate: over.to ?? addDays(TODAY, 3), status: over.status ?? "draft", appliedAt: over.appliedAt ?? null })
      .returning();
    for (const item of items) await db().insert(schema.workCoverItem).values({ planId: plan.id, itemType: "task", itemId: item.itemId, coverPersonId: item.coverPersonId ?? null });
    return plan;
  };

  it("names the work only to a reader who may open it, and takes only covers the work can go to", async () => {
    const secretTask = (await createWorkTask({ teamId: ids.video, projectId: ids.secret, title: "Dựng bản pitch", assigneePersonId: ids.huy }, ids.huy)).task;
    const plan = await planWith([{ itemId: secretTask.id }]);

    expect((await getCoverPlan(plan.id, await viewer("huy")))!.items[0].label).toContain("Dựng bản pitch");
    // The owner may read a private project since 2026-09-23 (Q25), so the label is theirs to see —
    // but the circle the work may be given to is unchanged: nobody they could hand it to.
    const asBoss = (await getCoverPlan(plan.id, await viewer("boss")))!.items[0];
    expect(asBoss.label).toContain("Dựng bản pitch");
    // The circle the work may be given to is the project's own people — never the reader themselves.
    expect(asBoss.assignableIds.sort()).toEqual([ids.huy, ids.long].sort());
    expect(asBoss.assignableIds).not.toContain(ids.boss);
    // A reader of the plan who may not open the project still gets minutes without a name.
    const asBao = (await getCoverPlan(plan.id, await viewer("bao")))?.items[0];
    if (asBao) expect([asBao.label, asBao.href]).toEqual([null, null]);

    // Khôi is in another team: he cannot be given this work, by name or as the cover for all.
    expect(await fails(submitCoverPlan(plan.id, { defaultCoverPersonId: null, items: [{ id: (await db().select().from(schema.workCoverItem).where(eq(schema.workCoverItem.planId, plan.id)))[0].id, coverPersonId: ids.khoi }], note: { context: "x" } }, actor("huy"), TODAY))).toBe("cover_not_assignable");
    expect(await fails(submitCoverPlan(plan.id, { defaultCoverPersonId: ids.khoi, items: [], note: { context: "x" } }, actor("huy"), TODAY))).toBe("cover_item_uncovered");
    // Bảo is in the team but not in this private project: the work does not go to him either.
    expect(await fails(submitCoverPlan(plan.id, { defaultCoverPersonId: ids.bao, items: [], note: { context: "x" } }, actor("huy"), TODAY))).toBe("cover_item_uncovered");
    const submitted = await submitCoverPlan(plan.id, { defaultCoverPersonId: ids.long, items: [], note: { context: "Nghỉ phép" } }, actor("huy"), TODAY);
    expect(submitted.covers).toEqual([ids.long]);
  });

  it("is handed back per cover, and never before the last day of the leave", async () => {
    const first = (await createWorkTask({ teamId: ids.video, projectId: ids.open, title: "Việc một", assigneePersonId: ids.huy }, ids.long)).task;
    const second = (await createWorkTask({ teamId: ids.video, projectId: ids.open, title: "Việc hai", assigneePersonId: ids.huy }, ids.long)).task;
    const plan = await planWith([{ itemId: first.id, coverPersonId: ids.bao }, { itemId: second.id, coverPersonId: ids.long }], { from: addDays(TODAY, -3), to: addDays(TODAY, 2), status: "submitted", appliedAt: new Date() });
    for (const task of [first, second]) await db().update(schema.task).set({ assigneePersonId: task.id === first.id ? ids.bao : ids.long }).where(eq(schema.task.id, task.id));

    expect(await fails(handBackCover(plan.id, actor("bao"), TODAY, { whole: false }))).toBe("cover_hand_back_early");
    const last = addDays(TODAY, 2);
    // A cover hands back what they hold, and nothing else; the plan stays open for the rest.
    expect(await handBackCover(plan.id, actor("bao"), last, { whole: false })).toMatchObject({ returned: 1 });
    expect((await loadTask(first.id))!.task.assigneePersonId).toBe(ids.huy);
    expect((await loadTask(second.id))!.task.assigneePersonId).toBe(ids.long);
    expect((await db().select().from(schema.workCoverPlan).where(eq(schema.workCoverPlan.id, plan.id)))[0].status).toBe("submitted");

    expect(await handBackCover(plan.id, actor("huy"), last, { whole: true })).toMatchObject({ returned: 1 });
    expect((await loadTask(second.id))!.task.assigneePersonId).toBe(ids.huy);
    expect((await db().select().from(schema.workCoverPlan).where(eq(schema.workCoverPlan.id, plan.id)))[0].status).toBe("handed_back");
  });
});

describe("exit handover (FR-PJM-45)", () => {
  it("shows the runner only what they run, and hands each item to someone the work can go to", async () => {
    const secretTask = (await createWorkTask({ teamId: ids.video, projectId: ids.secret, title: "Hợp đồng pitch", assigneePersonId: ids.huy }, ids.huy)).task;
    const openTask = (await createWorkTask({ teamId: ids.video, projectId: ids.open, title: "Bản dựng cuối", assigneePersonId: ids.huy }, ids.long)).task;
    const [handover] = await db().insert(schema.workExitHandover).values({ personId: ids.huy, lifecycleEventId: crypto.randomUUID(), reason: "termination", lastDay: addDays(TODAY, 10) }).returning();

    const asBoss = (await getExitHandover(handover.id, await viewer("boss")))!;
    const secretItem = asBoss.owned.find((item) => item.id === secretTask.id)!;
    // The owner reads the private project (Q25) but does not run it: the item is named and shut.
    expect([secretItem.label?.includes("Hợp đồng pitch"), secretItem.canReassign]).toEqual([true, false]);
    const openItem = asBoss.owned.find((item) => item.id === openTask.id)!;
    expect([openItem.label?.includes("Bản dựng cuối"), openItem.canReassign]).toEqual([true, true]);

    const note = { context: "Huy nghỉ việc" };
    expect(await fails(reassignOwnership(handover.id, { items: [{ kind: "task", id: secretTask.id }], toPersonId: ids.bao, note }, actor("boss"), await viewer("boss")))).toBe("exit_item_not_yours");
    // Even what the leader runs goes only to someone of the team or the project.
    expect(await fails(reassignOwnership(handover.id, { items: [{ kind: "task", id: openTask.id }], toPersonId: ids.khoi, note }, actor("boss"), await viewer("boss")))).toBe("person_not_assignable");
    await reassignOwnership(handover.id, { items: [{ kind: "task", id: openTask.id }], toPersonId: ids.bao, note }, actor("boss"), await viewer("boss"));
    expect((await loadTask(openTask.id))!.task.assigneePersonId).toBe(ids.bao);
    // The team's lead runs the private project too, so they can hand its work on — but only to
    // someone the project is open to, which the rest of the team is not.
    expect(await fails(reassignOwnership(handover.id, { items: [{ kind: "task", id: secretTask.id }], toPersonId: ids.bao, note }, actor("long"), await viewer("long")))).toBe("person_not_assignable");
    await reassignOwnership(handover.id, { items: [{ kind: "task", id: secretTask.id }], toPersonId: ids.long, note }, actor("long"), await viewer("long"));
    expect((await loadTask(secretTask.id))!.task.assigneePersonId).toBe(ids.long);
  });
});

describe("who a private project's work can be given to (FR-PJM-14)", () => {
  it("offers its own people and the team's leads, never the rest of the team", async () => {
    const open = (await listAssignable(ids.video, ids.open)).map((person) => person.id);
    expect(open).toEqual(expect.arrayContaining([ids.long, ids.huy, ids.bao]));
    // `secret` is Huy's, and Long leads the team: Bảo is in the team but not in the project.
    const secret = (await listAssignable(ids.video, ids.secret)).map((person) => person.id);
    expect(secret.sort()).toEqual([ids.huy, ids.long].sort());
    expect(secret).not.toContain(ids.bao);
    expect(secret).not.toContain(ids.khoi);
  });

  it("refuses to give a private project's task to a team member who is not in it", async () => {
    const { task } = await createWorkTask({ teamId: ids.video, projectId: ids.secret, title: "Bản chào giá" }, ids.huy);
    expect(await fails(updateWorkTask(task.id, { assigneePersonId: ids.bao }, ids.huy))).toBe("person_not_assignable");
    await updateWorkTask(task.id, { assigneePersonId: ids.long }, ids.huy);
    expect((await loadTask(task.id))!.task.assigneePersonId).toBe(ids.long);
  });

  it("keeps the cover of a private task inside it", async () => {
    const { task } = await createWorkTask({ teamId: ids.video, projectId: ids.secret, title: "Kịch bản pitch", assigneePersonId: ids.huy }, ids.huy);
    const [plan] = await db().insert(schema.workCoverPlan).values({ personId: ids.huy, leaveRequestId: crypto.randomUUID(), fromDate: addDays(TODAY, 1), toDate: addDays(TODAY, 3), status: "draft" }).returning();
    await db().insert(schema.workCoverItem).values({ planId: plan.id, itemType: "task", itemId: task.id });
    // Bảo is in the team but not in the project: neither by name nor as the cover for all.
    const [item] = await db().select().from(schema.workCoverItem).where(eq(schema.workCoverItem.planId, plan.id));
    expect(await fails(submitCoverPlan(plan.id, { defaultCoverPersonId: null, items: [{ id: item.id, coverPersonId: ids.bao }], note: { context: "x" } }, actor("huy"), TODAY))).toBe("cover_not_assignable");
    expect(await fails(submitCoverPlan(plan.id, { defaultCoverPersonId: ids.bao, items: [], note: { context: "x" } }, actor("huy"), TODAY))).toBe("cover_item_uncovered");
    expect((await submitCoverPlan(plan.id, { defaultCoverPersonId: ids.long, items: [], note: { context: "x" } }, actor("huy"), TODAY)).covers).toEqual([ids.long]);
  });

  it("hands a leaver's private work to the team's lead, not to the rest of the team", async () => {
    const { task } = await createWorkTask({ teamId: ids.video, projectId: ids.secret, title: "Hồ sơ thầu", assigneePersonId: ids.huy }, ids.huy);
    const [handover] = await db().insert(schema.workExitHandover).values({ personId: ids.huy, lifecycleEventId: crypto.randomUUID(), reason: "termination", lastDay: addDays(TODAY, 10) }).returning();
    const note = { context: "Huy nghỉ việc" };
    expect(await fails(reassignOwnership(handover.id, { items: [{ kind: "task", id: task.id }], toPersonId: ids.bao, note }, actor("long"), await viewer("long")))).toBe("person_not_assignable");
    await reassignOwnership(handover.id, { items: [{ kind: "task", id: task.id }], toPersonId: ids.long, note }, actor("long"), await viewer("long"));
    expect((await loadTask(task.id))!.task.assigneePersonId).toBe(ids.long);
  });
});

describe("triage (FR-PJM-32)", () => {
  it("shows a request routed into a private project only to that project's people", async () => {
    const { task } = await createWorkTask({ teamId: ids.video, projectId: ids.secret, title: "Yêu cầu bí mật" }, ids.huy);
    await db().transaction((tx) => sendToTriage(tx, task.id, "request", { notify: false }));
    expect((await listTriage(ids.video, await viewer("huy"))).map((item) => item.id)).toContain(task.id);
    expect((await listTriage(ids.video, await viewer("bao"))).map((item) => item.id)).not.toContain(task.id);
    // The owner may read it (Q25); deciding the triage is still the team's business, not the queue's reader's.
    expect((await listTriage(ids.video, await viewer("boss"))).map((item) => item.id)).toContain(task.id);

    const merge = (await createWorkTask({ teamId: ids.video, projectId: ids.secret, title: "Việc đang chạy" }, ids.huy)).task;
    expect((await listMergeTargets(ids.video, await viewer("huy"))).map((row) => row.id)).toContain(merge.id);
    expect((await listMergeTargets(ids.video, await viewer("bao"))).map((row) => row.id)).not.toContain(merge.id);
  });
});

describe("the ways into a private project that are not the assignee (security review, 2026-09-23)", () => {
  it("names nobody outside it as a task's requester — on creation, on a change, or by moving the task in", async () => {
    expect(await fails(createWorkTask({ teamId: ids.video, projectId: ids.secret, title: "Hỏi bởi Bảo", requesterPersonId: ids.bao }, ids.huy))).toBe("person_not_assignable");
    const { task } = await createWorkTask({ teamId: ids.video, projectId: ids.secret, title: "Hỏi bởi Huy" }, ids.huy);
    expect((await loadTask(task.id))!.task.requesterPersonId).toBe(ids.huy);
    expect(await fails(updateWorkTask(task.id, { requesterPersonId: ids.bao }, ids.huy))).toBe("person_not_assignable");
    await updateWorkTask(task.id, { requesterPersonId: ids.long }, ids.huy);
    // Bảo's request in the team's open project does not travel into the private one with him on it.
    const asked = (await createWorkTask({ teamId: ids.video, projectId: ids.open, title: "Bảo hỏi" }, ids.bao)).task;
    expect(await fails(updateWorkTask(asked.id, { projectId: ids.secret }, ids.huy))).toBe("person_not_assignable");
    // A request already standing (an intake asker's, or one from before the rule) stays editable.
    await db().update(schema.task).set({ requesterPersonId: ids.bao }).where(eq(schema.task.id, task.id));
    await updateWorkTask(task.id, { title: "Hỏi bởi Bảo (cũ)" }, ids.huy);
  });

  it("lists a task's sub-tasks only where the reader may open them", async () => {
    const parent = (await createWorkTask({ teamId: ids.video, projectId: ids.open, title: "Chiến dịch Tết" }, ids.long)).task;
    const hidden = (await createWorkTask({ teamId: ids.video, projectId: ids.secret, parentTaskId: parent.id, title: "Giá chào riêng" }, ids.huy)).task;
    const shown = (await createWorkTask({ teamId: ids.video, projectId: ids.open, parentTaskId: parent.id, title: "Kịch bản" }, ids.long)).task;
    const seenBy = async (key: Key) => (await getTaskDetail(parent.id, await viewer(key)))!.subtasks.map((subtask) => subtask.id);
    expect(await seenBy("bao")).toEqual([shown.id]);
    expect((await seenBy("huy")).sort()).toEqual([hidden.id, shown.id].sort());
  });

  it("does not carry a sub-task out of its own private project, nor anyone into one who is not in it", async () => {
    const root = (await createWorkTask({ teamId: ids.video, projectId: ids.open, title: "Gói nội dung" }, ids.long)).task;
    await createWorkTask({ teamId: ids.video, projectId: ids.secret, parentTaskId: root.id, title: "Chi phí riêng" }, ids.huy);
    expect(await fails(moveTaskToTeam(root.id, { teamId: ids.social, projectId: null }, ids.long))).toBe("move_subtask_private");
    // Into Social's private project: Bảo is on the task and not in that project.
    const closed = (await createProject({ teamId: ids.social, name: "Social bí mật", description: null, clientId: null, status: "active", visibility: "private", leadPersonId: ids.khoi, startDate: null, dueDate: null }, ids.khoi)).id;
    const task = (await createWorkTask({ teamId: ids.video, title: "Việc của Bảo", assigneePersonId: ids.bao }, ids.long)).task;
    expect(await fails(moveTaskToTeam(task.id, { teamId: ids.social, projectId: closed }, ids.long))).toBe("person_not_assignable");
    expect((await moveTaskToTeam(task.id, { teamId: ids.social, projectId: null }, ids.long)).targetTeamId).toBe(ids.social);
  });

  it("hands a stage on only to someone the task could be given to", async () => {
    const { task } = await createWorkTask({ teamId: ids.video, projectId: ids.secret, title: "Kịch bản pitch 2", stateId: ids.script, assigneePersonId: ids.huy }, ids.huy);
    const handoff = { toStateId: ids.design, values: {}, checked: [], links: [], fileId: null, note: {} };
    expect(await fails(handOffStage(task.id, { ...handoff, toPersonId: ids.bao }, actor("huy")))).toBe("person_not_assignable");
    await handOffStage(task.id, { ...handoff, toPersonId: ids.long }, actor("huy"));
    expect((await loadTask(task.id))!.task.assigneePersonId).toBe(ids.long);
  });

  it("names on a review stage only the project's people, and never sends a private task's stage to someone outside it", async () => {
    const stage = (personId: string) => ({ name: "Duyệt", reviewer: `person:${personId}`, dueHours: null });
    const input = { name: "Duyệt riêng", contentFormat: "tvc", isActive: true };
    expect(await fails(saveReviewChain({ teamId: ids.video, projectId: ids.secret }, null, { ...input, stages: [stage(ids.bao)] }, ids.huy))).toBe("person_not_assignable");
    expect(await fails(saveReviewChain({ teamId: ids.video, projectId: null }, null, { ...input, stages: [stage(ids.khoi)] }, ids.long))).toBe("person_not_assignable");
    // A team's chain may name Bảo — and on a private task of the team, his stage passes him over.
    const { after: chain } = await saveReviewChain({ teamId: ids.video, projectId: null }, null, { ...input, stages: [stage(ids.bao)] }, ids.long);
    const { task } = await createWorkTask({ teamId: ids.video, projectId: ids.secret, title: "TVC pitch", assigneePersonId: ids.huy, contentFormat: "tvc" }, ids.huy);
    const { reviewerPersonId } = await submitDeliverable(task.id, { kind: "link", url: "https://drive.example/tvc", note: null }, actor("huy"));
    expect(reviewerPersonId).not.toBe(ids.bao);
    expect(reviewerPersonId).toBe(ids.long);
    await removeReviewChain(chain.id);
  });

  it("counts only a private project's own people and the team's leads as its people (milestone owners)", async () => {
    expect(await isProjectPerson(db(), ids.secret, ids.bao)).toBe(false);
    expect(await isProjectPerson(db(), ids.secret, ids.long)).toBe(true);
    expect(await isProjectPerson(db(), ids.secret, ids.huy)).toBe(true);
    expect(await isProjectPerson(db(), ids.open, ids.bao)).toBe(true);
  });
});
