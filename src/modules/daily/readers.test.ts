// What a person writes is read by the people D23 names (Phase 12, R2; DLY-03), against a real
// Postgres (PGlite): the morning plan on the lead's board — filed or not, late or not, its tasks as
// the reader may see them; the weekly report of everyone the loop asks, with the line manager told
// where no lead is; the notice a report with blockers sends; and the earlier words of a report
// that was sent again.
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
import { firstReadersOf, loadReportReader } from "./people";
import { savePlan } from "./plans";
import type { ReportReader } from "./policy";
import { getReportView, getTeamBoard, submitReport } from "./reports";
import { generateWeek, listWeekly } from "./weekly";

// 2026-09-14 is a Monday: the week these tests summarise. The plans and reports are Wednesday's.
const W = "2026-09-14";
const DAY = "2026-09-16";
const NEXT = "2026-09-17";
const PEOPLE = ["khanh", "chi", "vu", "nam", "cong", "tam", "lan", "dung", "old"] as const;
type Key = (typeof PEOPLE)[number];
const ids = {} as Record<Key | "szm" | "dept" | "studio" | "lab" | "open" | "secret" | "t1" | "t2" | "t3" | "t4", string>;
const names: Record<Key, string> = { khanh: "Khanh Tran", chi: "Chi Vo", vu: "Vu Le", nam: "Nam Ngo", cong: "Cong Ly", tam: "Tam Bui", lan: "Lan Do", dung: "Dung Ha", old: "Old Boss" };
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
  // Khanh owns the company; Cong is a collaborator; Old Boss has left. The loop asks nothing of the first two.
  const extra: Partial<Record<Key, Partial<typeof schema.person.$inferInsert>>> = { khanh: { orgUnitId: null }, cong: { workforceType: "collaborator" }, old: { status: "offboarded" } };
  for (const key of PEOPLE) {
    const [row] = await db()
      .insert(schema.person)
      .values({ fullName: names[key], searchName: names[key].toLowerCase(), workEmail: `${key}@suzu.group`, status: "active", primaryEntityId: szm.id, orgUnitId: dept.id, ...extra[key] })
      .returning();
    ids[key] = row.id;
  }
  // Vu reports to Chi; Tam to Lan; Lan to a manager who has left. Chi, Dung and Khanh report to nobody.
  await db().update(schema.person).set({ managerId: ids.chi }).where(eq(schema.person.id, ids.vu));
  await db().update(schema.person).set({ managerId: ids.lan }).where(eq(schema.person.id, ids.tam));
  await db().update(schema.person).set({ managerId: ids.old }).where(eq(schema.person.id, ids.lan));
  await db()
    .insert(schema.roleAssignment)
    .values([
      { personId: ids.khanh, role: "owner", scopeType: "group", validFrom: "2026-01-01" },
      { personId: ids.chi, role: "department_head", scopeType: "unit", scopeId: dept.id, validFrom: "2026-01-01" },
    ]);

  // Studio sits in Marketing: Vu leads it, Nam and Cong are its members. Lab sits nowhere: Dung leads it alone.
  const team = async (key: string, name: string, departmentId: string | null, lead: Key, members: Key[]) => {
    const [row] = await db().insert(schema.workTeam).values({ key, name, entityId: szm.id, departmentId }).returning();
    await db()
      .insert(schema.workState)
      .values([
        { teamId: row.id, name: "Đang làm", category: "in_progress", sortOrder: 1 },
        { teamId: row.id, name: "Đã xong", category: "done", sortOrder: 2 },
      ]);
    await db()
      .insert(schema.workTeamMember)
      .values([{ teamId: row.id, personId: ids[lead], role: "lead" }, ...members.map((member) => ({ teamId: row.id, personId: ids[member], role: "member" }))]);
    return row.id;
  };
  ids.studio = await team("STU", "Studio", dept.id, "vu", ["nam", "cong"]);
  ids.lab = await team("LAB", "Lab", null, "dung", []);
  ids.open = (await db().insert(schema.workProject).values({ teamId: ids.studio, entityId: szm.id, name: "TVC Tết", leadPersonId: ids.vu }).returning())[0].id;
  // A private project of the Lab, with Tam in it: his line manager Lan is none of its people.
  ids.secret = (await db().insert(schema.workProject).values({ teamId: ids.lab, entityId: szm.id, name: "Tuyển Art Director", visibility: "private", leadPersonId: ids.dung }).returning())[0].id;
  await db()
    .insert(schema.workProjectMember)
    .values([
      { projectId: ids.secret, personId: ids.dung, role: "lead" as const },
      { projectId: ids.secret, personId: ids.tam, role: "member" as const },
    ]);
  const doing = async (teamId: string) => (await listStates([teamId])).find((state) => state.category === "in_progress")!.id;
  ids.t1 = (await createWorkTask({ teamId: ids.studio, projectId: ids.open, title: "Rough cut", assigneePersonId: ids.nam, stateId: await doing(ids.studio), estimateMinutes: 120 }, ids.vu)).task.id;
  ids.t2 = (await createWorkTask({ teamId: ids.studio, projectId: ids.open, title: "Subtitles", assigneePersonId: ids.nam, stateId: await doing(ids.studio) }, ids.vu)).task.id;
  ids.t3 = (await createWorkTask({ teamId: ids.studio, projectId: ids.open, title: "Voice-over", assigneePersonId: ids.cong, stateId: await doing(ids.studio) }, ids.vu)).task.id;
  ids.t4 = (await createWorkTask({ teamId: ids.lab, projectId: ids.secret, title: "Sơ tuyển ứng viên", assigneePersonId: ids.tam, stateId: await doing(ids.lab) }, ids.dung)).task.id;
});

// DLY-03 (a): D23 lets everyone above a person read their plans, and no screen showed one.
describe("the morning plan on the lead's board", () => {
  it("records when a plan was first filed and whether that was after the cut-off; a later change keeps the record", async () => {
    // 09:30 is the cut-off everyone follows here.
    const { after: onTime } = await savePlan(
      ids.nam,
      DAY,
      [
        { taskId: ids.t1, minutes: 120 },
        { taskId: ids.t2, minutes: null },
      ],
      "Ưu tiên bản dựng",
      vn(DAY, "08:45"),
    );
    expect(onTime).toMatchObject({ late: false, submittedAt: vn(DAY, "08:45") });
    const { after: late } = await savePlan(ids.tam, DAY, [{ taskId: ids.t4, minutes: 60 }], null, vn(DAY, "10:15"));
    expect(late.late).toBe(true);
    const { after: changed } = await savePlan(
      ids.nam,
      DAY,
      [
        { taskId: ids.t2, minutes: 30 },
        { taskId: ids.t1, minutes: 120 },
      ],
      "Ưu tiên phụ đề",
      vn(DAY, "11:00"),
    );
    expect(changed).toMatchObject({ late: false, submittedAt: vn(DAY, "08:45"), note: "Ưu tiên phụ đề" });
    expect(changed.items.map((item) => item.taskId)).toEqual([ids.t2, ids.t1]);
  });

  it("never marks late a plan nobody asked for: tomorrow's made the evening before, a collaborator's", async () => {
    expect((await savePlan(ids.nam, NEXT, [{ taskId: ids.t1, minutes: 60 }], null, vn(DAY, "18:00"))).after.late).toBe(false);
    expect((await savePlan(ids.cong, DAY, [{ taskId: ids.t3, minutes: 60 }], null, vn(DAY, "14:00"))).after.late).toBe(false);
  });

  it("shows the lead each person's plan: filed, when, late or not, the tasks in order — and a missing one as missing", async () => {
    const [studio] = await getTeamBoard(await loadReportReader(ids.vu), DAY);
    const row = (name: string) => studio.rows.find((person) => person.name === name)!.plan;
    expect(row("Nam Ngo")).toMatchObject({ filed: true, required: true, late: false, submittedAt: vn(DAY, "08:45"), note: "Ưu tiên phụ đề" });
    expect(row("Nam Ngo").items.map((item) => [item.title, item.ref, item.minutes])).toEqual([
      ["Subtitles", "STU-2", 30],
      ["Rough cut", "STU-1", 120],
    ]);
    expect(row("Cong Ly")).toMatchObject({ filed: true, required: false, late: false });
    // The day after, Cong planned nothing and nothing was asked of him; of Nam it was, and he did plan.
    const [next] = await getTeamBoard(await loadReportReader(ids.vu), NEXT);
    expect(next.rows.find((person) => person.name === "Cong Ly")!.plan).toMatchObject({ filed: false, required: false, items: [] });
    expect(next.rows.find((person) => person.name === "Nam Ngo")!.plan).toMatchObject({ filed: true, late: false });
    await db()
      .delete(schema.dailyPlan)
      .where(and(eq(schema.dailyPlan.personId, ids.nam), eq(schema.dailyPlan.date, NEXT)));
    const [without] = await getTeamBoard(await loadReportReader(ids.vu), NEXT);
    expect(without.rows.find((person) => person.name === "Nam Ngo")!.plan).toMatchObject({ filed: false, required: true });
  });

  it("follows the reports' rule: the line manager reads the plan, late and all, but not the name of private work; a colleague reads nothing", async () => {
    const [reports] = await getTeamBoard(await loadReportReader(ids.lan), DAY);
    expect(reports.kind).toBe("reports");
    const plan = reports.rows.find((person) => person.name === "Tam Bui")!.plan;
    expect(plan).toMatchObject({ filed: true, late: true });
    expect(plan.items).toEqual([{ taskId: ids.t4, title: "", ref: null, hidden: true, minutes: 60 }]);
    expect(JSON.stringify(reports)).not.toContain("Sơ tuyển ứng viên");
    // Nam leads nobody and manages nobody: the board has no rows for him, so no plan either.
    expect(await getTeamBoard(await loadReportReader(ids.nam), DAY)).toEqual([]);
  });
});

// DLY-03 (c): a submitted report told nobody, blockers or not.
describe("a report with blockers", () => {
  it("tells whoever the day is sent to: the leads of the person's teams, or the line manager where no lead stands over them", async () => {
    const readers = await firstReadersOf([ids.nam, ids.vu, ids.tam, ids.lan, ids.dung]);
    expect(readers.get(ids.nam)!.told).toEqual([ids.vu]);
    // Vu leads his own team — nobody leads him — so his day goes to his line manager.
    expect(readers.get(ids.vu)).toMatchObject({ leads: [], manager: ids.chi, told: [ids.chi] });
    expect(readers.get(ids.tam)!.told).toEqual([ids.lan]);
    // Lan's manager has left, and Dung has neither a lead nor a manager.
    expect(readers.get(ids.lan)!.told).toEqual([]);
    expect(readers.get(ids.dung)!.told).toEqual([]);
  });

  it("notifies the lead once, with a link to the report — however often it is sent again", async () => {
    const { after } = await submitReport(ids.nam, DAY, { ...blank, blockers: "Chờ kịch bản tiếng Anh" }, vn(DAY, "17:30"));
    const told = await noticesOf(ids.vu, "daily.report_blockers");
    expect(told.map((row) => [row.params, row.link])).toEqual([[{ actor: "Nam Ngo", date: "16/09/2026" }, `/daily/reports/${after.id}`]]);
    await submitReport(ids.nam, DAY, { ...blank, blockers: "Chờ kịch bản tiếng Anh và tiếng Việt" }, vn(DAY, "18:00"));
    expect(await noticesOf(ids.vu, "daily.report_blockers")).toHaveLength(1);
    // The department head is not the first reader: she reads the board.
    expect(await noticesOf(ids.chi, "daily.report_blockers")).toHaveLength(0);
  });

  it("stays silent without blockers, and speaks up when a later version brings one", async () => {
    await submitReport(ids.tam, DAY, blank, vn(DAY, "17:00"));
    expect(await noticesOf(ids.lan, "daily.report_blockers")).toHaveLength(0);
    await submitReport(ids.tam, DAY, { ...blank, blockers: "Chờ duyệt mức lương" }, vn(DAY, "19:00"));
    expect((await noticesOf(ids.lan, "daily.report_blockers")).map((row) => row.params)).toEqual([{ actor: "Tam Bui", date: "16/09/2026" }]);
  });

  it("counts a task the person has flagged as blocked, even when they wrote nothing", async () => {
    await db()
      .insert(schema.workBlocker)
      .values({ taskId: ids.t3, reason: "Chờ phòng thu", raisedByPersonId: ids.cong, raisedAt: vn(DAY, "15:00") });
    await submitReport(ids.cong, DAY, blank, vn(DAY, "17:00"));
    expect(await noticesOf(ids.vu, "daily.report_blockers")).toHaveLength(2);
  });
});

// DLY-03 (d): sending a report again rewrote it, and the readers could not tell.
describe("a report sent again", () => {
  it("keeps what it said before, oldest first — and only when the words changed", async () => {
    const [report] = await db()
      .select()
      .from(schema.dailyReport)
      .where(and(eq(schema.dailyReport.personId, ids.nam), eq(schema.dailyReport.date, DAY)));
    expect(report.revisions).toEqual([{ at: vn(DAY, "17:30").toISOString(), blockers: "Chờ kịch bản tiếng Anh", notes: null }]);
    // The same words again: nothing new to keep.
    const same = await submitReport(ids.nam, DAY, { ...blank, blockers: "Chờ kịch bản tiếng Anh và tiếng Việt" }, vn(DAY, "19:00"));
    expect(same.after.revisions).toHaveLength(1);
    const edited = await submitReport(ids.nam, DAY, { ...blank, blockers: null, notes: "Đã có kịch bản" }, vn(DAY, "20:00"));
    expect(edited.after.revisions.map((revision) => [revision.at, revision.blockers])).toEqual([
      [vn(DAY, "17:30").toISOString(), "Chờ kịch bản tiếng Anh"],
      [vn(DAY, "19:00").toISOString(), "Chờ kịch bản tiếng Anh và tiếng Việt"],
    ]);
    // The first submission still says when the report came in.
    expect(edited.after).toMatchObject({ submittedAt: vn(DAY, "17:30"), late: false, blockers: null, notes: "Đã có kịch bản" });
  });

  it("shows the earlier words to the people who read the report", async () => {
    const [report] = await db()
      .select({ id: schema.dailyReport.id })
      .from(schema.dailyReport)
      .where(and(eq(schema.dailyReport.personId, ids.nam), eq(schema.dailyReport.date, DAY)));
    const view = (await getReportView(await loadReportReader(ids.vu), report.id))!;
    expect(view.report.revisions.map((revision) => revision.blockers)).toEqual(["Chờ kịch bản tiếng Anh", "Chờ kịch bản tiếng Anh và tiếng Việt"]);
    // Tam is nobody's reader here.
    expect(await getReportView(await loadReportReader(ids.tam), report.id)).toBeNull();
  });
});

// DLY-03 (b): only members of active work teams got a weekly report, and only leads and
// department heads heard of one.
describe("weekly reports for everyone the loop asks", () => {
  const rowsOf = async (subjectType: string) =>
    (
      await db()
        .select({ subjectId: schema.dailyWeeklyReport.subjectId })
        .from(schema.dailyWeeklyReport)
        .where(and(eq(schema.dailyWeeklyReport.weekStart, W), eq(schema.dailyWeeklyReport.subjectType, subjectType)))
    ).map((row) => row.subjectId);

  it("makes a week for every person asked — in a team or in none — and for every team; none for an owner, a collaborator or someone who left", async () => {
    const result = await generateWeek(W, { notify: true });
    expect(result).toMatchObject({ people: 6, teams: 2 });
    expect((await rowsOf("person")).sort()).toEqual([ids.chi, ids.vu, ids.nam, ids.tam, ids.lan, ids.dung].sort());
    expect((await rowsOf("team")).sort()).toEqual([ids.studio, ids.lab].sort());
    // A team's week still counts every member's work: Cong is in the Studio's.
    const [studio] = await db()
      .select()
      .from(schema.dailyWeeklyReport)
      .where(and(eq(schema.dailyWeeklyReport.subjectType, "team"), eq(schema.dailyWeeklyReport.subjectId, ids.studio)));
    expect((studio.content as { people: { name: string }[] }).people.map((person) => person.name).sort()).toEqual(["Cong Ly", "Nam Ngo", "Vu Le"]);
  });

  it("tells the lead and the head above the team, and the line manager of someone no lead stands over — one notice each, once", async () => {
    const one = async (key: Key) => (await noticesOf(ids[key], "daily.weekly_report")).map((row) => [row.params, row.link]);
    const several = async (key: Key) => (await noticesOf(ids[key], "daily.weekly_reports")).map((row) => [row.params, row.link]);
    // Vu leads the Studio: its week. (Nam's reaches him with it; Cong has none.)
    expect(await one("vu")).toEqual([[{ subject: "Studio", week: "14/09/2026" }, `/daily/weekly?week=${W}&team=${ids.studio}`]]);
    // Chi heads Marketing, where the Studio sits, and is Vu's line manager: two weeks, one notice.
    expect(await one("chi")).toEqual([]);
    expect(await several("chi")).toEqual([[{ count: 2, week: "14/09/2026" }, `/daily/weekly?week=${W}`]]);
    // Tam is in no team: his week goes to his line manager.
    expect(await one("lan")).toEqual([[{ subject: "Tam Bui", week: "14/09/2026" }, `/daily/weekly?week=${W}`]]);
    expect(await one("dung")).toEqual([[{ subject: "Lab", week: "14/09/2026" }, `/daily/weekly?week=${W}&team=${ids.lab}`]]);
    // The owner's "*" is no reason to be told of every team's week.
    expect(await one("khanh")).toEqual([]);
    expect(await several("khanh")).toEqual([]);
    // Studio, Lab, Vu's week and Tam's were sent; nothing is sent twice.
    expect((await generateWeek(W, { notify: true })).notified).toBe(0);
    expect(await one("vu")).toHaveLength(1);
    expect(await several("chi")).toHaveLength(1);
  });

  it("a lead's refresh touches their team's people only, and tells nobody", async () => {
    await db().delete(schema.dailyWeeklyReport).where(eq(schema.dailyWeeklyReport.weekStart, W));
    expect(await generateWeek(W, { teamIds: [ids.studio], notify: false })).toEqual({ people: 2, teams: 1, notified: 0 });
    expect((await rowsOf("person")).sort()).toEqual([ids.vu, ids.nam].sort());
    await generateWeek(W, { notify: false });
  });

  it("reads only the rows the reader may see: their own, the people they oversee, the teams they run", async () => {
    const names_ = (rows: { name: string }[]) => rows.map((row) => row.name).sort();
    const lan = await listWeekly(await loadReportReader(ids.lan), W, () => false);
    expect(names_(lan.people)).toEqual(["Lan Do", "Tam Bui"]);
    expect(lan.teams).toEqual([]);
    const vu = await listWeekly(await loadReportReader(ids.vu), W, (team) => team.id === ids.studio);
    expect(names_(vu.people)).toEqual(["Nam Ngo", "Vu Le"]);
    expect(vu.teams.map((row) => row.team.name)).toEqual(["Studio"]);
    // Nam reads his own week and nobody else's.
    expect(names_((await listWeekly(await loadReportReader(ids.nam), W, () => false)).people)).toEqual(["Nam Ngo"]);
    // Oversight reads every person's week, and no team it does not run.
    const overseer: ReportReader = { personId: ids.khanh, ledTeamIds: new Set(), oversees: true };
    const all = await listWeekly(overseer, W, () => false);
    expect(names_(all.people)).toEqual(["Chi Vo", "Dung Ha", "Lan Do", "Nam Ngo", "Tam Bui", "Vu Le"]);
    expect(all.teams).toEqual([]);
    // Private work in Tam's week stays unnamed for his line manager.
    expect(JSON.stringify(lan)).not.toContain("Sơ tuyển ứng viên");
  });
});
