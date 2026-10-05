// The top of every plan page: the project's mark (its colour and initials, or its poster), its
// name, the badges that say what it is and how it stands, its description — then the tabs. The
// edit key sits at the right end of the title line.
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { statusTone } from "@/components/ui/tone";
import { cn } from "@/lib/utils";
import { initialsOf } from "@/lib/text";
import { EditProjectButton, posterUrlOf } from "../../work/client";
import { accentOf, canManageProject, listAssignable, listClients, PROJECT_STATUSES, projectStatusChoices, projectStatusNames } from "../../work/service";
import { isClientWork } from "../engine/brief";
import { type GateFacts, offeredStatuses } from "../engine/gates";
import type { ProjectContext } from "../views";
import { type ProjectTab, ProjectTabs } from "./project-tabs";

export const healthVariant = (health: string | null) => (health === "on_track" ? "success" : health === "at_risk" ? "warning" : health === "off_track" ? "destructive" : "secondary");

/**
 * A project's mark: a rounded square in the project's accent (the page's `data-accent` turns the
 * one blue into it) with its initials, or its poster when it has one; ink when it has no colour.
 */
export function ProjectMark({ project, accent, size = "default", className }: { project: { id: string; name: string; posterFileId?: string | null }; accent?: boolean; size?: "sm" | "default"; className?: string }) {
  const src = posterUrlOf(project);
  const radius = size === "sm" ? "rounded-[9px] after:rounded-[9px]" : "rounded-[11px] after:rounded-[11px]";
  return (
    <Avatar className={cn(size === "sm" ? "size-8" : "size-10", radius, "after:border-foreground/10", className)}>
      {src ? <AvatarImage src={src} alt={project.name} className={radius} /> : null}
      <AvatarFallback className={cn(radius, "font-semibold tracking-tight", size === "sm" ? "text-xs" : "text-sm", accent ? "bg-primary text-primary-foreground" : "bg-ink text-ink-foreground")}>{initialsOf(project.name.replace(/[^\p{L}\p{N}\s]+/gu, " "))}</AvatarFallback>
    </Avatar>
  );
}

export async function ProjectHeader({ context, current }: { context: ProjectContext; current: ProjectTab }) {
  const t = await getTranslations("projects");
  const tWork = await getTranslations("work");
  const { project, team, plan } = context;
  // The project's own details (name, client, lead, dates, status) are edited from every plan page.
  const manage = canManageProject(context.viewer, context.facts);
  const [[clients, people, statuses], statusNames] = await Promise.all([
    manage ? Promise.all([listClients({ activeOnly: true }), listAssignable(team.id, project.id), projectStatusChoices(team.projectStatusSetId, project.statusId)]) : ([null, null, []] as const),
    projectStatusNames(),
  ]);
  // The status control offers only what the gates allow by hand (FR-PJM-03, 59): a client project
  // becomes Active through its kick-off and Done through its close-out, and a closed project is
  // re-opened on the close page. The hint under the control says where; the server refuses either way.
  const gate: GateFacts = { kind: plan.kind, briefApproved: plan.briefStatus === "approved", closed: !!plan.closedAt };
  const statusCategories = offeredStatuses(gate, project.status, PROJECT_STATUSES);
  const closeLink = (chunks: React.ReactNode) => (
    <Link href={`/projects/${project.id}/close`} className="text-link hover:underline">
      {chunks}
    </Link>
  );
  const briefLink = (chunks: React.ReactNode) => (
    <Link href={`/projects/${project.id}`} className="text-link hover:underline">
      {chunks}
    </Link>
  );
  const statusHint = gate.closed ? t.rich("gates.closedHint", { close: closeLink }) : isClientWork(gate.kind) ? t.rich("gates.clientHint", { brief: briefLink, close: closeLink }) : null;
  return (
    <header className="flex flex-col gap-4">
      <p className="flex flex-wrap items-center gap-x-1.5 text-[0.8125rem] font-medium text-muted-foreground">
        <Link href="/projects" className="hover:text-foreground">
          {t("title")}
        </Link>
        <span className="text-faint">/</span>
        <Link href={`/work/teams/${team.id}`} className="hover:text-foreground">
          {team.name}
        </Link>
        {plan.jobNumber ? (
          <>
            <span className="text-faint">/</span>
            <span className="font-mono text-xs tabular-nums">{plan.jobNumber}</span>
          </>
        ) : null}
      </p>
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between md:gap-6">
        <div className="flex min-w-0 items-start gap-3">
          <ProjectMark project={project} accent={!!accentOf(project.color, team.color)} className="mt-0.5" />
          <div className="flex min-w-0 flex-col gap-1.5">
            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
              <h1 className="min-w-0 break-words">{project.name}</h1>
              <span className="flex flex-wrap items-center gap-1.5">
                <Badge dot variant={statusTone(project.status)}>{(project.statusId && statusNames.get(project.statusId)) || tWork(`projects.status.${project.status as "active"}`)}</Badge>
                <Badge variant="outline">{t(`kinds.${plan.kind as "client"}`)}</Badge>
                <Badge dot variant={statusTone(plan.briefStatus)}>{t(`brief.status.${plan.briefStatus as "draft"}`)}</Badge>
                {plan.health ? <Badge variant={healthVariant(plan.health)}>{t(`health.${plan.health as "on_track"}`)}</Badge> : null}
                {plan.closedAt ? <Badge variant="secondary">{t("close.closedBadge")}</Badge> : null}
              </span>
            </div>
            {project.description ? <p className="max-w-prose text-sm text-muted-foreground">{project.description}</p> : null}
          </div>
        </div>
        {clients && people ? (
          <div className="flex shrink-0 items-center gap-2 md:pt-1">
            <EditProjectButton project={project} clients={clients.map(({ id, name }) => ({ id, name }))} people={people} statuses={statuses} statusCategories={statusCategories} statusHint={statusHint} />
          </div>
        ) : null}
      </div>
      <ProjectTabs projectId={project.id} current={current} kind={plan.kind} />
    </header>
  );
}
