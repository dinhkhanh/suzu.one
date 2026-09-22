import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { addDays, todayInVietnam } from "@/lib/dates";
import { requireUser } from "@/modules/platform/auth/session";
import { canManageHandoffPackages, canViewTeam, findTeam, handoffStatsByStage, listPackages, listStates, loadViewer, teamFacts } from "@/modules/work/service";
import { HandoffPackageManager } from "@/modules/work/ui/handoff-packages";

export const metadata: Metadata = { title: "Hand-offs" };

/** How far back the stage statistics look. */
const STATS_DAYS = 90;

// FR-PJM-40, 41: the packages the team's transitions require, and how its hand-offs go — how many
// came back per stage and how long receivers take to answer. The team's leads keep the packages;
// anyone who may see the team reads them (they are the team's way of working, not its data).
export default async function TeamHandoffsPage({ params }: PageProps<"/work/teams/[teamId]/handoffs">) {
  const user = await requireUser();
  const { teamId } = await params;
  const [team, viewer, t] = await Promise.all([/^[0-9a-f-]{36}$/.test(teamId) ? findTeam(teamId) : undefined, loadViewer(user), getTranslations("work")]);
  if (!team || !canViewTeam(viewer, teamFacts(team))) notFound();
  const manage = canManageHandoffPackages(viewer, teamFacts(team));
  const [packages, states, stats] = await Promise.all([listPackages(team.id), listStates([team.id]), manage ? handoffStatsByStage([team.id], new Date(`${addDays(todayInVietnam(), -STATS_DAYS)}T00:00:00+07:00`)) : []]);
  const duration = (minutes: number | null) => (minutes === null ? "—" : minutes < 60 ? t("handoff.waitedMinutes", { minutes }) : minutes < 60 * 48 ? t("handoff.waitedHours", { hours: Math.round(minutes / 60) }) : t("handoff.waitedDays", { days: Math.round(minutes / 1440) }));

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
        <h1>{t("handoff.packages.title")}</h1>
        <p className="text-sm text-muted-foreground">{t("handoff.packages.description")}</p>
      </header>

      <HandoffPackageManager
        teamId={team.id}
        packages={packages.map(({ id, name, fromStateId, toStateId, fields, checklist, requireLink, requireFile, requireAccept, isActive }) => ({ id, name, fromStateId, toStateId, fields, checklist, requireLink, requireFile, requireAccept, isActive }))}
        states={states.filter((state) => state.isActive).map(({ id, name }) => ({ id, name }))}
        canManage={manage}
      />

      {manage ? (
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-medium text-muted-foreground">{t("handoff.stats.title", { days: STATS_DAYS })}</h2>
          {stats.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("handoff.stats.empty")}</p>
          ) : (
            <div className="overflow-x-auto rounded-xl border">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2">{t("handoff.stats.stage")}</th>
                    <th className="px-3 py-2 text-right">{t("handoff.stats.total")}</th>
                    <th className="px-3 py-2 text-right">{t("handoff.stats.returned")}</th>
                    <th className="px-3 py-2 text-right">{t("handoff.stats.pending")}</th>
                    <th className="px-3 py-2 text-right">{t("handoff.stats.wait")}</th>
                    <th className="px-3 py-2 text-right">{t("handoff.stats.oldest")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {stats.map((row) => (
                    <tr key={row.toStateId ?? "none"}>
                      <td className="px-3 py-2">{row.stateName ?? "—"}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{row.total}</td>
                      <td className={`px-3 py-2 text-right tabular-nums ${row.returned ? "text-destructive" : ""}`}>{row.returned}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{row.pending}</td>
                      <td className="px-3 py-2 text-right">{duration(row.avgWaitMinutes)}</td>
                      <td className="px-3 py-2 text-right">{duration(row.oldestPendingMinutes)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ) : null}
    </div>
  );
}
