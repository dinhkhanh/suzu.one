// The check-in reminder: five minutes after someone's working day starts and no check-in has come,
// a push to their phone — they may well be at their desk and have forgotten. The job runs every
// five minutes (vercel.json) and is recorded only when somebody is due (`due`), so a quiet tick
// leaves no run behind. Who is due, and when, is `engine/checkin-reminder.ts`; each person is told
// once per working day (`daily_reminder_sent`, through the daily service).
import "server-only";
import { and, eq, gte, inArray, isNull, or } from "drizzle-orm";
import { addDays, type IsoDate, todayInVietnam } from "@/lib/dates";
import { db, schema } from "@/lib/db";
import { getLeaveOnDays } from "@/modules/leave/service";
import type { JobDefinition } from "@/modules/platform/jobs/service";
import { notify } from "@/modules/platform/notifications/service";
import { checkInCountsFrom, expectedCheckIn, reminderDue } from "./engine/checkin-reminder";
import { approvedRequestsFor } from "./request-inputs";
import { getDayPlans } from "./schedules";

// Lazily: the daily module reads attendance in turn.
const dailyService = () => import("../daily/service");

const KIND = "checkin";

type Due = { personId: string; date: IsoDate; expected: number };

/**
 * Active people inside their reminder window now, with no check-in yet and not told today. Their
 * plan for yesterday counts too — a night shift's start may lie just before midnight. Cheapest
 * first: the plans alone (cached reference data and the roster) settle almost every tick.
 */
export async function findDueCheckIns(now: Date = new Date()): Promise<Due[]> {
  const today = todayInVietnam(now);
  const yesterday = addDays(today, -1);
  const people = (await db().select({ id: schema.person.id }).from(schema.person).where(eq(schema.person.status, "active"))).map((row) => row.id);
  const plans = await getDayPlans(people, yesterday, today);
  const byPlan = [...plans.values()].flatMap(({ personId, days }) =>
    days.flatMap((day) => {
      const expected = expectedCheckIn(day, [], []);
      return expected !== null && reminderDue(expected, now.getTime()) ? [{ personId, date: day.date, expected }] : [];
    }),
  );
  if (byPlan.length === 0) return [];

  const ids = [...new Set(byPlan.map((item) => item.personId))];
  const [leave, requests, told] = await Promise.all([getLeaveOnDays(ids, yesterday, today), approvedRequestsFor(ids, yesterday, today), dailyService().then(({ remindedOn }) => remindedOn(ids, KIND, [yesterday, today]))]);
  const expecting = byPlan.filter((item) => {
    const key = `${item.personId}:${item.date}`;
    if (told.has(key)) return false;
    const plan = plans.get(item.personId)!.days.find((day) => day.date === item.date)!;
    const own = leave.filter((day) => day.personId === item.personId && day.date === item.date);
    return expectedCheckIn(plan, own, requests.get(key)?.remote ?? []) !== null;
  });
  if (expecting.length === 0) return [];

  const [checkedIn, clockedOffline] = await Promise.all([
    db()
      .selectDistinct({ personId: schema.punch.personId })
      .from(schema.punch)
      .where(or(...expecting.map((item) => and(eq(schema.punch.personId, item.personId), gte(schema.punch.at, new Date(checkInCountsFrom(item.expected))))))),
    // A clock whose log HR uploads later (no push token) has its punches arrive after the fact:
    // its people may have punched already, and the app cannot know.
    db()
      .selectDistinct({ personId: schema.deviceUserMap.personId })
      .from(schema.deviceUserMap)
      .innerJoin(schema.attendanceDevice, eq(schema.attendanceDevice.id, schema.deviceUserMap.deviceId))
      .where(and(inArray(schema.deviceUserMap.personId, [...new Set(expecting.map((item) => item.personId))]), eq(schema.attendanceDevice.isActive, true), isNull(schema.attendanceDevice.pushTokenHash))),
  ]);
  const skip = new Set([...checkedIn, ...clockedOffline].map((row) => row.personId));
  return expecting.filter((item) => !skip.has(item.personId));
}

/** Tells everyone due now, each once for the day their check-in belongs to. */
export async function sendCheckInReminders(now: Date = new Date()): Promise<{ reminded: number }> {
  const due = await findDueCheckIns(now);
  if (due.length === 0) return { reminded: 0 };
  const { claimReminders } = await dailyService();
  let reminded = 0;
  // One notice per start time: the wording names it.
  for (const [key, group] of Map.groupBy(due, (item) => `${item.date}|${item.expected}`)) {
    const [date, expected] = key.split("|");
    const time = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Ho_Chi_Minh", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(Number(expected)));
    reminded += await db().transaction(async (tx) => {
      const fresh = await claimReminders(
        tx,
        group.map((item) => item.personId),
        KIND,
        date,
      );
      if (fresh.length > 0) await notify({ recipients: fresh, kind: "daily.checkin_reminder", params: { time }, link: "/attendance/check-in" }, tx);
      return fresh.length;
    });
  }
  return { reminded };
}

export const checkInRemindersJob: JobDefinition = {
  name: "attendance-checkin-reminders",
  run: () => sendCheckInReminders(),
  due: async () => (await findDueCheckIns()).length > 0,
};
