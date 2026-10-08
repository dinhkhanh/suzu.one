import { getFormatter, getTranslations } from "next-intl/server";
import { Badge } from "@/components/ui/badge";
import { Page, PageHeader } from "@/components/ui/page";
import { Table, TableBody, TableCard, TableCardHeader, TableCell, TableEmpty, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { RecordLink } from "@/components/ui/record-link";
import { requireUser } from "@/modules/platform/auth/session";
import { listMyInterviews } from "@/modules/recruit/interviews";
import { pageTitle } from "@/i18n/page-title";

export const generateMetadata = pageTitle("interviews");

/**
 * My interviews (FR-REC-06). For an interviewer who is on no hiring team this is the whole of
 * their access to recruitment: the conversations they are in, and the cards they still owe. It
 * needs no permission at all — the list is keyed on being in the room.
 */
export default async function MyInterviewsPage() {
  const user = await requireUser();
  const t = await getTranslations("recruit.interview");
  const tRecruit = await getTranslations("recruit");
  const format = await getFormatter();
  const rows = await listMyInterviews(user.person.id);
  // "Still ahead" is decided by the database's clock (`MyInterviewRow.upcoming`): a server
  // component may not read the wall clock, and a page that did would be a page that re-renders
  // into a different answer.
  const upcoming = rows.filter((row) => row.upcoming).sort((a, b) => a.startAt.getTime() - b.startAt.getTime());
  const past = rows.filter((row) => !row.upcoming);

  const list = (title: string, items: typeof rows, empty?: string) => (
    <TableCard>
      <TableCardHeader title={title} count={items.length || null} />
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead kind="text">{t("title")}</TableHead>
            <TableHead kind="person">{tRecruit("columns.candidate")}</TableHead>
            <TableHead kind="text">{tRecruit("reports.opening")}</TableHead>
            <TableHead kind="select">{t("mode")}</TableHead>
            <TableHead kind="place">{t("location")}</TableHead>
            <TableHead kind="date">{t("when")}</TableHead>
            <TableHead kind="status">{tRecruit("columns.status")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.length === 0 && empty ? <TableEmpty>{empty}</TableEmpty> : null}
          {items.map((row) => (
            <TableRow key={row.id}>
              <TableCell className="max-w-64 truncate">
                <RecordLink kind="interview" id={row.id} className="font-medium">
                  {row.title}
                </RecordLink>
              </TableCell>
              <TableCell>{row.candidateName}</TableCell>
              <TableCell className="max-w-56 truncate">{row.openingTitle}</TableCell>
              <TableCell>
                <Badge variant="outline">{t(`modes.${row.mode}`)}</Badge>
              </TableCell>
              <TableCell className="max-w-48 truncate">{row.location || "—"}</TableCell>
              <TableCell className="font-mono text-[0.8125rem] tabular-nums">{format.dateTime(row.startAt, { dateStyle: "medium", timeStyle: "short" })}</TableCell>
              <TableCell>
                {row.status === "scheduled" ? <Badge variant={row.scorecardSubmitted ? "outline" : "secondary"}>{row.scorecardSubmitted ? t("cardIn") : t("cardDue")}</Badge> : <Badge variant="outline">{t(`statuses.${row.status}`)}</Badge>}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableCard>
  );

  return (
    <Page>
      <PageHeader title={t("mine")} description={t("mineDescription")} />

      {list(t("upcoming"), upcoming, t("noneUpcoming"))}

      {past.length > 0 ? list(t("past"), past) : null}
    </Page>
  );
}
