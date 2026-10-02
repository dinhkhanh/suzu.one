import { BarChart3, CalendarCheck, CalendarRange, ChevronRight, ClipboardCheck, ClipboardList, Clock, Users } from "lucide-react";
import { getFormatter, getTranslations } from "next-intl/server";
import type { CSSProperties } from "react";
import { Badge } from "@/components/ui/badge";
import { List, ListItem } from "@/components/ui/list";
import { Page, PageHeader, Section } from "@/components/ui/page";
import { RecordLink } from "@/components/ui/record-link";
import { Table, TableBody, TableCell, TableEmpty, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { listMyReports } from "@/modules/daily/service";
import { hoursOf } from "@/modules/daily/ui/format";
import { requireUser } from "@/modules/platform/auth/session";
import { pageTitle } from "@/i18n/page-title";

export const generateMetadata = pageTitle("myDays");

// The person's own daily reports, newest first, with the ways into the day's screens.
export default async function DailyIndexPage() {
  const user = await requireUser();
  const [t, format, reports] = await Promise.all([getTranslations("daily"), getFormatter(), listMyReports(user.person.id)]);
  const screens = [
    { href: "/daily/plan", label: t("index.plan"), icon: CalendarCheck },
    { href: "/daily/report", label: t("index.report"), icon: ClipboardList },
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
                    {format.dateTime(new Date(`${report.date}T12:00:00Z`), { weekday: "short", day: "numeric", month: "short" })}
                  </RecordLink>
                </TableCell>
                <TableCell>{report.status === "submitted" ? <Badge dot variant={report.late ? "warning" : "success"}>{report.late ? t("late") : t("submitted")}</Badge> : <Badge variant="outline">{t("draft")}</Badge>}</TableCell>
                <TableCell kind="time" className="text-muted-foreground">{t("hours", { value: hoursOf(report.minutesLogged) })}</TableCell>
                <TableCell>{report.blockers?.trim() ? <Badge variant="destructive">{t("index.hasBlockers")}</Badge> : null}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Section>
    </Page>
  );
}
