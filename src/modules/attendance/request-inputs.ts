// Approved attendance requests as the timesheet engine wants them (FR-ATT-10, 11, 12, 18).
// The request types arrive with week 5 of Phase 2; until then nobody has any. Week 5 replaces the
// body: read its approved `remote_work`, `overtime` and `holiday_work` requests for these people and
// dates and shape them as `ApprovedRequests` (approved corrections are not listed here — they
// become punches with source "request").
import "server-only";
import type { IsoDate } from "@/lib/dates";
import type { db, Tx } from "@/lib/db";
import type { ApprovedRequests } from "./engine/timesheet";

type Executor = Tx | ReturnType<typeof db>;

/** Keyed by `${personId}:${date}`; a missing key = no requests that day. */
export async function approvedRequestsFor(personIds: readonly string[], from: IsoDate, to: IsoDate, executor?: Executor): Promise<Map<string, ApprovedRequests>> {
  void [personIds, from, to, executor];
  return new Map();
}
