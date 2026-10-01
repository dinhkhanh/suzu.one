import { getFormatter, getTranslations } from "next-intl/server";
import Link from "next/link";
import { Page, PageHeader } from "@/components/ui/page";
import { notFound } from "next/navigation";
import { pagePath } from "@/modules/kb/enums";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCard, TableCardHeader, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { canManageSpace, spaceOwner, getAckReport, loadPage } from "@/modules/kb/service";
import { AckReportTools } from "@/modules/kb/ui/ack-forms";
import { requireUser } from "@/modules/platform/auth/session";
import { pageTitle } from "@/i18n/page-title";

export const generateMetadata = pageTitle("acknowledgementReport");

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function AckReportPage(props: PageProps<"/kb/pages/[pageId]/acknowledgements">) {
  const user = await requireUser();
  const { pageId } = await props.params;
  const loaded = UUID.test(pageId) ? await loadPage(pageId) : null;
  // Who has and has not confirmed is the space's managers' business: everyone else gets "not found".
  if (!loaded || loaded.page.deletedAt || !canManageSpace(user.principal, spaceOwner(loaded.space))) notFound();

  const t = await getTranslations("kb");
  const format = await getFormatter();
  const { page } = loaded;
  const report = await getAckReport(page);
  const day = (iso: string) => format.dateTime(new Date(`${iso}T00:00:00`), { dateStyle: "medium" });
  const percent = (done: number, total: number) => (total ? Math.round((done / total) * 100) : 0);

  return (
    <Page>
      <PageHeader
        eyebrow={
          <Link href={pagePath(loaded.space.key, page)} className="hover:underline">
            {page.publishedTitle ?? page.title}
          </Link>
        }
        title={t("ack.reportTitle")}
        description={page.ackRequired && report.versionNo ? t("ack.reportLine", { n: report.versionNo, done: report.done, total: report.total, percent: percent(report.done, report.total), overdue: report.overdue, days: report.dueDays }) : page.ackRequired ? t("ack.notPublishedYet") : t("ack.notRequired")}
      />

      {report.versionNo ? (
        <>
          <AckReportTools pageId={page.id} pending={report.total - report.done} />
          <div className="grid gap-6 sm:grid-cols-2">
            {([["byEntity", report.byEntity], ["byDepartment", report.byDepartment]] as const).map(([key, groups]) => (
              <TableCard key={key}>
                <TableCardHeader title={t(`ack.${key}`)} />
                <Table numbered={false}>
                  <TableHeader>
                    <TableRow>
                      <TableHead kind="org">{key === "byEntity" ? t("access.subject.entity") : t("ack.department")}</TableHead>
                      <TableHead kind="percent">{t("ack.doneTitle")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {groups.map((group) => (
                      <TableRow key={group.name}>
                        <TableCell className="max-w-48 truncate">{group.name}</TableCell>
                        <TableCell kind="percent" className="text-muted-foreground">
                          {group.done}/{group.total} · {percent(group.done, group.total)}%
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableCard>
            ))}
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead kind="person">{t("ack.person")}</TableHead>
                <TableHead kind="org">{t("access.subject.entity")}</TableHead>
                <TableHead kind="org">{t("ack.department")}</TableHead>
                <TableHead kind="status">{t("ack.status")}</TableHead>
                <TableHead kind="date">{t("ack.lastNotice")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {report.rows.map((row) => (
                <TableRow key={row.personId}>
                  <TableCell>{row.fullName}</TableCell>
                  <TableCell>{row.entityName ?? "—"}</TableCell>
                  <TableCell>{row.departmentName ?? "—"}</TableCell>
                  <TableCell>
                    {row.acknowledgedAt ? (
                      <Badge variant="secondary">{t("ack.confirmedOn", { date: format.dateTime(row.acknowledgedAt, { dateStyle: "medium" }) })}</Badge>
                    ) : (
                      <Badge dot variant={row.overdue ? "destructive" : "outline"}>{row.overdue ? t("ack.overdueSince", { date: day(row.dueOn) }) : t("ack.dueOn", { date: day(row.dueOn) })}</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{row.lastNoticeOn ? `${day(row.lastNoticeOn)} (${row.notices})` : "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </>
      ) : null}
    </Page>
  );
}
