import { ChevronLeft, ChevronRight } from "lucide-react";
import { getFormatter, getTranslations } from "next-intl/server";
import Link from "next/link";
import type { CSSProperties } from "react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { List, ListEmpty, ListItem } from "@/components/ui/list";
import { Page, PageHeader, Section } from "@/components/ui/page";
import { addDays, todayInVietnam } from "@/lib/dates";
import { initialsOf } from "@/lib/text";
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
  const row = (person: BoardRow, index: number, remindable: boolean) => {
    const meta = [person.submittedAt ? format.dateTime(person.submittedAt, { timeStyle: "short" }) : null, person.comments > 0 ? t("board.comments", { count: person.comments }) : null, person.openBlockers > 0 ? t("board.openBlockers", { count: person.openBlockers }) : null].filter(Boolean).join(" · ");
    return (
      <ListItem key={person.personId} className="rise flex-col items-stretch gap-1.5" style={{ "--i": index } as CSSProperties}>
        <div className="flex items-center gap-3">
          <Avatar size="sm">
            <AvatarFallback className="text-[0.625rem] font-semibold">{initialsOf(person.name)}</AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1">
            {person.reportId ? (
              <Link href={`/daily/reports/${person.reportId}`} className="block truncate text-sm font-medium hover:underline">
                {person.name}
              </Link>
            ) : (
              <span className="block truncate text-sm font-medium">{person.name}</span>
            )}
            {meta ? <span className={person.openBlockers > 0 ? "block truncate text-xs text-destructive" : "block truncate text-xs text-muted-foreground"}>{meta}</span> : null}
          </div>
          {person.status === "submitted" ? <Badge dot variant={person.late ? "warning" : "success"}>{person.late ? t("late") : t("submitted")}</Badge> : person.status === "missing" ? <Badge dot variant="destructive">{t("board.missing")}</Badge> : <Badge variant="secondary">{t(`board.reasons.${person.reason ?? "optional"}`)}</Badge>}
          {person.status === "missing" && isToday && remindable ? <RemindButton date={date} personIds={[person.personId]} label={t("board.remind")} done={person.reminded} /> : null}
        </div>
        {person.blockers?.trim() ? <RichText text={person.blockers} className="pl-9 text-sm text-destructive" /> : null}
      </ListItem>
    );
  };

  return (
    <Page width="narrow">
      <PageHeader
        eyebrow={format.dateTime(new Date(`${date}T12:00:00Z`), { weekday: "long", day: "numeric", month: "long" })}
        title={t("board.title")}
        actions={
          <>
            <Link href={`/daily/team?date=${addDays(date, -1)}`} className={buttonVariants({ size: "sm", variant: "outline" })}>
              <ChevronLeft aria-hidden /> {t("board.previous")}
            </Link>
            {isToday ? null : (
              <Link href={date >= addDays(today, -1) ? "/daily/team" : `/daily/team?date=${addDays(date, 1)}`} className={buttonVariants({ size: "sm", variant: "outline" })}>
                {t("board.next")} <ChevronRight aria-hidden />
              </Link>
            )}
            {isToday ? null : (
              <Link href="/daily/team" className={buttonVariants({ size: "sm", variant: "ghost" })}>
                {t("today.title")}
              </Link>
            )}
          </>
        }
      />

      {groups.length === 0 ? (
        <List>
          <ListEmpty>{t("board.nobody")}</ListEmpty>
        </List>
      ) : null}
      {groups.map((group) => {
        const remindable = group.kind !== "company";
        const missing = group.rows.filter((person) => person.status === "missing" && !person.reminded).map((person) => person.personId);
        return (
          <Section key={group.kind === "team" ? group.teamId : group.kind} title={group.kind === "team" ? group.name : group.kind === "company" ? t("board.everyoneElse") : t("board.myReports")} count={group.rows.length} action={isToday && remindable ? <RemindButton date={date} personIds={missing} label={t("board.remindAll", { count: missing.length })} /> : null}>
            <p className="px-0.5 text-xs text-muted-foreground">{t("board.counts", { submitted: group.counts.submitted, missing: group.counts.missing, notRequired: group.counts.not_required })}</p>
            <List>{group.rows.map((person, index) => row(person, index, remindable))}</List>
          </Section>
        );
      })}
    </Page>
  );
}
