// HR's anomaly console (FR-ATT-15): everything in a month that still needs someone — days whose
// hours are unknown, absences without leave, late and early days, unapproved overtime, flagged
// check-ins, clock IDs nobody is mapped to, holiday work without hours, months not confirmed or
// approved. Scoped to the people HR keeps attendance for; the same list is the lock's pre-check.
import "server-only";
import { and, eq, gte, inArray, lt, lte, sql } from "drizzle-orm";
import type { IsoDate } from "@/lib/dates";
import { db, schema } from "@/lib/db";
import { matchesReach, permissionReach, type Principal, type Target } from "@/modules/platform/rbac/policy";
import { monthEnd, monthStart } from "./timesheets";

export const ANOMALY_KINDS = ["missing_punch", "absent", "late", "early", "short_hours", "ot_unapproved", "worked_on_day_off", "worked_on_leave", "no_schedule", "punch_to_review", "holiday_work_unconfirmed", "request_pending", "month_not_confirmed", "month_not_approved", "unmapped_device_id"] as const;
export type AnomalyKind = (typeof ANOMALY_KINDS)[number];
/** What opens from a line: a correction or overtime form on the person's behalf, the punch review, the clock's ID map, the request, the timesheets screen. */
export type AnomalyFix = "correction" | "overtime" | "holiday_work" | "review" | "device" | "request" | "timesheets" | "schedule" | "none";

export type AnomalyLine = { key: string; kind: AnomalyKind; personId: string | null; fullName: string | null; entityId: string | null; departmentId: string | null; date: IsoDate | null; minutes: number | null; detail: string | null; fix: AnomalyFix; href: string | null; blocking: boolean };

const DAY_KINDS: Record<string, { kind: AnomalyKind; fix: AnomalyFix; blocking: boolean }> = {
  missing_in: { kind: "missing_punch", fix: "correction", blocking: true },
  missing_out: { kind: "missing_punch", fix: "correction", blocking: true },
  absent: { kind: "absent", fix: "correction", blocking: false },
  late: { kind: "late", fix: "correction", blocking: false },
  early: { kind: "early", fix: "correction", blocking: false },
  short_hours: { kind: "short_hours", fix: "none", blocking: false },
  ot_unapproved: { kind: "ot_unapproved", fix: "overtime", blocking: false },
  worked_on_day_off: { kind: "worked_on_day_off", fix: "holiday_work", blocking: false },
  worked_on_leave: { kind: "worked_on_leave", fix: "none", blocking: false },
  no_schedule: { kind: "no_schedule", fix: "schedule", blocking: false },
};

const DAYS_OFF = ["rest", "holiday", "compensatory_off", "company_off"];

const targetOf = (person: typeof schema.person.$inferSelect): Target & { personId: string } => ({ personId: person.id, entityId: person.primaryEntityId, departmentId: person.departmentId, teamId: person.teamId, managerId: person.managerId });

export type AnomalyFilters = { entityId?: string | null; departmentId?: string | null; personId?: string | null; kind?: AnomalyKind | null; /** Late / early days below this many minutes are left out. */ minMinutes?: number };

export async function listAnomalies(viewer: Principal, month: string, filters: AnomalyFilters = {}): Promise<{ lines: AnomalyLine[]; counts: Partial<Record<AnomalyKind, number>>; people: { id: string; fullName: string }[] }> {
  const reach = permissionReach(viewer, "attendance:manage");
  const from = monthStart(month);
  const to = monthEnd(month);
  const everyone = await db().select().from(schema.person);
  const inReach = everyone.filter((person) => matchesReach(reach, targetOf(person)));
  const people = inReach.filter((person) => (!filters.entityId || person.primaryEntityId === filters.entityId) && (!filters.departmentId || person.departmentId === filters.departmentId) && (!filters.personId || person.id === filters.personId));
  const ids = people.map((person) => person.id);
  const byId = new Map(people.map((person) => [person.id, person]));
  const lines: AnomalyLine[] = [];
  if (ids.length === 0) return { lines, counts: {}, people: [] };

  const end = new Date(new Date(`${to}T00:00:00+07:00`).getTime() + 86_400_000);
  const [days, punches, requests, months, unmapped] = await Promise.all([
    db().select().from(schema.timesheetDay).where(and(inArray(schema.timesheetDay.personId, ids), gte(schema.timesheetDay.date, from), lte(schema.timesheetDay.date, to), sql`jsonb_array_length(${schema.timesheetDay.anomalies}) > 0`)),
    db().select({ id: schema.punch.id, personId: schema.punch.personId, at: schema.punch.at, flags: schema.punch.flags }).from(schema.punch).where(and(inArray(schema.punch.personId, ids), eq(schema.punch.reviewStatus, "pending"), gte(schema.punch.at, new Date(`${from}T00:00:00+07:00`)), lt(schema.punch.at, end))),
    db()
      .select({ row: schema.attendanceRequest, approvalStatus: schema.approvalRequest.status })
      .from(schema.attendanceRequest)
      .leftJoin(schema.approvalRequest, eq(schema.approvalRequest.id, schema.attendanceRequest.approvalRequestId))
      .where(and(inArray(schema.attendanceRequest.personId, ids), lte(schema.attendanceRequest.startDate, to), gte(schema.attendanceRequest.endDate, from), inArray(schema.attendanceRequest.status, ["pending", "approved"]))),
    db().select().from(schema.timesheetMonth).where(and(inArray(schema.timesheetMonth.personId, ids), eq(schema.timesheetMonth.month, month))),
    db()
      .select({ deviceId: schema.deviceUnmappedLog.deviceId, deviceUserId: schema.deviceUnmappedLog.deviceUserId, deviceName: schema.attendanceDevice.name, entityId: schema.attendanceDevice.entityId, value: sql<number>`count(*)::int` })
      .from(schema.deviceUnmappedLog)
      .innerJoin(schema.attendanceDevice, eq(schema.attendanceDevice.id, schema.deviceUnmappedLog.deviceId))
      .where(and(gte(schema.deviceUnmappedLog.at, new Date(`${from}T00:00:00+07:00`)), lt(schema.deviceUnmappedLog.at, end)))
      .groupBy(schema.deviceUnmappedLog.deviceId, schema.deviceUnmappedLog.deviceUserId, schema.attendanceDevice.name, schema.attendanceDevice.entityId),
  ]);

  const line = (input: Omit<AnomalyLine, "fullName" | "entityId" | "departmentId"> & { entityId?: string | null }): void => {
    const person = input.personId ? byId.get(input.personId) : undefined;
    lines.push({ ...input, fullName: person?.fullName ?? null, entityId: input.entityId ?? person?.primaryEntityId ?? null, departmentId: person?.departmentId ?? null });
  };
  const locked = new Set(months.filter((row) => row.status === "locked").map((row) => row.personId));
  const minMinutes = filters.minMinutes ?? 0;

  for (const day of days) {
    if (day.lockedAt) continue;
    const seen = new Set<AnomalyKind>();
    for (const code of day.anomalies) {
      let known = DAY_KINDS[code];
      if (!known || seen.has(known.kind)) continue;
      // Extra time on a day off is the same fact as "worked on a day off", and its form is holiday work.
      if (code === "ot_unapproved" && DAYS_OFF.includes(day.planKind)) {
        if (day.anomalies.includes("worked_on_day_off")) continue;
        known = { ...known, fix: "holiday_work" };
      }
      const minutes = code === "late" ? day.lateMinutes : code === "early" ? day.earlyMinutes : code === "ot_unapproved" ? day.otUnapprovedMinutes : code === "absent" || code === "short_hours" ? day.absenceMinutes : null;
      if ((code === "late" || code === "early") && (minutes ?? 0) < minMinutes) continue;
      seen.add(known.kind);
      const form = known.fix === "correction" ? "attendance_correction" : known.fix;
      const href = known.fix === "correction" || known.fix === "overtime" || known.fix === "holiday_work" ? `/attendance/requests/new?type=${form}&date=${day.date}&person=${day.personId}` : known.fix === "schedule" ? "/attendance/settings/schedules" : `/attendance?month=${month}&person=${day.personId}`;
      line({ key: `${day.id}:${known.kind}`, kind: known.kind, personId: day.personId, date: day.date, minutes, detail: code, fix: known.fix, href, blocking: known.blocking });
    }
  }
  for (const punch of punches) line({ key: `punch:${punch.id}`, kind: "punch_to_review", personId: punch.personId, date: new Date(punch.at.getTime() + 7 * 3_600_000).toISOString().slice(0, 10), minutes: null, detail: punch.flags.join(", "), fix: "review", href: "/attendance/review", blocking: true });
  for (const { row, approvalStatus } of requests) {
    const href = row.approvalRequestId ? `/approvals/attendance/${row.approvalRequestId}` : null;
    if (row.status === "pending" && (approvalStatus === "pending" || approvalStatus === "returned")) line({ key: `request:${row.id}`, kind: "request_pending", personId: row.personId, date: row.startDate, minutes: null, detail: row.type, fix: "request", href, blocking: true });
    if (row.type === "holiday_work" && row.status === "approved" && row.confirmedMinutes === null) {
      const day = days.find((candidate) => candidate.personId === row.personId && candidate.date === row.startDate);
      // Days with anomalies only are loaded; a clean day with holiday overtime is not in the list, so look the minutes up when unsure.
      const worked = day ? day.otRestDayMinutes + day.otRestDayNightMinutes + day.otHolidayMinutes + day.otHolidayNightMinutes : await holidayOvertimeOn(row.personId, row.startDate);
      if (worked === 0) line({ key: `holiday:${row.id}`, kind: "holiday_work_unconfirmed", personId: row.personId, date: row.startDate, minutes: null, detail: null, fix: "request", href, blocking: true });
    }
  }
  // Once the month is over, whoever has days in it and no confirmed / approved month is on the list.
  if (to < new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 10)) {
    const withDays = await db().selectDistinct({ personId: schema.timesheetDay.personId }).from(schema.timesheetDay).where(and(inArray(schema.timesheetDay.personId, ids), gte(schema.timesheetDay.date, from), lte(schema.timesheetDay.date, to)));
    for (const { personId } of withDays) {
      if (locked.has(personId)) continue;
      const status = months.find((row) => row.personId === personId)?.status ?? "open";
      if (status === "open") line({ key: `month:${personId}`, kind: "month_not_confirmed", personId, date: null, minutes: null, detail: null, fix: "timesheets", href: `/attendance/timesheets?month=${month}`, blocking: true });
      if (status === "confirmed") line({ key: `month:${personId}`, kind: "month_not_approved", personId, date: null, minutes: null, detail: null, fix: "timesheets", href: `/attendance/timesheets?month=${month}`, blocking: true });
    }
  }
  if (!filters.personId && !filters.departmentId) {
    for (const row of unmapped) {
      if (!matchesReach(reach, { entityId: row.entityId }) || (filters.entityId && row.entityId !== filters.entityId)) continue;
      line({ key: `device:${row.deviceId}:${row.deviceUserId}`, kind: "unmapped_device_id", personId: null, entityId: row.entityId, date: null, minutes: row.value, detail: `${row.deviceName} · ID ${row.deviceUserId}`, fix: "device", href: `/attendance/devices/${row.deviceId}`, blocking: false });
    }
  }

  const counts: Partial<Record<AnomalyKind, number>> = {};
  for (const item of lines) counts[item.kind] = (counts[item.kind] ?? 0) + 1;
  const shown = (filters.kind ? lines.filter((item) => item.kind === filters.kind) : lines).sort((a, b) => Number(b.blocking) - Number(a.blocking) || (a.date ?? "9999").localeCompare(b.date ?? "9999") || (a.fullName ?? "").localeCompare(b.fullName ?? ""));
  return { lines: shown, counts, people: inReach.filter((person) => person.status === "active").map((person) => ({ id: person.id, fullName: person.fullName })).sort((a, b) => a.fullName.localeCompare(b.fullName)) };
}

async function holidayOvertimeOn(personId: string, date: IsoDate): Promise<number> {
  const [day] = await db().select().from(schema.timesheetDay).where(and(eq(schema.timesheetDay.personId, personId), eq(schema.timesheetDay.date, date))).limit(1);
  return day ? day.otRestDayMinutes + day.otRestDayNightMinutes + day.otHolidayMinutes + day.otHolidayNightMinutes : 0;
}

/** The person's own open anomalies of a month — for "my attendance", each with the form that fixes it. */
export async function listOwnAnomalies(personId: string, month: string): Promise<{ date: IsoDate; code: string; fix: AnomalyFix }[]> {
  const days = await db().select().from(schema.timesheetDay).where(and(eq(schema.timesheetDay.personId, personId), gte(schema.timesheetDay.date, monthStart(month)), lte(schema.timesheetDay.date, monthEnd(month)), sql`jsonb_array_length(${schema.timesheetDay.anomalies}) > 0`)).orderBy(schema.timesheetDay.date);
  return days
    .filter((day) => !day.lockedAt)
    .flatMap((day) => day.anomalies.filter((code) => DAY_KINDS[code] && !(code === "ot_unapproved" && day.anomalies.includes("worked_on_day_off"))).map((code) => ({ date: day.date, code, fix: code === "ot_unapproved" && DAYS_OFF.includes(day.planKind) ? ("holiday_work" as const) : DAY_KINDS[code].fix })));
}
