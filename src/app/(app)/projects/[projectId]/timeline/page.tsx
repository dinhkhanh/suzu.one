import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { todayInVietnam } from "@/lib/dates";
import { requireUser } from "@/modules/platform/auth/session";
import { getTimeline, openProject } from "@/modules/projects/service";
import { ProjectHeader } from "@/modules/projects/ui/project-header";
import { TimelineView } from "@/modules/projects/ui/timeline-view";
import { pageTitle } from "@/i18n/page-title";

export const generateMetadata = pageTitle("timeline");

/**
 * The project's timeline (FR-PJM-07): phases, milestones and tasks over the working calendar, with
 * dependencies and the kick-off baseline (FR-PJM-12). Whoever may read the plan sees it; each bar
 * can be dragged only by someone who may edit that task, and the move re-checks it.
 */
export default async function ProjectTimelinePage({ params }: PageProps<"/projects/[projectId]/timeline">) {
  const user = await requireUser();
  const { projectId } = await params;
  const context = await openProject(user, projectId);
  if (!context) notFound();
  const { project, team, viewer } = context;
  const [t, view] = await Promise.all([getTranslations("projects.timeline"), getTimeline(viewer, { id: project.id, teamId: team.id, entityId: project.entityId, startDate: project.startDate, dueDate: project.dueDate }, todayInVietnam())]);

  return (
    <div className="flex flex-col gap-6">
      <div className="max-w-5xl">
        <ProjectHeader context={context} current="timeline" />
      </div>
      <section className="flex flex-col gap-2">
        <h2 className="text-base font-medium">{t("title")}</h2>
        <TimelineView view={view} />
      </section>
    </div>
  );
}
