import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { Page, PageHeader } from "@/components/ui/page";
import { notFound } from "next/navigation";
import { requireUser } from "@/modules/platform/auth/session";
import { automationPanel, canManageAutomations, canViewAutomations, findTeam, loadViewer, teamFacts } from "@/modules/work/service";
import { AutomationManager } from "@/modules/work/ui/automations";
import { pageTitle } from "@/i18n/page-title";

export const generateMetadata = pageTitle("automations");

// FR-PJM-33: the team's "when … then …" rules, and every project's own, with their latest runs.
// The team's leads keep them; the team's people read them (they are how the team works).
export default async function TeamAutomationsPage({ params }: PageProps<"/work/teams/[teamId]/automations">) {
  const user = await requireUser();
  const { teamId } = await params;
  const [team, viewer, t] = await Promise.all([/^[0-9a-f-]{36}$/.test(teamId) ? findTeam(teamId) : undefined, loadViewer(user), getTranslations("work")]);
  if (!team || !canViewAutomations(viewer, teamFacts(team))) notFound();
  const panel = await automationPanel({ teamId: team.id, projectId: null }, viewer);

  return (
    <Page width="default">
      <PageHeader eyebrow={<span className="flex flex-wrap items-center gap-x-1.5"><Link href="/work" className="hover:underline">
            {t("title")}
          </Link>
          <span className="text-faint">/</span>
          <Link href={`/work/teams/${team.id}`} className="hover:underline">
            {team.name}
          </Link></span>} title={t("automations.title")} description={t("automations.description")} />
      <AutomationManager teamId={team.id} rules={panel.rules} options={panel.options} runs={panel.runs} canManage={canManageAutomations(viewer, teamFacts(team))} />
    </Page>
  );
}
