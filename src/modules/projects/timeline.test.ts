// The timeline, baselines, bookings and capacity against a real Postgres (PGlite), through the real
// action pipeline — parse, authorize, run, audit — with only the session and Next's cache stubbed:
// a move writes through the work module's own task update action, so what is tested here is what
// the browser gets.
import { beforeAll, describe, expect, it, vi } from "vitest";

const session = vi.hoisted(() => ({ user: null as unknown }));
vi.mock("@/lib/db", () => import("../../../tests/helpers/db"));
vi.mock("@/lib/env", () => ({ env: () => ({ BETTER_AUTH_URL: "https://suzu.one" }) }));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined, revalidateTag: () => undefined }));
vi.mock("@/modules/platform/auth/session", () => ({ getCurrentUser: async () => session.user, requireUser: async () => session.user }));

import { and, eq, inArray } from "drizzle-orm";
import type { CurrentUser } from "@/modules/platform/auth/session";
import { db, schema } from "@/lib/db";
import { migrateTestDb } from "../../../tests/helpers/db";
import type { Grant } from "../platform/rbac/policy";
import { createProject } from "../work/projects";
import { createTeam, setTeamMember } from "../work/teams";
import { addDependency, createWorkTask } from "../work/tasks";
import { loadViewer } from "../work/viewer";
import { bookAction, deleteBookingAction, fillPlaceholderAction, moveTimelineTaskAction, rebaselineAction, updateBookingAction } from "./actions";
import { getCapacity, listCapacitySubjects, loadCapacityReader } from "./capacity";
import { decideBrief, submitBrief } from "./kickoff";
import { updateBrief, updatePlanSettings } from "./plans";
import { getTimeline } from "./timeline";

type Key = "szm" | "long" | "tam" | "huy" | "an" | "khoa" | "dir" | "video" | "tvc" | "script" | "board" | "shoot" | "edit" | "side" | "after" | "partTime";
const ids = {} as Record<Key, string>;
const users = {} as Record<"long" | "tam" | "huy" | "an" | "khoa" | "dir", CurrentUser>;
const as = (key: keyof typeof users) => {
  session.user = users[key];
};
const datesOf = async (taskId: string) => {
  const [row] = await db().select({ startDate: schema.task.startDate, dueDate: schema.task.dueDate }).from(schema.task).where(eq(schema.task.id, taskId));
  return row;
};
const auditOf = (action: string) => db().select().from(schema.auditLog).where(eq(schema.auditLog.action, action));
const noticesOf = (personId: string) => db().select().from(schema.notification).where(and(eq(schema.notification.recipientPersonId, personId), eq(schema.notification.kind, "projects.booking_changed")));
const brief = { objective: "Ra mắt dòng sản phẩm mới", scopeIn: "1 TVC 30s, 3 bản cắt ngắn", successCriteria: "Khách hàng duyệt trong hai vòng" };

beforeAll(async () => {
  await migrateTestDb();
  const [szm] = await db().insert(schema.entity).values({ code: "SZM", legalName: "SuZu Media", shortName: "Media" }).returning();
  ids.szm = szm.id;
  const grants: Record<string, Grant[]> = { dir: [{ role: "entity_director", scope: { type: "entity", id: szm.id } }] };
  for (const [key, name] of [["long", "Long Dang"], ["tam", "Tam Bui"], ["huy", "Huy Ho"], ["an", "An Le"], ["khoa", "Khoa Vu"], ["dir", "Dung Director"]] as const) {
    const [row] = await db().insert(schema.person).values({ fullName: name, searchName: name.toLowerCase(), workEmail: `${key}@suzu.group`, status: "active", primaryEntityId: szm.id }).returning();
    ids[key] = row.id;
    users[key] = { userId: `user-${key}`, sessionId: `session-${key}`, reauthAt: null, preferences: { locale: null, theme: null }, email: `${key}@suzu.group`, name, image: null, person: row, principal: { personId: row.id, workforceType: "employee", grants: grants[key] ?? [] }, request: { ipAddress: null, userAgent: null } };
  }
  // Huy reports to Tam.
  await db().update(schema.person).set({ managerId: ids.tam }).where(eq(schema.person.id, ids.huy));
  users.huy.person.managerId = ids.tam;

  // Long leads the video team; Tam, Huy and An work in it; Tam leads the TVC project. Khoa is outside.
  const video = await createTeam({ key: "VID", name: "Video Production", description: null, entityId: szm.id, departmentId: null, defaultVisibility: "team", isActive: true }, "simple", {}, ids.long);
  ids.video = video.id;
  for (const personId of [ids.tam, ids.huy, ids.an]) await setTeamMember(video.id, personId, "member");
  const project = await createProject({ teamId: video.id, name: "TVC Tết", description: null, clientId: null, status: "planned", visibility: "team", leadPersonId: ids.tam, startDate: "2026-10-01", dueDate: "2026-10-30" }, ids.long);
  ids.tvc = project.id;

  // Friday 16 October is a company day off: a shift past the 15th jumps to Monday 19th.
  await db().insert(schema.calendarDay).values({ entityId: null, date: "2026-10-16", kind: "company_off", name: "Nghỉ công ty", isConfirmed: true });

  // Script → Storyboard → Shoot → Edit. "side" is Khoa's; "after" waits for it and is not his.
  const task = async (key: Key, title: string, startDate: string | null, dueDate: string | null, assigneePersonId: string | null = null) => {
    ids[key] = (await createWorkTask({ teamId: video.id, projectId: project.id, title, startDate, dueDate, assigneePersonId }, ids.tam)).task.id;
  };
  await task("script", "Kịch bản", "2026-10-05", "2026-10-07", ids.huy);
  await task("board", "Storyboard", "2026-10-08", "2026-10-09", ids.an);
  await task("shoot", "Quay", "2026-10-12", "2026-10-15");
  await task("edit", "Dựng", "2026-10-19", "2026-10-20");
  await task("side", "Chọn nhạc", "2026-10-05", "2026-10-06", ids.khoa);
  await task("after", "Mix âm thanh", "2026-10-07", "2026-10-08");
  for (const [blocker, blocked] of [["script", "board"], ["board", "shoot"], ["shoot", "edit"], ["side", "after"]] as const) await addDependency(ids[blocker], ids[blocked], "blocks", ids.tam);

  // A default schedule: 8 hours Monday to Friday. An works mornings only.
  const day = { type: "working" as const, segments: [{ start: "08:00", end: "17:00" }], breakMinutes: 60 };
  const morning = { type: "working" as const, segments: [{ start: "08:00", end: "12:00" }], breakMinutes: 0 };
  const off = { type: "off" as const };
  await db().insert(schema.workSchedule).values({ name: "Hành chính", kind: "fixed", isDefault: true, pattern: { days: { 1: day, 2: day, 3: day, 4: day, 5: day, 6: off, 7: off } } });
  const [partTime] = await db().insert(schema.workSchedule).values({ name: "Bán thời gian", kind: "fixed", pattern: { days: { 1: morning, 2: morning, 3: morning, 4: morning, 5: morning, 6: off, 7: off } } }).returning();
  await db().insert(schema.scheduleAssignment).values({ scope: "person", personId: ids.an, scheduleId: partTime.id, validFrom: "2026-01-01" });
  // Huy is away on Tuesday 6 October (approved annual leave).
  const [type] = await db().insert(schema.leaveType).values({ code: "AL", name: "Annual", category: "annual", isPaid: true, payrollTreatment: "paid_company" }).returning();
  const [request] = await db().insert(schema.leaveRequest).values({ personId: ids.huy, entityId: szm.id, leaveTypeId: type.id, startDate: "2026-10-06", endDate: "2026-10-06", totalCenti: 100, status: "approved" }).returning();
  await db().insert(schema.leaveRequestDay).values({ requestId: request.id, personId: ids.huy, date: "2026-10-06", portion: "full", amountCenti: 100 });
});

describe("kick-off takes a baseline of every task (FR-PJM-12)", () => {
  it("links each dated task of the project to its baseline, linked to the plan or not", async () => {
    await updatePlanSettings(ids.tvc, { kind: "client", budgetMinutes: 6000, budgetByRole: [], updateCadenceDays: 7, driveUrl: null });
    await updateBrief(ids.tvc, brief);
    const { requestId } = await submitBrief(ids.tvc, ids.tam);
    await decideBrief(ids.long, requestId, { action: "approve", comment: null });
    const links = await db().select().from(schema.projectTaskLink).where(inArray(schema.projectTaskLink.taskId, [ids.script, ids.shoot]));
    expect(links.map((link) => [link.taskId, link.baselineStart, link.baselineDue, link.milestoneId]).sort()).toEqual(
      [
        [ids.script, "2026-10-05", "2026-10-07", null],
        [ids.shoot, "2026-10-12", "2026-10-15", null],
      ].sort(),
    );
  });
});

describe("the timeline (FR-PJM-07)", () => {
  it("draws the tasks with their baselines, the dependencies, the days off and who may drag what", async () => {
    const view = await getTimeline(await loadViewer(users.huy), { id: ids.tvc, teamId: ids.video, entityId: ids.szm, startDate: "2026-10-01", dueDate: "2026-10-30" }, "2026-10-01");
    expect(view.tasks).toHaveLength(6);
    expect(view.tasks.find((task) => task.id === ids.script)).toMatchObject({ baselineStart: "2026-10-05", baselineDue: "2026-10-07", slipDays: 0, canEdit: true, assigneeName: "Huy Ho" });
    expect(view.dependencies).toContainEqual({ blocker: ids.board, blocked: ids.shoot });
    expect(view.daysOff).toContainEqual({ date: "2026-10-16", name: "Nghỉ công ty" });
    expect(view.workingWeekdays).toEqual([1, 2, 3, 4, 5]);
    expect(view.hasBaseline).toBe(true);
  });

  it("moves a task and, when the person agrees, shifts the chain by the same working days", async () => {
    as("tam");
    const result = await moveTimelineTaskAction({ taskId: ids.script, startDate: "2026-10-05", dueDate: "2026-10-09", shiftDependents: true });
    expect(result).toEqual({ ok: true, data: { moved: 4, shifted: 3, leftAlone: 0 } });
    expect(await datesOf(ids.script)).toEqual({ startDate: "2026-10-05", dueDate: "2026-10-09" });
    expect(await datesOf(ids.board)).toEqual({ startDate: "2026-10-12", dueDate: "2026-10-13" });
    // Two working days past the 15th skip the day off and the weekend.
    expect(await datesOf(ids.shoot)).toEqual({ startDate: "2026-10-14", dueDate: "2026-10-20" });
    expect(await datesOf(ids.edit)).toEqual({ startDate: "2026-10-21", dueDate: "2026-10-22" });
    // Each date went through the work module's own update: its audit line and its activity.
    expect(await auditOf("work.task.update")).toHaveLength(4);
    const activity = await db().select().from(schema.workActivity).where(and(eq(schema.workActivity.taskId, ids.board), eq(schema.workActivity.field, "dueDate")));
    expect(activity).toHaveLength(1);
    const [move] = await auditOf("projects.timeline.move");
    expect(move.before).toMatchObject({ [ids.board]: { startDate: "2026-10-08", dueDate: "2026-10-09" } });
    expect(move.after).toMatchObject({ [ids.edit]: { startDate: "2026-10-21", dueDate: "2026-10-22" } });
  });

  it("moves only the task when the person says no, and says how many were left alone", async () => {
    as("tam");
    const result = await moveTimelineTaskAction({ taskId: ids.board, startDate: "2026-10-12", dueDate: "2026-10-14", shiftDependents: false });
    // The shoot would have moved, and the edit after it: both are left where they were.
    expect(result).toEqual({ ok: true, data: { moved: 1, shifted: 0, leftAlone: 2 } });
    expect(await datesOf(ids.board)).toEqual({ startDate: "2026-10-12", dueDate: "2026-10-14" });
    expect(await datesOf(ids.shoot)).toEqual({ startDate: "2026-10-14", dueDate: "2026-10-20" });
  });

  it("refuses the whole move when a dependent is not the person's to change", async () => {
    // Khoa is on his own task, not in the team: he may move it, not the task waiting for it.
    as("khoa");
    const result = await moveTimelineTaskAction({ taskId: ids.side, startDate: "2026-10-05", dueDate: "2026-10-08", shiftDependents: true });
    expect(result).toMatchObject({ ok: false, error: "failed", message: "timeline_dependents_locked" });
    expect(await datesOf(ids.side)).toEqual({ startDate: "2026-10-05", dueDate: "2026-10-06" });
    expect(await datesOf(ids.after)).toEqual({ startDate: "2026-10-07", dueDate: "2026-10-08" });
    // Alone, the move is his to make.
    expect(await moveTimelineTaskAction({ taskId: ids.side, startDate: "2026-10-05", dueDate: "2026-10-07", shiftDependents: false })).toMatchObject({ ok: true });
    // Nor may he drag a bar of the project that is not his.
    expect(await moveTimelineTaskAction({ taskId: ids.edit, startDate: null, dueDate: "2026-10-23", shiftDependents: false })).toMatchObject({ ok: false, error: "forbidden" });
  });
});

describe("re-baselining (FR-PJM-12)", () => {
  it("is refused to a member, and audited with the baseline it replaces", async () => {
    as("an");
    expect(await rebaselineAction({ projectId: ids.tvc, reason: "Khách dời lịch quay" })).toMatchObject({ ok: false, error: "forbidden" });
    expect(await auditOf("projects.baseline.rebaseline.denied")).toHaveLength(1);

    as("tam");
    const [plan] = await db().select({ baseline: schema.projectPlan.baseline }).from(schema.projectPlan).where(eq(schema.projectPlan.projectId, ids.tvc));
    expect(await rebaselineAction({ projectId: ids.tvc, reason: "Khách dời lịch quay" })).toMatchObject({ ok: true });
    const [link] = await db().select().from(schema.projectTaskLink).where(eq(schema.projectTaskLink.taskId, ids.shoot));
    expect([link.baselineStart, link.baselineDue]).toEqual(["2026-10-14", "2026-10-20"]);
    const [record] = await auditOf("projects.baseline.rebaseline");
    const before = record.before as { baseline: unknown; tasks: { taskId: string; baselineStart: string | null; baselineDue: string | null }[]; reason: string };
    expect(before.baseline).toEqual(plan.baseline);
    expect(before.reason).toBe("Khách dời lịch quay");
    // Only what moved is in the record, each with the dates it had.
    expect(before.tasks).toContainEqual({ taskId: ids.shoot, baselineStart: "2026-10-12", baselineDue: "2026-10-15" });
    expect(before.tasks.map((task) => task.taskId)).not.toContain(ids.after);
  });
});

describe("bookings (FR-PJM-13)", () => {
  it("book a person for a run of weeks, with one notice, and refuse a member or a date that is not a Monday", async () => {
    as("an");
    expect(await bookAction({ projectId: ids.tvc, personId: ids.huy, weekStart: "2026-10-05", hours: "20", status: "confirmed" })).toMatchObject({ ok: false, error: "forbidden" });
    as("tam");
    expect(await bookAction({ projectId: ids.tvc, personId: ids.huy, weekStart: "2026-10-06", hours: "20", status: "confirmed" })).toMatchObject({ ok: false, message: "booking_week_invalid" });
    expect(await bookAction({ projectId: ids.tvc, personId: ids.huy, placeholderRole: "Dựng phim", weekStart: "2026-10-05", hours: "20", status: "confirmed" })).toMatchObject({ ok: false, message: "booking_who_required" });
    expect(await bookAction({ projectId: ids.tvc, personId: ids.huy, weekStart: "2026-10-05", hours: "20", status: "confirmed", weeks: "2" })).toEqual({ ok: true, data: { created: 2, changed: 0 } });
    const notices = await noticesOf(ids.huy);
    expect(notices).toHaveLength(1);
    expect(notices[0].params).toEqual({ actor: "Tam Bui", project: "TVC Tết", week: "05/10/2026" });
    // Booking the same week again changes it rather than doubling it.
    expect(await bookAction({ projectId: ids.tvc, personId: ids.huy, weekStart: "2026-10-12", hours: "30", status: "confirmed" })).toEqual({ ok: true, data: { created: 0, changed: 1 } });
  });

  it("confirm a tentative booking and remove one, telling the person each time", async () => {
    as("tam");
    await bookAction({ projectId: ids.tvc, personId: ids.huy, weekStart: "2026-10-19", hours: "10", status: "tentative" });
    const [row] = await db().select().from(schema.projectBooking).where(and(eq(schema.projectBooking.personId, ids.huy), eq(schema.projectBooking.weekStart, "2026-10-19")));
    expect(await updateBookingAction({ bookingId: row.id, hours: "12", status: "confirmed" })).toMatchObject({ ok: true });
    expect(await deleteBookingAction({ bookingId: row.id })).toMatchObject({ ok: true });
    expect(await noticesOf(ids.huy)).toHaveLength(5);
    expect(await db().select().from(schema.projectBooking).where(eq(schema.projectBooking.id, row.id))).toHaveLength(0);
  });

  it("swap a placeholder for a person: the role stays on the rows, a week they already have is merged", async () => {
    as("tam");
    expect(await bookAction({ projectId: ids.tvc, placeholderRole: "Motion designer", weekStart: "2026-10-05", hours: "16", status: "tentative", weeks: "3" })).toMatchObject({ ok: true, data: { created: 3 } });
    expect(await bookAction({ projectId: ids.tvc, personId: ids.an, weekStart: "2026-10-12", hours: "4", status: "confirmed" })).toMatchObject({ ok: true });
    expect(await fillPlaceholderAction({ projectId: ids.tvc, placeholderRole: "Motion designer", personId: ids.an })).toEqual({ ok: true, data: { filled: 3, merged: 1 } });
    const rows = await db().select().from(schema.projectBooking).where(eq(schema.projectBooking.personId, ids.an));
    expect(rows.map((row) => [row.weekStart, row.minutes, row.status, row.placeholderRole]).sort()).toEqual([
      ["2026-10-05", 960, "tentative", "Motion designer"],
      ["2026-10-12", 1200, "confirmed", null],
      ["2026-10-19", 960, "tentative", "Motion designer"],
    ]);
    expect(await db().select().from(schema.projectBooking).where(and(eq(schema.projectBooking.projectId, ids.tvc), eq(schema.projectBooking.placeholderRole, "Motion designer"), eq(schema.projectBooking.minutes, 960)))).toHaveLength(2);
    expect(await noticesOf(ids.an)).toHaveLength(2);
    expect(await fillPlaceholderAction({ projectId: ids.tvc, placeholderRole: "Motion designer", personId: ids.an })).toMatchObject({ ok: false, message: "booking_not_found" });
  });
});

describe("capacity (FR-PJM-13)", () => {
  it("lists exactly the people the policy lets each reader see", async () => {
    const names = async (key: keyof typeof users) => (await listCapacitySubjects((await loadCapacityReader(users[key])).reader)).map((subject) => subject.fullName);
    expect(await names("long")).toEqual(["An Le", "Huy Ho", "Long Dang", "Tam Bui"]);
    expect(await names("tam")).toEqual(["Huy Ho"]);
    expect(await names("dir")).toEqual(["An Le", "Dung Director", "Huy Ho", "Khoa Vu", "Long Dang", "Tam Bui"]);
    expect(await names("huy")).toEqual([]);
    expect((await loadCapacityReader(users.huy)).mayOpen).toBe(false);
    expect(await getCapacity(users.huy, "2026-10-05")).toBeNull();
    expect((await loadCapacityReader(users.tam)).mayOpen).toBe(true);
  });

  it("counts schedule − leave − days off, confirmed bookings as load, tentative ones apart", async () => {
    const view = (await getCapacity(users.long, "2026-10-05"))!;
    expect(view.weeks[0]).toEqual({ start: "2026-10-05", end: "2026-10-11" });
    const huy = view.rows.find((row) => row.person.id === ids.huy)!;
    // Five 8-hour days, one away: 32 h available, 20 h confirmed.
    expect(huy.cells[0]).toMatchObject({ scheduledMinutes: 2400, awayMinutes: 480, awayDays: 1, availableMinutes: 1920, confirmedMinutes: 1200, tentativeMinutes: 0, freeMinutes: 720, over: false });
    // The day off on the 16th: 32 h, and 30 h confirmed.
    expect(huy.cells[1]).toMatchObject({ holidayDays: 1, availableMinutes: 1920, confirmedMinutes: 1800, over: false });
    const an = view.rows.find((row) => row.person.id === ids.an)!;
    // Mornings only: 20 h a week; the tentative 16 h do not count, but would overflow nothing yet.
    expect(an.cells[0]).toMatchObject({ availableMinutes: 1200, confirmedMinutes: 0, tentativeMinutes: 960, over: false, atRisk: false });
    // 16 h, day off Friday: the 20 h confirmed are over.
    expect(an.cells[1]).toMatchObject({ availableMinutes: 960, confirmedMinutes: 1200, over: true });
    expect(view.bookings.get(`${ids.an}:2026-10-12`)).toEqual([{ projectId: ids.tvc, projectName: "TVC Tết", weekStart: "2026-10-12", minutes: 1200, status: "confirmed" }]);
    // Away, never why.
    expect(JSON.stringify(view.rows)).not.toMatch(/Annual|"AL"/);
    // The team filter keeps its members; the free-hours filter keeps who has room — nobody has more than a full week.
    expect((await getCapacity(users.dir, "2026-10-05", { teamId: ids.video }))!.rows.map((row) => row.person.fullName)).toEqual(["An Le", "Huy Ho", "Long Dang", "Tam Bui"]);
    expect((await getCapacity(users.long, "2026-10-05", { freeMinutes: 2400 }))!.rows.map((row) => row.person.fullName)).toEqual(["Huy Ho", "Long Dang", "Tam Bui"]);
    expect((await getCapacity(users.long, "2026-10-05", { freeMinutes: 2401 }))!.rows).toEqual([]);
  });
});
