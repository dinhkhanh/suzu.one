// The person's day against a real Postgres (PGlite): plan → activity → prefilled report → submit
// (on time and late), the team board against the policy, reminders, comments, weekly reports and
// the quick time log.
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
import { createWorkTask, listStates } from "@/modules/work/service";
import { migrateTestDb } from "../../../tests/helpers/db";
import { dayOf } from "./days";
import { DEFAULT_TEAM_RULES, instantOf } from "./engine/rules";
import { sendPlanReminders, sendReportReminders } from "./jobs";
import { listOverseen, loadReportReader, loadSubjects } from "./people";
import { addToPlan, getPlanPage, savePlan } from "./plans";
import { canViewReport } from "./policy";
import { buildDraft, commentOnReport, getReportView, getTeamBoard, remindMissing, submitReport } from "./reports";
import { getTimesheetView } from "./timesheets";
import { loadTimeReader } from "./people";
import { saveTeamRules } from "./team-rules";
import { deleteTimeEntry, logTime } from "./time";
import { getToday } from "./today";
import { generateWeek, listWeekly } from "./weekly";

// 2026-09-21 is a Monday.
const D = "2026-09-21";
const PEOPLE = ["long", "huy", "bao", "tam", "chi", "khoi", "mai", "sang", "lan", "vu"] as const;
type Key = (typeof PEOPLE)[number];
const ids = {} as Record<Key | "szm" | "video" | "design" | "social" | "dept" | "client" | "internal" | "t1" | "t2" | "t3" | "t4" | "t5" | "hr" | "t6", string>;
const names: Record<Key, string> = { long: "Long Dang", huy: "Huy Ho", bao: "Bao Tran", tam: "Tam Bui", chi: "Chi Vo", khoi: "Khoi Ly", mai: "Mai Pham", sang: "Sang Le", lan: "Lan Do", vu: "Vu Le" };
const fails = (promise: Promise<unknown>) => promise.then(() => "no error", (error: Error) => error.message);
const noticesOf = async (personId: string, kind: string) => db().select().from(schema.notification).where(and(eq(schema.notification.recipientPersonId, personId), eq(schema.notification.kind, kind)));
const at = (time: string) => new Date(`${D}T${time}:00+07:00`);

beforeAll(async () => {
  await migrateTestDb();
  const [szm] = await db().insert(schema.entity).values({ code: "SZM", legalName: "SuZu Media", shortName: "Media" }).returning();
  ids.szm = szm.id;
  const [dept] = await db().insert(schema.orgUnit).values({ name: "Marketing", kind: "department", entityId: szm.id }).returning();
  ids.dept = dept.id;
  for (const key of PEOPLE) {
    const [row] = await db().insert(schema.person).values({ fullName: names[key], searchName: names[key].toLowerCase(), workEmail: `${key}@suzu.group`, status: "active", primaryEntityId: szm.id }).returning();
    ids[key] = row.id;
  }
  // Huy reports to Tam, Tam to Chi, Chi to Vu: three levels above Huy. Chi heads Marketing, where Video sits.
  await db().update(schema.person).set({ managerId: ids.tam }).where(eq(schema.person.id, ids.huy));
  await db().update(schema.person).set({ managerId: ids.chi }).where(eq(schema.person.id, ids.tam));
  await db().update(schema.person).set({ managerId: ids.vu }).where(eq(schema.person.id, ids.chi));
  await db().insert(schema.roleAssignment).values({ personId: ids.chi, role: "department_head", scopeType: "unit", scopeId: dept.id, validFrom: "2026-01-01" });

  // Teams, their workflow and members as rows: the work module's own tests cover how they are made.
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
  // Video wants its reports by 18:00; Design and Social keep the company's rules (23:00).
  await saveTeamRules(ids.video, { ...DEFAULT_TEAM_RULES, reportDeadline: "18:00" });

  const project = async (name: string) => (await db().insert(schema.workProject).values({ teamId: ids.video, entityId: szm.id, name, leadPersonId: ids.long }).returning())[0].id;
  ids.client = await project("TVC Tết");
  ids.internal = await project("Showreel");
  await db().insert(schema.projectPlan).values([
    { projectId: ids.client, kind: "client" },
    { projectId: ids.internal, kind: "internal" },
  ]);

  const states = await listStates([ids.video]);
  const doing = states.find((state) => state.category === "in_progress")!;
  const task = async (title: string, assignee: Key, extra: { dueDate?: string; estimateMinutes?: number; projectId?: string; collaboratorIds?: string[] } = {}) => (await createWorkTask({ teamId: ids.video, projectId: extra.projectId ?? ids.client, title, assigneePersonId: ids[assignee], stateId: doing.id, ...extra }, ids.long)).task.id;
  ids.t1 = await task("Rough cut", "huy", { dueDate: D, estimateMinutes: 120 });
  ids.t2 = await task("Subtitles", "huy", { estimateMinutes: 60 });
  ids.t3 = await task("Color grade", "bao", { collaboratorIds: [ids.huy] });
  ids.t4 = await task("Old teaser", "huy", { dueDate: "2026-09-18" });
  ids.t5 = await task("Reel cut", "huy", { projectId: ids.internal });

  // Lan is on approved leave on D.
  const [type] = await db().insert(schema.leaveType).values({ code: "AL", name: "Annual", category: "annual", isPaid: true, payrollTreatment: "paid_company" }).returning();
  const [request] = await db().insert(schema.leaveRequest).values({ personId: ids.lan, entityId: szm.id, leaveTypeId: type.id, startDate: D, endDate: D, totalCenti: 100, status: "approved" }).returning();
  await db().insert(schema.leaveRequestDay).values({ requestId: request.id, personId: ids.lan, date: D, portion: "full", amountCenti: 100 });
  // 2 September is a public holiday.
  await db().insert(schema.calendarDay).values({ entityId: null, date: "2026-09-02", kind: "public_holiday", name: "Quốc khánh", isConfirmed: true });
});

describe("the day's rules", () => {
  it("merges the teams: Huy (Video + Design) plans and reports by 18:00; Lan is on leave", async () => {
    const days = await dayOf([ids.huy, ids.lan, ids.tam], D);
    expect(days.get(ids.huy)!.rules).toMatchObject({ planMode: "required", reportMode: "required", reportDeadline: "18:00" });
    expect(days.get(ids.huy)!.report).toEqual({ required: true, reason: null });
    expect(days.get(ids.huy)!.minutes).toBe(480);
    expect(days.get(ids.lan)!.report).toEqual({ required: false, reason: "leave" });
    expect(days.get(ids.lan)!.dayOff).toBe(true);
    // Tam is in no work team and follows the company's rules all the same (Q18).
    expect(days.get(ids.tam)!.rules).toMatchObject({ planMode: "required", reportMode: "required", reportDeadline: "23:00", timeMode: "required", timesheetApproval: true });
    expect(days.get(ids.tam)!.report).toEqual({ required: true, reason: null });
    expect(days.get(ids.tam)!.plan).toEqual({ required: true, reason: null });
  });
});

describe("plan → activity → prefilled report → submit", () => {
  it("the plan offers my work, overdue first, and saves only my own tasks", async () => {
    const page = await getPlanPage(ids.huy, D);
    expect(page.candidates[0].taskId).toBe(ids.t4);
    expect(page.candidates.map((task) => task.taskId).sort()).toEqual([ids.t1, ids.t2, ids.t3, ids.t4, ids.t5].sort());
    expect(page.selected).toEqual([]);
    expect(await fails(savePlan(ids.bao, D, [{ taskId: ids.t1, minutes: 60 }], null))).toBe("plan_task_not_yours");
    const { after } = await savePlan(ids.huy, D, [{ taskId: ids.t1, minutes: 120 }, { taskId: ids.t2, minutes: 60 }], "Ưu tiên bản dựng");
    expect(after.items.map((item) => item.taskId)).toEqual([ids.t1, ids.t2]);
    expect(after.submittedAt).not.toBeNull();
  });

  it("the plan reminder skips who planned and tells the rest once", async () => {
    // Everyone plans (Q18): the nine people at work today, less Huy, who has planned. Lan is on leave.
    expect((await sendPlanReminders(D)).reminded).toBe(8);
    expect(await noticesOf(ids.bao, "daily.plan_reminder")).toHaveLength(1);
    expect(await noticesOf(ids.mai, "daily.plan_reminder")).toHaveLength(1);
    // Tam is in no work team and is reminded like everyone else.
    expect(await noticesOf(ids.tam, "daily.plan_reminder")).toHaveLength(1);
    expect(await noticesOf(ids.lan, "daily.plan_reminder")).toHaveLength(0);
    expect(await noticesOf(ids.huy, "daily.plan_reminder")).toHaveLength(0);
    expect((await sendPlanReminders(D)).reminded).toBe(0);
    // A holiday asks nothing of anyone.
    expect((await sendPlanReminders("2026-09-02")).reminded).toBe(0);
  });

  it("the day's activity prefills the report", async () => {
    const done = (await listStates([ids.video])).find((state) => state.category === "done")!;
    // Huy moves the rough cut to done at 10:00 on D — as the work module records it.
    await db().update(schema.workTask).set({ stateId: done.id }).where(eq(schema.workTask.taskId, ids.t1));
    await db().update(schema.task).set({ status: "done", completedAt: at("10:00"), completedByPersonId: ids.huy }).where(eq(schema.task.id, ids.t1));
    await db().insert(schema.workActivity).values({ taskId: ids.t1, actorPersonId: ids.huy, type: "field_changed", field: "state", fromValue: { name: "Đang làm", category: "in_progress" }, toValue: { id: done.id, name: done.name, category: "done" }, createdAt: at("10:00") });
    await db().insert(schema.workComment).values([
      { taskId: ids.t2, authorPersonId: ids.huy, body: "Đang dịch phụ đề", createdAt: at("11:00") },
      { taskId: ids.t2, authorPersonId: ids.huy, body: "Còn 2 cảnh", createdAt: at("14:00") },
    ]);
    await db().insert(schema.workBlocker).values({ taskId: ids.t2, reason: "Chờ khách gửi kịch bản tiếng Anh", neededPersonId: ids.long, raisedByPersonId: ids.huy, raisedAt: at("15:00") });
    await logTime({ personId: ids.huy, date: D, taskId: ids.t1, category: null, minutes: 90, note: null, billable: null });

    const draft = await buildDraft(ids.huy, D);
    expect(draft.done.map((line) => line.taskId)).toEqual([ids.t1]);
    expect(draft.notDone.map((line) => line.taskId)).toEqual([ids.t2]);
    expect(draft.minutesLogged).toBe(90);
    expect(draft.activity.map((item) => [item.kind, item.taskId, item.detail])).toEqual(
      expect.arrayContaining([
        ["completed", ids.t1, done.name],
        ["commented", ids.t2, "2"],
        ["blocker_raised", ids.t2, "Chờ khách gửi kịch bản tiếng Anh"],
        ["time_logged", ids.t1, "90"],
      ]),
    );
  });

  it("submits on time before the deadline and late after it; a later edit keeps the record", async () => {
    const { after } = await submitReport(ids.huy, D, { blockers: "Chờ kịch bản tiếng Anh", notes: null, tomorrow: [ids.t2], secondsToSubmit: 42 }, at("17:30"));
    expect(after).toMatchObject({ status: "submitted", late: false, secondsToSubmit: 42, minutesLogged: 90 });
    expect(after.tomorrow).toEqual([{ taskId: ids.t2, minutes: 60 }]);
    const again = await submitReport(ids.huy, D, { blockers: "Chờ kịch bản", notes: "Đã hỏi khách", tomorrow: [ids.t2], secondsToSubmit: 5 }, at("20:00"));
    expect(again.after).toMatchObject({ late: false, secondsToSubmit: 42, notes: "Đã hỏi khách" });
    expect(again.after.submittedAt).toEqual(after.submittedAt);

    // Video's deadline is 18:00.
    const bao = await submitReport(ids.bao, D, { blockers: null, notes: null, tomorrow: [], secondsToSubmit: 30 }, at("18:45"));
    expect(bao.after.late).toBe(true);
    // Not somebody else's task for tomorrow, not a date in the future.
    expect(await fails(submitReport(ids.bao, D, { blockers: null, notes: null, tomorrow: [ids.t1], secondsToSubmit: null }, at("19:00")))).toBe("plan_task_not_yours");
    expect(await fails(submitReport(ids.bao, "2026-09-22", { blockers: null, notes: null, tomorrow: [], secondsToSubmit: null }, at("19:00")))).toBe("report_date_invalid");
  });

  it("the 23:00 deadline (Q18): 22:59 is on time, 23:30 is late and still that day's report", async () => {
    const at2 = (date: string, time: string) => new Date(`${date}T${time}:00+07:00`);
    // Social keeps the company's deadline of 23:00.
    const early = await submitReport(ids.khoi, "2026-09-17", { blockers: null, notes: null, tomorrow: [], secondsToSubmit: 20 }, at2("2026-09-17", "22:59"));
    expect(early.after).toMatchObject({ date: "2026-09-17", late: false });
    const late = await submitReport(ids.sang, "2026-09-18", { blockers: null, notes: null, tomorrow: [], secondsToSubmit: 20 }, at2("2026-09-18", "23:30"));
    // Half an hour past the deadline, and it is still the 18th's report — not the 19th's.
    expect(late.after).toMatchObject({ date: "2026-09-18", late: true });
  });

  it("tomorrow's plan starts from the report's 'tomorrow'", async () => {
    const next = await getPlanPage(ids.huy, "2026-09-22");
    expect(next.selected).toEqual([{ taskId: ids.t2, minutes: 60 }]);
    expect(next.carried).toBe(true);
    const plan = await addToPlan(ids.huy, "2026-09-22", ids.t4);
    expect(plan.items.map((item) => item.taskId)).toEqual([ids.t2, ids.t4]);
  });

  it("the report reminder tells who is missing, with their deadline, once", async () => {
    // Everyone reports (Q18): nine at work, less Huy and Bao, who have reported. Lan is on leave.
    expect((await sendReportReminders(D)).reminded).toBe(7);
    const [notice] = await noticesOf(ids.sang, "daily.report_reminder");
    // The company's deadline since Q18; Video asks for its own reports earlier.
    expect(notice.params).toEqual({ deadline: "23:00" });
    expect((await noticesOf(ids.tam, "daily.report_reminder"))[0].params).toEqual({ deadline: "23:00" });
    expect((await noticesOf(ids.long, "daily.report_reminder"))[0].params).toEqual({ deadline: "18:00" });
    expect(await noticesOf(ids.huy, "daily.report_reminder")).toHaveLength(0);
    expect((await sendReportReminders(D)).reminded).toBe(0);
    expect(await noticesOf(ids.lan, "daily.report_reminder")).toHaveLength(0);
  });
});

describe("the team daily board", () => {
  it("lists exactly the people the policy lets each reader see", async () => {
    const all = PEOPLE.map((key) => ids[key]);
    const subjects = await loadSubjects(all);
    for (const key of PEOPLE) {
      const reader = await loadReportReader(ids[key]);
      const listed = new Set((await listOverseen(reader)).flatMap((group) => group.personIds));
      const allowed = all.filter((personId) => personId !== ids[key] && canViewReport(reader, subjects.get(personId)!));
      expect([...listed].sort(), key).toEqual(allowed.sort());
    }
    // Spot checks: the line manager and the manager's manager, not a colleague or another team's lead.
    const seenBy = async (key: Key) => new Set((await listOverseen(await loadReportReader(ids[key]))).flatMap((group) => group.personIds));
    expect((await seenBy("tam")).has(ids.huy)).toBe(true);
    expect((await seenBy("chi")).has(ids.huy)).toBe(true);
    expect((await seenBy("bao")).has(ids.huy)).toBe(false);
    expect((await seenBy("khoi")).has(ids.huy)).toBe(false);
    expect((await seenBy("mai")).has(ids.huy)).toBe(true);
    // Three levels up is still above him.
    expect((await seenBy("vu")).has(ids.huy)).toBe(true);
  });

  it("shows submitted / missing / not required, blockers first", async () => {
    const [video] = await getTeamBoard(await loadReportReader(ids.long), D);
    expect(video).toMatchObject({ kind: "team", name: "Video", counts: { submitted: 2, missing: 0, not_required: 0 } });
    expect(video.rows.map((row) => [row.name, row.status, row.late, row.openBlockers])).toEqual([
      ["Huy Ho", "submitted", false, 1],
      ["Bao Tran", "submitted", true, 0],
    ]);
    const [social] = await getTeamBoard(await loadReportReader(ids.khoi), D);
    expect(social.rows.map((row) => [row.name, row.status, row.reason])).toEqual([
      ["Sang Le", "missing", null],
      ["Lan Do", "not_required", "leave"],
    ]);
    const holiday = await getTeamBoard(await loadReportReader(ids.khoi), "2026-09-02");
    expect(holiday[0].rows.every((row) => row.status === "not_required" && row.reason === "holiday")).toBe(true);
    // Line managers see their reports as a group of their own.
    const chain = await getTeamBoard(await loadReportReader(ids.chi), D);
    expect(chain).toHaveLength(1);
    expect(chain[0].kind).toBe("reports");
    expect(chain[0].rows.map((row) => row.name).sort()).toEqual(["Huy Ho", "Tam Bui"]);
  });

  it("reminds the missing once per day, and only people the reader oversees", async () => {
    const khoi = await loadReportReader(ids.khoi);
    expect(await remindMissing(khoi, [ids.sang, ids.lan], D, names.khoi)).toEqual([ids.sang]);
    expect(await remindMissing(khoi, [ids.sang], D, names.khoi)).toEqual([]);
    expect(await remindMissing(await loadReportReader(ids.long), [ids.sang], D, names.long)).toEqual([]);
    const notices = await noticesOf(ids.sang, "daily.report_nudge");
    expect(notices).toHaveLength(1);
    expect(notices[0].params).toEqual({ actor: names.khoi });
    const [social] = await getTeamBoard(khoi, D);
    expect(social.rows.find((row) => row.personId === ids.sang)!.reminded).toBe(true);
  });

  it("a comment tells the person; a colleague may neither read nor comment", async () => {
    const report = (await db().select().from(schema.dailyReport).where(and(eq(schema.dailyReport.personId, ids.huy), eq(schema.dailyReport.date, D))))[0];
    await commentOnReport(await loadReportReader(ids.long), report.id, { body: "Đã nhắn khách, mai có kịch bản", reaction: null }, names.long);
    const [notice] = await noticesOf(ids.huy, "daily.report_commented");
    expect(notice.params).toEqual({ actor: names.long, date: "21/09/2026" });
    expect(notice.link).toBe(`/daily/reports/${report.id}`);
    // Huy answers: Long hears it.
    await commentOnReport(await loadReportReader(ids.huy), report.id, { body: "Cảm ơn anh", reaction: null }, names.huy);
    expect(await noticesOf(ids.long, "daily.report_commented")).toHaveLength(1);
    expect(await fails(commentOnReport(await loadReportReader(ids.bao), report.id, { body: "?", reaction: null }, names.bao))).toBe("report_not_found");
    expect(await getReportView(await loadReportReader(ids.bao), report.id)).toBeNull();
    const view = await getReportView(await loadReportReader(ids.tam), report.id);
    expect(view!.comments.map((comment) => comment.body)).toEqual(["Đã nhắn khách, mai có kịch bản", "Cảm ơn anh"]);
    expect(view!.openBlockers).toHaveLength(1);
  });
});

describe("the whole management chain reads the day", () => {
  const reportOf = async (personId: string) => (await db().select().from(schema.dailyReport).where(and(eq(schema.dailyReport.personId, personId), eq(schema.dailyReport.date, D))))[0];

  it("the line manager, the skip-level manager and the one above them read the report, the week and the time; colleagues do not", async () => {
    const report = await reportOf(ids.huy);
    // Tam is Huy's manager, Chi is above Tam, Vu is above Chi.
    for (const key of ["tam", "chi", "vu"] as const) {
      const view = await getReportView(await loadReportReader(ids[key]), report.id);
      expect(view?.report.id, key).toBe(report.id);
      expect((await getTimesheetView(await loadTimeReader(ids[key]), ids.huy, D, D))?.personId, key).toBe(ids.huy);
    }
    // A colleague in his own team, another team's lead, and someone below him in no relation: nothing.
    for (const key of ["bao", "khoi", "sang"] as const) {
      expect(await getReportView(await loadReportReader(ids[key]), report.id), key).toBeNull();
      expect(await getTimesheetView(await loadTimeReader(ids[key]), ids.huy, D, D), key).toBeNull();
    }
    // And the chain reads Tam's day too, though Tam is in no work team at all.
    const tam = await reportOf(ids.tam);
    expect(tam).toBeUndefined();
    const subjects = await loadSubjects([ids.tam]);
    for (const key of ["chi", "vu"] as const) expect(canViewReport(await loadReportReader(ids[key]), subjects.get(ids.tam)!), key).toBe(true);
    for (const key of ["huy", "mai", "khoi"] as const) expect(canViewReport(await loadReportReader(ids[key]), subjects.get(ids.tam)!), key).toBe(false);
  });
});

describe("Today", () => {
  it("brings the day together: plan, due, blockers either way", async () => {
    const huy = await getToday(ids.huy, D);
    expect(huy.planned.map((task) => task.taskId)).toEqual([ids.t1, ids.t2]);
    expect(huy.planned[0].status).toBe("done");
    // Overdue and not planned.
    expect(huy.due.map((task) => task.taskId)).toEqual([ids.t4]);
    expect(huy.blockersRaised).toHaveLength(1);
    expect(huy.report?.status).toBe("submitted");
    expect(huy.time.map((entry) => entry.minutes)).toEqual([90]);
    const long = await getToday(ids.long, D);
    expect(long.blockersWaiting.map((blocker) => blocker.taskId)).toEqual([ids.t2]);
  });
});

describe("weekly reports", () => {
  it("generates each person's and team's week, tells the lead and the department head once", async () => {
    const first = await generateWeek(D, { notify: true });
    expect(first.teams).toBe(3);
    expect(first.notified).toBe(3);
    expect(await noticesOf(ids.long, "daily.weekly_report")).toHaveLength(1);
    // Chi heads Marketing, where Video sits.
    expect((await noticesOf(ids.chi, "daily.weekly_report")).map((row) => row.params)).toEqual([{ subject: "Video", week: "21/09/2026" }]);
    const again = await generateWeek(D, { notify: true });
    expect(again.notified).toBe(0);
    expect(await noticesOf(ids.long, "daily.weekly_report")).toHaveLength(1);

    const long = await loadReportReader(ids.long);
    const { teams, people } = await listWeekly(long, D, (team) => team.id === ids.video);
    expect(teams.map((row) => row.team.name)).toEqual(["Video"]);
    expect(teams[0].content).toMatchObject({ done: 1, slipped: 1, totalMinutes: 90 });
    expect(teams[0].content.people[0]).toMatchObject({ name: "Huy Ho", blockers: 1 });
    // Long sees his own week and his team's people — not Social's.
    expect(people.map((row) => row.name).sort()).toEqual(["Bao Tran", "Huy Ho", "Long Dang"]);
    const huy = people.find((row) => row.personId === ids.huy)!;
    expect(huy.content.hoursByProject).toEqual([{ projectId: ids.client, name: "TVC Tết", category: null, minutes: 90 }]);
    expect(huy.canSummarise).toBe(true);
  });
});

describe("quick time log", () => {
  it("defaults billable from the project kind and refuses a locked week", async () => {
    const client = await logTime({ personId: ids.huy, date: D, taskId: ids.t2, category: null, minutes: 30, note: null, billable: null });
    expect(client).toMatchObject({ projectId: ids.client, billable: true, weekStart: D });
    const internal = await logTime({ personId: ids.huy, date: D, taskId: ids.t5, category: null, minutes: 30, note: null, billable: null });
    expect(internal.billable).toBe(false);
    const admin = await logTime({ personId: ids.huy, date: D, taskId: null, category: "admin", minutes: 15, note: "Họp giao ban", billable: null });
    expect(admin).toMatchObject({ category: "admin", projectId: null, billable: false });
    const forced = await logTime({ personId: ids.huy, date: D, taskId: ids.t5, category: null, minutes: 10, note: null, billable: true });
    expect(forced.billable).toBe(true);
    expect(await fails(logTime({ personId: ids.huy, date: D, taskId: ids.t2, category: "admin", minutes: 10, note: null, billable: null }))).toBe("time_task_or_category");
    expect(await fails(deleteTimeEntry(ids.bao, admin.id, D))).toBe("time_entry_not_found");
    await deleteTimeEntry(ids.huy, admin.id, D);
    await db().insert(schema.timesheetWeek).values({ personId: ids.huy, weekStart: D, status: "approved" });
    expect(await fails(logTime({ personId: ids.huy, date: D, taskId: ids.t2, category: null, minutes: 10, note: null, billable: null }))).toBe("time_week_locked");
    expect(await fails(deleteTimeEntry(ids.huy, client.id, D))).toBe("time_week_locked");
    expect(instantOf(D, "18:00").toISOString()).toBe("2026-09-21T11:00:00.000Z");
  });
});

// ── Security review, findings 5, 14 and 23 ───────────────────────────────────────────────────
//
// Huy also works in Design, where a private project (HR's hiring) is none of Video's business. His
// line manager and his Video lead read his report, his week and his time — they must not learn what
// he is doing in there.
describe("private work in someone else's report", () => {
  beforeAll(async () => {
    // The week was approved by the quick-log test above; the approver reopens it.
    await db().update(schema.timesheetWeek).set({ status: "open" }).where(eq(schema.timesheetWeek.personId, ids.huy));
    ids.hr = (await db().insert(schema.workProject).values({ teamId: ids.design, entityId: ids.szm, name: "Tuyển Art Director", visibility: "private", leadPersonId: ids.mai }).returning())[0].id;
    await db().insert(schema.projectPlan).values({ projectId: ids.hr, kind: "internal" });
    // Its people: a private project's work goes to nobody outside it.
    await db().insert(schema.workProjectMember).values([{ projectId: ids.hr, personId: ids.mai, role: "lead" as const }, { projectId: ids.hr, personId: ids.huy, role: "member" as const }]);
    const doing = (await listStates([ids.design])).find((state) => state.category === "in_progress")!;
    ids.t6 = (await createWorkTask({ teamId: ids.design, projectId: ids.hr, title: "Sơ tuyển ứng viên", assigneePersonId: ids.huy, stateId: doing.id }, ids.mai)).task.id;
    await db().insert(schema.workBlocker).values({ taskId: ids.t6, reason: "Chờ mức lương duyệt", raisedByPersonId: ids.huy, raisedAt: at("16:00") });
    await logTime({ personId: ids.huy, date: D, taskId: ids.t6, category: null, minutes: 45, note: null, billable: null });
    await addToPlan(ids.huy, D, ids.t6);
    await submitReport(ids.huy, D, { blockers: "Chờ kịch bản", notes: null, tomorrow: [], secondsToSubmit: 10 }, at("20:30"));
  });

  const reportId = async () => (await db().select().from(schema.dailyReport).where(and(eq(schema.dailyReport.personId, ids.huy), eq(schema.dailyReport.date, D))))[0].id;

  it("the person reads their own day whole", async () => {
    const view = (await getReportView(await loadReportReader(ids.huy), await reportId()))!;
    const line = view.report.notDone.find((row) => row.taskId === ids.t6)!;
    expect(line.title).toBe("Sơ tuyển ứng viên");
    expect(line.hidden).toBeUndefined();
    expect(view.openBlockers.map((blocker) => blocker.reason)).toContain("Chờ mức lương duyệt");
  });

  it("a lead outside the project reads the hours, never the titles", async () => {
    const view = (await getReportView(await loadReportReader(ids.long), await reportId()))!;
    const hidden = view.report.notDone.find((line) => line.taskId === ids.t6)!;
    expect(hidden).toMatchObject({ hidden: true, title: "", ref: null });
    // The rest of his day is Video's work, and stays legible.
    expect(view.report.notDone.find((line) => line.taskId === ids.t2)).toMatchObject({ title: "Subtitles" });
    const logged = view.report.activity.find((item) => item.taskId === ids.t6 && item.kind === "time_logged")!;
    expect(logged).toMatchObject({ hidden: true, title: "", ref: null, detail: "45" });
    const blocker = view.openBlockers.find((row) => row.taskId === ids.t6)!;
    expect(blocker).toMatchObject({ hidden: true, title: "", reason: "" });
    expect(JSON.stringify(view)).not.toContain("Sơ tuyển ứng viên");
    expect(JSON.stringify(view)).not.toContain("Chờ mức lương duyệt");
    // The line manager, in neither team, reads the report and none of the work in it.
    const tam = (await getReportView(await loadReportReader(ids.tam), await reportId()))!;
    expect(JSON.stringify(tam)).not.toContain("Sơ tuyển ứng viên");
  });

  it("Design's lead, who runs the private project, reads it as it is", async () => {
    const view = (await getReportView(await loadReportReader(ids.mai), await reportId()))!;
    expect(view.report.notDone.find((line) => line.taskId === ids.t6)).toMatchObject({ title: "Sơ tuyển ứng viên" });
    expect(view.openBlockers.find((row) => row.taskId === ids.t6)!.reason).toBe("Chờ mức lương duyệt");
  });

  it("the week of time shows the hours under 'private work'", async () => {
    const own = (await getTimesheetView(await loadTimeReader(ids.huy), ids.huy, D, D))!;
    expect(own.labels[`task:${ids.t6}`]).toMatchObject({ title: "Sơ tuyển ứng viên" });
    const long = (await getTimesheetView(await loadTimeReader(ids.long), ids.huy, D, D))!;
    expect(long.grid.total).toBe(own.grid.total);
    expect(long.labels[`task:${ids.t6}`]).toMatchObject({ hidden: true, title: null, taskKey: null, projectName: null });
    expect(JSON.stringify(long)).not.toContain("Sơ tuyển ứng viên");
    expect(JSON.stringify(long)).not.toContain("Tuyển Art Director");
  });

  it("the weekly report keeps the hours and drops the names", async () => {
    await generateWeek(D, { notify: false });
    const mine = (await listWeekly(await loadReportReader(ids.huy), D, () => false)).people.find((row) => row.personId === ids.huy)!;
    expect(mine.content.hoursByProject.map((group) => group.name)).toContain("Tuyển Art Director");
    const { people } = await listWeekly(await loadReportReader(ids.long), D, () => false);
    const huy = people.find((row) => row.personId === ids.huy)!;
    expect(huy.content.slipped.find((line) => line.taskId === ids.t6)).toMatchObject({ hidden: true, title: "" });
    const hr = huy.content.hoursByProject.find((group) => group.projectId === ids.hr)!;
    expect(hr).toMatchObject({ hidden: true, name: null, minutes: 45 });
    expect(JSON.stringify(people)).not.toContain("Tuyển Art Director");
  });

  it("running a team is not reading its people's weeks (finding 14)", async () => {
    // Khoi leads Social only; `canRunTeam` stands for a `work:manage` grant over every team.
    const { teams } = await listWeekly(await loadReportReader(ids.khoi), D, () => true);
    const video = teams.find((row) => row.team.id === ids.video)!;
    expect(video.content.people).toEqual([]);
    expect(video.content.blockers).toEqual([]);
    // The totals of the team he runs stay whole.
    expect(video.content.totalMinutes).toBeGreaterThan(0);
    expect(video.content.done + video.content.slipped).toBeGreaterThan(0);
    const social = teams.find((row) => row.team.id === ids.social)!;
    expect(social.content.people.map((person) => person.name).sort()).toEqual(["Khoi Ly", "Lan Do", "Sang Le"]);
    // The team's hours name no project he may not open.
    expect(JSON.stringify(teams)).not.toContain("Tuyển Art Director");
  });

  it("a reply only tells earlier commenters who may still read the report (finding 23)", async () => {
    const id = await reportId();
    const before = (await noticesOf(ids.long, "daily.report_commented")).length;
    await commentOnReport(await loadReportReader(ids.long), id, { body: "Ổn nhé", reaction: null }, names.long);
    // Long leaves Video: he is no longer anyone's lead, and the thread is no longer his.
    await db().update(schema.workTeamMember).set({ role: "member" }).where(and(eq(schema.workTeamMember.teamId, ids.video), eq(schema.workTeamMember.personId, ids.long)));
    await commentOnReport(await loadReportReader(ids.huy), id, { body: "Vâng anh", reaction: null }, names.huy);
    expect(await noticesOf(ids.long, "daily.report_commented")).toHaveLength(before);
    // Mai still leads Design, so her earlier comment still gets answers.
    await commentOnReport(await loadReportReader(ids.mai), id, { body: "Nhớ gửi CV", reaction: null }, names.mai);
    const maiBefore = (await noticesOf(ids.mai, "daily.report_commented")).length;
    await commentOnReport(await loadReportReader(ids.huy), id, { body: "Vâng chị", reaction: null }, names.huy);
    expect(await noticesOf(ids.mai, "daily.report_commented")).toHaveLength(maiBefore + 1);
    await db().update(schema.workTeamMember).set({ role: "lead" }).where(and(eq(schema.workTeamMember.teamId, ids.video), eq(schema.workTeamMember.personId, ids.long)));
  });
});
