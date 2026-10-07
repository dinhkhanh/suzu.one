// One person's work record, as the daily module lets a reader see it (FR-AGT-14's "work" section of
// a person overview). Two parts, each behind this module's own policy and each null when it says
// no: utilisation over the last weeks (`canViewUtilisation`: people above them, oversight — never
// the person themselves, as on /daily/utilisation), and the end-of-day report record of the last 30
// days (`canViewReport`: self, a lead, anyone above, oversight). Counts only, summed in SQL.
import "server-only";
import { and, count, eq, gte, lte, sql } from "drizzle-orm";
import { addDays, type IsoDate } from "@/lib/dates";
import { db, schema } from "@/lib/db";
import { lastWeeks, totalOf, type Utilisation } from "./engine/utilisation";
import { loadSubjects } from "./people";
import { canViewReport, canViewUtilisation, type ReportReader } from "./policy";
import { listMissingReportDays } from "./reports";
import { UTILISATION_WEEKS, utilisationOfPeople } from "./utilisation";

/** How far back the report record reads. */
export const RECORD_DAYS = 30;

export type WorkRecord = {
  /** Over the last `UTILISATION_WEEKS` weeks; null when the reader may not see it. */
  utilisation: (Utilisation & { weeks: number }) | null;
  /** The last 30 days; null when the reader may not see the person's reports. */
  reports: { days: number; submitted: number; late: number; missingRecently: IsoDate[] } | null;
};

export async function workRecordOf(reader: ReportReader, personId: string, today: IsoDate): Promise<WorkRecord> {
  const subject = (await loadSubjects([personId])).get(personId);
  if (!subject) return { utilisation: null, reports: null };
  const seesReports = canViewReport(reader, subject);
  const seesUtilisation = canViewUtilisation(reader, subject);
  const weeks = lastWeeks(today, UTILISATION_WEEKS);
  const from = addDays(today, -RECORD_DAYS);
  const [utilisation, [sent], missing] = await Promise.all([
    seesUtilisation ? utilisationOfPeople([personId], weeks, today) : null,
    seesReports
      ? db()
          .select({ submitted: count(), late: sql<number>`count(*) filter (where ${schema.dailyReport.late})` })
          .from(schema.dailyReport)
          .where(and(eq(schema.dailyReport.personId, personId), eq(schema.dailyReport.status, "submitted"), gte(schema.dailyReport.date, from), lte(schema.dailyReport.date, today)))
      : [null],
    seesReports ? listMissingReportDays(personId, today) : null,
  ]);
  return {
    utilisation: utilisation ? { ...totalOf(utilisation.get(personId) ?? []), weeks: weeks.length } : null,
    reports: sent && missing ? { days: RECORD_DAYS, submitted: Number(sent.submitted), late: Number(sent.late), missingRecently: missing } : null,
  };
}
