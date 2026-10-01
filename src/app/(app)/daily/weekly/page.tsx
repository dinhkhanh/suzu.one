import { ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { getFormatter, getTranslations } from "next-intl/server";
import Link from "next/link";
import type { CSSProperties } from "react";
import { Alert } from "@/components/ui/alert";
import { buttonVariants } from "@/components/ui/button";
import { List, ListEmpty, ListItem } from "@/components/ui/list";
import { Page, PageHeader, Section } from "@/components/ui/page";
import { Table, TableBody, TableCard, TableCardHeader, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { addDays, todayInVietnam } from "@/lib/dates";
import { cn } from "@/lib/utils";
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
      <Table numbered={false}>
        <TableHeader>
          <TableRow>
            <TableHead kind="text">{t("weekly.columns.person")}</TableHead>
            <TableHead kind="time">{t("weekly.columns.hours")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {week.hoursByProject.map((group) => (
            <TableRow key={group.projectId ?? group.category ?? "none"}>
              <TableCell className="whitespace-normal">{group.hidden ? <span className="text-muted-foreground italic">{t("privateWork")}</span> : (group.name ?? (group.category ? t(`time.categories.${group.category as "admin"}`) : "—"))}</TableCell>
              <TableCell kind="time">{t("hours", { value: hoursOf(group.minutes) })}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    ) : null;
  const blockersAlert = (blockers: { name?: string; date: string; text: string }[]) =>
    blockers.length > 0 ? (
      <Alert variant="destructive">
        <div className="flex min-w-0 flex-col gap-1">
          <p className="font-medium">{t("weekly.blockers", { count: blockers.length })}</p>
          <ul className="flex flex-col gap-1 text-sm">
            {blockers.map((blocker, index) => (
              <li key={`${blocker.name ?? ""}:${blocker.date}:${index}`}>{[blocker.name, day(blocker.date), noteToPlainText(blocker.text)].filter(Boolean).join(" · ")}</li>
            ))}
          </ul>
        </div>
      </Alert>
    ) : null;

  return (
    <Page width="default">
      <PageHeader
        eyebrow={t("weekly.range", { from: day(weekStart), to: day(addDays(weekStart, 6)) })}
        title={t("weekly.title")}
        actions={
          <>
            <Link href={`/daily/weekly?week=${addDays(weekStart, -7)}`} className={buttonVariants({ size: "sm", variant: "outline" })}>
              <ChevronLeft aria-hidden /> {t("weekly.previous")}
            </Link>
            {weekStart < current ? (
              <Link href={`/daily/weekly?week=${addDays(weekStart, 7)}`} className={buttonVariants({ size: "sm", variant: "outline" })}>
                {t("weekly.next")} <ChevronRight aria-hidden />
              </Link>
            ) : null}
          </>
        }
      />

      {teamWeeks.length === 0 && people.length === 0 && notGenerated.length === 0 ? (
        <List>
          <ListEmpty>{t("weekly.empty")}</ListEmpty>
        </List>
      ) : null}

      {teamWeeks.map(({ row, team, content }) => (
        <Section key={row.id} id={`team-${team.id}`} title={team.name} action={<GenerateWeekButton teamId={team.id} weekStart={weekStart} label={t("weekly.refresh")} />} className={cn(focus === team.id && "rounded-[14px] ring-2 ring-primary/30 ring-offset-4 ring-offset-background")}>
          <p className="px-0.5 text-sm text-muted-foreground">{t("weekly.teamFacts", { done: content.done, slipped: content.slipped, hours: hoursOf(content.totalMinutes), submitted: content.submitted, required: content.required, late: content.late })}</p>
          {blockersAlert(content.blockers)}
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
        </Section>
      ))}

      {notGenerated.length > 0 ? (
        <Section title={t("weekly.notGenerated")} count={notGenerated.length}>
          <List>
            {notGenerated.map((team, index) => (
              <ListItem key={team.id} className="rise" style={{ "--i": index } as CSSProperties}>
                <span className="min-w-0 flex-1 font-medium">{team.name}</span>
                <GenerateWeekButton teamId={team.id} weekStart={weekStart} label={t("weekly.generate")} />
              </ListItem>
            ))}
          </List>
        </Section>
      ) : null}

      {people.length > 0 ? (
        <Section title={t("weekly.people", { count: people.length })}>
          <TableCard>
            <TableCardHeader title={t("weekly.people", { count: people.length })} className="sr-only" />
            <List>
              {people.map(({ row, personId, name, content, canSummarise }, index) => (
                <ListItem key={row.id} className="rise block p-0 md:p-0" style={{ "--i": index } as CSSProperties}>
                  <details id={`person-${personId}`} open={personId === user.person.id} className="group/week">
                    <summary className="flex min-h-[3.25rem] cursor-pointer list-none items-center gap-3 px-4 py-2.5 select-none hover:bg-canvas md:min-h-12 md:px-3.5 [&::-webkit-details-marker]:hidden">
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{personId === user.person.id ? t("weekly.myWeek") : name}</span>
                        <span className="block truncate text-xs text-muted-foreground">{t("weekly.personFacts", { done: content.done.length, slipped: content.slipped.length, hours: hoursOf(content.totalMinutes), submitted: content.submitted, required: content.required })}</span>
                      </span>
                      <ChevronDown aria-hidden className="size-4 shrink-0 text-faint transition-transform duration-200 ease-(--ease-settle) group-open/week:rotate-180" />
                    </summary>
                    <div className="flex flex-col gap-4 border-t bg-canvas px-4 py-3 text-sm md:px-3.5">
                      <div className="flex flex-col gap-1">
                        <h3 className="section-label">{t("weekly.done", { count: content.done.length })}</h3>
                        <TaskLines lines={content.done} empty={t("report.noneDone")} />
                      </div>
                      {content.slipped.length > 0 ? (
                        <div className="flex flex-col gap-1">
                          <h3 className="section-label">{t("weekly.slipped", { count: content.slipped.length })}</h3>
                          <TaskLines lines={content.slipped} empty={t("report.noneDone")} />
                        </div>
                      ) : null}
                      {blockersAlert(content.blockers)}
                      {hoursList(content)}
                      {row.summary && !canSummarise ? <RichText text={row.summary} className="rounded-[0.625rem] bg-muted p-3" /> : null}
                      {canSummarise ? <WeeklySummaryForm id={row.id} summary={row.summary} /> : null}
                    </div>
                  </details>
                </ListItem>
              ))}
            </List>
          </TableCard>
        </Section>
      ) : null}
    </Page>
  );
}
