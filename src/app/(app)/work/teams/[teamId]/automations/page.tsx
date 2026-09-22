import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/modules/platform/auth/session";
import { automationPanel, canManageAutomations, canViewAutomations, findTeam, loadViewer, teamFacts } from "@/modules/work/service";
import { AutomationManager } from "@/modules/work/ui/automations";

export const metadata: Metadata = { title: "Automations" };

// FR-PJM-33: the team's "when … then …" rules, and every project's own, with their latest runs.
// The team's leads keep them; the team's people read them (they are how the team works).
export default async function TeamAutomationsPage({ params }: PageProps<"/work/teams/[teamId]/automations">) {
  const user = await requireUser();
  const { teamId } = await params;
  const [team, viewer, t] = await Promise.all([/^[0-9a-f-]{36}$/.test(teamId) ? findTeam(teamId) : undefined, loadViewer(user), getTranslations("work")]);
  if (!team || !canViewAutomations(viewer, teamFacts(team))) notFound();
  const panel = await automationPanel({ teamId: team.id, projectId: null }, viewer);

  return (
    <div className="flex max-w-4xl flex-col gap-6">
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
        <h1>{t("automations.title")}</h1>
        <p className="text-sm text-muted-foreground">{t("automations.description")}</p>
      </header>
      <AutomationManager teamId={team.id} rules={panel.rules} options={panel.options} runs={panel.runs} canManage={canManageAutomations(viewer, teamFacts(team))} />
    </div>
  );
}
