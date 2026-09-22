// Phase 10 on the task foundation, against a real Postgres (PGlite): custom fields, bulk edit,
// moves between teams with the old number still resolving, the triage queue from intake to a
// decision and the midnight wake-up, and blockers with their notices and blocked time.
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

import { and, eq, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { migrateTestDb } from "../../../tests/helpers/db";
import { blockedMinutes, listBlockersRaisedOn, listBlockersWaitingOn, listOpenBlockers, raiseBlocker, resolveBlocker } from "./blockers";
import { bulkEditTasks } from "./bulk";
import { listCustomFields, saveCustomField } from "./custom-fields";
import { saveIntakeForm, submitIntake } from "./intake";
import { getLeaderView, listMyWorkItems } from "./leader";
import { moveTaskToTeam } from "./move";
import { createProject } from "./projects";
import { loggedMinutesByTask } from "./table";
import { createWorkTask, listActivity, listProjectTasks, listTeamBacklog, loadTask, resolveTaskKey, searchTasks, updateWorkTask } from "./tasks";
import { addableMembers, createTeam, findTeam, listStates, saveLabel, setTeamMember, teamFacts } from "./teams";
import { acceptTriage, declineTriage, listTriage, listTriageForLead, mergeTriage, saveTriageRule, snoozeTriage, wakeSnoozedTriage } from "./triage";
import { viewerOfPerson } from "./viewer";

const ids = {} as Record<"szm" | "long" | "tam" | "huy" | "duc" | "khoi" | "video" | "social" | "project" | "socialProject" | "form" | "format" | "platform" | "editor" | "videoLabel" | "sharedLabel", string>;
const fails = (promise: Promise<unknown>) => promise.then(() => "no error", (error: Error & { details?: unknown }) => error.message);
const named = (key: "long" | "tam" | "huy" | "duc" | "khoi") => ({ personId: ids[key], fullName: key });
const noticesOf = async (personId: string, kind: string) => db().select().from(schema.notification).where(and(eq(schema.notification.recipientPersonId, personId), eq(schema.notification.kind, kind)));
const viewer = async (key: "long" | "tam" | "huy" | "duc" | "khoi") => (await viewerOfPerson(db(), ids[key]))!;

beforeAll(async () => {
  await migrateTestDb();
  const [szm] = await db().insert(schema.entity).values({ code: "SZM", legalName: "SuZu Media", shortName: "Media" }).returning();
  ids.szm = szm.id;
  for (const key of ["long", "tam", "huy", "duc", "khoi"] as const) {
    const [row] = await db().insert(schema.person).values({ fullName: key, searchName: key, workEmail: `${key}@suzu.group`, status: "active", primaryEntityId: szm.id }).returning();
    ids[key] = row.id;
  }
  const video = await createTeam({ key: "VID", name: "Video Production", description: null, entityId: szm.id, departmentId: null, defaultVisibility: "team", isActive: true }, "content", {}, ids.long);
  const social = await createTeam({ key: "SOC", name: "Social", description: null, entityId: szm.id, departmentId: null, defaultVisibility: "team", isActive: true }, "simple", {}, ids.khoi);
  Object.assign(ids, { video: video.id, social: social.id });
  await setTeamMember(video.id, ids.tam, "member");
  await setTeamMember(video.id, ids.huy, "member");
  await setTeamMember(social.id, ids.huy, "member");
  ids.project = (await createProject({ teamId: video.id, name: "TVC Tet", description: null, clientId: null, status: "active", visibility: "team", leadPersonId: ids.tam, startDate: null, dueDate: null }, ids.long)).id;
  ids.socialProject = (await createProject({ teamId: social.id, name: "Fanpage", description: null, clientId: null, status: "active", visibility: "team", leadPersonId: ids.khoi, startDate: null, dueDate: null }, ids.khoi)).id;
  ids.videoLabel = (await saveLabel(null, { teamId: video.id, name: "Gấp", color: "red" })).after.id;
  ids.sharedLabel = (await saveLabel(null, { teamId: null, name: "Tết", color: "orange" })).after.id;
});

describe("custom fields (FR-PJM-35)", () => {
  it("a team field and a project field; values checked, logged by name, cleared with a deleted option", async () => {
    const format = await saveCustomField({ teamId: ids.video, projectId: null }, null, { name: "Định dạng", type: "select", options: [{ label: "Reels" }, { label: "TVC" }, { label: "Story" }], showOnCard: true, sortOrder: 0, isActive: true }, ids.long);
    const platform = await saveCustomField({ teamId: ids.video, projectId: ids.project }, null, { name: "Nền tảng", type: "multi_select", options: [{ label: "Facebook" }, { label: "TikTok" }], showOnCard: false, sortOrder: 1, isActive: true }, ids.tam);
    const editor = await saveCustomField({ teamId: ids.video, projectId: null }, null, { name: "Người dựng", type: "person", options: [], showOnCard: false, sortOrder: 2, isActive: true }, ids.long);
    Object.assign(ids, { format: format.after.id, platform: platform.after.id, editor: editor.after.id });
    expect(await fails(saveCustomField({ teamId: ids.video, projectId: null }, null, { name: "Rỗng", type: "select", options: [], showOnCard: false, sortOrder: 0, isActive: true }, ids.long))).toBe("custom_field_needs_options");
    expect((await listCustomFields({ teamId: ids.video })).map((field) => field.name)).toEqual(["Định dạng", "Người dựng"]);
    expect((await listCustomFields({ teamId: ids.video, projectId: ids.project })).map((field) => field.name)).toEqual(["Định dạng", "Nền tảng", "Người dựng"]);

    const [reels, tvc] = format.after.options;
    const [facebook, tiktok] = platform.after.options;
    const { task } = await createWorkTask({ teamId: ids.video, projectId: ids.project, title: "Clip 20/10" }, ids.long);
    await updateWorkTask(task.id, { customValues: { [ids.format]: tvc.id, [ids.platform]: [tiktok.id, facebook.id], [ids.editor]: ids.huy } }, ids.tam);
    expect((await loadTask(task.id))!.work.customValues).toEqual({ [ids.format]: tvc.id, [ids.platform]: [facebook.id, tiktok.id], [ids.editor]: ids.huy });
    const logged = (await listActivity(task.id)).filter((entry) => entry.type === "custom_field_changed");
    expect(logged.map((entry) => entry.toValue)).toEqual(expect.arrayContaining([{ name: "Định dạng", value: "TVC" }, { name: "Nền tảng", value: "Facebook, TikTok" }, { name: "Người dựng", value: "huy" }]));

    // Wrong values, and fields the task does not have, are refused.
    expect(await fails(updateWorkTask(task.id, { customValues: { [ids.format]: "poster" } }, ids.tam))).toBe("custom_value_invalid");
    const backlogTask = (await createWorkTask({ teamId: ids.video, title: "Backlog" }, ids.long)).task;
    expect(await fails(updateWorkTask(backlogTask.id, { customValues: { [ids.platform]: [facebook.id] } }, ids.tam))).toBe("custom_field_not_found");
    // The type is fixed once made.
    expect(await fails(saveCustomField({ teamId: ids.video, projectId: null }, ids.format, { name: "Định dạng", type: "text", options: [], showOnCard: true, sortOrder: 0, isActive: true }, ids.long))).toBe("custom_field_type_locked");

    // Deleting the option "TVC" clears it from the task, and says so in its history.
    const saved = await saveCustomField({ teamId: ids.video, projectId: null }, ids.format, { name: "Định dạng", type: "select", options: [reels, { id: "", label: "Livestream" }], showOnCard: true, sortOrder: 0, isActive: true }, ids.long);
    expect(saved.cleared).toBe(1);
    expect(saved.after.options.map((option) => option.label)).toEqual(["Reels", "Livestream"]);
    expect((await loadTask(task.id))!.work.customValues[ids.format]).toBeUndefined();
    expect((await listActivity(task.id))[0]).toMatchObject({ type: "custom_field_changed", fromValue: { name: "Định dạng", value: "TVC" }, toValue: { name: "Định dạng", value: null } });
    const [row] = (await listProjectTasks(ids.project)).filter((item) => item.id === task.id);
    expect(row.customValues).toEqual({ [ids.platform]: [facebook.id, tiktok.id], [ids.editor]: ids.huy });
  });
});

describe("bulk edit (FR-PJM-36)", () => {
  it("applies to the tasks the viewer may edit and names the others", async () => {
    const mine = (await createWorkTask({ teamId: ids.video, projectId: ids.project, title: "Kịch bản", labelIds: [ids.videoLabel] }, ids.long)).task;
    const also = (await createWorkTask({ teamId: ids.video, projectId: ids.project, title: "Storyboard" }, ids.long)).task;
    const theirs = (await createWorkTask({ teamId: ids.social, title: "Lịch đăng bài" }, ids.khoi)).task;
    const privateProject = await createProject({ teamId: ids.video, name: "Pitch", description: null, clientId: null, status: "active", visibility: "private", leadPersonId: ids.long, startDate: null, dueDate: null }, ids.long);
    const secret = (await createWorkTask({ teamId: ids.video, projectId: privateProject.id, title: "Pitch deck" }, ids.long)).task;
    const inProgress = (await listStates([ids.video])).find((state) => state.category === "in_progress")!;

    const outcome = await bulkEditTasks(await viewer("huy"), [mine.id, also.id, theirs.id, secret.id], { stateId: inProgress.id, assigneePersonId: ids.huy, dueDate: "2026-10-01", addLabelIds: [ids.sharedLabel], removeLabelIds: [ids.videoLabel], customValues: { [ids.editor]: ids.tam } }, ids.huy);
    expect(outcome.updated.map((row) => row.key).sort()).toEqual(["VID-3", "VID-4"]);
    // Huy works in Social too, but a Video state is not in Social's workflow. The private pitch is
    // not his to see at all: it answers as if it were not there, with no task key to read off.
    expect(outcome.refused).toEqual([
      { id: theirs.id, key: "SOC-1", reason: "state_not_found" },
      { id: secret.id, key: null, reason: "task_not_found" },
    ]);
    const after = (await loadTask(mine.id))!;
    expect([after.work.stateId, after.task.assigneePersonId, after.task.dueDate, after.work.customValues[ids.editor]]).toEqual([inProgress.id, ids.huy, "2026-10-01", ids.tam]);
    const labels = await db().select().from(schema.workTaskLabel).where(eq(schema.workTaskLabel.taskId, mine.id));
    expect(labels.map((label) => label.labelId)).toEqual([ids.sharedLabel]);
    expect((await loadTask(theirs.id))!.task.assigneePersonId).toBeNull();
    expect((await loadTask(secret.id))!.task.dueDate).toBeNull();
  });
});

describe("moving a task between teams (FR-PJM-34)", () => {
  it("takes its sub-tasks, maps states by category, renumbers, keeps history and the old number", async () => {
    const states = await listStates([ids.video]);
    const review = states.find((state) => state.category === "in_review")!;
    const parent = (await createWorkTask({ teamId: ids.video, title: "Epic: Tết campaign" }, ids.long)).task;
    const root = (await createWorkTask({ teamId: ids.video, projectId: ids.project, title: "Bộ post Tết", stateId: review.id, labelIds: [ids.videoLabel, ids.sharedLabel], parentTaskId: parent.id }, ids.long)).task;
    const child = (await createWorkTask({ teamId: ids.video, title: "Post 1", parentTaskId: root.id }, ids.long)).task;
    const [rootKey, childKey] = [(await loadTask(root.id))!, (await loadTask(child.id))!].map((loaded) => `VID-${loaded.work.number}`);

    const huy = await viewer("huy");
    expect(await fails(moveTaskToTeam(root.id, { teamId: ids.social, projectId: ids.project }, ids.huy))).toBe("project_not_found");
    const result = await moveTaskToTeam(root.id, { teamId: ids.social, projectId: ids.socialProject }, ids.huy);
    expect(result.moved.map((row) => [row.fromKey, row.toKey])).toEqual([[rootKey, "SOC-2"], [childKey, "SOC-3"]]);

    const [movedRoot, movedChild] = [(await loadTask(root.id))!, (await loadTask(child.id))!];
    const socialStates = await listStates([ids.social]);
    expect(socialStates.find((state) => state.id === movedRoot.work.stateId)!.category).toBe("in_review");
    expect(socialStates.find((state) => state.id === movedChild.work.stateId)!.category).toBe("todo");
    expect([movedRoot.work.teamId, movedRoot.work.projectId, movedRoot.task.parentTaskId, movedChild.task.parentTaskId, movedChild.work.projectId]).toEqual([ids.social, ids.socialProject, null, root.id, ids.socialProject]);
    const labels = await db().select().from(schema.workTaskLabel).where(eq(schema.workTaskLabel.taskId, root.id));
    expect(labels.map((label) => label.labelId)).toEqual([ids.sharedLabel]);
    expect((await listActivity(root.id)).map((entry) => entry.type)).toEqual(expect.arrayContaining(["moved", "created"]));

    // The old number still finds it — by lookup and in the command palette.
    expect(await resolveTaskKey(rootKey)).toBe(root.id);
    expect(await resolveTaskKey("SOC-2")).toBe(root.id);
    expect(await resolveTaskKey(childKey.toLowerCase())).toBe(child.id);
    expect((await searchTasks(huy, rootKey)).map((hit) => [hit.id, hit.key])).toEqual([[root.id, "SOC-2"]]);
    expect(await fails(moveTaskToTeam(root.id, { teamId: ids.social, projectId: null }, ids.huy))).toBe("move_same_team");
  });
});

describe("triage (FR-PJM-32)", () => {
  it("intake lands in triage with the rules applied, out of the lists and everyone's My work; the leads have it", async () => {
    const { after: form } = await saveIntakeForm(ids.video, null, { name: "Yêu cầu quay dựng", description: null, projectId: null, audience: "entity", fields: [{ label: "Nội dung", type: "long_text", required: true }], isActive: true }, ids.long);
    ids.form = form.id;
    expect(await fails(saveTriageRule(ids.video, null, { name: "Trống", match: {}, set: {}, sortOrder: 0, isActive: true }, ids.long))).toBe("triage_rule_sets_nothing");
    expect(await fails(saveTriageRule(ids.video, null, { name: "Người ngoài", match: {}, set: { assigneePersonId: ids.khoi }, sortOrder: 0, isActive: true }, ids.long))).toBe("person_not_found");
    await saveTriageRule(ids.video, null, { name: "Video từ form", match: { source: "intake", intakeFormId: form.id }, set: { assigneePersonId: ids.huy, labelIds: [ids.videoLabel] }, sortOrder: 0, isActive: true }, ids.long);
    await saveTriageRule(ids.video, null, { name: "TikTok gấp", match: { keyword: "tiktok" }, set: { priority: 1, projectId: ids.project }, sortOrder: 1, isActive: true }, ids.long);

    const sent = await submitIntake(form.id, { title: "Clip TikTok 20/10", answers: { f1: "Quay clip ngắn" } }, named("duc"));
    const loaded = (await loadTask(sent.taskId))!;
    expect(loaded.work).toMatchObject({ triageStatus: "pending", triageSource: "intake", projectId: ids.project });
    expect(loaded.task).toMatchObject({ assigneePersonId: ids.huy, priority: 1 });
    expect(await noticesOf(ids.huy, "tasks.work_assigned")).toHaveLength(0);
    expect(await noticesOf(ids.long, "tasks.intake_submitted")).toHaveLength(1);

    expect((await listTriage(ids.video, await viewer("long"))).map((item) => [item.key, item.source, item.formName])).toEqual([[sent.key, "intake", "Yêu cầu quay dựng"]]);
    expect((await listTriageForLead(ids.long)).map((item) => item.id)).toEqual([sent.taskId]);
    expect(await listTriageForLead(ids.huy)).toEqual([]);
    expect((await listMyWorkItems(ids.huy)).some((item) => item.id === sent.taskId)).toBe(false);
    expect((await getLeaderView(await viewer("long"), "2026-09-22")).people.flatMap((person) => person.tasks).some((task) => task.id === sent.taskId)).toBe(false);
    // In the project's list, flagged so the list filters it out until asked.
    expect((await listProjectTasks(ids.project)).find((item) => item.id === sent.taskId)!.triageStatus).toBe("pending");

    // Accepted: it joins the lists, and the person pre-filled by the rule now hears of it.
    await acceptTriage(sent.taskId, { assigneePersonId: ids.huy, projectId: ids.project, dueDate: "2026-10-15", priority: 2 }, named("long"));
    const accepted = (await loadTask(sent.taskId))!;
    expect([accepted.work.triageStatus, accepted.work.triageDecidedByPersonId, accepted.task.dueDate, accepted.task.priority]).toEqual(["accepted", ids.long, "2026-10-15", 2]);
    expect(await noticesOf(ids.huy, "tasks.work_assigned")).toHaveLength(1);
    expect((await listMyWorkItems(ids.huy)).some((item) => item.id === sent.taskId)).toBe(true);
    expect(await fails(acceptTriage(sent.taskId, { assigneePersonId: null, projectId: null, dueDate: null, priority: null }, named("long")))).toBe("triage_not_pending");
  });

  it("declines with a reason the requester can read, and tells them", async () => {
    const sent = await submitIntake(ids.form, { title: "Poster khai trương", answers: { f1: "Không phải việc của team Video" } }, named("duc"));
    await declineTriage(sent.taskId, "Nhờ team Design làm giúp.", named("long"));
    const loaded = (await loadTask(sent.taskId))!;
    expect([loaded.work.triageStatus, loaded.work.triageNote, loaded.task.status]).toEqual(["declined", "Nhờ team Design làm giúp.", "cancelled"]);
    const [comment] = await db().select().from(schema.workComment).where(eq(schema.workComment.taskId, sent.taskId));
    expect(comment.body).toBe("Nhờ team Design làm giúp.");
    expect((await noticesOf(ids.duc, "tasks.status_changed")).length).toBe(1);
  });

  it("merges into an existing task: brief copied, linked, requester follows, request cancelled", async () => {
    const existing = (await createWorkTask({ teamId: ids.video, title: "Clip khai trương" }, ids.long)).task;
    const sent = await submitIntake(ids.form, { title: "Thêm cảnh khai trương", answers: { f1: "Quay thêm cảnh cắt băng" } }, named("duc"));
    await mergeTriage(sent.taskId, existing.id, named("long"));
    expect((await loadTask(sent.taskId))!.work.triageStatus).toBe("merged");
    const into = (await loadTask(existing.id))!;
    expect(into.followerIds).toContain(ids.duc);
    const [comment] = await db().select().from(schema.workComment).where(eq(schema.workComment.taskId, existing.id));
    expect(comment.body).toContain("Quay thêm cảnh cắt băng");
    const [link] = await db().select().from(schema.workTaskDependency).where(eq(schema.workTaskDependency.blockedTaskId, sent.taskId));
    expect([link.blockerTaskId, link.type]).toEqual([existing.id, "relates"]);
  });

  it("snoozes until a date; midnight on that date puts it back and tells the leads", async () => {
    const sent = await submitIntake(ids.form, { title: "Clip Noel", answers: { f1: "Để tháng 11 tính" } }, named("duc"));
    expect(await fails(snoozeTriage(sent.taskId, "2026-09-22", ids.long, "2026-09-22"))).toBe("triage_snooze_date");
    await snoozeTriage(sent.taskId, "2026-11-01", ids.long, "2026-09-22");
    expect((await listTriageForLead(ids.long)).some((item) => item.id === sent.taskId)).toBe(false);
    expect((await listTriage(ids.video, await viewer("long"))).find((item) => item.id === sent.taskId)).toMatchObject({ triageStatus: "snoozed", snoozedUntil: "2026-11-01" });
    const before = (await noticesOf(ids.long, "tasks.triage_new")).length;
    expect(await wakeSnoozedTriage("2026-10-31")).toEqual({ woken: 0 });
    expect(await wakeSnoozedTriage("2026-11-01")).toEqual({ woken: 1 });
    expect(await wakeSnoozedTriage("2026-11-01")).toEqual({ woken: 0 });
    expect((await loadTask(sent.taskId))!.work).toMatchObject({ triageStatus: "pending", triageSnoozedUntil: null });
    expect((await noticesOf(ids.long, "tasks.triage_new")).length).toBe(before + 1);
    expect(await listTeamBacklog(ids.video)).toEqual(expect.arrayContaining([expect.objectContaining({ id: sent.taskId, triageStatus: "pending" })]));
  });
});

describe("blockers (FR-PJM-28)", () => {
  it("one open blocker per task; the person needed and the leads hear; the raiser hears it resolved; time is measured", async () => {
    const { task } = await createWorkTask({ teamId: ids.video, projectId: ids.project, title: "Dựng bản cuối", assigneePersonId: ids.huy }, ids.long);
    const { blocker } = await raiseBlocker(task.id, { reason: "Chờ nhạc nền được duyệt", neededPersonId: ids.tam }, named("huy"));
    expect(await fails(raiseBlocker(task.id, { reason: "Lần nữa", neededPersonId: null }, named("huy")))).toBe("blocker_already_open");
    expect((await noticesOf(ids.tam, "tasks.blocked")).length).toBe(1);
    expect((await noticesOf(ids.long, "tasks.blocked")).length).toBe(1);
    expect((await noticesOf(ids.huy, "tasks.blocked")).length).toBe(0);

    expect((await listOpenBlockers([task.id])).map((row) => [row.reason, row.neededName, row.raisedByName])).toEqual([["Chờ nhạc nền được duyệt", "tam", "huy"]]);
    expect((await listBlockersWaitingOn(ids.tam)).map((row) => row.taskId)).toEqual([task.id]);
    const today = (await db().execute(sql`select (now() at time zone 'Asia/Ho_Chi_Minh')::date::text as day`)) as unknown as { rows: { day: string }[] };
    expect((await listBlockersRaisedOn(ids.huy, today.rows[0].day)).map((row) => row.key)).toHaveLength(1);
    expect((await listProjectTasks(ids.project)).find((item) => item.id === task.id)!.blocker).toMatchObject({ reason: "Chờ nhạc nền được duyệt", neededName: "tam" });
    const lead = await getLeaderView(await viewer("long"), "2026-09-22");
    expect(lead.totals.blocked).toBe(1);
    expect(lead.people.find((person) => person.personId === ids.huy)!.tasks[0].id).toBe(task.id);

    await resolveBlocker(task.id, "Khách đã duyệt bản nhạc 2", named("tam"));
    expect((await noticesOf(ids.huy, "tasks.unblocked")).length).toBe(1);
    expect(await listOpenBlockers([task.id])).toEqual([]);
    expect(await fails(resolveBlocker(task.id, null, named("tam")))).toBe("blocker_not_open");
    // Ninety minutes blocked, then a second blocker open for thirty so far.
    await db().update(schema.workBlocker).set({ raisedAt: sql`resolved_at - interval '90 minutes'` }).where(eq(schema.workBlocker.id, blocker.id));
    const second = await raiseBlocker(task.id, { reason: "Máy dựng hỏng", neededPersonId: null }, named("huy"));
    await db().update(schema.workBlocker).set({ raisedAt: sql`now() - interval '30 minutes'` }).where(eq(schema.workBlocker.id, second.blocker.id));
    expect((await blockedMinutes([task.id])).get(task.id)).toBe(120);
    expect((await listActivity(task.id)).map((entry) => entry.type)).toEqual(expect.arrayContaining(["blocker_raised", "blocker_resolved"]));
  });

  it("logged minutes are summed per task in SQL, deleted entries left out", async () => {
    const { task } = await createWorkTask({ teamId: ids.video, projectId: ids.project, title: "Quay" }, ids.long);
    const entry = { personId: ids.huy, date: "2026-09-21", weekStart: "2026-09-21", taskId: task.id, projectId: ids.project };
    await db().insert(schema.timeEntry).values([{ ...entry, minutes: 90 }, { ...entry, minutes: 45 }, { ...entry, minutes: 600, deletedAt: new Date() }]);
    expect((await loggedMinutesByTask([task.id])).get(task.id)).toBe(135);
  });
});

describe("putting somebody in a team", () => {
  it("offers a lead only the people they may add, and tells whoever is added", async () => {
    const [szc] = await db().insert(schema.entity).values({ code: "SZC", legalName: "SuZu Creative", shortName: "Creative" }).returning();
    const [outsider] = await db().insert(schema.person).values({ fullName: "ngoai", searchName: "ngoai", workEmail: "ngoai@suzu.group", status: "active", primaryEntityId: szc.id }).returning();
    const [gone] = await db().insert(schema.person).values({ fullName: "cu", searchName: "cu", status: "offboarded", primaryEntityId: ids.szm }).returning();
    const lead = await viewer("long");
    const video = teamFacts((await findTeam(ids.video))!);

    // Video belongs to SuZu Media: its lead reaches that entity's people and nobody else's.
    const offered = await addableMembers(lead, video);
    expect(offered.people.map((person) => person.id)).toContain(ids.duc);
    expect(offered.people.map((person) => person.id)).not.toContain(outsider.id);
    expect(offered.people.map((person) => person.id)).not.toContain(gone.id);
    expect(offered.narrowed).toBe(true);
    // A leader whose grant covers the whole group reaches everybody, and the page says nothing.
    const owner = { ...lead, principal: { ...lead.principal, grants: [{ role: "owner" as const, scope: { type: "group" as const } }] } };
    const all = await addableMembers(owner, video);
    expect(all.people.map((person) => person.id)).toContain(outsider.id);
    expect(all.narrowed).toBe(false);

    // Being put in a team is news. A role change is not, and nobody is told about themselves.
    await setTeamMember(ids.video, ids.duc, "member", ids.long);
    expect(await noticesOf(ids.duc, "tasks.team_added")).toHaveLength(1);
    await setTeamMember(ids.video, ids.duc, "lead", ids.long);
    expect(await noticesOf(ids.duc, "tasks.team_added")).toHaveLength(1);
    await setTeamMember(ids.video, ids.khoi, "member", ids.khoi);
    expect(await noticesOf(ids.khoi, "tasks.team_added")).toHaveLength(0);
    // A seed has no actor, so it tells nobody.
    await setTeamMember(ids.social, ids.duc, "member");
    expect(await noticesOf(ids.duc, "tasks.team_added")).toHaveLength(1);
  });
});
