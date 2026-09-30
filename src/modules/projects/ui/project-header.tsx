// The top of every plan page: where the project sits, its job number, type, health and whether it
// has passed the kick-off gate — then the tabs.
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { statusTone } from "@/components/ui/tone";
import { canManageProject, listAssignable, listClients } from "../../work/service";
import { EditProjectButton } from "../../work/ui/edit-dialogs";
import { ProjectPoster } from "../../work/ui/project-poster";
import type { ProjectContext } from "../views";
import { type ProjectTab, ProjectTabs } from "./project-tabs";

export const healthVariant = (health: string | null) => (health === "on_track" ? "success" : health === "at_risk" ? "warning" : health === "off_track" ? "destructive" : "secondary");

export async function ProjectHeader({ context, current }: { context: ProjectContext; current: ProjectTab }) {
  const t = await getTranslations("projects");
  const tWork = await getTranslations("work");
  const { project, team, plan } = context;
  // The project's own details (name, client, lead, dates, status) are edited from every plan page.
  const [clients, people] = canManageProject(context.viewer, context.facts) ? await Promise.all([listClients({ activeOnly: true }), listAssignable(team.id, project.id)]) : [null, null];
  return (
    <header className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <p className="text-sm text-muted-foreground">
          <Link href="/projects" className="underline">
            {t("title")}
          </Link>
          {" / "}
          <Link href={`/work/teams/${team.id}`} className="underline">
            {team.name}
          </Link>
        </p>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="flex flex-wrap items-center gap-2">
            <ProjectPoster project={project} />
            {plan.jobNumber ? <span className="font-mono text-base text-muted-foreground">{plan.jobNumber}</span> : null}
            {project.name}
          </h1>
          {clients && people ? <EditProjectButton project={project} clients={clients.map(({ id, name }) => ({ id, name }))} people={people} /> : null}
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Badge variant="outline">{t(`kinds.${plan.kind as "client"}`)}</Badge>
          <Badge dot variant={statusTone(project.status)}>{tWork(`projects.status.${project.status as "active"}`)}</Badge>
          <Badge dot variant={statusTone(plan.briefStatus)}>{t(`brief.status.${plan.briefStatus as "draft"}`)}</Badge>
          {plan.health ? <Badge variant={healthVariant(plan.health)}>{t(`health.${plan.health as "on_track"}`)}</Badge> : null}
          {plan.closedAt ? <Badge variant="outline">{t("close.closedBadge")}</Badge> : null}
        </div>
      </div>
      <ProjectTabs projectId={project.id} current={current} kind={plan.kind} />
    </header>
  );
}
