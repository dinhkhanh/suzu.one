// The security review of Phase 10, from the project layer's side, against a real Postgres (PGlite):
// a private project's kick-off and change requests, the bounds on a retainer's months, a closed
// project that stops billing, the fee billed once, the people a project's work may be given to,
// reads that write nothing, and the fee kept out of the audit log.
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => import("../../../tests/helpers/db"));
vi.mock("@/lib/env", () => ({ env: () => ({ BETTER_AUTH_URL: "https://suzu.one" }) }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));

// Each action's pipeline is kept as it was built, so its audit payload can be read here.
type Pipeline = { name: string; run: (context: { user: unknown; input: Record<string, unknown> }) => Promise<{ audit: { resource: { entityId: string | null }; before?: Record<string, unknown> | null; after?: Record<string, unknown> | null } }> };
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

import { and, eq } from "drizzle-orm";
import { todayInVietnam } from "@/lib/dates";
import { db, schema } from "@/lib/db";
import { migrateTestDb } from "../../../tests/helpers/db";
import type { Principal } from "../platform/rbac/policy";
import { createProject } from "../work/projects";
import { createTeam, setTeamMember } from "../work/teams";
import { createAcceptance, signAcceptance } from "./acceptance";
import { listChanges, openChangesForApprover, saveChange, submitChange } from "./change-requests";
import { closeProject, saveRetro } from "./close";
import { addMonths, monthOf } from "./engine/retainer";
import { submitBrief } from "./kickoff";
import { ensurePlan, backfillPlans, readPlan, reconcilePlans, setAccountManager, setFee, updateBrief, updatePlanSettings } from "./plans";
import { listPortfolio } from "./portfolio";
import { issueToTask, saveRaidItem } from "./raid-log";
import { runRetainers, saveRetainer } from "./retainers";
import { createTasksForLine, saveDeliverable, saveMilestone, setMilestoneDone } from "./structure";
import { openProject } from "./views";

const ids = {} as Record<"szm" | "owner" | "director" | "lead" | "am" | "member" | "outsider" | "team" | "lonely" | "private" | "hidden" | "open" | "retainer" | "fresh", string>;
const fails = (promise: Promise<unknown>) => promise.then(() => "no error", (error: Error) => error.message);
const principalOf = (personId: string, grants: Principal["grants"] = []): Principal => ({ personId, workforceType: "employee", grants });
const userOf = (personId: string, grants: Principal["grants"] = []) => ({ person: { id: personId, primaryEntityId: ids.szm }, principal: principalOf(personId, grants) }) as never;
const directorGrant = (): Principal["grants"] => [{ role: "entity_director", scope: { type: "entity", id: ids.szm } }];
const brief = { objective: "Ra mắt dòng sản phẩm mới", scopeIn: "1 TVC 30s", successCriteria: "Khách duyệt trong hai vòng" };
const month = monthOf(todayInVietnam());
const assigneesOf = async (requestId: string) => db().select({ personId: schema.approvalAssignee.approverPersonId }).from(schema.approvalAssignee).where(eq(schema.approvalAssignee.requestId, requestId));

beforeAll(async () => {
  await migrateTestDb();
  const [szm] = await db().insert(schema.entity).values({ code: "SZM", legalName: "SuZu Media", shortName: "Media" }).returning();
  ids.szm = szm.id;
  for (const [key, name] of [["owner", "Chu Tich"], ["director", "Giam Doc"], ["lead", "Truong Nhom"], ["am", "Quan Ly Khach"], ["member", "Thanh Vien"], ["outsider", "Nguoi Ngoai"]] as const) {
    const [row] = await db().insert(schema.person).values({ fullName: name, searchName: name.toLowerCase(), workEmail: `${key}@suzu.group`, status: "active", primaryEntityId: szm.id }).returning();
    ids[key] = row.id;
  }
  await db().insert(schema.roleAssignment).values([
    { personId: ids.owner, role: "owner", scopeType: "group", scopeId: null, validFrom: "2024-01-01" },
    // `work:manage` and `pjm:commercial` over the entity — and no business with a private project.
    { personId: ids.director, role: "entity_director", scopeType: "entity", scopeId: szm.id, validFrom: "2024-01-01" },
  ]);
  const team = await createTeam({ key: "VID", name: "Video", description: null, entityId: szm.id, departmentId: null, defaultVisibility: "team", isActive: true }, "simple", {}, ids.lead);
  ids.team = team.id;
  for (const personId of [ids.am, ids.member]) await setTeamMember(team.id, personId, "member");
  const project = (name: string, visibility: "team" | "private", leadPersonId: string, teamId = team.id) =>
    createProject({ teamId, name, description: null, clientId: null, status: "active", visibility, leadPersonId, startDate: null, dueDate: "2026-12-31" }, ids.lead);
  ids.private = (await project("Dự án kín", "private", ids.lead)).id;
  ids.open = (await project("Dự án chung", "team", ids.lead)).id;
  ids.retainer = (await project("Retainer kín", "team", ids.lead)).id;
  ids.fresh = (await project("Chưa có kế hoạch", "team", ids.lead)).id;
  await setAccountManager(ids.private, ids.am);
  // A private project of a team with no lead at all: nobody in the team answers for it.
  const lonely = await createTeam({ key: "SOL", name: "Solo", description: null, entityId: szm.id, departmentId: null, defaultVisibility: "team", isActive: true }, "simple", {}, ids.lead);
  ids.lonely = lonely.id;
  await setTeamMember(lonely.id, ids.am, "member");
  ids.hidden = (await project("Dự án kín không có lead", "private", ids.am, lonely.id)).id;
  await db().delete(schema.workTeamMember).where(and(eq(schema.workTeamMember.teamId, lonely.id), eq(schema.workTeamMember.personId, ids.lead)));
  await db().delete(schema.workProjectMember).where(and(eq(schema.workProjectMember.projectId, ids.hidden), eq(schema.workProjectMember.role, "lead")));
});

describe("a private project's approvals (finding 1)", () => {
  it("keeps the brief and its request from the owner and from a work:manage holder", async () => {
    await updateBrief(ids.private, brief);
    const { requestId } = await submitBrief(ids.private, ids.am);
    // The team's lead was asked by name, and is the only one who reads it beside the author.
    expect((await assigneesOf(requestId)).map((row) => row.personId)).toEqual([ids.lead]);
    const { openBriefForApprover } = await import("./views");
    expect(await openBriefForApprover(userOf(ids.owner, [{ role: "owner", scope: { type: "group" } }]), ids.private)).toBeNull();
    expect(await openBriefForApprover(userOf(ids.director, directorGrant()), ids.private)).toBeNull();
    expect((await openBriefForApprover(userOf(ids.lead), ids.private))?.projectName).toBe("Dự án kín");
    expect((await openBriefForApprover(userOf(ids.am), ids.private))?.projectName).toBe("Dự án kín");
  });

  it("asks the owners, not the work:manage holders, when a private project has nobody to lead it", async () => {
    await updateBrief(ids.hidden, brief);
    const { requestId } = await submitBrief(ids.hidden, ids.am);
    expect((await assigneesOf(requestId)).map((row) => row.personId)).toEqual([ids.owner]);
  });

  it("keeps a change request from a work:manage holder, and asks the owners when nobody leads the project", async () => {
    const { after } = await saveChange(ids.private, null, { title: "Thêm bản 6s", description: null, requestedBy: "internal", impact: { minutesDelta: 120 }, evidenceFileId: null, evidenceUrl: null }, ids.am, { withFee: false });
    const { requestId } = await submitChange(after.id, ids.am);
    expect((await assigneesOf(requestId)).map((row) => row.personId)).toEqual([ids.lead]);
    expect(await openChangesForApprover({ personId: ids.director, principal: principalOf(ids.director, directorGrant()) }, ids.private)).toBeNull();
    expect(await openChangesForApprover({ personId: ids.owner, principal: principalOf(ids.owner, [{ role: "owner", scope: { type: "group" } }]) }, ids.private)).toBeNull();
    expect((await openChangesForApprover({ personId: ids.lead, principal: principalOf(ids.lead) }, ids.private))?.changes).toHaveLength(1);

    const hidden = (await saveChange(ids.hidden, null, { title: "Đổi phạm vi", description: null, requestedBy: "internal", impact: { minutesDelta: 60 }, evidenceFileId: null, evidenceUrl: null }, ids.member, { withFee: false })).after;
    const request = await submitChange(hidden.id, ids.member);
    expect((await assigneesOf(request.requestId)).map((row) => row.personId)).toEqual([ids.owner]);
  });
});

describe("a retainer's months are bounded, and a closed project bills no more (findings 7, 9)", () => {
  it("refuses a start month in the distant past or far future, and makes only the months since it was saved", async () => {
    await updatePlanSettings(ids.retainer, { kind: "retainer", budgetMinutes: null, budgetByRole: [], updateCadenceDays: 7, driveUrl: null });
    const terms = { lines: [{ title: "Bài đăng", quantity: 4, format: null, channel: null }], minutesPerMonth: null, rollover: "reset" as const, isActive: true, feePerMonthVnd: 30_000_000 };
    expect(await fails(saveRetainer(ids.retainer, { ...terms, startMonth: "2000-01", endMonth: null }))).toBe("retainer_month_out_of_range");
    expect(await fails(saveRetainer(ids.retainer, { ...terms, startMonth: month, endMonth: addMonths(month, 36) }))).toBe("retainer_month_out_of_range");

    await saveRetainer(ids.retainer, { ...terms, startMonth: addMonths(month, -1), endMonth: null });
    // Even asked for a run a year later, the catch-up is bounded — never a period per month since 2000.
    const made = await runRetainers(`${addMonths(month, 12)}-15`);
    expect(made.periods).toBeLessThanOrEqual(4);
    const [retainer] = await db().select().from(schema.projectRetainer).where(eq(schema.projectRetainer.projectId, ids.retainer));
    const periods = await db().select().from(schema.projectRetainerPeriod).where(eq(schema.projectRetainerPeriod.retainerId, retainer.id));
    expect(periods.every((period) => period.month >= addMonths(month, -1))).toBe(true);
    // What finance reads on the item is the Vietnamese wording of the messages, not a literal (finding 25).
    const [item] = await db().select().from(schema.projectBillingItem).where(eq(schema.projectBillingItem.projectId, ids.retainer));
    if (item) expect(item.description).toMatch(/^Phí retainer tháng \d{4}-\d{2}$/);
  });

  it("refuses to move the months or stop the retainer without pjm:commercial over the entity", async () => {
    await import("./commercial-actions");
    const pipeline = pipelines.get("projects.retainer.save")!;
    const project = await createProject({ teamId: ids.team, name: "Retainer mới", description: null, clientId: null, status: "active", visibility: "team", leadPersonId: ids.lead, startDate: null, dueDate: null }, ids.lead);
    await updatePlanSettings(project.id, { kind: "retainer", budgetMinutes: null, budgetByRole: [], updateCadenceDays: 7, driveUrl: null });
    const input = { projectId: project.id, startMonth: month, endMonth: null, lines: [{ title: "Bài đăng", quantity: 2, format: null, channel: null }], hoursPerMonth: null, rollover: "reset", isActive: true };
    const commercial = userOf(ids.director, directorGrant());
    await pipeline.run({ user: commercial, input: { ...input, feePerMonthVnd: 20_000_000 } });
    // The account manager keeps the scope lines; the months and the switch are the fee-holder's.
    const asManager = (changes: Record<string, unknown>) => pipeline.run({ user: userOf(ids.lead), input: { ...input, ...changes } });
    expect(await fails(asManager({ startMonth: addMonths(month, -1) }))).toBe("retainer_terms_need_commercial");
    expect(await fails(asManager({ endMonth: addMonths(month, 6) }))).toBe("retainer_terms_need_commercial");
    expect(await fails(asManager({ isActive: false }))).toBe("retainer_terms_need_commercial");
    await asManager({ lines: [{ title: "Bài đăng", quantity: 5, format: null, channel: null }] });
    const [retainer] = await db().select().from(schema.projectRetainer).where(eq(schema.projectRetainer.projectId, project.id));
    expect(retainer).toMatchObject({ startMonth: month, isActive: true, feePerMonthVnd: 20_000_000, lines: [{ title: "Bài đăng", quantity: 5 }] });
  });

  it("stops the retainer when the project closes, and makes no month for a closed project", async () => {
    const before = (await db().select().from(schema.projectRetainerPeriod)).length;
    await closeProject(ids.retainer, { overrideReason: "Khách dừng hợp đồng, đã báo C-level" }, ids.lead);
    const [retainer] = await db().select().from(schema.projectRetainer).where(eq(schema.projectRetainer.projectId, ids.retainer));
    expect(retainer).toMatchObject({ isActive: false, endMonth: month });
    expect(await runRetainers(`${addMonths(month, 24)}-15`, retainer.id)).toEqual({ periods: 0, closed: 0, billed: 0 });
    expect((await db().select().from(schema.projectRetainerPeriod)).length).toBe(before);
  });
});

describe("the fee is billed once (finding 8)", () => {
  it("bills a milestone nothing after a whole-project acceptance took what was left, and holds one whole-project record", async () => {
    await setFee(ids.open, 100_000_000);
    const line = (await saveDeliverable(ids.open, null, { title: "TVC 30s", quantity: 1, format: null, channel: null, dueDate: null, milestoneId: null, sortOrder: 0 })).after;
    expect(line.id).toBeTruthy();
    const milestone = (await saveMilestone(ids.open, null, { name: "Tạm ứng 60%", dueDate: null, phaseId: null, ownerPersonId: null, isClientFacing: false, isBilling: true, billingAmountVnd: 60_000_000, sortOrder: 0 })).after;

    const acceptance = await createAcceptance(ids.open, { scope: "project", milestoneId: null, retainerPeriodId: null }, ids.am);
    // A second whole-project record would bill "the fee not yet billed" all over again.
    expect(await fails(createAcceptance(ids.open, { scope: "project", milestoneId: null, retainerPeriodId: null }, ids.am))).toBe("acceptance_project_exists");
    const [file] = await db()
      .insert(schema.storedFile)
      .values({ bucket: "test", objectPath: `project_acceptance/${acceptance.id}.pdf`, fileName: "bien-ban.pdf", contentType: "application/pdf", sizeBytes: 10, ownerType: "project_acceptance", ownerId: acceptance.id, entityId: ids.szm, tier: "personal", status: "ready", uploadedByPersonId: ids.am })
      .returning();
    await signAcceptance(acceptance.id, { signedFileId: file.id, signedOn: todayInVietnam(), signedByClient: "Khách" }, ids.am);

    const done = await setMilestoneDone(milestone.id, true, ids.lead);
    expect(done.billingItemId).toBeNull();
    const items = await db().select().from(schema.projectBillingItem).where(eq(schema.projectBillingItem.projectId, ids.open));
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ source: "acceptance", amountVnd: 100_000_000 });
  });
});

describe("only the project's people take its work (finding 19)", () => {
  it("refuses an outsider as a milestone owner, a line's assignee, an issue's assignee or a retro attendee", async () => {
    expect(await fails(saveMilestone(ids.open, null, { name: "Duyệt nội bộ", dueDate: null, phaseId: null, ownerPersonId: ids.outsider, isClientFacing: false, isBilling: false, sortOrder: 1 }))).toBe("person_not_in_project");
    const line = (await saveDeliverable(ids.open, null, { title: "Bài đăng", quantity: 2, format: null, channel: null, dueDate: null, milestoneId: null, sortOrder: 2 })).after;
    expect(await fails(createTasksForLine(line.id, { count: 1, assigneePersonId: ids.outsider, dueDate: null }, ids.lead))).toBe("person_not_in_project");
    // The team's own people are still offered the work.
    expect((await createTasksForLine(line.id, { count: 1, assigneePersonId: ids.member, dueDate: null }, ids.lead)).taskIds).toHaveLength(1);

    const issue = (await saveRaidItem(ids.open, null, { kind: "issue", title: "Thiếu tư liệu", description: null, ownerPersonId: null, dueDate: null, severity: "high", decidedOn: null, evidenceUrl: null, evidenceFileId: null }, ids.lead)).after;
    expect(await fails(issueToTask(issue.id, { assigneePersonId: ids.outsider, dueDate: null }, ids.lead))).toBe("raid_owner_not_member");
    expect(await fails(saveRetro(ids.open, { heldOn: todayInVietnam(), attendeeIds: [ids.outsider], retro: { wentWell: "Ổn" } }, ids.lead))).toBe("person_not_in_project");
    // Its own people, and the Vietnamese title from the messages rather than an English literal.
    const retro = await saveRetro(ids.open, { heldOn: todayInVietnam(), attendeeIds: [ids.member], retro: { wentWell: "Ổn" } }, ids.lead);
    expect(retro.after.title).toBe("Họp rút kinh nghiệm");
  });
});

describe("reading a project writes nothing (finding 18)", () => {
  const plansOf = async (projectId: string) => db().select().from(schema.projectPlan).where(eq(schema.projectPlan.projectId, projectId));

  it("opens a project with no plan yet without making one, and shows the plan's defaults", async () => {
    const context = await openProject(userOf(ids.lead), ids.fresh);
    expect(context?.plan).toMatchObject({ jobNumber: null, briefStatus: "draft", kind: "internal", updateCadenceDays: 7 });
    await listPortfolio({ principal: principalOf(ids.lead), entityId: ids.szm, teamRoles: new Map([[ids.team, "lead"]]), projectRoles: new Map() }, { today: todayInVietnam() });
    await readPlan(ids.fresh);
    expect(await plansOf(ids.fresh)).toHaveLength(0);
  });

  it("makes the plan and its job number at the first change, and in the nightly job", async () => {
    await saveDeliverable(ids.fresh, null, { title: "Bài đăng", quantity: 1, format: null, channel: null, dueDate: null, milestoneId: null, sortOrder: 0 });
    const [plan] = await plansOf(ids.fresh);
    expect(plan.jobNumber).toMatch(/^SZM-\d{2}-\d{3}$/);
    const [another] = await db().insert(schema.workProject).values({ teamId: ids.team, name: "Việc mới", entityId: ids.szm, status: "active", visibility: "team", createdByPersonId: ids.lead }).returning();
    expect(await backfillPlans()).toMatchObject({ created: 1 });
    expect((await plansOf(another.id))[0].jobNumber).not.toBeNull();
  });

  it("leaves the account manager's column to the nightly job rather than writing it on a read", async () => {
    const [member] = await db().select().from(schema.workProjectMember).where(and(eq(schema.workProjectMember.projectId, ids.private), eq(schema.workProjectMember.role, "account_manager")));
    await db().update(schema.workProjectMember).set({ role: "member" }).where(eq(schema.workProjectMember.id, member.id));
    // The page shows the truth (nobody), and the stored column is untouched by the read.
    expect((await openProject(userOf(ids.lead), ids.private))?.plan.accountManagerPersonId).toBeNull();
    expect((await ensurePlan(ids.private)).accountManagerPersonId).toBe(ids.am);
    await reconcilePlans();
    expect((await ensurePlan(ids.private)).accountManagerPersonId).toBeNull();
  });

  it("does not write a change back when its request was withdrawn from the approvals inbox", async () => {
    const [change] = await db().select().from(schema.projectChangeRequest).where(and(eq(schema.projectChangeRequest.projectId, ids.private), eq(schema.projectChangeRequest.status, "submitted")));
    await db().update(schema.approvalRequest).set({ status: "withdrawn" }).where(eq(schema.approvalRequest.id, change.approvalRequestId!));
    // The list shows it withdrawn; the row itself waits for the author's next move or the job.
    expect((await listChanges(ids.private, false)).find((row) => row.id === change.id)?.status).toBe("withdrawn");
    const [stored] = await db().select().from(schema.projectChangeRequest).where(eq(schema.projectChangeRequest.id, change.id));
    expect(stored.status).toBe("submitted");
    const { reconcileChanges } = await import("./change-requests");
    expect(await reconcileChanges()).toEqual({ changes: 1 });
    expect((await db().select().from(schema.projectChangeRequest).where(eq(schema.projectChangeRequest.id, change.id)))[0].status).toBe("withdrawn");
  });

  it("gives a kick-off back to its author when its request was withdrawn, without a read writing it", async () => {
    const plan = await ensurePlan(ids.hidden);
    await db().update(schema.approvalRequest).set({ status: "withdrawn" }).where(eq(schema.approvalRequest.id, plan.briefApprovalRequestId!));
    // The author works in the project (its lead's row was removed above), so they may open it.
    await db().insert(schema.workProjectMember).values({ projectId: ids.hidden, personId: ids.am, role: "member" });
    expect((await openProject(userOf(ids.am), ids.hidden))?.plan.briefStatus).toBe("draft");
    expect((await ensurePlan(ids.hidden)).briefStatus).toBe("submitted");
    // The author may send it again: the submission itself puts the brief right first.
    const again = await submitBrief(ids.hidden, ids.am);
    expect(again.plan.briefStatus).toBe("submitted");
    expect(again.resubmitted).toBe(false);
  });
});

describe("the audit log never carries the fee (finding 10)", () => {
  it("records that the fee changed, with the project's entity, and not what it is", async () => {
    await import("./actions");
    const pipeline = pipelines.get("projects.plan.fee")!;
    const { audit } = await pipeline.run({ user: userOf(ids.lead, [{ role: "entity_director", scope: { type: "entity", id: ids.szm } }]), input: { projectId: ids.open, feeVnd: 90_000_000 } });
    expect(audit.resource.entityId).toBe(ids.szm);
    expect(audit.after).toEqual({ feeSet: true, feeChanged: true });
    expect(JSON.stringify(audit)).not.toContain("000000");
    expect((await ensurePlan(ids.open)).feeVnd).toBe(90_000_000);
  });
});
