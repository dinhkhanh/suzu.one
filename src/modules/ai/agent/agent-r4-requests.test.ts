// Phase 13 R4 against a real Postgres (PGlite): the asker's own requests proposed and confirmed —
// leave, an attendance request, a request of a designed type, a project's status update. Each card
// is made by its tool and confirmed through the REAL action pipeline (`confirmProposalAction`
// calling the module's own action) with only the session and Next's cache stubbed; and each tool
// refuses, with nothing stored, what its module would refuse.
//
// The cast: Quân manages Huy and Tâm, who sit in the Video unit; Tâm leads the "Phim Tết" project of
// the Video team, which Long leads; Huy is a member of that team; Khoa is outside it.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const session = vi.hoisted(() => ({ user: null as unknown }));
vi.mock("@/lib/db", () => import("../../../../tests/helpers/db"));
vi.mock("@/lib/env", () => ({ env: () => ({ BETTER_AUTH_URL: "https://suzu.one", EMBEDDINGS_MODEL: "@cf/baai/bge-m3" }), isDevelopmentEnvironment: () => true }));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined, revalidateTag: () => undefined, unstable_cache: (fn: unknown) => fn }));
vi.mock("@/modules/platform/auth/session", () => ({ getCurrentUser: async () => session.user, requireUser: async () => session.user }));

import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { leaveSeedRows } from "@/modules/leave/seed-types";
import type { CurrentUser } from "@/modules/platform/auth/session";
import { REQUEST_TYPE_SEED } from "@/modules/requests/seed-types";
import { createProject } from "@/modules/work/projects";
import { createTeam, setTeamMember } from "@/modules/work/teams";
import { migrateTestDb } from "../../../../tests/helpers/db";
import { workflow } from "../../../../tests/helpers/workflows";
import { confirmProposalAction } from "../proposal-actions";
import { type AnyAgentTool, NO_FACTS, runAgentTool } from "./registry";
import { pickNamed, PROPOSE_REQUEST_TOOLS } from "./tools/propose-requests";

type Who = "quan" | "huy" | "tam" | "long" | "khoa";
const NAMES: Record<Who, string> = { quan: "Tran Van Quan", huy: "Ho Gia Huy", tam: "Bui Thanh Tam", long: "Dang Hoang Long", khoa: "Vu Dang Khoa" };
const ids = {} as Record<Who | "szm" | "unit" | "video" | "tet", string>;
const types = {} as Record<string, string>;
const users = {} as Record<Who, CurrentUser>;
// Monday 12 October 2026, 10:00 in Vietnam.
const today = "2026-10-12";

const tool = (name: string): AnyAgentTool => PROPOSE_REQUEST_TOOLS.find((candidate) => candidate.name === name)!;
const run = (who: Who, name: string, input: unknown) => runAgentTool(tool(name), { user: users[who], today, locale: "vi" }, input);
const confirm = (who: Who, result: Awaited<ReturnType<typeof run>>) => {
  session.user = users[who];
  return confirmProposalAction({ id: result.card?.proposal?.id ?? "" });
};
const proposals = async () => (await db().select({ id: schema.aiProposal.id }).from(schema.aiProposal)).length;

beforeAll(async () => {
  // Only the clock is faked; timers stay real for PGlite.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-12T03:00:00Z"));
  await migrateTestDb();
  const [szm] = await db().insert(schema.entity).values({ code: "SZM", legalName: "SuZu Media", shortName: "Media" }).returning();
  const [unit] = await db().insert(schema.orgUnit).values({ code: "VID", name: "Video" }).returning();
  Object.assign(ids, { szm: szm.id, unit: unit.id });
  for (const who of Object.keys(NAMES) as Who[]) {
    const managed = who === "huy" || who === "tam";
    const [row] = await db()
      .insert(schema.person)
      .values({
        fullName: NAMES[who],
        searchName: NAMES[who].toLowerCase(),
        workEmail: `${who}@suzu.group`,
        status: "active",
        workforceType: "employee",
        primaryEntityId: szm.id,
        orgUnitId: who === "khoa" ? null : unit.id,
        managerId: managed ? ids.quan : null,
      })
      .returning();
    ids[who] = row.id;
    await db()
      .insert(schema.employment)
      .values({ personId: row.id, entityId: szm.id, employeeCode: `SZM-${who}`, startDate: "2023-01-09", seniorityDate: "2023-01-09" });
    await db().insert(schema.personProfile).values({ personId: row.id, gender: "male" });
    users[who] = {
      userId: `user-${who}`,
      sessionId: `session-${who}`,
      reauthAt: null,
      preferences: { locale: null, theme: null, navPins: [] },
      email: `${who}@suzu.group`,
      name: NAMES[who],
      image: null,
      person: row,
      impersonator: null,
      principal: { personId: row.id, workforceType: "employee", grants: [] },
      request: { ipAddress: null, userAgent: null },
    } as CurrentUser;
  }

  // Leave: the seeded types, an office week, and Tâm away (approved) on 27 October.
  await db()
    .insert(schema.statutoryParameter)
    .values({ key: "leave.annual", value: { baseDays: 12, yearsOfServicePerExtraDay: 5 }, validFrom: "2021-01-01", status: "approved" });
  const office = { type: "working" as const, segments: [{ start: "08:30", end: "17:30" }], breakMinutes: 60 };
  await db()
    .insert(schema.workSchedule)
    .values({ name: "Office week", kind: "fixed", pattern: { days: { 1: office, 2: office, 3: office, 4: office, 5: office, 6: { type: "off" }, 7: { type: "off" } } }, entityId: null, isDefault: true });
  for (const seed of leaveSeedRows()) {
    const [created] = await db().insert(schema.leaveType).values(seed.type).returning();
    types[created.code] = created.id;
    if (seed.policy)
      await db()
        .insert(schema.leavePolicy)
        .values({ ...seed.policy, leaveTypeId: created.id });
  }
  const [away] = await db()
    .insert(schema.leaveRequest)
    .values({ personId: ids.tam, entityId: szm.id, leaveTypeId: types.UNPAID, startDate: "2026-10-27", endDate: "2026-10-27", totalCenti: 100, status: "approved", filedByPersonId: ids.tam })
    .returning();
  await db().insert(schema.leaveRequestDay).values({ requestId: away.id, personId: ids.tam, date: "2026-10-27", portion: "full", amountCenti: 100 });

  // Requests: the purchase form, on the line manager alone.
  const purchase = REQUEST_TYPE_SEED.find((seed) => seed.code === "purchase")!;
  await db()
    .insert(schema.requestType)
    .values({ ...purchase, flow: undefined } as typeof schema.requestType.$inferInsert);
  await db()
    .insert(schema.approvalFlow)
    .values({ requestType: "request:purchase", entityId: null, definition: { steps: [{ key: "manager", mode: "any", approvers: [{ rule: "line_manager" }] }] } });

  // Projects.
  const video = await createTeam({ key: "VID", name: "Video Production", description: null, entityId: szm.id, departmentId: null, defaultVisibility: "team", isActive: true }, workflow("simple"), ids.long);
  ids.video = video.id;
  for (const who of ["huy", "tam"] as const) await setTeamMember(video.id, ids[who], "member");
  ids.tet = (await createProject({ teamId: video.id, name: "Phim Tết", description: null, clientId: null, status: "active", visibility: "team", leadPersonId: ids.tam, startDate: "2026-10-01", dueDate: "2026-12-20" }, ids.long)).id;
}, 120_000);

afterAll(() => vi.useRealTimers());

describe("the tools", () => {
  it("are propose tools of the asker's own, and the status update is offered to leads only", () => {
    expect(PROPOSE_REQUEST_TOOLS.map((candidate) => candidate.name)).toEqual(["propose_leave", "propose_attendance_request", "propose_request", "propose_status_update"]);
    for (const candidate of PROPOSE_REQUEST_TOOLS) expect(candidate).toMatchObject({ kind: "propose", tier: "personal", stepUp: false, tags: [] });
    const principal = users.huy.principal;
    expect(tool("propose_status_update").offeredTo(principal, NO_FACTS)).toBe(false);
    expect(tool("propose_status_update").offeredTo(principal, { ...NO_FACTS, leadsWork: true })).toBe(true);
    expect(tool("propose_leave").offeredTo(principal, NO_FACTS)).toBe(true);
  });

  it("names one row by code, whole name, or the only partial match", () => {
    const rows = [
      { code: "UNPAID", name: "Nghỉ không lương" },
      { code: "SABBATICAL", name: "Nghỉ không lương dài hạn" },
      { code: "ANNUAL", name: "Nghỉ phép năm" },
    ];
    const words = (row: (typeof rows)[number]) => [row.code, row.name];
    expect(pickNamed(rows, "nghi khong luong", words)).toEqual({ one: rows[0] });
    expect(pickNamed(rows, "annual", words)).toEqual({ one: rows[2] });
    expect(pickNamed(rows, "phép năm", words)).toEqual({ one: rows[2] });
    expect("many" in pickNamed(rows, "không lương d", words) ? "many" : "other").toBe("other");
    expect("many" in pickNamed(rows, "nghỉ", words)).toBe(true);
  });
});

describe("leave (leave.request.submit)", () => {
  it("costs the request like the screen, shows who is away, and files it on confirm", async () => {
    const result = await run("huy", "propose_leave", { leaveType: "nghỉ không lương", startDate: "2026-10-26", endDate: "2026-10-27", reason: "Việc gia đình" });
    expect(result.outcome).toBe("proposed");
    const proposal = result.card!.proposal!;
    expect(proposal.action).toBe("leave.request.submit");
    expect(proposal.fields.map((field) => field.key)).toEqual(["leaveType", "startDate", "endDate", "days", "colleaguesAway", "reason"]);
    expect(proposal.fields.find((field) => field.key === "days")).toMatchObject({ valueKey: "days", params: { days: 2 } });
    expect(proposal.fields.find((field) => field.key === "colleaguesAway")?.text).toBe(`${NAMES.tam}: 27/10`);
    expect(proposal.notify).toEqual([NAMES.quan]);
    expect(proposal.editHref).toBe(`/leave/new?type=${types.UNPAID}&from=2026-10-26&to=2026-10-27&startPortion=full&endPortion=full&proposal=${proposal.id}`);
    expect(await db().select().from(schema.leaveRequest).where(eq(schema.leaveRequest.personId, ids.huy))).toHaveLength(0);

    expect(await confirm("huy", result)).toMatchObject({ ok: true, data: { state: "confirmed" } });
    const [filed] = await db().select().from(schema.leaveRequest).where(eq(schema.leaveRequest.personId, ids.huy));
    expect(filed).toMatchObject({ leaveTypeId: types.UNPAID, startDate: "2026-10-26", endDate: "2026-10-27", totalCenti: 200, reason: "Việc gia đình", status: "pending", filedByPersonId: ids.huy });
  });

  it("asks which type when the words fit several, and makes no card", async () => {
    const before = await proposals();
    const result = await run("huy", "propose_leave", { leaveType: "nghỉ", startDate: "2026-11-02" });
    expect(result.model).toMatchObject({ proposed: false, reason: "several_leave_types" });
    expect((await run("huy", "propose_leave", { startDate: "2026-11-02" })).model).toMatchObject({ reason: "which_leave_type" });
    expect(await proposals()).toBe(before);
  });

  it("returns the module's problems instead of a card: a type he may not take, no balance, too little notice", async () => {
    const maternity = await run("huy", "propose_leave", { leaveType: "MATERNITY", startDate: "2026-12-07", endDate: "2026-12-11" });
    expect(maternity.outcome).toBe("refused");
    expect(maternity.model).toMatchObject({ reason: "leave_problems" });
    expect((maternity.model as { problems: string[] }).problems).toContain("leave_not_eligible_gender");
    const annual = await run("huy", "propose_leave", { leaveType: "phép năm", startDate: "2026-10-13" });
    expect((annual.model as { problems: string[] }).problems).toEqual(expect.arrayContaining(["leave_notice_too_short"]));
    expect(annual.card).toBeNull();
  });
});

describe("attendance (attendance.request.submit)", () => {
  it("proposes overtime and files it on confirm", async () => {
    const result = await run("huy", "propose_attendance_request", { type: "overtime", date: "2026-10-14", from: "18:00", to: "21:00", compensation: "pay", reason: "Xuất bản phim kịp hạn" });
    expect(result.outcome).toBe("proposed");
    const proposal = result.card!.proposal!;
    expect(proposal.fields.map((field) => field.key)).toEqual(["attendanceType", "date", "window", "overtimeHours", "compensation", "reason"]);
    expect(proposal.fields[0]).toMatchObject({ valueKey: "attendance_overtime" });
    expect(proposal.notify).toEqual([NAMES.quan]);
    expect(proposal.editHref).toBe(`/attendance/requests/new?type=overtime&date=2026-10-14&proposal=${proposal.id}`);
    expect(await confirm("huy", result)).toMatchObject({ ok: true, data: { state: "confirmed" } });
    const [filed] = await db().select().from(schema.attendanceRequest).where(eq(schema.attendanceRequest.personId, ids.huy));
    expect(filed).toMatchObject({ type: "overtime", startDate: "2026-10-14", compensation: "pay", status: "pending", details: { type: "overtime", from: "18:00", to: "21:00" } });
  });

  it("proposes a correction of a past day and files it", async () => {
    const result = await run("tam", "propose_attendance_request", { type: "attendance_correction", date: "2026-10-09", inTime: "08:25", cause: "device_error", reason: "Máy chấm công lỗi" });
    expect(result.card?.proposal?.fields.map((field) => field.key)).toEqual(["attendanceType", "date", "inTime", "cause", "reason"]);
    expect(await confirm("tam", result)).toMatchObject({ ok: true, data: { state: "confirmed" } });
    const [filed] = await db().select().from(schema.attendanceRequest).where(eq(schema.attendanceRequest.personId, ids.tam));
    expect(filed.details).toMatchObject({ type: "attendance_correction", cause: "device_error", inTime: "08:25" });
  });

  it("asks for what the module would refuse without it, and makes no card", async () => {
    const before = await proposals();
    expect((await run("huy", "propose_attendance_request", { type: "remote_work", date: "2026-10-15" })).model).toMatchObject({ reason: "reason_required" });
    expect((await run("huy", "propose_attendance_request", { type: "attendance_correction", date: "2026-10-20", inTime: "08:30", reason: "Quên chấm" })).model).toMatchObject({ reason: "correction_future" });
    expect((await run("huy", "propose_attendance_request", { type: "overtime", date: "2026-10-15", from: "18:00", to: "20:00", reason: "Gấp" })).model).toMatchObject({ reason: "overtime_compensation_required" });
    expect((await run("huy", "propose_attendance_request", { type: "remote_work", date: "2026-10-15", kind: "off_site", reason: "Quay ngoại cảnh" })).model).toMatchObject({ reason: "remote_needs_location" });
    expect(await proposals()).toBe(before);
  });
});

describe("requests (request.file)", () => {
  const values = { item: "Ổ cứng SSD 2TB", quantity: 2, amount: 6_000_000, category: "Máy tính, phần mềm", needed_by: "2026-10-30", reason: "Lưu dữ liệu quay phim Tết" };

  it("returns the form's fields when the model does not know them yet", async () => {
    const result = await run("huy", "propose_request", { type: "mua sắm" });
    expect(result.model).toMatchObject({ proposed: false, reason: "fields_needed", type: { code: "purchase" } });
    const fields = (result.model as { fields: { key: string; required: boolean; options?: { value: string }[] }[] }).fields;
    expect(fields.find((field) => field.key === "item")).toMatchObject({ required: true, label: "Hạng mục cần mua", type: "text" });
    expect(fields.find((field) => field.key === "category")?.options?.map((option) => option.value)).toContain("it");
  });

  it("checks the answers as filing will, and files the request on confirm", async () => {
    const result = await run("huy", "propose_request", { type: "purchase", values });
    expect(result.outcome).toBe("proposed");
    const proposal = result.card!.proposal!;
    expect(proposal.fields[0]).toMatchObject({ key: "requestType", text: "Đề nghị mua sắm" });
    // The form's own labels, as the admin wrote them, beside each answer.
    expect(proposal.fields.map((field) => `${field.label}: ${field.text}`)).toEqual(expect.arrayContaining(["Nhóm chi phí: Máy tính, phần mềm", "Số tiền dự kiến (VNĐ): 6.000.000 ₫", "Cần có trước ngày: 30/10/2026"]));
    expect(proposal.notify).toEqual([NAMES.quan]);
    expect(proposal.editHref).toBe(`/requests/new/purchase?proposal=${proposal.id}`);
    expect(await confirm("huy", result)).toMatchObject({ ok: true, data: { state: "confirmed" } });
    const [submission] = await db().select().from(schema.requestSubmission).where(eq(schema.requestSubmission.typeCode, "purchase"));
    expect(submission).toMatchObject({ amount: 6_000_000, values: { item: "Ổ cứng SSD 2TB", category: "it", quantity: 2 } });
  });

  it("names the invalid answers and an unknown type instead of a card", async () => {
    const before = await proposals();
    const invalid = await run("huy", "propose_request", { type: "purchase", values: { ...values, category: "đồ ăn", reason: "ngắn" } });
    expect(invalid.model).toMatchObject({ reason: "invalid_values" });
    expect((invalid.model as { problems: { field: string; problem: string }[] }).problems).toEqual(
      expect.arrayContaining([
        { field: "category", problem: "not_an_option" },
        { field: "reason", problem: "too_short" },
      ]),
    );
    expect((await run("huy", "propose_request", { type: "nghỉ việc", values })).model).toMatchObject({ reason: "request_type_not_found" });
    expect(await proposals()).toBe(before);
  });
});

describe("a project's status update (projects.status.post)", () => {
  it("drafts the summary when none was given, and posts it on confirm", async () => {
    const result = await run("tam", "propose_status_update", { project: "Phim Tết" });
    expect(result.outcome).toBe("proposed");
    const proposal = result.card!.proposal!;
    expect(proposal.fields.map((field) => field.key)).toEqual(["project", "health", "summary"]);
    expect(proposal.fields[1].valueKey).toMatch(/^health_/u);
    expect(proposal.fields[2].text?.length).toBeGreaterThan(0);
    expect(result.model).toMatchObject({ change: { drafted: true } });
    // The project's people and the team's lead hear of it; the author does not.
    expect(proposal.notify).toEqual(expect.arrayContaining([NAMES.long]));
    expect(proposal.notify).not.toContain(NAMES.tam);
    expect(proposal.editHref).toBe(`/projects/${ids.tet}/updates?proposal=${proposal.id}`);
    expect(await confirm("tam", result)).toMatchObject({ ok: true, data: { state: "confirmed" } });
    expect(await db().select().from(schema.projectStatusUpdate).where(eq(schema.projectStatusUpdate.projectId, ids.tet))).toHaveLength(1);
  });

  it("takes the lead's own words and health", async () => {
    const result = await run("long", "propose_status_update", { project: ids.tet, health: "at_risk", summary: "Chậm một tuần vì chờ nhạc.", nextSteps: "Chốt nhạc thứ Sáu" });
    expect(result.card?.proposal?.fields).toEqual(
      expect.arrayContaining([
        { key: "health", valueKey: "health_at_risk" },
        { key: "summary", text: "Chậm một tuần vì chờ nhạc." },
        { key: "nextSteps", text: "Chốt nhạc thứ Sáu" },
      ]),
    );
    expect(await confirm("long", result)).toMatchObject({ ok: true, data: { state: "confirmed" } });
    const [latest] = await db().select().from(schema.projectStatusUpdate).where(eq(schema.projectStatusUpdate.health, "at_risk"));
    expect(latest).toMatchObject({ summary: "Chậm một tuần vì chờ nhạc.", nextSteps: "Chốt nhạc thứ Sáu", authorPersonId: ids.long });
  });

  it("is not made for a project the asker does not lead, or cannot see", async () => {
    const before = await proposals();
    expect((await run("huy", "propose_status_update", { project: "Phim Tết", health: "on_track", summary: "Ổn" })).model).toMatchObject({ reason: "not_permitted" });
    expect((await run("khoa", "propose_status_update", { project: "Phim Tết", health: "on_track", summary: "Ổn" })).model).toMatchObject({ reason: "project_not_found" });
    expect(await proposals()).toBe(before);
  });
});
