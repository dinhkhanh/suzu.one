// The leave module's entry point for other modules (lint allows only this file). Re-exports only,
// so that the leave ↔ attendance import cycle never runs anything at load time.
//
// For attendance (timesheet): `getLeaveOnDays`, `postCompensatoryLeave`.
// For payroll (Phase 5): `getLeaveUsage` (days by payroll treatment), `listPayouts` (unused days
// paid on termination), `getBalances`, `getLedger`.
// For work management (Phase 10, leave cover): `listLeaveForCover`, the one read defined here — it
// imports nothing of leave's own, so the cycle above stays inert.
import { and, eq, gte, inArray, sql, type SQL } from "drizzle-orm";
import type { IsoDate } from "@/lib/dates";
import { db, schema, type Tx } from "@/lib/db";
export type { Portion } from "./engine/request";
export { type Balance, getBalances, getLeaveBalanceFor, getLedger, type LedgerLine, listPayouts, type PayoutLine, postCompensatoryLeave } from "./ledger";
export { getLeaveOnDays, getLeaveUsage, type LeaveOnDay, type LeaveUsage, whoApprovesLeave } from "./requests";
/** Who is away on a range of days, as the viewer may see them (FR-LVE-09) — the dashboard's leave tile. */
export { type CalendarCell, type CalendarPerson, getTeamCalendar, type TeamCalendar } from "./calendar";

// ── For work management's leave cover (FR-PJM-44) ─────────────────────────────────────────
// Pulled, not pushed: the work module reads leave; leave never imports work. Read-only.


/** "live" = approved, or still waiting for a decision (pending or returned); "ended" = rejected, withdrawn or cancelled. */
export type LeaveCoverFact = { id: string; personId: string; entityId: string | null; startDate: IsoDate; endDate: IsoDate; state: "approved" | "pending" | "ended"; /** Counted working days (half days as .5). */ workingDays: number; approvalRequestId: string | null };

/**
 * Leave requests with their counted working days and where they stand — the approval engine's
 * status decides for a request still marked pending (a withdrawn approval ends it). Every filter
 * given must hold: requests ending on or after a date, of one person, or with these ids.
 */
export async function listLeaveForCover(filter: { endOnOrAfter?: IsoDate; personId?: string; requestIds?: readonly string[] }, executor: Tx | ReturnType<typeof db> = db()): Promise<LeaveCoverFact[]> {
  if (filter.requestIds && filter.requestIds.length === 0) return [];
  const conditions: (SQL | undefined)[] = [
    filter.endOnOrAfter ? gte(schema.leaveRequest.endDate, filter.endOnOrAfter) : undefined,
    filter.personId ? eq(schema.leaveRequest.personId, filter.personId) : undefined,
    filter.requestIds ? inArray(schema.leaveRequest.id, [...filter.requestIds]) : undefined,
  ];
  const rows = await executor
    .select({
      id: schema.leaveRequest.id,
      personId: schema.leaveRequest.personId,
      entityId: schema.leaveRequest.entityId,
      startDate: schema.leaveRequest.startDate,
      endDate: schema.leaveRequest.endDate,
      state: sql<"approved" | "pending" | "ended">`case when ${schema.leaveRequest.status} = 'approved' then 'approved' when ${schema.leaveRequest.status} = 'pending' and coalesce(${schema.approvalRequest.status}::text, 'pending') in ('pending', 'returned') then 'pending' else 'ended' end`,
      workingCenti: sql<number>`coalesce((select sum(${schema.leaveRequestDay.amountCenti}) from ${schema.leaveRequestDay} where ${schema.leaveRequestDay.requestId} = ${schema.leaveRequest.id}), 0)::int`,
      approvalRequestId: schema.leaveRequest.approvalRequestId,
    })
    .from(schema.leaveRequest)
    .leftJoin(schema.approvalRequest, eq(schema.approvalRequest.id, schema.leaveRequest.approvalRequestId))
    .where(and(...conditions));
  return rows.map(({ workingCenti, ...row }) => ({ ...row, workingDays: Number(workingCenti) / 100 }));
}
