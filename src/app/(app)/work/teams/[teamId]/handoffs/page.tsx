import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Table, TableBody, TableCard, TableCardHeader, TableCell, TableEmpty, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { addDays, todayInVietnam } from "@/lib/dates";
import { requireUser } from "@/modules/platform/auth/session";
import { checklistChoices, canManageHandoffPackages, canViewTeam, findTeam, handoffStatsByStage, listPackages, listStates, loadViewer, teamFacts } from "@/modules/work/service";
import { HandoffPackageManager } from "@/modules/work/ui/handoff-packages";
import { pageTitle } from "@/i18n/page-title";

export const generateMetadata = pageTitle("handOffs");

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
  const [packages, states, checklists, stats] = await Promise.all([listPackages(team.id), listStates([team.id]), checklistChoices(), manage ? handoffStatsByStage([team.id], new Date(`${addDays(todayInVietnam(), -STATS_DAYS)}T00:00:00+07:00`)) : []]);
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
        packages={packages.map(({ id, name, fromStateId, toStateId, fields, checklist, checklistIds, requireLink, requireFile, requireAccept, isActive }) => ({ id, name, fromStateId, toStateId, fields, checklist, checklistIds, requireLink, requireFile, requireAccept, isActive }))}
        states={states.filter((state) => state.isActive).map(({ id, name }) => ({ id, name }))}
        checklists={checklists}
        canManage={manage}
      />

      {manage ? (
        <TableCard>
          <TableCardHeader title={t("handoff.stats.title", { days: STATS_DAYS })} />
          <Table numbered={false}>
            <TableHeader>
              <TableRow>
                <TableHead kind="status">{t("handoff.stats.stage")}</TableHead>
                <TableHead kind="number">{t("handoff.stats.total")}</TableHead>
                <TableHead kind="number">{t("handoff.stats.returned")}</TableHead>
                <TableHead kind="number">{t("handoff.stats.pending")}</TableHead>
                <TableHead kind="time">{t("handoff.stats.wait")}</TableHead>
                <TableHead kind="time">{t("handoff.stats.oldest")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {stats.length === 0 ? <TableEmpty>{t("handoff.stats.empty")}</TableEmpty> : null}
              {stats.map((row) => (
                <TableRow key={row.toStateId ?? "none"}>
                  <TableCell>{row.stateName ?? "—"}</TableCell>
                  <TableCell kind="number">{row.total}</TableCell>
                  <TableCell kind="number" className={row.returned ? "text-destructive" : undefined}>{row.returned}</TableCell>
                  <TableCell kind="number">{row.pending}</TableCell>
                  <TableCell kind="time">{duration(row.avgWaitMinutes)}</TableCell>
                  <TableCell kind="time">{duration(row.oldestPendingMinutes)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableCard>
      ) : null}
    </div>
  );
}
