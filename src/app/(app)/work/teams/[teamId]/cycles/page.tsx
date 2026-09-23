import { getFormatter, getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
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
    <div className="flex max-w-4xl flex-col gap-8">
      <header className="flex flex-col gap-1">
        <p className="text-sm text-muted-foreground">
          <Link href="/work" className="underline">
            {t("title")}
          </Link>
          {" / "}
          <Link href={`/work/teams/${team.id}`} className="underline">
            {team.name}
          </Link>
        </p>
        <h1>{t("cycles.title")}</h1>
        <p className="text-sm text-muted-foreground">{t("cycles.description")}</p>
      </header>

      {page.current ? (
        <section className="flex flex-col gap-3 rounded-xl border p-4">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-medium">{t("cycles.current", { number: page.current.number })}</h2>
            <span className="text-sm text-muted-foreground">{range(page.current)}</span>
            {page.current.rolledIn ? <Badge variant="secondary">{t("cycles.rolledIn", { count: page.current.rolledIn })}</Badge> : null}
          </div>
          <div className="flex items-center gap-3">
            <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={page.current.progress.percent}>
              <div className="h-full bg-primary" style={{ width: `${page.current.progress.percent}%` }} />
            </div>
            <span className="text-sm tabular-nums">{t("cycles.progress", { done: page.current.progress.done, planned: page.current.progress.planned, percent: page.current.progress.percent })}</span>
          </div>
          <ul className="flex flex-col divide-y rounded-lg border text-sm">
            {tasks.map((task) => (
              <li key={task.id} className="flex flex-wrap items-center gap-2 p-2.5">
                <span className="w-16 font-mono text-xs text-muted-foreground">{task.key}</span>
                <Link href={`/work/tasks/${task.id}`} className={`min-w-0 flex-1 truncate hover:underline ${task.status === "done" || task.status === "cancelled" ? "text-muted-foreground line-through" : "font-medium"}`}>
                  {task.title}
                </Link>
                <span className="text-xs text-muted-foreground">{task.assigneeName ?? t("list.unassigned")}</span>
              </li>
            ))}
            {tasks.length === 0 ? <li className="p-2.5 text-muted-foreground">{t("cycles.empty")}</li> : null}
          </ul>
        </section>
      ) : (
        <p className="text-sm text-muted-foreground">{t("cycles.none")}</p>
      )}

      {page.upcoming ? (
        <p className="text-sm">
          {t("cycles.next", { number: page.upcoming.number, range: range(page.upcoming), count: page.upcoming.planned })}
        </p>
      ) : null}

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium text-muted-foreground">{t("cycles.past")}</h2>
        {page.past.length === 0 ? <p className="text-sm text-muted-foreground">{t("cycles.noPast")}</p> : null}
        <ul className="flex flex-col divide-y rounded-xl border text-sm empty:hidden">
          {page.past.map((cycle) => (
            <li key={cycle.id} className="flex flex-wrap items-center gap-3 p-3">
              <span className="font-medium">#{cycle.number}</span>
              <span className="text-muted-foreground">{range(cycle)}</span>
              {cycle.summary ? (
                <span className="ml-auto flex flex-wrap gap-2 text-xs">
                  <Badge variant="outline">{t("cycles.planned", { count: cycle.summary.planned })}</Badge>
                  <Badge>{t("cycles.done", { count: cycle.summary.done })}</Badge>
                  {cycle.summary.rolled ? <Badge variant="secondary">{t("cycles.rolled", { count: cycle.summary.rolled })}</Badge> : null}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
