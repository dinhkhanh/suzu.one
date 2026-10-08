import { getFormatter, getTranslations } from "next-intl/server";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableEmpty, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { statusTone } from "@/components/ui/tone";
import { RecordLink } from "@/components/ui/record-link";
import { requireUser } from "@/modules/platform/auth/session";
import { listOffers } from "@/modules/recruit/offers";
import { canRunRecruitment } from "@/modules/recruit/policy";
import { notFound } from "next/navigation";
import { pageTitle } from "@/i18n/page-title";

export const generateMetadata = pageTitle("offers");

// Every offer the reader may see. Deliberately without a figure: a list is glanced at across a
// desk, and `listOffers` does not carry one for anybody. The amount is on the offer's own page,
// for the two roles that may read it.
export default async function OffersPage() {
  const user = await requireUser();
  // The rows are filtered one by one inside the service; this is only the door.
  if (!canRunRecruitment(user.principal)) notFound();

  const t = await getTranslations("recruit.offer");
  const tRecruit = await getTranslations("recruit");
  const format = await getFormatter();
  const rows = await listOffers(user.principal, user.person.id);

  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <header>
        <h1>{t("title")}</h1>
        <p className="text-sm text-muted-foreground">{t("description")}</p>
      </header>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead kind="text">{tRecruit("columns.candidate")}</TableHead>
            <TableHead kind="text">{t("positionName")}</TableHead>
            <TableHead kind="id">{tRecruit("reports.opening")}</TableHead>
            <TableHead kind="id">{t("heading")}</TableHead>
            <TableHead kind="date">{t("startDate")}</TableHead>
            <TableHead kind="status">{tRecruit("columns.status")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 ? <TableEmpty>{t("none")}</TableEmpty> : null}
          {rows.map((row) => (
            <TableRow key={row.id}>
              <TableCell className="max-w-64 truncate">
                <RecordLink kind="offer" id={row.id} className="font-medium">
                  {row.candidateName}
                </RecordLink>
              </TableCell>
              <TableCell className="max-w-56 truncate">{row.positionName}</TableCell>
              <TableCell kind="id">
                <RecordLink kind="opening" id={row.openingId}>
                  {row.openingCode}
                </RecordLink>
              </TableCell>
              <TableCell kind="id">{row.number}</TableCell>
              <TableCell>{format.dateTime(new Date(`${row.startDate}T00:00:00Z`), { dateStyle: "medium", timeZone: "UTC" })}</TableCell>
              <TableCell>
                <span className="flex items-center gap-1.5">
                  <Badge dot variant={statusTone(row.status)}>
                    {t(`statuses.${row.status}`)}
                  </Badge>
                  {row.hiredPersonId ? <Badge variant="outline">{t("statuses.converted")}</Badge> : null}
                </span>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
