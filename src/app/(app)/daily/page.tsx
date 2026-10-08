import { BarChart3, CalendarCheck, CalendarRange, ChevronRight, ClipboardCheck, ClipboardList, Clock, Users } from "lucide-react";
import { getFormatter, getTranslations } from "next-intl/server";
import type { CSSProperties } from "react";
import { Badge } from "@/components/ui/badge";
import { List, ListItem } from "@/components/ui/list";
import { Page, PageHeader, Section } from "@/components/ui/page";
import { RecordLink } from "@/components/ui/record-link";
import { Table, TableBody, TableCell, TableEmpty, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { todayInVietnam } from "@/lib/dates";
import { listMissingReportDays, listMyReports, reportLink } from "@/modules/daily/service";
import { hoursOf } from "@/modules/daily/ui/format";
import { requireUser } from "@/modules/platform/auth/session";
import { pageTitle } from "@/i18n/page-title";

export const generateMetadata = pageTitle("myDays");

// The person's own daily reports, newest first, with the ways into the day's screens — and the days
// of the past week whose report never came, each still open to write (FR-PJM-22).
export default async function DailyIndexPage() {
  const user = await requireUser();
  const today = todayInVietnam();
  const [t, format, reports, missing] = await Promise.all([getTranslations("daily"), getFormatter(), listMyReports(user.person.id), listMissingReportDays(user.person.id, today)]);
  const dayName = (date: string) => format.dateTime(new Date(`${date}T12:00:00Z`), { weekday: "short", day: "numeric", month: "short" });
  const screens = [
    { href: "/daily/plan", label: t("index.plan"), icon: CalendarCheck },
    { href: reportLink(today), label: t("index.report"), icon: ClipboardList },
    { href: "/daily/team", label: t("board.title"), icon: Users },
    { href: "/daily/weekly", label: t("weekly.title"), icon: CalendarRange },
    { href: "/daily/time", label: t("time.title"), icon: Clock },
    { href: "/daily/timesheets", label: t("timesheets.title"), icon: ClipboardCheck },
    { href: "/daily/utilisation", label: t("utilisation.title"), icon: BarChart3 },
  ];

  return (
    <Page width="narrow">
      <PageHeader title={t("index.title")} />

      <Section title={t("index.screens")}>
        <List>
          {screens.map((screen, index) => (
            <ListItem key={screen.href} href={screen.href} className="rise press" style={{ "--i": index } as CSSProperties}>
              <screen.icon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 font-medium">{screen.label}</span>
              <ChevronRight aria-hidden className="size-4 shrink-0 text-faint" />
            </ListItem>
          ))}
        </List>
      </Section>

      {missing.length > 0 ? (
        <Section title={t("index.missing")} count={missing.length}>
          <List>
            {missing.map((date, index) => (
              <ListItem key={date} href={reportLink(date)} className="rise press" style={{ "--i": index } as CSSProperties}>
                <span className="min-w-0 flex-1 font-medium">{dayName(date)}</span>
                <Badge dot variant="destructive">
                  {t("board.missing")}
                </Badge>
                <span className="text-xs text-muted-foreground">{t("index.write")}</span>
                <ChevronRight aria-hidden className="size-4 shrink-0 text-faint" />
              </ListItem>
            ))}
          </List>
          <p className="px-0.5 text-xs text-muted-foreground">{t("index.missingHint")}</p>
        </Section>
      ) : null}

      <Section title={t("index.recent")} count={reports.length || undefined}>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead kind="date">{t("index.columns.date")}</TableHead>
              <TableHead kind="status">{t("index.columns.status")}</TableHead>
              <TableHead kind="time">{t("index.columns.hours")}</TableHead>
              <TableHead kind="check">{t("index.hasBlockers")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {reports.length === 0 ? <TableEmpty>{t("index.empty")}</TableEmpty> : null}
            {reports.map((report) => (
              <TableRow key={report.id}>
                <TableCell>
                  <RecordLink kind="dailyReport" id={report.id} className="font-medium">
                    {dayName(report.date)}
                  </RecordLink>
                </TableCell>
                <TableCell>
                  {report.status === "submitted" ? (
                    <Badge dot variant={report.late ? "warning" : "success"}>
                      {report.late ? t("late") : t("submitted")}
                    </Badge>
                  ) : (
                    <Badge variant="outline">{t("draft")}</Badge>
                  )}
                </TableCell>
                <TableCell kind="time" className="text-muted-foreground">
                  {t("hours", { value: hoursOf(report.minutesLogged) })}
                </TableCell>
                <TableCell>{report.blockers?.trim() ? <Badge variant="destructive">{t("index.hasBlockers")}</Badge> : null}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Section>
    </Page>
  );
}
