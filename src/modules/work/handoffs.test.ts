// Hand-offs and cycles (FR-PJM-40..46, 10) against a real Postgres (PGlite): the transition gate
// from refusal to acceptance or return, cross-team work through triage, leave cover from a leave
// request to hand-back, the exit handover gate on the offboarding step, account handover, and the
// cycle job's rollover — each run twice where a job must be idempotent.
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
import { setTaskStatus } from "../platform/tasks-engine/service";
import { bulkEditTasks } from "./bulk";
import { acknowledgeCover, getCoverPlan, getCoverPlanForLeave, handBackCover, listCoverPlansFor, submitCoverPlan, syncCoverPlans } from "./cover";
import { getCyclePage, runCycles } from "./cycles";
import { getExitHandover, listOwnership, reassignOwnership, syncExitHandovers } from "./exit";
import type { HandoffRequirement } from "./handoff-gate";
import { acceptHandoff, changeAccountManager, handoffReturnsByTask, handoffStatsByStage, handOffStage, listPendingHandoffsFor, listTaskHandoffs, returnHandoff, savePackage, sendToTeam } from "./handoffs";
import { createProject, setProjectMember } from "./projects";
import { getLeaderView } from "./leader";
import { createWorkTask, listProjectTasks, loadTask, updateWorkTask } from "./tasks";
import { createTeam, listStates, saveClient, setTeamMember } from "./teams";
import { acceptTriage, declineTriage } from "./triage";
import { viewerOfPerson } from "./viewer";

type Key = "long" | "tam" | "huy" | "bao" | "lan" | "khoi";
const ids = {} as Record<Key | "szm" | "video" | "social" | "project" | "client" | "script" | "design" | "edit" | "leaveType", string>;
const fails = (promise: Promise<unknown>) => promise.then(() => "no error", (error: Error) => error.message);
const failure = (promise: Promise<unknown>) => promise.then(() => null, (error: Error & { details?: unknown }) => error);
const actor = (key: Key) => ({ personId: ids[key], fullName: key });
const viewer = async (key: Key) => (await viewerOfPerson(db(), ids[key]))!;
const noticesOf = async (key: Key, kind: string) => db().select().from(schema.notification).where(and(eq(schema.notification.recipientPersonId, ids[key]), eq(schema.notification.kind, kind)));
const TODAY = todayInVietnam();

beforeAll(async () => {
  await migrateTestDb();
  const [szm] = await db().insert(schema.entity).values({ code: "SZM", legalName: "SuZu Media", shortName: "Media" }).returning();
  ids.szm = szm.id;
  for (const key of ["long", "tam", "huy", "bao", "lan", "khoi"] as const) {
    const [row] = await db().insert(schema.person).values({ fullName: key, searchName: key, workEmail: `${key}@suzu.group`, status: "active", primaryEntityId: szm.id }).returning();
    ids[key] = row.id;
  }
  await db().update(schema.person).set({ managerId: ids.long }).where(eq(schema.person.id, ids.huy));
  const video = await createTeam({ key: "VID", name: "Video Production", description: null, entityId: szm.id, departmentId: null, defaultVisibility: "team", isActive: true }, "content", {}, ids.long);
  const social = await createTeam({ key: "SOC", name: "Social", description: null, entityId: szm.id, departmentId: null, defaultVisibility: "team", isActive: true }, "simple", {}, ids.khoi);
  Object.assign(ids, { video: video.id, social: social.id });
  for (const key of ["tam", "huy", "bao", "lan"] as const) await setTeamMember(video.id, ids[key], "member");
  const client = await saveClient(null, { code: "VNM", name: "Vinamilk", kind: "client", parentId: null, entityId: szm.id, note: null, isActive: true });
  ids.client = client.after.id;
  ids.project = (await createProject({ teamId: video.id, name: "TVC Tết", description: null, clientId: ids.client, status: "active", visibility: "team", leadPersonId: ids.tam, startDate: null, dueDate: null }, ids.long)).id;
  const states = await listStates([video.id]);
  Object.assign(ids, { script: states.find((state) => state.name.includes("script") || state.sortOrder === 3)!.id });
  // The content preset: backlog, brief, ideation, script, design, edit, internal review, client review…
  const byOrder = [...states].sort((a, b) => a.sortOrder - b.sortOrder);
  Object.assign(ids, { script: byOrder[3].id, design: byOrder[4].id, edit: byOrder[5].id });
  const [type] = await db().insert(schema.leaveType).values({ code: "AL", name: "Annual", category: "annual", isPaid: true, payrollTreatment: "paid_company" }).returning();
  ids.leaveType = type.id;
});

describe("stage hand-off packages (FR-PJM-40, 41, 43)", () => {
  it("refuses the move with what the sheet needs, then hands off, and the receiver accepts", async () => {
    await savePackage(ids.video, null, { name: "Script → Design", fromStateId: ids.script, toStateId: ids.design, fields: [{ label: "Bản kịch bản đã duyệt", type: "text", required: true }, { label: "Link brand assets", type: "url", required: true }], checklist: [{ text: "Đã chốt tone màu" }], requireLink: false, requireFile: false, requireAccept: true, isActive: true }, ids.long);
    expect(await fails(savePackage(ids.video, null, { name: "Vòng lặp", fromStateId: ids.edit, toStateId: ids.edit, fields: [], checklist: [], requireLink: false, requireFile: false, requireAccept: true, isActive: true }, ids.long))).toBe("handoff_package_same_state");
    const { task } = await createWorkTask({ teamId: ids.video, projectId: ids.project, title: "Clip 20/10", stateId: ids.script, assigneePersonId: ids.tam }, ids.long);

    // Every path that changes the state meets the gate: the task page, the board, bulk edit.
    const refused = (await failure(updateWorkTask(task.id, { stateId: ids.design }, ids.tam))) as Error & { details: { handoff: HandoffRequirement } };
    expect(refused.message).toBe("handoff_required");
    expect(refused.details.handoff).toMatchObject({ taskKey: "VID-1", fromStateId: ids.script, toStateId: ids.design, package: { name: "Script → Design", requireAccept: true }, defaultReceiverId: null });
    expect(refused.details.handoff.receivers.map((person) => person.id)).not.toContain(ids.tam);
    const bulk = await bulkEditTasks(await viewer("tam"), [task.id], { stateId: ids.design }, ids.tam);
    expect(bulk.refused).toMatchObject([{ id: task.id, reason: "handoff_required", details: { handoff: { toStateId: ids.design } } }]);
    expect((await loadTask(task.id))!.work.stateId).toBe(ids.script);

    const [versionKey, assetsKey] = refused.details.handoff.package.fields.map((field) => field.key);
    const checkId = refused.details.handoff.package.checklist[0].id;
    const incomplete = (await failure(handOffStage(task.id, { toStateId: ids.design, values: { [versionKey]: "v3" }, checked: [], links: [], fileId: null, toPersonId: ids.huy, note: {} }, actor("tam")))) as Error & { details: { missing: unknown[] } };
    expect(incomplete.message).toBe("handoff_incomplete");
    expect(incomplete.details.missing).toEqual([{ kind: "field", key: assetsKey, label: "Link brand assets" }, { kind: "check", id: checkId, text: "Đã chốt tone màu" }]);
    expect(await fails(handOffStage(task.id, { toStateId: ids.design, values: { [versionKey]: "v3", [assetsKey]: "https://drive.google.com/brand" }, checked: [checkId], links: [], fileId: null, toPersonId: null, note: {} }, actor("tam")))).toBe("handoff_receiver_required");

    const { handoff } = await handOffStage(task.id, { toStateId: ids.design, values: { [versionKey]: "v3", [assetsKey]: "https://drive.google.com/brand", smuggled: "x" }, checked: [checkId], links: [], fileId: null, toPersonId: ids.huy, note: { context: "Clip chúc mừng 20/10", next: "Thiết kế key visual", links: ["https://drive.google.com/brief"] } }, actor("tam"));
    expect(handoff).toMatchObject({ status: "pending", kind: "stage", toPersonId: ids.huy, packageValues: { [versionKey]: "v3", [assetsKey]: "https://drive.google.com/brand" } });
    // Moved on; still the sender's until the receiver takes it.
    const moved = (await loadTask(task.id))!;
    expect([moved.work.stateId, moved.task.assigneePersonId]).toEqual([ids.design, ids.tam]);
    expect(await noticesOf("huy", "tasks.handoff_received")).toHaveLength(1);
    expect((await listPendingHandoffsFor(ids.huy)).map((row) => row.key)).toEqual(["VID-1"]);

    await acceptHandoff(handoff!.id, actor("huy"));
    expect((await loadTask(task.id))!.task.assigneePersonId).toBe(ids.huy);
    expect(await noticesOf("tam", "tasks.handoff_accepted")).toHaveLength(1);
    const [view] = await listTaskHandoffs(task.id, await viewer("long"));
    expect(view).toMatchObject({ status: "accepted", fromName: "tam", toName: "huy", fromStateName: expect.any(String), packageName: "Script → Design", note: { context: "Clip chúc mừng 20/10", next: "Thiết kế key visual", links: ["https://drive.google.com/brief"] } });
    expect(await fails(acceptHandoff(handoff!.id, actor("huy")))).toBe("handoff_not_pending");
  });

  it("a returned hand-off goes back to its state and sender, and counts per task and per stage", async () => {
    const { task } = await createWorkTask({ teamId: ids.video, projectId: ids.project, title: "Clip 8/3", stateId: ids.script, assigneePersonId: ids.tam }, ids.long);
    const requirement = ((await failure(updateWorkTask(task.id, { stateId: ids.design }, ids.tam))) as Error & { details: { handoff: HandoffRequirement } }).details.handoff;
    const values = Object.fromEntries(requirement.package.fields.map((field) => [field.key, field.type === "url" ? "https://drive.google.com/x" : "v1"]));
    const { handoff } = await handOffStage(task.id, { toStateId: ids.design, values, checked: requirement.package.checklist.map((check) => check.id), links: [], fileId: null, toPersonId: ids.bao, note: { context: "Clip 8/3" } }, actor("tam"));
    await returnHandoff(handoff!.id, "Thiếu logo mới của khách", actor("bao"));
    const back = (await loadTask(task.id))!;
    expect([back.work.stateId, back.task.assigneePersonId]).toEqual([ids.script, ids.tam]);
    const [returned] = await noticesOf("tam", "tasks.handoff_returned");
    expect(returned.params).toMatchObject({ actor: "bao", reason: "Thiếu logo mới của khách" });

    expect(await handoffReturnsByTask([task.id])).toEqual(new Map([[task.id, 1]]));
    const [stage] = await handoffStatsByStage([ids.video], new Date(Date.now() - 86_400_000));
    expect(stage).toMatchObject({ toStateId: ids.design, total: 2, returned: 1, pending: 0 });
    expect(stage.avgWaitMinutes).toBe(0);
  });
});

describe("cross-team hand-off (FR-PJM-42)", () => {
  it("a linked follow-on task waits in the other team's triage; the lead's accept completes the hand-off, a decline returns it", async () => {
    const { task } = await createWorkTask({ teamId: ids.video, projectId: ids.project, title: "Video Tết", assigneePersonId: ids.tam }, ids.long);
    expect(await fails(sendToTeam(task.id, { teamId: ids.social, title: "Đăng video Tết", dueDate: null, note: {} }, actor("tam")))).toBe("handoff_note_required");
    const { handoff, target } = await sendToTeam(task.id, { teamId: ids.social, title: "Đăng video Tết", dueDate: "2027-01-20", note: { context: "Video đã duyệt", next: "Lên lịch đăng", links: ["https://drive.google.com/final"] } }, actor("tam"));
    const receiving = (await loadTask(target.id))!;
    expect(receiving.work).toMatchObject({ teamId: ids.social, triageStatus: "pending", triageSource: "handoff", clientId: ids.client });
    expect(receiving.task.description).toContain("Lên lịch đăng");
    const [link] = await db().select().from(schema.workTaskDependency).where(eq(schema.workTaskDependency.blockedTaskId, target.id));
    expect(link).toMatchObject({ blockerTaskId: task.id, type: "relates" });
    expect(await noticesOf("khoi", "tasks.triage_new")).toHaveLength(1);

    // The sender sees the receiving task's status — not its title, which is another team's.
    const [before] = await listTaskHandoffs(task.id, await viewer("tam"));
    expect(before).toMatchObject({ kind: "cross_team", status: "pending", toTeamName: "Social", target: { id: target.id, triageStatus: "pending", status: "todo" } });
    expect(await fails(acceptHandoff(handoff.id, actor("khoi")))).toBe("handoff_via_triage");

    await acceptTriage(target.id, { assigneePersonId: ids.khoi, projectId: null, dueDate: "2027-01-20", priority: null }, actor("khoi"));
    const [after] = await listTaskHandoffs(task.id, await viewer("tam"));
    expect(after).toMatchObject({ status: "accepted", respondedByName: "khoi", target: { triageStatus: "accepted" } });
    expect(await noticesOf("tam", "tasks.handoff_accepted")).toHaveLength(2);

    const second = await sendToTeam(task.id, { teamId: ids.social, title: "Thêm bản dọc", dueDate: null, note: { context: "Cần bản 9:16" } }, actor("tam"));
    await declineTriage(second.target.id, "Không có trong phạm vi hợp đồng", actor("khoi"));
    const history = await listTaskHandoffs(task.id, await viewer("tam"));
    expect(history.find((row) => row.id === second.handoff.id)).toMatchObject({ status: "returned", returnReason: "Không có trong phạm vi hợp đồng" });
  });
});

describe("leave cover (FR-PJM-44)", () => {
  const from = addDays(TODAY, 10);
  const to = addDays(TODAY, 14);
  const leave = async (key: Key, start: string, end: string, status: "approved" | "pending", days: number) => {
    const [request] = await db().insert(schema.leaveRequest).values({ personId: ids[key], entityId: ids.szm, leaveTypeId: ids.leaveType, startDate: start, endDate: end, totalCenti: days * 100, status }).returning();
    await db().insert(schema.leaveRequestDay).values(Array.from({ length: days }, (_, index) => ({ requestId: request.id, personId: ids[key], date: addDays(start, index), portion: "full" as const, amountCenti: 100 })));
    return request.id;
  };

  it("drafts a plan from a long enough leave, reassigns on the first day, and hands back", async () => {
    const due = (await createWorkTask({ teamId: ids.video, projectId: ids.project, title: "Bản dựng cuối", assigneePersonId: ids.lan, dueDate: addDays(from, 1) }, ids.long)).task;
    const later = (await createWorkTask({ teamId: ids.video, projectId: ids.project, title: "Tháng sau", assigneePersonId: ids.lan, dueDate: addDays(to, 30) }, ids.long)).task;
    const short = await leave("bao", from, from, "approved", 1);
    const requestId = await leave("lan", from, to, "approved", 5);

    expect(await syncCoverPlans(TODAY)).toMatchObject({ drafted: 1 });
    expect(await getCoverPlanForLeave(short)).toBeUndefined();
    const draft = (await getCoverPlanForLeave(requestId))!;
    expect(draft).toMatchObject({ status: "draft", personName: "lan", fromDate: from, toDate: to });
    expect(draft.items.map((item) => [item.itemType, item.itemId])).toEqual([["task", due.id]]);
    expect(draft.items.map((item) => item.itemId)).not.toContain(later.id);
    // A second run changes nothing.
    expect(await syncCoverPlans(TODAY)).toMatchObject({ drafted: 0, refreshed: 1 });
    expect((await listCoverPlansFor(ids.lan, TODAY)).map((plan) => [plan.status, plan.mine])).toEqual([["draft", true]]);

    expect(await fails(submitCoverPlan(draft.id, { defaultCoverPersonId: null, items: [], note: {} }, actor("lan"), TODAY))).toBe("cover_item_uncovered");
    expect(await fails(submitCoverPlan(draft.id, { defaultCoverPersonId: ids.lan, items: [], note: {} }, actor("lan"), TODAY))).toBe("cover_self");
    const submitted = await submitCoverPlan(draft.id, { defaultCoverPersonId: ids.bao, items: [], note: { context: "Nghỉ phép", next: "Gửi khách bản dựng cuối" } }, actor("lan"), TODAY);
    expect(submitted).toMatchObject({ covers: [ids.bao], applied: false });
    expect(await noticesOf("bao", "tasks.cover_requested")).toHaveLength(1);
    expect((await loadTask(due.id))!.task.assigneePersonId).toBe(ids.lan);
    expect((await listCoverPlansFor(ids.bao, TODAY))[0]).toMatchObject({ mine: false, toAcknowledge: 1 });
    expect(await acknowledgeCover(draft.id, actor("bao"))).toBe(1);

    // The first day of the leave: the cover takes over — once.
    expect(await syncCoverPlans(from)).toMatchObject({ applied: 1 });
    expect(await syncCoverPlans(from)).toMatchObject({ applied: 0 });
    expect((await loadTask(due.id))!.task.assigneePersonId).toBe(ids.bao);
    const plan = (await getCoverPlan(draft.id))!;
    expect(plan.items[0]).toMatchObject({ effectiveCoverName: "bao", handoffStatus: "accepted" });

    const { returned } = await handBackCover(draft.id, actor("lan"));
    expect(returned).toBe(1);
    expect((await loadTask(due.id))!.task.assigneePersonId).toBe(ids.lan);
    expect((await getCoverPlan(draft.id))!.status).toBe("handed_back");
    expect(await noticesOf("bao", "tasks.cover_handed_back")).toHaveLength(1);
    expect((await listTaskHandoffs(due.id, await viewer("long"))).map((row) => row.kind)).toEqual(["cover_return", "cover"]);
  });

  it("a withdrawn leave cancels its draft", async () => {
    await createWorkTask({ teamId: ids.video, projectId: ids.project, title: "Việc của Huy", assigneePersonId: ids.huy, dueDate: addDays(TODAY, 21) }, ids.long);
    const requestId = await leave("huy", addDays(TODAY, 20), addDays(TODAY, 22), "pending", 3);
    await syncCoverPlans(TODAY, { personId: ids.huy });
    expect((await getCoverPlanForLeave(requestId))!.status).toBe("draft");
    await db().update(schema.leaveRequest).set({ status: "withdrawn" }).where(eq(schema.leaveRequest.id, requestId));
    expect(await syncCoverPlans(TODAY, { personId: ids.huy })).toMatchObject({ cancelled: 1 });
    expect((await getCoverPlanForLeave(requestId))!.status).toBe("cancelled");
  });

  it("lists stay readable with an absence under way, and show who covers", async () => {
    const requestId = await leave("khoi", TODAY, addDays(TODAY, 3), "approved", 4);
    const [plan] = await db().insert(schema.workCoverPlan).values({ personId: ids.khoi, leaveRequestId: requestId, fromDate: TODAY, toDate: addDays(TODAY, 3), status: "submitted", defaultCoverPersonId: ids.tam, appliedAt: new Date() }).returning();
    const { task } = await createWorkTask({ teamId: ids.video, projectId: ids.project, title: "Việc của Khôi", assigneePersonId: ids.khoi }, ids.long);
    const row = (await listProjectTasks(ids.project)).find((item) => item.id === task.id)!;
    expect(row.away).toEqual({ until: addDays(TODAY, 3), coverName: "tam" });
    const leader = await getLeaderView(await viewer("long"), TODAY);
    expect(leader.people.find((person) => person.personId === ids.khoi)!.tasks[0].away).toEqual({ until: addDays(TODAY, 3), coverName: "tam" });
    await db().delete(schema.workCoverPlan).where(eq(schema.workCoverPlan.id, plan.id));
  });
});

describe("exit handover (FR-PJM-45)", () => {
  it("opens a step in the offboarding checklist that cannot close while the leaver owns work", async () => {
    const leaver = ids.huy;
    const reviewTask = (await createWorkTask({ teamId: ids.video, projectId: ids.project, title: "Duyệt storyboard", assigneePersonId: ids.tam }, ids.long)).task;
    await updateWorkTask(reviewTask.id, { reviewerPersonId: leaver }, ids.long);
    await setTeamMember(ids.video, leaver, "lead");
    const [employment] = await db().insert(schema.employment).values({ personId: leaver, entityId: ids.szm, employeeCode: "SZM-001", startDate: "2024-01-01", seniorityDate: "2024-01-01" }).returning();
    const [event] = await db().insert(schema.lifecycleEvent).values({ personId: leaver, employmentId: employment.id, entityId: ids.szm, type: "termination", effectiveDate: addDays(TODAY, 14), status: "pending" }).returning();

    expect(await syncExitHandovers(new Date(), TODAY)).toMatchObject({ opened: 1 });
    expect(await syncExitHandovers(new Date(), TODAY)).toMatchObject({ opened: 0 });
    const [row] = await db().select().from(schema.workExitHandover).where(eq(schema.workExitHandover.lifecycleEventId, event.id));
    const [step] = await db().select().from(schema.task).where(eq(schema.task.id, row.taskId!));
    expect(step).toMatchObject({ kind: "checklist", assigneePersonId: ids.long, contextType: "lifecycle_event", contextId: event.id, subjectPersonId: leaver, linkUrl: `/work/handover/${row.id}` });
    expect(await noticesOf("long", "tasks.exit_handover")).toHaveLength(1);

    const handover = (await getExitHandover(row.id))!;
    expect(handover.summary.blocking).toEqual(["task", "review", "team_lead"]);
    const refusal = (await failure(setTaskStatus(step.id, "done", ids.long))) as Error & { details: { count: number } };
    expect(refusal.message).toBe("work_handover_open");
    expect(refusal.details.count).toBe(handover.owned.length);

    expect(await fails(reassignOwnership(row.id, { items: handover.owned, toPersonId: ids.bao, note: {} }, actor("long")))).toBe("handoff_note_required");
    expect(await fails(reassignOwnership(row.id, { items: handover.owned, toPersonId: leaver, note: { context: "x" } }, actor("long")))).toBe("exit_reassign_to_self");
    const result = await reassignOwnership(row.id, { items: handover.owned, toPersonId: ids.bao, note: { context: "Huy nghỉ việc", next: "Bảo tiếp nhận" } }, actor("long"));
    expect(result.remaining).toBe(0);
    expect(await listOwnership(leaver)).toEqual([]);
    expect((await loadTask(reviewTask.id))!.work.reviewerPersonId).toBe(ids.bao);
    const [lead] = await db().select().from(schema.workTeamMember).where(and(eq(schema.workTeamMember.teamId, ids.video), eq(schema.workTeamMember.personId, ids.bao)));
    expect(lead.role).toBe("lead");
    expect((await listTaskHandoffs(reviewTask.id, await viewer("long")))[0]).toMatchObject({ kind: "exit", toName: "bao", note: { context: "Huy nghỉ việc" } });

    await setTaskStatus(step.id, "done", ids.long);
    expect((await getExitHandover(row.id))!.status).toBe("done");
  });
});

describe("account handover (FR-PJM-46)", () => {
  it("needs a note and moves the account-manager role on the client's open projects", async () => {
    await setProjectMember(ids.project, ids.lan, "account_manager");
    await db().update(schema.workClient).set({ accountManagerPersonId: ids.lan }).where(eq(schema.workClient.id, ids.client));
    expect(await fails(changeAccountManager(ids.client, { toPersonId: ids.bao, note: {} }, actor("long")))).toBe("handoff_note_required");
    const result = await changeAccountManager(ids.client, { toPersonId: ids.bao, note: { context: "Lan chuyển sang khách khác", contacts: "Chị Mai – brand manager" } }, actor("long"));
    expect(result).toMatchObject({ before: ids.lan, after: ids.bao, skipped: [] });
    expect(result.projects.map((project) => project.id)).toEqual([ids.project]);
    const roles = await db().select({ personId: schema.workProjectMember.personId, role: schema.workProjectMember.role }).from(schema.workProjectMember).where(eq(schema.workProjectMember.projectId, ids.project));
    expect(roles.find((row) => row.personId === ids.bao)?.role).toBe("account_manager");
    expect(roles.find((row) => row.personId === ids.lan)?.role).toBe("member");
    expect(result.handoff).toMatchObject({ kind: "account", clientId: ids.client, fromPersonId: ids.lan, toPersonId: ids.bao, status: "recorded" });
    // The lead of a project is not also its account manager: that project keeps its lead and is named back.
    const led = await changeAccountManager(ids.client, { toPersonId: ids.tam, note: { context: "Tâm nhận khách" } }, actor("long"));
    expect(led.skipped.map((project) => project.id)).toEqual([ids.project]);
  });
});

describe("cycles (FR-PJM-10)", () => {
  it("makes the current and next cycle, closes ended ones with their review and rolls work over — once", async () => {
    await db().insert(schema.dailyTeamPolicy).values({ teamId: ids.social, cycleWeeks: 1, cycleStart: "2026-09-07" });
    expect(await runCycles("2026-09-09")).toMatchObject({ made: 2, closed: 0 });
    expect(await runCycles("2026-09-09")).toMatchObject({ made: 0, closed: 0 });
    const [first] = await db().select().from(schema.workCycle).where(and(eq(schema.workCycle.teamId, ids.social), eq(schema.workCycle.number, 1)));
    const open = (await createWorkTask({ teamId: ids.social, title: "Lịch đăng tuần" }, ids.khoi)).task;
    const finished = (await createWorkTask({ teamId: ids.social, title: "Báo cáo tuần" }, ids.khoi)).task;
    await updateWorkTask(open.id, { cycleId: first.id }, ids.khoi);
    await updateWorkTask(finished.id, { cycleId: first.id }, ids.khoi);
    const done = (await listStates([ids.social])).find((state) => state.category === "done")!;
    await updateWorkTask(finished.id, { stateId: done.id }, ids.khoi);
    expect(await fails(updateWorkTask(open.id, { cycleId: "00000000-0000-0000-0000-000000000000" }, ids.khoi))).toBe("cycle_not_found");

    expect(await runCycles("2026-09-14")).toMatchObject({ closed: 1, rolled: 1, made: 1 });
    expect(await runCycles("2026-09-14")).toMatchObject({ closed: 0, rolled: 0, made: 0 });
    const [closed] = await db().select().from(schema.workCycle).where(eq(schema.workCycle.id, first.id));
    expect(closed.summary).toEqual({ planned: 2, done: 1, rolled: 1 });
    const rolled = (await loadTask(open.id))!.work;
    expect(rolled.cycleRollovers).toBe(1);
    expect(await fails(updateWorkTask(open.id, { cycleId: first.id }, ids.khoi))).toBe("cycle_closed");

    const page = await getCyclePage(ids.social, "2026-09-15", (items) => items);
    expect(page.current).toMatchObject({ number: 2, startDate: "2026-09-14", progress: { planned: 1, done: 0, percent: 0 }, rolledIn: 1 });
    expect(page.current!.tasks.map((task) => task.id)).toEqual([open.id]);
    expect(page.upcoming).toMatchObject({ number: 3, planned: 0 });
    expect(page.past.map((cycle) => cycle.number)).toEqual([1]);
  });
});
