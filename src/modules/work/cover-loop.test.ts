// Leave cover exists when the leave is asked for (Phase 12, R2; DLY-04), against a real Postgres
// (PGlite): the draft plan made by the leave-change hook the moment a request is filed, and the
// notice that asks the person to name their covers; what the leave request's page says where there
// is no plan; the reminder to hand back on the first working day after the leave. And WRK-02 (f):
// due and overdue reminders leave people alone on leave and on days off.
import { randomUUID } from "node:crypto";
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
import { addDays, todayInVietnam } from "@/lib/dates";
import { db, schema } from "@/lib/db";
import { migrateTestDb } from "../../../tests/helpers/db";
import { workflow } from "../../../tests/helpers/workflows";
import { registeredLeaveChangeHooks, runLeaveChangeHooks } from "../platform/leave-changes/registry";
import { getLeaveCoverAs, sendCoverReturnReminders } from "./cover";
import { sendWorkReminders } from "./jobs";
import { createProject } from "./projects";
import { createWorkTask } from "./tasks";
import { createTeam, setTeamMember } from "./teams";

type Key = "long" | "lan" | "bao" | "huy" | "mai" | "tam" | "vy";
const ids = {} as Record<Key | "szm" | "video" | "project" | "leaveType", string>;
const noticesOf = async (key: Key, kind: string) =>
  db()
    .select()
    .from(schema.notification)
    .where(and(eq(schema.notification.recipientPersonId, ids[key]), eq(schema.notification.kind, kind)));
const TODAY = todayInVietnam();

/** A leave request with a full day on each of its dates — weekends too, when the range holds any. */
async function leave(key: Key, start: string, end: string, status: "approved" | "pending" | "withdrawn") {
  const days: string[] = [];
  for (let date = start; date <= end; date = addDays(date, 1)) days.push(date);
  const [request] = await db()
    .insert(schema.leaveRequest)
    .values({ personId: ids[key], entityId: ids.szm, leaveTypeId: ids.leaveType, startDate: start, endDate: end, totalCenti: days.length * 100, status })
    .returning();
  await db()
    .insert(schema.leaveRequestDay)
    .values(days.map((date) => ({ requestId: request.id, personId: ids[key], date, portion: "full" as const, amountCenti: 100 })));
  return request.id;
}
const task = async (title: string, assignee: Key, dueDate: string) => (await createWorkTask({ teamId: ids.video, projectId: ids.project, title, assigneePersonId: ids[assignee], dueDate }, ids.long)).task;

beforeAll(async () => {
  await migrateTestDb();
  const [szm] = await db().insert(schema.entity).values({ code: "SZM", legalName: "SuZu Media", shortName: "Media" }).returning();
  ids.szm = szm.id;
  for (const key of ["long", "lan", "bao", "huy", "mai", "tam", "vy"] as const) {
    const [row] = await db()
      .insert(schema.person)
      .values({ fullName: key, searchName: key, workEmail: `${key}@suzu.group`, status: "active", primaryEntityId: szm.id })
      .returning();
    ids[key] = row.id;
  }
  const video = await createTeam({ key: "VID", name: "Video Production", description: null, entityId: szm.id, departmentId: null, defaultVisibility: "team", isActive: true }, workflow("simple"), ids.long);
  ids.video = video.id;
  for (const key of ["lan", "bao", "huy", "mai", "tam", "vy"] as const) await setTeamMember(video.id, ids[key], "member");
  ids.project = (await createProject({ teamId: video.id, name: "TVC Tết", description: null, clientId: null, status: "active", visibility: "team", leadPersonId: ids.long, startDate: null, dueDate: null }, ids.long)).id;
  const [type] = await db().insert(schema.leaveType).values({ code: "AL", name: "Annual", category: "annual", isPaid: true, payrollTreatment: "paid_company" }).returning();
  ids.leaveType = type.id;
});

// DLY-04: the draft was made at midnight or from a tab the person might never open, and told nobody.
describe("a leave request drafts its cover plan as it is filed", () => {
  const from = addDays(TODAY, 10);
  const to = addDays(TODAY, 12);

  it("through the leave-change hook work registers — the plan is there at once, and the person is asked, once, to name who covers", async () => {
    expect(registeredLeaveChangeHooks()).toContain("work.cover");
    const due = await task("Bản dựng cuối", "lan", addDays(from, 1));
    const requestId = await leave("lan", from, to, "pending");
    // What the leave actions run once the request is committed.
    await runLeaveChangeHooks({ personId: ids.lan });

    // The approver opens the request the same minute: the list is beside it.
    const seen = (await getLeaveCoverAs(requestId, ids.long))!;
    expect(seen.plan).toMatchObject({ status: "draft", personName: "lan", fromDate: from, toDate: to });
    expect(seen.plan!.items.map((item) => [item.itemType, item.itemId, item.effectiveCoverName])).toEqual([["task", due.id, null]]);
    // Its page is the person's own (and their covers'); the approver reads it here.
    expect(seen).toMatchObject({ canOpen: false });
    expect(await getLeaveCoverAs(requestId, ids.lan)).toMatchObject({ canOpen: true });

    const told = await noticesOf("lan", "tasks.cover_drafted");
    expect(told.map((row) => [row.params, row.link])).toEqual([[{ from: from.split("-").reverse().join("/"), to: to.split("-").reverse().join("/"), count: 1 }, `/work/cover/${seen.plan!.id}`]]);
    // Amended, decided, or just looked at again: the plan is refreshed, the person is not told twice.
    await runLeaveChangeHooks({ personId: ids.lan });
    expect(await noticesOf("lan", "tasks.cover_drafted")).toHaveLength(1);
  });

  it("a plan with nothing to hand over is made, shown as empty, and asks nobody to name anybody", async () => {
    const requestId = await leave("bao", addDays(TODAY, 40), addDays(TODAY, 42), "pending");
    await runLeaveChangeHooks({ personId: ids.bao });
    const seen = (await getLeaveCoverAs(requestId, ids.long))!;
    expect(seen.plan).toMatchObject({ status: "draft", items: [] });
    expect(await noticesOf("bao", "tasks.cover_drafted")).toHaveLength(0);
  });

  it("a withdrawn request takes its draft with it at once", async () => {
    const requestId = await leave("huy", addDays(TODAY, 20), addDays(TODAY, 22), "pending");
    await runLeaveChangeHooks({ personId: ids.huy });
    expect((await getLeaveCoverAs(requestId, ids.huy))!.plan).toMatchObject({ status: "draft" });
    await db().update(schema.leaveRequest).set({ status: "withdrawn" }).where(eq(schema.leaveRequest.id, requestId));
    await runLeaveChangeHooks({ personId: ids.huy });
    expect((await getLeaveCoverAs(requestId, ids.huy))!.plan).toMatchObject({ status: "cancelled" });
  });

  it("says why a request has no plan: too short to ask for one, or not drafted yet — and nothing for a leave called off", async () => {
    // One working day against the two the company asks cover from.
    const short = await leave("mai", addDays(TODAY, 30), addDays(TODAY, 30), "pending");
    await runLeaveChangeHooks({ personId: ids.mai });
    expect(await getLeaveCoverAs(short, ids.long)).toEqual({ plan: null, reason: "too_short", minDays: 2 });
    // Filed before requests drafted their plan, and the night's job has not run yet.
    const waiting = await leave("mai", addDays(TODAY, 50), addDays(TODAY, 53), "pending");
    expect(await getLeaveCoverAs(waiting, ids.long)).toEqual({ plan: null, reason: "not_drafted", minDays: 2 });
    const gone = await leave("mai", addDays(TODAY, 60), addDays(TODAY, 63), "withdrawn");
    expect(await getLeaveCoverAs(gone, ids.long)).toBeUndefined();
  });
});

// DLY-04: nothing reminded anyone to hand the work back.
describe("back from leave", () => {
  // Tam was away from Monday 14 to Friday 18 September 2026; Bao covered one task, and one more
  // has already gone back. Monday the 21st is Tam's first working day after it.
  let planId = "";
  beforeAll(async () => {
    const held = await task("Việc Bảo đang giữ", "bao", "2026-09-16");
    const returned = await task("Việc đã trả", "tam", "2026-09-17");
    const [plan] = await db()
      .insert(schema.workCoverPlan)
      .values({ personId: ids.tam, leaveRequestId: randomUUID(), fromDate: "2026-09-14", toDate: "2026-09-18", status: "submitted", defaultCoverPersonId: ids.bao, appliedAt: new Date("2026-09-14T00:05:00+07:00") })
      .returning();
    planId = plan.id;
    await db()
      .insert(schema.workCoverItem)
      .values([
        { planId, itemType: "task", itemId: held.id },
        { planId, itemType: "task", itemId: returned.id, handedBackAt: new Date("2026-09-18T17:00:00+07:00") },
        // A booking never moved: it is not something to hand back.
        { planId, itemType: "booking", itemId: randomUUID() },
      ]);
  });

  it("says nothing while the leave runs, nor on the weekend after it", async () => {
    for (const day of ["2026-09-18", "2026-09-19", "2026-09-20"]) expect(await sendCoverReturnReminders(day), day).toEqual({ returned: 0, reminded: 0 });
    expect(await noticesOf("tam", "tasks.cover_return_due")).toHaveLength(0);
  });

  it("reminds the person and the cover on the first working day back — once", async () => {
    expect(await sendCoverReturnReminders("2026-09-21")).toEqual({ returned: 1, reminded: 2 });
    expect((await noticesOf("tam", "tasks.cover_return_due")).map((row) => [row.params, row.link])).toEqual([[{ count: 1 }, `/work/cover/${planId}`]]);
    expect((await noticesOf("bao", "tasks.cover_return_ask")).map((row) => [row.params, row.link])).toEqual([[{ actor: "tam", count: 1 }, `/work/cover/${planId}`]]);
    // The same morning again, and the days after: nobody is told twice.
    expect((await sendCoverReturnReminders("2026-09-21")).reminded).toBe(0);
    expect((await sendCoverReturnReminders("2026-09-22")).reminded).toBe(0);
    expect(await noticesOf("bao", "tasks.cover_return_ask")).toHaveLength(1);
  });

  it("waits for someone whose leave runs on: the reminder comes the day they are back, and stops once the work is handed back", async () => {
    // Vy's cover plan ended on Friday the 18th too, but she is on leave again on Monday the 21st.
    const held = await task("Việc của Vy", "bao", "2026-09-16");
    const [plan] = await db()
      .insert(schema.workCoverPlan)
      .values({ personId: ids.vy, leaveRequestId: randomUUID(), fromDate: "2026-09-14", toDate: "2026-09-18", status: "submitted", defaultCoverPersonId: null, appliedAt: new Date("2026-09-14T00:05:00+07:00") })
      .returning();
    const [item] = await db().insert(schema.workCoverItem).values({ planId: plan.id, itemType: "task", itemId: held.id, coverPersonId: ids.bao }).returning();
    await leave("vy", "2026-09-21", "2026-09-21", "approved");
    await sendCoverReturnReminders("2026-09-21");
    expect(await noticesOf("vy", "tasks.cover_return_due")).toHaveLength(0);
    await sendCoverReturnReminders("2026-09-22");
    expect((await noticesOf("vy", "tasks.cover_return_due")).map((row) => row.link)).toEqual([`/work/cover/${plan.id}`]);
    expect(await noticesOf("bao", "tasks.cover_return_ask")).toHaveLength(2);
    // Handed back by hand: there is nothing left to remind anyone of.
    await db().update(schema.workCoverItem).set({ handedBackAt: new Date() }).where(eq(schema.workCoverItem.id, item.id));
    await db().delete(schema.dailyReminderSent).where(eq(schema.dailyReminderSent.personId, ids.vy));
    await sendCoverReturnReminders("2026-09-23");
    expect(await noticesOf("vy", "tasks.cover_return_due")).toHaveLength(1);
  });
});

// WRK-02 (f): the due and overdue reminders went out on leave days, holidays and Sundays.
describe("due and overdue reminders respect the person's days", () => {
  const dueSoon = async (key: Key) => (await noticesOf(key, "tasks.due_soon")).map((row) => (row.params as { title: string }).title);
  const overdue = async (key: Key) => (await noticesOf(key, "tasks.overdue")).map((row) => (row.params as { title: string }).title);

  it("someone on leave the day before a deadline is told on their last day at work, not while away", async () => {
    // Due Tuesday 13 October 2026; Huy is on approved leave on Monday the 12th.
    await task("Hạn sau kỳ nghỉ", "huy", "2026-10-13");
    await leave("huy", "2026-10-12", "2026-10-12", "approved");
    await sendWorkReminders("2026-10-08");
    expect(await dueSoon("huy")).toEqual([]);
    // Friday the 9th: nothing but a weekend and a day of leave lies before the deadline.
    await sendWorkReminders("2026-10-09");
    expect(await dueSoon("huy")).toEqual(["Hạn sau kỳ nghỉ"]);
    // The cadence's own day is the Monday he is away: silence, and no second notice.
    await sendWorkReminders("2026-10-12");
    expect(await dueSoon("huy")).toEqual(["Hạn sau kỳ nghỉ"]);
  });

  it("a public holiday and a Sunday are nobody's reminder day: the overdue notice waits for the next working day", async () => {
    // Due Wednesday 28 October 2026; Thursday the 29th is a holiday.
    await db().insert(schema.calendarDay).values({ entityId: null, date: "2026-10-29", kind: "public_holiday", name: "Nghỉ lễ", isConfirmed: true });
    await task("Trễ qua ngày lễ", "mai", "2026-10-28");
    await sendWorkReminders("2026-10-29");
    expect(await overdue("mai")).toEqual([]);
    await sendWorkReminders("2026-10-30");
    expect(await overdue("mai")).toEqual(["Trễ qua ngày lễ"]);
    // Day 3 falls on Saturday, day 4 on Sunday: nothing either day; Monday makes up for Saturday's.
    await sendWorkReminders("2026-10-31");
    await sendWorkReminders("2026-11-01");
    expect(await overdue("mai")).toHaveLength(1);
    await sendWorkReminders("2026-11-02");
    expect(await overdue("mai")).toHaveLength(2);
  });
});
