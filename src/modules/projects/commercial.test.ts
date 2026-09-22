// The commercial side against a real Postgres (PGlite): retainer months made once with their
// rollover, quota alerts once, change requests through the approval engine (with and without the
// fee step) and applied, acceptance to billing item once, a billing milestone to one item, the
// finance queue cut by entity, and a close refused, then allowed with a reason, then final.
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
import type { Principal } from "../platform/rbac/policy";
import { createProject } from "../work/projects";
import { createTeam, listStates, setTeamMember } from "../work/teams";
import { updateWorkTask } from "../work/tasks";
import { acceptanceDocument, createAcceptance, findAcceptance, sendAcceptance, signAcceptance, voidAcceptance } from "./acceptance";
import { decideBillingItem, listBillingQueue, listProjectBilling } from "./billing";
import { decideChange, getChangeLedger, listChanges, openChangesForApprover, saveChange, submitChange } from "./change-requests";
import { clientReportFigures, saveClientReport } from "./client-reports";
import { closeProject, getCloseChecklist, saveRetro } from "./close";
import { ensurePlan, isProjectClosed, setAccountManager, setFee, updatePlanSettings } from "./plans";
import { canEditPlan } from "./policy";
import { seedAcceptanceTemplate } from "./seed";
import { listPeriods, retainerConsumption, runRetainers, saveRetainer, sendQuotaAlerts, shapeRetainer } from "./retainers";
import { createTasksForLine, saveDeliverable, saveMilestone, setMilestoneDone } from "./structure";
import { summariseRetainers } from "../reports/engine/delivery";
import { loadRetainerFacts } from "../reports/retainer-source";

const ids = {} as Record<"szm" | "szc" | "long" | "tam" | "lan" | "huy" | "ke" | "keC" | "cfo" | "team" | "teamC" | "retainer" | "tvc" | "other", string>;
const fails = (promise: Promise<unknown>) => promise.then(() => "no error", (error: Error) => error.message);
const noticesOf = async (personId: string, kind: string) => db().select().from(schema.notification).where(and(eq(schema.notification.recipientPersonId, personId), eq(schema.notification.kind, kind)));
const principalOf = (personId: string, grants: Principal["grants"]): Principal => ({ personId, workforceType: "employee", grants });
let done = "";

async function finishTasks(taskIds: readonly string[]) {
  for (const taskId of taskIds) await updateWorkTask(taskId, { stateId: done }, ids.huy);
}

async function scanFor(ownerId: string): Promise<string> {
  const [file] = await db()
    .insert(schema.storedFile)
    .values({ bucket: "test", objectPath: `project_acceptance/${ownerId}.pdf`, fileName: "bien-ban.pdf", contentType: "application/pdf", sizeBytes: 1000, ownerType: "project_acceptance", ownerId, entityId: ids.szm, tier: "personal", status: "ready", uploadedByPersonId: ids.lan })
    .returning();
  return file.id;
}

beforeAll(async () => {
  await migrateTestDb();
  const [szm] = await db().insert(schema.entity).values({ code: "SZM", legalName: "Công ty TNHH SuZu Media", shortName: "Media", address: "Quận Phú Nhuận", taxCode: "0312345678" }).returning();
  const [szc] = await db().insert(schema.entity).values({ code: "SZC", legalName: "SuZu Creative", shortName: "Creative" }).returning();
  ids.szm = szm.id;
  ids.szc = szc.id;
  for (const [key, name, entity] of [["long", "Long Dang", szm.id], ["tam", "Tam Bui", szm.id], ["lan", "Lan Tran", szm.id], ["huy", "Huy Ho", szm.id], ["ke", "Ke Toan", szm.id], ["keC", "Ke Toan C", szc.id], ["cfo", "Giam Doc Tai Chinh", szm.id]] as const) {
    const [row] = await db().insert(schema.person).values({ fullName: name, searchName: name.toLowerCase(), workEmail: `${key}@suzu.group`, status: "active", primaryEntityId: entity }).returning();
    ids[key] = row.id;
  }
  await db().insert(schema.roleAssignment).values([
    { personId: ids.ke, role: "finance", scopeType: "entity", scopeId: szm.id, validFrom: "2024-01-01" },
    { personId: ids.keC, role: "finance", scopeType: "entity", scopeId: szc.id, validFrom: "2024-01-01" },
    { personId: ids.cfo, role: "finance", scopeType: "group", scopeId: null, validFrom: "2024-01-01" },
  ]);
  const team = await createTeam({ key: "SOC", name: "Social", description: null, entityId: szm.id, departmentId: null, defaultVisibility: "team", isActive: true }, "simple", {}, ids.long);
  ids.team = team.id;
  for (const personId of [ids.tam, ids.huy, ids.lan]) await setTeamMember(team.id, personId, "member");
  done = (await listStates([team.id])).find((state) => state.category === "done")!.id;
  const project = (name: string) => createProject({ teamId: team.id, name, description: null, clientId: null, status: "active", visibility: "team", leadPersonId: ids.tam, startDate: null, dueDate: "2026-12-31" }, ids.long);
  ids.retainer = (await project("Retainer Fanpage")).id;
  ids.tvc = (await project("TVC Tết")).id;
  for (const projectId of [ids.retainer, ids.tvc]) await setAccountManager(projectId, ids.lan);
  const [client] = await db().insert(schema.workClient).values({ code: "BIBO", name: "Công ty Bibo", entityId: szm.id }).returning();
  await db().update(schema.workProject).set({ clientId: client.id }).where(eq(schema.workProject.id, ids.tvc));
  expect(await seedAcceptanceTemplate(db() as never)).toEqual({ seeded: 1 });
  expect(await seedAcceptanceTemplate(db() as never)).toEqual({ seeded: 0 });
  const teamC = await createTeam({ key: "CRE", name: "Creative", description: null, entityId: szc.id, departmentId: null, defaultVisibility: "team", isActive: true }, "simple", {}, ids.long);
  ids.teamC = teamC.id;
  ids.other = (await createProject({ teamId: teamC.id, name: "Creative job", description: null, clientId: null, status: "active", visibility: "team", leadPersonId: ids.long, startDate: null, dueDate: null }, ids.long)).id;
});

describe("retainer months (FR-PJM-06)", () => {
  it("is refused on a project that is not a retainer", async () => {
    expect(await fails(saveRetainer(ids.tvc, { startMonth: "2026-10", endMonth: null, lines: [{ title: "Post", quantity: 1, format: null, channel: null }], minutesPerMonth: null, rollover: "reset", isActive: true }))).toBe("retainer_not_retainer_project");
  });

  it("makes each month once, carrying unused and over-delivered units forward, and bills a closed month once", async () => {
    await updatePlanSettings(ids.retainer, { kind: "retainer", budgetMinutes: null, budgetByRole: [], updateCadenceDays: 7, driveUrl: null });
    await saveRetainer(ids.retainer, {
      startMonth: "2026-10",
      endMonth: "2026-12",
      lines: [
        { title: "Bài đăng Facebook", quantity: 4, format: "post", channel: "facebook" },
        { title: "Video TikTok", quantity: 2, format: "short_video", channel: "tiktok" },
      ],
      minutesPerMonth: 1200,
      rollover: "rollover",
      isActive: true,
      feePerMonthVnd: 30_000_000,
    });
    expect(await runRetainers("2026-10-15")).toEqual({ periods: 1, closed: 0, billed: 0 });
    expect(await runRetainers("2026-10-15")).toEqual({ periods: 0, closed: 0, billed: 0 });

    const [retainer] = await db().select().from(schema.projectRetainer).where(eq(schema.projectRetainer.projectId, ids.retainer));
    let periods = await listPeriods(retainer, true);
    const october = periods[0];
    expect(october.lines.map((line) => [line.title, line.quantity])).toEqual([["Bài đăng Facebook", 4], ["Video TikTok", 2]]);
    // October: 1 post of 4, but 3 videos of 2.
    const posts = october.lines.find((line) => line.title === "Bài đăng Facebook")!;
    const videos = october.lines.find((line) => line.title === "Video TikTok")!;
    await finishTasks((await createTasksForLine(posts.id, { count: 1, assigneePersonId: null, dueDate: null }, ids.tam)).taskIds);
    await finishTasks((await createTasksForLine(videos.id, { count: 3, assigneePersonId: null, dueDate: null }, ids.tam)).taskIds);

    // The first run in November makes November and closes October with its fee.
    expect(await runRetainers("2026-11-01")).toEqual({ periods: 1, closed: 1, billed: 1 });
    expect(await runRetainers("2026-11-02")).toEqual({ periods: 0, closed: 0, billed: 0 });
    periods = await listPeriods(retainer, true);
    const november = periods.find((view) => view.period.month === "2026-11")!;
    expect(november.period.carried).toEqual({ "Bài đăng Facebook": 3, "Video TikTok": -1 });
    expect(november.lines.map((line) => [line.title, line.quantity])).toEqual([["Bài đăng Facebook", 7], ["Video TikTok", 1]]);
    const oct = periods.find((view) => view.period.month === "2026-10")!;
    expect(oct.period.status).toBe("closed");
    expect(oct.lines.find((line) => line.title === "Video TikTok")!.usage).toMatchObject({ consumed: 3, percent: 150, level: "over" });
    expect(oct).toMatchObject({ feeVnd: 30_000_000, billing: { status: "ready" } });
    // Without pjm:commercial there is no fee on a month, nor on the terms, at all.
    expect("feeVnd" in (await listPeriods(retainer, false))[0]).toBe(false);
    expect("feePerMonthVnd" in shapeRetainer(retainer, false)).toBe(false);
    expect(shapeRetainer(retainer, true).feePerMonthVnd).toBe(30_000_000);

    const items = await db().select().from(schema.projectBillingItem).where(eq(schema.projectBillingItem.projectId, ids.retainer));
    expect(items).toMatchObject([{ source: "retainer", amountVnd: 30_000_000, entityId: ids.szm, status: "ready" }]);
    expect(await noticesOf(ids.ke, "projects.billing_ready")).toHaveLength(1);
    // A catch-up after the end month makes December and nothing after it.
    expect(await runRetainers("2027-02-10")).toEqual({ periods: 1, closed: 2, billed: 2 });
    expect((await listPeriods(retainer, true)).map((view) => view.period.month)).toEqual(["2026-12", "2026-11", "2026-10"]);
  });

  it("warns the account manager and the lead at 80% and 100% of a line, once", async () => {
    await db().update(schema.projectRetainerPeriod).set({ status: "open", closedAt: null });
    const [retainer] = await db().select().from(schema.projectRetainer).where(eq(schema.projectRetainer.projectId, ids.retainer));
    const december = (await listPeriods(retainer, true)).find((view) => view.period.month === "2026-12")!;
    // Only December stays open for this test.
    await db().update(schema.projectRetainerPeriod).set({ status: "closed" }).where(and(eq(schema.projectRetainerPeriod.retainerId, retainer.id), eq(schema.projectRetainerPeriod.month, "2026-10")));
    await db().update(schema.projectRetainerPeriod).set({ status: "closed" }).where(and(eq(schema.projectRetainerPeriod.retainerId, retainer.id), eq(schema.projectRetainerPeriod.month, "2026-11")));
    const video = december.lines.find((line) => line.title === "Video TikTok")!;
    // Two a month, less October's extra one in November, plus November's unused one: three.
    expect(video.quantity).toBe(3);
    await finishTasks((await createTasksForLine(video.id, { count: 3, assigneePersonId: null, dueDate: null }, ids.tam)).taskIds);
    expect(await sendQuotaAlerts()).toEqual({ alerts: 1 });
    expect(await sendQuotaAlerts()).toEqual({ alerts: 0 });
    const [lan, tam] = [await noticesOf(ids.lan, "projects.quota_alert"), await noticesOf(ids.tam, "projects.quota_alert")];
    expect([lan.length, tam.length]).toEqual([1, 1]);
    expect(lan[0].params).toMatchObject({ line: "Video TikTok", percent: 100 });
    const [period] = await db().select().from(schema.projectRetainerPeriod).where(eq(schema.projectRetainerPeriod.id, december.period.id));
    expect(period.alerted.sort()).toEqual([`${video.id}:100`, `${video.id}:80`].sort());
  });

  it("gives the delivery dashboard the retainer page's own numbers, month by month", async () => {
    // Hours on the project itself in November and on a task of it in December; one outside the range.
    const [task] = await db().select({ taskId: schema.workTask.taskId }).from(schema.workTask).where(eq(schema.workTask.projectId, ids.retainer)).limit(1);
    await db()
      .insert(schema.timeEntry)
      .values([
        { personId: ids.tam, date: "2026-11-10", weekStart: "2026-11-09", projectId: ids.retainer, minutes: 90 },
        { personId: ids.huy, date: "2026-12-03", weekStart: "2026-11-30", taskId: task.taskId, minutes: 45 },
        { personId: ids.huy, date: "2027-01-05", weekStart: "2027-01-04", projectId: ids.retainer, minutes: 600 },
      ]);
    const [retainer] = await db().select().from(schema.projectRetainer).where(eq(schema.projectRetainer.projectId, ids.retainer));
    const page = await listPeriods(retainer, false);
    const exported = await retainerConsumption([ids.retainer, ids.tvc], { from: "2026-11-01", to: "2026-12-31" });
    expect(exported.map((row) => row.month)).toEqual(["2026-11", "2026-12"]);
    for (const row of exported) {
      const view = page.find((period) => period.period.month === row.month)!;
      expect(row).toEqual({ projectId: ids.retainer, month: row.month, contracted: view.total.contracted, delivered: view.total.consumed, minutesAllowance: view.period.minutesAllowance, minutesLogged: view.loggedMinutes });
    }
    expect(exported.map((row) => row.minutesLogged)).toEqual([90, 45]);
    expect(exported.find((row) => row.month === "2026-12")!.delivered).toBe(3);
    expect(await retainerConsumption([ids.tvc], { from: "2026-10-01", to: "2026-12-31" })).toEqual([]);

    // The delivery dashboard's tile reads the same rows through its adapter.
    const facts = await loadRetainerFacts([ids.retainer], { from: "2026-11-01", to: "2026-12-31" });
    expect(facts).toEqual(exported.map((row) => ({ projectId: row.projectId, contracted: row.contracted, delivered: row.delivered, minutesAllowance: row.minutesAllowance, minutesLogged: row.minutesLogged })));
    const summary = summariseRetainers(facts!);
    expect(summary).toMatchObject({ retainers: 2, contracted: exported[0].contracted + exported[1].contracted, delivered: exported[0].delivered + exported[1].delivered, hours: { loggedMinutes: 135 } });
    expect(await loadRetainerFacts([], { from: "2026-11-01", to: "2026-12-31" })).toBeNull();
  });
});

describe("change requests (FR-PJM-11)", () => {
  it("needs the client's evidence for a client's change", async () => {
    const { after } = await saveChange(ids.tvc, null, { title: "Thêm bản 6s", description: null, requestedBy: "client", impact: { minutesDelta: 120 }, evidenceFileId: null, evidenceUrl: null }, ids.lan, { withFee: false });
    expect(after.number).toBe(1);
    expect(await fails(submitChange(after.id, ids.lan))).toBe("change_evidence_required");
  });

  it("goes to the project lead and, approved, adds lines, hours and a new due date in one go", async () => {
    await updatePlanSettings(ids.tvc, { kind: "client", budgetMinutes: 6000, budgetByRole: [], updateCadenceDays: 7, driveUrl: null });
    const line = (await saveDeliverable(ids.tvc, null, { title: "Poster", quantity: 2, format: null, channel: null, dueDate: null, milestoneId: null, sortOrder: 0 })).after;
    const { after: change } = await saveChange(
      ids.tvc,
      null,
      { title: "Thêm 2 video, bỏ poster", description: "Khách đổi kế hoạch", requestedBy: "client", impact: { deliverables: [{ title: "Video 15s", quantity: 2, format: "short_video", channel: "tiktok" }], cancelDeliverableIds: [line.id], minutesDelta: 1200, feeDeltaVnd: 99, dueDateTo: "2027-01-15" }, evidenceFileId: null, evidenceUrl: "https://mail.example/thread/1" },
      ids.lan,
      { withFee: false },
    );
    // Without pjm:commercial the fee in the input is not taken.
    expect(change.impact.feeDeltaVnd).toBeUndefined();
    const { requestId, change: submitted } = await submitChange(change.id, ids.lan);
    expect(submitted.status).toBe("submitted");
    expect(await fails(decideChange(ids.huy, requestId, { action: "approve", comment: null }))).toBe("approval_not_assignee");
    const { outcome, change: applied } = await decideChange(ids.tam, requestId, { action: "approve", comment: null });
    expect(outcome).toBe("approved");
    expect(applied.status).toBe("approved");
    expect(applied.impact.applied).toEqual({ budgetMinutesBefore: 6000, feeVndBefore: null, dueDateBefore: "2026-12-31" });

    expect((await ensurePlan(ids.tvc)).budgetMinutes).toBe(7200);
    const [project] = await db().select().from(schema.workProject).where(eq(schema.workProject.id, ids.tvc));
    expect(project.dueDate).toBe("2027-01-15");
    const lines = await db().select().from(schema.projectDeliverable).where(eq(schema.projectDeliverable.projectId, ids.tvc));
    expect(lines.find((row) => row.title === "Video 15s")).toMatchObject({ quantity: 2, changeRequestId: change.id });
    expect(lines.find((row) => row.id === line.id)?.cancelledAt).not.toBeNull();
    expect(await noticesOf(ids.lan, "projects.change_decided")).toHaveLength(1);

    const ledger = await getChangeLedger(ids.tvc, false);
    expect(ledger.original).toEqual({ budgetMinutes: 6000, feeVnd: null, dueDate: "2026-12-31" });
    expect(ledger.current).toEqual({ budgetMinutes: 7200, feeVnd: null, dueDate: "2027-01-15" });
  });

  it("asks a pjm:commercial holder over the entity as well when the fee moves, and never shows the fee without it", async () => {
    await setFee(ids.tvc, 100_000_000);
    const { after: change } = await saveChange(ids.tvc, null, { title: "Tăng phí", description: null, requestedBy: "internal", impact: { feeDeltaVnd: 20_000_000 }, evidenceFileId: null, evidenceUrl: null }, ids.lan, { withFee: true });
    const { requestId } = await submitChange(change.id, ids.lan);
    const first = await decideChange(ids.tam, requestId, { action: "approve", comment: null });
    expect(first.outcome).toBe("pending");
    expect((await ensurePlan(ids.tvc)).feeVnd).toBe(100_000_000);
    // The finance person of the other entity is not asked; the one of this entity is.
    expect(await fails(decideChange(ids.keC, requestId, { action: "approve", comment: null }))).toBe("approval_not_assignee");
    const second = await decideChange(ids.ke, requestId, { action: "approve", comment: null });
    expect(second.outcome).toBe("approved");
    expect((await ensurePlan(ids.tvc)).feeVnd).toBe(120_000_000);

    const hidden = await listChanges(ids.tvc, false);
    for (const row of hidden) {
      expect(row.impact.feeDeltaVnd).toBeUndefined();
      expect(row.impact.applied?.feeVndBefore ?? null).toBeNull();
    }
    expect(JSON.stringify(hidden)).not.toContain("20000000");
    const ledger = await getChangeLedger(ids.tvc, false);
    expect(JSON.stringify(ledger)).not.toContain("100000000");
    // The lead approved it without pjm:commercial: on the approver's own view the fee is not there either.
    const asApprover = await openChangesForApprover({ personId: ids.tam, principal: principalOf(ids.tam, []) }, ids.tvc);
    expect(asApprover?.seesFees).toBe(false);
    expect(JSON.stringify(asApprover?.changes.map((change) => [change.impact, change.title]))).not.toContain("20000000");
    expect((await getChangeLedger(ids.tvc, true)).current.feeVnd).toBe(120_000_000);
  });

  it("keeps a budget by role and the approved changes in step", async () => {
    const { after } = await updatePlanSettings(ids.tvc, { kind: "client", budgetMinutes: null, budgetByRole: [{ role: "Dựng phim", minutes: 6000 }], updateCadenceDays: 7, driveUrl: null });
    expect(after.budgetMinutes).toBe(7200);
  });
});

describe("acceptance and billing (FR-PJM-55, 56)", () => {
  it("snapshots a milestone's lines, signs once, and hands finance one item with the acceptance attached", async () => {
    const milestone = (await saveMilestone(ids.tvc, null, { name: "Bàn giao master", dueDate: "2026-12-20", phaseId: null, ownerPersonId: ids.tam, isClientFacing: true, isBilling: true, billingAmountVnd: 50_000_000, sortOrder: 0 })).after;
    const line = (await saveDeliverable(ids.tvc, null, { title: "TVC 30s", quantity: 1, format: null, channel: null, dueDate: null, milestoneId: milestone.id, sortOrder: 0 })).after;
    await finishTasks((await createTasksForLine(line.id, { count: 1, assigneePersonId: null, dueDate: null }, ids.tam)).taskIds);

    const internal = (await saveMilestone(ids.tvc, null, { name: "Duyệt nội bộ", dueDate: null, phaseId: null, ownerPersonId: null, isClientFacing: false, isBilling: false, sortOrder: 1 })).after;
    expect(await fails(createAcceptance(ids.tvc, { scope: "milestone", milestoneId: internal.id, retainerPeriodId: null }, ids.lan))).toBe("acceptance_milestone_internal");

    const acceptance = await createAcceptance(ids.tvc, { scope: "milestone", milestoneId: milestone.id, retainerPeriodId: null }, ids.lan);
    expect(acceptance.items).toEqual([{ deliverableId: line.id, title: "TVC 30s", promised: 1, delivered: 0, accepted: 1, links: [] }]);
    await sendAcceptance(acceptance.id);
    const { after, billingItemId } = await signAcceptance(acceptance.id, { signedFileId: await scanFor(acceptance.id), signedOn: "2026-09-20", signedByClient: "Nguyễn Văn Khách" }, ids.lan);
    expect(after).toMatchObject({ status: "signed", signedByClient: "Nguyễn Văn Khách" });
    expect(await fails(signAcceptance(acceptance.id, { signedFileId: await scanFor(`${acceptance.id}-2`), signedOn: "2026-09-20", signedByClient: "X" }, ids.lan))).toBe("acceptance_wrong_status");
    expect(await fails(voidAcceptance(acceptance.id))).toBe("acceptance_wrong_status");

    // Marking the milestone done afterwards finds the same item.
    await setMilestoneDone(milestone.id, true, ids.tam);
    const items = await db().select().from(schema.projectBillingItem).where(eq(schema.projectBillingItem.milestoneId, milestone.id));
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ id: billingItemId, source: "milestone", acceptanceId: acceptance.id, amountVnd: 50_000_000 });
    expect(await noticesOf(ids.tam, "projects.acceptance_signed")).toHaveLength(1);
    expect(await noticesOf(ids.ke, "projects.acceptance_signed")).toHaveLength(1);

    // The paper: the entity's letterhead, the items, and no money anywhere.
    const paper = await acceptanceDocument((await findAcceptance(acceptance.id))!, { scope: { milestone: "Theo mốc", retainer_period: "Theo tháng", project: "Toàn dự án" }, promised: "Cam kết", delivered: "Đã giao", accepted: "Đã duyệt", totals: (totals) => `${totals.accepted}/${totals.promised}` });
    expect(paper.letterhead).toMatchObject({ companyName: "Công ty TNHH SuZu Media", taxCode: "0312345678" });
    expect(paper.number).toMatch(/^SZM-\d{2}-\d{3}\/NT-01$/);
    expect(paper.title).toBe("Biên bản nghiệm thu");
    expect(paper.text).toContain("TVC Tết");
    expect(paper.text).toContain("Công ty Bibo");
    expect(paper.text).toContain("1. TVC 30s — Cam kết: 1; Đã giao: 0; Đã duyệt: 1");
    expect(paper.text).toContain("ngày 20/09/2026");
    expect(paper.missing).toEqual([]);
    expect(paper.text).not.toMatch(/50[.,]?000[.,]?000|120[.,]?000[.,]?000/);
  });

  it("bills a billing milestone once, however often it is marked done", async () => {
    const milestone = (await saveMilestone(ids.tvc, null, { name: "Tạm ứng 30%", dueDate: null, phaseId: null, ownerPersonId: null, isClientFacing: false, isBilling: true, billingAmountVnd: 30_000_000, sortOrder: 2 })).after;
    const before = (await noticesOf(ids.ke, "projects.billing_ready")).length;
    const first = await setMilestoneDone(milestone.id, true, ids.tam);
    await setMilestoneDone(milestone.id, false, ids.tam);
    const again = await setMilestoneDone(milestone.id, true, ids.tam);
    expect(first.billingItemId).not.toBeNull();
    expect(again.billingItemId).toBeNull();
    expect(await db().select().from(schema.projectBillingItem).where(eq(schema.projectBillingItem.milestoneId, milestone.id))).toHaveLength(1);
    expect((await noticesOf(ids.ke, "projects.billing_ready")).length).toBe(before + 1);
  });

  it("bills a whole-project acceptance with the fee the milestones have not billed", async () => {
    const acceptance = await createAcceptance(ids.tvc, { scope: "project", milestoneId: null, retainerPeriodId: null }, ids.lan);
    const { billingItemId } = await signAcceptance(acceptance.id, { signedFileId: await scanFor(acceptance.id), signedOn: "2026-09-21", signedByClient: "Khách" }, ids.lan);
    const [item] = await db().select().from(schema.projectBillingItem).where(eq(schema.projectBillingItem.id, billingItemId!));
    // Fee 120m less the milestones' 50m and 30m.
    expect(item).toMatchObject({ source: "acceptance", acceptanceId: acceptance.id, amountVnd: 40_000_000 });
    // Never an amount for a reader without pjm:commercial.
    for (const row of await listProjectBilling(ids.tvc, false)) expect("amountVnd" in row).toBe(false);
    expect((await listProjectBilling(ids.tvc, true)).every((row) => "amountVnd" in row)).toBe(true);
  });

  it("shows finance only its entities' items, and records the invoice for the account manager", async () => {
    await ensurePlan(ids.other);
    const { createManualBillingItem } = await import("./billing");
    await createManualBillingItem(ids.other, { description: "Phí thiết kế", reference: null, amountVnd: 5_000_000 }, ids.keC);
    const szm = await listBillingQueue(principalOf(ids.ke, [{ role: "finance", scope: { type: "entity", id: ids.szm } }]), { status: "all" });
    const szc = await listBillingQueue(principalOf(ids.keC, [{ role: "finance", scope: { type: "entity", id: ids.szc } }]), { status: "all" });
    const group = await listBillingQueue(principalOf(ids.cfo, [{ role: "finance", scope: { type: "group" } }]), { status: "all" });
    expect(szm.length).toBeGreaterThan(0);
    expect(szm.every((item) => item.entityId === ids.szm)).toBe(true);
    expect(szc.map((item) => item.projectId)).toEqual([ids.other]);
    expect(group.length).toBe(szm.length + szc.length);
    expect(await listBillingQueue(principalOf(ids.tam, []), { status: "all" })).toEqual([]);
    expect((await listBillingQueue(principalOf(ids.cfo, [{ role: "finance", scope: { type: "group" } }]), { status: "all", entityId: ids.szc })).map((item) => item.projectId)).toEqual([ids.other]);

    const item = szm.find((row) => row.status === "ready")!;
    await decideBillingItem(item.id, { action: "invoice", invoiceNumber: "HD-0001", invoiceDate: "2026-09-22", amountVnd: null }, ids.ke);
    expect(await fails(decideBillingItem(item.id, { action: "waive", reason: "x" }, ids.ke))).toBe("billing_decided");
    expect((await noticesOf(ids.lan, "projects.billing_invoiced")).length).toBeGreaterThan(0);
  });
});

describe("client report (FR-PJM-58)", () => {
  it("counts the register without a fee, and hours only when asked", async () => {
    const { after } = await saveClientReport(ids.tvc, null, { title: "Báo cáo tháng 9", periodFrom: "2026-09-01", periodTo: "2026-09-30", summary: "Ổn", nextPlan: null, showHours: false }, ids.lan);
    const figures = await clientReportFigures(ids.tvc, { from: after.periodFrom, to: after.periodTo }, { showHours: false });
    expect(figures.register.promised).toBeGreaterThan(0);
    expect(figures).not.toHaveProperty("hours");
    expect(JSON.stringify(figures)).not.toMatch(/120000000|feeVnd|amountVnd/);
    expect((await clientReportFigures(ids.tvc, { from: after.periodFrom, to: after.periodTo }, { showHours: true })).hours).toEqual({ loggedMinutes: 0, billableMinutes: 0 });
  });
});

describe("close-out (FR-PJM-59)", () => {
  it("is refused with items unmet, allowed with a reason, and final", async () => {
    const checklist = await getCloseChecklist(ids.tvc);
    expect(checklist.filter((item) => !item.met).map((item) => item.key)).toEqual(expect.arrayContaining(["drive", "retro", "billing"]));
    expect(await fails(closeProject(ids.tvc, { overrideReason: null }, ids.tam))).toBe("close_unmet");

    await saveRetro(ids.tvc, { title: "Retrospective", heldOn: "2026-09-20", attendeeIds: [], retro: { wentWell: "Đúng hạn", improve: "Brief rõ hơn", actions: "Mẫu brief mới" } }, ids.tam);
    expect((await getCloseChecklist(ids.tvc)).find((item) => item.key === "retro")?.met).toBe(true);

    const { plan, report } = await closeProject(ids.tvc, { overrideReason: "Khách chưa thanh toán, đã báo C-level" }, ids.tam);
    expect(plan.closedAt).not.toBeNull();
    expect(report.unmet).toEqual(expect.arrayContaining(["drive", "billing"]));
    expect(report.overrideReason).toBe("Khách chưa thanh toán, đã báo C-level");
    expect(report.hours.budgetMinutes).toBe(7200);
    const [project] = await db().select().from(schema.workProject).where(eq(schema.workProject.id, ids.tvc));
    expect(project.status).toBe("done");

    expect(await isProjectClosed(ids.tvc)).toBe(true);
    const facts = { id: ids.tvc, entityId: ids.szm, visibility: "team" as const, team: { id: ids.team, entityId: ids.szm, departmentId: null, defaultVisibility: "team" as const }, closed: await isProjectClosed(ids.tvc) };
    const lead = { principal: principalOf(ids.tam, []), entityId: ids.szm, teamRoles: new Map(), projectRoles: new Map([[ids.tvc, "lead" as const]]) };
    expect(canEditPlan(lead, facts)).toBe(false);
    expect(await fails(closeProject(ids.tvc, { overrideReason: "again" }, ids.tam))).toBe("project_closed");
  });
});
