// The door through which everyone says "the inputs of these person-days changed" (FR-ATT-09):
// a punch, a review, a device import, leave approved or cancelled, a roster or schedule change,
// and from week 5 corrections and overtime. Callers pass their transaction so that the timesheet
// changes with them or not at all.
//
// Small sets are recomputed at once. A change that touches many people for many days (a new
// holiday, an entity's schedule) is left to the nightly job — and to HR's "Recompute" button —
// rather than holding the caller's transaction open.
import "server-only";
import { addDays, type IsoDate, todayInVietnam } from "@/lib/dates";
import type { db, Tx } from "@/lib/db";
import type { JobDefinition } from "@/modules/platform/jobs/service";
import { eachDate } from "./engine/calendar";
import { monthOf, monthStart, peopleIn, recomputeDays } from "./timesheets";

type Executor = Tx | ReturnType<typeof db>;

/** Person-days one call may recompute inline (about fifty people for a month). */
const INLINE_LIMIT = 1600;

export async function requestTimesheetRecompute(personIds: readonly string[], from: IsoDate, to: IsoDate, executor?: Executor): Promise<void> {
  const today = todayInVietnam();
  const until = to > today ? today : to;
  if (personIds.length === 0 || until < from) return;
  if (new Set(personIds).size * eachDate(from, until).length > INLINE_LIMIT) return;
  await recomputeDays(personIds, from, until, executor);
}

/** After a configuration change: everyone in the entity/department, from the change (or the start of last month) to today. */
export async function requestScopeRecompute(scope: { entityId?: string | null; departmentId?: string | null }, from: IsoDate, executor?: Executor): Promise<void> {
  const today = todayInVietnam();
  const earliest = monthStart(monthOf(addDays(monthStart(monthOf(today)), -1)));
  await requestTimesheetRecompute(await peopleIn(scope, executor), from < earliest ? earliest : from, today, executor);
}

/** Last month and this month for everyone, in batches. Locked months are skipped row by row; unchanged days write nothing. */
export async function recomputeOpenMonths(today: IsoDate, scope: { entityId?: string | null } = {}): Promise<{ people: number; days: number; written: number; lockedSkipped: number }> {
  const from = monthStart(monthOf(addDays(monthStart(monthOf(today)), -1)));
  const people = await peopleIn(scope);
  const total = { people: people.length, days: 0, written: 0, lockedSkipped: 0 };
  for (let index = 0; index < people.length; index += 40) {
    const result = await recomputeDays(people.slice(index, index + 40), from, today);
    total.days += result.days;
    total.written += result.written;
    total.lockedSkipped += result.lockedSkipped;
  }
  return total;
}

// Nightly, after leave: closes yesterday (missing punches and absences appear once the day is over)
// and picks up whatever a wide configuration change left behind.
export const timesheetRecomputeJob: JobDefinition = {
  name: "timesheet-recompute",
  run: ({ today }) => recomputeOpenMonths(today),
};
