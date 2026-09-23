// The owner's decisions of 2026-09-23 against a real Postgres (PGlite):
//
//  · **Q21** — the project's own lead and its own account manager read that project's money (fee,
//    money budget, retainer fee, billing amounts, CSV); nobody else does without `pjm:commercial`,
//    and reading it is still not moving it.
//  · **Q22** — every client project and every retainer month is accepted with a signed biên bản
//    nghiệm thu before it is billed: the close-out checklist asks for it (the override with a
//    recorded reason stays), and a client's retainer month closes without being billed until the
//    paper comes back.
//  · **Q25** — the owner and `pjm:portfolio` holders may open a private project to read it. They
//    are not its people: every write is refused, they are not assignable, and the read is audited.
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => import("../../../tests/helpers/db"));
vi.mock("@/lib/env", () => ({ env: () => ({ BETTER_AUTH_URL: "https://suzu.one" }) }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));

// Each action's pipeline is kept as it was built, so its `authorize` step can be asked here.
type Pipeline = { name: string; authorize: (user: unknown, input: Record<string, unknown>) => boolean | Promise<boolean> };
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
import type { Grant, Principal } from "../platform/rbac/policy";
import { listAssignable } from "../work/projects";
import { createProject } from "../work/projects";
import { createTeam, setTeamMember } from "../work/teams";
import { createAcceptance, signAcceptance } from "./acceptance";
import { listProjectBilling } from "./billing";
import { closeProject, getCloseChecklist } from "./close";
import { addMonths, monthOf } from "./engine/retainer";
import { setAccountManager, setFee, updatePlanSettings } from "./plans";
import { listPortfolio } from "./portfolio";
import { getRetainer, listPeriods, runRetainers, saveRetainer } from "./retainers";
import { saveMilestone } from "./structure";
import { auditPrivateTaskRead, openProject } from "./views";

type Who = "lead" | "am" | "member" | "colleague" | "hr" | "payroll" | "auditor" | "director" | "teamLead";
const ids = {} as Record<Who | "szm" | "team" | "client" | "tvc" | "retainer" | "secret", string>;
const fails = (promise: Promise<unknown>) => promise.then(() => "no error", (error: Error) => error.message);
const principalOf = (personId: string, grants: Grant[] = []): Principal => ({ personId, workforceType: "employee", grants });
const userOf = (who: Who, grants: Grant[] = []) => ({ person: { id: ids[who], primaryEntityId: ids.szm }, principal: principalOf(ids[who], grants), userId: `u-${who}`, email: `${who}@suzu.group` }) as never;
const month = monthOf(todayInVietnam());

const GRANTS: Partial<Record<Who, () => Grant[]>> = {
  // `pjm:commercial`, `pjm:portfolio` and `work:manage` over the entity — the "upper levels" of Q21.
  director: () => [{ role: "entity_director", scope: { type: "entity", id: ids.szm } }],
  hr: () => [{ role: "hr_admin", scope: { type: "group" } }],
  payroll: () => [{ role: "payroll", scope: { type: "group" } }],
  auditor: () => [{ role: "auditor", scope: { type: "group" } }],
};
const asUser = (who: Who) => userOf(who, GRANTS[who]?.() ?? []);
const viewerOf = (who: Who) => ({ person: { id: ids[who], primaryEntityId: ids.szm }, principal: principalOf(ids[who], GRANTS[who]?.() ?? []) });

const privateReadsOf = async (who: Who) =>
  db().select().from(schema.auditLog).where(and(eq(schema.auditLog.action, "projects.private.read"), eq(schema.auditLog.actorPersonId, ids[who])));

beforeAll(async () => {
  await migrateTestDb();
  await import("./actions");
  await import("./commercial-actions");
  await import("./collab-actions");
  const [szm] = await db().insert(schema.entity).values({ code: "SZM", legalName: "SuZu Media", shortName: "Media" }).returning();
  ids.szm = szm.id;
  const names: Record<Who, string> = { lead: "Truong Du An", am: "Quan Ly Khach", member: "Thanh Vien", colleague: "Dong Nghiep", hr: "Nhan Su", payroll: "Tien Luong", auditor: "Kiem Toan", director: "Giam Doc", teamLead: "Truong Nhom" };
  for (const [key, name] of Object.entries(names) as [Who, string][]) {
    const [row] = await db().insert(schema.person).values({ fullName: name, searchName: name.toLowerCase(), workEmail: `${key}@suzu.group`, status: "active", primaryEntityId: szm.id }).returning();
    ids[key] = row.id;
  }
  for (const [who, grants] of Object.entries(GRANTS) as [Who, () => Grant[]][]) {
    for (const grant of grants()) await db().insert(schema.roleAssignment).values({ personId: ids[who], role: grant.role, scopeType: grant.scope.type, scopeId: grant.scope.type === "group" ? null : grant.scope.id, validFrom: "2024-01-01" });
  }
  const team = await createTeam({ key: "VID", name: "Video", description: null, entityId: szm.id, departmentId: null, defaultVisibility: "team", isActive: true }, "simple", {}, ids.teamLead);
  ids.team = team.id;
  for (const who of ["lead", "am", "member"] as const) await setTeamMember(team.id, ids[who], "member");
  const [client] = await db().insert(schema.workClient).values({ code: "BIBO", name: "Công ty Bibo", entityId: szm.id }).returning();
  ids.client = client.id;
  const project = (name: string, options: { clientId?: string | null; visibility?: "team" | "private" } = {}) =>
    createProject({ teamId: team.id, name, description: null, clientId: options.clientId ?? null, status: "active", visibility: options.visibility ?? "team", leadPersonId: ids.lead, startDate: null, dueDate: null }, ids.teamLead);
  ids.tvc = (await project("TVC Tết", { clientId: client.id })).id;
  ids.retainer = (await project("Fanpage Bibo", { clientId: client.id })).id;
  ids.secret = (await project("Dự án kín", { visibility: "private" })).id;
  for (const projectId of [ids.tvc, ids.retainer]) await setAccountManager(projectId, ids.am);
  await setFee(ids.tvc, 120_000_000);
});

// ── Q21 ─────────────────────────────────────────────────────────────────────────────────────

describe("who reads a project's money (Q21)", () => {
  it("shows the fee and the billing amounts to the project's own lead and account manager", async () => {
    for (const who of ["lead", "am", "director"] as const) {
      const context = (await openProject(asUser(who), ids.tvc))!;
      expect(context.can.seeFees, who).toBe(true);
      expect(context.plan.feeVnd, who).toBe(120_000_000);
      const row = (await listPortfolio(await loadedViewer(who), { today: todayInVietnam() })).find((entry) => entry.id === ids.tvc);
      expect(row?.feeVnd, who).toBe(120_000_000);
      const billing = await listProjectBilling(ids.tvc, context.can.seeFees);
      for (const item of billing) expect("amountVnd" in item, who).toBe(true);
    }
  });

  it("shows it to nobody else — a member, a colleague, the team's lead, HR, payroll and an auditor", async () => {
    for (const who of ["member", "colleague", "teamLead", "hr", "payroll", "auditor"] as const) {
      const context = await openProject(asUser(who), ids.tvc);
      // A colleague of the entity may open a team project; HR, payroll and auditors may not — either
      // way, none of them reads the price.
      if (context) {
        expect(context.can.seeFees, who).toBe(false);
        expect("feeVnd" in context.plan, who).toBe(false);
        for (const item of await listProjectBilling(ids.tvc, context.can.seeFees)) expect("amountVnd" in item, who).toBe(false);
      }
      const row = (await listPortfolio(await loadedViewer(who), { today: todayInVietnam() })).find((entry) => entry.id === ids.tvc);
      if (row) expect("feeVnd" in row, who).toBe(false);
    }
  });

  it("does not let the lead or the account manager change money — that stays with pjm:commercial", async () => {
    const fee = pipelines.get("projects.plan.fee")!;
    for (const who of ["lead", "am", "teamLead", "member"] as const) expect(await fee.authorize(asUser(who), { projectId: ids.tvc, feeVnd: 1_000_000 }), who).toBe(false);
    expect(await fee.authorize(asUser("director"), { projectId: ids.tvc, feeVnd: 1_000_000 })).toBe(true);
    // And a billing amount written by a lead on a milestone is dropped, not stored.
    const milestone = (await saveMilestone(ids.tvc, null, { name: "Tạm ứng 60%", dueDate: null, phaseId: null, ownerPersonId: null, isClientFacing: true, isBilling: true, sortOrder: 0 })).after;
    expect(milestone.billingAmountVnd).toBeNull();
  });

  it("gives the retainer's monthly fee to its own lead and account manager, and to nobody else", async () => {
    await updatePlanSettings(ids.retainer, { kind: "retainer", budgetMinutes: null, budgetByRole: [], updateCadenceDays: 7, driveUrl: null });
    await saveRetainer(ids.retainer, { startMonth: addMonths(month, -1), endMonth: null, lines: [{ title: "Bài đăng", quantity: 4, format: null, channel: null }], minutesPerMonth: null, rollover: "reset", isActive: true, feePerMonthVnd: 30_000_000 });
    const retainer = (await getRetainer(ids.retainer))!;
    for (const who of ["lead", "am"] as const) {
      const context = (await openProject(asUser(who), ids.retainer))!;
      expect(context.can.seeFees, who).toBe(true);
      expect((await listPeriods(retainer, context.can.seeFees)).every((view) => view.feeVnd !== undefined), who).toBe(true);
    }
    const asMember = (await openProject(asUser("member"), ids.retainer))!;
    expect(asMember.can.seeFees).toBe(false);
    expect((await listPeriods(retainer, asMember.can.seeFees)).some((view) => "feeVnd" in view)).toBe(false);
  });
});

// ── Q22 ─────────────────────────────────────────────────────────────────────────────────────

describe("acceptance before billing, for every client (Q22)", () => {
  it("keeps a client project's close-out waiting for a signed biên bản, and takes a reason instead", async () => {
    const waiting = (await getCloseChecklist(ids.tvc)).find((item) => item.key === "acceptance")!;
    expect(waiting).toMatchObject({ met: false, count: 1 });
    // Refused outright without a reason; the override, recorded, is still the way out.
    expect(await fails(closeProject(ids.tvc, { overrideReason: null }, ids.lead))).toBe("close_unmet");
    const closed = await closeProject(ids.tvc, { overrideReason: "Khách không ký biên bản cuối, đã báo C-level" }, ids.lead);
    expect(closed.report.unmet).toContain("acceptance");
    expect(closed.report.overrideReason).toBe("Khách không ký biên bản cuối, đã báo C-level");
  });

  it("closes a client's retainer month on time but bills it only once the client has signed", async () => {
    const today = `${addMonths(month, 1)}-05`;
    const run = await runRetainers(today);
    expect(run).toMatchObject({ awaiting: expect.any(Number) });
    expect(run.awaiting).toBeGreaterThan(0);
    expect(run.billed).toBe(0);
    const retainer = (await getRetainer(ids.retainer))!;
    const over = (await listPeriods(retainer, true)).find((view) => view.period.status === "closed")!;
    expect(over.billing).toBeNull();
    expect(await db().select().from(schema.projectBillingItem).where(eq(schema.projectBillingItem.projectId, ids.retainer))).toEqual([]);

    // The signature is the door: it makes the month's item, with the biên bản attached.
    const acceptance = await createAcceptance(ids.retainer, { scope: "retainer_period", milestoneId: null, retainerPeriodId: over.period.id }, ids.am);
    const [file] = await db()
      .insert(schema.storedFile)
      .values({ bucket: "test", objectPath: `project_acceptance/${acceptance.id}.pdf`, fileName: "bien-ban.pdf", contentType: "application/pdf", sizeBytes: 10, ownerType: "project_acceptance", ownerId: acceptance.id, entityId: ids.szm, tier: "personal", status: "ready", uploadedByPersonId: ids.am })
      .returning();
    await signAcceptance(acceptance.id, { signedFileId: file.id, signedOn: todayInVietnam(), signedByClient: "Khách" }, ids.am);
    const items = await db().select().from(schema.projectBillingItem).where(eq(schema.projectBillingItem.projectId, ids.retainer));
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ source: "retainer", retainerPeriodId: over.period.id, amountVnd: 30_000_000 });
    // A second run neither bills it again nor counts it as waiting.
    expect(await runRetainers(today)).toMatchObject({ billed: 0, awaiting: 0 });
  });

  it("asks internal work for nothing: its close-out has no acceptance to wait for", async () => {
    const internal = await createProject({ teamId: ids.team, name: "Nội bộ", description: null, clientId: null, status: "active", visibility: "team", leadPersonId: ids.lead, startDate: null, dueDate: null }, ids.teamLead);
    const item = (await getCloseChecklist(internal.id)).find((check) => check.key === "acceptance")!;
    expect(item).toMatchObject({ met: true, count: null });
  });
});

// ── Q25 ─────────────────────────────────────────────────────────────────────────────────────

describe("a private project opened by a leader (Q25)", () => {
  it("opens to pjm:portfolio and leaves an audit row saying who looked", async () => {
    expect(await privateReadsOf("director")).toHaveLength(0);
    const context = await openProject(asUser("director"), ids.secret);
    expect(context?.project.name).toBe("Dự án kín");
    const rows = await privateReadsOf("director");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ resourceType: "work_project", resourceId: ids.secret, entityId: ids.szm, summary: "Dự án kín", actorEmail: "director@suzu.group" });
    expect(rows[0].after).toMatchObject({ visibility: "private", via: "pjm:portfolio" });
  });

  it("stays shut to everyone else, and audits nothing when its own people read it", async () => {
    for (const who of ["member", "colleague", "hr", "payroll", "auditor"] as const) {
      expect(await openProject(asUser(who), ids.secret), who).toBeNull();
      expect(await privateReadsOf(who), who).toHaveLength(0);
    }
    // Its lead and the owning team's lead are its people: they read it as their own work.
    for (const who of ["lead", "teamLead"] as const) {
      expect((await openProject(asUser(who), ids.secret))?.project.name, who).toBe("Dự án kín");
      expect(await privateReadsOf(who), who).toHaveLength(0);
    }
  });

  it("refuses the reader every write in it", async () => {
    const director = asUser("director");
    const refused: [string, Record<string, unknown>][] = [
      ["projects.plan.settings", { projectId: ids.secret, kind: "internal", budgetHours: null, roles: [], updateCadenceDays: 7, driveUrl: null }],
      ["projects.milestone.save", { projectId: ids.secret, name: "Mốc", isClientFacing: false, isBilling: false, sortOrder: 0 }],
      ["projects.deliverable.save", { projectId: ids.secret, title: "Sản phẩm", quantity: 1, sortOrder: 0 }],
      ["projects.status.post", { projectId: ids.secret, health: "on_track", summary: "Ổn" }],
      ["projects.raid.save", { projectId: ids.secret, kind: "risk", title: "Rủi ro", severity: "high" }],
      ["projects.meeting.save", { projectId: ids.secret, kind: "weekly", heldOn: todayInVietnam(), notes: "Ghi chú" }],
      ["projects.documents.create_space", { projectId: ids.secret }],
      ["projects.close", { projectId: ids.secret, overrideReason: "Không" }],
      ["projects.plan.fee", { projectId: ids.secret, feeVnd: 1_000_000 }],
    ];
    for (const [name, input] of refused) {
      const pipeline = pipelines.get(name);
      expect(pipeline, name).toBeTruthy();
      expect(await pipeline!.authorize(director, input), name).toBe(false);
    }
  });

  it("records the read of one of its tasks too, which opens without its board", async () => {
    const { createWorkTask, getTaskDetail } = await import("../work/tasks");
    const { task } = await createWorkTask({ teamId: ids.team, projectId: ids.secret, title: "Bảng giá khung (bảo mật)" }, ids.lead);
    const before = (await privateReadsOf("director")).length;
    const detail = (await getTaskDetail(task.id, await loadedViewer("director")))!;
    expect(detail.task.title).toBe("Bảng giá khung (bảo mật)");
    await auditPrivateTaskRead(asUser("director"), await loadedViewer("director"), detail);
    const rows = await privateReadsOf("director");
    expect(rows).toHaveLength(before + 1);
    expect(rows.at(-1)).toMatchObject({ resourceType: "work_project", resourceId: ids.secret, summary: "Dự án kín" });
    // Its own people read their own work without a trail, and so does a task outside any project.
    for (const who of ["lead", "teamLead"] as const) {
      await auditPrivateTaskRead(asUser(who), await loadedViewer(who), detail);
      expect(await privateReadsOf(who), who).toHaveLength(0);
    }
    const loose = await createWorkTask({ teamId: ids.team, projectId: null, title: "Việc rời" }, ids.lead);
    const looseDetail = (await getTaskDetail(loose.task.id, await loadedViewer("director")))!;
    await auditPrivateTaskRead(asUser("director"), await loadedViewer("director"), looseDetail);
    expect(await privateReadsOf("director")).toHaveLength(before + 1);
  });

  it("leaves the circle its work may be given to exactly as it was: its members and the team's leads", async () => {
    const assignable = (await listAssignable(ids.team, ids.secret)).map((person) => person.id);
    expect(assignable).toContain(ids.lead);
    expect(assignable).toContain(ids.teamLead);
    for (const who of ["director", "member", "am", "colleague"] as const) expect(assignable, who).not.toContain(ids[who]);
  });
});

/** The work viewer of one of these people, loaded from the database as a page would load it. */
async function loadedViewer(who: Who) {
  const { loadViewer } = await import("../work/viewer");
  return loadViewer(viewerOf(who));
}
