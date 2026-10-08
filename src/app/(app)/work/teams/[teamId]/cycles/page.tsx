import { getFormatter, getTranslations } from "next-intl/server";
import Link from "next/link";
import { Page, PageHeader } from "@/components/ui/page";
import { RecordLink } from "@/components/ui/record-link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCard, TableCardHeader, TableCell, TableEmpty, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { todayInVietnam } from "@/lib/dates";
import { requireUser } from "@/modules/platform/auth/session";
import { canViewTask, canViewTeam, findTeam, getCyclePage, loadTasks, loadViewer, teamFacts } from "@/modules/work/service";
import { pageTitle } from "@/i18n/page-title";

export const generateMetadata = pageTitle("cycles");

// FR-PJM-10: the team's running cycle — planned against done, what rolled in from the last one —
// the next cycle's size, and the reviews of past cycles. Cycles are switched on and sized in the
// team's day rules; the midnight job makes and closes them.
export default async function TeamCyclesPage({ params }: PageProps<"/work/teams/[teamId]/cycles">) {
  const user = await requireUser();
  const { teamId } = await params;
  const [team, viewer, t, format] = await Promise.all([/^[0-9a-f-]{36}$/.test(teamId) ? findTeam(teamId) : undefined, loadViewer(user), getTranslations("work"), getFormatter()]);
  if (!team || !canViewTeam(viewer, teamFacts(team))) notFound();
  const today = todayInVietnam();
  const page = await getCyclePage(team.id, today, (items) => items);
  // Counts are the team's; the list shows only the tasks this viewer may open.
  const loaded = await loadTasks(page.current?.tasks.map((task) => task.id) ?? []);
  const tasks = (page.current?.tasks ?? []).filter((task) => {
    const row = loaded.get(task.id);
    return !!row && canViewTask(viewer, row.facts);
  });
  const day = (value: string) => format.dateTime(new Date(`${value}T00:00:00`), { day: "numeric", month: "numeric" });
  const range = (cycle: { startDate: string; endDate: string }) => `${day(cycle.startDate)} – ${day(cycle.endDate)}`;

  return (
    <Page width="default">
      <PageHeader
        eyebrow={
          <span className="flex flex-wrap items-center gap-x-1.5">
            <Link href="/work" className="hover:underline">
              {t("title")}
            </Link>
            <span className="text-faint">/</span>
            <RecordLink kind="team" id={team.id}>
              {team.name}
            </RecordLink>
          </span>
        }
        title={t("cycles.title")}
        description={t("cycles.description")}
      />

      {page.current ? (
        <TableCard>
          <TableCardHeader
            title={t("cycles.current", { number: page.current.number })}
            description={range(page.current)}
            actions={page.current.rolledIn ? <Badge variant="secondary">{t("cycles.rolledIn", { count: page.current.rolledIn })}</Badge> : null}
          />
          <div className="flex items-center gap-3 border-b px-4 py-3">
            <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={page.current.progress.percent}>
              <div className="h-full bg-primary" style={{ width: `${page.current.progress.percent}%` }} />
            </div>
            <span className="text-sm tabular-nums">{t("cycles.progress", { done: page.current.progress.done, planned: page.current.progress.planned, percent: page.current.progress.percent })}</span>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead kind="id">{t("table.key")}</TableHead>
                <TableHead kind="text">{t("table.title")}</TableHead>
                <TableHead kind="person">{t("table.assignee")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tasks.map((task) => (
                <TableRow key={task.id}>
                  <TableCell kind="id">{task.key}</TableCell>
                  <TableCell className="max-w-96">
                    <RecordLink kind="task" id={task.id} className={`block truncate ${task.status === "done" || task.status === "cancelled" ? "text-muted-foreground line-through" : "font-medium"}`}>
                      {task.title}
                    </RecordLink>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {task.assigneeName ? (
                      <RecordLink kind="person" id={task.assigneePersonId}>
                        {task.assigneeName}
                      </RecordLink>
                    ) : (
                      t("list.unassigned")
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {tasks.length === 0 ? <TableEmpty>{t("cycles.empty")}</TableEmpty> : null}
            </TableBody>
          </Table>
          {page.current.taskTotal > page.current.tasks.length ? <p className="border-t px-4 py-3 text-sm text-muted-foreground">{t("cycles.truncated", { shown: page.current.tasks.length, total: page.current.taskTotal })}</p> : null}
        </TableCard>
      ) : (
        <p className="text-sm text-muted-foreground">{t("cycles.none")}</p>
      )}

      {page.upcoming ? <p className="text-sm">{t("cycles.next", { number: page.upcoming.number, range: range(page.upcoming), count: page.upcoming.planned })}</p> : null}

      <TableCard>
        <TableCardHeader title={t("cycles.past")} count={page.past.length || null} />
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead kind="id">{t("cycles.field")}</TableHead>
              <TableHead kind="date">{t("cycles.columns.dates")}</TableHead>
              <TableHead kind="number">{t("cycles.columns.planned")}</TableHead>
              <TableHead kind="number">{t("cycles.columns.done")}</TableHead>
              <TableHead kind="number">{t("cycles.columns.rolled")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {page.past.length === 0 ? <TableEmpty>{t("cycles.noPast")}</TableEmpty> : null}
            {page.past.map((cycle) => (
              <TableRow key={cycle.id}>
                <TableCell className="font-medium">#{cycle.number}</TableCell>
                <TableCell className="text-muted-foreground">{range(cycle)}</TableCell>
                <TableCell kind="number">{cycle.summary ? cycle.summary.planned : "—"}</TableCell>
                <TableCell kind="number">{cycle.summary ? cycle.summary.done : "—"}</TableCell>
                <TableCell kind="number">{cycle.summary ? cycle.summary.rolled : "—"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableCard>
    </Page>
  );
}
