// The work module's missing paths (Phase 12, R2; WRK-02), against a real Postgres (PGlite): a
// deleted task put back with what was deleted with it; a recurring task on a team's backlog, placed
// past days off and changed afterwards; saved filters on a backlog; a template step changed; a task
// moved under another without closing a loop.
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

import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { migrateTestDb } from "../../../tests/helpers/db";
import { workflow } from "../../../tests/helpers/workflows";
import { createProject } from "./projects";
import { createRecurrence, generateOccurrences, listRecurrences, updateRecurrence } from "./recurrences";
import { createWorkTask, deleteWorkTask, listActivity, listDeletedTasks, listLinkableTasks, listProjectTasks, listTeamBacklog, loadTask, RESTORE_WINDOW_DAYS, restoreWorkTask, updateWorkTask } from "./tasks";
import { createTeam, setTeamMember } from "./teams";
import { addWorkTemplateItem, saveWorkTemplate, updateWorkTemplateItem } from "./templates";
import { createSavedView, listSavedViews, updateSavedView } from "./views";

const ids = {} as Record<"szm" | "long" | "huy" | "video" | "project", string>;
const fails = (promise: Promise<unknown>) => promise.then(() => "no error", (error: Error) => error.message);
const task = async (title: string, extra: { parentTaskId?: string; projectId?: string | null } = {}) => (await createWorkTask({ teamId: ids.video, projectId: extra.projectId === undefined ? ids.project : extra.projectId, title, parentTaskId: extra.parentTaskId }, ids.long)).task;
const isDeleted = async (taskId: string) => !!(await db().select({ deletedAt: schema.task.deletedAt }).from(schema.task).where(eq(schema.task.id, taskId)))[0].deletedAt;

beforeAll(async () => {
  await migrateTestDb();
  const [szm] = await db().insert(schema.entity).values({ code: "SZM", legalName: "SuZu Media", shortName: "Media" }).returning();
  ids.szm = szm.id;
  for (const [key, name] of [["long", "Long Dang"], ["huy", "Huy Ho"]] as const) {
    const [row] = await db().insert(schema.person).values({ fullName: name, searchName: name.toLowerCase(), workEmail: `${key}@suzu.group`, status: "active", primaryEntityId: szm.id }).returning();
    ids[key] = row.id;
  }
  const video = await createTeam({ key: "VID", name: "Video Production", description: null, entityId: szm.id, departmentId: null, defaultVisibility: "team", isActive: true }, workflow("simple"), ids.long);
  ids.video = video.id;
  await setTeamMember(video.id, ids.huy, "member");
  ids.project = (await createProject({ teamId: video.id, name: "TVC Tết", description: null, clientId: null, status: "active", visibility: "team", leadPersonId: ids.long, startDate: null, dueDate: null }, ids.long)).id;
});

describe("a deleted task can be put back", () => {
  it("with the sub-tasks deleted with it — not one deleted on its own before — and only for a while", async () => {
    const parent = await task("Kịch bản");
    const child = await task("Lời thoại", { parentTaskId: parent.id });
    const earlier = await task("Bản nháp cũ", { parentTaskId: parent.id });
    await deleteWorkTask(earlier.id, ids.huy);
    // Deleted a minute before its parent: another deletion, which putting the parent back does not undo.
    await db().update(schema.task).set({ deletedAt: new Date(Date.now() - 60_000) }).where(eq(schema.task.id, earlier.id));
    await deleteWorkTask(parent.id, ids.long);

    // A sub-task deleted with its parent is no row of its own; one deleted before is.
    const listed = await listDeletedTasks({ projectId: ids.project });
    expect(listed.map((row) => [row.title, row.subtasks, row.deletedByName])).toEqual([
      ["Kịch bản", 1, "Long Dang"],
      ["Bản nháp cũ", 0, "Huy Ho"],
    ]);
    expect(await listDeletedTasks({ teamId: ids.video })).toEqual([]);

    expect(await fails(restoreWorkTask(parent.id, ids.long, new Date(Date.now() + (RESTORE_WINDOW_DAYS + 1) * 86_400_000)))).toBe("task_restore_too_late");
    expect((await restoreWorkTask(parent.id, ids.long)).restored).toBe(2);
    expect([await isDeleted(parent.id), await isDeleted(child.id), await isDeleted(earlier.id)]).toEqual([false, false, true]);
    expect((await listActivity(parent.id)).map((entry) => entry.type)).toContain("restored");
    expect((await listDeletedTasks({ projectId: ids.project })).map((row) => row.title)).toEqual(["Bản nháp cũ"]);
    expect(await fails(restoreWorkTask(parent.id, ids.long))).toBe("task_not_found");

    // Its parent is back: the old draft returns under it.
    await restoreWorkTask(earlier.id, ids.long);
    expect((await loadTask(earlier.id))!.task.parentTaskId).toBe(parent.id);
  });

  it("a sub-task whose parent is still deleted comes back at the top level", async () => {
    const parent = await task("Storyboard");
    const child = await task("Khung 1", { parentTaskId: parent.id });
    await deleteWorkTask(parent.id, ids.long);
    await restoreWorkTask(child.id, ids.long);
    expect(await isDeleted(parent.id)).toBe(true);
    expect((await loadTask(child.id))!.task.parentTaskId).toBeNull();
  });
});

describe("recurring tasks on a team's backlog", () => {
  it("need no project, move past a Sunday and a holiday, and change only what they make from now on", async () => {
    // 2026-10-04 is a Sunday and 5 October a holiday this year: the Sunday post is due on Tuesday the 6th.
    await db().insert(schema.calendarDay).values({ entityId: null, date: "2026-10-05", kind: "public_holiday", name: "Ngày lễ" });
    const { recurrence, made } = await createRecurrence(
      { projectId: null, teamId: ids.video, title: "Bài đăng Chủ nhật", rule: { freq: "weekly", interval: 1, weekdays: [7] }, startDate: "2026-10-01", endDate: null, leadDays: 7, onDayOff: "shift", draft: { assigneePersonId: ids.huy, estimateMinutes: 90 } },
      ids.long,
      "2026-10-01",
    );
    expect(made).toBe(1);
    const [made1] = (await listTeamBacklog(ids.video)).filter((row) => row.title === "Bài đăng Chủ nhật");
    expect(made1).toMatchObject({ dueDate: "2026-10-06", assigneePersonId: ids.huy, projectId: null });
    // The next one still to make: Sunday the 11th, due on Monday the 12th.
    expect((await listRecurrences({ teamId: ids.video }, "2026-10-01")).map((row) => [row.title, row.nextDate])).toEqual([["Bài đăng Chủ nhật", "2026-10-12"]]);
    expect(await listRecurrences({ projectId: ids.project }, "2026-10-01")).toEqual([]);
    expect(await fails(createRecurrence({ projectId: null, teamId: null, title: "x", rule: { freq: "daily", interval: 1 }, startDate: "2026-10-01", endDate: null, leadDays: 0, draft: {} }, ids.long, "2026-10-01"))).toBe("team_not_found");

    // Changed to Wednesdays, skipping days off: the next is made at once; what was made stays.
    const changed = await updateRecurrence(recurrence.id, { title: "Bài đăng giữa tuần", rule: { freq: "weekly", interval: 1, weekdays: [3] }, endDate: null, leadDays: 7, onDayOff: "skip", assigneePersonId: null, estimateMinutes: 60 }, "2026-10-01");
    expect(changed.made).toBe(1);
    const backlog = await listTeamBacklog(ids.video);
    expect(backlog.filter((row) => row.title === "Bài đăng Chủ nhật").map((row) => row.dueDate)).toEqual(["2026-10-06"]);
    expect(backlog.filter((row) => row.title === "Bài đăng giữa tuần").map((row) => [row.dueDate, row.assigneePersonId])).toEqual([["2026-10-07", null]]);
    expect(await generateOccurrences("2026-10-01")).toMatchObject({ made: 0 });
    expect(await fails(updateRecurrence(recurrence.id, { title: "x", rule: { freq: "weekly", interval: 1, weekdays: [] }, endDate: null, leadDays: 7, onDayOff: "skip", assigneePersonId: null, estimateMinutes: null }, "2026-10-01"))).toBe("recurrence_rule_invalid");
  });
});

describe("saved filters on a team's backlog", () => {
  it("belong to the backlog, apart from the project's, and can be renamed, refiltered and shared", async () => {
    const backlogView = await createSavedView({ teamId: ids.video, projectId: null, name: "Của tôi", filters: { assignee: "me" }, isShared: false }, ids.huy);
    await createSavedView({ teamId: ids.video, projectId: ids.project, name: "Dự án", filters: { assignee: "me" }, isShared: true }, ids.huy);
    expect((await listSavedViews({ teamId: ids.video }, ids.huy)).map((view) => view.name)).toEqual(["Của tôi"]);
    expect((await listSavedViews({ projectId: ids.project }, ids.long)).map((view) => view.name)).toEqual(["Dự án"]);
    // Not shared yet: nobody else sees it.
    expect(await listSavedViews({ teamId: ids.video }, ids.long)).toEqual([]);

    const { before, after } = await updateSavedView(backlogView.id, { name: "Việc gấp", filters: { assignee: "me", due: "overdue" }, isShared: true });
    expect(before.name).toBe("Của tôi");
    expect(after).toMatchObject({ name: "Việc gấp", filters: { assignee: "me", due: "overdue" }, isShared: true, teamId: ids.video, projectId: null });
    expect((await listSavedViews({ teamId: ids.video }, ids.long)).map((view) => view.name)).toEqual(["Việc gấp"]);
    expect(await fails(updateSavedView("00000000-0000-4000-8000-000000000000", { name: "x" }))).toBe("view_not_found");
  });
});

describe("a template step can be changed", () => {
  it("its text, role, day and place — keeping two levels", async () => {
    const { after: template } = await saveWorkTemplate(null, { purpose: "work_project", name: "Sản xuất video", description: null, ownerId: ids.video, isActive: true });
    const { after: other } = await saveWorkTemplate(null, { purpose: "work_project", name: "Khác", description: null, ownerId: ids.video, isActive: true });
    const pre = await addWorkTemplateItem(template.id, { title: "Tiền kỳ", description: null, parentItemId: null, roleKey: "producer", dueOffsetDays: 5, estimateMinutes: null, sortOrder: 0 });
    const script = await addWorkTemplateItem(template.id, { title: "Kịch bản", description: null, parentItemId: pre.id, roleKey: "copywriter", dueOffsetDays: 3, estimateMinutes: 480, sortOrder: 0 });
    const edit = await addWorkTemplateItem(template.id, { title: "Dựng", description: null, parentItemId: null, roleKey: "editor", dueOffsetDays: 12, estimateMinutes: null, sortOrder: 1 });
    const elsewhere = await addWorkTemplateItem(other.id, { title: "Bước khác", description: null, parentItemId: null, roleKey: null, dueOffsetDays: 0, estimateMinutes: null, sortOrder: 0 });

    const { after } = await updateWorkTemplateItem(script.id, { title: "Kịch bản & lời thoại", parentItemId: edit.id, roleKey: "writer", dueOffsetDays: 4, estimateMinutes: 600 });
    expect(after).toMatchObject({ title: "Kịch bản & lời thoại", parentItemId: edit.id, roleKey: "writer", assigneeRule: "role:writer", dueOffsetDays: 4, estimateMinutes: 600 });
    // A step with sub-steps cannot go under another; nor under itself, nor under another template's step.
    expect(await fails(updateWorkTemplateItem(edit.id, { title: "Dựng", parentItemId: pre.id, roleKey: "editor", dueOffsetDays: 12, estimateMinutes: null }))).toBe("template_too_deep");
    expect(await fails(updateWorkTemplateItem(pre.id, { title: "Tiền kỳ", parentItemId: pre.id, roleKey: null, dueOffsetDays: 5, estimateMinutes: null }))).toBe("template_parent_invalid");
    expect(await fails(updateWorkTemplateItem(pre.id, { title: "Tiền kỳ", parentItemId: elsewhere.id, roleKey: null, dueOffsetDays: 5, estimateMinutes: null }))).toBe("template_parent_invalid");
  });
});

describe("a task moved under another", () => {
  it("may go anywhere but under itself or its own sub-tasks, which the picker leaves out", async () => {
    const campaign = await task("Chiến dịch Tết");
    const video = await task("Video", { parentTaskId: campaign.id });
    const cut = await task("Bản dựng", { parentTaskId: video.id });
    const unrelated = await task("Ảnh bìa");

    expect(await fails(updateWorkTask(campaign.id, { parentTaskId: cut.id }, ids.long))).toBe("parent_cycle");
    expect(await fails(updateWorkTask(video.id, { parentTaskId: video.id }, ids.long))).toBe("parent_cycle");
    const choices = await listLinkableTasks({ projectId: ids.project, teamId: ids.video, subtreeOf: campaign.id });
    expect(choices.filter((row) => row.under).map((row) => row.title).sort()).toEqual(["Bản dựng", "Chiến dịch Tết", "Video"]);
    expect(choices.find((row) => row.id === unrelated.id)?.under).toBe(false);

    await updateWorkTask(cut.id, { parentTaskId: unrelated.id }, ids.long);
    expect((await listProjectTasks(ids.project)).find((row) => row.id === cut.id)?.parentTaskId).toBe(unrelated.id);
  });
});
