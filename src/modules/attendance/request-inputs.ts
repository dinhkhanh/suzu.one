// Approved attendance requests as the timesheet engine wants them (FR-ATT-10, 11, 12, 18), and the
// places an approved off-site request declares for check-in. Approved corrections are not listed
// here — they became punches with source "request".
import "server-only";
import { and, eq, gte, inArray, lte } from "drizzle-orm";
import type { IsoDate } from "@/lib/dates";
import { db, schema, type Tx } from "@/lib/db";
import { eachDate } from "./engine/calendar";
import type { WorkLocationRule } from "./engine/geofence";
import { clockMinutes, windowOf } from "./engine/requests";
import type { ApprovedRequests } from "./engine/timesheet";

type Executor = Tx | ReturnType<typeof db>;

/** Metres around a declared place when the request gives none: a shoot is not a desk. */
const DEFAULT_OFF_SITE_RADIUS_M = 300;

/** Keyed by `${personId}:${date}`; a missing key = no requests that day. */
export async function approvedRequestsFor(personIds: readonly string[], from: IsoDate, to: IsoDate, executor: Executor = db()): Promise<Map<string, ApprovedRequests>> {
  const result = new Map<string, ApprovedRequests>();
  if (personIds.length === 0 || to < from) return result;
  const rows = await executor
    .select()
    .from(schema.attendanceRequest)
    .where(and(inArray(schema.attendanceRequest.personId, [...new Set(personIds)]), eq(schema.attendanceRequest.status, "approved"), inArray(schema.attendanceRequest.type, ["remote_work", "overtime", "holiday_work"]), lte(schema.attendanceRequest.startDate, to), gte(schema.attendanceRequest.endDate, from)))
    .orderBy(schema.attendanceRequest.createdAt);
  const entry = (personId: string, date: string): ApprovedRequests => {
    const key = `${personId}:${date}`;
    let value = result.get(key);
    if (!value) result.set(key, (value = { remote: [], overtime: [], holidayWork: [] }));
    return value;
  };
  for (const row of rows) {
    const { details } = row;
    const compensation = row.compensation ?? "pay";
    if (details.type === "remote_work") {
      // WFH and trips are credited without punches; an off-site day with a declared position is
      // checked in at that place, so punches decide as they do at the office.
      const requiresPunch = details.kind === "off_site" && details.latitude !== null && details.longitude !== null;
      for (const date of eachDate(row.startDate < from ? from : row.startDate, row.endDate > to ? to : row.endDate)) entry(row.personId, date).remote.push({ requestId: row.id, kind: details.kind, portion: details.portion, requiresPunch });
    } else if (details.type === "overtime") {
      const window = windowOf(details.from, details.to);
      if (window) entry(row.personId, row.startDate).overtime.push({ requestId: row.id, from: window.from, to: window.to, confirmedMinutes: row.confirmedMinutes, compensation });
    } else if (details.type === "holiday_work") {
      const window = details.from && details.to ? windowOf(details.from, details.to) : null;
      entry(row.personId, row.startDate).holidayWork.push({ requestId: row.id, from: window?.from ?? clockMinutes(details.from), to: window?.to ?? clockMinutes(details.to), confirmedMinutes: row.confirmedMinutes, compensation });
    }
  }
  return result;
}

/** Places declared for one person and day by an approved off-site request (FR-ATT-11): a check-in there is fine, and says so. */
export async function declaredOffSiteLocations(executor: Executor, personId: string, date: IsoDate): Promise<WorkLocationRule[]> {
  const rows = await executor
    .select()
    .from(schema.attendanceRequest)
    .where(and(eq(schema.attendanceRequest.personId, personId), eq(schema.attendanceRequest.type, "remote_work"), eq(schema.attendanceRequest.status, "approved"), lte(schema.attendanceRequest.startDate, date), gte(schema.attendanceRequest.endDate, date)));
  return rows.flatMap((row) => {
    const { details } = row;
    if (details.type !== "remote_work" || details.latitude === null || details.longitude === null) return [];
    return [{ id: `request:${row.id}`, latitude: details.latitude, longitude: details.longitude, radiusM: details.radiusM ?? DEFAULT_OFF_SITE_RADIUS_M, accuracyLimitM: 200, ipAllowlist: [], rule: "gps" as const, mode: "flag" as const, offSite: true }];
  });
}
