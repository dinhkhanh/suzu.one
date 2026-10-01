import { getFormatter, getTranslations } from "next-intl/server";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Table, TableBody, TableCard, TableCardHeader, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { addDays, todayInVietnam } from "@/lib/dates";
import { type BoardRow, getTeamBoard, loadReportReader } from "@/modules/daily/service";
import { RemindButton } from "@/modules/daily/ui/remind-button";
import { requireUser } from "@/modules/platform/auth/session";
import { RichText } from "@/modules/platform/rich-text/ui/rich-text";
import { pageTitle } from "@/i18n/page-title";

export const generateMetadata = pageTitle("teamDailyBoard");

// FR-PJM-22: the lead's board — per team they lead, and for line managers their reports:
// submitted, missing, not required today; blockers first; one tap to remind.
export default async function TeamBoardPage({ searchParams }: PageProps<"/daily/team">) {
  const user = await requireUser();
  const today = todayInVietnam();
  const { date: asked } = await searchParams;
  const date = typeof asked === "string" && /^\d{4}-\d{2}-\d{2}$/.test(asked) && asked <= today ? asked : today;
  const [t, format, reader] = await Promise.all([getTranslations("daily"), getFormatter(), loadReportReader(user.person.id, undefined, user.principal)]);
  const groups = await getTeamBoard(reader, date);
  const isToday = date === today;

  // Oversight reads the rest of the company; reminding stays with the people who run the work.
  const row = (person: BoardRow, remindable: boolean) => (
    <TableRow key={person.personId}>
      <TableCell className="font-medium">
        {person.reportId ? (
          <Link href={`/daily/reports/${person.reportId}`} className="hover:underline">
            {person.name}
          </Link>
        ) : (
          person.name
        )}
      </TableCell>
      <TableCell>{person.status === "submitted" ? <Badge dot variant={person.late ? "warning" : "success"}>{person.late ? t("late") : t("submitted")}</Badge> : person.status === "missing" ? <Badge dot variant="destructive">{t("board.missing")}</Badge> : <Badge variant="secondary">{t(`board.reasons.${person.reason ?? "optional"}`)}</Badge>}</TableCell>
      <TableCell className="min-w-56 whitespace-normal">
        <RichText text={person.blockers} className="text-destructive" />
        {person.openBlockers > 0 ? <p className="text-xs text-destructive">{t("board.openBlockers", { count: person.openBlockers })}</p> : null}
      </TableCell>
      <TableCell kind="number">{person.comments > 0 ? person.comments : ""}</TableCell>
      <TableCell kind="time" className="text-muted-foreground">{person.submittedAt ? format.dateTime(person.submittedAt, { timeStyle: "short" }) : ""}</TableCell>
      <TableCell kind="actions">{person.status === "missing" && isToday && remindable ? <RemindButton date={date} personIds={[person.personId]} label={t("board.remind")} done={person.reminded} /> : null}</TableCell>
    </TableRow>
  );

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1>{t("board.title")}</h1>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Link href={`/daily/team?date=${addDays(date, -1)}`} className={buttonVariants({ size: "sm", variant: "outline" })}>
            {t("board.previous")}
          </Link>
          <span className="font-medium">{format.dateTime(new Date(`${date}T12:00:00Z`), { weekday: "long", day: "numeric", month: "long" })}</span>
          {isToday ? null : (
            <Link href={date >= addDays(today, -1) ? "/daily/team" : `/daily/team?date=${addDays(date, 1)}`} className={buttonVariants({ size: "sm", variant: "outline" })}>
              {t("board.next")}
            </Link>
          )}
        </div>
      </header>

      {groups.length === 0 ? <p className="text-sm text-muted-foreground">{t("board.nobody")}</p> : null}
      {groups.map((group) => {
        const remindable = group.kind !== "company";
        const missing = group.rows.filter((person) => person.status === "missing" && !person.reminded).map((person) => person.personId);
        return (
          <TableCard key={group.kind === "team" ? group.teamId : group.kind}>
            <TableCardHeader title={group.kind === "team" ? group.name : group.kind === "company" ? t("board.everyoneElse") : t("board.myReports")} description={t("board.counts", { submitted: group.counts.submitted, missing: group.counts.missing, notRequired: group.counts.not_required })} actions={isToday && remindable ? <RemindButton date={date} personIds={missing} label={t("board.remindAll", { count: missing.length })} /> : null} />
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead kind="person">{t("board.columns.person")}</TableHead>
                  <TableHead kind="status">{t("board.columns.status")}</TableHead>
                  <TableHead kind="text">{t("board.columns.blockers")}</TableHead>
                  <TableHead kind="number">{t("board.columns.comments")}</TableHead>
                  <TableHead kind="time">{t("board.columns.sentAt")}</TableHead>
                  <TableHead kind="actions" />
                </TableRow>
              </TableHeader>
              <TableBody>{group.rows.map((person) => row(person, remindable))}</TableBody>
            </Table>
          </TableCard>
        );
      })}
    </div>
  );
}
