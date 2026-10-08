// The staffing check (FR-CRM-17): before the deal is won, can the team that would deliver it? The
// quote's estimated hours by role are set against the team's free time over the planning window
// from the expected start — the same capacity the resourcing grid shows (FR-PJM-13: schedules,
// leave, holidays and bookings), read through the projects service with the reader's own reach, so
// a seller who may not plan the team's time sees no check at all rather than somebody's leave.
//
// A shortfall offers a hiring request (§4.9) prefilled with the role, the dates and the reason; the
// request is the recruitment module's own form, filed by whoever may file one.
import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { type IsoDate } from "@/lib/dates";
import { db, schema } from "@/lib/db";
import type { CurrentUser } from "../platform/auth/session";
import { CAPACITY_WEEKS, getCapacity } from "@/modules/projects/service";
import type { RoleMinutes } from "./schema";

export type StaffingCheck = {
  quoteNumber: string;
  from: IsoDate;
  weeks: number;
  needByRole: RoleMinutes[];
  needMinutes: number;
  freeMinutes: number;
  freeByPosition: { name: string | null; minutes: number; people: number }[];
  people: number;
  shortMinutes: number;
};

/**
 * The check for one deal, from its accepted quote (else its latest one still in play). null when
 * there is nothing to check — no team, no quote, no hours estimated — or the reader plans nobody's
 * time in that team.
 */
export async function staffingCheck(
  user: Pick<CurrentUser, "person" | "principal">,
  deal: { teamId: string | null; expectedCloseOn: string | null },
  quotes: readonly { id: string; number: string; status: string }[],
  today: IsoDate,
): Promise<StaffingCheck | null> {
  if (!deal.teamId) return null;
  const quote = quotes.find((row) => row.status === "accepted") ?? quotes.find((row) => row.status !== "superseded" && row.status !== "rejected" && row.status !== "expired");
  if (!quote) return null;
  const from = deal.expectedCloseOn && deal.expectedCloseOn > today ? deal.expectedCloseOn : today;
  const [roles, capacity] = await Promise.all([
    // Hours by role, summed over the quote's lines in SQL.
    db()
      .select({ role: sql<string>`r.role`, minutes: sql<number>`sum(r.minutes)` })
      .from(schema.crmQuoteLine)
      .innerJoin(sql`jsonb_to_recordset(${schema.crmQuoteLine.roleMinutes}) as r(role text, minutes integer)`, sql`true`)
      .where(and(eq(schema.crmQuoteLine.quoteId, quote.id), sql`r.minutes > 0`))
      .groupBy(sql`r.role`)
      .orderBy(sql`r.role`),
    getCapacity(user, today, { teamId: deal.teamId, from }),
  ]);
  const needByRole = roles.map((row) => ({ role: row.role, minutes: Number(row.minutes) }));
  const needMinutes = needByRole.reduce((sum, entry) => sum + entry.minutes, 0);
  if (!capacity || needMinutes === 0) return null;
  // The capacity engine has already worked each person's weeks out; this only totals them.
  const byPosition = new Map<string | null, { minutes: number; people: number }>();
  let freeMinutes = 0;
  for (const row of capacity.rows) {
    const free = row.cells.reduce((sum, cell) => sum + Math.max(0, cell.freeMinutes), 0);
    freeMinutes += free;
    const entry = byPosition.get(row.person.positionName) ?? { minutes: 0, people: 0 };
    byPosition.set(row.person.positionName, { minutes: entry.minutes + free, people: entry.people + 1 });
  }
  return {
    quoteNumber: quote.number,
    from,
    weeks: CAPACITY_WEEKS,
    needByRole,
    needMinutes,
    freeMinutes,
    freeByPosition: [...byPosition].map(([name, entry]) => ({ name, ...entry })).sort((a, b) => b.minutes - a.minutes || (a.name ?? "").localeCompare(b.name ?? "")),
    people: capacity.rows.length,
    shortMinutes: Math.max(0, needMinutes - freeMinutes),
  };
}
