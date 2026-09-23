import { getFormatter, getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { buttonVariants } from "@/components/ui/button";
import { atLeast, kbViewerOf } from "@/modules/kb/service";
import { PageTree } from "@/modules/kb/ui/page-tree";
import { requireUser } from "@/modules/platform/auth/session";
import { canCreateProjectSpace, getProjectDocuments, openProject } from "@/modules/projects/service";
import { CreateSpaceButton } from "@/modules/projects/ui/collab-forms";
import { ProjectHeader } from "@/modules/projects/ui/project-header";
import { pageTitle } from "@/i18n/page-title";

export const generateMetadata = pageTitle("projectDocuments");

/**
 * The project's documents (FR-PJM-31): its space on the knowledge base — briefs, scripts, shot
 * lists, meeting notes — with every file uploaded to its pages in one list, and the project's
 * Drive folder. The space is open to the project's people; a reader of the project who is not one
 * of them — an entity-wide viewer, a team colleague — sees that it exists, not what is in it. The
 * one exception is the reader D30 let into a **private** project, a `pjm:portfolio` holder over
 * the owning team: on a private project they read its documents as they read its plan.
 */
export default async function ProjectDocumentsPage({ params }: PageProps<"/projects/[projectId]/documents">) {
  const user = await requireUser();
  const { projectId } = await params;
  const context = await openProject(user, projectId);
  if (!context) notFound();
  const { project, plan, viewer, facts } = context;
  const [t, format, documents] = await Promise.all([getTranslations("projects.documents"), getFormatter(), getProjectDocuments(kbViewerOf(user), plan.kbSpaceId)]);
  const size = (bytes: number) => (bytes >= 1024 * 1024 ? `${format.number(bytes / 1024 / 1024, { maximumFractionDigits: 1 })} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);

  return (
    <div className="flex max-w-4xl flex-col gap-8">
      <ProjectHeader context={context} current="documents" />

      <section className="flex flex-col gap-2 rounded-xl border p-4">
        <h2 className="text-base font-medium">{t("drive")}</h2>
        {plan.driveUrl ? (
          <a href={plan.driveUrl} target="_blank" rel="noopener noreferrer" className="text-sm break-all underline">
            {plan.driveUrl}
          </a>
        ) : (
          <p className="text-sm text-muted-foreground">
            {t("noDrive")}{" "}
            <Link href={`/projects/${project.id}/plan`} className="underline">
              {t("setDrive")}
            </Link>
          </p>
        )}
      </section>

      {!plan.kbSpaceId ? (
        <section className="flex flex-col gap-3 rounded-xl border border-dashed p-4">
          <h2 className="text-base font-medium">{t("title")}</h2>
          <p className="text-sm text-muted-foreground">{t("noSpace")}</p>
          {canCreateProjectSpace(viewer, facts) ? <CreateSpaceButton projectId={project.id} /> : null}
        </section>
      ) : !documents ? (
        <section className="flex flex-col gap-2 rounded-xl border p-4">
          <h2 className="text-base font-medium">{t("title")}</h2>
          <p className="text-sm text-muted-foreground">{t("membersOnly")}</p>
        </section>
      ) : (
        <>
          <section className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-base font-medium">{t("pages")}</h2>
              <div className="flex flex-wrap gap-2">
                <Link href={`/kb/spaces/${documents.space.key}`} className={buttonVariants({ size: "sm", variant: "outline" })}>
                  {t("openSpace")}
                </Link>
                {atLeast(documents.level, "edit") && !documents.space.archivedAt ? (
                  <Link href={`/kb/spaces/${documents.space.key}/new`} className={buttonVariants({ size: "sm" })}>
                    {t("newPage")}
                  </Link>
                ) : null}
              </div>
            </div>
            <p className="text-xs text-muted-foreground">{t("audience")}</p>
            <PageTree tree={documents.tree} />
          </section>

          <section className="flex flex-col gap-3">
            <h2 className="text-base font-medium">{t("files")}</h2>
            {documents.files.length === 0 ? <p className="text-sm text-muted-foreground">{t("noFiles")}</p> : null}
            <ul className="flex flex-col divide-y rounded-xl border">
              {documents.files.map((file) => (
                <li key={file.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 p-3 text-sm">
                  <a href={`/api/kb/files/${file.id}`} className="font-medium underline underline-offset-2">
                    {file.fileName}
                  </a>
                  <span className="text-xs text-muted-foreground">{size(file.sizeBytes)}</span>
                  <Link href={`/kb/pages/${file.pageId}`} className="min-w-0 truncate text-xs text-muted-foreground hover:underline">
                    {file.pageTitle}
                  </Link>
                  <span className="ml-auto text-xs text-muted-foreground">{[file.uploadedByName, format.dateTime(file.createdAt, { dateStyle: "medium" })].filter(Boolean).join(" · ")}</span>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </div>
  );
}
