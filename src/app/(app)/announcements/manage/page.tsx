import { getFormatter, getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Page, PageHeader } from "@/components/ui/page";
import { statusTone } from "@/components/ui/tone";
import { Table, TableAddRow, TableBody, TableCard, TableCell, TableEmpty, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { RecordLink } from "@/components/ui/record-link";
import { audienceNames, canPostAnywhere, listManagedAnnouncements } from "@/modules/comms/service";
import { audienceLabel } from "@/modules/comms/ui/labels";
import { requireUser } from "@/modules/platform/auth/session";
import { pageTitle } from "@/i18n/page-title";
import { cn } from "@/lib/utils";

export const generateMetadata = pageTitle("manageAnnouncements");

export default async function ManageAnnouncementsPage() {
  const user = await requireUser();
  if (!canPostAnywhere(user.principal)) notFound();
  const [t, format, rows] = await Promise.all([getTranslations("comms"), getFormatter(), listManagedAnnouncements(user.principal)]);
  const names = await audienceNames(rows.flatMap((row) => row.audience));

  return (
    <Page>
      <PageHeader
        eyebrow={
          <Link href="/announcements" className="hover:underline">
            {t("list.title")}
          </Link>
        }
        title={t("manage.title")}
        description={t("manage.help")}
        actions={
          <Link href="/announcements/manage/new" className={cn(buttonVariants())}>
            {t("manage.new")}
          </Link>
        }
      />
      <TableCard>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead kind="text">{t("form.title")}</TableHead>
              <TableHead kind="status">{t("manage.phase")}</TableHead>
              <TableHead kind="tags">{t("form.audience")}</TableHead>
              <TableHead kind="date">{t("form.publishAt")}</TableHead>
              <TableHead kind="person">{t("manage.author")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? <TableEmpty>{t("manage.empty")}</TableEmpty> : null}
            {rows.map((row) => (
              <TableRow key={row.id}>
                <TableCell>
                  <Link href={`/announcements/manage/${row.id}`} className="font-medium hover:underline">
                    {row.title}
                  </Link>
                  {row.pinned ? <Badge variant="secondary" className="ml-2">{t("list.pinned")}</Badge> : null}
                </TableCell>
                <TableCell>
                  <Badge dot variant={statusTone(row.phase)}>{t(`phase.${row.phase}`)}</Badge>
                </TableCell>
                <TableCell className="max-w-64 truncate">{row.audience.map((key) => audienceLabel(key, names, t)).join(", ")}</TableCell>
                <TableCell>{row.publishAt ? format.dateTime(row.publishAt, { dateStyle: "medium", timeStyle: "short" }) : "—"}</TableCell>
                <TableCell>
                  <RecordLink kind="person" id={row.authorPersonId}>
                    {row.authorName}
                  </RecordLink>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <TableAddRow label={t("manage.new")} href="/announcements/manage/new" />
      </TableCard>
    </Page>
  );
}
