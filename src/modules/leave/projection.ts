// Booking leave ahead of the ledger (LVE-01): the figures `engine/entitlement.ts#bookingAhead`
// needs, read in two grouped queries — the ledger of this year and the next, and the days already
// booked or asked for in them. Used by the request preview and again when the request is approved,
// so the two never disagree.
import "server-only";
import { and, eq, gte, inArray, lte, ne, or, sql } from "drizzle-orm";
import { type IsoDate, todayInVietnam } from "@/lib/dates";
import { db, schema, type Tx } from "@/lib/db";
import type { EmploymentFacts } from "@/modules/core-hr/service";
import { getParameter } from "@/modules/platform/statutory/service";
import { type AheadYear, bookingAhead } from "./engine/entitlement";
import { engineFacts } from "./ledger";
import { type LeaveTypeRow, listPolicies, policyOn, policyRules } from "./types";

type Executor = Tx | ReturnType<typeof db>;

/** Days a year may hold beyond its ledger by a date; 0 for every year but this one and the next. */
export type AheadOf = (year: number, asOf: IsoDate) => number;

const none: AheadOf = () => 0;

/**
 * What booking ahead adds to one person's balance of one type, per leave year. `ignoreRequestId`:
 * a request being replaced, whose days do not count as asked for. Configuration (policies, the
 * statutory figures) comes from `configFrom` when given (a transaction), else from the cache.
 */
export async function bookingAheadFor(executor: Executor, facts: EmploymentFacts, type: LeaveTypeRow, options: { today?: IsoDate; ignoreRequestId?: string | null; configFrom?: Executor } = {}): Promise<AheadOf> {
  if (!type.tracksBalance || !facts.startDate) return none;
  const today = options.today ?? todayInVietnam();
  const current = Number(today.slice(0, 4));
  const entry = schema.leaveLedgerEntry;
  const day = schema.leaveRequestDay;
  const request = schema.leaveRequest;
  const [ledger, days, policies, statutoryNow, statutoryNext] = await Promise.all([
    executor
      .select({
        year: entry.leaveYear,
        balance: sql<number>`sum(${entry.amountCenti})::int`,
        given: sql<number>`coalesce(sum(${entry.amountCenti}) filter (where ${entry.kind} in ('accrual', 'grant')), 0)::int`,
        opening: sql<IsoDate | null>`max(${entry.effectiveDate}) filter (where ${entry.kind} = 'opening')`,
      })
      .from(entry)
      .where(and(eq(entry.personId, facts.personId), eq(entry.leaveTypeId, type.id), inArray(entry.leaveYear, [current, current + 1])))
      .groupBy(entry.leaveYear),
    // Booked (approved) and still asked for (pending with the engine); a returned request still asks.
    executor
      .select({
        year: sql<number>`extract(year from ${day.date})::int`,
        pending: sql<number>`coalesce(sum(${day.amountCenti}) filter (where ${request.status} = 'pending'), 0)::int`,
        lastDate: sql<IsoDate | null>`max(${day.date})`,
      })
      .from(day)
      .innerJoin(request, eq(request.id, day.requestId))
      .leftJoin(schema.approvalRequest, eq(schema.approvalRequest.id, request.approvalRequestId))
      .where(
        and(
          eq(day.personId, facts.personId),
          eq(request.leaveTypeId, type.id),
          gte(day.date, `${current}-01-01`),
          lte(day.date, `${current + 1}-12-31`),
          or(eq(request.status, "approved"), and(eq(request.status, "pending"), inArray(schema.approvalRequest.status, ["pending", "returned"]))),
          options.ignoreRequestId ? ne(request.id, options.ignoreRequestId) : undefined,
        ),
      )
      .groupBy(sql`1`),
    listPolicies([type.id], options.configFrom),
    getParameter("leave.annual", today, options.configFrom).catch(() => null),
    getParameter("leave.annual", `${current + 1}-01-01`, options.configFrom).catch(() => null),
  ]);

  const yearOf = (year: number): AheadYear => {
    const books = ledger.find((row) => row.year === year);
    const asked = days.find((row) => row.year === year);
    return { givenCenti: books?.given ?? 0, availableCenti: (books?.balance ?? 0) - (asked?.pending ?? 0), lastDate: asked?.lastDate ?? null };
  };
  const input = {
    today,
    employment: engineFacts(facts),
    policyAt: (date: IsoDate) => {
      const row = policyOn(policies, type.id, facts.entityId, date);
      return row ? policyRules(row) : null;
    },
    statutoryFor: (year: number) => (year === current ? statutoryNow : year === current + 1 ? statutoryNext : null),
    openingDateFor: (year: number) => ledger.find((row) => row.year === year)?.opening ?? null,
    thisYear: yearOf(current),
    nextYear: yearOf(current + 1),
  };
  return (year, asOf) => bookingAhead(input, year, asOf).centi;
}
