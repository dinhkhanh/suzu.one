import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { buttonVariants } from "@/components/ui/button";
import { Page, PageHeader } from "@/components/ui/page";
import { requireUser } from "@/modules/platform/auth/session";
import { getOpeningView, listApplications } from "@/modules/recruit/service";
import { PipelineBoard } from "@/modules/recruit/ui/pipeline-board";
import { pageTitle } from "@/i18n/page-title";

export const generateMetadata = pageTitle("pipeline");

// The kanban board (FR-REC-05). It shows exactly what `listApplications` returns, which is already
// scoped — a refused opening answers like one that does not exist, here as everywhere.
export default async function OpeningBoardPage({ params }: PageProps<"/recruit/[openingId]/board">) {
  const { openingId } = await params;
  const user = await requireUser();
  // `listApplications` checks the opening for itself, so it can be read beside the view.
  const [view, t, applications] = await Promise.all([
    getOpeningView({ principal: user.principal, personId: user.person.id }, openingId),
    getTranslations("recruit"),
    listApplications({ principal: user.principal, personId: user.person.id }, openingId, { status: "active" }),
  ]);
  if (!view) notFound();

  return (
    <Page width="full">
      <PageHeader
        eyebrow={<span className="font-mono">{view.opening.code}</span>}
        title={view.opening.title}
        description={t("board.description")}
        actions={
          <Link href={`/recruit/${openingId}`} className={buttonVariants({ variant: "outline" })}>
            {t("board.openingDetails")}
          </Link>
        }
      />

      {applications.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("noApplications")}</p>
      ) : (
        <PipelineBoard
          stages={view.stages.map((stage) => ({ id: stage.id, name: stage.name }))}
          cards={applications.map((row) => ({
            id: row.id,
            candidateName: row.candidateName,
            currentTitle: row.currentTitle,
            stageId: row.stageId,
            days: row.daysInStage,
            source: row.source,
          }))}
        />
      )}

      <p className="text-xs text-faint">{t("confidential")}</p>
    </Page>
  );
}
