// Leave use-cases against a real Postgres (PGlite): the ledger job, the request flow on the
// approval engine, cancel / amend, the long-absence event, the import and the team calendar.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => import("../../../tests/helpers/db"));
vi.mock("@/lib/env", () => ({ env: () => ({ allowedWorkspaceDomains: ["suzu.vn", "suzu.group"], bootstrapOwnerEmails: [], BETTER_AUTH_URL: "https://suzu.one" }) }));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
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
import { withdrawRequest } from "@/modules/platform/approvals/service";
import type { Grant, Principal } from "@/modules/platform/rbac/policy";
import { migrateTestDb } from "../../../tests/helpers/db";
import { getTeamCalendar } from "./calendar";
import { commitOpeningRows, resolveOpeningRows } from "./import";
import { adjustBalance, getBalances, getLedger, listPayouts, postCompensatoryLeave, runLeaveAccruals } from "./ledger";
import { amendLeave, cancelLeave, decideLeave, getLeaveOnDays, getLeaveRequestView, getLeaveUsage, type LeaveInput, listLeaveRequestsOf, previewLeave, submitLeave } from "./requests";
import { leaveSeedRows } from "./seed-types";
import { saveLeavePolicy, saveStaffingRule } from "./types";

const ids = {} as Record<"media" | "creative" | "video" | "head" | "lead" | "huy" | "nam" | "linh" | "mai" | "hr" | "owner" | "leaver", string>;
const types = {} as Record<string, string>;
const principal = (personId: string, grants: Grant[] = []): Principal => ({ personId, workforceType: "employee", grants });

async function addPerson(name: string, options: { entityId?: string; managerId?: string | null; start?: string; end?: string | null; workforceType?: "employee" | "probation"; gender?: "male" | "female"; code: string }) {
  const entityId = options.entityId ?? ids.media;
  const [person] = await db().insert(schema.person).values({ fullName: name, searchName: name.toLowerCase(), workEmail: `${options.code.toLowerCase()}@suzu.group`, workforceType: options.workforceType ?? "employee", status: "active", primaryEntityId: entityId, departmentId: ids.video, managerId: options.managerId ?? null }).returning();
  await db().insert(schema.employment).values({ personId: person.id, entityId, employeeCode: options.code, startDate: options.start ?? "2024-01-15", seniorityDate: options.start ?? "2024-01-15", endDate: options.end ?? null });
  await db().insert(schema.personProfile).values({ personId: person.id, gender: options.gender ?? "male" });
  return person.id;
}

const request = (overrides: Partial<LeaveInput> = {}): LeaveInput => ({ leaveTypeId: types.ANNUAL, startDate: "2026-10-05", endDate: "2026-10-06", startPortion: "full", endPortion: "full", minutes: null, reason: null, attachmentFileId: null, ...overrides });
const self = (personId: string) => ({ personId, isHr: false });
const balance = async (personId: string, code = "ANNUAL", year = 2026) => (await getBalances([personId], year)).get(personId)!.find((row) => row.code === code)!;
const fails = (promise: Promise<unknown>) => promise.then(() => "no error", (error: Error) => error.message);

beforeAll(async () => {
  // Saturday 19 September 2026, 10:00 in Vietnam. Only the clock is faked; timers stay real for PGlite.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-19T03:00:00Z"));
  await migrateTestDb();

  const [media] = await db().insert(schema.entity).values({ code: "SZM", legalName: "Suzu Media", shortName: "Media" }).returning();
  const [creative] = await db().insert(schema.entity).values({ code: "SZC", legalName: "Suzu Creative", shortName: "Creative" }).returning();
  const [video] = await db().insert(schema.department).values({ code: "VID", name: "Video" }).returning();
  Object.assign(ids, { media: media.id, creative: creative.id, video: video.id });

  ids.owner = await addPerson("The Owner", { code: "SZM-0001", start: "2019-03-01" });
  ids.head = await addPerson("Dept Head", { code: "SZM-0002", start: "2020-09-14", managerId: ids.owner });
  ids.lead = await addPerson("Team Lead", { code: "SZM-0003", managerId: ids.head });
  ids.huy = await addPerson("Huy", { code: "SZM-0004", start: "2023-07-17", managerId: ids.head });
  ids.nam = await addPerson("Nam", { code: "SZM-0005", start: "2025-04-01", managerId: ids.lead });
  ids.linh = await addPerson("Linh", { code: "SZM-0006", start: "2026-08-03", managerId: ids.head, workforceType: "probation", gender: "female" });
  ids.mai = await addPerson("Mai", { code: "SZM-0007", start: "2021-03-01", managerId: ids.head, gender: "female" });
  ids.hr = await addPerson("Hr Staff", { code: "SZM-0008", managerId: ids.owner });
  ids.leaver = await addPerson("Leaver", { code: "SZM-0009", start: "2022-01-01", end: "2026-08-31", managerId: ids.head });
  await db().insert(schema.roleAssignment).values([
    { personId: ids.owner, role: "owner", scopeType: "group" },
    { personId: ids.head, role: "department_head", scopeType: "department", scopeId: video.id },
    { personId: ids.hr, role: "hr_staff", scopeType: "entity", scopeId: media.id },
  ]);

  await db().insert(schema.statutoryParameter).values({ key: "leave.annual", value: { baseDays: 12, yearsOfServicePerExtraDay: 5 }, validFrom: "2021-01-01", status: "approved" });
  // The default week of SRS D15: office Monday–Friday, Saturday a work-from-home day without punches.
  const office = { type: "working" as const, segments: [{ start: "08:30", end: "17:30" }], breakMinutes: 60 };
  await db().insert(schema.workSchedule).values({ name: "Office week", kind: "fixed", pattern: { days: { 1: office, 2: office, 3: office, 4: office, 5: office, 6: { type: "untracked", creditMinutes: 480 }, 7: { type: "off" } } }, entityId: null, isDefault: true });
  await db().insert(schema.calendarDay).values({ date: "2026-10-08", kind: "company_off", name: "Company day" });
  for (const seed of leaveSeedRows()) {
    const [created] = await db().insert(schema.leaveType).values(seed.type).returning();
    types[created.code] = created.id;
    if (seed.policy) await db().insert(schema.leavePolicy).values({ ...seed.policy, leaveTypeId: created.id });
  }
});

afterAll(() => vi.useRealTimers());

describe("the ledger job", () => {
  it("posts one accrual per month that became due, and nothing the second time", async () => {
    const first = await runLeaveAccruals("2026-09-19");
    expect(first.accruals).toBeGreaterThan(0);
    // Twelve days a year, nine months reached.
    expect((await balance(ids.huy)).balanceCenti).toBe(900);
    const rows = (await getLedger(ids.huy, { year: 2026, leaveTypeId: types.ANNUAL })).filter((row) => row.kind === "accrual");
    expect(rows).toHaveLength(9);
    expect(rows.at(-1)).toMatchObject({ effectiveDate: "2026-01-01", amountCenti: 100 });
    // Thirteen days for five years of service by the end of the year: 9 × 13 / 12 = 9.75.
    expect((await balance(ids.mai)).balanceCenti).toBe(975);
    // A joiner of 3 August: August and September.
    expect((await balance(ids.linh)).balanceCenti).toBe(200);
    // The birthday day is a yearly grant — not for someone on probation (no_accrual).
    expect((await balance(ids.huy, "BIRTHDAY")).balanceCenti).toBe(100);
    expect((await balance(ids.linh, "BIRTHDAY")).balanceCenti).toBe(0);

    const second = await runLeaveAccruals("2026-09-19");
    expect(second).toMatchObject({ accruals: 0, yearsClosed: 0, lapsed: 0, payouts: 0 });
    expect((await balance(ids.huy)).balanceCenti).toBe(900);
  });

  it("pays out a leaver's unused days once, for payroll to pick up", async () => {
    // Eight months count → 12 × 8 / 12 = 8 days, all unused.
    const ledger = await getLedger(ids.leaver, { year: 2026, leaveTypeId: types.ANNUAL });
    expect(ledger.find((row) => row.kind === "payout")).toMatchObject({ amountCenti: -800, effectiveDate: "2026-08-31" });
    expect((await balance(ids.leaver)).balanceCenti).toBe(0);
    expect(await listPayouts(ids.media, "2026-08-01", "2026-08-31")).toEqual([expect.objectContaining({ personId: ids.leaver, typeCode: "ANNUAL", daysCenti: 800 })]);
  });

  it("leaves out the months an imported opening balance already contains", async () => {
    const user = { principal: principal(ids.hr, [{ role: "hr_staff", scope: { type: "entity", id: ids.media } }]), person: { id: ids.hr } };
    const row = (employeeCode: string, days: string, overrides: Record<string, unknown> = {}) => ({ row: 2, values: { employeeCode, typeCode: "ANNUAL", year: 2026, days, asOf: "2026-09-01", note: null, ...overrides } });
    const newcomer = await addPerson("Imported", { code: "SZM-0010", start: "2022-02-01", managerId: ids.head });
    const outsider = await addPerson("Outsider", { code: "SZC-0001", entityId: ids.creative });

    const { problems } = await resolveOpeningRows([row("SZM-0010", "6.5"), row("SZM-0010", "1"), row("SZC-0001", "3"), row("SZM-9999", "1"), row("SZM-0004", "1", { typeCode: "SICK" }), row("SZM-0004", "1", { asOf: "2025-12-31" })], user);
    expect(problems.map((problem) => problem.code).sort()).toEqual(["as_of_outside_year", "duplicate_in_file", "leave_type_keeps_no_balance", "person_not_found", "person_not_found"]);

    const counts = await db().transaction((tx) => commitOpeningRows([row("SZM-0010", "6.5")], tx as never, user));
    expect(counts).toEqual({ posted: 1, totalCenti: 650 });
    expect((await resolveOpeningRows([row("SZM-0010", "6.5")], user)).problems.map((problem) => problem.code)).toEqual(["opening_exists"]);

    await runLeaveAccruals("2026-09-19", { personIds: [newcomer, outsider] });
    // 6.5 as at 1 September + September's day; January–August are inside the opening balance.
    expect((await balance(newcomer)).balanceCenti).toBe(750);
    const kinds = (await getLedger(newcomer, { leaveTypeId: types.ANNUAL })).map((entry) => `${entry.kind}:${entry.amountCenti}`);
    expect(kinds.sort()).toEqual(["accrual:100", "opening:650"]);
  });

  it("closes a year: carries up to the cap, lapses the rest, then lapses unused carried days", async () => {
    const person = await addPerson("Saver", { code: "SZM-0011", start: "2020-01-01", managerId: ids.head });
    await runLeaveAccruals("2026-12-31", { personIds: [person] });
    expect((await balance(person)).balanceCenti).toBe(1300);

    const january = await runLeaveAccruals("2027-01-02", { personIds: [person] });
    // Two balances close: annual leave and the birthday day (which never carries over).
    expect(january.yearsClosed).toBe(2);
    // Thirteen days left; five carry over, eight lapse; 2027 opens with the five plus January.
    expect((await balance(person, "ANNUAL", 2026)).balanceCenti).toBe(0);
    const year2027 = await getLedger(person, { year: 2027, leaveTypeId: types.ANNUAL });
    expect(year2027.find((row) => row.kind === "carry_over")).toMatchObject({ amountCenti: 500, effectiveDate: "2027-01-01" });
    expect((await balance(person, "ANNUAL", 2027)).balanceCenti).toBe(608);

    // Two carried days used in February; on 1 April the other three are gone.
    await db().insert(schema.leaveLedgerEntry).values({ personId: person, entityId: ids.media, leaveTypeId: types.ANNUAL, leaveYear: 2027, kind: "use", amountCenti: -200, effectiveDate: "2027-02-15" });
    const april = await runLeaveAccruals("2027-04-01", { personIds: [person] });
    expect(april.lapsed).toBe(1);
    expect((await getLedger(person, { year: 2027, leaveTypeId: types.ANNUAL })).find((row) => row.kind === "expiry")).toMatchObject({ amountCenti: -300, effectiveDate: "2027-03-31" });
    expect((await runLeaveAccruals("2027-04-01", { personIds: [person] })).lapsed).toBe(0);
  });

  it("takes HR's adjustment with a reason and time off in lieu from attendance", async () => {
    const { balanceBefore, balanceAfter } = await adjustBalance({ personId: ids.nam, leaveTypeId: types.ANNUAL, year: 2026, amountCenti: 150, reason: "Bù ngày phép 2025 chưa chuyển" }, ids.hr);
    expect([balanceBefore, balanceAfter]).toEqual([900, 1050]);
    expect(await fails(adjustBalance({ personId: ids.nam, leaveTypeId: types.SICK, year: 2026, amountCenti: 100, reason: "no balance kept" }, ids.hr))).toBe("leave_type_keeps_no_balance");

    await db().transaction((tx) => postCompensatoryLeave(tx, { personId: ids.nam, amountCenti: 50, effectiveDate: "2026-09-12", sourceKey: "ot-1", reason: "OT 4h", actorPersonId: ids.lead }));
    await db().transaction((tx) => postCompensatoryLeave(tx, { personId: ids.nam, amountCenti: 50, effectiveDate: "2026-09-12", sourceKey: "ot-1", reason: "OT 4h", actorPersonId: ids.lead }));
    expect((await balance(ids.nam, "COMP")).balanceCenti).toBe(50);
  });
});

describe("requests", () => {
  it("previews the cost on the person's own calendar, with everything that is wrong at once", async () => {
    // Mon 5 – Mon 12 October: two weekends (Saturday is an untracked WFH day) and a company day off.
    const preview = await previewLeave(ids.huy, request({ startDate: "2026-10-05", endDate: "2026-10-12" }));
    expect(preview.counted.totalCenti).toBe(500);
    expect(preview.counted.days.map((day) => day.date)).toEqual(["2026-10-05", "2026-10-06", "2026-10-07", "2026-10-09", "2026-10-12"]);
    expect(preview.problems).toEqual([]);
    // Unpaid leave counts the Saturday too: it must not be credited as worked.
    expect((await previewLeave(ids.huy, request({ leaveTypeId: types.UNPAID, startDate: "2026-10-05", endDate: "2026-10-12" }))).counted.totalCenti).toBe(600);
    expect((await previewLeave(ids.huy, request({ startDate: "2026-09-21", endDate: "2026-10-06" }))).problems.sort()).toEqual(["leave_balance_insufficient", "leave_notice_too_short"]);
    expect((await previewLeave(ids.linh, request())).problems).toEqual(["leave_on_probation"]);
    expect((await previewLeave(ids.huy, request({ leaveTypeId: types.MATERNITY, startDate: "2026-11-02", endDate: "2026-11-30", attachmentFileId: null }))).problems.sort()).toEqual(["leave_attachment_required", "leave_not_eligible_gender"]);
  });

  it("files with the line manager, holds the days, and books them on approval", async () => {
    const filed = await submitLeave(ids.nam, request(), self(ids.nam));
    expect(filed.outcome).toBe("pending");
    expect(await balance(ids.nam)).toMatchObject({ balanceCenti: 1050, pendingCenti: 200, availableCenti: 850 });
    expect(await fails(submitLeave(ids.nam, request({ startDate: "2026-10-06", endDate: "2026-10-06" }), self(ids.nam)))).toBe("leave_overlaps");

    // Not the colleague's business; HR of the entity follows it; only the asked manager decides.
    expect(await getLeaveRequestView({ personId: ids.huy, principal: principal(ids.huy) }, filed.approvalRequestId)).toBeNull();
    expect((await getLeaveRequestView({ personId: ids.hr, principal: principal(ids.hr, [{ role: "hr_staff", scope: { type: "entity", id: ids.media } }]) }, filed.approvalRequestId))?.canDecide).toBe(false);
    expect(await fails(decideLeave(ids.head, filed.approvalRequestId, { action: "approve", comment: null }))).toBe("approval_not_assignee");
    expect((await getLeaveRequestView({ personId: ids.lead, principal: principal(ids.lead) }, filed.approvalRequestId))?.canDecide).toBe(true);

    const { outcome, leaveRequest } = await decideLeave(ids.lead, filed.approvalRequestId, { action: "approve", comment: null });
    expect([outcome, leaveRequest.status]).toEqual(["approved", "approved"]);
    expect(await balance(ids.nam)).toMatchObject({ balanceCenti: 850, pendingCenti: 0, usedCenti: 200 });
    expect(await getLeaveOnDays([ids.nam], "2026-10-01", "2026-10-31")).toEqual([
      expect.objectContaining({ date: "2026-10-05", portion: "full", typeCode: "ANNUAL", payrollTreatment: "paid_company", isPaid: true }),
      expect.objectContaining({ date: "2026-10-06", amountCenti: 100 }),
    ]);
    expect(await getLeaveUsage({ entityId: ids.media }, "2026-10-01", "2026-10-31")).toEqual([expect.objectContaining({ personId: ids.nam, typeCode: "ANNUAL", daysCenti: 200 })]);
  });

  it("adds the department head for more than three days — once, when that is the line manager", async () => {
    const long = await submitLeave(ids.nam, request({ startDate: "2026-10-19", endDate: "2026-10-23" }), self(ids.nam));
    const afterLead = await decideLeave(ids.lead, long.approvalRequestId, { action: "approve", comment: null });
    expect(afterLead.outcome).toBe("pending");
    expect(afterLead.leaveRequest.status).toBe("pending");
    expect((await decideLeave(ids.head, long.approvalRequestId, { action: "approve", comment: null })).outcome).toBe("approved");

    // Huy reports to the department head directly: one answer is enough.
    const direct = await submitLeave(ids.huy, request({ startDate: "2026-10-19", endDate: "2026-10-23" }), self(ids.huy));
    expect((await decideLeave(ids.head, direct.approvalRequestId, { action: "approve", comment: null })).outcome).toBe("approved");
    expect((await balance(ids.huy)).balanceCenti).toBe(400);
  });

  it("rejects with a comment and gives nothing back because nothing was taken", async () => {
    const filed = await submitLeave(ids.mai, request({ startPortion: "pm", endPortion: "am" }), self(ids.mai));
    expect(filed.leaveRequest.totalCenti).toBe(100);
    expect(await fails(decideLeave(ids.head, filed.approvalRequestId, { action: "reject", comment: null }))).toBe("approval_comment_required");
    const { leaveRequest } = await decideLeave(ids.head, filed.approvalRequestId, { action: "reject", comment: "Tuần đó quay dự án" });
    expect(leaveRequest.status).toBe("rejected");
    expect(await balance(ids.mai)).toMatchObject({ balanceCenti: 975, pendingCenti: 0 });
  });

  it("lets the requester take a pending request back — through leave or through the engine's own withdraw", async () => {
    const first = await submitLeave(ids.mai, request(), self(ids.mai));
    expect((await cancelLeave(first.leaveRequest.id, self(ids.mai), null)).after.status).toBe("withdrawn");

    const second = await submitLeave(ids.mai, request(), self(ids.mai));
    await db().transaction((tx) => withdrawRequest(tx as never, second.approvalRequestId, ids.mai));
    // The engine knows nothing of leave; the days are free at once and the row follows on the next read.
    expect((await balance(ids.mai)).pendingCenti).toBe(0);
    expect((await listLeaveRequestsOf(ids.mai)).find((row) => row.id === second.leaveRequest.id)?.status).toBe("withdrawn");
    expect(await fails(cancelLeave(second.leaveRequest.id, self(ids.huy), null))).toBe("leave_request_not_open");
  });

  it("refunds an approved leave: the person before it starts, HR afterwards", async () => {
    const [nam] = (await listLeaveRequestsOf(ids.nam)).filter((row) => row.startDate === "2026-10-05");
    expect(await fails(cancelLeave(nam.id, self(ids.huy), null))).toBe("leave_cancel_not_allowed");
    const { after } = await cancelLeave(nam.id, self(ids.nam), "Đổi kế hoạch");
    expect(after.status).toBe("cancelled");
    expect(await balance(ids.nam)).toMatchObject({ balanceCenti: 550, usedCenti: 500 });
    expect((await getLedger(ids.nam, { leaveTypeId: types.ANNUAL })).filter((row) => row.requestId === nam.id).map((row) => row.kind).sort()).toEqual(["refund", "use"]);
    expect(await getLeaveOnDays([ids.nam], "2026-10-05", "2026-10-06")).toEqual([]);

    // Sick leave may be filed after the fact; once it has started only HR cancels it.
    const [file] = await db().insert(schema.storedFile).values({ ownerType: "leave_attachment", ownerId: ids.huy, entityId: ids.media, tier: "personal", fileName: "giay-kham.pdf", contentType: "application/pdf", sizeBytes: 1000, bucket: "private", objectPath: "k/giay-kham.pdf", status: "ready", uploadedByPersonId: ids.huy }).returning();
    const sick = await submitLeave(ids.huy, request({ leaveTypeId: types.SICK, startDate: "2026-09-16", endDate: "2026-09-17", attachmentFileId: file.id }), self(ids.huy));
    await decideLeave(ids.head, sick.approvalRequestId, { action: "approve", comment: null });
    expect(await fails(cancelLeave(sick.leaveRequest.id, self(ids.huy), null))).toBe("leave_cancel_started");
    // Once the month's timesheet is locked, leave inside it stays as payroll saw it.
    const [period] = await db().insert(schema.timesheetPeriod).values({ entityId: ids.media, month: "2026-09", status: "locked", lockedAt: new Date(), lockedByPersonId: ids.hr }).returning();
    expect(await fails(cancelLeave(sick.leaveRequest.id, { personId: ids.hr, isHr: true }, "Nhập nhầm ngày"))).toBe("leave_period_locked");
    await db().delete(schema.timesheetPeriod).where(eq(schema.timesheetPeriod.id, period.id));
    expect((await cancelLeave(sick.leaveRequest.id, { personId: ids.hr, isHr: true }, "Nhập nhầm ngày")).after.status).toBe("cancelled");
    const notices = await db().select().from(schema.notification).where(and(eq(schema.notification.recipientPersonId, ids.huy), eq(schema.notification.kind, "approvals.leave_cancelled")));
    expect(notices).toHaveLength(1);
    // Someone else's doctor's note is not an attachment of mine.
    expect(await fails(submitLeave(ids.mai, request({ leaveTypeId: types.SICK, startDate: "2026-09-16", endDate: "2026-09-16", attachmentFileId: file.id }), self(ids.mai)))).toBe("file_not_found");
  });

  it("amends by replacing: the old request ends only if the new one can be filed", async () => {
    const [approved] = (await listLeaveRequestsOf(ids.nam)).filter((row) => row.startDate === "2026-10-19" && row.status === "approved");
    expect(await fails(amendLeave(approved.id, request({ startDate: "2026-11-02", endDate: "2026-11-30" }), self(ids.nam)))).toBe("leave_balance_insufficient");
    expect((await listLeaveRequestsOf(ids.nam)).find((row) => row.id === approved.id)?.status).toBe("approved");

    const amended = await amendLeave(approved.id, request({ startDate: "2026-10-20", endDate: "2026-10-21" }), self(ids.nam));
    expect(amended.leaveRequest).toMatchObject({ amendsRequestId: approved.id, status: "pending", totalCenti: 200 });
    expect((await listLeaveRequestsOf(ids.nam)).find((row) => row.id === approved.id)?.status).toBe("cancelled");
    expect(await balance(ids.nam)).toMatchObject({ balanceCenti: 1050, pendingCenti: 200 });
  });

  it("puts a long absence on the timeline and calls it off with the leave", async () => {
    const [file] = await db().insert(schema.storedFile).values({ ownerType: "leave_attachment", ownerId: ids.mai, entityId: ids.media, tier: "personal", fileName: "giay-hen-sinh.pdf", contentType: "application/pdf", sizeBytes: 1000, bucket: "private", objectPath: "k/giay-hen-sinh.pdf", status: "ready", uploadedByPersonId: ids.mai }).returning();
    const filed = await submitLeave(ids.mai, request({ leaveTypeId: types.MATERNITY, startDate: "2026-11-02", endDate: "2027-05-01", attachmentFileId: file.id }), self(ids.mai));
    const { leaveRequest } = await decideLeave(ids.head, filed.approvalRequestId, { action: "approve", comment: null });
    const [event] = await db().select().from(schema.lifecycleEvent).where(eq(schema.lifecycleEvent.id, leaveRequest.lifecycleEventId!));
    expect(event).toMatchObject({ type: "long_leave", status: "applied", effectiveDate: "2026-11-02", personId: ids.mai });
    expect((await getLeaveUsage({ personIds: [ids.mai] }, "2026-11-01", "2026-11-30"))[0]).toMatchObject({ typeCode: "MATERNITY", payrollTreatment: "paid_insurance", isPaid: true });

    await cancelLeave(leaveRequest.id, self(ids.mai), null);
    expect((await db().select().from(schema.lifecycleEvent).where(eq(schema.lifecycleEvent.id, event.id)))[0].status).toBe("cancelled");
  });

  it("lets HR file for someone, without the notice period", async () => {
    const hr = { personId: ids.hr, isHr: true };
    const filed = await submitLeave(ids.huy, request({ startDate: "2026-09-21", endDate: "2026-09-21" }), hr);
    expect(filed.outcome).toBe("pending");
    const view = await getLeaveRequestView({ personId: ids.head, principal: principal(ids.head) }, filed.approvalRequestId);
    expect(view).toMatchObject({ canDecide: true, requesterName: "Hr Staff", subjectName: "Huy" });
    expect(view?.balance).toMatchObject({ balanceCenti: 400, pendingCenti: 100 });
  });

  it("follows an entity's own policy from its start date", async () => {
    const { before, after } = await saveLeavePolicy({ leaveTypeId: types.ANNUAL, entityId: ids.media, validFrom: "2026-10-01", accrualMethod: "monthly_accrual", baseSource: "statutory_annual", fixedDaysCenti: 0, extraDaysCenti: 200, seniorityBonus: true, prorate: true, rounding: "half_day", probationRule: "accrue_and_use", carryOverCapCenti: 500, carryOverExpiry: "03-31", payoutOnTermination: true, allowNegativeCenti: 0, note: null }, ids.hr);
    expect(before).toBeNull();
    expect(after.validTo).toBeNull();
    expect(await fails(saveLeavePolicy({ leaveTypeId: types.ANNUAL, entityId: ids.media, validFrom: "2026-09-01", accrualMethod: "none", baseSource: "fixed", fixedDaysCenti: 0, extraDaysCenti: 0, seniorityBonus: false, prorate: true, rounding: "none", probationRule: "accrue_and_use", carryOverCapCenti: null, carryOverExpiry: null, payoutOnTermination: false, allowNegativeCenti: 0, note: null }, ids.hr))).toBe("leave_policy_later_version");
    // Probation may use leave under Media's policy from October on.
    expect((await previewLeave(ids.linh, request({ startDate: "2026-10-05", endDate: "2026-10-05" }))).problems).toEqual([]);
  });
});

describe("the team calendar", () => {
  it("shows colleagues that someone is away, and only their manager and HR why", async () => {
    const range = { from: "2026-10-19", to: "2026-10-25" };
    const asColleague = await getTeamCalendar({ personId: ids.mai, principal: principal(ids.mai) }, range);
    const huyForMai = asColleague.people.find((row) => row.personId === ids.huy)!;
    expect(huyForMai.cells).toHaveLength(5);
    expect(huyForMai.cells.every((cell) => cell.typeName === null && cell.status === "approved")).toBe(true);
    // Nam's amended request is still pending: not a colleague's business yet.
    expect(asColleague.people.find((row) => row.personId === ids.nam)!.cells).toEqual([]);
    expect(asColleague.dates.find((day) => day.date === "2026-10-24")?.kind).toBe("untracked");

    const asHead = await getTeamCalendar({ personId: ids.head, principal: principal(ids.head, [{ role: "department_head", scope: { type: "department", id: ids.video } }]) }, range);
    expect(asHead.people.find((row) => row.personId === ids.huy)!.cells[0]).toMatchObject({ typeCode: "ANNUAL", status: "approved" });
    expect(asHead.people.find((row) => row.personId === ids.nam)!.cells.map((cell) => cell.status)).toEqual(["pending", "pending"]);
    // Another entity's people are not on a Media employee's calendar.
    expect(asColleague.people.some((row) => row.fullName === "Outsider")).toBe(false);
  });

  it("warns when a request would leave the department short", async () => {
    await saveStaffingRule({ entityId: ids.media, departmentId: ids.video, teamId: null, minPresent: 9 });
    const preview = await previewLeave(ids.lead, request({ startDate: "2026-10-20", endDate: "2026-10-22" }));
    expect(preview.problems).toEqual([]);
    // Huy's leave is approved; Nam's amended request is still pending — counted, but not named to a colleague.
    expect(preview.conflicts.colleaguesAway.map((row) => row.name)).toEqual(["Huy"]);
    // Eleven active people in Video at Media; Huy and Nam are away on the 20th and 21st, and the requester would be.
    expect(preview.conflicts.shortfalls).toEqual([
      { date: "2026-10-20", present: 8, minPresent: 9 },
      { date: "2026-10-21", present: 8, minPresent: 9 },
    ]);
  });
});
