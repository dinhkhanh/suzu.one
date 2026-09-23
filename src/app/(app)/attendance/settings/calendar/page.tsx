import { getFormatter, getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
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
          <Link key={value} href={`/attendance/settings/calendar?year=${value}`} className={value === year ? "font-semibold" : "text-muted-foreground hover:underline"}>
            {value}
          </Link>
        ))}
      </div>
      <p className="text-sm text-muted-foreground">{t("calendar.hint")}</p>
      {days.length === 0 ? <p className="text-sm text-muted-foreground">{t("calendar.empty", { year })}</p> : null}
      <ul className="flex flex-col divide-y rounded-xl border empty:hidden">
        {days.map((day) => {
          const manage = canManageAttendanceConfig(user.principal, day.entityId);
          return (
            <li key={day.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 p-3 text-sm">
              <span className="w-44 font-medium">{format.dateTime(new Date(`${day.date}T00:00:00`), { weekday: "short", day: "numeric", month: "numeric", year: "numeric" })}</span>
              <Badge variant="secondary">{t(`calendar.kinds.${day.kind}`)}</Badge>
              <span className="min-w-0 flex-1">{day.name}</span>
              <span className="text-xs text-muted-foreground">{day.entityName ?? t("everyEntity")}</span>
              {day.isConfirmed ? null : <Badge variant="outline">{t("calendar.unconfirmed")}</Badge>}
              {manage && !day.isConfirmed ? <RowAction action="confirmDay" id={day.id} label={t("calendar.confirm")} /> : null}
              {manage ? <RowAction action="deleteDay" id={day.id} label={t("remove")} confirm={t("removeConfirm")} /> : null}
            </li>
          );
        })}
      </ul>
      {options.entities.length > 0 || options.canGroup ? <CalendarDayForm {...options} /> : null}
    </div>
  );
}
