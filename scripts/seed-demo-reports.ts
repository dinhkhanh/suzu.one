// Phase 9 demo data for scheduled reports, called from seed-demo.ts. Idempotent: skipped once any
// schedule exists.
//
// One schedule, which is what the phase asks for: the weekly work report to the two team leads and
// the owner. It is deliberately a *work* report rather than a headcount one, because the work
// report is the one whose scope is membership rather than a permission — so when the job runs, the
// three recipients each get a different table out of the same schedule, which is the point.
//
// Its next run is put in the past, so `/api/cron/report-schedules` on a fresh machine has
// something to do rather than looking broken.
import { eq, inArray } from "drizzle-orm";
import type { drizzle } from "drizzle-orm/postgres-js";
import { person, reportSchedule, reportScheduleRecipient } from "../src/lib/db/schema";
import { nextRunOnOrAfter } from "../src/modules/reports/engine/cadence";

type Db = ReturnType<typeof drizzle>;

const RECIPIENTS = ["owner@suzu.vn", "long.dang@suzu.group", "bao.pham@suzu.group"];

export async function seedReports(db: Db, today: string): Promise<string> {
  const [existing] = await db.select({ id: reportSchedule.id }).from(reportSchedule).limit(1);
  if (existing) return "0 report schedules (already seeded)";

  const people = await db.select({ id: person.id, workEmail: person.workEmail }).from(person).where(inArray(person.workEmail, RECIPIENTS));
  const owner = people.find((row) => row.workEmail === "owner@suzu.vn");
  if (!owner || people.length === 0) return "0 report schedules (no demo people)";

  // Monday, and already due: the seed is for looking at, so it should have run.
  const schedule = { cadence: "weekly" as const, dayOfWeek: 1, dayOfMonth: null };
  const monday = nextRunOnOrAfter(schedule, new Date(Date.parse(`${today}T00:00:00Z`) - 14 * 86_400_000).toISOString().slice(0, 10));

  const [row] = await db
    .insert(reportSchedule)
    .values({
      reportKey: "work_analytics",
      name: "Báo cáo công việc hằng tuần",
      parameters: {},
      cadence: schedule.cadence,
      dayOfWeek: schedule.dayOfWeek,
      dayOfMonth: null,
      nextRunOn: monday,
      locale: "vi",
      createdByPersonId: owner.id,
    })
    .returning();
  await db.insert(reportScheduleRecipient).values(people.map((recipient) => ({ scheduleId: row.id, personId: recipient.id })));
  return `1 report schedule (${people.length} recipients, due ${monday})`;
}

/** Only used by the ops demo script, which runs against a live dev server. */
export async function scheduleIds(db: Db): Promise<string[]> {
  const rows = await db.select({ id: reportSchedule.id }).from(reportSchedule).where(eq(reportSchedule.isActive, true));
  return rows.map((row) => row.id);
}
