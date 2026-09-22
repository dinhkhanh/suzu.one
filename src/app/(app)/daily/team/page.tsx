import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { addDays, todayInVietnam } from "@/lib/dates";
import { type BoardRow, getTeamBoard, loadReportReader } from "@/modules/daily/service";
import { RemindButton } from "@/modules/daily/ui/remind-button";
import { requireUser } from "@/modules/platform/auth/session";

export const metadata: Metadata = { title: "Team daily board" };

// FR-PJM-22: the lead's board — per team they lead, and for line managers their reports:
// submitted, missing, not required today; blockers first; one tap to remind.
export default async function TeamBoardPage({ searchParams }: PageProps<"/daily/team">) {
  const user = await requireUser();
  const today = todayInVietnam();
  const { date: asked } = await searchParams;
  const date = typeof asked === "string" && /^\d{4}-\d{2}-\d{2}$/.test(asked) && asked <= today ? asked : today;
  const [t, format, reader] = await Promise.all([getTranslations("daily"), getFormatter(), loadReportReader(user.person.id)]);
  const groups = await getTeamBoard(reader, date);
  const isToday = date === today;

  const row = (person: BoardRow) => (
    <li key={person.personId} className="flex flex-col gap-1 p-3">
      <div className="flex flex-wrap items-center gap-2">
        {person.reportId ? (
          <Link href={`/daily/reports/${person.reportId}`} className="min-w-0 flex-1 text-sm font-medium hover:underline">
            {person.name}
          </Link>
        ) : (
          <span className="min-w-0 flex-1 text-sm font-medium">{person.name}</span>
        )}
        {person.status === "submitted" ? <Badge variant={person.late ? "warning" : "success"}>{person.late ? t("late") : t("submitted")}</Badge> : person.status === "missing" ? <Badge variant="destructive">{t("board.missing")}</Badge> : <Badge variant="secondary">{t(`board.reasons.${person.reason ?? "optional"}`)}</Badge>}
        {person.comments > 0 ? <span className="text-xs text-muted-foreground">{t("board.comments", { count: person.comments })}</span> : null}
        {person.status === "missing" && isToday ? <RemindButton date={date} personIds={[person.personId]} label={t("board.remind")} done={person.reminded} /> : null}
      </div>
      {person.blockers?.trim() ? <p className="text-sm whitespace-pre-wrap text-destructive">{person.blockers}</p> : null}
      {person.openBlockers > 0 ? <p className="text-xs text-destructive">{t("board.openBlockers", { count: person.openBlockers })}</p> : null}
      {person.submittedAt ? <p className="text-xs text-muted-foreground">{t("view.sentAt", { time: format.dateTime(person.submittedAt, { timeStyle: "short" }) })}</p> : null}
    </li>
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
        const missing = group.rows.filter((person) => person.status === "missing" && !person.reminded).map((person) => person.personId);
        return (
          <section key={group.kind === "team" ? group.teamId : "reports"} className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="min-w-0 flex-1 text-sm font-medium">{group.kind === "team" ? group.name : t("board.myReports")}</h2>
              <span className="text-xs text-muted-foreground">{t("board.counts", { submitted: group.counts.submitted, missing: group.counts.missing, notRequired: group.counts.not_required })}</span>
              {isToday ? <RemindButton date={date} personIds={missing} label={t("board.remindAll", { count: missing.length })} /> : null}
            </div>
            <ul className="flex flex-col divide-y rounded-xl border">{group.rows.map(row)}</ul>
          </section>
        );
      })}
    </div>
  );
}
