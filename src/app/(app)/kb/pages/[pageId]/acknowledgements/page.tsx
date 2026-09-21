import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { canManageSpace, spaceOwner, getAckReport, loadPage } from "@/modules/kb/service";
import { AckReportTools } from "@/modules/kb/ui/ack-forms";
import { requireUser } from "@/modules/platform/auth/session";

export const metadata: Metadata = { title: "Acknowledgement report" };

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
    <div className="flex max-w-4xl flex-col gap-8">
      <header className="flex flex-col gap-1">
        <p className="text-sm text-muted-foreground">
          <Link href={`/kb/pages/${page.id}`} className="hover:underline">
            {page.publishedTitle ?? page.title}
          </Link>
        </p>
        <h1>{t("ack.reportTitle")}</h1>
        {page.ackRequired && report.versionNo ? (
          <p className="text-sm text-muted-foreground">{t("ack.reportLine", { n: report.versionNo, done: report.done, total: report.total, percent: percent(report.done, report.total), overdue: report.overdue, days: report.dueDays })}</p>
        ) : (
          <p className="text-sm text-muted-foreground">{page.ackRequired ? t("ack.notPublishedYet") : t("ack.notRequired")}</p>
        )}
      </header>

      {report.versionNo ? (
        <>
          <AckReportTools pageId={page.id} pending={report.total - report.done} />
          <div className="grid gap-6 sm:grid-cols-2">
            {([["byEntity", report.byEntity], ["byDepartment", report.byDepartment]] as const).map(([key, groups]) => (
              <section key={key} className="flex flex-col gap-2">
                <h2 className="text-sm font-medium">{t(`ack.${key}`)}</h2>
                <ul className="flex flex-col gap-1 text-sm">
                  {groups.map((group) => (
                    <li key={group.name} className="flex items-center gap-2">
                      <span className="min-w-0 flex-1 truncate">{group.name}</span>
                      <span className="tabular-nums text-muted-foreground">
                        {group.done}/{group.total} · {percent(group.done, group.total)}%
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("ack.person")}</TableHead>
                <TableHead>{t("access.subject.entity")}</TableHead>
                <TableHead>{t("ack.department")}</TableHead>
                <TableHead>{t("ack.status")}</TableHead>
                <TableHead>{t("ack.lastNotice")}</TableHead>
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
                      <Badge variant={row.overdue ? "destructive" : "outline"}>{row.overdue ? t("ack.overdueSince", { date: day(row.dueOn) }) : t("ack.dueOn", { date: day(row.dueOn) })}</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">{row.lastNoticeOn ? `${day(row.lastNoticeOn)} (${row.notices})` : "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </>
      ) : null}
    </div>
  );
}
