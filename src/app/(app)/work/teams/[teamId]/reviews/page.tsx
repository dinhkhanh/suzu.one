import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { Page, PageHeader } from "@/components/ui/page";
import { RecordLink } from "@/components/ui/record-link";
import { notFound } from "next/navigation";
import { requireUser } from "@/modules/platform/auth/session";
import { canManageReviewChains, canViewTeam, findTeam, listReviewChains, listTeamMembers, loadViewer, teamFacts } from "@/modules/work/service";
import { ReviewChainManager } from "@/modules/work/ui/review-chains";
import { pageTitle } from "@/i18n/page-title";

export const generateMetadata = pageTitle("reviewChains");

// FR-PJM-50: the team's review chains — the stages a deliverable passes before it is approved. The
// team's leads keep them; anyone who may see the team reads them (they are how the team works).
export default async function TeamReviewChainsPage({ params }: PageProps<"/work/teams/[teamId]/reviews">) {
  const user = await requireUser();
  const { teamId } = await params;
  const [team, viewer, t] = await Promise.all([/^[0-9a-f-]{36}$/.test(teamId) ? findTeam(teamId) : undefined, loadViewer(user), getTranslations("work")]);
  if (!team || !canViewTeam(viewer, teamFacts(team))) notFound();
  const [chains, members] = await Promise.all([listReviewChains({ teamId: team.id }), listTeamMembers(team.id)]);

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
        title={t("chains.title")}
        description={t("chains.description")}
      />
      <ReviewChainManager
        teamId={team.id}
        chains={chains.map(({ id, name, projectId, contentFormat, isActive, stages }) => ({ id, name, projectId, contentFormat, isActive, stages }))}
        people={members.map((member) => ({ id: member.personId, fullName: member.fullName }))}
        canManage={canManageReviewChains(viewer, teamFacts(team))}
      />
    </Page>
  );
}
