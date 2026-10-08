import { getFormatter, getTranslations } from "next-intl/server";
import Link from "next/link";
import { Page, PageHeader } from "@/components/ui/page";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCard, TableCardHeader, TableCell, TableEmpty, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { RecordLink } from "@/components/ui/record-link";
import { kbViewerOf, listMyAcknowledgements, listMyPendingAcks } from "@/modules/kb/service";
import { requireUser } from "@/modules/platform/auth/session";
import { pageTitle } from "@/i18n/page-title";

export const generateMetadata = pageTitle("myAcknowledgements");

export default async function MyAcknowledgementsPage() {
  const user = await requireUser();
  const t = await getTranslations("kb");
  const format = await getFormatter();
  const [pending, done] = await Promise.all([listMyPendingAcks(kbViewerOf(user)), listMyAcknowledgements(user.person.id)]);
  const day = (iso: string) => format.dateTime(new Date(`${iso}T00:00:00`), { dateStyle: "medium" });

  return (
    <Page>
      <PageHeader
        eyebrow={
          <Link href="/kb" className="hover:underline">
            {t("title")}
          </Link>
        }
        title={t("ack.mineTitle")}
        description={t("ack.mineHelp")}
      />

      <TableCard>
        <TableCardHeader title={t("ack.pending", { count: pending.length })} />
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead kind="text">{t("review.page")}</TableHead>
              <TableHead kind="select">{t("fields.spaceName")}</TableHead>
              <TableHead kind="status">{t("ack.status")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {pending.length === 0 ? <TableEmpty>{t("ack.nothingPending")}</TableEmpty> : null}
            {pending.map((row) => (
              <TableRow key={row.pageId}>
                <TableCell className="max-w-80 truncate">
                  <RecordLink kind="kbPage" id={row.pageId} className="font-medium">
                    {row.title}
                  </RecordLink>
                </TableCell>
                <TableCell className="text-muted-foreground">
                  <RecordLink kind="kbSpace" id={row.spaceKey}>
                    {row.spaceName}
                  </RecordLink>
                </TableCell>
                <TableCell>
                  <Badge dot variant={row.overdue ? "destructive" : "outline"}>
                    {row.overdue ? t("ack.overdueSince", { date: day(row.dueOn) }) : t("ack.dueOn", { date: day(row.dueOn) })}
                  </Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableCard>

      <TableCard>
        <TableCardHeader title={t("ack.doneTitle")} count={done.length || null} />
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead kind="text">{t("review.page")}</TableHead>
              <TableHead kind="id">{t("ack.version")}</TableHead>
              <TableHead kind="date">{t("ack.confirmedAt")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {done.length === 0 ? <TableEmpty>{t("ack.nothingDone")}</TableEmpty> : null}
            {done.map((row) => (
              <TableRow key={`${row.pageId}-${row.versionNo}`}>
                <TableCell>
                  <RecordLink kind="kbPage" id={row.pageId}>
                    {row.title}
                  </RecordLink>
                </TableCell>
                <TableCell>
                  v{row.versionNo} {row.current ? null : <span className="text-xs text-muted-foreground">· {t("ack.superseded")}</span>}
                </TableCell>
                <TableCell>{format.dateTime(row.acknowledgedAt, { dateStyle: "medium", timeStyle: "short" })}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableCard>
    </Page>
  );
}
