// The project layer against a real Postgres (PGlite): job numbers, the lazy plan, the kick-off gate
// on the approval engine, budget alerts, fees kept from readers without `pjm:commercial`, the
// register computed from linked tasks, milestone reminders, and templates with their plan half.
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
import type { Grant } from "../platform/rbac/policy";
import type { ProjectRole, TeamRole } from "../work/enums";
import type { WorkViewer } from "../work/policy";
import { createProject } from "../work/projects";
import { listStates, createTeam, setTeamMember } from "../work/teams";
import { updateWorkTask } from "../work/tasks";
import { addWorkTemplateItem, createProjectFromTemplate, saveWorkTemplate } from "../work/templates";
import { sendBudgetAlerts, sendMilestoneReminders } from "./jobs";
import { decideBrief, submitBrief } from "./kickoff";
import { loadRegisters } from "./metrics";
import { ensurePlan, setAccountManager, setFee, shapePlan, syncAccountManager, updateBrief, updatePlanSettings } from "./plans";
import { buildPortfolioExport, listPortfolio } from "./portfolio";
import { postStatusUpdate } from "./status-updates";
import { createTasksForLine, saveDeliverable, saveMilestone } from "./structure";
import { applyTemplatePlanIn, saveTemplatePlan } from "./template-plans";

const ids = {} as Record<"szm" | "long" | "tam" | "lan" | "huy" | "ke" | "video" | "tvc" | "social" | "group", string>;
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

beforeAll(async () => {
  await migrateTestDb();
  const [szm] = await db().insert(schema.entity).values({ code: "SZM", legalName: "SuZu Media", shortName: "Media" }).returning();
  ids.szm = szm.id;
  for (const [key, name] of [["long", "Long Dang"], ["tam", "Tam Bui"], ["lan", "Lan Tran"], ["huy", "Huy Ho"], ["ke", "Ke Toan"]] as const) {
    const [row] = await db().insert(schema.person).values({ fullName: name, searchName: name.toLowerCase(), workEmail: `${key}@suzu.group`, status: "active", primaryEntityId: szm.id }).returning();
    ids[key] = row.id;
  }
  // Long leads the video team; Tam leads the TVC project; Huy works in it.
  const video = await createTeam({ key: "VID", name: "Video Production", description: null, entityId: szm.id, departmentId: null, defaultVisibility: "team", isActive: true }, "simple", {}, ids.long);
  ids.video = video.id;
  for (const personId of [ids.tam, ids.huy, ids.lan]) await setTeamMember(video.id, personId, "member");
  const project = (name: string, status: "planned" | "active") => createProject({ teamId: video.id, name, description: null, clientId: null, status, visibility: "team", leadPersonId: ids.tam, startDate: "2026-10-01", dueDate: "2026-11-30" }, ids.long);
  ids.tvc = (await project("TVC Tết", "planned")).id;
  ids.social = (await project("Social tháng 10", "active")).id;
  // A team without an entity numbers its projects under the group prefix.
  const group = await createTeam({ key: "GRP", name: "Group Brand", description: null, entityId: null, departmentId: null, defaultVisibility: "team", isActive: true }, "simple", {}, ids.long);
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

describe("the kick-off gate (FR-PJM-03, 12)", () => {
  it("refuses an incomplete brief, then goes to the team lead; approval takes the baseline and starts the project", async () => {
    expect(await fails(submitBrief(ids.tvc, ids.lan))).toBe("brief_incomplete");
    await updatePlanSettings(ids.tvc, { kind: "client", budgetMinutes: null, budgetByRole: [{ role: "Dựng phim", minutes: 2400 }, { role: "Đạo diễn", minutes: 1200 }], updateCadenceDays: 7, driveUrl: null });
    await updateBrief(ids.tvc, brief);
    const milestone = (await saveMilestone(ids.tvc, null, { name: "Bàn giao master", dueDate: "2026-11-28", phaseId: null, ownerPersonId: ids.tam, isClientFacing: true, isBilling: true, sortOrder: 0 })).after;

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
    expect(register.lines[0]).toMatchObject({ status: "in_production", accepted: 1, counts: { accepted: 1, in_production: 1, promised: 1 } });
    expect(register).toMatchObject({ promised: 3, accepted: 1, percent: 33 });
  });
});

describe("hours budget (FR-PJM-09)", () => {
  it("alerts the lead and the account manager once at 80% and once at 100%", async () => {
    await updatePlanSettings(ids.tvc, { kind: "client", budgetMinutes: 600, budgetByRole: [], updateCadenceDays: 7, driveUrl: null });
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
  const finance = () => viewer(ids.ke, { grants: [{ role: "finance", scope: { type: "entity", id: ids.szm } }] });
  const director = () => viewer(ids.ke, { grants: [{ role: "entity_director", scope: { type: "entity", id: ids.szm } }] });

  it("are never on a portfolio row, a plan or a CSV for a reader without it", async () => {
    await setFee(ids.tvc, 120_000_000);
    const rows = await listPortfolio(lead(), { today: todayInVietnam() });
    expect(rows.map((row) => row.name).sort()).toEqual(["Social tháng 10", "TVC Tết"]);
    for (const row of rows) expect("feeVnd" in row).toBe(false);
    expect("feeVnd" in shapePlan(await ensurePlan(ids.tvc), false)).toBe(false);
    const { file, withFees } = await buildPortfolioExport(lead(), {}, "vi");
    expect(withFees).toBe(false);
    expect(file.csv).not.toContain("120000000");
    expect(file.csv).not.toContain("VND");
  });

  it("are on them for a reader with it over the project's entity", async () => {
    // Finance reads money but is in no project: an entity director both sees the projects and reads their money.
    expect(await listPortfolio(finance(), { today: todayInVietnam() })).toEqual([]);
    const rows = await listPortfolio(director(), { today: todayInVietnam() });
    expect(rows.find((row) => row.id === ids.tvc)?.feeVnd).toBe(120_000_000);
    expect(shapePlan(await ensurePlan(ids.tvc), true).feeVnd).toBe(120_000_000);
    const { file, withFees } = await buildPortfolioExport(director(), {}, "vi");
    expect(withFees).toBe(true);
    expect(file.csv).toContain("120000000");
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
    expect(plan).toMatchObject({ jobNumber: `SZM-${year}-003`, kind: "client", budgetMinutes: 1200, updateCadenceDays: 14, brief: { objective: "Bốn video ngắn cho đợt ra mắt" } });
    const [phase] = await db().select().from(schema.projectPhase).where(eq(schema.projectPhase.projectId, project.id));
    const [milestone] = await db().select().from(schema.projectMilestone).where(eq(schema.projectMilestone.projectId, project.id));
    const [line] = await db().select().from(schema.projectDeliverable).where(eq(schema.projectDeliverable.projectId, project.id));
    expect(phase).toMatchObject({ name: "Sản xuất", startDate: "2026-12-01", endDate: "2026-12-11" });
    expect(milestone).toMatchObject({ name: "Bàn giao", dueDate: "2026-12-11", phaseId: phase.id, ownerPersonId: ids.tam, isBilling: true });
    expect(line).toMatchObject({ title: "Video ngắn TikTok", quantity: 4, milestoneId: milestone.id, dueDate: "2026-12-11" });
  });
});
