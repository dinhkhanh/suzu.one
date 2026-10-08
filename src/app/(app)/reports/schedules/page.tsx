import { getFormatter, getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Fragment } from "react";
import { Badge } from "@/components/ui/badge";
import { Table, TableAddRow, TableBody, TableCard, TableCell, TableEmpty, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Page, PageHeader } from "@/components/ui/page";
import { RecordLink } from "@/components/ui/record-link";
import { env } from "@/lib/env";
import { requireUser } from "@/modules/platform/auth/session";
import { canManageSchedules, listSchedules } from "@/modules/reports/service";
import { ScheduleRowActions } from "@/modules/reports/ui/schedule-forms";
import { pageTitle } from "@/i18n/page-title";

export const generateMetadata = pageTitle("scheduledReports");

/**
 * The schedules this person may see: their own, and every one for `org:manage` holders
 * (reports/policy.ts records why there is no permission of its own). What each run actually
 * delivered — and to whom it was withheld — is on the row.
 */
export default async function SchedulesPage() {
  const user = await requireUser();
  if (!canManageSchedules(user.principal)) notFound();
  const [schedules, t, tCatalogue, format] = await Promise.all([listSchedules({ personId: user.person.id, principal: user.principal }), getTranslations("reports.schedules"), getTranslations("reports.catalogue"), getFormatter()]);
  const reportName = (key: string) => (tCatalogue.has(`${key}.name` as never) ? tCatalogue(`${key}.name` as never) : key);
  const day = (value: string | null) => (value ? format.dateTime(new Date(`${value}T00:00:00`), { dateStyle: "medium" }) : "—");
  const emailConfigured = !!env().RESEND_API_KEY;

  return (
    <Page width="wide">
      <PageHeader
        eyebrow={<Link href="/reports">{t("back")}</Link>}
        title={t("title")}
        description={t("description")}
        actions={
          <Button nativeButton={false} render={<Link href="/reports/schedules/new" />}>
            {t("new")}
          </Button>
        }
      />

      {emailConfigured ? null : <p className="rounded-[10px] border border-dashed border-border p-3 text-sm text-muted-foreground">{t("noEmailDriver")}</p>}

      <TableCard>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead kind="text">{t("name")}</TableHead>
              <TableHead kind="select">{t("report")}</TableHead>
              <TableHead kind="select">{t("cadence")}</TableHead>
              <TableHead kind="person">{t("recipients")}</TableHead>
              <TableHead kind="date">{t("nextRun")}</TableHead>
              <TableHead kind="date">{t("lastRun")}</TableHead>
              <TableHead kind="status">{t("status")}</TableHead>
              <TableHead kind="actions" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {schedules.length === 0 ? <TableEmpty>{t("none")}</TableEmpty> : null}
            {schedules.map((schedule) => (
              <TableRow key={schedule.id}>
                <TableCell className="max-w-64 truncate">
                  <Link href={`/reports/schedules/${schedule.id}`} className="font-medium hover:underline">
                    {schedule.name}
                  </Link>
                </TableCell>
                <TableCell className="text-muted-foreground">{reportName(schedule.reportKey)}</TableCell>
                <TableCell>
                  {t(`cadences.${schedule.cadence}`)}
                  {schedule.cadence === "weekly" && schedule.dayOfWeek ? ` · ${t(`days.${schedule.dayOfWeek}` as never)}` : ""}
                  {schedule.cadence === "monthly" && schedule.dayOfMonth ? ` · ${schedule.dayOfMonth}` : ""}
                </TableCell>
                <TableCell className="max-w-64 truncate text-muted-foreground">
                  {schedule.recipients.length === 0 ? "—" : null}
                  {schedule.recipients.map((recipient, index) => (
                    <Fragment key={recipient.personId}>
                      {index ? ", " : null}
                      <RecordLink kind="person" id={recipient.personId}>
                        {recipient.fullName}
                      </RecordLink>
                    </Fragment>
                  ))}
                </TableCell>
                <TableCell kind="date">{day(schedule.nextRunOn)}</TableCell>
                <TableCell kind="date">{day(schedule.lastRunOn)}</TableCell>
                <TableCell>
                  <div className="flex flex-col items-start gap-1">
                    <Badge dot variant={schedule.isActive ? "success" : "warning"}>
                      {schedule.isActive ? t("active") : t("paused")}
                    </Badge>
                    {schedule.lastRun ? (
                      <span className="text-xs text-faint">
                        {t("delivered", { count: schedule.lastRun.delivered })}
                        {schedule.lastRun.withheld > 0 ? ` · ${t("withheld", { count: schedule.lastRun.withheld })}` : ""}
                      </span>
                    ) : null}
                  </div>
                </TableCell>
                <TableCell kind="actions">
                  <ScheduleRowActions id={schedule.id} isActive={schedule.isActive} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <TableAddRow label={t("new")} href="/reports/schedules/new" />
      </TableCard>
    </Page>
  );
}
