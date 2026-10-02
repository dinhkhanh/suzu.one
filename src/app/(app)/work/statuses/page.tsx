import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { Page, PageHeader, Section } from "@/components/ui/page";
import { requireUser } from "@/modules/platform/auth/session";
import { canAdminTeam, canManageTemplate, listProjectStatusSets, listProjectStatuses, listStateSets, listTeams, loadViewer, projectStatusUsage, teamFacts } from "@/modules/work/service";
import { type OwnerChoice, type SetCard, StatusSetLibrary } from "@/modules/work/ui/status-sets";
import { pageTitle } from "@/i18n/page-title";

export const generateMetadata = pageTitle("statusSets");

// The status library (FR-WRK-03, FR-PJM): task workflows a new team starts from, and project
// status sets a team's projects move through. Shared sets, and those of the viewer's teams.
export default async function StatusSetsPage() {
  const user = await requireUser();
  const viewer = await loadViewer(user);
  const [t, tWork, teams, stateSets, projectSets, projectStatuses, usage] = await Promise.all([getTranslations("work.statusSets"), getTranslations("work"), listTeams(), listStateSets(), listProjectStatusSets(), listProjectStatuses(), projectStatusUsage()]);
  const teamOf = new Map(teams.map((team) => [team.id, team]));
  const runs = (teamId: string) => {
    const team = teamOf.get(teamId);
    return !!team && canAdminTeam(viewer, teamFacts(team));
  };
  // A team's sets are its own business: its members and whoever runs it.
  const sees = (owner: string | null) => !owner || viewer.teamRoles.has(owner) || runs(owner);
  const canManage = (owner: string | null) => {
    const team = owner ? teamOf.get(owner) : null;
    return canManageTemplate(viewer, team ? teamFacts(team) : null);
  };
  const owners: OwnerChoice[] = [...(canManageTemplate(viewer, null) ? [{ value: "", name: t("shared") }] : []), ...teams.filter((team) => team.isActive && canAdminTeam(viewer, teamFacts(team))).map((team) => ({ value: team.id, name: team.name }))];
  const card = (set: { id: string; name: string; description: string | null; ownerTeamId: string | null; isActive: boolean }) => ({
    id: set.id,
    name: set.name,
    description: set.description,
    owner: set.ownerTeamId ?? "",
    ownerName: set.ownerTeamId ? (teamOf.get(set.ownerTeamId)?.name ?? null) : null,
    isActive: set.isActive,
    canManage: canManage(set.ownerTeamId),
  });

  const workflows: SetCard[] = stateSets.filter((set) => sees(set.ownerTeamId)).map((set) => ({ ...card(set), statuses: set.states.map((state) => ({ id: null, name: state.name, category: state.category, isActive: true })) }));
  const projectCards: SetCard[] = projectSets
    .filter((set) => sees(set.ownerTeamId))
    .map((set) => ({
      ...card(set),
      teams: usage.teamsBySet.get(set.id) ?? 0,
      statuses: projectStatuses.filter((status) => status.setId === set.id).map((status) => ({ id: status.id, name: status.name, category: status.category, isActive: status.isActive, uses: usage.projectsByStatus.get(status.id) ?? 0 })),
    }));

  return (
    <Page width="default">
      <PageHeader
        eyebrow={
          <Link href="/work" className="hover:underline">
            {tWork("title")}
          </Link>
        }
        title={t("title")}
        description={t("description")}
      />

      <Section title={t("workflows")} count={workflows.length || undefined} description={t("workflowsHint")}>
        <StatusSetLibrary kind="workflow" sets={workflows} owners={owners} canCreate={owners.length > 0} />
      </Section>

      <Section title={t("projectSets")} count={projectCards.length || undefined} description={t("projectSetsHint")}>
        <StatusSetLibrary kind="project" sets={projectCards} owners={owners} canCreate={owners.length > 0} />
      </Section>
    </Page>
  );
}
