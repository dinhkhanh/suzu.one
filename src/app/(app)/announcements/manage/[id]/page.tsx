import { getFormatter, getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Page, PageHeader, Section } from "@/components/ui/page";
import { statusTone } from "@/components/ui/tone";
import { Table, TableBody, TableCard, TableCardHeader, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { RecordLink } from "@/components/ui/record-link";
import { audienceNames, audienceOptionsFor, commsViewerOf, getAnnouncementView, getReadReport } from "@/modules/comms/service";
import { AnnouncementForm } from "@/modules/comms/ui/announcement-form";
import { AnnouncementStateButtons } from "@/modules/comms/ui/buttons";
import { audienceLabel, toLocalInput } from "@/modules/comms/ui/labels";
import { requireUser } from "@/modules/platform/auth/session";
import { pageTitle } from "@/i18n/page-title";
import { cn } from "@/lib/utils";

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
    <Page>
      <PageHeader
        eyebrow={
          <Link href="/announcements/manage" className="hover:underline">
            {t("manage.title")}
          </Link>
        }
        title={row.title}
        actions={
          <>
            <Link href={`/announcements/${row.id}`} className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
              {t("manage.view")}
            </Link>
            <AnnouncementStateButtons id={row.id} pinned={row.pinned} archived={row.status === "archived"} />
          </>
        }
      >
        <div className="pt-1">
          <Badge dot variant={statusTone(view.phase)}>
            {t(`phase.${view.phase}`)}
          </Badge>
        </div>
      </PageHeader>

      {row.status === "archived" ? null : (
        <AnnouncementForm
          choices={choices}
          draft={{
            id: row.id,
            title: row.title,
            body: row.body,
            kbPageId: row.kbPageId,
            pinned: row.pinned,
            mustAcknowledge: row.mustAcknowledge,
            expiresAt: toLocalInput(row.expiresAt),
            publishAt: toLocalInput(row.publishAt),
            audience: view.audience.map((key) => ({ key, label: audienceLabel(key, names, t) })),
            published: row.status === "published",
          }}
        />
      )}

      {report ? (
        <Section title={t("report.title")} className="max-w-3xl">
          <TableCard>
            <TableCardHeader
              title={t("report.title")}
              description={row.mustAcknowledge ? t("report.summaryAck", { total: report.total, read: report.read, acknowledged: report.acknowledged }) : t("report.summary", { total: report.total, read: report.read })}
            />
            <Table numbered={false}>
              <TableHeader>
                <TableRow>
                  <TableHead kind="org">{t("report.department")}</TableHead>
                  <TableHead kind="number">{t("report.people")}</TableHead>
                  <TableHead kind="number">{t("report.read")}</TableHead>
                  {row.mustAcknowledge ? <TableHead kind="number">{t("report.acknowledged")}</TableHead> : null}
                </TableRow>
              </TableHeader>
              <TableBody>
                {report.byDepartment.map((line) => (
                  <TableRow key={line.departmentName ?? "-"}>
                    <TableCell>
                      {line.departmentName ? (
                        <RecordLink kind="unit" id={line.departmentId}>
                          {line.departmentName}
                        </RecordLink>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                    <TableCell kind="number">{line.total}</TableCell>
                    <TableCell kind="number">{line.read}</TableCell>
                    {row.mustAcknowledge ? <TableCell kind="number">{line.acknowledged}</TableCell> : null}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableCard>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead kind="person">{t("report.person")}</TableHead>
                <TableHead kind="org">{t("report.department")}</TableHead>
                <TableHead kind="date">{t("report.read")}</TableHead>
                {row.mustAcknowledge ? <TableHead kind="date">{t("report.acknowledged")}</TableHead> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {report.people.map((member) => (
                <TableRow key={member.personId}>
                  <TableCell>
                    <RecordLink kind="person" id={member.personId}>
                      {member.fullName}
                    </RecordLink>
                  </TableCell>
                  <TableCell>
                    {member.departmentName ? (
                      <RecordLink kind="unit" id={member.departmentId}>
                        {member.departmentName}
                      </RecordLink>
                    ) : (
                      "—"
                    )}
                  </TableCell>
                  <TableCell>{when(member.readAt)}</TableCell>
                  {row.mustAcknowledge ? <TableCell>{when(member.acknowledgedAt)}</TableCell> : null}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Section>
      ) : null}
    </Page>
  );
}
