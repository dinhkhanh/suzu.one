import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { todayInVietnam } from "@/lib/dates";
import { requireUser } from "@/modules/platform/auth/session";
import { getLeaderView, loadViewer } from "@/modules/work/service";
import { NudgeButton } from "@/modules/work/ui/planning-forms";

export const metadata: Metadata = { title: "Leader view" };

// FR-WRK-07: what other people are doing for me — by person, trouble first, with a one-click nudge.
export default async function LeaderPage() {
  const user = await requireUser();
  const viewer = await loadViewer(user);
  const t = await getTranslations("work.leader");
  const tWork = await getTranslations("work");
  const format = await getFormatter();
  const today = todayInVietnam();
  const view = await getLeaderView(viewer, today);

  return (
    <div className="flex max-w-5xl flex-col gap-6">
      <header className="flex flex-col gap-1">
        <p className="text-sm text-muted-foreground">
          <Link href="/work" className="underline">
            {tWork("title")}
          </Link>
        </p>
        <h1>{t("title")}</h1>
        <p className="text-sm text-muted-foreground">{t("description")}</p>
        <p className="flex flex-wrap gap-2 pt-1 text-sm">
          <Badge variant="outline">{t("open", { count: view.totals.open })}</Badge>
          {view.totals.blocked ? <Badge variant="destructive">{t("flagged", { count: view.totals.blocked })}</Badge> : null}
          <Badge variant={view.totals.overdue ? "destructive" : "outline"}>{t("overdue", { count: view.totals.overdue })}</Badge>
          <Badge variant={view.totals.atRisk ? "secondary" : "outline"}>{t("atRisk", { count: view.totals.atRisk })}</Badge>
        </p>
      </header>
      {view.people.length === 0 ? <p className="text-sm text-muted-foreground">{t("empty")}</p> : null}
      {view.people.map((person) => (
        <section key={person.personId ?? "none"} className="flex flex-col gap-2">
          <h2 className="flex flex-wrap items-center gap-2 text-sm font-medium">
            {person.name ?? t("unassigned")}
            <span className="text-xs font-normal text-muted-foreground">{t("counts", person.counts)}</span>
            {person.blocked ? <Badge variant="destructive">{t("flagged", { count: person.blocked })}</Badge> : null}
            {/* FR-PJM-44: on leave under a submitted cover plan. */}
            {person.tasks[0]?.away ? <Badge variant="outline">{person.tasks[0].away.coverName ? tWork("cover.awayCovered", { name: person.tasks[0].away.coverName }) : tWork("cover.away")}</Badge> : null}
            {person.overdue ? <Badge variant="destructive">{t("overdue", { count: person.overdue })}</Badge> : null}
            {person.atRisk ? <Badge variant="secondary">{t("atRisk", { count: person.atRisk })}</Badge> : null}
          </h2>
          <ul className="flex flex-col divide-y rounded-xl border text-sm">
            {person.tasks.map((task) => (
              <li key={task.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
                <div className="min-w-0 flex-1">
                  <Link href={`/work/tasks/${task.id}`} className="font-medium hover:underline">
                    <span className="font-mono text-xs text-muted-foreground">{task.key}</span> {task.title}
                  </Link>
                  <p className="text-xs text-muted-foreground">
                    {[task.blocker ? t("flaggedReason", { reason: task.blocker.neededName ? `${task.blocker.reason} (${tWork("blockers.waitingOn", { name: task.blocker.neededName })})` : task.blocker.reason }) : null, task.projectName, task.stateName, task.dueDate ? t("due", { date: format.dateTime(new Date(`${task.dueDate}T00:00:00`), { dateStyle: "medium" }) }) : null, task.blockedBy ? t("blocked", { count: task.blockedBy }) : null, t(`mine.${task.mine}`)].filter(Boolean).join(" · ")}
                  </p>
                </div>
                {task.risk === "overdue" ? <Badge variant="destructive">{t("risk.overdue")}</Badge> : task.risk === "at_risk" ? <Badge variant="secondary">{t("risk.at_risk")}</Badge> : null}
                {task.assigneePersonId ? <NudgeButton taskId={task.id} /> : null}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
