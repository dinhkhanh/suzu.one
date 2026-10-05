// A locked month's timesheet as a file (FR-ATT-14, FR-PLT-37): one line per person, the figures
// the lock froze and payroll is paid on — so the accountant's spreadsheet and the run agree.
// The action in request-actions.ts authorizes (the lock's own permission) and audits the export.
import "server-only";
import { inArray } from "drizzle-orm";
import { createTranslator } from "next-intl";
import { ActionError } from "@/lib/action";
import { db, schema } from "@/lib/db";
import { EXPORT_ROW_LIMIT, type ExportColumn, type ExportFile, toTable } from "@/modules/platform/export/table";
import { listEntities } from "@/modules/platform/org/service";
import en from "../../../messages/en.json";
import vi from "../../../messages/vi.json";
import { getLockedTimesheets, type LockedTimesheet } from "./months";

type Locale = "vi" | "en";
type Row = LockedTimesheet & { fullName: string };

// Hours and days with at most two decimals, as numbers: a spreadsheet adds them up.
const hours = (minutes: number) => Number((minutes / 60).toFixed(2));
const days = (centi: number) => Number((centi / 100).toFixed(2));

export async function buildLockedMonthExport(entityId: string, month: string, locale: Locale): Promise<ExportFile> {
  const locked = await getLockedTimesheets(entityId, month);
  // Only what the lock froze is exported: a month still moving is not a timesheet yet.
  if (!locked) throw new ActionError("timesheet_not_locked");
  const ids = locked.people.map((row) => row.personId);
  const [entities, names] = await Promise.all([
    // Reference data: the entities come from the shared cache.
    listEntities(),
    ids.length > 0 ? db().select({ id: schema.person.id, fullName: schema.person.fullName }).from(schema.person).where(inArray(schema.person.id, ids)) : Promise.resolve([]),
  ]);
  const nameOf = new Map(names.map((row) => [row.id, row.fullName]));
  const rows: Row[] = locked.people.slice(0, EXPORT_ROW_LIMIT).map((row) => ({ ...row, fullName: nameOf.get(row.personId) ?? "" }));

  const t = createTranslator({ locale, messages: locale === "vi" ? vi : en, namespace: "attendance.months.export.columns" });
  const columns: ExportColumn<Row>[] = [
    { header: t("employeeCode"), value: (row) => row.employeeCode },
    { header: t("fullName"), value: (row) => row.fullName },
    { header: t("standardDays"), value: (row) => row.standardDays },
    { header: t("paidDays"), value: (row) => days(row.paidDaysCenti) },
    { header: t("unpaidDays"), value: (row) => days(row.unpaidDaysCenti) },
    { header: t("workedHours"), value: (row) => hours(row.workedMinutes) },
    { header: t("creditedHours"), value: (row) => hours(row.creditedMinutes) },
    { header: t("leavePaidHours"), value: (row) => hours(row.leavePaidMinutes) },
    { header: t("leaveUnpaidHours"), value: (row) => hours(row.leaveUnpaidMinutes) },
    { header: t("holidayHours"), value: (row) => hours(row.holidayMinutes) },
    { header: t("absenceHours"), value: (row) => hours(row.absenceMinutes) },
    { header: t("lateMinutes"), value: (row) => row.lateMinutes },
    { header: t("earlyMinutes"), value: (row) => row.earlyMinutes },
    { header: t("nightHours"), value: (row) => hours(row.nightMinutes) },
    { header: t("otWeekday"), value: (row) => hours(row.overtime.weekday.day) },
    { header: t("otWeekdayNight"), value: (row) => hours(row.overtime.weekday.night) },
    { header: t("otRestDay"), value: (row) => hours(row.overtime.restDay.day) },
    { header: t("otRestDayNight"), value: (row) => hours(row.overtime.restDay.night) },
    { header: t("otHoliday"), value: (row) => hours(row.overtime.holiday.day) },
    { header: t("otHolidayNight"), value: (row) => hours(row.overtime.holiday.night) },
    { header: t("otTimeOff"), value: (row) => hours(row.overtime.timeOffMinutes) },
    { header: t("otPayable"), value: (row) => hours(row.overtime.payableMinutes) },
  ];
  return { fileName: `timesheet-${entities.find((entity) => entity.id === entityId)?.code ?? "entity"}-${month}`, table: toTable(columns, rows), rowCount: rows.length, truncated: locked.people.length > rows.length };
}
