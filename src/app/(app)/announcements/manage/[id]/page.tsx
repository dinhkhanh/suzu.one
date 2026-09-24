import { getFormatter, getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { statusTone } from "@/components/ui/tone";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { audienceNames, audienceOptionsFor, commsViewerOf, getAnnouncementView, getReadReport } from "@/modules/comms/service";
import { AnnouncementForm } from "@/modules/comms/ui/announcement-form";
import { AnnouncementStateButtons } from "@/modules/comms/ui/buttons";
import { audienceLabel, toLocalInput } from "@/modules/comms/ui/labels";
import { requireUser } from "@/modules/platform/auth/session";
import { pageTitle } from "@/i18n/page-title";

export const generateMetadata = pageTitle("announcement");

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function ManageAnnouncementPage(props: PageProps<"/announcements/manage/[id]">) {
  const user = await requireUser();
  const { id } = await props.params;
  const view = UUID.test(id) ? await getAnnouncementView(await commsViewerOf(user), id) : null;
  // Readers have the announcement itself; this page — the form and who has read it — is its managers'.
  if (!view?.canManage) notFound();

  const { row } = view;
  const [t, format, choices, names, report] = await Promise.all([getTranslations("comms"), getFormatter(), audienceOptionsFor(user.principal), audienceNames(view.audience), row.status === "published" ? getReadReport(id, view) : null]);
  const when = (date: Date | null) => (date ? format.dateTime(date, { dateStyle: "short", timeStyle: "short" }) : "—");

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-2">
        <p className="text-sm text-muted-foreground">
          <Link href="/announcements/manage" className="hover:underline">
            {t("manage.title")}
          </Link>
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <h1>{row.title}</h1>
          <Badge dot variant={statusTone(view.phase)}>{t(`phase.${view.phase}`)}</Badge>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Link href={`/announcements/${row.id}`} className="text-sm underline underline-offset-2">
            {t("manage.view")}
          </Link>
          <AnnouncementStateButtons id={row.id} pinned={row.pinned} archived={row.status === "archived"} />
        </div>
      </header>

      {row.status === "archived" ? null : (
        <AnnouncementForm
          choices={choices}
          draft={{ id: row.id, title: row.title, body: row.body, kbPageId: row.kbPageId, pinned: row.pinned, mustAcknowledge: row.mustAcknowledge, expiresAt: toLocalInput(row.expiresAt), publishAt: toLocalInput(row.publishAt), audience: view.audience.map((key) => ({ key, label: audienceLabel(key, names, t) })), published: row.status === "published" }}
        />
      )}

      {report ? (
        <section className="flex max-w-3xl flex-col gap-3">
          <h2 className="text-lg font-semibold">{t("report.title")}</h2>
          <p className="text-sm text-muted-foreground">{row.mustAcknowledge ? t("report.summaryAck", { total: report.total, read: report.read, acknowledged: report.acknowledged }) : t("report.summary", { total: report.total, read: report.read })}</p>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("report.department")}</TableHead>
                <TableHead>{t("report.people")}</TableHead>
                <TableHead>{t("report.read")}</TableHead>
                {row.mustAcknowledge ? <TableHead>{t("report.acknowledged")}</TableHead> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {report.byDepartment.map((line) => (
                <TableRow key={line.departmentName ?? "-"}>
                  <TableCell>{line.departmentName ?? "—"}</TableCell>
                  <TableCell>{line.total}</TableCell>
                  <TableCell>{line.read}</TableCell>
                  {row.mustAcknowledge ? <TableCell>{line.acknowledged}</TableCell> : null}
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("report.person")}</TableHead>
                <TableHead>{t("report.department")}</TableHead>
                <TableHead>{t("report.read")}</TableHead>
                {row.mustAcknowledge ? <TableHead>{t("report.acknowledged")}</TableHead> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {report.people.map((member) => (
                <TableRow key={member.personId}>
                  <TableCell>{member.fullName}</TableCell>
                  <TableCell>{member.departmentName ?? "—"}</TableCell>
                  <TableCell>{when(member.readAt)}</TableCell>
                  {row.mustAcknowledge ? <TableCell>{when(member.acknowledgedAt)}</TableCell> : null}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </section>
      ) : null}
    </div>
  );
}
