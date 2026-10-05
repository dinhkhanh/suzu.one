// The project layer against a real Postgres (PGlite): job numbers, the lazy plan, the kick-off gate
// on the approval engine and what it locks afterwards, the gates on a project's status, budget
// alerts, fees kept from readers without `pjm:commercial`, the register computed from linked tasks
// — done internally told apart from accepted by the client — milestone and status reminders, and
// templates with their plan half.
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

import { and, desc, eq } from "drizzle-orm";
import { addDays, todayInVietnam } from "@/lib/dates";
import { db, schema } from "@/lib/db";
import { migrateTestDb } from "../../../tests/helpers/db";
import type { Grant } from "../platform/rbac/policy";
import type { ProjectRole, TeamRole } from "../work/enums";
import type { WorkViewer } from "../work/policy";
import { createProject, setProjectArchived, updateProject } from "../work/projects";
import { listStates, createTeam, setTeamMember } from "../work/teams";
import { createWorkTask, deleteWorkTask, updateWorkTask } from "../work/tasks";
import { addWorkTemplateItem, createProjectFromTemplate, saveWorkTemplate } from "../work/templates";
import { decideChange, saveChange, submitChange } from "./change-requests";
import { getCloseChecklist } from "./close";
import { sendBudgetAlerts, sendMilestoneReminders, sendStatusReminders } from "./jobs";
import { decideBrief, submitBrief } from "./kickoff";
import { loadRegisters, loadStatusFacts } from "./metrics";
import { ensurePlan, setAccountManager, setFee, shapePlan, syncAccountManager, updateBrief, updateBriefContacts, updatePlanSettings } from "./plans";
import { buildPortfolioExport, listPortfolio } from "./portfolio";
import { postStatusUpdate } from "./status-updates";
import { cancelDeliverable, createTasksForLine, linkTask, saveDeliverable, saveMilestone } from "./structure";
import { applyTemplatePlanIn, saveTemplatePlan } from "./template-plans";
import { workflow } from "../../../tests/helpers/workflows";
import { tableToCsv } from "../platform/export/csv";

const ids = {} as Record<"szm" | "long" | "tam" | "lan" | "huy" | "ke" | "video" | "tvc" | "social" | "group" | "tvcLine", string>;
const fails = (promise: Promise<unknown>) => promise.then(() => "no error", (error: Error) => error.message);
const noticesOf = async (personId: string, kind: string) => db().select().from(schema.notification).where(and(eq(schema.notification.recipientPersonId, personId), eq(schema.notification.kind, kind)));
const year = String(Number(todayInVietnam().slice(0, 4)) % 100).padStart(2, "0");

/** A viewer as the policy sees them, built by hand: the grants are the point of these tests. */
const viewer = (personId: string, options: { grants?: Grant[]; teams?: Record<string, TeamRole>; projects?: Record<string, ProjectRole> } = {}): WorkViewer => ({
  principal: { personId, workforceType: "employee", grants: options.grants ?? [] },
  entityId: ids.szm,
  teamRoles: new Map(Object.entries(options.teams ?? {})),
  projectRoles: new Map(Object.entries(options.projects ?? {})),
});

const brief = { objective: "Ra mắt dòng sản phẩm mới", scopeIn: "1 TVC 30s, 3 bản cắt ngắn", successCriteria: "Khách hàng duyệt trong hai vòng" };

/** After the kick-off the hours budget moves only through an approved change request (FR-PJM-11). */
async function changeBudget(projectId: string, minutesDelta: number) {
  const { after } = await saveChange(projectId, null, { title: "Điều chỉnh ngân sách giờ", description: null, requestedBy: "internal", impact: { minutesDelta }, evidenceFileId: null, evidenceUrl: null }, ids.lan, { withFee: false });
  const { requestId } = await submitChange(after.id, ids.lan);
  expect((await decideChange(ids.tam, requestId, { action: "approve", comment: null })).outcome).toBe("approved");
}

/** A version of the task's deliverable, handed in and through internal review — and what the client then did with it. */
async function handIn(taskId: string, client: "approved" | "changes_required" | "link" | null) {
  const [last] = await db().select({ version: schema.workDeliverable.version }).from(schema.workDeliverable).where(eq(schema.workDeliverable.taskId, taskId)).orderBy(desc(schema.workDeliverable.version)).limit(1);
  const [deliverable] = await db()
    .insert(schema.workDeliverable)
    .values({ taskId, version: (last?.version ?? 0) + 1, kind: "link", url: "https://drive.google.com/cut", submittedByPersonId: ids.huy, decision: client === "changes_required" ? "changes_requested" : "approved", decidedByPersonId: ids.tam, decidedAt: new Date(), frozenAt: client === "approved" ? new Date() : null })
    .returning();
  if (client === "link") await db().insert(schema.workPreviewLink).values({ taskId, deliverableId: deliverable.id, tokenHash: `hash-${deliverable.id}`, expiresAt: new Date(Date.now() + 86_400_000), createdByPersonId: ids.lan });
  else if (client) await db().insert(schema.workDeliverableDecision).values({ deliverableId: deliverable.id, decision: client, decidedByPersonId: ids.lan, isClient: true, client: { channel: "email", decidedByName: "Chị Mai", decidedOn: todayInVietnam() } });
}

beforeAll(async () => {
  await migrateTestDb();
  const [szm] = await db().insert(schema.entity).values({ code: "SZM", legalName: "SuZu Media", shortName: "Media" }).returning();
  ids.szm = szm.id;
  for (const [key, name] of [["long", "Long Dang"], ["tam", "Tam Bui"], ["lan", "Lan Tran"], ["huy", "Huy Ho"], ["ke", "Ke Toan"]] as const) {
    const [row] = await db().insert(schema.person).values({ fullName: name, searchName: name.toLowerCase(), workEmail: `${key}@suzu.group`, status: "active", primaryEntityId: szm.id }).returning();
    ids[key] = row.id;
  }
  // Long leads the video team; Tam leads the TVC project; Huy works in it.
  const video = await createTeam({ key: "VID", name: "Video Production", description: null, entityId: szm.id, departmentId: null, defaultVisibility: "team", isActive: true }, workflow("simple"), ids.long);
  ids.video = video.id;
  for (const personId of [ids.tam, ids.huy, ids.lan]) await setTeamMember(video.id, personId, "member");
  const project = (name: string, status: "planned" | "active") => createProject({ teamId: video.id, name, description: null, clientId: null, status, visibility: "team", leadPersonId: ids.tam, startDate: "2026-10-01", dueDate: "2026-11-30" }, ids.long);
  ids.tvc = (await project("TVC Tết", "planned")).id;
  ids.social = (await project("Social tháng 10", "active")).id;
  // The fee is agreed before the kick-off: afterwards it moves only through a change request.
  await setFee(ids.tvc, 120_000_000);
  await setFee(ids.social, 45_000_000);
  // A team without an entity numbers its projects under the group prefix.
  const group = await createTeam({ key: "GRP", name: "Group Brand", description: null, entityId: null, departmentId: null, defaultVisibility: "team", isActive: true }, workflow("simple"), ids.long);
  ids.group = (await createProject({ teamId: group.id, name: "Group brand book", description: null, clientId: null, status: "active", visibility: "team", leadPersonId: ids.long, startDate: null, dueDate: null }, ids.long)).id;
});

describe("the plan and its job number (FR-PJM-02)", () => {
  it("numbers projects per prefix and year, in order, without gaps", async () => {
    const [tvc, social, group] = [await ensurePlan(ids.tvc), await ensurePlan(ids.social), await ensurePlan(ids.group)];
    expect(tvc.jobNumber).toBe(`SZM-${year}-001`);
    expect(social.jobNumber).toBe(`SZM-${year}-002`);
    expect(group.jobNumber).toBe(`SZ-${year}-001`);
    // No client: an internal project until someone says otherwise.
    expect(tvc.kind).toBe("internal");
  });

  it("is made once, however many times it is asked for", async () => {
    const before = await ensurePlan(ids.tvc);
    const [again, twice] = await Promise.all([ensurePlan(ids.tvc), ensurePlan(ids.tvc)]);
    expect([again.jobNumber, twice.jobNumber]).toEqual([before.jobNumber, before.jobNumber]);
    expect(await db().select().from(schema.projectPlan).where(eq(schema.projectPlan.projectId, ids.tvc))).toHaveLength(1);
    const [counter] = await db().select().from(schema.projectJobCounter).where(eq(schema.projectJobCounter.prefix, "SZM"));
    expect(counter.last).toBe(2);
  });

  it("keeps the account manager in the plan and in the member roles", async () => {
    await setAccountManager(ids.tvc, ids.lan);
    const [member] = await db().select().from(schema.workProjectMember).where(and(eq(schema.workProjectMember.projectId, ids.tvc), eq(schema.workProjectMember.personId, ids.lan)));
    expect(member.role).toBe("account_manager");
    expect((await ensurePlan(ids.tvc)).accountManagerPersonId).toBe(ids.lan);
    expect(await fails(setAccountManager(ids.tvc, ids.tam))).toBe("account_manager_is_lead");
    // Changed on the work screens (the member role), the plan follows on its next read.
    await db().update(schema.workProjectMember).set({ role: "member" }).where(eq(schema.workProjectMember.id, member.id));
    expect((await syncAccountManager(db(), await ensurePlan(ids.tvc))).accountManagerPersonId).toBeNull();
    await setAccountManager(ids.tvc, ids.lan);
  });
});

describe("the deliverables register (FR-PJM-05)", () => {
  it("counts a line's units from its linked tasks' states", async () => {
    const line = (await saveDeliverable(ids.social, null, { title: "Bài đăng Facebook", quantity: 3, format: "post", channel: "facebook", dueDate: "2026-10-20", milestoneId: null, sortOrder: 0 })).after;
    const { taskIds } = await createTasksForLine(line.id, { count: 2, assigneePersonId: ids.huy, dueDate: null }, ids.tam);
    expect(taskIds).toHaveLength(2);
    const tasks = await db().select().from(schema.task).where(eq(schema.task.id, taskIds[0]));
    expect(tasks[0]).toMatchObject({ title: "Bài đăng Facebook #1", dueDate: "2026-10-20" });
    // One notice for the batch, not one per task.
    expect(await noticesOf(ids.huy, "tasks.assigned")).toHaveLength(1);

    let [register] = [(await loadRegisters([ids.social])).get(ids.social)!];
    expect(register.lines[0]).toMatchObject({ status: "promised", promised: 3, accepted: 0, linked: 2 });

    const states = await listStates([ids.video]);
    await updateWorkTask(taskIds[0], { stateId: states.find((state) => state.category === "done")!.id }, ids.huy);
    await updateWorkTask(taskIds[1], { stateId: states.find((state) => state.category === "in_progress")!.id }, ids.huy);
    register = (await loadRegisters([ids.social])).get(ids.social)!;
    // An internal project has no client to accept its work: done is accepted.
    expect(register.lines[0]).toMatchObject({ status: "in_production", accepted: 1, counts: { accepted: 1, in_production: 1, promised: 1 } });
    expect(register).toMatchObject({ promised: 3, accepted: 1, awaitingClient: 0, percent: 33 });
  });
});

describe("the kick-off gate (FR-PJM-03, 12)", () => {
  it("refuses an incomplete brief, then goes to the team lead; approval takes the baseline and starts the project", async () => {
    expect(await fails(submitBrief(ids.tvc, ids.lan))).toBe("brief_incomplete");
    await updatePlanSettings(ids.tvc, { kind: "client", budgetMinutes: null, budgetByRole: [{ role: "Dựng phim", minutes: 2400 }, { role: "Đạo diễn", minutes: 1200 }], updateCadenceDays: 7, driveUrl: null });
    await updateBrief(ids.tvc, brief);
    const milestone = (await saveMilestone(ids.tvc, null, { name: "Bàn giao master", dueDate: "2026-11-28", phaseId: null, ownerPersonId: ids.tam, isClientFacing: true, isBilling: true, sortOrder: 0 })).after;
    ids.tvcLine = (await saveDeliverable(ids.tvc, null, { title: "Bản cắt 15s", quantity: 3, format: "short_video", channel: "tiktok", dueDate: "2026-11-20", milestoneId: null, sortOrder: 0 })).after.id;

    const { plan, requestId } = await submitBrief(ids.tvc, ids.lan);
    expect(plan.briefStatus).toBe("submitted");
    expect(await noticesOf(ids.long, "approvals.requested")).toHaveLength(1);
    // Waiting at the gate, the brief is frozen.
    expect(await fails(updateBrief(ids.tvc, { ...brief, objective: "Khác" }))).toBe("brief_locked");
    expect(await fails(decideBrief(ids.huy, requestId, { action: "approve", comment: null }))).toBe("approval_not_assignee");

    const decided = await decideBrief(ids.long, requestId, { action: "approve", comment: null });
    expect(decided.outcome).toBe("approved");
    expect(decided.plan.briefStatus).toBe("approved");
    expect(decided.plan.baseline).toMatchObject({ startDate: "2026-10-01", dueDate: "2026-11-30", budgetMinutes: 3600, milestones: [{ id: milestone.id, dueDate: "2026-11-28" }] });
    const [project] = await db().select().from(schema.workProject).where(eq(schema.workProject.id, ids.tvc));
    expect(project.status).toBe("active");
  });

  it("returns to the author with the comment, who edits and sends the same request round again", async () => {
    await updateBrief(ids.social, brief);
    const { requestId } = await submitBrief(ids.social, ids.tam);
    expect(await fails(decideBrief(ids.long, requestId, { action: "return", comment: null }))).toBe("approval_comment_required");
    const returned = await decideBrief(ids.long, requestId, { action: "return", comment: "Thiếu KPI cụ thể" });
    expect(returned.plan.briefStatus).toBe("returned");
    const [event] = await db().select().from(schema.approvalEvent).where(and(eq(schema.approvalEvent.requestId, requestId), eq(schema.approvalEvent.type, "returned")));
    expect(event.comment).toBe("Thiếu KPI cụ thể");

    await updateBrief(ids.social, { ...brief, successCriteria: "Tương tác +15%" });
    const again = await submitBrief(ids.social, ids.tam);
    expect(again).toMatchObject({ requestId, resubmitted: true });
    expect(again.plan.briefStatus).toBe("submitted");
    // Already active: approval leaves it active and takes the baseline.
    expect((await decideBrief(ids.long, requestId, { action: "approve", comment: null })).plan.baseline).not.toBeNull();
  });
});

describe("after the kick-off, scope, hours and fee change only through change requests (FR-PJM-11)", () => {
  const line = { title: "Bản cắt 15s", quantity: 3, format: "short_video", channel: "tiktok", dueDate: "2026-11-20", milestoneId: null, sortOrder: 0 };

  it("refuses a new line, a line's quantity, format or channel, and cancelling a line", async () => {
    expect(await fails(saveDeliverable(ids.tvc, null, { ...line, title: "Poster" }))).toBe("scope_locked");
    expect(await fails(saveDeliverable(ids.tvc, ids.tvcLine, { ...line, quantity: 5 }))).toBe("scope_locked");
    expect(await fails(saveDeliverable(ids.tvc, ids.tvcLine, { ...line, format: "post" }))).toBe("scope_locked");
    expect(await fails(saveDeliverable(ids.tvc, ids.tvcLine, { ...line, channel: null }))).toBe("scope_locked");
    expect(await fails(cancelDeliverable(ids.tvcLine, true))).toBe("scope_locked");
    const [row] = await db().select().from(schema.projectDeliverable).where(eq(schema.projectDeliverable.id, ids.tvcLine));
    expect(row).toMatchObject({ quantity: 3, format: "short_video", channel: "tiktok", cancelledAt: null });
  });

  it("still takes what is not the promise: a line's wording, its due date and milestone, and the tasks linked to it", async () => {
    const [milestone] = await db().select().from(schema.projectMilestone).where(eq(schema.projectMilestone.projectId, ids.tvc));
    const { after } = await saveDeliverable(ids.tvc, ids.tvcLine, { ...line, title: "Bản cắt 15 giây", dueDate: "2026-11-25", milestoneId: milestone.id, sortOrder: 2 });
    expect(after).toMatchObject({ title: "Bản cắt 15 giây", dueDate: "2026-11-25", milestoneId: milestone.id, sortOrder: 2, quantity: 3 });
    const { task } = await createWorkTask({ teamId: ids.video, projectId: ids.tvc, title: "Dựng bản cắt", assigneePersonId: ids.huy }, ids.tam);
    expect((await linkTask(ids.tvc, task.id, { milestoneId: null, deliverableId: ids.tvcLine, phaseId: null })).after.deliverableId).toBe(ids.tvcLine);
    // Unlinked again: the units of this line are made by the test of the register below.
    await linkTask(ids.tvc, task.id, { milestoneId: null, deliverableId: null, phaseId: null });
    await deleteWorkTask(task.id, ids.tam);
  });

  it("refuses a new hours budget and a new fee, and lets the same total be split between roles again", async () => {
    const settings = { kind: "client" as const, updateCadenceDays: 7, driveUrl: null };
    expect(await fails(updatePlanSettings(ids.tvc, { ...settings, budgetMinutes: 600, budgetByRole: [] }))).toBe("scope_locked");
    expect(await fails(updatePlanSettings(ids.tvc, { ...settings, budgetMinutes: null, budgetByRole: [{ role: "Dựng phim", minutes: 3000 }, { role: "Đạo diễn", minutes: 1200 }] }))).toBe("scope_locked");
    const { after } = await updatePlanSettings(ids.tvc, { ...settings, updateCadenceDays: 10, driveUrl: "https://drive.google.com/drive/folders/tvc", budgetMinutes: null, budgetByRole: [{ role: "Dựng phim", minutes: 3000 }, { role: "Đạo diễn", minutes: 600 }] });
    expect(after).toMatchObject({ budgetMinutes: 3600, updateCadenceDays: 10, budgetByRole: [{ role: "Dựng phim", minutes: 3000 }, { role: "Đạo diễn", minutes: 600 }] });
    expect(await fails(setFee(ids.tvc, 150_000_000))).toBe("scope_locked");
    expect(await fails(setFee(ids.tvc, null))).toBe("scope_locked");
    // Saving the fee it already has changes nothing and is not refused.
    expect(await setFee(ids.tvc, 120_000_000)).toEqual({ before: 120_000_000, after: 120_000_000 });
  });

  it("keeps an approved brief's agreement locked while its contacts and links stay editable", async () => {
    expect(await fails(updateBrief(ids.tvc, { ...brief, objective: "Khác" }))).toBe("brief_locked");
    const { after } = await updateBriefContacts(ids.tvc, { clientContacts: [{ name: "Chị Mai", role: "Brand manager", contact: "mai@khach.vn" }], links: ["https://drive.google.com/drive/folders/brief"] });
    expect(after).toEqual({ ...brief, clientContacts: [{ name: "Chị Mai", role: "Brand manager", contact: "mai@khach.vn" }], links: ["https://drive.google.com/drive/folders/brief"] });
    // Cleared again: the agreed text is still exactly what was approved.
    expect((await updateBriefContacts(ids.tvc, { clientContacts: [], links: [] })).after).toEqual(brief);
    // Before approval the whole brief is edited as one; this door is for an approved brief only.
    expect(await fails(updateBriefContacts(ids.group, { clientContacts: [], links: [] }))).toBe("brief_not_approved");
  });
});

describe("done internally is not accepted by the client (FR-PJM-05)", () => {
  const lineOf = async () => (await loadRegisters([ids.tvc])).get(ids.tvc)!.lines.find((row) => row.id === ids.tvcLine)!;

  it("counts a unit as accepted only on the client's recorded decision, and as with the client only once it was sent", async () => {
    const states = await listStates([ids.video]);
    const stateOf = (category: string) => states.find((state) => state.category === category)!.id;
    const { taskIds } = await createTasksForLine(ids.tvcLine, { count: 3, assigneePersonId: ids.huy, dueDate: null }, ids.tam);
    const [first, second, third] = taskIds;

    // Done, and nothing heard from the client: ready for them, not accepted.
    await updateWorkTask(first, { stateId: stateOf("done") }, ids.huy);
    // In the team's review state, sent to nobody: still production, not "client review".
    await updateWorkTask(second, { stateId: stateOf("in_review") }, ids.huy);
    expect(await lineOf()).toMatchObject({ status: "in_production", accepted: 0, awaitingClient: 1, counts: { ready_for_client: 1, in_production: 1, promised: 1, client_review: 0, accepted: 0 } });
    expect((await loadRegisters([ids.tvc])).get(ids.tvc)).toMatchObject({ promised: 3, accepted: 0, awaitingClient: 1, percent: 0 });
    const plan = await ensurePlan(ids.tvc);
    expect(await loadStatusFacts(ids.tvc, plan, todayInVietnam())).toMatchObject({ deliverablesAccepted: 0, deliverablesAwaitingClient: 1, deliverablesPromised: 3 });
    // The close-out's register check reads the same figure: the line is not accepted yet.
    expect((await getCloseChecklist(ids.tvc)).find((item) => item.key === "register")).toMatchObject({ met: false, count: 1 });

    // The second unit's version clears internal review and a review link goes to the client: client review.
    await handIn(second, "link");
    expect(await lineOf()).toMatchObject({ accepted: 0, awaitingClient: 2, counts: { ready_for_client: 1, client_review: 1, promised: 1 } });

    // The client approves the first: accepted. They send the second back: in production again, whatever its state.
    await handIn(first, "approved");
    await db().insert(schema.workDeliverableDecision).values({ deliverableId: (await db().select().from(schema.workDeliverable).where(eq(schema.workDeliverable.taskId, second)))[0].id, decision: "changes_required", decidedByPersonId: ids.lan, isClient: true, client: { channel: "zalo", decidedByName: "Chị Mai", decidedOn: todayInVietnam() } });
    expect(await lineOf()).toMatchObject({ status: "in_production", accepted: 1, awaitingClient: 0, counts: { accepted: 1, in_production: 1, promised: 1 } });
    expect((await loadRegisters([ids.tvc])).get(ids.tvc)).toMatchObject({ accepted: 1, percent: 33 });

    // A new version of the second answers the request; done without being sent, it is ready for the client again.
    await handIn(second, null);
    await updateWorkTask(second, { stateId: stateOf("done") }, ids.huy);
    await updateWorkTask(third, { stateId: stateOf("done") }, ids.huy);
    expect(await lineOf()).toMatchObject({ status: "ready_for_client", accepted: 1, awaitingClient: 2 });
  });

  it("accepts finished work that has no client to accept it", async () => {
    // "Social tháng 10" is an internal project: its done unit was accepted with no decision at all.
    expect((await loadRegisters([ids.social])).get(ids.social)).toMatchObject({ accepted: 1, awaitingClient: 0 });
  });
});

describe("the gates on a project's status (FR-PJM-03, 59)", () => {
  const edit = (projectId: string, status: string) => updateProject(projectId, { name: "Gated", description: null, clientId: null, status, visibility: "team", leadPersonId: ids.tam, startDate: null, dueDate: null });

  it("lets a client project become Active only through its kick-off and Done only through its close-out", async () => {
    const gated = await createProject({ teamId: ids.video, name: "Gated", description: null, clientId: null, status: "planned", visibility: "team", leadPersonId: ids.tam, startDate: null, dueDate: null }, ids.long);
    await updatePlanSettings(gated.id, { kind: "client", budgetMinutes: null, budgetByRole: [], updateCadenceDays: 7, driveUrl: null });
    expect(await fails(edit(gated.id, "active"))).toBe("project_needs_kickoff");
    expect(await fails(edit(gated.id, "done"))).toBe("project_needs_closeout");
    // Pausing, planning again and saving its other details are not gates.
    expect((await edit(gated.id, "paused")).after.status).toBe("paused");
    expect(await fails(edit(gated.id, "active"))).toBe("project_needs_kickoff");
    expect((await edit(gated.id, "planned")).after.status).toBe("planned");
    expect((await edit(gated.id, "planned")).after.name).toBe("Gated");
    // Out of the archive it is planned again, not walked past the gate.
    await setProjectArchived(gated.id, true);
    expect((await setProjectArchived(gated.id, false)).after.status).toBe("planned");

    // The kick-off itself makes it active; after that the header may pause and resume it — never finish it.
    await updateBrief(gated.id, brief);
    const { requestId } = await submitBrief(gated.id, ids.tam);
    await decideBrief(ids.long, requestId, { action: "approve", comment: null });
    expect((await db().select().from(schema.workProject).where(eq(schema.workProject.id, gated.id)))[0].status).toBe("active");
    await edit(gated.id, "paused");
    expect((await edit(gated.id, "active")).after.status).toBe("active");
    expect(await fails(edit(gated.id, "done"))).toBe("project_needs_closeout");
    await setProjectArchived(gated.id, true);
    expect((await setProjectArchived(gated.id, false)).after.status).toBe("active");
    await setProjectArchived(gated.id, true); // out of the later lists' way
  });

  it("leaves an internal project's status free", async () => {
    expect((await ensurePlan(ids.group)).kind).toBe("internal");
    const free = (status: string) => updateProject(ids.group, { name: "Group brand book", description: null, clientId: null, status, visibility: "team", leadPersonId: ids.long, startDate: null, dueDate: null });
    for (const status of ["done", "active", "planned", "active"]) expect((await free(status)).after.status).toBe(status);
  });
});

describe("hours budget (FR-PJM-09)", () => {
  it("alerts the lead and the account manager once at 80% and once at 100%", async () => {
    // 60 h at the kick-off, 10 h after a change request takes 50 away.
    await changeBudget(ids.tvc, -3000);
    expect((await ensurePlan(ids.tvc)).budgetMinutes).toBe(600);
    const log = (minutes: number) => db().insert(schema.timeEntry).values({ personId: ids.huy, date: todayInVietnam(), weekStart: todayInVietnam(), projectId: ids.tvc, minutes });
    await log(500);
    expect(await sendBudgetAlerts()).toEqual({ alerts: 1 });
    expect(await sendBudgetAlerts()).toEqual({ alerts: 0 });
    const [tam, lan] = [await noticesOf(ids.tam, "projects.budget_alert"), await noticesOf(ids.lan, "projects.budget_alert")];
    expect([tam.length, lan.length]).toEqual([1, 1]);
    expect(tam[0].params).toMatchObject({ percent: 83 });
    await log(110);
    expect(await sendBudgetAlerts()).toEqual({ alerts: 1 });
    expect(await sendBudgetAlerts()).toEqual({ alerts: 0 });
    expect((await ensurePlan(ids.tvc)).budgetAlerted).toEqual([80, 100]);
  });
});

describe("fees (pjm:commercial)", () => {
  const lead = () => viewer(ids.tam, { projects: { [ids.tvc]: "lead", [ids.social]: "lead" } });
  // Works in both projects, runs neither: the plain member of the PJM access rules.
  const worker = () => viewer(ids.huy, { teams: { [ids.video]: "member" }, projects: { [ids.tvc]: "member", [ids.social]: "member" } });
  const teamLead = () => viewer(ids.long, { teams: { [ids.video]: "lead" } });
  const finance = () => viewer(ids.ke, { grants: [{ role: "finance", scope: { type: "entity", id: ids.szm } }] });
  const director = () => viewer(ids.ke, { grants: [{ role: "entity_director", scope: { type: "entity", id: ids.szm } }] });

  it("are never on a portfolio row, a plan or a CSV for a reader without it", async () => {
    const rows = await listPortfolio(worker(), { today: todayInVietnam() });
    expect(rows.map((row) => row.name).sort()).toEqual(["Social tháng 10", "TVC Tết"]);
    for (const row of rows) expect("feeVnd" in row).toBe(false);
    expect("feeVnd" in shapePlan(await ensurePlan(ids.tvc), false)).toBe(false);
    const { file, withFees } = await buildPortfolioExport(worker(), {}, "vi");
    expect(withFees).toBe(false);
    expect(tableToCsv(file.table)).not.toContain("120000000");
    expect(tableToCsv(file.table)).not.toContain("VND");
    // Running the team is not running its money either.
    for (const row of await listPortfolio(teamLead(), { today: todayInVietnam() })) expect("feeVnd" in row).toBe(false);
  });

  // The owner's decision of 2026-09-23 (Q21): the lead and the account manager read their own
  // project's fee. Their own only — a portfolio row of a project they neither lead nor keep.
  it("are on the rows of the project's own lead and its own account manager, and nowhere else", async () => {
    const own = viewer(ids.tam, { teams: { [ids.video]: "member" }, projects: { [ids.tvc]: "lead" } });
    const rows = await listPortfolio(own, { today: todayInVietnam() });
    expect(rows.find((row) => row.id === ids.tvc)?.feeVnd).toBe(120_000_000);
    expect("feeVnd" in rows.find((row) => row.id === ids.social)!).toBe(false);
    const { file, withFees } = await buildPortfolioExport(own, {}, "vi");
    expect(withFees).toBe(true);
    expect(tableToCsv(file.table)).toContain("120000000");
    expect(tableToCsv(file.table)).not.toContain("45000000");

    const manager = viewer(ids.lan, { teams: { [ids.video]: "member" }, projects: { [ids.social]: "account_manager" } });
    const managerRows = await listPortfolio(manager, { today: todayInVietnam() });
    expect(managerRows.find((row) => row.id === ids.social)?.feeVnd).toBe(45_000_000);
    expect("feeVnd" in managerRows.find((row) => row.id === ids.tvc)!).toBe(false);
  });

  it("are on them for a reader with it over the project's entity", async () => {
    // Finance reads the projects it invoices, with their money (owner, 2026-09-23), and so does an
    // entity director over its entity.
    const financeRows = await listPortfolio(finance(), { today: todayInVietnam() });
    expect(financeRows.find((row) => row.id === ids.tvc)?.feeVnd).toBe(120_000_000);
    const rows = await listPortfolio(director(), { today: todayInVietnam() });
    expect(rows.find((row) => row.id === ids.tvc)?.feeVnd).toBe(120_000_000);
    expect(shapePlan(await ensurePlan(ids.tvc), true).feeVnd).toBe(120_000_000);
    const { file, withFees } = await buildPortfolioExport(director(), {}, "vi");
    expect(withFees).toBe(true);
    expect(tableToCsv(file.table)).toContain("120000000");
  });

  it("shows hours, register and health on the portfolio", async () => {
    const row = (await listPortfolio(lead(), { today: todayInVietnam() })).find((entry) => entry.id === ids.tvc)!;
    expect(row).toMatchObject({ jobNumber: `SZM-${year}-001`, kind: "client", briefStatus: "approved", accountManagerName: "Lan Tran", burn: { loggedMinutes: 610, budgetMinutes: 600, level: "over" } });
  });
});

describe("status updates (FR-PJM-27)", () => {
  it("keep facts from the record, set the plan's health and tell the project's followers", async () => {
    const row = await postStatusUpdate(ids.tvc, { health: "at_risk", summary: "Quay trễ hai ngày vì thời tiết", highlights: null, nextSteps: "Dời lịch dựng" }, { personId: ids.tam, fullName: "Tam Bui" });
    expect(row.facts).toMatchObject({ minutesLogged: 610, budgetMinutes: 600, nextMilestone: { name: "Bàn giao master", dueDate: "2026-11-28" } });
    expect((await ensurePlan(ids.tvc)).health).toBe("at_risk");
    // Members, the account manager and the team's lead — not the author.
    for (const personId of [ids.lan, ids.long]) expect(await noticesOf(personId, "projects.status_posted")).toHaveLength(1);
    expect(await noticesOf(ids.tam, "projects.status_posted")).toHaveLength(0);
  });
});

describe("milestone reminders (FR-PJM-04)", () => {
  it("are sent once before the date and once when missed", async () => {
    const today = todayInVietnam();
    await saveMilestone(ids.social, null, { name: "Duyệt lịch nội dung", dueDate: addDays(today, 1), phaseId: null, ownerPersonId: ids.huy, isClientFacing: true, isBilling: false, sortOrder: 0 });
    expect(await sendMilestoneReminders(today)).toEqual({ dueSoon: 1, missed: 0 });
    expect(await sendMilestoneReminders(today)).toEqual({ dueSoon: 0, missed: 0 });
    expect(await sendMilestoneReminders(addDays(today, 2))).toEqual({ dueSoon: 0, missed: 1 });
    expect(await sendMilestoneReminders(addDays(today, 3))).toEqual({ dueSoon: 0, missed: 0 });
    expect(await noticesOf(ids.huy, "projects.milestone_due")).toHaveLength(1);
    expect(await noticesOf(ids.tam, "projects.milestone_missed")).toHaveLength(1);
  });
});

describe("status reminders (FR-PJM-27)", () => {
  it("reach the lead named on the project, then the team's leads, when no member holds the lead role", async () => {
    const orphan = await createProject({ teamId: ids.video, name: "Không ai phụ trách", description: null, clientId: null, status: "active", visibility: "team", leadPersonId: ids.huy, startDate: null, dueDate: null }, ids.long);
    const link = `/projects/${orphan.id}/updates`;
    const remindedOf = async (personId: string) => (await noticesOf(personId, "projects.status_due")).filter((notice) => notice.link === link).length;
    const due = addDays(todayInVietnam(), 8);

    // Its lead role is taken off the member list; the project still names Huy as its lead.
    await db().update(schema.workProjectMember).set({ role: "member" }).where(and(eq(schema.workProjectMember.projectId, orphan.id), eq(schema.workProjectMember.personId, ids.huy)));
    await sendStatusReminders(due);
    expect([await remindedOf(ids.huy), await remindedOf(ids.long)]).toEqual([1, 0]);

    // No lead named either: the leads of the team that owns it hear it — never nobody.
    await db().update(schema.workProject).set({ leadPersonId: null }).where(eq(schema.workProject.id, orphan.id));
    await sendStatusReminders(due);
    expect([await remindedOf(ids.huy), await remindedOf(ids.long)]).toEqual([1, 1]);
    await setProjectArchived(orphan.id, true);
  });
});

describe("project templates v2 (FR-PJM-15)", () => {
  it("make the plan half with the project, in one go", async () => {
    const { after: template } = await saveWorkTemplate(null, { purpose: "work_project", name: "Video ngắn", description: null, ownerId: null, isActive: true });
    await addWorkTemplateItem(template.id, { title: "Kịch bản", description: null, parentItemId: null, roleKey: "writer", dueOffsetDays: 3, estimateMinutes: 240, sortOrder: 0 });
    await addWorkTemplateItem(template.id, { title: "Dựng", description: null, parentItemId: null, roleKey: "editor", dueOffsetDays: 10, estimateMinutes: 480, sortOrder: 1 });
    await saveTemplatePlan(template.id, {
      kind: "client",
      updateCadenceDays: 14,
      phases: [{ name: "Sản xuất", startDay: 0, endDay: 10 }],
      milestones: [{ name: "Bàn giao", day: 10, phase: 0, isClientFacing: true, isBilling: true }],
      deliverables: [{ title: "Video ngắn TikTok", quantity: 4, format: "short_video", channel: "tiktok", milestone: 0, day: 10 }],
      budgetByRole: [{ role: "Dựng phim", minutes: 1200 }],
      brief: { objective: "Bốn video ngắn cho đợt ra mắt" },
    });
    expect(await fails(saveTemplatePlan(template.id, { kind: "client", updateCadenceDays: 7, phases: [], milestones: [{ name: "X", day: 1, phase: 3, isClientFacing: false, isBilling: false }], deliverables: [], budgetByRole: [], brief: {} }))).toBe("template_plan_invalid");

    const { project, taskIds } = await createProjectFromTemplate(
      { teamId: ids.video, name: "Video ra mắt", description: null, clientId: null, status: "planned", visibility: "team", leadPersonId: ids.tam, startDate: "2026-12-01", dueDate: null },
      { templateId: template.id, anchor: { mode: "start", date: "2026-12-01" }, roles: { editor: ids.huy } },
      ids.tam,
      applyTemplatePlanIn,
    );
    expect(taskIds).toHaveLength(2);
    const plan = await ensurePlan(project.id);
    // The fifth project of the entity in this file: two were made by the tests of the gates and the reminders.
    expect(plan).toMatchObject({ jobNumber: `SZM-${year}-005`, kind: "client", budgetMinutes: 1200, updateCadenceDays: 14, brief: { objective: "Bốn video ngắn cho đợt ra mắt" } });
    const [phase] = await db().select().from(schema.projectPhase).where(eq(schema.projectPhase.projectId, project.id));
    const [milestone] = await db().select().from(schema.projectMilestone).where(eq(schema.projectMilestone.projectId, project.id));
    const [line] = await db().select().from(schema.projectDeliverable).where(eq(schema.projectDeliverable.projectId, project.id));
    expect(phase).toMatchObject({ name: "Sản xuất", startDate: "2026-12-01", endDate: "2026-12-11" });
    expect(milestone).toMatchObject({ name: "Bàn giao", dueDate: "2026-12-11", phaseId: phase.id, ownerPersonId: ids.tam, isBilling: true });
    expect(line).toMatchObject({ title: "Video ngắn TikTok", quantity: 4, milestoneId: milestone.id, dueDate: "2026-12-11" });
  });
});
