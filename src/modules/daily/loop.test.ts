// The daily loop's gaps, closed (Phase 12, R0), against a real Postgres (PGlite): whom the loop asks
// anything of; the approver every week has, and taking a submitted week back; a missed report —
// the days still open, filing one late, the lead's reminder for a past day, the next morning's
// notice; and the time a task's page shows.
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
import { loadGrants } from "@/modules/platform/rbac/service";
import { createWorkTask, listStates } from "@/modules/work/service";
import { migrateTestDb } from "../../../tests/helpers/db";
import { dayOf } from "./days";
import { sendMissedReportReminders, sendPlanReminders, sendReportReminders, sendTimesheetReminders } from "./jobs";
import { loadReportReader, loadTimeReader, loadTimesheetSubjects } from "./people";
import { canApproveTimesheet } from "./policy";
import { getTeamBoard, listMissingReportDays, remindMissing, submitReport } from "./reports";
import { getTaskTime } from "./task-time";
import { rulesOfPeople } from "./team-rules";
import { logTime, startTimer, stopRunningTimer } from "./time";
import { decideWeek, findTimesheetWeek, getTimesheetView, listApprovals, recallWeek, submitWeek } from "./timesheets";

// 2026-09-14 is a Monday: the week these tests submit. Today is Wednesday the 23rd; yesterday, the
// 22nd, is the day whose report is missing. The 17th is a public holiday.
const W = "2026-09-14";
const TODAY = "2026-09-23";
const YESTERDAY = "2026-09-22";
const PEOPLE = ["khanh", "vu", "chi", "nam", "tam", "dung", "old", "lan", "cong", "cuu"] as const;
type Key = (typeof PEOPLE)[number];
const ids = {} as Record<Key | "szm" | "dept" | "studio" | "project" | "t1" | "t2", string>;
const names: Record<Key, string> = { khanh: "Khanh Tran", vu: "Vu Le", chi: "Chi Vo", nam: "Nam Ngo", tam: "Tam Bui", dung: "Dung Ha", old: "Old Boss", lan: "Lan Do", cong: "Cong Ly", cuu: "Cuu Chu" };
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
const vn = (date: string, time: string) => new Date(`${date}T${time}:00+07:00`);
const blank = { blockers: null, notes: null, tomorrow: [], secondsToSubmit: 30 };

beforeAll(async () => {
  await migrateTestDb();
  const [szm] = await db().insert(schema.entity).values({ code: "SZM", legalName: "SuZu Media", shortName: "Media" }).returning();
  ids.szm = szm.id;
  const [dept] = await db().insert(schema.orgUnit).values({ name: "Marketing", kind: "department", entityId: szm.id }).returning();
  ids.dept = dept.id;
  // Khanh owns the company and sits in no unit. Everyone else sits in Marketing. Cong is a
  // collaborator; Old Boss has left.
  const extra: Partial<Record<Key, Partial<typeof schema.person.$inferInsert>>> = { khanh: { orgUnitId: null }, cong: { workforceType: "collaborator" }, old: { status: "offboarded" } };
  for (const key of PEOPLE) {
    const [row] = await db()
      .insert(schema.person)
      .values({ fullName: names[key], searchName: names[key].toLowerCase(), workEmail: `${key}@suzu.group`, status: "active", primaryEntityId: szm.id, orgUnitId: dept.id, ...extra[key] })
      .returning();
    ids[key] = row.id;
  }
  // Tam, Lan and Cong report to Vu; Dung to a manager who has left. Vu, Chi, Nam and Khanh report to nobody.
  for (const key of ["tam", "lan", "cong"] as const) await db().update(schema.person).set({ managerId: ids.vu }).where(eq(schema.person.id, ids[key]));
  await db().update(schema.person).set({ managerId: ids.old }).where(eq(schema.person.id, ids.dung));
  await db()
    .insert(schema.roleAssignment)
    .values([
      { personId: ids.khanh, role: "owner", scopeType: "group", validFrom: "2026-01-01" },
      // Chi heads Marketing: `work:manage` over everyone who sits there, herself included.
      { personId: ids.chi, role: "department_head", scopeType: "unit", scopeId: dept.id, validFrom: "2026-01-01" },
      // Cuu was an owner once; the grant ended last year.
      { personId: ids.cuu, role: "owner", scopeType: "group", validFrom: "2025-01-01", validTo: "2025-12-31" },
    ]);

  // Studio: Vu leads it — and so has no lead himself — with Nam as its member.
  const [studio] = await db().insert(schema.workTeam).values({ key: "STU", name: "Studio", entityId: szm.id, departmentId: dept.id }).returning();
  ids.studio = studio.id;
  await db()
    .insert(schema.workState)
    .values([
      { teamId: studio.id, name: "Đang làm", category: "in_progress", sortOrder: 1 },
      { teamId: studio.id, name: "Đã xong", category: "done", sortOrder: 2 },
    ]);
  await db()
    .insert(schema.workTeamMember)
    .values([
      { teamId: studio.id, personId: ids.vu, role: "lead" },
      { teamId: studio.id, personId: ids.nam, role: "member" },
    ]);
  // A client project of the Studio, led by Dung — who is in none of its people's teams or chains.
  ids.project = (await db().insert(schema.workProject).values({ teamId: studio.id, entityId: szm.id, name: "TVC Tết", leadPersonId: ids.dung }).returning())[0].id;
  await db().insert(schema.projectPlan).values({ projectId: ids.project, kind: "client" });
  const doing = (await listStates([studio.id])).find((state) => state.category === "in_progress")!;
  ids.t1 = (await createWorkTask({ teamId: studio.id, projectId: ids.project, title: "Rough cut", assigneePersonId: ids.nam, stateId: doing.id }, ids.vu)).task.id;
  ids.t2 = (await createWorkTask({ teamId: studio.id, projectId: ids.project, title: "Color grade", assigneePersonId: ids.nam, stateId: doing.id }, ids.vu)).task.id;

  // Lan is on approved leave yesterday; the 17th is a public holiday.
  const [type] = await db().insert(schema.leaveType).values({ code: "AL", name: "Annual", category: "annual", isPaid: true, payrollTreatment: "paid_company" }).returning();
  const [request] = await db().insert(schema.leaveRequest).values({ personId: ids.lan, entityId: szm.id, leaveTypeId: type.id, startDate: YESTERDAY, endDate: YESTERDAY, totalCenti: 100, status: "approved" }).returning();
  await db().insert(schema.leaveRequestDay).values({ requestId: request.id, personId: ids.lan, date: YESTERDAY, portion: "full", amountCenti: 100 });
  await db().insert(schema.calendarDay).values({ entityId: null, date: "2026-09-17", kind: "public_holiday", name: "Nghỉ lễ", isConfirmed: true });
});

// Decision of 2026-10-05 (amends D23): the plan, the report and time are asked of every active
// person except collaborators and holders of the owner role.
describe("whom the daily loop asks", () => {
  it("relaxes the rules of an owner and a collaborator — not of an employee, nor of an owner whose grant has ended", async () => {
    const rules = await rulesOfPeople([ids.khanh, ids.cong, ids.tam, ids.cuu]);
    for (const key of ["khanh", "cong"] as const) expect(rules.get(ids[key]), key).toMatchObject({ exempt: true, rules: { planMode: "optional", reportMode: "optional", timeMode: "optional", timesheetApproval: false } });
    for (const key of ["tam", "cuu"] as const) expect(rules.get(ids[key]), key).toMatchObject({ exempt: false, rules: { planMode: "required", reportMode: "required", timeMode: "required", timesheetApproval: true } });
    const days = await dayOf([ids.khanh, ids.cong, ids.tam], YESTERDAY);
    expect(days.get(ids.khanh)!.report).toEqual({ required: false, reason: "optional" });
    expect(days.get(ids.cong)!.plan).toEqual({ required: false, reason: "optional" });
    expect(days.get(ids.tam)!.report).toEqual({ required: true, reason: null });
  });

  it("never reminds them: the plan, the report, the timesheet — an employee hears all three", async () => {
    await sendPlanReminders(TODAY);
    await sendReportReminders(TODAY);
    // The 21st is a Monday: last week's timesheet.
    expect(await sendTimesheetReminders("2026-09-21")).toMatchObject({ weekStart: W });
    for (const kind of ["daily.plan_reminder", "daily.report_reminder", "daily.timesheet_reminder"]) {
      expect(await noticesOf(ids.khanh, kind), kind).toHaveLength(0);
      expect(await noticesOf(ids.cong, kind), kind).toHaveLength(0);
      expect(await noticesOf(ids.tam, kind), kind).toHaveLength(1);
      expect(await noticesOf(ids.cuu, kind), kind).toHaveLength(1);
    }
    // The evening reminder's link names its day: opened after midnight it is still that day's report.
    expect((await noticesOf(ids.tam, "daily.report_reminder"))[0].link).toBe(`/daily/report?date=${TODAY}`);
  });

  it("never counts them missing on the board; they may still report and log time, and have no week to send in", async () => {
    const board = await getTeamBoard(await loadReportReader(ids.vu), YESTERDAY);
    const reports = board.find((group) => group.kind === "reports")!;
    expect(reports.rows.map((row) => [row.name, row.status, row.reason]).sort()).toEqual([
      ["Cong Ly", "not_required", "optional"],
      ["Lan Do", "not_required", "leave"],
      ["Tam Bui", "missing", null],
    ]);
    expect(reports.counts).toEqual({ submitted: 0, missing: 1, not_required: 2 });
    const { after } = await submitReport(ids.cong, TODAY, blank, vn(TODAY, "17:00"));
    expect(after).toMatchObject({ status: "submitted", late: false });
    expect((await logTime({ personId: ids.cong, date: TODAY, taskId: null, category: "admin", minutes: 30, note: null, billable: null })).minutes).toBe(30);
    expect(await fails(submitWeek(ids.cong, W, TODAY))).toBe("timesheet_not_required");
    expect(await fails(submitWeek(ids.khanh, W, TODAY))).toBe("timesheet_not_required");
  });
});

// DLY-01: a person with no team lead and no line manager submitted a week nobody could approve.
describe("a week always has an approver", () => {
  it("lead → line manager → work:manage over the person → the owners; never the person", async () => {
    const subjects = await loadTimesheetSubjects(PEOPLE.map((key) => ids[key]));
    const fallback = (key: Key) => subjects.get(ids[key])!.fallbackApprovers;
    // Nam has a lead and Tam a line manager: nobody else is asked.
    expect(fallback("nam")).toEqual([]);
    expect(fallback("tam")).toEqual([]);
    expect(canApproveTimesheet(await loadReportReader(ids.vu), subjects.get(ids.nam)!)).toBe(true);
    expect(canApproveTimesheet(await loadReportReader(ids.vu), subjects.get(ids.tam)!)).toBe(true);
    // Vu leads his own team and reports to nobody: Marketing's head, who holds work:manage over him.
    expect(fallback("vu")).toEqual([ids.chi]);
    // Dung's line manager has left the company: the same.
    expect(fallback("dung")).toEqual([ids.chi]);
    // Chi holds work:manage over herself and nobody else does: not her — the owner.
    expect(fallback("chi")).toEqual([ids.khanh]);
    // The owner is the only one left for the owner, and nobody approves their own week.
    expect(fallback("khanh")).toEqual([]);
    for (const key of PEOPLE) expect(fallback(key), key).not.toContain(ids[key]);
  });

  it("the approver of last resort hears of the week, finds it in their list, reads it and decides it", async () => {
    await logTime({ personId: ids.vu, date: "2026-09-15", taskId: null, category: "admin", minutes: 240, note: null, billable: null });
    const { after } = await submitWeek(ids.vu, W, TODAY, vn(TODAY, "09:00"));
    expect(after).toMatchObject({ status: "submitted", minutes: 240 });
    expect((await noticesOf(ids.chi, "daily.timesheet_submitted")).map((row) => [row.params, row.link])).toEqual([[{ person: names.vu, week: "14/09/2026" }, `/daily/timesheets/${ids.vu}?week=${W}`]]);
    // Not the owner while somebody is placed over him, and not himself.
    expect(await noticesOf(ids.khanh, "daily.timesheet_submitted")).toHaveLength(0);
    expect(await noticesOf(ids.vu, "daily.timesheet_submitted")).toHaveLength(0);
    expect((await listApprovals(await loadReportReader(ids.chi), TODAY)).waiting.map((week) => [week.name, week.minutes])).toEqual([[names.vu, 240]]);
    // She reads the week she decides — without the attendance hint, which is the reporting line's.
    const view = (await getTimesheetView(await loadTimeReader(ids.chi), ids.vu, W, TODAY))!;
    expect(view).toMatchObject({ canApprove: true, partial: false, status: "submitted" });
    expect(view.grid.total).toBe(240);
    expect(view.days.every((day) => day.hint === null)).toBe(true);
    // Somebody with no part in it reads nothing; the owner and Vu himself decide nothing.
    expect(await getTimesheetView(await loadTimeReader(ids.tam), ids.vu, W, TODAY)).toBeNull();
    for (const key of ["khanh", "vu", "tam", "nam"] as const) expect(await fails(decideWeek(await loadReportReader(ids[key]), after.id, { type: "approve" })), key).toBe("timesheet_not_found");
    const decided = await decideWeek(await loadReportReader(ids.chi), after.id, { type: "approve" });
    expect(decided.after).toMatchObject({ status: "approved", decidedByPersonId: ids.chi });
  });

  it("goes to the owners where nobody is placed over the person, and to work:manage where the manager has left", async () => {
    const chi = (await submitWeek(ids.chi, W, TODAY)).after;
    const dung = (await submitWeek(ids.dung, W, TODAY)).after;
    expect((await noticesOf(ids.khanh, "daily.timesheet_submitted")).map((row) => row.params)).toEqual([{ person: names.chi, week: "14/09/2026" }]);
    expect((await noticesOf(ids.chi, "daily.timesheet_submitted")).map((row) => row.params)).toContainEqual({ person: names.dung, week: "14/09/2026" });
    // Somebody who has left is told nothing.
    expect(await noticesOf(ids.old, "daily.timesheet_submitted")).toHaveLength(0);

    // The approvers' lists are exactly the policy, for everyone.
    const submitted = await db().select().from(schema.timesheetWeek).where(eq(schema.timesheetWeek.status, "submitted"));
    expect(submitted.map((week) => week.id).sort()).toEqual([chi.id, dung.id].sort());
    const subjects = await loadTimesheetSubjects(PEOPLE.map((key) => ids[key]));
    for (const key of PEOPLE) {
      const reader = await loadReportReader(ids[key]);
      const { waiting } = await listApprovals(reader, TODAY);
      const allowed = submitted.filter((week) => canApproveTimesheet(reader, subjects.get(week.personId)!)).map((week) => week.id);
      expect(waiting.map((week) => week.id).sort(), key).toEqual(allowed.sort());
    }
    expect((await listApprovals(await loadReportReader(ids.khanh), TODAY)).waiting.map((week) => week.name)).toEqual([names.chi]);
    expect((await listApprovals(await loadReportReader(ids.chi), TODAY)).waiting.map((week) => week.name)).toEqual([names.dung]);

    // Chi does not approve her own week; the owner does. Chi approves Dung's.
    expect(await fails(decideWeek(await loadReportReader(ids.chi), chi.id, { type: "approve" }))).toBe("timesheet_not_found");
    expect((await decideWeek(await loadReportReader(ids.khanh), chi.id, { type: "approve" })).after).toMatchObject({ status: "approved", decidedByPersonId: ids.khanh });
    expect((await decideWeek(await loadReportReader(ids.chi), dung.id, { type: "approve" })).after.status).toBe("approved");
  });
});

describe("taking a submitted week back", () => {
  it("before anyone decides: the week is open again and the approver's notice no longer waits", async () => {
    await logTime({ personId: ids.nam, date: "2026-09-15", taskId: null, category: "admin", minutes: 120, note: null, billable: null });
    expect(await fails(recallWeek(ids.nam, W))).toBe("timesheet_not_found");
    await submitWeek(ids.nam, W, TODAY, vn(TODAY, "09:00"));
    const [waiting] = await noticesOf(ids.vu, "daily.timesheet_submitted");
    expect(waiting.readAt).toBeNull();
    expect((await listApprovals(await loadReportReader(ids.vu), TODAY)).waiting.map((week) => week.name)).toEqual([names.nam]);

    const { before, after } = await recallWeek(ids.nam, W, vn(TODAY, "09:30"));
    expect(before.status).toBe("submitted");
    expect(after).toMatchObject({ status: "open", submittedAt: null, decidedByPersonId: null });
    // The approver's list and their unread count are without it.
    expect((await listApprovals(await loadReportReader(ids.vu), TODAY)).waiting).toEqual([]);
    const [withdrawn] = await noticesOf(ids.vu, "daily.timesheet_submitted");
    expect(withdrawn.readAt).not.toBeNull();
    expect(withdrawn.digestedAt).not.toBeNull();
    // The person changes the week and sends it again; the approver hears of it anew.
    await logTime({ personId: ids.nam, date: "2026-09-16", taskId: null, category: "admin", minutes: 60, note: null, billable: null });
    expect((await submitWeek(ids.nam, W, TODAY)).after).toMatchObject({ status: "submitted", minutes: 180 });
    expect((await noticesOf(ids.vu, "daily.timesheet_submitted")).filter((row) => row.readAt === null)).toHaveLength(1);
  });

  it("is refused once an approver has decided: returned or approved", async () => {
    const week = (await findTimesheetWeek(ids.nam, W))!;
    const vu = await loadReportReader(ids.vu);
    await decideWeek(vu, week.id, { type: "return", comment: "Thiếu giờ thứ Năm" });
    expect(await fails(recallWeek(ids.nam, W))).toBe("timesheet_not_submitted");
    await submitWeek(ids.nam, W, TODAY);
    await decideWeek(vu, week.id, { type: "approve" });
    expect(await fails(recallWeek(ids.nam, W))).toBe("timesheet_not_submitted");
    expect((await findTimesheetWeek(ids.nam, W))!.status).toBe("approved");
    // Nobody recalls somebody else's week: the week is found by its person.
    expect(await fails(recallWeek(ids.tam, W))).toBe("timesheet_not_found");
  });
});

// DLY-02: the server took a report for the past seven days; no screen offered one, nobody could be
// reminded of one, and nothing said the next morning that yesterday's never came.
describe("a missed end-of-day report", () => {
  it("the days still open: required of the person, not submitted, inside the window — newest first", async () => {
    // The 19th and 20th are the weekend, the 17th a holiday; the 15th is eight days back.
    expect(await listMissingReportDays(ids.tam, TODAY)).toEqual(["2026-09-22", "2026-09-21", "2026-09-18", "2026-09-16"]);
    // Lan was on leave yesterday; nothing is asked of a collaborator or an owner at all.
    expect(await listMissingReportDays(ids.lan, TODAY)).toEqual(["2026-09-21", "2026-09-18", "2026-09-16"]);
    expect(await listMissingReportDays(ids.cong, TODAY)).toEqual([]);
    expect(await listMissingReportDays(ids.khanh, TODAY)).toEqual([]);
  });

  it("filed for a past day it is that day's report, marked late; outside the window it is refused", async () => {
    const { after } = await submitReport(ids.tam, "2026-09-21", blank, vn(TODAY, "10:00"));
    expect(after).toMatchObject({ date: "2026-09-21", status: "submitted", late: true });
    expect(await listMissingReportDays(ids.tam, TODAY)).toEqual(["2026-09-22", "2026-09-18", "2026-09-16"]);
    expect(await fails(submitReport(ids.tam, "2026-09-15", blank, vn(TODAY, "10:00")))).toBe("report_date_invalid");
    expect(await fails(submitReport(ids.tam, "2026-09-24", blank, vn(TODAY, "10:00")))).toBe("report_date_invalid");
  });

  it("the lead reminds for a past day: once, to whoever is missing, naming the day in the notice and its link", async () => {
    const vu = await loadReportReader(ids.vu);
    // Lan was on leave that day and Cong is asked nothing: only Tam is told.
    expect(await remindMissing(vu, [ids.tam, ids.lan, ids.cong], YESTERDAY, names.vu, TODAY)).toEqual([ids.tam]);
    expect(await remindMissing(vu, [ids.tam], YESTERDAY, names.vu, TODAY)).toEqual([]);
    expect((await noticesOf(ids.tam, "daily.report_nudge_past")).map((row) => [row.params, row.link])).toEqual([[{ actor: names.vu, date: "22/09/2026" }, `/daily/report?date=${YESTERDAY}`]]);
    // The board of that day shows him reminded; a day whose report was since filed tells nobody.
    const board = await getTeamBoard(vu, YESTERDAY);
    expect(board.find((group) => group.kind === "reports")!.rows.find((row) => row.personId === ids.tam)!.reminded).toBe(true);
    expect(await remindMissing(vu, [ids.tam], "2026-09-21", names.vu, TODAY)).toEqual([]);
    // Today's reminder is the one it always was, its link dated too; a day outside the window is refused.
    expect(await remindMissing(vu, [ids.tam], TODAY, names.vu, TODAY)).toEqual([ids.tam]);
    expect((await noticesOf(ids.tam, "daily.report_nudge")).map((row) => [row.params, row.link])).toEqual([[{ actor: names.vu }, `/daily/report?date=${TODAY}`]]);
    expect(await fails(remindMissing(vu, [ids.tam], "2026-09-15", names.vu, TODAY))).toBe("report_date_invalid");
    expect(await fails(remindMissing(vu, [ids.tam], "2026-09-24", names.vu, TODAY))).toBe("report_date_invalid");
    // Still only the people the reader oversees.
    expect(await remindMissing(await loadReportReader(ids.nam), [ids.tam], "2026-09-18", names.nam, TODAY)).toEqual([]);
  });

  it("the next morning: one notice for yesterday's missing report — never for leave, a holiday or a day off", async () => {
    // Nam filed yesterday's report (late, this morning): nothing to say to him.
    await submitReport(ids.nam, YESTERDAY, blank, vn(TODAY, "06:30"));
    // Active and asked: Vu, Chi, Tam, Dung, Cuu. Not Nam (filed), Lan (leave), Cong, Khanh (not asked), Old (left).
    expect(await sendMissedReportReminders(TODAY)).toEqual({ date: YESTERDAY, reminded: 5 });
    for (const key of ["vu", "chi", "tam", "dung", "cuu"] as const)
      expect(
        (await noticesOf(ids[key], "daily.report_missed")).map((row) => [row.params, row.link]),
        key,
      ).toEqual([[{ date: "22/09/2026" }, `/daily/report?date=${YESTERDAY}`]]);
    for (const key of ["nam", "lan", "cong", "khanh", "old"] as const) expect(await noticesOf(ids[key], "daily.report_missed"), key).toHaveLength(0);
    // Sent once, however often the job runs that morning.
    expect(await sendMissedReportReminders(TODAY)).toEqual({ date: YESTERDAY, reminded: 0 });
    expect(await noticesOf(ids.tam, "daily.report_missed")).toHaveLength(1);
    // The morning after a holiday, and Monday morning after a Sunday: nobody was scheduled to work.
    expect(await sendMissedReportReminders("2026-09-18")).toEqual({ date: "2026-09-17", reminded: 0 });
    expect(await sendMissedReportReminders("2026-09-21")).toEqual({ date: "2026-09-20", reminded: 0 });
  });
});

// WRK-01: time is logged from the task, and its page shows the hours the reader may see.
describe("time on a task", () => {
  const task = () => ({ taskId: ids.t1, projectId: ids.project });

  it("one's own always; everyone's only for a reader who may see every entry on it", async () => {
    const none = await getTaskTime(await loadTimeReader(ids.nam), task(), TODAY);
    expect(none).toMatchObject({ mine: { minutes: 0, billable: 0 }, total: { minutes: 0, billable: 0 }, running: false, billable: true, earliest: "2026-08-19" });
    // A client project: billed by default, as every other way of logging decides it.
    expect((await logTime({ personId: ids.nam, date: YESTERDAY, taskId: ids.t1, category: null, minutes: 60, note: "Dựng bản nháp", billable: null })).billable).toBe(true);
    await logTime({ personId: ids.vu, date: YESTERDAY, taskId: ids.t1, category: null, minutes: 30, note: null, billable: false });
    await logTime({ personId: ids.nam, date: YESTERDAY, taskId: ids.t2, category: null, minutes: 15, note: null, billable: null });

    // Nam sees his hour; his lead's half hour is not his to read, so no total.
    expect(await getTaskTime(await loadTimeReader(ids.nam), task(), TODAY)).toMatchObject({ mine: { minutes: 60, billable: 60 }, total: null });
    // Vu leads Nam's team, the project's lead reads every row on the project, the owner oversees.
    expect(await getTaskTime(await loadTimeReader(ids.vu), task(), TODAY)).toMatchObject({ mine: { minutes: 30, billable: 0 }, total: { minutes: 90, billable: 60 } });
    expect(await getTaskTime(await loadTimeReader(ids.dung), task(), TODAY)).toMatchObject({ mine: { minutes: 0, billable: 0 }, total: { minutes: 90, billable: 60 } });
    const owner = { personId: ids.khanh, workforceType: "employee" as const, grants: await loadGrants(ids.khanh) };
    expect((await getTaskTime(await loadTimeReader(ids.khanh, owner), task(), TODAY)).total).toEqual({ minutes: 90, billable: 60 });
    // A colleague who opens the task sees no hours but their own; without the grant the owner is one.
    expect(await getTaskTime(await loadTimeReader(ids.tam), task(), TODAY)).toMatchObject({ mine: { minutes: 0, billable: 0 }, total: null });
    expect((await getTaskTime(await loadTimeReader(ids.khanh), task(), TODAY)).total).toBeNull();
  });

  it("says whether the reader's timer runs on this task", async () => {
    await startTimer(ids.nam, { taskId: ids.t1, category: null }, vn(TODAY, "09:00"));
    expect((await getTaskTime(await loadTimeReader(ids.nam), task(), TODAY)).running).toBe(true);
    expect((await getTaskTime(await loadTimeReader(ids.nam), { taskId: ids.t2, projectId: ids.project }, TODAY)).running).toBe(false);
    expect((await getTaskTime(await loadTimeReader(ids.vu), task(), TODAY)).running).toBe(false);
    await stopRunningTimer(ids.nam, vn(TODAY, "09:45"));
    const after = await getTaskTime(await loadTimeReader(ids.nam), task(), TODAY);
    expect(after).toMatchObject({ running: false, mine: { minutes: 105 } });
  });
});
