// Phase 12, R2 — retainers, billing and acceptance — against a real Postgres (PGlite):
//
//  · a retainer month can be worked: its lines carry their register counts, a task (a finished one
//    too) is put on a line and taken off without losing its milestone, the pickers name the month
//    and put this month first, the hours allowance alerts at 80% and 100% once each, and a month
//    the job never made is made on demand inside the terms and never twice (PJM-07);
//  · billing and acceptance have correction paths and nothing fails silently: a milestone with no
//    register lines is accepted in words and bills, a billing milestone says why it has not billed,
//    an amount is corrected before invoicing with the figures kept off the audit log, a signed
//    record is corrected until it is invoiced, a milestone with paper or money on it is not
//    deleted, the queue's total is Postgres's and the list's access check is one answer (PJM-08);
//  · the biên bản that was issued is the one that is kept (CHR-01);
//  · the job number reaches the work in one read (PJM-09).
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => import("../../../tests/helpers/db"));
vi.mock("@/lib/env", () => ({ env: () => ({ BETTER_AUTH_URL: "https://suzu.one" }) }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("@/modules/platform/files/storage", () => import("../../../tests/helpers/storage"));

// Each action's pipeline is kept as it was built, so its rule can be asked and its audit payload read here.
type Pipeline = {
  name: string;
  authorize: (user: unknown, input: Record<string, unknown>) => boolean | Promise<boolean>;
  run: (context: { user: unknown; input: Record<string, unknown> }) => Promise<{ data: unknown; audit: Record<string, unknown> }>;
};
const pipelines = new Map<string, Pipeline>();
vi.mock("@/lib/action", () => ({
  ActionError: class ActionError extends Error {
    constructor(
      message: string,
      readonly details?: unknown,
    ) {
      super(message);
    }
  },
  createAction: (config: Pipeline) => {
    pipelines.set(config.name, config);
    return async () => ({ ok: false, error: "stub" });
  },
}));

import { and, count, eq } from "drizzle-orm";
import { todayInVietnam } from "@/lib/dates";
import { db, schema } from "@/lib/db";
import { migrateTestDb } from "../../../tests/helpers/db";
import { storedObjects } from "../../../tests/helpers/storage";
import { workflow } from "../../../tests/helpers/workflows";
import type { Principal } from "../platform/rbac/policy";
import { createProject } from "../work/projects";
import { createWorkTask, updateWorkTask } from "../work/tasks";
import { createTeam, listStates, setTeamMember } from "../work/teams";
import { acceptanceDocument, correctSignedAcceptance, createAcceptance, findAcceptance, isScanOf, issuedPaper, listAcceptances, refreshAcceptance, sendAcceptance, signAcceptance, voidAcceptance } from "./acceptance";
import { correctBillingAmount, decideBillingItem, listProjectBilling, milestoneBilling, readyBillingTotal } from "./billing";
import { addMonths, monthOf } from "./engine/retainer";
import { jobNumbersOf } from "./job-numbers";
import { ensurePlan, setAccountManager, updatePlanSettings } from "./plans";
import { listMissedMonths, listPeriods, makeMissedPeriod, runRetainers, saveRetainer, sendQuotaAlerts } from "./retainers";
import { seedAcceptanceTemplate } from "./seed";
import { deleteMilestone, saveDeliverable, saveMilestone, setMilestoneDone } from "./structure";
import { setTaskLine, taskLineOptions } from "./task-line";
import { openableProjectIds } from "./views";

const ids = {} as Record<"szm" | "szc" | "long" | "tam" | "lan" | "huy" | "ke" | "team" | "teamC" | "retainer" | "tvc" | "house" | "other" | "private", string>;
const fails = (promise: Promise<unknown>) =>
  promise.then(
    () => "no error",
    (error: Error) => error.message,
  );
const noticesOf = async (personId: string, kind: string) =>
  db()
    .select()
    .from(schema.notification)
    .where(and(eq(schema.notification.recipientPersonId, personId), eq(schema.notification.kind, kind)));
const principalOf = (personId: string, grants: Principal["grants"] = []): Principal => ({ personId, workforceType: "employee", grants });
const userOf = (personId: string, grants: Principal["grants"] = []) => ({ person: { id: personId, primaryEntityId: ids.szm }, principal: principalOf(personId, grants) }) as never;
const finance = () => principalOf(ids.ke, [{ role: "finance", scope: { type: "entity", id: ids.szm } }]);
const words = {
  title: "Biên bản nghiệm thu",
  scope: { milestone: "Theo mốc", retainer_period: "Theo tháng", project: "Toàn dự án" },
  promised: "Cam kết",
  delivered: "Đã giao",
  accepted: "Đã duyệt",
  totals: (totals: { promised: number; accepted: number }) => `${totals.accepted}/${totals.promised}`,
  described: "Theo mô tả",
};
const today = todayInVietnam();
const thisMonth = monthOf(today);
const lastMonth = addMonths(thisMonth, -1);
const firstMonth = addMonths(thisMonth, -2);
let done = "";

async function scanFor(ownerId: string, fileName = "bien-ban.pdf"): Promise<string> {
  const [file] = await db()
    .insert(schema.storedFile)
    .values({
      bucket: "test",
      objectPath: `project_acceptance/${ownerId}-${fileName}`,
      fileName,
      contentType: "application/pdf",
      sizeBytes: 1000,
      ownerType: "project_acceptance",
      ownerId,
      entityId: ids.szm,
      tier: "personal",
      status: "ready",
      uploadedByPersonId: ids.lan,
    })
    .returning();
  return file.id;
}
const fileOf = async (fileId: string) => (await db().select().from(schema.storedFile).where(eq(schema.storedFile.id, fileId)))[0];
const retainerRow = async () => (await db().select().from(schema.projectRetainer).where(eq(schema.projectRetainer.projectId, ids.retainer)))[0];

beforeAll(async () => {
  await migrateTestDb();
  await import("./commercial-actions");
  await import("./line-actions");
  const [szm] = await db().insert(schema.entity).values({ code: "SZM", legalName: "Công ty TNHH SuZu Media", shortName: "Media", address: "Quận Phú Nhuận", taxCode: "0312345678" }).returning();
  const [szc] = await db().insert(schema.entity).values({ code: "SZC", legalName: "SuZu Creative", shortName: "Creative" }).returning();
  ids.szm = szm.id;
  ids.szc = szc.id;
  for (const [key, name] of [
    ["long", "Long Dang"],
    ["tam", "Tam Bui"],
    ["lan", "Lan Tran"],
    ["huy", "Huy Ho"],
    ["ke", "Ke Toan"],
  ] as const) {
    const [row] = await db()
      .insert(schema.person)
      .values({ fullName: name, searchName: name.toLowerCase(), workEmail: `${key}@suzu.group`, status: "active", primaryEntityId: szm.id })
      .returning();
    ids[key] = row.id;
  }
  await db().insert(schema.roleAssignment).values({ personId: ids.ke, role: "finance", scopeType: "entity", scopeId: szm.id, validFrom: "2024-01-01" });
  const team = await createTeam({ key: "SOC", name: "Social", description: null, entityId: szm.id, departmentId: null, defaultVisibility: "team", isActive: true }, workflow("simple"), ids.long);
  ids.team = team.id;
  for (const personId of [ids.tam, ids.huy, ids.lan]) await setTeamMember(team.id, personId, "member");
  done = (await listStates([team.id])).find((state) => state.category === "done")!.id;
  const project = (name: string, startDate: string | null = null, visibility: "team" | "private" = "team") =>
    createProject({ teamId: team.id, name, description: null, clientId: null, status: "active", visibility, leadPersonId: ids.tam, startDate, dueDate: null }, ids.long);
  // The retainer began two months ago; its terms are only entered today — the cut-over.
  ids.retainer = (await project("Retainer Fanpage", `${firstMonth}-01`)).id;
  ids.tvc = (await project("TVC Tết")).id;
  ids.house = (await project("Showreel nội bộ")).id;
  ids.private = (await project("Dự án kín", null, "private")).id;
  for (const projectId of [ids.retainer, ids.tvc]) await setAccountManager(projectId, ids.lan);
  const [client] = await db().insert(schema.workClient).values({ code: "BIBO", name: "Công ty Bibo", entityId: szm.id }).returning();
  await db().update(schema.workProject).set({ clientId: client.id }).where(eq(schema.workProject.id, ids.tvc));
  await seedAcceptanceTemplate(db() as never);
  const teamC = await createTeam({ key: "CRE", name: "Creative", description: null, entityId: szc.id, departmentId: null, defaultVisibility: "team", isActive: true }, workflow("simple"), ids.long);
  ids.teamC = teamC.id;
  ids.other = (await createProject({ teamId: teamC.id, name: "Creative job", description: null, clientId: null, status: "active", visibility: "team", leadPersonId: ids.long, startDate: null, dueDate: null }, ids.long)).id;
}, 60_000);

describe("a retainer month can be worked (PJM-07)", () => {
  it("makes a month the job never made — inside the terms, once — with its register from the terms", async () => {
    await updatePlanSettings(ids.retainer, { kind: "retainer", budgetMinutes: null, budgetByRole: [], updateCadenceDays: 7, driveUrl: null });
    await saveRetainer(ids.retainer, {
      startMonth: firstMonth,
      endMonth: null,
      lines: [
        { title: "Bài đăng Facebook", quantity: 4, format: "post", channel: "facebook" },
        { title: "Video TikTok", quantity: 2, format: "short_video", channel: "tiktok" },
      ],
      minutesPerMonth: 600,
      rollover: "reset",
      isActive: true,
      feePerMonthVnd: 30_000_000,
    });
    // The job never makes a month from before the terms were saved (one month of grace): the first month is missing.
    await runRetainers(today);
    const retainer = await retainerRow();
    expect((await listPeriods(retainer, false)).map((view) => view.period.month)).toEqual([thisMonth, lastMonth]);
    expect(await listMissedMonths(retainer, today)).toEqual([firstMonth]);

    // Not before the retainer's first month, not this month or a later one, and not a month that exists.
    expect(await fails(makeMissedPeriod(ids.retainer, addMonths(firstMonth, -1), today))).toBe("retainer_month_not_missed");
    expect(await fails(makeMissedPeriod(ids.retainer, addMonths(thisMonth, 1), today))).toBe("retainer_month_not_missed");
    expect(await fails(makeMissedPeriod(ids.retainer, thisMonth, today))).toBe("retainer_month_exists");
    expect(await fails(makeMissedPeriod(ids.tvc, firstMonth, today))).toBe("retainer_not_found");

    const made = await makeMissedPeriod(ids.retainer, firstMonth, today);
    expect(made).toMatchObject({ month: firstMonth, status: "open", minutesAllowance: 600 });
    expect(await fails(makeMissedPeriod(ids.retainer, firstMonth, today))).toBe("retainer_month_exists");
    const periods = await listPeriods(retainer, false);
    expect(periods.map((view) => view.period.month)).toEqual([thisMonth, lastMonth, firstMonth]);
    expect(periods.at(-1)!.lines.map((line) => [line.title, line.quantity])).toEqual([
      ["Bài đăng Facebook", 4],
      ["Video TikTok", 2],
    ]);
    expect(await listMissedMonths(retainer, today)).toEqual([]);
    // The job finds the month made and makes nothing more.
    expect((await runRetainers(today)).periods).toBe(0);

    // A paused retainer makes no month, by hand either.
    await db().update(schema.projectRetainer).set({ isActive: false }).where(eq(schema.projectRetainer.id, retainer.id));
    expect(await fails(makeMissedPeriod(ids.retainer, firstMonth, today))).toBe("retainer_paused");
    await db().update(schema.projectRetainer).set({ isActive: true }).where(eq(schema.projectRetainer.id, retainer.id));
  });

  it("puts a finished task on a month's line and takes it off, leaving its milestone alone; the line shows what it holds", async () => {
    const retainer = await retainerRow();
    const view = (await listPeriods(retainer, false)).find((period) => period.period.month === thisMonth)!;
    const posts = view.lines.find((line) => line.title === "Bài đăng Facebook")!;
    expect(posts).toMatchObject({ status: "promised", linked: 0, accepted: 0, consumed: 0 });

    // Work finished before anybody recorded which promise it filled, already linked to a milestone.
    const milestone = (await saveMilestone(ids.retainer, null, { name: "Báo cáo tháng", dueDate: null, phaseId: null, ownerPersonId: null, isClientFacing: false, isBilling: false, sortOrder: 0 })).after;
    const { task } = await createWorkTask({ teamId: ids.team, projectId: ids.retainer, title: "Bài đăng 1/10" }, ids.tam);
    await updateWorkTask(task.id, { stateId: done }, ids.huy);
    await db().insert(schema.projectTaskLink).values({ taskId: task.id, milestoneId: milestone.id });

    const linked = await setTaskLine(task.id, posts.id);
    expect(linked).toMatchObject({ projectId: ids.retainer, after: { deliverableId: posts.id, milestoneId: milestone.id } });
    // The month's line now carries the task as one of its units, with the register's reading of it.
    const after = (await listPeriods(retainer, false)).find((period) => period.period.month === thisMonth)!.lines.find((line) => line.id === posts.id)!;
    expect(after.linked).toBe(1);
    expect(after.status).not.toBe("promised");
    expect(Object.values(after.counts).reduce((sum, units) => sum + units, 0)).toBe(4);

    // A line of another project, and a withdrawn line, take no work.
    const foreign = (await saveDeliverable(ids.tvc, null, { title: "TVC 30s", quantity: 1, format: null, channel: null, dueDate: null, milestoneId: null, sortOrder: 0 })).after;
    expect(await fails(setTaskLine(task.id, foreign.id))).toBe("deliverable_not_found");
    const videos = view.lines.find((line) => line.title === "Video TikTok")!;
    await db().update(schema.projectDeliverable).set({ cancelledAt: new Date() }).where(eq(schema.projectDeliverable.id, videos.id));
    expect(await fails(setTaskLine(task.id, videos.id))).toBe("deliverable_cancelled");
    await db().update(schema.projectDeliverable).set({ cancelledAt: null }).where(eq(schema.projectDeliverable.id, videos.id));

    // Off the line again: the milestone link stays.
    const off = await setTaskLine(task.id, null);
    expect(off.after).toEqual({ deliverableId: null, milestoneId: milestone.id, phaseId: null });
    expect((await listPeriods(retainer, false)).find((period) => period.period.month === thisMonth)!.lines.find((line) => line.id === posts.id)).toMatchObject({ linked: 0, consumed: 0, status: "promised" });
    await setTaskLine(task.id, posts.id);
  });

  it("offers a task the open lines with their month, this month first, and keeps the line it is on in the list", async () => {
    const retainer = await retainerRow();
    await db().update(schema.projectRetainerPeriod).set({ status: "open" }).where(eq(schema.projectRetainerPeriod.retainerId, retainer.id));
    const periods = await listPeriods(retainer, false);
    const [task] = await db().select({ taskId: schema.workTask.taskId }).from(schema.workTask).where(eq(schema.workTask.projectId, ids.retainer)).limit(1);
    const { current, options } = await taskLineOptions(ids.retainer, task.taskId, today);
    expect(current).toBe(periods.find((view) => view.period.month === thisMonth)!.lines.find((line) => line.title === "Bài đăng Facebook")!.id);
    // Three open months of the same two lines: no label repeats, and this month's come first.
    expect(options.map((option) => option.label)).toEqual([
      `${thisMonth} · 4 × Bài đăng Facebook`,
      `${thisMonth} · 2 × Video TikTok`,
      `${lastMonth} · 4 × Bài đăng Facebook`,
      `${lastMonth} · 2 × Video TikTok`,
      `${firstMonth} · 4 × Bài đăng Facebook`,
      `${firstMonth} · 2 × Video TikTok`,
    ]);

    // A closed month's lines leave the picker — except the line the task is on.
    await db().update(schema.projectRetainerPeriod).set({ status: "closed" }).where(eq(schema.projectRetainerPeriod.retainerId, retainer.id));
    const closed = await taskLineOptions(ids.retainer, task.taskId, today);
    expect(closed.options.map((option) => option.id)).toEqual([current]);
    await db().update(schema.projectRetainerPeriod).set({ status: "open" }).where(eq(schema.projectRetainerPeriod.retainerId, retainer.id));
  });

  it("warns the account manager and the lead at 80% and at 100% of the month's hours, once each", async () => {
    const retainer = await retainerRow();
    // Only this month stays open: 600 minutes allowed.
    await db().update(schema.projectRetainerPeriod).set({ status: "closed" }).where(eq(schema.projectRetainerPeriod.retainerId, retainer.id));
    await db()
      .update(schema.projectRetainerPeriod)
      .set({ status: "open" })
      .where(and(eq(schema.projectRetainerPeriod.retainerId, retainer.id), eq(schema.projectRetainerPeriod.month, thisMonth)));
    const log = (minutes: number) =>
      db()
        .insert(schema.timeEntry)
        .values({ personId: ids.huy, date: `${thisMonth}-01`, weekStart: `${thisMonth}-01`, projectId: ids.retainer, minutes });
    await log(400);
    expect(await sendQuotaAlerts()).toEqual({ alerts: 0 });
    await log(90);
    expect(await sendQuotaAlerts()).toEqual({ alerts: 1 });
    expect(await sendQuotaAlerts()).toEqual({ alerts: 0 });
    let [lan, tam] = [await noticesOf(ids.lan, "projects.retainer_hours_alert"), await noticesOf(ids.tam, "projects.retainer_hours_alert")];
    expect([lan.length, tam.length]).toEqual([1, 1]);
    expect(lan[0].params).toMatchObject({ project: "Retainer Fanpage", month: thisMonth, percent: 81 });
    await log(200);
    expect(await sendQuotaAlerts()).toEqual({ alerts: 1 });
    expect(await sendQuotaAlerts()).toEqual({ alerts: 0 });
    [lan, tam] = [await noticesOf(ids.lan, "projects.retainer_hours_alert"), await noticesOf(ids.tam, "projects.retainer_hours_alert")];
    expect([lan.length, tam.length]).toEqual([2, 2]);
    const [period] = await db()
      .select()
      .from(schema.projectRetainerPeriod)
      .where(and(eq(schema.projectRetainerPeriod.retainerId, retainer.id), eq(schema.projectRetainerPeriod.month, thisMonth)));
    expect(period.alerted.filter((key) => key.startsWith("hours:")).sort()).toEqual(["hours:100", "hours:80"]);
    // A month without an allowance never alerts on hours, however much is logged.
    await db().update(schema.projectRetainerPeriod).set({ minutesAllowance: null, alerted: [] }).where(eq(schema.projectRetainerPeriod.id, period.id));
    expect(await sendQuotaAlerts()).toEqual({ alerts: 0 });
  });
});

describe("billing and acceptance: nothing fails silently (PJM-08)", () => {
  it("accepts a billing milestone with no register lines in words, says why it has not billed, and bills it at the signature", async () => {
    const milestone = (await saveMilestone(ids.tvc, null, { name: "Tạm ứng 50%", dueDate: null, phaseId: null, ownerPersonId: null, isClientFacing: false, isBilling: true, billingAmountVnd: 40_000_000, sortOrder: 0 })).after;
    const unpriced = (await saveMilestone(ids.tvc, null, { name: "Quyết toán", dueDate: null, phaseId: null, ownerPersonId: null, isClientFacing: false, isBilling: true, billingAmountVnd: null, sortOrder: 1 })).after;

    // Marked done on a client's project: nothing goes to finance — and the plan page can say why.
    expect((await setMilestoneDone(milestone.id, true, ids.tam)).billingItemId).toBeNull();
    let billing = await milestoneBilling(ids.tvc);
    expect(billing.get(milestone.id)).toEqual({ state: "awaiting_acceptance", amountSet: true });
    expect(billing.get(unpriced.id)).toEqual({ state: "awaiting_acceptance", amountSet: false });

    // No lines under the milestone: refused without words, made with them.
    expect(await fails(createAcceptance(ids.tvc, { scope: "milestone", milestoneId: milestone.id, retainerPeriodId: null }, ids.lan))).toBe("acceptance_empty");
    expect(await fails(createAcceptance(ids.tvc, { scope: "milestone", milestoneId: milestone.id, retainerPeriodId: null, description: "   " }, ids.lan))).toBe("acceptance_empty");
    const acceptance = await createAcceptance(ids.tvc, { scope: "milestone", milestoneId: milestone.id, retainerPeriodId: null, description: "Khách xác nhận kịch bản và đồng ý tạm ứng đợt 1." }, ids.lan);
    expect(acceptance).toMatchObject({ items: [], description: "Khách xác nhận kịch bản và đồng ý tạm ứng đợt 1." });
    const paper = await acceptanceDocument(acceptance, words);
    expect(paper.text).toContain("Khách xác nhận kịch bản và đồng ý tạm ứng đợt 1.");
    expect(paper.text).toContain("Tổng hợp: Theo mô tả");
    expect(paper.missing).toEqual([]);

    // D27 still holds: the item exists only once the paper is signed.
    expect(await db().select().from(schema.projectBillingItem).where(eq(schema.projectBillingItem.milestoneId, milestone.id))).toHaveLength(0);
    const { billingItemId } = await signAcceptance(acceptance.id, { signedFileId: await scanFor(acceptance.id), signedOn: today, signedByClient: "Nguyễn Văn Khách" }, ids.lan);
    const [item] = await db().select().from(schema.projectBillingItem).where(eq(schema.projectBillingItem.id, billingItemId!));
    expect(item).toMatchObject({ source: "milestone", milestoneId: milestone.id, amountVnd: 40_000_000, status: "ready", acceptanceId: acceptance.id });
    billing = await milestoneBilling(ids.tvc);
    expect(billing.get(milestone.id)).toEqual({ state: "ready", amountSet: true });

    // Internal work has nobody to sign: its milestone waits to be marked done, and says so.
    const own = (await saveMilestone(ids.house, null, { name: "Xuất bản showreel", dueDate: null, phaseId: null, ownerPersonId: null, isClientFacing: false, isBilling: true, billingAmountVnd: 5_000_000, sortOrder: 0 })).after;
    expect((await milestoneBilling(ids.house)).get(own.id)).toEqual({ state: "awaiting_done", amountSet: true });
    expect((await setMilestoneDone(own.id, true, ids.tam)).billingItemId).not.toBeNull();
    expect((await milestoneBilling(ids.house)).get(own.id)).toEqual({ state: "ready", amountSet: true });
  });

  it("corrects the amount of an item that is not invoiced, with a reason — the figures on the item, never in the audit log", async () => {
    const [item] = await db()
      .select()
      .from(schema.projectBillingItem)
      .where(and(eq(schema.projectBillingItem.projectId, ids.tvc), eq(schema.projectBillingItem.source, "milestone")));
    expect(await fails(correctBillingAmount(item.id, { amountVnd: 40_000_000, reason: "như cũ" }, ids.ke))).toBe("billing_amount_unchanged");

    const { audit } = await pipelines.get("projects.billing.correct_amount")!.run({ user: userOf(ids.ke, finance().grants), input: { itemId: item.id, amountVnd: 45_000_000, reason: "Phụ lục 01 tăng đợt tạm ứng" } });
    const [corrected] = await db().select().from(schema.projectBillingItem).where(eq(schema.projectBillingItem.id, item.id));
    expect(corrected.amountVnd).toBe(45_000_000);
    expect(corrected.corrections).toMatchObject([{ byPersonId: ids.ke, reason: "Phụ lục 01 tăng đợt tạm ứng", beforeVnd: 40_000_000, afterVnd: 45_000_000 }]);
    expect(audit).toMatchObject({ before: { amountSet: true }, after: { amountSet: true, amountChanged: true, reason: "Phụ lục 01 tăng đợt tạm ứng" } });
    expect(JSON.stringify(audit)).not.toMatch(/40[._,]?000[._,]?000|45[._,]?000[._,]?000|40000000|45000000/);

    // A reader without the fee gets neither the amount nor the amounts it had.
    const hidden = await listProjectBilling(ids.tvc, false);
    expect(hidden.every((row) => !("amountVnd" in row) && row.corrections.length === 0)).toBe(true);
    expect(JSON.stringify(hidden)).not.toContain("45000000");
    expect((await listProjectBilling(ids.tvc, true)).find((row) => row.id === item.id)).toMatchObject({ amountVnd: 45_000_000, corrections: [{ beforeVnd: 40_000_000 }] });

    // An item made without an amount gets one; a settled item is not rewritten.
    const [internal] = await db().select().from(schema.projectBillingItem).where(eq(schema.projectBillingItem.projectId, ids.house));
    await correctBillingAmount(internal.id, { amountVnd: null, reason: "Chưa thoả thuận" }, ids.ke);
    expect((await correctBillingAmount(internal.id, { amountVnd: 6_000_000, reason: "Đã chốt" }, ids.ke)).after).toMatchObject({ amountVnd: 6_000_000 });
    await decideBillingItem(internal.id, { action: "invoice", invoiceNumber: "HD-001", invoiceDate: today, amountVnd: null }, ids.ke);
    expect(await fails(correctBillingAmount(internal.id, { amountVnd: 7_000_000, reason: "muộn" }, ids.ke))).toBe("billing_decided");
  });

  it("corrects a signed record's scan, signer and date with a reason, keeps what it said before, and stops once it is invoiced", async () => {
    const [acceptance] = (await listAcceptances(ids.tvc)).filter((row) => row.status === "signed");
    const firstScan = acceptance.signedFileId!;
    const draft = await createAcceptance(ids.tvc, { scope: "project", milestoneId: null, retainerPeriodId: null, description: "Toàn bộ dự án" }, ids.lan);
    expect(await fails(correctSignedAcceptance(draft.id, { signedFileId: null, signedOn: today, signedByClient: "X", reason: "nhầm" }, ids.lan))).toBe("acceptance_wrong_status");
    await voidAcceptance(draft.id);

    expect(await fails(correctSignedAcceptance(acceptance.id, { signedFileId: null, signedOn: acceptance.signedOn!, signedByClient: acceptance.signedByClient!, reason: "không đổi gì" }, ids.lan))).toBe("acceptance_correction_empty");
    const newScan = await scanFor(acceptance.id, "bien-ban-dung.pdf");
    const { after } = await correctSignedAcceptance(acceptance.id, { signedFileId: newScan, signedOn: today, signedByClient: "Nguyễn Văn Khánh", reason: "Đính nhầm bản scan và ghi sai tên người ký" }, ids.lan);
    expect(after).toMatchObject({ status: "signed", signedFileId: newScan, signedByClient: "Nguyễn Văn Khánh", items: acceptance.items });
    expect(after.corrections).toMatchObject([{ byPersonId: ids.lan, reason: "Đính nhầm bản scan và ghi sai tên người ký", before: { signedFileId: firstScan, signedByClient: "Nguyễn Văn Khách" } }]);
    // The earlier scan is history: still a file of the record, still one of its scans.
    expect(await fileOf(firstScan)).toMatchObject({ deletedAt: null, status: "ready" });
    expect(isScanOf(after, firstScan)).toBe(true);
    expect(isScanOf(after, newScan)).toBe(true);
    expect(isScanOf(after, await scanFor("elsewhere"))).toBe(false);
    expect((await listAcceptances(ids.tvc)).find((row) => row.id === acceptance.id)!.history).toMatchObject([{ byName: "Lan Tran" }]);
    // The billing item it earned is untouched by the correction.
    const [item] = await db().select().from(schema.projectBillingItem).where(eq(schema.projectBillingItem.acceptanceId, acceptance.id));
    expect(item).toMatchObject({ status: "ready", amountVnd: 45_000_000 });

    // Invoiced: the invoice quotes the record, and it no longer moves.
    await decideBillingItem(item.id, { action: "invoice", invoiceNumber: "HD-002", invoiceDate: today, amountVnd: null }, ids.ke);
    expect(await fails(correctSignedAcceptance(acceptance.id, { signedFileId: null, signedOn: today, signedByClient: "Ai đó", reason: "sau hoá đơn" }, ids.lan))).toBe("acceptance_invoiced");
  });

  it("does not delete a milestone that an acceptance or a billing item still hangs off", async () => {
    // A record that is not void holds the milestone; voiding it lets go.
    const held = (await saveMilestone(ids.tvc, null, { name: "Duyệt bản dựng", dueDate: null, phaseId: null, ownerPersonId: null, isClientFacing: true, isBilling: false, sortOrder: 5 })).after;
    const record = await createAcceptance(ids.tvc, { scope: "milestone", milestoneId: held.id, retainerPeriodId: null, description: "Bản dựng lần 1" }, ids.lan);
    expect(await fails(deleteMilestone(held.id))).toBe("milestone_has_acceptance");
    await voidAcceptance(record.id);
    expect((await deleteMilestone(held.id)).id).toBe(held.id);
    expect(await fails(deleteMilestone(held.id))).toBe("milestone_not_found");

    // An item finance has not waived holds it too.
    const billed = (await saveMilestone(ids.house, null, { name: "Đợt 2", dueDate: null, phaseId: null, ownerPersonId: null, isClientFacing: false, isBilling: true, billingAmountVnd: 1_000_000, sortOrder: 1 })).after;
    const { billingItemId } = await setMilestoneDone(billed.id, true, ids.tam);
    expect(await fails(deleteMilestone(billed.id))).toBe("milestone_has_billing");
    await decideBillingItem(billingItemId!, { action: "waive", reason: "Không thu đợt này" }, ids.ke);
    expect((await deleteMilestone(billed.id)).id).toBe(billed.id);
    // The waived item stays in finance's history, without its milestone.
    expect((await db().select().from(schema.projectBillingItem).where(eq(schema.projectBillingItem.id, billingItemId!)))[0]).toMatchObject({ status: "waived", milestoneId: null });
  });

  it("sums what waits in the queue in Postgres, cut to the reader's entities", async () => {
    await db()
      .insert(schema.projectBillingItem)
      .values([
        { projectId: ids.tvc, entityId: ids.szm, source: "manual", description: "Chi phí in ấn", amountVnd: 2_500_000_000 },
        { projectId: ids.tvc, entityId: ids.szm, source: "manual", description: "Chưa có số tiền", amountVnd: null },
        { projectId: ids.other, entityId: ids.szc, source: "manual", description: "Của pháp nhân khác", amountVnd: 9_000_000 },
      ]);
    // What the page used to add up over its rows, here over every row: the yardstick for the SQL sum.
    const ready = await db().select({ entityId: schema.projectBillingItem.entityId, amountVnd: schema.projectBillingItem.amountVnd }).from(schema.projectBillingItem).where(eq(schema.projectBillingItem.status, "ready"));
    const sumOf = (rows: typeof ready) => ({ count: rows.length, totalVnd: rows.reduce((sum, row) => sum + (row.amountVnd ?? 0), 0) });
    const own = sumOf(ready.filter((row) => row.entityId === ids.szm));
    // Above a 32-bit integer on purpose: VND totals are.
    expect(own.totalVnd).toBeGreaterThan(2_147_483_647);
    expect(await readyBillingTotal(finance())).toEqual(own);
    expect(await readyBillingTotal(finance(), { entityId: ids.szm })).toEqual(own);
    expect(await readyBillingTotal(finance(), { entityId: ids.szc })).toEqual({ count: 0, totalVnd: 0 });
    expect(await readyBillingTotal(principalOf(ids.huy))).toEqual({ count: 0, totalVnd: 0 });
    expect(await readyBillingTotal(principalOf(ids.ke, [{ role: "finance", scope: { type: "group" } }]))).toEqual(sumOf(ready));
    expect(sumOf(ready).totalVnd).toBe(own.totalVnd + 9_000_000);
  });

  it("answers which projects of a list the reader may open in one go, without recording a read", async () => {
    const audits = async () => (await db().select({ value: count() }).from(schema.auditLog))[0].value;
    const before = await audits();
    const all = [ids.retainer, ids.tvc, ids.house, ids.other, ids.private];
    // A member of the Social team opens its team-visible projects; not the private one, not another team's.
    expect([...(await openableProjectIds(userOf(ids.huy), all))].sort()).toEqual([ids.retainer, ids.tvc, ids.house].sort());
    // The lead of the private project opens it.
    expect((await openableProjectIds(userOf(ids.tam), all)).has(ids.private)).toBe(true);
    // Somebody on no project and with no grant opens none.
    expect((await openableProjectIds(userOf(ids.ke), all)).size).toBe(0);
    // Finance reads its entity's projects by `pjm:portfolio`, the private one too (D30) — and being
    // shown its name in a list leaves no row in the audit log: only opening it does.
    const asFinance = await openableProjectIds(userOf(ids.ke, finance().grants), all);
    expect(asFinance.has(ids.private)).toBe(true);
    expect(asFinance.has(ids.other)).toBe(false);
    expect(await openableProjectIds(userOf(ids.huy), [])).toEqual(new Set());
    expect(await audits()).toBe(before);
  });
});

describe("who may use the new paths", () => {
  const may = (name: string, personId: string, input: Record<string, unknown>, grants: Principal["grants"] = []) => pipelines.get(name)!.authorize(userOf(personId, grants), input);

  it("the register line of a task: whoever may edit the plan of its project, as on the plan page", async () => {
    const [task] = await db().select({ taskId: schema.workTask.taskId }).from(schema.workTask).where(eq(schema.workTask.projectId, ids.retainer)).limit(1);
    const input = { taskId: task.taskId, deliverableId: null };
    expect(await may("projects.task.line", ids.tam, input)).toBe(true); // the project's lead
    expect(await may("projects.task.line", ids.huy, input)).toBe(false); // a member of the team
    expect(await may("projects.task.line", ids.lan, input)).toBe(false); // the account manager owns the client side, not the plan
    expect(await may("projects.task.line", ids.ke, input, finance().grants)).toBe(false); // finance reads, and writes nothing in the plan
  });

  it("a missed retainer month and a signed record's correction: the client side — the lead and the account manager", async () => {
    const [signed] = (await listAcceptances(ids.tvc)).filter((row) => row.status === "signed");
    for (const [name, input] of [
      ["projects.retainer.make_month", { projectId: ids.retainer, month: firstMonth }],
      ["projects.acceptance.correct_signed", { acceptanceId: signed.id }],
    ] as const) {
      expect(await may(name, ids.lan, input), name).toBe(true);
      expect(await may(name, ids.tam, input), name).toBe(true);
      expect(await may(name, ids.huy, input), name).toBe(false);
      expect(await may(name, ids.ke, input, finance().grants), name).toBe(false);
    }
  });

  it("an amount's correction: pjm:commercial over the item's entity, and nobody on the project without it", async () => {
    const [item] = await db().select().from(schema.projectBillingItem).where(eq(schema.projectBillingItem.projectId, ids.tvc)).limit(1);
    const input = { itemId: item.id };
    expect(await may("projects.billing.correct_amount", ids.ke, input, finance().grants)).toBe(true);
    expect(await may("projects.billing.correct_amount", ids.ke, input, [{ role: "finance", scope: { type: "entity", id: ids.szc } }])).toBe(false);
    // The lead and the account manager read their project's money (Q21) without moving it.
    expect(await may("projects.billing.correct_amount", ids.tam, input)).toBe(false);
    expect(await may("projects.billing.correct_amount", ids.lan, input)).toBe(false);
  });
});

describe("the biên bản that was issued is the one that is kept (CHR-01)", () => {
  it("stores the paper when the record is sent, serves that file afterwards, and re-issues it only on a refresh before signing", async () => {
    const milestone = (await saveMilestone(ids.tvc, null, { name: "Bàn giao master", dueDate: null, phaseId: null, ownerPersonId: null, isClientFacing: true, isBilling: false, sortOrder: 9 })).after;
    await saveDeliverable(ids.tvc, null, { title: "TVC 30s bản master", quantity: 1, format: null, channel: null, dueDate: null, milestoneId: milestone.id, sortOrder: 9 });
    const draft = await createAcceptance(ids.tvc, { scope: "milestone", milestoneId: milestone.id, retainerPeriodId: null }, ids.lan);
    // A draft has no paper: it is rendered from the template as it stands each time.
    expect(draft.generatedFileId).toBeNull();
    expect(await issuedPaper(draft)).toBeNull();

    const objects = storedObjects.size;
    const { after: sent } = await sendAcceptance(draft.id);
    expect(sent.status).toBe("sent");
    expect(storedObjects.size).toBe(objects + 1);
    const paper = await fileOf(sent.generatedFileId!);
    // Filed where the signed scan is: the record's own files, at the scan's tier, in the project's entity.
    expect(paper).toMatchObject({ ownerType: "project_acceptance", ownerId: draft.id, tier: "personal", entityId: ids.szm, status: "ready", contentType: "application/pdf", deletedAt: null });
    expect(paper.fileName).toMatch(/^SZM-\d{2}-\d{3}_NT-\d{2}\.pdf$/);
    expect(new TextDecoder().decode(storedObjects.get(paper.objectPath)!.bytes.slice(0, 5))).toBe("%PDF-");

    // HR rewrites the template: a new rendering would differ, the paper that was sent does not.
    await db().update(schema.documentTemplate).set({ body: "MẪU MỚI {{acceptance.items}}" }).where(eq(schema.documentTemplate.code, "TM-NGHIEM-THU"));
    expect((await acceptanceDocument(sent, words)).text.startsWith("MẪU MỚI")).toBe(true);
    expect((await issuedPaper(sent))!.id).toBe(paper.id);
    expect(storedObjects.size).toBe(objects + 1);

    // Refreshing a sent, unsigned record issues it again: a new file, the earlier one soft-deleted.
    const { after: reissued } = await refreshAcceptance(draft.id);
    expect(reissued.status).toBe("sent");
    expect(reissued.generatedFileId).not.toBe(paper.id);
    expect((await fileOf(paper.id)).deletedAt).not.toBeNull();
    expect((await fileOf(reissued.generatedFileId!)).deletedAt).toBeNull();

    // Signed: the paper it was sent with stays, and nothing renders it again.
    const { after: signed } = await signAcceptance(draft.id, { signedFileId: await scanFor(draft.id), signedOn: today, signedByClient: "Khách" }, ids.lan);
    expect(signed.generatedFileId).toBe(reissued.generatedFileId);
    const stored = storedObjects.size;
    expect((await issuedPaper(signed))!.id).toBe(reissued.generatedFileId);
    expect(await fails(refreshAcceptance(draft.id))).toBe("acceptance_locked");
    expect(storedObjects.size).toBe(stored);
  });

  it("issues the paper at the signature when the record was never sent, and once for a record sent before papers were kept", async () => {
    const milestone = (await saveMilestone(ids.tvc, null, { name: "Bàn giao bản cắt", dueDate: null, phaseId: null, ownerPersonId: null, isClientFacing: true, isBilling: false, sortOrder: 10 })).after;
    const direct = await createAcceptance(ids.tvc, { scope: "milestone", milestoneId: milestone.id, retainerPeriodId: null, description: "Bản cắt 15s" }, ids.lan);
    const { after: signed } = await signAcceptance(direct.id, { signedFileId: await scanFor(direct.id), signedOn: today, signedByClient: "Khách" }, ids.lan);
    expect(signed.generatedFileId).not.toBeNull();
    expect(await fileOf(signed.generatedFileId!)).toMatchObject({ ownerId: direct.id, status: "ready", deletedAt: null });

    // A refusal takes the file it stored back: signing a signed record leaves no stray paper.
    const files = async () =>
      (
        await db()
          .select({ value: count() })
          .from(schema.storedFile)
          .where(and(eq(schema.storedFile.ownerId, direct.id), eq(schema.storedFile.status, "ready")))
      )[0].value;
    const before = await files();
    expect(await fails(sendAcceptance(direct.id))).toBe("acceptance_wrong_status");
    expect(await files()).toBe(before);

    // Sent before this rule: no file on record. The first opening issues it; the second finds it.
    await db().update(schema.projectAcceptance).set({ generatedFileId: null }).where(eq(schema.projectAcceptance.id, direct.id));
    const legacy = (await findAcceptance(direct.id))!;
    const first = await issuedPaper(legacy);
    expect(first).not.toBeNull();
    expect((await findAcceptance(direct.id))!.generatedFileId).toBe(first!.id);
    expect((await issuedPaper((await findAcceptance(direct.id))!))!.id).toBe(first!.id);
    // Two readers at once, both holding the row as it was: one paper is kept, the other retired.
    await db().update(schema.projectAcceptance).set({ generatedFileId: null }).where(eq(schema.projectAcceptance.id, direct.id));
    const [a, b] = await Promise.all([issuedPaper(legacy), issuedPaper(legacy)]);
    expect(a!.id).toBe(b!.id);
    expect((await findAcceptance(direct.id))!.generatedFileId).toBe(a!.id);
  });
});

describe("the job number is on the work (PJM-09)", () => {
  it("reads the job numbers of every project on a screen in one call", async () => {
    const plan = await ensurePlan(ids.tvc);
    expect(plan.jobNumber).toMatch(/^SZM-\d{2}-\d{3}$/);
    const numbers = await jobNumbersOf([ids.tvc, ids.retainer, null, undefined, ids.tvc, "00000000-0000-4000-8000-000000000000"]);
    expect(numbers.get(ids.tvc)).toBe(plan.jobNumber);
    expect(numbers.get(ids.retainer)).toMatch(/^SZM-\d{2}-\d{3}$/);
    expect(numbers.size).toBe(2);
    expect(await jobNumbersOf([])).toEqual(new Map());
    expect(await jobNumbersOf([null])).toEqual(new Map());
    // Inside a transaction the rows are read there.
    expect(await db().transaction((tx) => jobNumbersOf([ids.other], tx))).toEqual(new Map([[ids.other, (await ensurePlan(ids.other)).jobNumber]]));
  });
});
