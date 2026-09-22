import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/modules/platform/auth/session";
import { canManageReviewChains, canViewTeam, findTeam, listReviewChains, listTeamMembers, loadViewer, teamFacts } from "@/modules/work/service";
import { ReviewChainManager } from "@/modules/work/ui/review-chains";

export const metadata: Metadata = { title: "Review chains" };

// FR-PJM-50: the team's review chains — the stages a deliverable passes before it is approved. The
// team's leads keep them; anyone who may see the team reads them (they are how the team works).
export default async function TeamReviewChainsPage({ params }: PageProps<"/work/teams/[teamId]/reviews">) {
  const user = await requireUser();
  const { teamId } = await params;
  const [team, viewer, t] = await Promise.all([/^[0-9a-f-]{36}$/.test(teamId) ? findTeam(teamId) : undefined, loadViewer(user), getTranslations("work")]);
  if (!team || !canViewTeam(viewer, teamFacts(team))) notFound();
  const [chains, members] = await Promise.all([listReviewChains({ teamId: team.id }), listTeamMembers(team.id)]);

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
        <h1>{t("chains.title")}</h1>
        <p className="text-sm text-muted-foreground">{t("chains.description")}</p>
      </header>
      <ReviewChainManager
        teamId={team.id}
        chains={chains.map(({ id, name, projectId, contentFormat, isActive, stages }) => ({ id, name, projectId, contentFormat, isActive, stages }))}
        people={members.map((member) => ({ id: member.personId, fullName: member.fullName }))}
        canManage={canManageReviewChains(viewer, teamFacts(team))}
      />
    </div>
  );
}
