import { getFormatter, getTranslations } from "next-intl/server";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Table, TableAddRow, TableBody, TableCard, TableCell, TableEmpty, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { statusTone } from "@/components/ui/tone";
import { todayInVietnam } from "@/lib/dates";
import { requireUser } from "@/modules/platform/auth/session";
import { listOneOnOnes, myReports } from "@/modules/performance/service";
import { Page, PageHeader } from "@/components/ui/page";
import { RecordLink } from "@/components/ui/record-link";
import { PerformanceNav } from "@/modules/performance/ui/nav";
import { NewOneOnOneForm } from "@/modules/performance/ui/one-on-one-forms";
import { pageTitle } from "@/i18n/page-title";

export const generateMetadata = pageTitle("oneOnOneMeetings");

/** Every 1:1 the viewer is a party to — as the manager or as the person it is about (FR-PRF-04). */
export default async function OneOnOnesPage() {
  const user = await requireUser();
  const [t, format, meetings, reports] = await Promise.all([getTranslations("performance.oneOnOnes"), getFormatter(), listOneOnOnes(user.person.id), myReports(user.person.id)]);

  return (
    <Page>
      <PageHeader title={t("title")} description={t("description")} />
      <PerformanceNav active="oneOnOnes" />

      <TableCard>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead kind="date">{t("meetingOn")}</TableHead>
              <TableHead kind="person">{t("person")}</TableHead>
              <TableHead kind="number">{t("actions.title")}</TableHead>
              <TableHead kind="status">{t("columns.status")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {meetings.length === 0 ? <TableEmpty>{t("empty")}</TableEmpty> : null}
            {meetings.map(({ row, managerName, personName, actionCount }) => (
              <TableRow key={row.id}>
                <TableCell>
                  <Link href={`/performance/one-on-ones/${row.id}`} className="font-medium hover:underline">
                    {format.dateTime(new Date(`${row.meetingOn}T00:00:00+07:00`), { dateStyle: "medium" })}
                  </Link>
                </TableCell>
                <TableCell>
                  <RecordLink kind="person" id={row.managerPersonId === user.person.id ? row.personId : row.managerPersonId}>{row.managerPersonId === user.person.id ? personName : managerName}</RecordLink>
                </TableCell>
                <TableCell kind="number">{actionCount > 0 ? actionCount : "—"}</TableCell>
                <TableCell>
                  <Badge dot variant={statusTone(row.status)}>{t(`status.${row.status}`)}</Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {reports.length > 0 ? (
          <TableAddRow label={t("new")} open={meetings.length === 0}>
            <NewOneOnOneForm reports={reports} today={todayInVietnam()} />
          </TableAddRow>
        ) : null}
      </TableCard>
    </Page>
  );
}
