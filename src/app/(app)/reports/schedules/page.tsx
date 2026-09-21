import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { env } from "@/lib/env";
import { requireUser } from "@/modules/platform/auth/session";
import { canManageSchedules, listSchedules } from "@/modules/reports/service";
import { ScheduleRowActions } from "@/modules/reports/ui/schedule-forms";

export const metadata: Metadata = { title: "Scheduled reports" };

/**
 * The schedules this person may see: their own, and every one for `org:manage` holders
 * (reports/policy.ts records why there is no permission of its own). What each run actually
 * delivered — and to whom it was withheld — is on the row.
 */
export default async function SchedulesPage() {
  const user = await requireUser();
  if (!canManageSchedules(user.principal)) notFound();
  const schedules = await listSchedules({ personId: user.person.id, principal: user.principal });
  const [t, tCatalogue, format] = await Promise.all([getTranslations("reports.schedules"), getTranslations("reports.catalogue"), getFormatter()]);
  const reportName = (key: string) => (tCatalogue.has(`${key}.name` as never) ? tCatalogue(`${key}.name` as never) : key);
  const day = (value: string | null) => (value ? format.dateTime(new Date(`${value}T00:00:00`), { dateStyle: "medium" }) : "—");
  const emailConfigured = !!env().RESEND_API_KEY;

  return (
    <div className="flex max-w-5xl flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <p className="text-sm text-muted-foreground">
            <Link href="/reports" className="underline underline-offset-4">
              {t("back")}
            </Link>
          </p>
          <h1>{t("title")}</h1>
          <p className="text-sm text-muted-foreground">{t("description")}</p>
        </div>
        <Link href="/reports/schedules/new" className="rounded-lg border px-3 py-1.5 text-sm hover:bg-muted">
          {t("new")}
        </Link>
      </header>

      {emailConfigured ? null : <p className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">{t("noEmailDriver")}</p>}

      {schedules.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("none")}</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("name")}</TableHead>
              <TableHead>{t("report")}</TableHead>
              <TableHead>{t("cadence")}</TableHead>
              <TableHead>{t("recipients")}</TableHead>
              <TableHead>{t("nextRun")}</TableHead>
              <TableHead>{t("lastRun")}</TableHead>
              <TableHead>{t("status")}</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {schedules.map((schedule) => (
              <TableRow key={schedule.id}>
                <TableCell>
                  <Link href={`/reports/schedules/${schedule.id}`} className="underline underline-offset-4">
                    {schedule.name}
                  </Link>
                </TableCell>
                <TableCell className="text-muted-foreground">{reportName(schedule.reportKey)}</TableCell>
                <TableCell>
                  {t(`cadences.${schedule.cadence}`)}
                  {schedule.cadence === "weekly" && schedule.dayOfWeek ? ` · ${t(`days.${schedule.dayOfWeek}` as never)}` : ""}
                  {schedule.cadence === "monthly" && schedule.dayOfMonth ? ` · ${schedule.dayOfMonth}` : ""}
                </TableCell>
                <TableCell className="text-muted-foreground">{schedule.recipients.map((recipient) => recipient.fullName).join(", ") || "—"}</TableCell>
                <TableCell className="tabular-nums">{day(schedule.nextRunOn)}</TableCell>
                <TableCell className="tabular-nums">{day(schedule.lastRunOn)}</TableCell>
                <TableCell className="flex flex-col gap-1">
                  <Badge variant={schedule.isActive ? "default" : "secondary"}>{schedule.isActive ? t("active") : t("paused")}</Badge>
                  {schedule.lastRun ? (
                    <span className="text-xs text-muted-foreground">
                      {t("delivered", { count: schedule.lastRun.delivered })}
                      {schedule.lastRun.withheld > 0 ? ` · ${t("withheld", { count: schedule.lastRun.withheld })}` : ""}
                    </span>
                  ) : null}
                </TableCell>
                <TableCell>
                  <ScheduleRowActions id={schedule.id} isActive={schedule.isActive} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
