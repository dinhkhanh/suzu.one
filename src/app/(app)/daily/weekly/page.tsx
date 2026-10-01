import { getFormatter, getTranslations } from "next-intl/server";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { List, ListItem } from "@/components/ui/list";
import { Table, TableBody, TableCard, TableCardHeader, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { addDays, todayInVietnam } from "@/lib/dates";
import { listWeekly, loadReportReader, type ShownPersonWeek, type ShownTeamWeek, weekStartOf } from "@/modules/daily/service";
import { TaskLines } from "@/modules/daily/ui/activity-list";
import { hoursOf } from "@/modules/daily/ui/format";
import { GenerateWeekButton, WeeklySummaryForm } from "@/modules/daily/ui/weekly-forms";
import { requireUser } from "@/modules/platform/auth/session";
import { noteToPlainText } from "@/modules/platform/rich-text/engine/note";
import { RichText } from "@/modules/platform/rich-text/ui/rich-text";
import { canAdminTeam, listTeams, loadViewer, teamFacts } from "@/modules/work/service";
import { pageTitle } from "@/i18n/page-title";

export const generateMetadata = pageTitle("weeklyReports");

// FR-PJM-23: the week of each team the viewer runs and of each person whose reports they read —
// generated on Monday morning for the week before; the lead adds a summary. A team's people and
// their blockers are listed only for a reader who may read their reports, and work on a project or
// task the reader may not open shows as private work with its hours (`listWeekly`).
export default async function WeeklyPage({ searchParams }: PageProps<"/daily/weekly">) {
  const user = await requireUser();
  const today = todayInVietnam();
  const { week: asked, team: focus } = await searchParams;
  const current = weekStartOf(today);
  const weekStart = typeof asked === "string" && /^\d{4}-\d{2}-\d{2}$/.test(asked) && asked <= current ? weekStartOf(asked) : addDays(current, -7);
  const [t, format, reader, viewer, teams] = await Promise.all([getTranslations("daily"), getFormatter(), loadReportReader(user.person.id, undefined, user.principal), loadViewer(user), listTeams()]);
  const runs = (team: Parameters<typeof teamFacts>[0]) => canAdminTeam(viewer, teamFacts(team));
  const { teams: teamWeeks, people } = await listWeekly(reader, weekStart, runs);
  const notGenerated = teams.filter((team) => team.isActive && runs(team) && !teamWeeks.some((row) => row.team.id === team.id));
  const day = (iso: string) => format.dateTime(new Date(`${iso}T12:00:00Z`), { day: "numeric", month: "short" });
  const hoursList = (week: ShownPersonWeek | ShownTeamWeek) =>
    week.hoursByProject.length > 0 ? (
      <ul className="flex flex-col gap-0.5 text-sm">
        {week.hoursByProject.map((group) => (
          <li key={group.projectId ?? group.category ?? "none"} className="flex gap-2">
            <span className="min-w-0 flex-1">{group.hidden ? <span className="text-muted-foreground italic">{t("privateWork")}</span> : (group.name ?? (group.category ? t(`time.categories.${group.category as "admin"}`) : "—"))}</span>
            <span className="tabular-nums">{t("hours", { value: hoursOf(group.minutes) })}</span>
          </li>
        ))}
      </ul>
    ) : null;

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1>{t("weekly.title")}</h1>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Link href={`/daily/weekly?week=${addDays(weekStart, -7)}`} className={buttonVariants({ size: "sm", variant: "outline" })}>
            {t("weekly.previous")}
          </Link>
          <span className="font-medium">{t("weekly.range", { from: day(weekStart), to: day(addDays(weekStart, 6)) })}</span>
          {weekStart < current ? (
            <Link href={`/daily/weekly?week=${addDays(weekStart, 7)}`} className={buttonVariants({ size: "sm", variant: "outline" })}>
              {t("weekly.next")}
            </Link>
          ) : null}
        </div>
      </header>

      {teamWeeks.length === 0 && people.length === 0 && notGenerated.length === 0 ? <p className="text-sm text-muted-foreground">{t("weekly.empty")}</p> : null}

      {teamWeeks.map(({ row, team, content }) => (
        <section key={row.id} id={`team-${team.id}`} className={`flex flex-col gap-3 rounded-xl border p-4 ${focus === team.id ? "border-primary/50" : ""}`}>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="min-w-0 flex-1 font-medium">{team.name}</h2>
            <GenerateWeekButton teamId={team.id} weekStart={weekStart} label={t("weekly.refresh")} />
          </div>
          <p className="text-sm text-muted-foreground">{t("weekly.teamFacts", { done: content.done, slipped: content.slipped, hours: hoursOf(content.totalMinutes), submitted: content.submitted, required: content.required, late: content.late })}</p>
          {content.blockers.length > 0 ? (
            <div className="flex flex-col gap-1 rounded-lg bg-destructive/5 p-3">
              <h3 className="text-sm font-medium text-destructive">{t("weekly.blockers", { count: content.blockers.length })}</h3>
              <ul className="flex flex-col gap-1 text-sm">
                {content.blockers.map((blocker, index) => (
                  <li key={`${blocker.personId}:${blocker.date}:${index}`}>
                    <span className="font-medium">{blocker.name}</span> · {day(blocker.date)} · {noteToPlainText(blocker.text)}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead kind="person">{t("weekly.columns.person")}</TableHead>
                <TableHead kind="number">{t("weekly.columns.done")}</TableHead>
                <TableHead kind="number">{t("weekly.columns.slipped")}</TableHead>
                <TableHead kind="time">{t("weekly.columns.hours")}</TableHead>
                <TableHead kind="number">{t("weekly.columns.reports")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {content.people.map((person) => (
                <TableRow key={person.personId}>
                  <TableCell>
                    <a href={`#person-${person.personId}`} className="font-medium hover:underline">
                      {person.name}
                    </a>
                  </TableCell>
                  <TableCell kind="number">{person.done}</TableCell>
                  <TableCell kind="number">{person.slipped}</TableCell>
                  <TableCell kind="time">{t("hours", { value: hoursOf(person.minutes) })}</TableCell>
                  <TableCell kind="number">
                    {person.submitted}/{person.required}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {hoursList(content)}
          <WeeklySummaryForm id={row.id} summary={row.summary} />
        </section>
      ))}

      {notGenerated.length > 0 ? (
        <TableCard>
          <TableCardHeader title={t("weekly.notGenerated")} count={notGenerated.length} />
          <List>
            {notGenerated.map((team) => (
              <ListItem key={team.id}>
                <span className="min-w-0 flex-1">{team.name}</span>
                <GenerateWeekButton teamId={team.id} weekStart={weekStart} label={t("weekly.generate")} />
              </ListItem>
            ))}
          </List>
        </TableCard>
      ) : null}

      {people.length > 0 ? (
        <TableCard>
          <TableCardHeader title={t("weekly.people", { count: people.length })} />
          <List>
            {people.map(({ row, personId, name, content, canSummarise }) => (
              <ListItem key={row.id} className="block">
                <details id={`person-${personId}`} open={personId === user.person.id}>
                  <summary className="cursor-pointer text-sm font-medium">
                    {personId === user.person.id ? t("weekly.myWeek") : name} <span className="font-normal text-muted-foreground">· {t("weekly.personFacts", { done: content.done.length, slipped: content.slipped.length, hours: hoursOf(content.totalMinutes), submitted: content.submitted, required: content.required })}</span>
                  </summary>
                  <div className="mt-3 flex flex-col gap-3 text-sm">
                    <div>
                      <h3 className="text-xs font-medium text-muted-foreground">{t("weekly.done", { count: content.done.length })}</h3>
                      <TaskLines lines={content.done} empty={t("report.noneDone")} />
                    </div>
                    {content.slipped.length > 0 ? (
                      <div>
                        <h3 className="text-xs font-medium text-muted-foreground">{t("weekly.slipped", { count: content.slipped.length })}</h3>
                        <TaskLines lines={content.slipped} empty={t("report.noneDone")} />
                      </div>
                    ) : null}
                    {content.blockers.length > 0 ? (
                      <div>
                        <h3 className="text-xs font-medium text-destructive">{t("weekly.blockers", { count: content.blockers.length })}</h3>
                        <ul className="flex flex-col gap-0.5">
                          {content.blockers.map((blocker) => (
                            <li key={blocker.date}>
                              {day(blocker.date)} · {noteToPlainText(blocker.text)}
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                    {hoursList(content)}
                    {row.summary && !canSummarise ? <RichText text={row.summary} className="rounded-lg bg-muted p-3" /> : null}
                    {canSummarise ? <WeeklySummaryForm id={row.id} summary={row.summary} /> : null}
                  </div>
                </details>
              </ListItem>
            ))}
          </List>
        </TableCard>
      ) : null}
    </div>
  );
}
