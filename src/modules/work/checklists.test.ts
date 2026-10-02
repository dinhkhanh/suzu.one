// The checklist library against a real Postgres (PGlite): a checklist hooked to a stage is added on
// entering and, when required, holds the task until ticked; a task adds one by hand; a hand-off
// package, an intake form and a template step each bring theirs; removing a checklist takes it off
// every hook and leaves the boxes already on tasks.
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
import { todayInVietnam } from "@/lib/dates";
import { db, schema } from "@/lib/db";
import { migrateTestDb } from "../../../tests/helpers/db";
import { findChecklist, listChecklists } from "./checklist-library";
import { checklistUsage, deleteChecklist, saveChecklist, setStateChecklists } from "./checklists";
import type { MissingCheck } from "./engine/checklists";
import type { HandoffRequirement } from "./handoff-gate";
import { handOffStage, savePackage } from "./handoffs";
import { saveIntakeForm, submitIntake } from "./intake";
import { createProject } from "./projects";
import { createWorkTask, loadTask, updateWorkTask } from "./tasks";
import { addWorkTemplateItem, applyTemplate, saveWorkTemplate } from "./templates";
import { createTeam, listStates, setTeamMember } from "./teams";
import { workflow } from "../../../tests/helpers/workflows";

const ids = {} as Record<"szm" | "long" | "tam" | "video" | "project" | "backlog" | "brief" | "ideation" | "script" | "design" | "briefList" | "handoffList", string>;
const fails = (promise: Promise<unknown>) => promise.then(() => "no error", (error: Error) => error.message);
const failure = (promise: Promise<unknown>) => promise.then(() => null, (error: Error & { details?: unknown }) => error);
const boxes = async (taskId: string) => (await loadTask(taskId))!.work.checklist;
const briefItems = [{ text: "Đủ deadline và kênh đăng" }, { text: "Có brand guideline", linkUrl: "/kb/pages/brand" }];

beforeAll(async () => {
  await migrateTestDb();
  const [szm] = await db().insert(schema.entity).values({ code: "SZM", legalName: "SuZu Media", shortName: "Media" }).returning();
  ids.szm = szm.id;
  for (const key of ["long", "tam"] as const) {
    const [row] = await db().insert(schema.person).values({ fullName: key, searchName: key, workEmail: `${key}@suzu.group`, status: "active", primaryEntityId: szm.id }).returning();
    ids[key] = row.id;
  }
  const video = await createTeam({ key: "VID", name: "Video Production", description: null, entityId: szm.id, departmentId: null, defaultVisibility: "team", isActive: true }, workflow("content"), ids.long);
  ids.video = video.id;
  await setTeamMember(video.id, ids.tam, "member");
  ids.project = (await createProject({ teamId: video.id, name: "TVC Tết", description: null, clientId: null, status: "active", visibility: "team", leadPersonId: ids.long, startDate: null, dueDate: null }, ids.long)).id;
  // The content preset: backlog, brief, ideation, script, design, …
  const byOrder = [...(await listStates([video.id]))].sort((a, b) => a.sortOrder - b.sortOrder);
  Object.assign(ids, { backlog: byOrder[0].id, brief: byOrder[1].id, ideation: byOrder[2].id, script: byOrder[3].id, design: byOrder[4].id });
  ids.briefList = (await saveChecklist(null, { name: "Nhận brief", description: null, ownerUnitId: null, ownerTeamId: video.id, items: briefItems, isActive: true }, ids.long)).after.id;
  ids.handoffList = (await saveChecklist(null, { name: "Trước bàn giao", description: null, ownerUnitId: null, ownerTeamId: null, items: [{ text: "Đã xuất file gốc" }], isActive: true }, ids.long)).after.id;
});

describe("keeping the library", () => {
  it("refuses an empty checklist or one with two owners, and keeps item ids across edits", async () => {
    expect(await fails(saveChecklist(null, { name: "Trống", description: null, ownerUnitId: null, ownerTeamId: null, items: [{ text: "  " }], isActive: true }, ids.long))).toBe("checklist_empty");
    expect(await fails(saveChecklist(null, { name: "Hai chủ", description: null, ownerUnitId: crypto.randomUUID(), ownerTeamId: ids.video, items: briefItems, isActive: true }, ids.long))).toBe("checklist_owner_invalid");
    expect(await fails(saveChecklist(null, { name: "Đơn vị lạ", description: null, ownerUnitId: crypto.randomUUID(), ownerTeamId: null, items: briefItems, isActive: true }, ids.long))).toBe("checklist_owner_invalid");
    const before = (await findChecklist(ids.briefList))!;
    const { after } = await saveChecklist(ids.briefList, { name: "Nhận brief", description: "Khi brief về", ownerUnitId: null, ownerTeamId: ids.video, items: [...before.items, { id: "forged_id", text: "Có ngân sách" }], isActive: true }, ids.long);
    expect(after.items.slice(0, 2)).toEqual(before.items);
    // An id the checklist never had is not taken from the form.
    expect(after.items[2]).toMatchObject({ text: "Có ngân sách" });
    expect(after.items[2].id).not.toBe("forged_id");
    // Back to two items for the rest of the file.
    await saveChecklist(ids.briefList, { name: "Nhận brief", description: null, ownerUnitId: null, ownerTeamId: ids.video, items: before.items, isActive: true }, ids.long);
  });
});

describe("a checklist hooked to a stage", () => {
  it("is added on entering and, when required, holds the task until every box is ticked", async () => {
    await setStateChecklists(ids.brief, [{ checklistId: ids.briefList, required: true }]);
    const { task } = await createWorkTask({ teamId: ids.video, projectId: ids.project, title: "Clip 20/10", stateId: ids.backlog, assigneePersonId: ids.tam }, ids.long);
    expect(await boxes(task.id)).toEqual([]);

    await updateWorkTask(task.id, { stateId: ids.brief }, ids.tam);
    const added = await boxes(task.id);
    expect(added.map(({ text, done, checklistId, checklistName, linkUrl }) => ({ text, done, checklistId, checklistName, linkUrl }))).toEqual([
      { text: "Đủ deadline và kênh đăng", done: false, checklistId: ids.briefList, checklistName: "Nhận brief", linkUrl: undefined },
      { text: "Có brand guideline", done: false, checklistId: ids.briefList, checklistName: "Nhận brief", linkUrl: "/kb/pages/brand" },
    ]);
    const activity = await db().select().from(schema.workActivity).where(and(eq(schema.workActivity.taskId, task.id), eq(schema.workActivity.type, "checklist_added")));
    expect(activity.map((row) => row.toValue)).toEqual([{ id: ids.briefList, name: "Nhận brief" }]);

    // Moving on is refused with what is missing — on every path that moves a task.
    const refused = (await failure(updateWorkTask(task.id, { stateId: ids.ideation }, ids.tam))) as Error & { details: { missing: MissingCheck[] } };
    expect(refused.message).toBe("checklist_incomplete");
    expect(refused.details.missing.map((row) => row.text)).toEqual(["Đủ deadline và kênh đăng", "Có brand guideline"]);

    // A required checklist's box cannot be taken out, nor reworded.
    expect(await fails(updateWorkTask(task.id, { checklist: [{ id: added[0].id, text: added[0].text, done: false }] }, ids.tam))).toBe("checklist_item_locked");
    await updateWorkTask(task.id, { checklist: [{ id: added[0].id, text: "Không cần deadline", done: true }, { id: added[1].id, text: added[1].text, done: false }, { id: "own1", text: "Hỏi lại khách về nhạc", done: false }] }, ids.tam);
    const ticked = await boxes(task.id);
    expect(ticked.map(({ text, done }) => [text, done])).toEqual([
      ["Đủ deadline và kênh đăng", true],
      ["Có brand guideline", false],
      ["Hỏi lại khách về nhạc", false],
    ]);
    expect(await fails(updateWorkTask(task.id, { stateId: ids.ideation }, ids.tam))).toBe("checklist_incomplete");

    // Going back is always allowed; coming in again adds nothing twice.
    await updateWorkTask(task.id, { stateId: ids.backlog }, ids.tam);
    await updateWorkTask(task.id, { stateId: ids.brief }, ids.tam);
    expect(await boxes(task.id)).toHaveLength(3);

    // The task's own box is not the stage's business.
    await updateWorkTask(task.id, { checklist: ticked.map((item) => ({ id: item.id, text: item.text, done: item.checklistId ? true : item.done })) }, ids.tam);
    await updateWorkTask(task.id, { stateId: ids.ideation }, ids.tam);
    expect((await loadTask(task.id))!.work.stateId).toBe(ids.ideation);
  });

  it("holds a task that arrived before the checklist was hooked, until it is added and ticked", async () => {
    const { task } = await createWorkTask({ teamId: ids.video, title: "Clip 8/3", stateId: ids.ideation }, ids.long);
    await setStateChecklists(ids.ideation, [{ checklistId: ids.handoffList, required: true }]);
    const refused = (await failure(updateWorkTask(task.id, { stateId: ids.script }, ids.long))) as Error & { details: { missing: MissingCheck[] } };
    expect(refused.details.missing).toEqual([{ checklistId: ids.handoffList, checklistName: "Trước bàn giao", text: "Đã xuất file gốc" }]);
    // Cancelling needs no checklist.
    const cancelled = (await listStates([ids.video])).find((state) => state.category === "cancelled")!;
    await updateWorkTask(task.id, { stateId: cancelled.id }, ids.long);
    await setStateChecklists(ids.ideation, []);
  });

  it("a task sent back, or cancelled, cannot then jump past the stage that holds it", async () => {
    await setStateChecklists(ids.brief, [{ checklistId: ids.briefList, required: true }]);
    const { task } = await createWorkTask({ teamId: ids.video, title: "Clip 30/4", stateId: ids.brief }, ids.long);
    // Back a stage is allowed; jumping from there past the brief is not.
    await updateWorkTask(task.id, { stateId: ids.backlog }, ids.long);
    expect(await fails(updateWorkTask(task.id, { stateId: ids.script }, ids.long))).toBe("checklist_incomplete");
    // Nor is coming out of "cancelled" further down the flow.
    const cancelled = (await listStates([ids.video])).find((state) => state.category === "cancelled")!;
    await updateWorkTask(task.id, { stateId: cancelled.id }, ids.long);
    expect(await fails(updateWorkTask(task.id, { stateId: ids.design }, ids.long))).toBe("checklist_incomplete");
    // Ticked, it goes anywhere forward.
    await updateWorkTask(task.id, { checklist: (await boxes(task.id)).map((item) => ({ id: item.id, text: item.text, done: true })) }, ids.long);
    await updateWorkTask(task.id, { stateId: ids.design }, ids.long);
    expect((await loadTask(task.id))!.work.stateId).toBe(ids.design);
  });

  it("keeps a checklist on a task whole: one box of it cannot be dropped on its own", async () => {
    const { task } = await createWorkTask({ teamId: ids.video, title: "Clip 2/9", stateId: ids.backlog }, ids.long);
    await updateWorkTask(task.id, { addChecklistIds: [ids.briefList] }, ids.long);
    const [first] = await boxes(task.id);
    expect(await fails(updateWorkTask(task.id, { checklist: [{ id: first.id, text: first.text, done: true }] }, ids.long))).toBe("checklist_item_locked");
    await updateWorkTask(task.id, { checklist: [] }, ids.long);
    expect(await boxes(task.id)).toEqual([]);
  });

  it("a task made in the stage starts with its checklists", async () => {
    const { task } = await createWorkTask({ teamId: ids.video, title: "Clip Trung thu", stateId: ids.brief }, ids.long);
    expect((await boxes(task.id)).map((item) => item.checklistId)).toEqual([ids.briefList, ids.briefList]);
  });

  it("a retired checklist holds nobody", async () => {
    const { task } = await createWorkTask({ teamId: ids.video, title: "Clip Noel", stateId: ids.brief }, ids.long);
    await saveChecklist(ids.briefList, { name: "Nhận brief", description: null, ownerUnitId: null, ownerTeamId: ids.video, items: briefItems, isActive: false }, ids.long);
    await updateWorkTask(task.id, { stateId: ids.ideation }, ids.long);
    expect(await fails(setStateChecklists(ids.design, [{ checklistId: ids.briefList, required: false }]))).toBe("checklist_not_found");
    // A stage that already names it can still be edited around it.
    await setStateChecklists(ids.script, [{ checklistId: ids.handoffList, required: false }, { checklistId: ids.briefList, required: false }].slice(0, 1));
    await saveChecklist(ids.briefList, { name: "Nhận brief", description: null, ownerUnitId: null, ownerTeamId: ids.video, items: briefItems, isActive: true }, ids.long);
    await setStateChecklists(ids.script, [{ checklistId: ids.handoffList, required: false }, { checklistId: ids.briefList, required: false }]);
    await saveChecklist(ids.briefList, { name: "Nhận brief", description: null, ownerUnitId: null, ownerTeamId: ids.video, items: briefItems, isActive: false }, ids.long);
    await setStateChecklists(ids.script, [{ checklistId: ids.handoffList, required: true }, { checklistId: ids.briefList, required: false }]);
    await setStateChecklists(ids.script, []);
    await saveChecklist(ids.briefList, { name: "Nhận brief", description: null, ownerUnitId: null, ownerTeamId: ids.video, items: briefItems, isActive: true }, ids.long);
  });
});

describe("adding a checklist by hand", () => {
  it("appends it once; an unknown one is refused; a checklist that is not required can go as a whole", async () => {
    const { task } = await createWorkTask({ teamId: ids.video, title: "Post 1/6", stateId: ids.backlog }, ids.long);
    await updateWorkTask(task.id, { addChecklistIds: [ids.handoffList] }, ids.long);
    await updateWorkTask(task.id, { addChecklistIds: [ids.handoffList] }, ids.long);
    expect((await boxes(task.id)).map((item) => item.text)).toEqual(["Đã xuất file gốc"]);
    expect(await fails(updateWorkTask(task.id, { addChecklistIds: [crypto.randomUUID()] }, ids.long))).toBe("checklist_not_found");
    await updateWorkTask(task.id, { checklist: [] }, ids.long);
    expect(await boxes(task.id)).toEqual([]);
  });
});

describe("the other hook points", () => {
  it("a hand-off package asks for its library checklists as they stand, and records them ticked", async () => {
    await savePackage(ids.video, null, { name: "Script → Design", fromStateId: ids.script, toStateId: ids.design, fields: [], checklist: [{ text: "Đã chốt tone màu" }], checklistIds: [ids.handoffList], requireLink: false, requireFile: false, requireAccept: false, isActive: true }, ids.long);
    const { task } = await createWorkTask({ teamId: ids.video, title: "Clip 2/9", stateId: ids.script, assigneePersonId: ids.tam }, ids.long);
    const requirement = ((await failure(updateWorkTask(task.id, { stateId: ids.design }, ids.tam))) as Error & { details: { handoff: HandoffRequirement } }).details.handoff;
    expect(requirement.package.checklist.map((check) => check.text)).toEqual(["Đã chốt tone màu", "Đã xuất file gốc"]);
    const [own, library] = requirement.package.checklist.map((check) => check.id);
    expect(await fails(handOffStage(task.id, { toStateId: ids.design, values: {}, checked: [own], links: [], fileId: null, toPersonId: null, note: {} }, { personId: ids.tam, fullName: "tam" }))).toBe("handoff_incomplete");
    const { handoff } = await handOffStage(task.id, { toStateId: ids.design, values: {}, checked: [own, library], links: [], fileId: null, toPersonId: null, note: {} }, { personId: ids.tam, fullName: "tam" });
    expect(handoff!.checklist.map(({ text, done }) => [text, done])).toEqual([
      ["Đã chốt tone màu", true],
      ["Đã xuất file gốc", true],
    ]);
    // A package that asks only for a library checklist is a package.
    await savePackage(ids.video, null, { name: "Design → Edit", fromStateId: ids.design, toStateId: ids.script, fields: [], checklist: [], checklistIds: [ids.handoffList], requireLink: false, requireFile: false, requireAccept: false, isActive: true }, ids.long);
  });

  it("an intake form's requests start with its checklists", async () => {
    const { after: form } = await saveIntakeForm(ids.video, null, { name: "Yêu cầu video", description: null, projectId: null, audience: "entity", fields: [{ label: "Mục tiêu", type: "text", required: true }], checklistIds: [ids.briefList], isActive: true }, ids.long);
    expect(form.checklistIds).toEqual([ids.briefList]);
    const submitted = await submitIntake(form.id, { title: "Video tuyển dụng", answers: { f1: "Tuyển editor" } }, { personId: ids.tam, fullName: "tam" });
    expect((await boxes(submitted.taskId)).map((item) => item.checklistName)).toEqual(["Nhận brief", "Nhận brief"]);
  });

  it("a template step's task starts with the step's checklist, then those of the stage it starts in", async () => {
    const { after: template } = await saveWorkTemplate(null, { purpose: "work_task", name: "Một clip", description: null, ownerId: ids.video, isActive: true });
    await addWorkTemplateItem(template.id, { title: "Dựng clip", description: null, parentItemId: null, roleKey: null, dueOffsetDays: 3, estimateMinutes: null, sortOrder: 0, checklistIds: [ids.handoffList] });
    const { taskIds } = await applyTemplate({ templateId: template.id, anchor: { mode: "start", date: todayInVietnam() }, roles: {} }, ids.project, ids.long);
    // The step's task starts in the team's first open stage — Brief — which brings its own.
    expect((await boxes(taskIds[0])).map((item) => item.checklistName)).toEqual(["Trước bàn giao", "Nhận brief", "Nhận brief"]);
  });

  it("counts where each checklist is used, and removing one takes it off every hook but not off tasks", async () => {
    const usage = await checklistUsage();
    expect(usage.get(ids.handoffList)).toEqual({ stages: 0, packages: 2, forms: 0, steps: 1 });
    expect(usage.get(ids.briefList)).toEqual({ stages: 1, packages: 0, forms: 1, steps: 0 });

    const { task } = await createWorkTask({ teamId: ids.video, title: "Post 2/6", stateId: ids.backlog }, ids.long);
    await updateWorkTask(task.id, { addChecklistIds: [ids.handoffList] }, ids.long);
    await deleteChecklist(ids.handoffList);
    expect((await listChecklists()).map((row) => row.id)).not.toContain(ids.handoffList);
    const packages = await db().select({ checklistIds: schema.workHandoffPackage.checklistIds }).from(schema.workHandoffPackage).where(eq(schema.workHandoffPackage.teamId, ids.video));
    expect(packages.every((row) => row.checklistIds.length === 0)).toBe(true);
    const steps = await db().select({ checklistIds: schema.taskTemplateItem.checklistIds }).from(schema.taskTemplateItem);
    expect(steps.every((row) => !row.checklistIds.includes(ids.handoffList))).toBe(true);
    expect((await boxes(task.id)).map((item) => item.text)).toEqual(["Đã xuất file gốc"]);
  });
});
