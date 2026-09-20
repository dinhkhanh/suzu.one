import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { buttonVariants } from "@/components/ui/button";
import { requireUser } from "@/modules/platform/auth/session";
import { getOpeningView, listApplications } from "@/modules/recruit/service";
import { PipelineBoard } from "@/modules/recruit/ui/pipeline-board";

export const metadata: Metadata = { title: "Pipeline" };

// The kanban board (FR-REC-05). It shows exactly what `listApplications` returns, which is already
// scoped — a refused opening answers like one that does not exist, here as everywhere.
export default async function OpeningBoardPage({ params }: PageProps<"/recruit/[openingId]/board">) {
  const { openingId } = await params;
  const user = await requireUser();
  const view = await getOpeningView({ principal: user.principal, personId: user.person.id }, openingId);
  if (!view) notFound();

  const t = await getTranslations("recruit");
  const applications = await listApplications({ principal: user.principal, personId: user.person.id }, openingId, { status: "active" });

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs text-muted-foreground">{view.opening.code}</p>
          <h1 className="text-2xl font-semibold tracking-tight">{view.opening.title}</h1>
          <p className="text-sm text-muted-foreground">{t("board.description")}</p>
        </div>
        <Link href={`/recruit/${openingId}`} className={buttonVariants({ size: "sm", variant: "outline" })}>
          {t("board.openingDetails")}
        </Link>
      </header>

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

      <p className="text-xs text-muted-foreground">{t("confidential")}</p>
    </div>
  );
}
