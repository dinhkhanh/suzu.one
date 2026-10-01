import { getFormatter, getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Table, TableAddRow, TableBody, TableCard, TableCell, TableEmpty, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { todayInVietnam } from "@/lib/dates";
import { canManageAttendanceConfig, canOpenAttendanceSettings } from "@/modules/attendance/policy";
import { listCalendarDays } from "@/modules/attendance/schedules";
import { CalendarDayForm, RowAction } from "@/modules/attendance/ui/settings-forms";
import { requireUser } from "@/modules/platform/auth/session";
import { configOptions } from "../options";
import { pageTitle } from "@/i18n/page-title";

export const generateMetadata = pageTitle("workingCalendar");

export default async function CalendarSettingsPage(props: PageProps<"/attendance/settings/calendar">) {
  const user = await requireUser();
  // The layout checks too, but a layout is not re-rendered on client navigation.
  if (!canOpenAttendanceSettings(user.principal)) notFound();
  const t = await getTranslations("attendance.settings");
  const format = await getFormatter();
  const current = Number(todayInVietnam().slice(0, 4));
  const asked = Number((await props.searchParams).year);
  const year = Number.isInteger(asked) && asked >= 2020 && asked <= 2100 ? asked : current;
  const [days, options] = await Promise.all([listCalendarDays(year), configOptions(user.principal)]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-3 text-sm">
        {[year - 1, year, year + 1].map((value) => (
          <Link key={value} href={`/attendance/settings/calendar?year=${value}`} className={value === year ? "pill-on" : "pill-off"}>
            {value}
          </Link>
        ))}
      </div>
      <p className="text-sm text-muted-foreground">{t("calendar.hint")}</p>
      <TableCard>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead kind="date">{t("calendar.date")}</TableHead>
              <TableHead kind="select">{t("calendar.kind")}</TableHead>
              <TableHead kind="text">{t("calendar.name")}</TableHead>
              <TableHead kind="org">{t("appliesTo")}</TableHead>
              <TableHead kind="actions" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {days.length === 0 ? <TableEmpty>{t("calendar.empty", { year })}</TableEmpty> : null}
            {days.map((day) => {
              const manage = canManageAttendanceConfig(user.principal, day.entityId);
              return (
                <TableRow key={day.id}>
                  <TableCell className="font-medium">{format.dateTime(new Date(`${day.date}T00:00:00`), { weekday: "short", day: "numeric", month: "numeric", year: "numeric" })}</TableCell>
                  <TableCell>
                    <Badge variant="secondary">{t(`calendar.kinds.${day.kind}`)}</Badge>
                  </TableCell>
                  <TableCell className="whitespace-normal">
                    <span className="flex flex-wrap items-center gap-2">
                      {day.name}
                      {day.isConfirmed ? null : <Badge variant="outline">{t("calendar.unconfirmed")}</Badge>}
                    </span>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{day.entityName ?? t("everyEntity")}</TableCell>
                  <TableCell kind="actions">
                    <span className="flex items-center justify-end gap-2">
                      {manage && !day.isConfirmed ? <RowAction action="confirmDay" id={day.id} label={t("calendar.confirm")} /> : null}
                      {manage ? <RowAction action="deleteDay" id={day.id} label={t("remove")} confirm={t("removeConfirm")} /> : null}
                    </span>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
        {options.entities.length > 0 || options.canGroup ? (
          <TableAddRow label={t("calendar.add")} open={days.length === 0}>
            <CalendarDayForm {...options} />
          </TableAddRow>
        ) : null}
      </TableCard>
    </div>
  );
}
