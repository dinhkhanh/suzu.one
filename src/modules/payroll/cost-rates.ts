// Loaded cost rates for project profitability (FR-PJM-63). Compensation tier.
//
// What a person's hour cost the company in a month: gross earnings plus the employer's
// contributions (`employerCost` — gross + employer insurance + union fund) from the month's
// **regular** run, divided by the month's standard working time. Only runs the CEO has signed are
// read — approved, payment prepared, paid, locked — so a draft figure never becomes a cost. An
// off-cycle run (a year-end bonus) is left out: spread over one month's hours it would say that
// December's work cost three times November's.
//
// THE RULES THIS FILE KEEPS
//  - It answers only a holder of `pjm:cost` (owner, C-level, finance), and only for the entities
//    their grant covers; anyone else gets an empty list, filtered in SQL before anything is
//    decrypted. The caller must still check `pjm:cost` itself — this is the second lock, not the
//    first.
//  - What it returns is per person, because cost = minutes × that person's rate. **The caller must
//    never hand a rate, or a cost of one person, to anybody**: profitability rolls rates up into
//    project, client, team and role totals before anything leaves the server.
//  - It changes nothing and reads no figure it does not need.
import "server-only";
import { and, eq, gte, inArray, lte } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { can, entityReach, type Principal } from "@/modules/platform/rbac/policy";
import { withinReach } from "./reach";
import { openInput, openResult } from "./run-storage";

/** A month's loaded cost of one person, as VND per hour of standard working time. */
export type LoadedCostRate = { personId: string; month: string; ratePerHourVnd: number };

const SIGNED_STATUSES = ["approved", "payment_prepared", "paid", "locked"] as const;
const DEFAULT_MINUTES_PER_DAY = 8 * 60;

/**
 * Loaded cost rates of these people for the months between `fromMonth` and `toMonth` (inclusive)
 * that have a signed regular run. A month with no signed run is simply absent — the caller decides
 * what to fall back on, and says so.
 */
export async function loadedCostRates(principal: Principal, input: { personIds: readonly string[]; fromMonth: string; toMonth: string }): Promise<LoadedCostRate[]> {
  if (!can(principal, "pjm:cost") || input.personIds.length === 0) return [];
  const reach = entityReach(principal, "pjm:cost");
  if (!reach.all && reach.entityIds.length === 0) return [];
  const rows = await db()
    .select({ person: schema.payrollRunPerson, month: schema.payrollRun.month })
    .from(schema.payrollRunPerson)
    .innerJoin(schema.payrollRun, eq(schema.payrollRun.id, schema.payrollRunPerson.runId))
    .where(
      and(
        withinReach(schema.payrollRun.entityId, reach),
        eq(schema.payrollRun.kind, "regular"),
        inArray(schema.payrollRun.status, [...SIGNED_STATUSES]),
        gte(schema.payrollRun.month, input.fromMonth),
        lte(schema.payrollRun.month, input.toMonth),
        inArray(schema.payrollRunPerson.personId, [...new Set(input.personIds)]),
      ),
    );
  // A person paid by two entities in one month costs both; the hours are the month's once.
  const byPersonMonth = new Map<string, { cost: number; minutes: number }>();
  for (const { person, month } of rows) {
    const result = openResult(person);
    const pay = openInput(person);
    const personDays = pay.timesheet.standardDays;
    const minutesPerDay = personDays > 0 && pay.timesheet.standardMinutes > 0 ? pay.timesheet.standardMinutes / personDays : DEFAULT_MINUTES_PER_DAY;
    const minutes = Math.round(pay.period.standardDays * minutesPerDay);
    const key = `${person.personId}:${month}`;
    const seen = byPersonMonth.get(key) ?? { cost: 0, minutes: 0 };
    byPersonMonth.set(key, { cost: seen.cost + result.totals.employerCost, minutes: Math.max(seen.minutes, minutes) });
  }
  return [...byPersonMonth].flatMap(([key, { cost, minutes }]) => {
    if (minutes <= 0) return [];
    const [personId, month] = key.split(":");
    return [{ personId, month, ratePerHourVnd: Math.round((cost * 60) / minutes) }];
  });
}
