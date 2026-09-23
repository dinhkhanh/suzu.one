// Time against a real Postgres (PGlite): the timer (start, replace, stop, across midnight, the
// cap), the week grid's cells, the weekly timesheet (submit → return → resubmit → approve → locked
// → reopen), the approver lists against the policy, the attendance hint, utilisation with leave and
// holidays, the Monday reminder and the totals other modules read.
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

import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { loadGrants } from "@/modules/platform/rbac/service";
import { createWorkTask, listStates } from "@/modules/work/service";
import { migrateTestDb } from "../../../tests/helpers/db";
import { DEFAULT_TEAM_RULES } from "./engine/rules";
import { sendTimesheetReminders } from "./jobs";
import { loadReportReader, loadSubjects, loadTimeReader } from "./people";
import { canApproveTimesheet } from "./policy";
import { saveTeamRules } from "./team-rules";
import { deleteTimeEntry, getRunningTimer, logTime, setCellMinutes, setRowBillable, startTimer, stopRunningTimer, updateTimeEntry } from "./time";
import { approveWeeks, decideWeek, findTimesheetWeek, getMyTimeWeek, getTimesheetView, listApprovals, listProjectTime, submitWeek } from "./timesheets";
import { loggedMinutesByPersonWeek, sumLoggedMinutesByProject, sumLoggedMinutesByTask } from "./totals";
import { getUtilisation } from "./utilisation";

// 2026-09-21 is a Monday; the week runs to Sunday 27. Today, in these tests, is Sunday the 27th.
const W = "2026-09-21";
const TODAY = "2026-09-27";
const PEOPLE = ["long", "huy", "bao", "tam", "chi", "khoi", "mai", "sang", "lan", "vy"] as const;
type Key = (typeof PEOPLE)[number];
const ids = {} as Record<Key | "szm" | "video" | "design" | "social" | "client" | "other" | "t1" | "t2" | "t3", string>;
const names: Record<Key, string> = { long: "Long Dang", huy: "Huy Ho", bao: "Bao Tran", tam: "Tam Bui", chi: "Chi Vo", khoi: "Khoi Ly", mai: "Mai Pham", sang: "Sang Le", lan: "Lan Do", vy: "Vy Nguyen" };
const fails = (promise: Promise<unknown>) => promise.then(() => "no error", (error: Error) => error.message);
const noticesOf = async (personId: string, kind: string) => db().select().from(schema.notification).where(and(eq(schema.notification.recipientPersonId, personId), eq(schema.notification.kind, kind)));
const vn = (date: string, time: string) => new Date(`${date}T${time}:00+07:00`);

beforeAll(async () => {
  await migrateTestDb();
  const [szm] = await db().insert(schema.entity).values({ code: "SZM", legalName: "SuZu Media", shortName: "Media" }).returning();
  ids.szm = szm.id;
  const [dept] = await db().insert(schema.orgUnit).values({ name: "Marketing", kind: "department", entityId: szm.id }).returning();
  for (const key of PEOPLE) {
    const [row] = await db().insert(schema.person).values({ fullName: names[key], searchName: names[key].toLowerCase(), workEmail: `${key}@suzu.group`, status: "active", primaryEntityId: szm.id }).returning();
    ids[key] = row.id;
  }
  // Huy reports to Tam, Tam to Chi. Chi heads Marketing, where Video sits.
  await db().update(schema.person).set({ managerId: ids.tam }).where(eq(schema.person.id, ids.huy));
  await db().update(schema.person).set({ managerId: ids.chi }).where(eq(schema.person.id, ids.tam));
  await db().insert(schema.roleAssignment).values({ personId: ids.chi, role: "department_head", scopeType: "unit", scopeId: dept.id, validFrom: "2026-01-01" });

  const team = async (key: string, name: string, lead: Key, members: Key[], departmentId: string | null = null) => {
    const [row] = await db().insert(schema.workTeam).values({ key, name, entityId: szm.id, departmentId }).returning();
    await db().insert(schema.workState).values([
      { teamId: row.id, name: "Đang làm", category: "in_progress", sortOrder: 1 },
      { teamId: row.id, name: "Đã xong", category: "done", sortOrder: 2 },
    ]);
    await db().insert(schema.workTeamMember).values([{ teamId: row.id, personId: ids[lead], role: "lead" }, ...members.map((member) => ({ teamId: row.id, personId: ids[member], role: "member" }))]);
    return row.id;
  };
  ids.video = await team("VID", "Video", "long", ["huy", "bao"], dept.id);
  ids.design = await team("DES", "Design", "mai", ["huy"]);
  ids.social = await team("SOC", "Social", "khoi", ["sang", "lan"]);
  // Video and Design keep the company's rules (time required, the week approved); Social is the one
  // team whose lead switched weekly approval off — its people log time and send nothing in.
  await saveTeamRules(ids.video, { ...DEFAULT_TEAM_RULES, timeMode: "required", timesheetApproval: true });
  await saveTeamRules(ids.social, { ...DEFAULT_TEAM_RULES, timesheetApproval: false });

  // TVC Tết is led by Vy (named lead), who is in none of Huy's teams and not above him.
  ids.client = (await db().insert(schema.workProject).values({ teamId: ids.video, entityId: szm.id, name: "TVC Tết", leadPersonId: ids.vy }).returning())[0].id;
  ids.other = (await db().insert(schema.workProject).values({ teamId: ids.video, entityId: szm.id, name: "Showreel", leadPersonId: ids.long }).returning())[0].id;
  await db().insert(schema.projectPlan).values([
    { projectId: ids.client, kind: "client" },
    { projectId: ids.other, kind: "internal" },
  ]);
  const doing = (await listStates([ids.video])).find((state) => state.category === "in_progress")!;
  const task = async (title: string, assignee: Key, projectId: string) => (await createWorkTask({ teamId: ids.video, projectId, title, assigneePersonId: ids[assignee], stateId: doing.id }, ids.long)).task.id;
  ids.t1 = await task("Rough cut", "huy", ids.client);
  ids.t2 = await task("Reel cut", "huy", ids.other);
  ids.t3 = await task("Color grade", "bao", ids.client);

  // Lan is on approved leave on Monday W; 2 September is a public holiday.
  const [type] = await db().insert(schema.leaveType).values({ code: "AL", name: "Annual", category: "annual", isPaid: true, payrollTreatment: "paid_company" }).returning();
  const [request] = await db().insert(schema.leaveRequest).values({ personId: ids.lan, entityId: szm.id, leaveTypeId: type.id, startDate: W, endDate: W, totalCenti: 100, status: "approved" }).returning();
  await db().insert(schema.leaveRequestDay).values({ requestId: request.id, personId: ids.lan, date: W, portion: "full", amountCenti: 100 });
  await db().insert(schema.calendarDay).values({ entityId: null, date: "2026-09-02", kind: "public_holiday", name: "Quốc khánh", isConfirmed: true });
});

describe("the timer", () => {
  it("starts, is replaced by the next one (which stops it), and stops", async () => {
    const first = await startTimer(ids.huy, { taskId: ids.t1, category: null }, vn(W, "09:00"));
    expect(first.stopped).toBeNull();
    expect(first.started).toMatchObject({ date: W, minutes: 0, source: "timer", projectId: ids.client, billable: true });
    expect((await getRunningTimer(ids.huy))!.taskId).toBe(ids.t1);

    // Starting another stops the first: 90 minutes of the rough cut.
    const second = await startTimer(ids.huy, { taskId: null, category: "admin" }, vn(W, "10:30"));
    expect(second.stopped).toMatchObject({ id: first.started.id, minutes: 90, timerStartedAt: null, capped: false });
    const running = await db().select().from(schema.timeEntry).where(and(eq(schema.timeEntry.personId, ids.huy), isNotNull(schema.timeEntry.timerStartedAt), isNull(schema.timeEntry.deletedAt)));
    expect(running.map((row) => row.id)).toEqual([second.started.id]);

    const stopped = await stopRunningTimer(ids.huy, vn(W, "10:45"));
    expect(stopped).toMatchObject({ category: "admin", minutes: 15, billable: false });
    expect(await getRunningTimer(ids.huy)).toBeNull();
    expect(await stopRunningTimer(ids.huy, vn(W, "11:00"))).toBeNull();
  });

  it("one running timer per person, held by the database", async () => {
    await db().insert(schema.timeEntry).values({ personId: ids.bao, date: W, weekStart: W, category: "admin", timerStartedAt: vn(W, "08:00"), source: "timer" });
    expect(await fails(db().insert(schema.timeEntry).values({ personId: ids.bao, date: W, weekStart: W, category: "idle", timerStartedAt: vn(W, "08:05"), source: "timer" }))).not.toBe("no error");
    // Under half a minute leaves nothing.
    const gone = await stopRunningTimer(ids.bao, new Date(vn(W, "08:00").getTime() + 20_000));
    expect(gone!.deletedAt).not.toBeNull();
  });

  it("across midnight the entry is the start day's; a forgotten timer is cut at 16 hours", async () => {
    await startTimer(ids.bao, { taskId: ids.t3, category: null }, vn("2026-09-22", "22:30"));
    const late = await stopRunningTimer(ids.bao, vn("2026-09-23", "00:45"));
    expect(late).toMatchObject({ date: "2026-09-22", minutes: 135, capped: false });
    await startTimer(ids.bao, { taskId: ids.t3, category: null }, vn("2026-09-23", "09:00"));
    const forgotten = await stopRunningTimer(ids.bao, vn("2026-09-24", "11:00"));
    expect(forgotten).toMatchObject({ date: "2026-09-23", minutes: 960, capped: true });
    // Correcting it clears the flag.
    const { after } = await updateTimeEntry(ids.bao, forgotten!.id, { minutes: 480, note: "Quên tắt đồng hồ", billable: true }, TODAY);
    expect(after).toMatchObject({ minutes: 480, capped: false, note: "Quên tắt đồng hồ" });
  });
});

describe("the week grid", () => {
  it("typing a total adds, raises and lowers the entries under the cell", async () => {
    const add = await setCellMinutes(ids.huy, "2026-09-22", { taskId: ids.t1, category: null }, 120);
    expect(add).toMatchObject({ before: 0, after: 120 });
    await logTime({ personId: ids.huy, date: "2026-09-22", taskId: ids.t1, category: null, minutes: 30, note: "Họp khách", billable: null });
    const lower = await setCellMinutes(ids.huy, "2026-09-22", { taskId: ids.t1, category: null }, 100);
    expect(lower).toMatchObject({ before: 150, after: 100 });
    await setCellMinutes(ids.huy, "2026-09-23", { taskId: ids.t2, category: null }, 240);
    await setCellMinutes(ids.huy, "2026-09-26", { taskId: null, category: "training" }, 60);

    const week = (await getMyTimeWeek(ids.huy, W, TODAY))!;
    expect(week.grid.rows.map((row) => [row.key, row.total])).toEqual([
      [`task:${ids.t1}`, 190],
      [`category:admin`, 15],
      [`task:${ids.t2}`, 240],
      [`category:training`, 60],
    ]);
    expect(week.grid.dayTotals).toEqual([105, 100, 240, 0, 0, 60, 0]);
    expect(week.grid.total).toBe(505);
    // The note of the 30-minute entry survives: the cut came off it (newest) — 30 → 0 removed, then 120 → 100.
    expect(week.entries.filter((entry) => entry.date === "2026-09-22").map((entry) => entry.minutes)).toEqual([100]);
    expect(week).toMatchObject({ approvalRequired: true, timeMode: "required", status: "open", editable: true });
    expect(week.labels[`task:${ids.t1}`]).toMatchObject({ title: "Rough cut", projectName: "TVC Tết" });
  });

  it("offers last week's rows to copy", async () => {
    const next = (await getMyTimeWeek(ids.huy, "2026-09-28", "2026-09-28"))!;
    expect(next.lastWeekRows).toEqual([`task:${ids.t1}`, "category:admin", `task:${ids.t2}`, "category:training"]);
    expect(next.grid.rows).toEqual([]);
  });
});

describe("the attendance hint", () => {
  it("shows attended minutes beside the day; untracked Saturdays say so", async () => {
    const day = { entityId: ids.szm, inputsHash: "x" };
    await db().insert(schema.timesheetDay).values([
      { ...day, personId: ids.huy, date: W, planKind: "working", status: "present", requiredMinutes: 480, workedMinutes: 450 },
      { ...day, personId: ids.huy, date: "2026-09-22", planKind: "working", status: "partial", requiredMinutes: 480, workedMinutes: 240, wfhMinutes: 120 },
      { ...day, personId: ids.huy, date: "2026-09-26", planKind: "untracked", status: "untracked", creditedMinutes: 480 },
    ]);
    const week = (await getMyTimeWeek(ids.huy, W, TODAY))!;
    expect(week.days.map((row) => row.hint)).toEqual([{ kind: "attended", minutes: 450 }, { kind: "attended", minutes: 360 }, { kind: "none" }, { kind: "none" }, { kind: "none" }, { kind: "untracked" }, { kind: "none" }]);
    // The line-management chain sees it: the manager and the manager's manager (security review, finding 4).
    const tam = (await getTimesheetView(await loadTimeReader(ids.tam), ids.huy, W, TODAY))!;
    expect(tam.days[0].hint).toEqual({ kind: "attended", minutes: 450 });
    const chi = (await getTimesheetView(await loadTimeReader(ids.chi), ids.huy, W, TODAY))!;
    expect(chi.grid.total).toBe(505);
    expect(chi.days[0].hint).toEqual({ kind: "attended", minutes: 450 });
    // The lead of Huy's team reads the week and approves it — attendance is still not his to read.
    const long = (await getTimesheetView(await loadTimeReader(ids.long), ids.huy, W, TODAY))!;
    expect(long.canApprove).toBe(true);
    expect(long.grid.total).toBe(505);
    expect(long.days.every((day) => day.hint === null)).toBe(true);
  });

  it("a project's lead sees only the rows on their project; a colleague sees nothing", async () => {
    const vy = await loadTimeReader(ids.vy);
    expect([...vy.ledProjectIds]).toEqual([ids.client]);
    const view = (await getTimesheetView(vy, ids.huy, W, TODAY))!;
    expect(view.partial).toBe(true);
    expect(view.grid.rows.map((row) => row.key)).toEqual([`task:${ids.t1}`]);
    // The project she leads is hers to read: those rows keep their names (the rest of the week is not here at all).
    expect(view.labels[`task:${ids.t1}`]).toMatchObject({ title: "Rough cut", projectName: "TVC Tết" });
    expect(view.days.every((day) => day.hint === null && day.kind === null)).toBe(true);
    expect(view.week).toBeNull();
    expect(await getTimesheetView(await loadTimeReader(ids.bao), ids.huy, W, TODAY)).toBeNull();
    expect(await getTimesheetView(await loadTimeReader(ids.khoi), ids.huy, W, TODAY)).toBeNull();
    const rows = await listProjectTime(vy, W);
    expect(rows.map((row) => [row.name, row.projectName, row.minutes])).toEqual([
      ["Bao Tran", "TVC Tết", 615],
      ["Huy Ho", "TVC Tết", 190],
    ]);
  });
});

describe("the weekly timesheet", () => {
  it("is submitted only where the rules ask for it, and not while a timer runs in it", async () => {
    await logTime({ personId: ids.sang, date: W, taskId: null, category: "admin", minutes: 60, note: null, billable: null });
    // Social switched approval off: Sang logs his time and has no week to send.
    expect(await fails(submitWeek(ids.sang, W, TODAY))).toBe("timesheet_not_required");
    expect(await fails(submitWeek(ids.huy, "2026-09-22", TODAY))).toBe("timesheet_week_invalid");
    expect(await fails(submitWeek(ids.huy, "2026-09-28", TODAY))).toBe("timesheet_week_invalid");
    await startTimer(ids.huy, { taskId: ids.t2, category: null }, vn("2026-09-27", "09:00"));
    expect(await fails(submitWeek(ids.huy, W, TODAY))).toBe("timesheet_timer_running");
    await stopRunningTimer(ids.huy, vn("2026-09-27", "09:00"));
  });

  it("submit → the approvers hear it; the week is locked for the person", async () => {
    const { after } = await submitWeek(ids.huy, W, TODAY, vn(TODAY, "20:00"));
    expect(after).toMatchObject({ status: "submitted", minutes: 505 });
    // The leads of both his teams and his line manager — not the manager's manager, not himself.
    for (const key of ["long", "mai", "tam"] as const) expect((await noticesOf(ids[key], "daily.timesheet_submitted")).map((row) => row.params), key).toEqual([{ person: names.huy, week: "21/09/2026" }]);
    expect(await noticesOf(ids.chi, "daily.timesheet_submitted")).toHaveLength(0);
    expect(await noticesOf(ids.huy, "daily.timesheet_submitted")).toHaveLength(0);
    expect(await fails(logTime({ personId: ids.huy, date: W, taskId: ids.t1, category: null, minutes: 10, note: null, billable: null }))).toBe("time_week_locked");
    expect(await fails(setCellMinutes(ids.huy, W, { taskId: ids.t1, category: null }, 10))).toBe("time_week_locked");
    expect(await fails(submitWeek(ids.huy, W, TODAY))).toBe("timesheet_not_open");
    expect((await getMyTimeWeek(ids.huy, W, TODAY))!.editable).toBe(false);
  });

  it("only an approver decides: not a colleague, the skip-level manager or the person", async () => {
    const week = (await findTimesheetWeek(ids.huy, W))!;
    for (const key of ["bao", "chi", "huy", "khoi", "vy"] as const) expect(await fails(decideWeek(await loadReportReader(ids[key]), week.id, { type: "approve" })), key).toBe("timesheet_not_found");
  });

  it("returned with a comment reopens it for the person, who resubmits", async () => {
    const week = (await findTimesheetWeek(ids.huy, W))!;
    const long = await loadReportReader(ids.long);
    expect(await fails(decideWeek(long, week.id, { type: "return", comment: " " }))).toBe("timesheet_comment_required");
    const { after } = await decideWeek(long, week.id, { type: "return", comment: "Thiếu giờ thứ Năm" });
    expect(after).toMatchObject({ status: "returned", comment: "Thiếu giờ thứ Năm", decidedByPersonId: ids.long });
    expect((await noticesOf(ids.huy, "daily.timesheet_decided")).map((row) => row.params)).toEqual([{ week: "21/09/2026" }]);
    await setCellMinutes(ids.huy, "2026-09-24", { taskId: ids.t1, category: null }, 60);
    const again = await submitWeek(ids.huy, W, TODAY);
    expect(again.after).toMatchObject({ status: "submitted", minutes: 565, decidedByPersonId: null });
  });

  it("approved = locked: no edit, no delete, no change of an entry", async () => {
    const week = (await findTimesheetWeek(ids.huy, W))!;
    const { after } = await decideWeek(await loadReportReader(ids.tam), week.id, { type: "approve" });
    expect(after).toMatchObject({ status: "approved", decidedByPersonId: ids.tam });
    const [entry] = (await getMyTimeWeek(ids.huy, W, TODAY))!.entries;
    expect(await fails(updateTimeEntry(ids.huy, entry.id, { minutes: 5, note: null, billable: false }, TODAY))).toBe("time_week_locked");
    expect(await fails(deleteTimeEntry(ids.huy, entry.id, TODAY))).toBe("time_week_locked");
    expect(await fails(setCellMinutes(ids.huy, "2026-09-25", { taskId: null, category: "admin" }, 30))).toBe("time_week_locked");
    expect(await fails(decideWeek(await loadReportReader(ids.long), week.id, { type: "approve" }))).toBe("timesheet_not_submitted");
    // A timer cannot be started on a locked day either.
    expect(await fails(startTimer(ids.huy, { taskId: ids.t1, category: null }, vn(W, "15:00")))).toBe("time_week_locked");
  });

  it("reopening needs an approver and a reason; the week opens again", async () => {
    const week = (await findTimesheetWeek(ids.huy, W))!;
    expect(await fails(decideWeek(await loadReportReader(ids.huy), week.id, { type: "reopen", reason: "Tự sửa" }))).toBe("timesheet_not_found");
    expect(await fails(decideWeek(await loadReportReader(ids.long), week.id, { type: "reopen", reason: "" }))).toBe("timesheet_comment_required");
    const { after } = await decideWeek(await loadReportReader(ids.long), week.id, { type: "reopen", reason: "Ghi nhầm dự án" });
    expect(after).toMatchObject({ status: "open", comment: "Ghi nhầm dự án", decidedByPersonId: ids.long });
    await setCellMinutes(ids.huy, "2026-09-25", { taskId: ids.t2, category: null }, 30);
    expect((await getMyTimeWeek(ids.huy, W, TODAY))!.grid.total).toBe(595);
  });

  it("the approvers' lists are exactly the policy", async () => {
    // Two weeks waiting: Huy's again, and Bao's.
    await submitWeek(ids.huy, W, TODAY);
    await submitWeek(ids.bao, W, TODAY);
    const submitted = await db().select().from(schema.timesheetWeek).where(eq(schema.timesheetWeek.status, "submitted"));
    const subjects = await loadSubjects(PEOPLE.map((key) => ids[key]));
    for (const key of PEOPLE) {
      const reader = await loadReportReader(ids[key]);
      const { waiting } = await listApprovals(reader, TODAY);
      const allowed = submitted.filter((week) => canApproveTimesheet(reader, subjects.get(week.personId)!)).map((week) => week.id);
      expect(waiting.map((week) => week.id).sort(), key).toEqual(allowed.sort());
    }
    const long = await listApprovals(await loadReportReader(ids.long), TODAY);
    expect(long.waiting.map((week) => [week.name, week.minutes])).toEqual([
      ["Bao Tran", 615],
      ["Huy Ho", 595],
    ]);
    expect((await listApprovals(await loadReportReader(ids.mai), TODAY)).waiting.map((week) => week.name)).toEqual(["Huy Ho"]);
    expect((await listApprovals(await loadReportReader(ids.chi), TODAY)).waiting).toEqual([]);
  });
});

describe("the Monday reminder", () => {
  it("tells everyone who owes last week's timesheet, once", async () => {
    expect(await sendTimesheetReminders("2026-09-29")).toEqual({ skipped: "not_monday" });
    // Everyone but Social submits a week (Q17). Huy and Bao have; Long, Mai, Tam, Chi and Vy have not.
    expect(await sendTimesheetReminders("2026-09-28")).toEqual({ weekStart: W, reminded: 5 });
    expect((await noticesOf(ids.long, "daily.timesheet_reminder")).map((row) => [row.params, row.link])).toEqual([[{ week: "21/09/2026" }, `/daily/time?week=${W}`]]);
    expect(await noticesOf(ids.mai, "daily.timesheet_reminder")).toHaveLength(1);
    // Tam is in no work team; his line manager approves his week, and the reminder reaches him.
    expect(await noticesOf(ids.tam, "daily.timesheet_reminder")).toHaveLength(1);
    expect(await noticesOf(ids.huy, "daily.timesheet_reminder")).toHaveLength(0);
    // Social's lead switched approval off: nobody there is asked for a week.
    expect(await noticesOf(ids.sang, "daily.timesheet_reminder")).toHaveLength(0);
    expect(await sendTimesheetReminders("2026-09-28")).toEqual({ weekStart: W, reminded: 0 });
  });
});

// Q17, Q18: every person submits a week, so every person needs an approver. Tam is in no work team,
// and the only one who may decide his week is the manager directly above him.
describe("a week whose only approver is the line manager", () => {
  it("is submitted, heard by the manager, and approved by them — by nobody else", async () => {
    await logTime({ personId: ids.tam, date: W, taskId: null, category: "admin", minutes: 120, note: null, billable: null });
    const { after } = await submitWeek(ids.tam, W, TODAY, vn(TODAY, "21:00"));
    expect(after).toMatchObject({ status: "submitted", minutes: 120 });
    expect((await noticesOf(ids.chi, "daily.timesheet_submitted")).map((row) => row.params)).toEqual([{ person: names.tam, week: "21/09/2026" }]);
    // Chi's own list, and only Chi's: not the person, not a lead of some other team.
    expect((await listApprovals(await loadReportReader(ids.chi), TODAY)).waiting.map((week) => week.name)).toEqual([names.tam]);
    for (const key of ["tam", "long", "mai", "huy"] as const) expect(await fails(decideWeek(await loadReportReader(ids[key]), after.id, { type: "approve" })), key).toBe("timesheet_not_found");
    // Approved in a batch, as the approver's list does it.
    const result = await approveWeeks(await loadReportReader(ids.chi), [after.id]);
    expect(result.failed).toEqual([]);
    expect(result.approved.map((week) => [week.personId, week.status])).toEqual([[ids.tam, "approved"]]);
    expect((await noticesOf(ids.tam, "daily.timesheet_decided")).map((row) => row.params)).toEqual([{ week: "21/09/2026" }]);
  });
});

describe("utilisation", () => {
  it("a lead sees their team's people: leave and holidays shrink the hours available", async () => {
    await logTime({ personId: ids.lan, date: "2026-09-22", taskId: null, category: "internal", minutes: 960, note: null, billable: null });
    await logTime({ personId: ids.sang, date: "2026-09-01", taskId: null, category: "internal", minutes: 960, note: null, billable: null });
    const khoi = await getUtilisation({ personId: ids.khoi, principal: { personId: ids.khoi, workforceType: "employee", grants: await loadGrants(ids.khoi) } }, TODAY);
    expect(khoi.weeks).toHaveLength(8);
    expect(khoi.weeks.at(-1)).toBe(W);
    const [social] = khoi.groups;
    expect(social).toMatchObject({ kind: "team", name: "Social" });
    if (social.kind !== "team") throw new Error("team");
    const lan = social.people.find((row) => row.personId === ids.lan)!;
    // Four weekdays (Monday on leave), nobody scheduled: 32 h; 16 h logged.
    expect(lan.weeks.at(-1)).toMatchObject({ available: 1920, logged: 960, ratio: 0.5 });
    const sang = social.people.find((row) => row.personId === ids.sang)!;
    // The week of 2 September: the holiday leaves four days.
    const holidayWeek = khoi.weeks.indexOf("2026-08-31");
    expect(sang.weeks[holidayWeek]).toMatchObject({ available: 1920, logged: 960, ratio: 0.5 });
    expect(sang.weeks.at(-1)).toMatchObject({ available: 2400, logged: 60 });
    expect(social.total.at(-1)).toMatchObject({ available: 4320, logged: 1020 });
  });

  it("a department head sees their reports, and a team they do not lead only as a total", async () => {
    const chi = await getUtilisation({ personId: ids.chi, principal: { personId: ids.chi, workforceType: "employee", grants: await loadGrants(ids.chi) } }, TODAY);
    expect(chi.groups.map((group) => group.kind)).toEqual(["reports", "portfolio"]);
    const [reports, video] = chi.groups;
    if (reports.kind !== "reports" || video.kind !== "portfolio") throw new Error("groups");
    expect(reports.people.map((row) => row.name)).toEqual(["Huy Ho", "Tam Bui"]);
    expect(video).toMatchObject({ name: "Video", headcount: 3 });
    expect("people" in video).toBe(false);
    // Nobody else's people: Bao and Long are not Chi's to see one by one.
    expect(JSON.stringify(chi)).not.toContain(ids.bao);
    // A colleague sees nothing.
    const bao = await getUtilisation({ personId: ids.bao, principal: { personId: ids.bao, workforceType: "employee", grants: [] } }, TODAY);
    expect(bao.groups).toEqual([]);
  });
});

describe("totals for other modules", () => {
  it("sums by project, task and person-week", async () => {
    const projects = await sumLoggedMinutesByProject([ids.client, ids.other]);
    expect(projects.get(ids.client)).toEqual({ minutes: 250 + 615, billable: 250 + 615 });
    expect(projects.get(ids.other)).toEqual({ minutes: 240 + 30, billable: 0 });
    expect((await sumLoggedMinutesByProject([ids.client], { from: "2026-09-23", to: "2026-09-23" })).get(ids.client)).toEqual({ minutes: 480, billable: 480 });
    expect((await sumLoggedMinutesByTask([ids.t1])).get(ids.t1)!.minutes).toBe(250);
    const weeks = await loggedMinutesByPersonWeek([ids.huy, ids.lan], [W, "2026-09-14"]);
    expect(weeks.get(ids.huy)!.get(W)).toEqual({ minutes: 595, billable: 250 });
    expect(weeks.get(ids.lan)!.get(W)).toEqual({ minutes: 960, billable: 0 });
    expect(weeks.get(ids.huy)!.has("2026-09-14")).toBe(false);
  });
});

// ── Security review, findings 15, 16, 17 and 22 ──────────────────────────────────────────────

describe("the window on old time", () => {
  it("an entry older than 35 days cannot be corrected or deleted through its id", async () => {
    const old = await logTime({ personId: ids.sang, date: "2026-07-01", taskId: null, category: "internal", minutes: 60, note: null, billable: null });
    expect(await fails(updateTimeEntry(ids.sang, old.id, { minutes: 480, note: null, billable: false }, TODAY))).toBe("time_window_closed");
    expect(await fails(deleteTimeEntry(ids.sang, old.id, TODAY))).toBe("time_window_closed");
    // A week the approver returned stays open to fix, however old it is.
    await db().insert(schema.timesheetWeek).values({ personId: ids.sang, weekStart: "2026-06-29", status: "returned" });
    const { after } = await updateTimeEntry(ids.sang, old.id, { minutes: 90, note: "Sửa theo yêu cầu", billable: false }, TODAY);
    expect(after.minutes).toBe(90);
    await deleteTimeEntry(ids.sang, old.id, TODAY);
    // A recent entry is the person's to correct as before.
    const recent = await logTime({ personId: ids.sang, date: "2026-09-24", taskId: null, category: "admin", minutes: 30, note: null, billable: null });
    expect((await updateTimeEntry(ids.sang, recent.id, { minutes: 45, note: null, billable: false }, TODAY)).after.minutes).toBe(45);
  });
});

describe("a timer running into a week that was locked meanwhile", () => {
  it("is stopped with nothing kept, and says so", async () => {
    await startTimer(ids.vy, { taskId: ids.t1, category: null }, vn(W, "09:00"));
    // The approver decides the week while the timer runs (the person forgot to stop it).
    await db().insert(schema.timesheetWeek).values({ personId: ids.vy, weekStart: W, status: "approved", minutes: 0 });
    const stopped = (await stopRunningTimer(ids.vy, vn(W, "11:00")))!;
    expect(stopped).toMatchObject({ weekLocked: true, minutes: 0, timerStartedAt: null });
    expect(stopped.deletedAt).not.toBeNull();
    expect(await getRunningTimer(ids.vy)).toBeNull();
    // Nothing was written into the approved week.
    const week = (await getMyTimeWeek(ids.vy, W, TODAY))!;
    expect(week.grid.total).toBe(0);
    expect(week.entries).toEqual([]);
  });
});

describe("approving several weeks at once", () => {
  it("approves what it can and never throws half-way (finding 17)", async () => {
    const long = await loadReportReader(ids.long);
    const huy = (await findTimesheetWeek(ids.huy, W))!;
    const bao = (await findTimesheetWeek(ids.bao, W))!;
    // Huy's week is decided by his other lead a moment before the batch runs.
    await decideWeek(await loadReportReader(ids.mai), huy.id, { type: "approve" });
    const result = await approveWeeks(long, [huy.id, bao.id, "00000000-0000-4000-8000-000000000000"]);
    expect(result.approved.map((week) => week.personId)).toEqual([ids.bao]);
    expect(result.failed).toEqual([
      { id: huy.id, error: "timesheet_not_submitted" },
      { id: "00000000-0000-4000-8000-000000000000", error: "timesheet_not_found" },
    ]);
    expect((await findTimesheetWeek(ids.bao, W))!.status).toBe("approved");
  });
});

describe("utilisation of teams that are one person (finding 22)", () => {
  it("leaves them out rather than reporting one person as a team", async () => {
    const [dept] = await db().select().from(schema.orgUnit).limit(1);
    const [copy] = await db().insert(schema.workTeam).values({ key: "CPY", name: "Copywriting", entityId: ids.szm, departmentId: dept.id }).returning();
    await db().insert(schema.workTeamMember).values({ teamId: copy.id, personId: ids.vy, role: "lead" });
    const principal = async () => ({ personId: ids.chi, principal: { personId: ids.chi, workforceType: "employee" as const, grants: await loadGrants(ids.chi) } });
    const one = await getUtilisation(await principal(), TODAY);
    expect(one.groups.map((group) => group.kind)).toEqual(["reports", "portfolio"]);
    expect(JSON.stringify(one)).not.toContain(ids.vy);
    expect(JSON.stringify(one)).not.toContain("Copywriting");

    // A second one-person team: together they are a group, shown as "other teams" with no names.
    const [studio] = await db().insert(schema.workTeam).values({ key: "STU", name: "Studio", entityId: ids.szm, departmentId: dept.id }).returning();
    await db().insert(schema.workTeamMember).values({ teamId: studio.id, personId: ids.mai, role: "lead" });
    const two = await getUtilisation(await principal(), TODAY);
    const other = two.groups.find((group) => group.kind === "portfolio_other")!;
    expect(other).toMatchObject({ kind: "portfolio_other", teams: 2, headcount: 2 });
    expect(JSON.stringify(two)).not.toContain("Copywriting");
    expect(JSON.stringify(two)).not.toContain(ids.mai);
    // Video, big enough to stand on its own, is still its own row.
    expect(two.groups.filter((group) => group.kind === "portfolio").map((group) => group.kind === "portfolio" && group.name)).toEqual(["Video"]);
  });
});

// Q17: whether the hours are billed to the client is part of everyday logging, so the week grid
// switches a whole row at once — the flag belongs to the work, not to the single log.
describe("billing a row of the week grid", () => {
  const adminRow = async (personId: string) => (await getMyTimeWeek(personId, W, TODAY))!.grid.rows.find((row) => row.key === "category:admin")!;

  it("bills every entry under the row and stops again; a locked or long-closed week refuses", async () => {
    const before = await adminRow(ids.sang);
    expect(before.billable).toBe(0);
    const { changed } = await setRowBillable(ids.sang, W, { taskId: null, category: "admin" }, true, TODAY);
    expect(changed).toBeGreaterThan(0);
    expect(await adminRow(ids.sang)).toMatchObject({ total: before.total, billable: before.total });
    await setRowBillable(ids.sang, W, { taskId: null, category: "admin" }, false, TODAY);
    expect(await adminRow(ids.sang)).toMatchObject({ total: before.total, billable: 0 });

    // Not a Monday, not the future, not a week long closed, and never an approved week.
    expect(await fails(setRowBillable(ids.sang, "2026-09-22", { taskId: null, category: "admin" }, true, TODAY))).toBe("timesheet_week_invalid");
    expect(await fails(setRowBillable(ids.sang, "2026-07-06", { taskId: null, category: "admin" }, true, TODAY))).toBe("time_window_closed");
    expect(await fails(setRowBillable(ids.huy, W, { taskId: ids.t1, category: null }, false, TODAY))).toBe("time_week_locked");
  });
});
